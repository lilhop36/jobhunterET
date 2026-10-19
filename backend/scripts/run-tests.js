#!/usr/bin/env node
/**
 * Test runner for the backend.
 *
 * The integration suite asserts against a real (seeded) database, so the suite
 * needs a database that is created from scratch on every run. This script:
 *
 *   1. points DATABASE_URL at a disposable SQLite file (or honours an explicit
 *      DATABASE_URL that is already set),
 *   2. recreates the schema with `prisma db push --force-reset`,
 *   3. seeds the demo data used by the integration assertions, and
 *   4. runs jest, forwarding any extra arguments.
 *
 * Safety: the destructive reset is refused unless DATABASE_URL is a SQLite
 * file URL, so a PostgreSQL/production URL can never be wiped by running tests.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const backendRoot = path.join(__dirname, '..');

const databaseUrl = process.env.DATABASE_URL || 'file:./test.db';

if (!databaseUrl.startsWith('file:')) {
  console.error(
    `Refusing to run tests: DATABASE_URL must be a SQLite file: URL (got "${databaseUrl}").\n` +
      'Unset DATABASE_URL to use the disposable ./prisma/test.db, or set it to another file: URL.',
  );
  process.exit(1);
}

process.env.DATABASE_URL = databaseUrl;

const isWindows = process.platform === 'win32';
const npx = isWindows ? 'npx.cmd' : 'npx';

const run = (command, args, extraEnv = {}) => {
  const result = spawnSync(command, args, {
    cwd: backendRoot,
    stdio: 'inherit',
    // Windows resolves .cmd shims through cmd.exe; without a shell Node
    // rejects the spawn with EINVAL. Linux CI spawns npx directly.
    shell: isWindows,
    env: { ...process.env, ...extraEnv },
  });

  if (result.error) {
    console.error(`Failed to run ${command}:`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status === null ? 1 : result.status);
  }
};

console.log(`[test] Provisioning disposable database at ${databaseUrl}`);
run(npx, ['prisma', 'db', 'push', '--skip-generate', '--force-reset']);

console.log('[test] Seeding demo data');
run(npx, ['ts-node', 'prisma/seed.ts'], { SEED_DEMO_DATA: 'true' });

// Coverage is opt-in (`npm run test:coverage`): the bundled test-exclude
// version used by jest 29 is incompatible with Node 26's promisify signature,
// so coverage collection only runs on the supported Node 22 toolchain used by
// CI. The plain test run works on every supported runtime.
const passthrough = process.argv.slice(2);
const withCoverage = passthrough.includes('--coverage');
const jestArgs = [
  'jest',
  '--forceExit',
  ...(withCoverage ? ['--coverage'] : []),
  ...passthrough.filter((arg) => arg !== '--coverage'),
];

console.log(`[test] Running jest${withCoverage ? ' with coverage' : ''}`);
run(npx, jestArgs);
