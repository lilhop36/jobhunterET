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
const { provision, run, npx } = require('./provision-test-db');

// The guard that refuses to reset anything but a SQLite `file:` URL, the schema
// push and the demo seed all live in provision-test-db.js — the same script the
// CI runtime-verification gate runs, so tests and browser checks share one dataset.
provision();

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
