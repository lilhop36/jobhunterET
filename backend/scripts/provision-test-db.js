#!/usr/bin/env node
/**
 * Provision a disposable SQLite database: guard → schema → demo seed.
 *
 * Two consumers, on purpose:
 *   • `scripts/run-tests.js` calls it before jest, because the integration suite
 *     asserts against real seeded rows;
 *   • the CI runtime-verification gate (`Gate 6`) calls it before Playwright, so
 *     the browser checks run against exactly the same data the unit tests see.
 *
 * Safety: the destructive `db push --force-reset` is refused unless DATABASE_URL
 * is a SQLite `file:` URL, so a PostgreSQL or production URL can never be wiped
 * by a test/QA run.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const backendRoot = path.join(__dirname, '..');
const isWindows = process.platform === 'win32';
const npx = isWindows ? 'npx.cmd' : 'npx';

function run(command, args, extraEnv = {}) {
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
}

/** Returns the DATABASE_URL the database was provisioned at. */
function provision() {
  const databaseUrl = process.env.DATABASE_URL || 'file:./test.db';

  if (!databaseUrl.startsWith('file:')) {
    console.error(
      `Refusing to provision: DATABASE_URL must be a SQLite file: URL (got "${databaseUrl}").\n` +
        'Unset DATABASE_URL to use the disposable ./prisma/test.db, or set it to another file: URL.',
    );
    process.exit(1);
  }

  process.env.DATABASE_URL = databaseUrl;
  console.log(`[db] Provisioning disposable database at ${databaseUrl}`);
  run(npx, ['prisma', 'db', 'push', '--skip-generate', '--force-reset']);

  console.log('[db] Seeding demo data');
  run(npx, ['ts-node', 'prisma/seed.ts'], { SEED_DEMO_DATA: 'true' });

  return databaseUrl;
}

module.exports = { provision, run, npx, backendRoot };

if (require.main === module) {
  provision();
}
