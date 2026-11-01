#!/usr/bin/env node
/**
 * Read-only duplicate inventory for JobHunter.
 *
 * Groups stored jobs by `(sourceId, fingerprint)` and reports every group with
 * more than one row. Ingestion now suppresses new same-source duplicates; this
 * script exists so operators can measure the historical rows that predate the
 * guard before deciding whether a cleanup is worth the risk.
 *
 * It never writes to the database.
 *
 * Usage (from backend/):
 *   node scripts/duplicate-report.js               # top 10 groups
 *   node scripts/duplicate-report.js --all         # every group
 *   node scripts/duplicate-report.js --limit 50
 *   node scripts/duplicate-report.js --json        # machine-readable output
 *   node scripts/duplicate-report.js --content     # content twins: same source+title+company
 *   node scripts/duplicate-report.js --apply       # merge every safe group
 *
 * `--apply` first takes a verified gzip backup through db-migrate-safe.js,
 * then merges references onto one survivor per group in a single transaction.
 * A group is skipped when the same user has an application on more than one
 * copy; those need a human decision. Nothing is written without `--apply`.
 *
 * Job currently has four referencing models: JobMatch, Application,
 * Notification, and JobSkill. Extend `buildPlan`/`applyPlans` before adding a
 * fifth, or the cascade delete will silently remove it.
 *
 * Environment:
 *   DATABASE_URL   optional; defaults to backend/prisma/dev.db
 *
 * Exit codes: 0 = report produced, 1 = database error.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BACKEND = path.resolve(__dirname, '..');
const SCHEMA_DIR = path.join(BACKEND, 'prisma');
const MIGRATE_SCRIPT = path.join(__dirname, 'db-migrate-safe.js');

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const option = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] || null;
};

if (has('--help') || has('-h')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').trim());
  process.exit(0);
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    let value = raw.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(path.join(BACKEND, '.env'));

function resolveDatabaseUrl() {
  const configured = process.env.DATABASE_URL;
  if (!configured) return `file:${path.join(SCHEMA_DIR, 'dev.db')}`;
  if (!configured.startsWith('file:')) return configured;
  const raw = configured.slice('file:'.length).split('?')[0];
  if (!raw) return configured;
  // Prisma resolves a datasource-relative path against the schema directory.
  return `file:${path.isAbsolute(raw) ? raw : path.resolve(SCHEMA_DIR, raw)}`;
}

const databaseUrl = resolveDatabaseUrl();
const json = has('--json');
const apply = has('--apply');
const backupDir = option('--backup-dir');
const showAll = has('--all');
const limitOption = option('--limit');
const limit = showAll ? Infinity : limitOption ? Math.max(1, Number(limitOption) || 10) : 10;

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});

function describeDatabase(url) {
  if (url.startsWith('file:')) {
    const file = url.slice('file:'.length).split('?')[0];
    let size = null;
    try {
      size = fs.statSync(file).size;
    } catch {
      /* missing file is reported by the query */
    }
    return { kind: 'sqlite', file, size };
  }
  return { kind: 'remote', target: url.replace(/:[^:@/]+@/, ':***@') };
}

function refsOf(job) {
  const counts = job._count || {};
  return {
    matches: counts.matches ?? 0,
    applications: counts.apps ?? 0,
    notifications: counts.notifications ?? 0,
    skills: counts.skills ?? 0,
  };
}

function referenceTotal(refs) {
  return refs.matches + refs.applications + refs.notifications;
}

function pickSurvivor(jobs) {
  return [...jobs].sort((a, b) => {
    const aActive = a.status === 'ACTIVE' ? 1 : 0;
    const bActive = b.status === 'ACTIVE' ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const refDiff = referenceTotal(refsOf(b)) - referenceTotal(refsOf(a));
    if (refDiff !== 0) return refDiff;
    const seenDiff = new Date(a.firstSeenAt).getTime() - new Date(b.firstSeenAt).getTime();
    if (seenDiff !== 0) return seenDiff;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

function short(text, width) {
  if (!text) return '';
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

function backupBeforeApply() {
  const args = [MIGRATE_SCRIPT, '--backup-only'];
  if (backupDir) args.push('--backup-dir', path.resolve(BACKEND, backupDir));
  const result = spawnSync(process.execPath, args, {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error('Pre-cleanup backup failed; no changes were made.');
  }
  return (
    (result.stdout || '')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop() || null
  );
}

async function buildPlan(group) {
  const survivorId = group.survivorId;
  const dupIds = group.jobs.filter((job) => !job.survivor).map((job) => job.id);
  if (!dupIds.length) return { group, dupIds, skipped: 'no duplicate rows' };

  const ids = [survivorId, ...dupIds];
  const [matches, applications, notifications, skills] = await Promise.all([
    prisma.jobMatch.findMany({
      where: { jobId: { in: ids } },
      select: { id: true, userId: true, jobId: true },
    }),
    prisma.application.findMany({
      where: { jobId: { in: ids } },
      select: { id: true, userId: true, jobId: true },
    }),
    prisma.notification.findMany({
      where: { jobId: { in: ids } },
      select: { id: true, userId: true, jobId: true },
    }),
    prisma.jobSkill.findMany({
      where: { jobId: { in: ids } },
      select: { id: true, skillId: true, jobId: true },
    }),
  ]);

  const applicationsByUser = new Map();
  for (const application of applications) {
    applicationsByUser.set(application.userId, (applicationsByUser.get(application.userId) || 0) + 1);
  }
  const conflict = [...applicationsByUser.entries()].find(([, count]) => count > 1);
  if (conflict) {
    return {
      group,
      dupIds,
      matches,
      applications,
      notifications,
      skills,
      skipped: `user ${conflict[0]} has an application on more than one copy`,
    };
  }

  return { group, dupIds, matches, applications, notifications, skills };
}

async function applyPlans(plans) {
  const summary = {
    groupsMerged: 0,
    groupsSkipped: 0,
    jobsDeleted: 0,
    matchesMoved: 0,
    matchesDeleted: 0,
    applicationsMoved: 0,
    notificationsMoved: 0,
    notificationsDeleted: 0,
    skillsMoved: 0,
    skillsDeleted: 0,
  };
  const safe = plans.filter((plan) => !plan.skipped);
  summary.groupsSkipped = plans.length - safe.length;
  if (!safe.length) return summary;

  await prisma.$transaction(async (tx) => {
    for (const plan of safe) {
      const survivorId = plan.group.survivorId;
      const dupIds = new Set(plan.dupIds);

      const seenMatchUsers = new Set(
        plan.matches.filter((row) => row.jobId === survivorId).map((row) => row.userId),
      );
      for (const row of plan.matches.filter((item) => dupIds.has(item.jobId))) {
        if (seenMatchUsers.has(row.userId)) {
          await tx.jobMatch.delete({ where: { id: row.id } });
          summary.matchesDeleted++;
        } else {
          await tx.jobMatch.update({ where: { id: row.id }, data: { jobId: survivorId } });
          seenMatchUsers.add(row.userId);
          summary.matchesMoved++;
        }
      }

      const seenNotificationUsers = new Set(
        plan.notifications
          .filter((row) => row.jobId === survivorId)
          .map((row) => row.userId),
      );
      for (const row of plan.notifications.filter((item) => dupIds.has(item.jobId))) {
        if (seenNotificationUsers.has(row.userId)) {
          await tx.notification.delete({ where: { id: row.id } });
          summary.notificationsDeleted++;
        } else {
          await tx.notification.update({ where: { id: row.id }, data: { jobId: survivorId } });
          seenNotificationUsers.add(row.userId);
          summary.notificationsMoved++;
        }
      }

      const seenApplicationUsers = new Set(
        plan.applications.filter((row) => row.jobId === survivorId).map((row) => row.userId),
      );
      for (const row of plan.applications.filter((item) => dupIds.has(item.jobId))) {
        if (seenApplicationUsers.has(row.userId)) {
          // buildPlan refuses this case; keep the guard so a partial write can
          // never delete a user's application.
          throw new Error(`application conflict for user ${row.userId} in ${plan.group.sourceId}`);
        }
        await tx.application.update({ where: { id: row.id }, data: { jobId: survivorId } });
        seenApplicationUsers.add(row.userId);
        summary.applicationsMoved++;
      }

      const seenSkillIds = new Set(
        plan.skills.filter((row) => row.jobId === survivorId).map((row) => row.skillId),
      );
      for (const row of plan.skills.filter((item) => dupIds.has(item.jobId))) {
        if (seenSkillIds.has(row.skillId)) {
          await tx.jobSkill.delete({ where: { id: row.id } });
          summary.skillsDeleted++;
        } else {
          await tx.jobSkill.update({ where: { id: row.id }, data: { jobId: survivorId } });
          seenSkillIds.add(row.skillId);
          summary.skillsMoved++;
        }
      }

      for (const id of plan.dupIds) {
        await tx.job.delete({ where: { id } });
        summary.jobsDeleted++;
      }
      summary.groupsMerged++;
    }
  }, { maxWait: 10_000, timeout: 60_000 });

  return summary;
}

async function integrityReport(target) {
  if (target.kind !== 'sqlite') return null;
  const integrity = await prisma.$queryRawUnsafe('PRAGMA integrity_check');
  const foreignKeys = await prisma.$queryRawUnsafe('PRAGMA foreign_key_check');
  return {
    integrity: integrity && integrity[0] ? integrity[0].integrity_check : 'unknown',
    foreignKeyViolations: Array.isArray(foreignKeys) ? foreignKeys.length : 0,
  };
}

/**
 * Content-twin inventory (`--content`).
 *
 * The `(sourceId, fingerprint)` guard collapses rows whose stored fingerprint is
 * identical. It cannot see the case that a real user actually notices: one
 * posting published by a source once per city — same company, same title, same
 * body text apart from the location sentence, so a different `sourceJobId`, a
 * different URL, a different fingerprint, and therefore a different Job row.
 *
 * This groups ACTIVE jobs by `(sourceId, title, company)` and reports the groups
 * whose members are not simply the fingerprint duplicates already covered, plus
 * how many users see two or more of a group in one match list. Read-only: it
 * never merges, because "same posting republished per city" and "two genuine
 * openings in two cities" are not separable from stored data — that is a product
 * decision, not a cleanup.
 */
async function contentReport(target) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT "sourceId" AS "sourceId", "title" AS "title", "company" AS "company",
           COUNT(*) AS "count", COUNT(DISTINCT "fingerprint") AS "fingerprints",
           COUNT(DISTINCT "location") AS "locations"
    FROM "Job"
    WHERE "status" = 'ACTIVE'
    GROUP BY "sourceId", "title", "company"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, "sourceId" ASC
  `);

  const limit = Number(option('--limit') || 10);
  const groups = [];
  for (const row of rows.slice(0, limit)) {
    const jobs = await prisma.job.findMany({
      where: { sourceId: row.sourceId, title: row.title, company: row.company, status: 'ACTIVE' },
      select: { id: true, sourceJobId: true, location: true, url: true, fingerprint: true, firstSeenAt: true },
      orderBy: { firstSeenAt: 'asc' },
    });
    const seenBy = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS "users" FROM (
         SELECT "userId" FROM "JobMatch"
         WHERE "jobId" IN (${jobs.map(() => '?').join(',')})
         GROUP BY "userId" HAVING COUNT(DISTINCT "jobId") > 1
       ) AS "shared"`,
      ...jobs.map((j) => j.id),
    );
    groups.push({
      sourceId: row.sourceId,
      title: row.title,
      company: row.company,
      count: Number(row.count),
      distinctFingerprints: Number(row.fingerprints),
      distinctLocations: Number(row.locations),
      usersSeeingSeveral: Number(seenBy[0] ? seenBy[0].users : 0),
      jobs: jobs.map((j) => ({
        sourceJobId: j.sourceJobId,
        location: j.location,
        fingerprintKind: String(j.fingerprint || '').slice(0, 24),
        url: j.url,
      })),
    });
  }

  const twinGroups = rows.filter((r) => Number(r.fingerprints) > 1);
  const usersAffected = groups.reduce((sum, g) => sum + g.usersSeeingSeveral, 0);

  if (has('--json')) {
    console.log(JSON.stringify({ database: target, groups: rows.length, twinGroups: twinGroups.length, top: groups }, null, 2));
    return;
  }

  console.log('Content-twin report (read-only)');
  console.log('================================');
  console.log(`Database: ${target.kind === 'sqlite' ? target.file : target.kind}`);
  console.log(`Groups sharing (source, title, company) with >1 ACTIVE job: ${rows.length}`);
  console.log(`  of those, groups whose members carry distinct fingerprints: ${twinGroups.length}`);
  console.log('');
  console.log('The fingerprint guard cannot merge the distinct-fingerprint groups: the stored text');
  console.log('differs, usually only in the location sentence. Merging them would also merge two');
  console.log('genuine openings in two cities, so this script stops at measuring.');
  console.log('');
  for (const group of groups) {
    console.log(`- ${group.company} — "${short(group.title, 60)}" [${group.sourceId}] ×${group.count}` +
      ` (${group.distinctLocations} locations, ${group.distinctFingerprints} fingerprints, ${group.usersSeeingSeveral} users see >1)`);
    for (const job of group.jobs.slice(0, 4)) {
      console.log(`    · ${job.location} · ${short(job.sourceJobId || '', 46)} · ${short(job.url || '', 70)}`);
    }
  }
  if (!groups.length) console.log('No content-twin groups.');
  console.log('');
  console.log(`Users affected by the top ${groups.length} groups: ${usersAffected} (each sees two or more copies in one list)`);
}

async function main() {
  const target = describeDatabase(databaseUrl);
  if (target.kind === 'sqlite' && !target.file) {
    throw new Error('DATABASE_URL resolves to an empty SQLite path.');
  }
  if (target.kind === 'sqlite' && target.size === null) {
    // Let Prisma produce its normal error, but make the likely cause obvious.
    process.stderr.write(`[duplicates] warning: SQLite file not found at ${target.file}\n`);
  }

  if (has('--content')) {
    await contentReport(target);
    return;
  }

  const totalJobs = await prisma.job.count();
  const fingerprinted = await prisma.job.count({ where: { fingerprint: { not: null } } });

  const groupRows = await prisma.$queryRawUnsafe(`
    SELECT "sourceId" AS "sourceId", "fingerprint" AS "fingerprint", COUNT(*) AS "count"
    FROM "Job"
    WHERE "fingerprint" IS NOT NULL AND "fingerprint" <> ''
    GROUP BY "sourceId", "fingerprint"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, "sourceId" ASC
  `);

  const crossSourceRows = await prisma.$queryRawUnsafe(`
    SELECT "fingerprint" AS "fingerprint", COUNT(DISTINCT "sourceId") AS "sources", COUNT(*) AS "count"
    FROM "Job"
    WHERE "fingerprint" IS NOT NULL AND "fingerprint" <> ''
    GROUP BY "fingerprint"
    HAVING COUNT(DISTINCT "sourceId") > 1
    ORDER BY COUNT(*) DESC
  `);

  const groups = [];
  for (const row of groupRows) {
    const jobs = await prisma.job.findMany({
      where: { sourceId: row.sourceId, fingerprint: row.fingerprint },
      select: {
        id: true,
        sourceId: true,
        sourceJobId: true,
        status: true,
        title: true,
        company: true,
        location: true,
        url: true,
        firstSeenAt: true,
        lastSeenAt: true,
        _count: { select: { matches: true, apps: true, notifications: true, skills: true } },
      },
      orderBy: [{ firstSeenAt: 'asc' }, { id: 'asc' }],
    });
    const survivor = pickSurvivor(jobs);
    groups.push({
      sourceId: row.sourceId,
      count: Number(row.count),
      title: survivor.title,
      company: survivor.company,
      location: survivor.location,
      survivorId: survivor.id,
      survivorSourceJobId: survivor.sourceJobId,
      jobs: jobs.map((job) => ({
        id: job.id,
        sourceJobId: job.sourceJobId,
        status: job.status,
        url: job.url,
        firstSeenAt: job.firstSeenAt,
        lastSeenAt: job.lastSeenAt,
        refs: refsOf(job),
        survivor: job.id === survivor.id,
      })),
    });
  }

  const duplicateJobs = groups.reduce((sum, group) => sum + group.count, 0);
  const matchRows = groups.reduce(
    (sum, group) => sum + group.jobs.reduce((n, job) => n + job.refs.matches, 0),
    0,
  );
  const applicationRows = groups.reduce(
    (sum, group) => sum + group.jobs.reduce((n, job) => n + job.refs.applications, 0),
    0,
  );

  const report = {
    generatedAt: new Date().toISOString(),
    database: target,
    totals: {
      jobs: totalJobs,
      fingerprinted,
      groups: groups.length,
      jobsInGroups: duplicateJobs,
      excessRows: duplicateJobs - groups.length,
      matchRowsOnDuplicates: matchRows,
      applicationRowsOnDuplicates: applicationRows,
      crossSourceGroups: crossSourceRows.length,
      crossSourceJobs: crossSourceRows.reduce((sum, row) => sum + Number(row.count), 0),
    },
    groups,
  };

  if (apply && groups.length) {
    const backupPath = backupBeforeApply();
    const plans = [];
    for (const group of groups) plans.push(await buildPlan(group));
    const summary = await applyPlans(plans);
    const integrity = await integrityReport(target);
    const remaining = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) AS "count" FROM (
        SELECT "sourceId", "fingerprint"
        FROM "Job"
        WHERE "fingerprint" IS NOT NULL AND "fingerprint" <> ''
        GROUP BY "sourceId", "fingerprint"
        HAVING COUNT(*) > 1
      ) AS "duplicates"
    `);
    report.cleanup = {
      backupPath,
      summary,
      integrity,
      skipped: plans
        .filter((plan) => plan.skipped)
        .map((plan) => ({
          sourceId: plan.group.sourceId,
          title: plan.group.title,
          company: plan.group.company,
          reason: plan.skipped,
        })),
      remainingGroups: Number(remaining[0] ? remaining[0].count : 0),
      remainingJobs: await prisma.job.count(),
    };
    if (
      integrity &&
      (integrity.integrity !== 'ok' || integrity.foreignKeyViolations > 0)
    ) {
      process.stderr.write(
        '[duplicates] warning: post-cleanup integrity check did not pass; restore the backup before continuing.\n',
      );
    }
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('Duplicate report (read-only)');
  console.log('============================');
  if (target.kind === 'sqlite') {
    console.log(`Database: ${target.file}`);
  } else {
    console.log(`Database: ${target.target}`);
  }
  console.log(
    `Jobs: ${totalJobs} (${fingerprinted} with a fingerprint) · ` +
      `duplicate groups: ${groups.length} · rows in groups: ${duplicateJobs} ` +
      `(excess: ${duplicateJobs - groups.length})`,
  );
  console.log(
    `Cross-source groups: ${crossSourceRows.length} · ` +
      `match rows on duplicate jobs: ${matchRows} · application rows: ${applicationRows}`,
  );

  if (!groups.length) {
    console.log('\nNo duplicate fingerprints found.');
    return;
  }

  const shown = groups.slice(0, limit);
  console.log(`\nShowing ${shown.length} of ${groups.length} groups.`);
  shown.forEach((group, index) => {
    console.log(
      `\n[${index + 1}] ${group.sourceId} · ${group.count} copies · ` +
        `"${short(group.title, 60)}" @ ${short(group.company, 30)}`,
    );
    const ordered = [...group.jobs].sort((a, b) => Number(b.survivor) - Number(a.survivor));
    for (const job of ordered) {
      const label = job.survivor ? 'keep' : 'drop';
      console.log(
        `    ${label}  ${job.sourceJobId || job.id}  ` +
          `refs m=${job.refs.matches} a=${job.refs.applications} n=${job.refs.notifications} ` +
          `s=${job.refs.skills}  status=${job.status}  firstSeen=${new Date(job.firstSeenAt).toISOString().slice(0, 10)}`,
      );
    }
  });

  if (report.cleanup) {
    const { summary, backupPath, integrity, skipped, remainingGroups } = report.cleanup;
    console.log('\nCleanup applied');
    console.log('---------------');
    console.log(`Backup: ${backupPath || '(none reported)'}`);
    console.log(
      `Groups merged: ${summary.groupsMerged} · skipped: ${summary.groupsSkipped} · ` +
        `jobs deleted: ${summary.jobsDeleted}`,
    );
    console.log(
      `References — matches moved/deleted: ${summary.matchesMoved}/${summary.matchesDeleted} · ` +
        `applications moved: ${summary.applicationsMoved} · ` +
        `notifications moved/deleted: ${summary.notificationsMoved}/${summary.notificationsDeleted} · ` +
        `skills moved/deleted: ${summary.skillsMoved}/${summary.skillsDeleted}`,
    );
    if (integrity) {
      console.log(
        `Integrity: ${integrity.integrity} · foreign-key violations: ${integrity.foreignKeyViolations}`,
      );
    }
    if (skipped.length) {
      console.log('\nSkipped groups (need a human decision):');
      for (const item of skipped) {
        console.log(`  - ${item.sourceId} · "${short(item.title, 50)}" @ ${item.company}: ${item.reason}`);
      }
    }
    console.log(`Remaining duplicate groups: ${remainingGroups}`);
    console.log('\nRestore from the backup above if the result is not what you expected.');
    return;
  }

  console.log(
    '\nNo rows were changed. Re-run with --apply to merge safe groups after a verified backup; ' +
      'groups where a user has applications on more than one copy are skipped.',
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    process.stderr.write(`[duplicates] ${error instanceof Error ? error.message : String(error)}\n`);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
