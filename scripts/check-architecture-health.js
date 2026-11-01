#!/usr/bin/env node
/**
 * Deterministic architecture-health checks for JobHunter.
 *
 * This is intentionally small and dependency-free. It compares the claims in
 * the architecture docs with the source tree. It does not try to prove that a
 * diagram is correct; it catches the most common drift signals:
 *
 *   - structural counts (Prisma models, modules, adapters, routes)
 *   - documented behaviour that no longer exists in code
 *   - missing machine-readable architecture sources
 *   - traceability entries that no longer match the test tree
 *   - stale implementation-status notes
 *
 * Usage:
 *   node scripts/check-architecture-health.js
 *   node scripts/check-architecture-health.js --strict   # exit 1 on failures
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');
const results = [];

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const pass = (id, detail) => results.push({ id, status: 'PASS', detail });
const fail = (id, detail) => results.push({ id, status: 'FAIL', detail });
const warn = (id, detail) => results.push({ id, status: 'WARN', detail });

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'coverage', '.turbo', 'uploads', 'backups',
]);

function walk(relDir, filter, out = []) {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(relDir, entry.name), filter, out);
    } else if (filter(entry.name, path.join(relDir, entry.name))) {
      out.push(path.join(relDir, entry.name).replace(/\\/g, '/'));
    }
  }
  return out;
}

function gitDate(relPath) {
  try {
    const value = execSync(`git log -1 --format=%ct -- "${relPath}"`, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    return Number(value) || 0;
  } catch {
    return 0;
  }
}

function gitDirty(relPath) {
  try {
    return execSync(`git status --porcelain -- "${relPath}"`, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim().length > 0;
  } catch {
    return false;
  }
}

function lastModified(relPath) {
  return gitDirty(relPath) ? Math.floor(Date.now() / 1000) : gitDate(relPath);
}

function countTestDeclarations(text) {
  return (text.match(/^\s*(it|test)(\.each)?\s*\(/gm) || []).length;
}

// ── 1. Prisma model count ─────────────────────────────────────────────
const schema = read('backend/prisma/schema.prisma');
const models = [...schema.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]);
const overview = read('docs/architecture-overview.md');
const modelClaim =
  overview.match(/Prisma models\s*\|\s*(\d+)/i) || overview.match(/(\d+)\s+Prisma models/i);
if (!modelClaim) {
  fail('models.count', 'architecture-overview.md does not state a Prisma model count');
} else if (Number(modelClaim[1]) !== models.length) {
  fail(
    'models.count',
    `architecture-overview.md says ${modelClaim[1]} models; schema.prisma defines ${models.length}: ${models.join(', ')}`,
  );
} else {
  pass('models.count', `${models.length} Prisma models match the document`);
}

// ── 2. Backend module coverage ────────────────────────────────────────
const modulesDir = path.join(ROOT, 'backend/src/modules');
const moduleNames = fs.readdirSync(modulesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => fs.readdirSync(path.join(modulesDir, name)).some((f) => f.endsWith('.module.ts')));
const missingModules = moduleNames.filter((name) => !overview.includes('`' + name + '`'));
if (missingModules.length) {
  fail('modules.coverage', `modules missing from the overview map: ${missingModules.join(', ')}`);
} else {
  pass('modules.coverage', `${moduleNames.length} NestJS modules are represented in the overview`);
}

// ── 3. Source / adapter inventory ─────────────────────────────────────
const sourceConfigs = JSON.parse(read('backend/src/modules/sources/source-configs.json'));
const webSourceIds = (sourceConfigs.sources || []).map((s) => s.id);
const telegramConfig = read('backend/src/modules/sources/adapters/telegram-channels.config.ts');
const telegramIds = [...telegramConfig.matchAll(/sourceId:\s*'([^']+)'/g)].map((m) => m[1]);
const adapterFiles = fs.readdirSync(path.join(ROOT, 'backend/src/modules/sources/adapters'))
  .filter((f) => f.endsWith('.adapter.ts') && f !== 'job-source.adapter.ts');
const totalEndpoints = webSourceIds.length + telegramIds.length;

const staleAdapterNames = [
  'Himalayas', 'WorkingNomads', 'JobsFitty', 'LinkedIn', 'FindWork', 'WeWorkRemotely',
  'HaHuJobs', 'RelieWeb',
].filter((name) => overview.includes(name));
if (staleAdapterNames.length) {
  fail(
    'sources.inventory',
    `overview lists adapters that do not exist: ${staleAdapterNames.join(', ')}. ` +
      `Actual: ${webSourceIds.length} web sources + ${telegramIds.length} Telegram channels = ${totalEndpoints} endpoints, ` +
      `${adapterFiles.length} adapter classes.`,
  );
}
if (/\b15\s+(?:source\s+)?adapters?\b/i.test(overview) && totalEndpoints !== 15) {
  fail(
    'sources.count',
    `overview claims 15 adapters; actual is ${webSourceIds.length} web sources + ${telegramIds.length} Telegram channels ` +
      `(${adapterFiles.length} adapter classes).`,
  );
} else if (!staleAdapterNames.length) {
  pass('sources.inventory', `${webSourceIds.length} web sources + ${telegramIds.length} Telegram channels`);
}

// ── 4. Cross-source fingerprint deduplication ─────────────────────────
const sourcesService = read('backend/src/modules/sources/sources.service.ts');
const dedupDocumentedAsMissing = /cross-source[\s\S]{0,200}not implemented/i.test(overview);
const claimsCrossSource = /cross-source[\s\S]{0,160}fingerprint/i.test(overview);
const hasFingerprintFilter = /where:\s*\{[^}]*fingerprint/s.test(sourcesService);
if (dedupDocumentedAsMissing) {
  pass('dedup.fingerprint', 'cross-source fingerprint grouping is documented as not implemented');
} else if (claimsCrossSource && !hasFingerprintFilter) {
  fail(
    'dedup.fingerprint',
    'overview claims cross-source fingerprint deduplication, but sources.service.ts stores the fingerprint ' +
      'without querying it; dedupeWithinRun only groups sourceJobId within one run.',
  );
} else if (!claimsCrossSource) {
  warn('dedup.fingerprint', 'the cross-source deduplication claim is no longer present; confirm intent before removing it');
} else {
  pass('dedup.fingerprint', 'cross-source fingerprint filtering is implemented');
}

const hasSameSourceGuard = /where:\s*\{\s*sourceId\s*,\s*fingerprint\s*:/.test(sourcesService);
if (hasSameSourceGuard && /fingerprint level/i.test(overview)) {
  pass('dedup.sameSource', 'ingestion refreshes an existing row when (sourceId, fingerprint) matches');
} else {
  fail(
    'dedup.sameSource',
    'the overview documents within-source fingerprint deduplication, but sources.service.ts has no ' +
      '(sourceId, fingerprint) lookup before create.',
  );
}

// ── 5. Matching reference parity ──────────────────────────────────────
const matchingRef = read('docs/matching-engine-reference.md');
const engine = read('backend/src/modules/matching/matching-engine.ts');
const lifecycleTasks = read('backend/src/modules/lifecycle/lifecycle.tasks.ts');

if (/0\.65/.test(matchingRef) && /:\s*0\.4\b/.test(engine)) {
  fail('matching.neutral', 'matching reference says empty skills score 0.65; engine uses 0.4');
} else {
  pass('matching.neutral', 'empty-skill neutral value is aligned');
}

if (!/eligible|ineligible/i.test(matchingRef) && /eligible\s*=/.test(engine)) {
  fail(
    'matching.eligibility',
    'engine has hard eligibility filters (score 0) and returns eligible/ineligibleReasons; the reference does not document them',
  );
} else {
  pass('matching.eligibility', 'eligibility contract is documented');
}

if (!/excludeEntryLevel/.test(matchingRef) && /excludeEntryLevel/.test(engine)) {
  fail('matching.inputs', 'ProfileInput.excludeEntryLevel is implemented but missing from the reference');
} else {
  pass('matching.inputs', 'ProfileInput fields are documented');
}

if (/every 30m/i.test(overview) && /MATCH_CYCLE_INTERVAL \(default 10m\)/.test(lifecycleTasks)) {
  fail('matching.schedule', 'overview says matching runs every 30m; MATCH_CYCLE_INTERVAL defaults to 10m');
} else {
  pass('matching.schedule', 'matching schedule is aligned');
}

if (/Exact substring match/i.test(matchingRef) && /containsPhrase\(/.test(engine)) {
  fail('matching.role', 'reference says role matching is exact substring; engine uses token-aware phrase matching');
} else {
  pass('matching.role', 'role-matching semantics are aligned');
}

// ── 6. Traceability matrix ────────────────────────────────────────────
const traceability = read('docs/traceability.md');
const specs = walk('backend/src', (name) => name.endsWith('.spec.ts'));
const missingSpecs = specs.filter((spec) => !traceability.includes(path.basename(spec)));
if (missingSpecs.length) {
  fail('traceability.specs', `spec files missing from traceability.md: ${missingSpecs.join(', ')}`);
} else {
  pass('traceability.specs', `${specs.length} spec files are referenced`);
}

const declarations = specs.reduce((sum, spec) => sum + countTestDeclarations(read(spec)), 0);
const testIndex = traceability.match(
  /<!-- BEGIN GENERATED TEST INDEX -->([\s\S]*?)<!-- END GENERATED TEST INDEX -->/,
);
const testIndexText = testIndex ? testIndex[1] : traceability;
const totalClaim = testIndexText.match(/\*\*Total\*\*\s*\|\s*\*\*(\d+)\*\*/);
if (totalClaim && Number(totalClaim[1]) !== declarations) {
  fail(
    'traceability.total',
    `traceability.md says ${totalClaim[1]} test declarations; ${specs.length} spec files contain ${declarations} it/test declarations ` +
      '(parameterized cases expand further, so use CI output for the executed count).',
  );
} else if (!totalClaim) {
  fail('traceability.total', 'traceability.md has no generated test-index total');
} else {
  pass('traceability.total', `test declaration count matches (${declarations})`);
}

// Hand-written counts elsewhere in the prose drift the moment a test is added,
// because the generator only rewrites its own marker blocks.
const staleDeclarationClaims = [];
for (const file of ['README.md', 'docs/architecture-overview.md']) {
  const prose = read(file).replace(/<!-- BEGIN GENERATED[\s\S]*?END GENERATED [\s\S]*?-->/g, '');
  for (const match of prose.matchAll(/(\d+)\s+test declarations?/g)) {
    if (Number(match[1]) !== declarations) staleDeclarationClaims.push(`${file}: ${match[1]}`);
  }
}
if (staleDeclarationClaims.length) {
  fail(
    'traceability.proseCounts',
    `hand-written test-declaration counts disagree with the ${declarations} in the specs: ` +
      `${staleDeclarationClaims.join('; ')}.`,
  );
} else {
  pass('traceability.proseCounts', 'no hand-written declaration counts contradict the specs');
}

const claimedRows = [...testIndexText.matchAll(/\|\s*([\w.-]+\.spec\.ts)\s*\|\s*~?(\d+)\s*\|/g)];
const mismatchedRows = [];
for (const row of claimedRows) {
  const [, file, claimed] = row;
  const actualSpec = specs.find((spec) => path.basename(spec) === file);
  if (!actualSpec) continue;
  const actual = countTestDeclarations(read(actualSpec));
  if (actual !== Number(claimed)) mismatchedRows.push(`${file} claims ${claimed}, has ${actual}`);
}
if (mismatchedRows.length) {
  fail('traceability.counts', `per-file test counts are stale: ${mismatchedRows.join('; ')}`);
} else {
  pass('traceability.counts', 'per-file test counts are aligned');
}

// ── 7. Plan status ────────────────────────────────────────────────────
const plan = read('docs/plans/category-aware-collection.md');
const categoryImplementationExists =
  exists('backend/src/modules/sources/categories/category-mapper.ts') &&
  /model\s+SourceRunCategory/.test(schema);
if (/Status:\s*plan \(not yet implemented\)/i.test(plan) && categoryImplementationExists) {
  fail(
    'plan.status',
    'category-aware-collection.md says "not yet implemented", but category-mapper.ts, category-taxonomy.json, ' +
      'SourceRunCategory, FAST/DEEP modes and related tests exist.',
  );
} else {
  pass('plan.status', 'plan status is aligned');
}

// ── 8. Deployment topology consistency ───────────────────────────────
const readme = read('README.md');
const compose = read('docker-compose.yml');
const runbook = read('docs/ops-runbook.md');
const entrypoint = read('docker-entrypoint.sh');
const dbProvider = (schema.match(/datasource\s+db\s*\{[\s\S]*?provider\s*=\s*"([^"]+)"/) || [])[1] || 'unknown';
const composeUsesSqlite = /DATABASE_URL=file:/.test(compose);
const readmeClaimsPostgresProduction = /PostgreSQL\s*\(production\)/i.test(readme);
const docsAgreeOnSqlite = /SQLite/i.test(readme) && /SQLite/i.test(overview) && /SQLite/i.test(runbook);
if (dbProvider !== 'sqlite' || !composeUsesSqlite || readmeClaimsPostgresProduction || !docsAgreeOnSqlite) {
  fail(
    'deployment.db',
    `SQLite must be the authoritative production database (schema provider: ${dbProvider}, ` +
      `compose file: ${composeUsesSqlite ? 'file:' : 'not file:'}, README PostgreSQL claim: ${readmeClaimsPostgresProduction}).`,
  );
} else {
  pass('deployment.db', 'SQLite is the documented and configured production database');
}

const safeMigrateScript = exists('backend/scripts/db-migrate-safe.js');
const entrypointUsesSafeScript = /db-migrate-safe\.js/.test(entrypoint);
const entrypointUsesDbPush = /prisma\s+db\s+push/.test(entrypoint);
const backendDockerfileUsesDbPush =
  exists('backend/Dockerfile') && /prisma\s+db\s+push/.test(read('backend/Dockerfile'));
const runbookUsesSafeScript = /db-migrate-safe\.js/.test(runbook);
if (
  !safeMigrateScript ||
  !entrypointUsesSafeScript ||
  entrypointUsesDbPush ||
  backendDockerfileUsesDbPush ||
  !runbookUsesSafeScript
) {
  fail(
    'deployment.migrations',
    `safe migration path is incomplete (script: ${safeMigrateScript}, entrypoint references it: ${entrypointUsesSafeScript}, ` +
      `entrypoint db push: ${entrypointUsesDbPush}, backend/Dockerfile db push: ${backendDockerfileUsesDbPush}, ` +
      `runbook references it: ${runbookUsesSafeScript}).`,
  );
} else {
  pass('deployment.migrations', 'entrypoint, Dockerfile, and runbook use the guarded migration script');
}

// The developer launcher must follow the same database decision as production:
// no mandatory Postgres, and no `migrate dev` rewriting committed history.
const devLauncher = exists('dev.sh') ? read('dev.sh') : '';
const devLauncherRunsMigrateDev = /prisma\s+migrate\s+dev/.test(devLauncher);
const devLauncherHandlesSqlite = /sqlite/i.test(devLauncher) && /provider/i.test(devLauncher);
const devLauncherAppliesMigrations = /prisma\s+migrate\s+deploy/.test(devLauncher);
// The watchdog must probe a path that answers, wait out compilation, tolerate a
// slow probe, and take the whole process tree — each of these was a real bug.
const devLauncherProbesHealthPaths =
  /BACKEND_HEALTH_URL=.*\/api\/health/.test(devLauncher) && /FRONTEND_HEALTH_URL=.*\/login/.test(devLauncher);
const devLauncherHasBootGrace = /BOOT_GRACE=\d+/.test(devLauncher) && /STRIKE_LIMIT=\d+/.test(devLauncher);
const devLauncherKillsProcessTree = /taskkill\s+\/\/PID/.test(devLauncher) && /kill_tree\s+/.test(devLauncher);
const devLauncherProblems = [
  devLauncherRunsMigrateDev && 'runs `prisma migrate dev`',
  !devLauncherHandlesSqlite && 'is not SQLite-aware',
  !devLauncherAppliesMigrations && 'does not apply committed migrations',
  !devLauncherProbesHealthPaths && 'does not probe a real health path',
  !devLauncherHasBootGrace && 'has no boot grace or strike tolerance',
  !devLauncherKillsProcessTree && 'cannot kill a service process tree',
].filter(Boolean);
if (!devLauncher) {
  fail('deployment.devlauncher', 'dev.sh is missing; the documented developer entrypoint does not exist');
} else if (devLauncherProblems.length) {
  fail('deployment.devlauncher', `dev.sh is out of step with the documented setup: ${devLauncherProblems.join('; ')}.`);
} else {
  pass('deployment.devlauncher', 'dev.sh respects the schema provider, applies committed migrations, and probes real health paths');
}

const migrationFiles = walk('backend/prisma/migrations', (name) => name === 'migration.sql');
if (!migrationFiles.length) {
  fail('db.migrations', 'no migration.sql files exist under backend/prisma/migrations');
} else {
  pass('db.migrations', `${migrationFiles.length} migration(s) available to deploy`);
}

// ── 9. Machine-readable diagram/model source ─────────────────────────
const diagramFiles = walk('.', (name) => /\.(dot|dsl|mmd|puml)$/i.test(name));
if (diagramFiles.length) {
  pass('model.source', `${diagramFiles.length} machine-readable architecture source file(s)`);
} else if (exists('docs/architecture-facts.json')) {
  pass(
    'model.source',
    'no diagram source, but docs/architecture-facts.json provides a generated machine-readable inventory',
  );
} else {
  warn(
    'model.source',
    'no .dot/.dsl/.mmd/.puml architecture source or generated facts JSON exists; diagrams are ASCII inside Markdown.',
  );
}

// ── 10. Docs freshness ────────────────────────────────────────────────
const docPaths = [
  'docs/architecture-overview.md',
  'docs/matching-engine-reference.md',
  'docs/traceability.md',
  'docs/ops-runbook.md',
  'docs/plans/category-aware-collection.md',
  'README.md',
];
const latestCode = Math.max(
  lastModified('backend/src'),
  lastModified('backend/prisma/schema.prisma'),
  lastModified('frontend/app'),
);
const latestDoc = Math.max(...docPaths.map(lastModified));
if (latestCode && latestDoc && latestCode > latestDoc) {
  warn(
    'docs.freshness',
    `latest code commit (${new Date(latestCode * 1000).toISOString().slice(0, 10)}) is newer than the latest architecture-doc commit ` +
      `(${new Date(latestDoc * 1000).toISOString().slice(0, 10)}).`,
  );
} else {
  pass('docs.freshness', 'architecture docs are at least as new as the inspected code');
}

// ── 11. Route count claims ────────────────────────────────────────────
const pages = walk('frontend/app', (name) => name === 'page.tsx').length;
if (/20\+\s*(?:frontend\s+)?routes/i.test(readme) && pages < 20) {
  warn('routes.count', `README says 20+ routes; frontend/app contains ${pages} page.tsx routes`);
} else {
  pass('routes.count', `${pages} frontend page routes`);
}

// ── 12. Generated facts freshness ─────────────────────────────────────
try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-architecture-facts.js'), '--check'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pass('facts.current', 'generated facts match the source tree');
} catch (error) {
  const output = `${error.stdout || ''}${error.stderr || ''}`.trim().split('\n').slice(0, 4).join(' | ');
  fail('facts.current', `generated facts are stale; run npm run facts:generate. ${output}`);
}

// ── 13. Generated traceability freshness ─────────────────────────────
try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-traceability.js'), '--check'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pass('traceability.matrix', 'requirement→test matrix matches the SRS and the spec tree');
} catch (error) {
  const output = `${error.stdout || ''}${error.stderr || ''}`.trim().split('\n').slice(0, 5).join(' | ');
  fail('traceability.matrix', `traceability is stale or its mappings no longer resolve; run npm run traceability:generate. ${output}`);
}

// ── 14. Hand-typed coverage claims ───────────────────────────────────
{
  const strip = (text) => text.replace(/<!-- BEGIN GENERATED[\s\S]*?END GENERATED [\s\S]*?-->/g, '');
  const offenders = [];
  for (const file of ['docs/traceability.md', 'README.md', 'docs/architecture-overview.md']) {
    if (!exists(file)) continue;
    const prose = strip(read(file));
    for (const m of prose.matchAll(/(\d+)\s*\/\s*(\d+)[^\n]{0,40}coverage|coverage[^\n]{0,20}?(\d{1,3})%/gi)) {
      offenders.push(`${file}: ${m[0].trim()}`);
    }
  }
  if (offenders.length) {
    fail('traceability.proseCoverage', `hand-written coverage claims must come from the generated block — ${offenders.join('; ')}`);
  } else {
    pass('traceability.proseCoverage', 'no hand-typed coverage percentages outside the generated blocks');
  }
}

// ── Output ────────────────────────────────────────────────────────────
console.log('Architecture health checks');
console.log('=========================');
for (const result of results) {
  console.log(`[${result.status}] ${result.id} — ${result.detail}`);
}
const failures = results.filter((r) => r.status === 'FAIL');
const warnings = results.filter((r) => r.status === 'WARN');
console.log('');
console.log(
  `Summary: ${results.length - failures.length - warnings.length} passed, ` +
    `${failures.length} failed, ${warnings.length} warnings.`,
);
if (STRICT && failures.length) {
  console.error('Strict mode: architecture drift detected.');
  process.exit(1);
}
