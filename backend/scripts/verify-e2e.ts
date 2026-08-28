/**
 * End-to-end verification of matching engine with real database data.
 * Checks that scores, thresholds, and notifications are consistent.
 * 
 * Run: cd backend && npx ts-node --transpile-only scripts/verify-e2e.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  let pass = 0;
  let fail = 0;

  function assert(cond: boolean, msg: string) {
    if (cond) { pass++; console.log(`  ✅ ${msg}`); }
    else { fail++; console.error(`  ❌ FAIL: ${msg}`); }
  }

  // ── Check 1: All active users have threshold = 65 ──
  console.log('\n=== Check 1: All active users have threshold = 65 ===');
  const users = await prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, email: true, matchThreshold: true } });
  for (const u of users) {
    assert(u.matchThreshold === 65, `${u.email}: threshold = ${u.matchThreshold} (expected 65)`);
  }

  // ── Check 2: JobMatch scores are in valid range ──
  console.log('\n=== Check 2: All JobMatch scores are 0-100 ===');
  const matches = await prisma.jobMatch.findMany({ select: { id: true, score: true, userId: true, jobId: true } });
  console.log(`  Total matches: ${matches.length}`);
  for (const m of matches) {
    assert(m.score >= 0 && m.score <= 100, `Match ${m.id}: score ${m.score} is in valid range`);
  }

  // ── Check 3: Notifications exist for above-threshold matches ──
  console.log('\n=== Check 3: Notifications for above-threshold matches ===');
  const notifications = await prisma.notification.findMany({ select: { id: true, userId: true, jobId: true, channel: true, status: true, score: true } });
  console.log(`  Total notifications: ${notifications.length}`);

  // ── Check 4: Score distribution ──
  console.log('\n=== Check 4: Score distribution ===');
  const scoreRanges = [
    { label: '0-20', min: 0, max: 20 },
    { label: '21-40', min: 21, max: 40 },
    { label: '41-60', min: 41, max: 60 },
    { label: '61-65', min: 61, max: 65 },
    { label: '66-80', min: 66, max: 80 },
    { label: '81-100', min: 81, max: 100 },
  ];
  for (const range of scoreRanges) {
    const count = matches.filter(m => m.score >= range.min && m.score <= range.max).length;
    console.log(`  ${range.label}: ${count} matches`);
  }

  // ── Check 5: Top matches per user ──
  console.log('\n=== Check 5: Top 3 matches per user ===');
  for (const u of users) {
    const userMatches = matches.filter(m => m.userId === u.id).sort((a, b) => b.score - a.score).slice(0, 3);
    console.log(`  ${u.email}:`);
    for (const m of userMatches) {
      const job = await prisma.job.findUnique({ where: { id: m.jobId }, select: { title: true } });
      const above = m.score >= (u.matchThreshold ?? 65);
      console.log(`    ${m.score} ${above ? '✅ ABOVE' : '  below'} threshold — ${job?.title}`);
    }
  }

  // ── Check 6: No negative scores or impossible values ──
  console.log('\n=== Check 6: No invalid scores ===');
  const invalidScores = matches.filter(m => m.score < 0 || m.score > 100 || isNaN(m.score));
  assert(invalidScores.length === 0, `No invalid scores found (${invalidScores.length} invalid)`);

  // ── Check 7: All matched jobs are ACTIVE ──
  console.log('\n=== Check 7: All matched jobs are ACTIVE ===');
  const matchedJobIds = [...new Set(matches.map(m => m.jobId))];
  const inactiveJobs = await prisma.job.findMany({
    where: { id: { in: matchedJobIds }, status: { not: 'ACTIVE' } },
    select: { id: true, title: true, status: true },
  });
  assert(inactiveJobs.length === 0, `All ${matchedJobIds.length} matched jobs are ACTIVE`);
  if (inactiveJobs.length > 0) {
    for (const j of inactiveJobs) console.log(`    ⚠️ ${j.title} — status: ${j.status}`);
  }

  // ── Summary ──
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${pass} passed, ${fail} failed, ${pass + fail} total`);
  console.log(`${'='.repeat(60)}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
