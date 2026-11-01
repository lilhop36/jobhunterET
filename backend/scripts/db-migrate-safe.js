#!/usr/bin/env node
/**
 * Safe database migration runner for JobHunter.
 *
 * JobHunter ET runs on a single SQLite file. This script replaces the old
 * `prisma db push --accept-data-loss` boot step with a guarded migration:
 *
 *   1. Take a consistent snapshot (VACUUM INTO) and verify the gzip backup.
 *   2. Detect whether the live schema already matches schema.prisma.
 *   3. Never apply a migration that deletes rows or tables without operator
 *      consent: every migration is first applied to the snapshot copy, and
 *      the copy must still match the target schema with identical row counts.
 *   4. Refuse on drift, failed migrations, or a non-empty database without
 *      migration history. Only an explicit `--baseline` records existing
 *      migrations as applied, and only when the schema already matches.
 *
 * Usage (from backend/):
 *   node scripts/db-migrate-safe.js                 # backup, verify, migrate
 *   node scripts/db-migrate-safe.js --baseline      # record existing migrations
 *   node scripts/db-migrate-safe.js --dry-run       # verify on a copy only
 *   node scripts/db-migrate-safe.js --backup-only   # print backup path, no DB writes
 *
 * Environment:
 *   DATABASE_URL          required (file:./dev.db or file:/app/data/prod.db)
 *   SKIP_DB_MIGRATIONS=1  skip entirely (container escape hatch)
 *
 * Exit codes: 0 = safe/up to date, 1 = refused or failed (original untouched).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const BACKEND = path.resolve(__dirname, '..');
const PRISMA_DIR = path.join(BACKEND, 'prisma');
const SCHEMA = path.join(PRISMA_DIR, 'schema.prisma');
const MIGRATIONS_DIR = path.join(PRISMA_DIR, 'migrations');
const PRISMA_CLI = path.join(BACKEND, 'node_modules', 'prisma', 'build', 'index.js');
const WORK_DIR = path.join(BACKEND, '.migration-work');
const DEFAULT_BACKUP_DIR = path.join(BACKEND, 'backups', 'pre-migration');
const SQLITE_MAGIC = 'SQLite format 3';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const option = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] || null;
};

const BASELINE = has('--baseline');
const DRY_RUN = has('--dry-run');
const BACKUP_ONLY = has('--backup-only');
const ALLOW_NON_SQLITE = has('--allow-non-sqlite');
const ALLOW_ROW_COUNT_CHANGES = has('--allow-row-count-changes');

if (has('--help') || has('-h')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').trim());
  process.exit(0);
}

const quiet = BACKUP_ONLY;
function log(message) {
  (quiet ? process.stderr : process.stdout).write(`[db-migrate] ${message}\n`);
}
function die(message, detail, { touched = false } = {}) {
  log(`ERROR: ${message}`);
  if (detail) {
    const text = String(detail).trim();
    if (text) log(text.split('\n').slice(0, 40).join('\n'));
  }
  log(
    touched
      ? 'The live database may have been modified. Restore from the verified backup before retrying.'
      : 'No changes were written to the live database.',
  );
  process.exit(1);
}

function loadEnvFile() {
  if (process.env.DATABASE_URL) return;
  const envPath = path.join(BACKEND, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[2].replace(/^['"]|['"]$/g, '');
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

function fileUrl(absPath) {
  return 'file:' + absPath.replace(/\\/g, '/');
}

/** Prisma resolves relative SQLite paths against the schema directory. */
function resolveSqlitePath(url) {
  if (!url || !url.startsWith('file:')) return null;
  const raw = url.slice('file:'.length).split('?')[0];
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(PRISMA_DIR, raw);
}

/** Keep backups on the persistent volume when the database lives there. */
function backupDirFor(dbPath) {
  if (process.env.PRE_MIGRATION_BACKUP_DIR) {
    return path.resolve(BACKEND, process.env.PRE_MIGRATION_BACKUP_DIR);
  }
  const absolute = path.resolve(dbPath);
  const relative = path.relative(BACKEND, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return path.join(path.dirname(absolute), 'backups', 'pre-migration');
  }
  return DEFAULT_BACKUP_DIR;
}

function localMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(MIGRATIONS_DIR, entry.name, 'migration.sql')))
    .map((entry) => entry.name)
    .sort();
}

function runPrisma(args, url, { allowFailure = false } = {}) {
  if (!fs.existsSync(PRISMA_CLI)) {
    die(`Prisma CLI not found at ${PRISMA_CLI}. Run npm ci in backend/ first.`);
  }
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });
  if (result.error) die(`Could not run Prisma: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    die(`Prisma ${args.join(' ')} failed (exit ${result.status}).`, `${result.stdout || ''}\n${result.stderr || ''}`);
  }
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

/** Returns { matches, status, sql }. status 2 means the schemas differ. */
function schemaDiff(url) {
  const result = runPrisma(
    [
      'migrate',
      'diff',
      '--from-url',
      url,
      '--to-schema-datamodel',
      SCHEMA,
      '--exit-code',
      '--script',
    ],
    url,
    { allowFailure: true },
  );
  if (result.status === 0) return { matches: true, status: 0, sql: '' };
  if (result.status === 2) return { matches: false, status: 2, sql: result.stdout };
  die('Could not compare the database with schema.prisma.', `${result.stdout}\n${result.stderr}`);
}

function prismaClient(url) {
  // Required lazily so --help / SKIP_DB_MIGRATIONS work without a generated client.
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient({ datasources: { db: { url } } });
}

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

async function readMigrationState(url) {
  const client = prismaClient(url);
  try {
    try {
      const rows = await client.$queryRawUnsafe(
        'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at',
      );
      return {
        hasTable: true,
        applied: rows.filter((row) => row.finished_at).map((row) => row.migration_name),
        // A row with rolled_back_at set is a migration Prisma already gave up
        // on. It is not applied, so it belongs in `pending`, but it is not a
        // half-applied mystery either — the schema tells us which it is.
        rolledBack: rows.filter((row) => !row.finished_at && row.rolled_back_at).map((row) => row.migration_name),
        // Neither finished nor rolled back: a migration interrupted mid-run.
        // Those need a human, because the schema may be partway changed.
        inFlight: rows.filter((row) => !row.finished_at && !row.rolled_back_at).map((row) => row.migration_name),
      };
    } catch {
      return { hasTable: false, applied: [], rolledBack: [], inFlight: [] };
    }
  } finally {
    await client.$disconnect();
  }
}

async function snapshotCounts(url) {
  const client = prismaClient(url);
  try {
    const tables = await client.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const counts = {};
    for (const table of tables) {
      if (table.name === '_prisma_migrations') continue;
      const rows = await client.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM ${quoteIdent(table.name)}`);
      counts[table.name] = Number(rows[0].count);
    }
    let integrity = 'unknown';
    try {
      const result = await client.$queryRawUnsafe('PRAGMA integrity_check');
      integrity = result.map((row) => row.integrity_check).join('; ');
    } catch {
      integrity = 'unavailable';
    }
    return { counts, integrity };
  } finally {
    await client.$disconnect();
  }
}

async function vacuumInto(url, destination) {
  const client = prismaClient(url);
  const quoted = destination.replace(/'/g, "''");
  try {
    await client.$executeRawUnsafe(`VACUUM INTO '${quoted}'`);
  } finally {
    await client.$disconnect();
  }
}

async function makeConsistentCopy(url, dbPath, label) {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const destination = path.join(WORK_DIR, `${label}-${Date.now()}-${process.pid}.db`);
  if (fs.existsSync(destination)) fs.unlinkSync(destination);
  try {
    await vacuumInto(url, destination);
  } catch (error) {
    // A locked database cannot be copied safely through VACUUM. Fall back to
    // a raw file copy plus WAL/SHM so we still have a restore point, but say so.
    log(`WARNING: VACUUM INTO failed (${error.message.split('\n')[0]}); using raw file copy.`);
    fs.copyFileSync(dbPath, destination);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(dbPath + suffix)) fs.copyFileSync(dbPath + suffix, destination + suffix);
    }
  }
  return destination;
}

function assertSqlite(filePath, description) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    const read = fs.readSync(fd, header, 0, 16, 0);
    if (read < 16 || !header.toString('latin1').startsWith(SQLITE_MAGIC)) {
      die(`${description} is not a valid SQLite database.`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

async function backup(url, dbPath, dir) {
  const copy = await makeConsistentCopy(url, dbPath, 'snapshot');
  assertSqlite(copy, 'Database snapshot');

  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(dir, `jobhunter_${stamp}.db.gz`);
  const compressed = zlib.gzipSync(fs.readFileSync(copy), { level: 9 });
  fs.writeFileSync(destination, compressed);

  // Verify the archive can be read and still contains a SQLite database.
  const restored = zlib.gunzipSync(fs.readFileSync(destination));
  if (!restored.subarray(0, 16).toString('latin1').startsWith(SQLITE_MAGIC)) {
    die(`Backup verification failed for ${destination}.`);
  }
  log(`Verified backup: ${destination} (${(compressed.length / 1024 / 1024).toFixed(1)} MB)`);
  return { backupPath: destination, copy };
}

function compareCounts(before, after, context, { touched = false } = {}) {
  if (before.integrity !== 'ok' && before.integrity !== 'unavailable') {
    die(`Source database integrity check failed (${before.integrity}).`);
  }
  const disappeared = Object.keys(before.counts).filter((table) => !(table in after.counts));
  if (disappeared.length) {
    die(`${context}: table(s) would be removed: ${disappeared.join(', ')}.`, null, { touched });
  }
  if (ALLOW_ROW_COUNT_CHANGES) return;
  const changed = Object.keys(before.counts)
    .filter((table) => after.counts[table] !== before.counts[table])
    .map((table) => `${table} ${before.counts[table]} -> ${after.counts[table]}`);
  if (changed.length) {
    die(
      `${context}: row counts would change: ${changed.join('; ')}.`,
      'Use --allow-row-count-changes only after reviewing the data impact.',
      { touched },
    );
  }
}

/**
 * Record migrations as applied without touching the schema.
 *
 * A rolled-back history row blocks `migrate resolve --applied` for the same
 * name, and `migrate deploy` would re-run SQL the database already contains
 * (P3018 "duplicate column"). Only rows that never finished are cleared, and
 * truly in-flight migrations are rejected earlier in main(), so what remains is
 * bookkeeping: migration files and user data are untouched.
 */
async function resolveApplied(url, migrations) {
  const client = prismaClient(url);
  try {
    for (const name of migrations) {
      const cleared = await client.$executeRawUnsafe(
        'DELETE FROM _prisma_migrations WHERE migration_name = ? AND finished_at IS NULL',
        name,
      );
      if (cleared) log(`Cleared ${cleared} rolled-back history row(s) for ${name}.`);
      log(`Recording migration as already applied: ${name}`);
      const result = runPrisma(['migrate', 'resolve', '--applied', name, '--schema', SCHEMA], url, {
        allowFailure: true,
      });
      if (result.status !== 0) {
        die(`Could not baseline ${name}.`, `${result.stdout}\n${result.stderr}`, { touched: true });
      }
    }
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  if (process.env.SKIP_DB_MIGRATIONS === '1') {
    log('SKIP_DB_MIGRATIONS=1 — skipping database migration.');
    return;
  }

  loadEnvFile();
  const configuredUrl = process.env.DATABASE_URL;
  if (!configuredUrl) die('DATABASE_URL is not set.');
  const dbPath = resolveSqlitePath(configuredUrl);

  if (!dbPath) {
    if (!ALLOW_NON_SQLITE) {
      die(
        'DATABASE_URL is not a SQLite file. This project is SQLite-first and the safe backup/row-count checks only cover SQLite.',
        'Pass --allow-non-sqlite to run prisma migrate deploy without those checks.',
      );
    }
    log('Non-SQLite DATABASE_URL: running prisma migrate deploy without local backup checks.');
    runPrisma(['migrate', 'deploy', '--schema', SCHEMA], configuredUrl);
    return;
  }

  // Prisma resolves a relative `file:./dev.db` against the schema for the
  // datasource but against the working directory for `--from-url`. Pass an
  // absolute URL everywhere so both agree.
  const url = fileUrl(path.resolve(dbPath));
  const exists = fs.existsSync(dbPath);
  const size = exists ? fs.statSync(dbPath).size : 0;

  if (BACKUP_ONLY) {
    if (!exists || size === 0) die(`Database file not found or empty: ${dbPath}`);
    const dir = path.resolve(BACKEND, option('--backup-dir') || backupDirFor(dbPath));
    const { backupPath, copy } = await backup(url, dbPath, dir);
    if (fs.existsSync(copy)) fs.unlinkSync(copy);
    process.stdout.write(backupPath + '\n');
    return;
  }

  const local = localMigrations();
  if (!local.length) die('No migration.sql files found under prisma/migrations.');

  if (!exists || size === 0) {
    log(`Fresh database at ${dbPath}; applying ${local.length} migration(s).`);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    runPrisma(['migrate', 'deploy', '--schema', SCHEMA], url);
    const diff = schemaDiff(url);
    if (!diff.matches) die('Migration finished but the schema still differs from schema.prisma.', diff.sql);
    log('Fresh database migrated and verified.');
    return;
  }

  log(`Database: ${dbPath}`);
  const state = await readMigrationState(url);
  if (state.inFlight.length) {
    die(
      `Unfinished migration(s) recorded: ${state.inFlight.join(', ')}. ` +
        'They started but were neither finished nor rolled back, so the schema may be partway changed. ' +
        'Inspect them, then resolve with `prisma migrate resolve` before running this script.',
    );
  }
  if (state.rolledBack.length) {
    log(
      `Rolled-back migration(s) in the history: ${state.rolledBack.join(', ')}. ` +
        'They count as not applied; --baseline re-records them once the schema is confirmed to match.',
    );
  }
  const pending = local.filter((name) => !state.applied.includes(name));
  const diff = schemaDiff(url);

  if (diff.matches) {
    if (!pending.length) {
      log('Database schema matches schema.prisma and all migrations are recorded. Nothing to do.');
      return;
    }
    if (state.applied.length > 0 && !BASELINE) {
      die(
        `The schema already matches schema.prisma, but ${pending.length} migration(s) are not recorded: ${pending.join(', ')}.`,
        'Review the migrations, then re-run with --baseline to record them as applied. No schema changes will be made.',
      );
    }
    if (state.applied.length === 0) {
      log('Existing database matches schema.prisma but has no migration history; baselining all migrations.');
    } else {
      log(`--baseline requested; recording ${pending.length} migration(s) as applied.`);
    }
    const { backupPath, copy } = await backup(url, dbPath, backupDirFor(dbPath));
    if (DRY_RUN) {
      const reRecord = state.rolledBack.filter((name) => pending.includes(name));
      log(
        `--dry-run: would record ${pending.join(', ')} as applied` +
          (reRecord.length ? ` (re-recording ${reRecord.join(', ')} from rolled-back rows)` : '') +
          `. Backup: ${backupPath}`,
      );
      fs.unlinkSync(copy);
      return;
    }
    await resolveApplied(url, pending);
    const after = schemaDiff(url);
    if (!after.matches) {
      die('Baseline changed the schema unexpectedly; restore from the backup.', after.sql, { touched: true });
    }
    fs.unlinkSync(copy);
    log('Baseline complete; schema unchanged.');
    return;
  }

  // The live schema differs from schema.prisma. That is either a normal
  // pending migration or drift. Prove it on a copy before touching the live DB.
  if (BASELINE) {
    die(
      '--baseline refused: the database schema does not match schema.prisma.',
      'Baseline only records migrations that are already reflected in the schema. Inspect the diff first.',
    );
  }
  if (state.applied.length === 0) {
    die(
      'The database is non-empty, has no migration history, and does not match schema.prisma.',
      'Refusing to modify it. Create a baseline migration that captures the existing schema, or restore from backup.\n' + diff.sql,
    );
  }

  log(`Schema differs from schema.prisma; pending migration(s): ${pending.join(', ') || '(none recorded)'}.`);
  const { backupPath, copy } = await backup(url, dbPath, backupDirFor(dbPath));
  const before = await snapshotCounts(url);

  log('Testing migrations against the verified copy...');
  const copyUrl = fileUrl(copy);
  const deployCopy = runPrisma(['migrate', 'deploy', '--schema', SCHEMA], copyUrl, { allowFailure: true });
  if (deployCopy.status !== 0) {
    die('Migration failed on the copy; the live database was not touched.', `${deployCopy.stdout}\n${deployCopy.stderr}`);
  }

  const copyDiff = schemaDiff(copyUrl);
  if (!copyDiff.matches) {
    die(
      'After migrating the copy, its schema still differs from schema.prisma. This is drift, not a pending migration.',
      copyDiff.sql,
    );
  }

  const after = await snapshotCounts(copyUrl);
  compareCounts(before, after, 'Copy migration');

  if (DRY_RUN) {
    log(`--dry-run: migration is safe. Backup: ${backupPath}`);
    fs.unlinkSync(copy);
    return;
  }

  log('Copy verification passed; applying to the live database...');
  const deployLive = runPrisma(['migrate', 'deploy', '--schema', SCHEMA], url, { allowFailure: true });
  if (deployLive.status !== 0) {
    die(
      'Migration failed on the live database. Restore from the verified backup.',
      `${deployLive.stdout}\n${deployLive.stderr}`,
      { touched: true },
    );
  }

  const liveDiff = schemaDiff(url);
  if (!liveDiff.matches) {
    die('Live migration finished but the schema still differs from schema.prisma.', liveDiff.sql, { touched: true });
  }
  const liveAfter = await snapshotCounts(url);
  compareCounts(before, liveAfter, 'Live migration', { touched: true });

  fs.unlinkSync(copy);
  log(`Migration complete. Rows preserved; backup kept at ${backupPath}.`);
}

main().catch((error) => {
  die(error && error.message ? error.message : String(error));
});
