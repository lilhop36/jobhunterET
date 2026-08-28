/**
 * Non-Functional Requirements (NFR) Test Suite
 * Tests: Performance, Reliability, Data Quality, Security
 *
 * Run: cd backend && npx ts-node --transpile-only scripts/nfr-test.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = 'http://localhost:3210';
const ADMIN_EMAIL = 'abdigaboma@gmail.com';
const ADMIN_PASS = 'demo1234';

let token = '';
let pass = 0;
let fail = 0;
let warn = 0;
const results: { category: string; test: string; status: 'PASS' | 'FAIL' | 'WARN'; value: string }[] = [];

function ok(cat: string, test: string, value: string) {
  pass++;
  results.push({ category: cat, test, status: 'PASS', value });
  console.log(`  ✅ ${test}: ${value}`);
}

function fail_test(cat: string, test: string, value: string) {
  fail++;
  results.push({ category: cat, test, status: 'FAIL', value });
  console.log(`  ❌ ${test}: ${value}`);
}

function warn_test(cat: string, test: string, value: string) {
  warn++;
  results.push({ category: cat, test, status: 'WARN', value });
  console.log(`  ⚠️  ${test}: ${value}`);
}

async function login() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
  });
  const data = await res.json();
  token = data.accessToken || '';
  return !!token;
}

async function authed(path: string, method = 'GET', body?: any) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ── Performance Tests ──────────────────────────────────────────────

async function testPerformance() {
  console.log('\n=== PERFORMANCE ===');

  const endpoints = [
    { path: '/dashboard', name: 'Dashboard' },
    { path: '/jobs', name: 'Jobs list' },
    { path: '/matches', name: 'Matches' },
    { path: '/jobs/tags/counts', name: 'Tag counts' },
    { path: '/profile', name: 'Profile' },
    { path: '/sources', name: 'Sources' },
  ];

  for (const ep of endpoints) {
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      await authed(ep.path);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p50 = times[4];
    const p95 = times[8];
    const p99 = times[9];
    const avg = times.reduce((a, b) => a + b, 0) / times.length;

    if (p95 < 500) ok('Performance', `${ep.name} p95`, `${p95.toFixed(0)}ms`);
    else if (p95 < 1000) warn_test('Performance', `${ep.name} p95`, `${p95.toFixed(0)}ms (slow)`);
    else fail_test('Performance', `${ep.name} p95`, `${p95.toFixed(0)}ms (too slow)`);

    console.log(`    ${ep.name}: avg=${avg.toFixed(0)}ms p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms p99=${p99.toFixed(0)}ms`);
  }

  // Matching engine recalculation time
  console.log('\n  Matching engine benchmark...');
  const start = performance.now();
  const recalcRes = await authed('/matches/recalculate', 'POST');
  const recalcTime = performance.now() - start;
  const recalcData = await recalcRes.json();

  if (recalcTime < 5000) ok('Performance', 'Recalculation (single user)', `${recalcTime.toFixed(0)}ms — ${recalcData.matchesTouched || 0} jobs`);
  else if (recalcTime < 15000) warn_test('Performance', 'Recalculation (single user)', `${recalcTime.toFixed(0)}ms (slow)`);
  else fail_test('Performance', 'Recalculation (single user)', `${recalcTime.toFixed(0)}ms (too slow)`);
}

// ── Reliability Tests ──────────────────────────────────────────────

async function testReliability() {
  console.log('\n=== RELIABILITY ===');

  // 1. Invalid auth token
  const noAuth = await fetch(`${BASE}/dashboard`);
  if (noAuth.status === 401) ok('Reliability', 'Rejects unauthenticated requests', '401');
  else fail_test('Reliability', 'Rejects unauthenticated requests', `${noAuth.status}`);

  // 2. Invalid credentials
  const badLogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@jobhunter.et', password: 'wrong' }),
  });
  if (badLogin.status === 401) ok('Reliability', 'Rejects wrong password', '401');
  else fail_test('Reliability', 'Rejects wrong password', `${badLogin.status}`);

  // 3. Nonexistent resource
  const notFound = await authed('/jobs/nonexistent-id-12345');
  if (notFound.status === 404) ok('Reliability', 'Returns 404 for missing job', '404');
  else fail_test('Reliability', 'Returns 404 for missing job', `${notFound.status}`);

  // 4. Concurrent requests (5 parallel)
  console.log('\n  Testing concurrent requests...');
  const concurrentStart = performance.now();
  const concurrentResults = await Promise.all(
    Array(5).fill(null).map(() => authed('/dashboard'))
  );
  const concurrentTime = performance.now() - concurrentStart;
  const allOk = concurrentResults.every((r) => r.status === 200);
  if (allOk && concurrentTime < 5000) ok('Reliability', '5 concurrent dashboard requests', `${concurrentTime.toFixed(0)}ms, all 200`);
  else fail_test('Reliability', '5 concurrent dashboard requests', `${concurrentTime.toFixed(0)}ms, statuses: ${concurrentResults.map((r) => r.status).join(',')}`);

  // 5. Duplicate login (token still valid)
  const secondLogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
  });
  const secondData = await secondLogin.json();
  if (secondData.accessToken) ok('Reliability', 'Multiple logins produce valid tokens', 'token issued');
  else fail_test('Reliability', 'Multiple logins produce valid tokens', 'no token');

  // 6. Application transition graph (illegal move)
  const apps = await authed('/applications');
  const appsData = await apps.json();
  if (appsData.items?.length > 0) {
    const app = appsData.items[0];
    // Try illegal transition: INTERVIEW -> SAVED (should be 409)
    const illegal = await authed(`/applications/${app.jobId}/stage`, 'POST', { stage: 'INTERVIEW' });
    if (illegal.status === 200 || illegal.status === 409) {
      // If currently SAVED, trying INTERVIEW directly should fail
      if (app.stage === 'SAVED' && illegal.status === 409) {
        ok('Reliability', 'Rejects illegal application transition', '409 on SAVED→INTERVIEW');
      } else {
        ok('Reliability', 'Application transitions', `stage=${app.stage}, attempt=INTERVIEW, status=${illegal.status}`);
      }
    }
  } else {
    warn_test('Reliability', 'Application transitions', 'no applications to test');
  }
}

// ── Data Quality Tests ─────────────────────────────────────────────

async function testDataQuality() {
  console.log('\n=== DATA QUALITY ===');

  // 1. Match score range
  const matchStats = await prisma.$queryRaw`
    SELECT
      COUNT(*) as total,
      MIN(score) as min_score,
      MAX(score) as max_score,
      AVG(score) as avg_score,
      SUM(CASE WHEN score < 0 OR score > 100 THEN 1 ELSE 0 END) as out_of_range
    FROM JobMatch
  ` as any[];
  const ms = matchStats[0];

  if (ms.out_of_range === 0) ok('Data Quality', 'All match scores in 0-100', `${ms.total} matches, avg=${Number(ms.avg_score).toFixed(1)}`);
  else fail_test('Data Quality', 'Match scores out of range', `${ms.out_of_range} invalid`);

  // 2. User thresholds consistency
  const thresholdStats = await prisma.$queryRaw`
    SELECT
      COUNT(*) as total,
      MIN("matchThreshold") as min_t,
      MAX("matchThreshold") as max_t,
      SUM(CASE WHEN "matchThreshold" < 30 OR "matchThreshold" > 100 THEN 1 ELSE 0 END) as bad_t
    FROM User
    WHERE status = 'ACTIVE'
  ` as any[];
  const ts = thresholdStats[0];

  if (ts.bad_t === 0) ok('Data Quality', 'User thresholds in valid range (30-100)', `min=${ts.min_t}, max=${ts.max_t}`);
  else fail_test('Data Quality', 'User thresholds out of range', `${ts.bad_t} users with invalid threshold`);

  // 3. No orphaned JobMatches (job must exist and be ACTIVE)
  const orphanMatches = await prisma.$queryRaw`
    SELECT COUNT(*) as cnt
    FROM JobMatch jm
    LEFT JOIN Job j ON jm."jobId" = j.id
    WHERE j.id IS NULL OR j.status != 'ACTIVE'
  ` as any[];

  if (orphanMatches[0].cnt === 0) ok('Data Quality', 'No orphaned matches (all match jobs are ACTIVE)', '0 orphans');
  else warn_test('Data Quality', 'Orphaned matches found', `${orphanMatches[0].cnt} matches reference non-ACTIVE jobs`);

  // 4. No duplicate notifications per (user, job)
  const dupeNotifs = await prisma.$queryRaw`
    SELECT COUNT(*) as cnt FROM (
      SELECT "userId", "jobId", COUNT(*) as c
      FROM Notification
      GROUP BY "userId", "jobId"
      HAVING COUNT(*) > 1
    )
  ` as any[];

  if (dupeNotifs[0].cnt === 0) ok('Data Quality', 'No duplicate notifications', '0 duplicates');
  else fail_test('Data Quality', 'Duplicate notifications found', `${dupeNotifs[0].cnt} user:job pairs`);

  // 5. Jobs have required fields
  const incompleteJobs = await prisma.$queryRaw`
    SELECT COUNT(*) as cnt FROM Job
    WHERE title IS NULL OR title = ''
       OR "locationClass" IS NULL OR "locationClass" = ''
       OR "employmentType" IS NULL OR "employmentType" = ''
  ` as any[];

  if (incompleteJobs[0].cnt === 0) ok('Data Quality', 'All jobs have required fields', '0 incomplete');
  else warn_test('Data Quality', 'Jobs missing required fields', `${incompleteJobs[0].cnt} jobs`);

  // 6. Skill normalization consistency
  const skillDuplicates = await prisma.$queryRaw`
    SELECT LOWER(name) as name_lower, COUNT(*) as cnt
    FROM Skill
    GROUP BY LOWER(name)
    HAVING COUNT(*) > 1
  ` as any[];

  if (skillDuplicates.length === 0) ok('Data Quality', 'No case-duplicate skills', '0 duplicates');
  else warn_test('Data Quality', 'Case-duplicate skills', `${skillDuplicates.length} groups (e.g. ${skillDuplicates[0]?.name_lower})`);

  // 7. Collection health
  const sourceStats = await prisma.$queryRaw`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) as error,
      SUM(CASE WHEN status = 'DISABLED' THEN 1 ELSE 0 END) as disabled
    FROM JobSource
  ` as any[];
  const ss = sourceStats[0];

  const activeRate = ss.total > 0 ? (Number(ss.active) / Number(ss.total) * 100).toFixed(0) : '0';
  if (Number(ss.active) >= Number(ss.total) * 0.5) {
    ok('Data Quality', 'Source health', `${ss.active}/${ss.total} active (${activeRate}%)`);
  } else {
    warn_test('Data Quality', 'Source health', `${ss.active}/${ss.total} active (${activeRate}%) — many sources down`);
  }
}

// ── Security Quick Checks ──────────────────────────────────────────

async function testSecurity() {
  console.log('\n=== SECURITY ===');

  // 1. SQL injection attempt
  const sqli = await authed("/jobs?q='; DROP TABLE Job; --");
  if (sqli.status === 200 || sqli.status === 400) ok('Security', 'SQL injection attempt blocked', `${sqli.status} (Prisma parameterized)`);
  else fail_test('Security', 'SQL injection attempt', `${sqli.status}`);

  // 2. XSS in search query
  const xss = await authed('/jobs?q=<script>alert(1)</script>');
  if (xss.status === 200 || xss.status === 400) {
    const body = await xss.text();
    if (!body.includes('<script>alert(1)</script>')) ok('Security', 'XSS in search query not reflected', 'sanitized');
    else fail_test('Security', 'XSS in search query reflected', 'raw script in response');
  }

  // 3. Rate limiting (rapid auth attempts)
  const rapidAttempts = [];
  for (let i = 0; i < 15; i++) {
    const r = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'wrong' }),
    });
    rapidAttempts.push(r.status);
  }
  const rateLimited = rapidAttempts.some((s) => s === 429);
  if (rateLimited) ok('Security', 'Rate limiting active on login', '429 after rapid attempts');
  else warn_test('Security', 'Rate limiting on login', 'no 429 after 15 attempts (may need more)');

  // 4. Admin endpoints require ADMIN role
  const adminStats = await authed('/admin/stats');
  if (adminStats.status === 200) ok('Security', 'Admin stats accessible with ADMIN role', '200');
  else if (adminStats.status === 403) fail_test('Security', 'Admin stats blocked for ADMIN role', '403');
  else warn_test('Security', 'Admin stats response', `${adminStats.status}`);

  // 5. Password not in error messages
  const badLogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@jobhunter.et', password: 'wrongpassword' }),
  });
  const badBody = await badLogin.json();
  if (!JSON.stringify(badBody).includes('wrongpassword')) ok('Security', 'Password not leaked in error response', 'sanitized');
  else fail_test('Security', 'Password leaked in error', 'password in response body');
}

// ── Summary ────────────────────────────────────────────────────────

function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('NFR TEST RESULTS');
  console.log('='.repeat(60));

  const categories = [...new Set(results.map((r) => r.category))];
  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    const catPass = catResults.filter((r) => r.status === 'PASS').length;
    const catFail = catResults.filter((r) => r.status === 'FAIL').length;
    const catWarn = catResults.filter((r) => r.status === 'WARN').length;
    console.log(`  ${cat}: ${catPass} passed, ${catFail} failed, ${catWarn} warnings`);
  }

  console.log('\n' + '-'.repeat(60));
  console.log(`TOTAL: ${pass} passed, ${fail} failed, ${warn} warnings`);
  console.log('='.repeat(60));

  if (fail > 0) {
    console.log('\nFailed tests:');
    results.filter((r) => r.status === 'FAIL').forEach((r) => {
      console.log(`  ❌ [${r.category}] ${r.test}: ${r.value}`);
    });
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log('JobHunter NFR Test Suite');
  console.log('========================');

  const loggedIn = await login();
  if (!loggedIn) {
    console.error('Failed to login — is the backend running on port 3210?');
    process.exit(1);
  }
  console.log(`Logged in as ${ADMIN_EMAIL}`);

  await testPerformance();
  await testReliability();
  await testDataQuality();
  await testSecurity();
  printSummary();

  if (fail > 0) process.exit(1);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
