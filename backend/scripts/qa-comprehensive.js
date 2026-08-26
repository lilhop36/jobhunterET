const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== COMPREHENSIVE QA EVIDENCE ===\n');

  // 1. JOB COUNTS BY STATUS
  console.log('--- JOB STATUS BREAKDOWN ---');
  const statusCounts = await prisma.job.groupBy({
    by: ['status'],
    _count: { status: true },
  });
  for (const s of statusCounts) {
    console.log(`  ${s.status}: ${s._count.status}`);
  }

  // 2. SOURCE BREAKDOWN
  console.log('\n--- SOURCE BREAKDOWN ---');
  const sources = await prisma.jobSource.findMany({
    orderBy: { id: 'asc' },
    include: {
      _count: { select: { jobs: true, runs: true } },
    },
  });
  for (const s of sources) {
    const active = await prisma.job.count({ where: { sourceId: s.id, status: 'ACTIVE' } });
    const removed = await prisma.job.count({ where: { sourceId: s.id, status: 'REMOVED' } });
    console.log(`${s.id}: active=${active} removed=${removed} runs=${s._count.runs} health=${s.healthScore} lastOK=${s.lastSuccessfulRun ? 'YES' : 'NO'} | ${s.lastError || ''}`);
  }

  // 3. MATCH SCORE DISTRIBUTION
  console.log('\n--- MATCH SCORE DISTRIBUTION ---');
  const allMatches = await prisma.jobMatch.findMany({
    select: { score: true, userId: true },
  });
  const scoreRanges = { '0-25': 0, '26-50': 0, '51-75': 0, '76-100': 0 };
  for (const m of allMatches) {
    if (m.score <= 25) scoreRanges['0-25']++;
    else if (m.score <= 50) scoreRanges['26-50']++;
    else if (m.score <= 75) scoreRanges['51-75']++;
    else scoreRanges['76-100']++;
  }
  for (const [range, count] of Object.entries(scoreRanges)) {
    console.log(`  ${range}: ${count}`);
  }

  // 4. NOTIFICATION STATUS
  console.log('\n--- NOTIFICATIONS ---');
  const notifCount = await prisma.notification.count();
  const notifByChannel = await prisma.notification.groupBy({
    by: ['channel'],
    _count: { channel: true },
  });
  console.log('Total notifications:', notifCount);
  for (const n of notifByChannel) {
    console.log(`  ${n.channel}: ${n._count.channel}`);
  }

  // 5. MATCH CYCLE HISTORY
  console.log('\n--- MATCH CYCLES (last 5) ---');
  const cycles = await prisma.matchCycle.findMany({
    take: 5,
    orderBy: { startedAt: 'desc' },
  });
  for (const c of cycles) {
    console.log(`${c.startedAt} | jobs=${c.jobsEvaluated} users=${c.usersProcessed} created=${c.matchesCreated} above=${c.aboveThreshold} sent=${c.notificationsSent} inbox=${c.toInbox} errors=${c.errors}`);
  }

  // 6. CANDIDATE PROFILES
  console.log('\n--- CANDIDATE PROFILES ---');
  const profiles = await prisma.candidateProfile.findMany({
    include: { user: { select: { email: true } } },
  });
  for (const p of profiles) {
    const skills = await prisma.candidateSkill.findMany({
      where: { userId: p.userId },
      include: { skill: true },
    });
    const roles = await prisma.targetRole.findMany({ where: { userId: p.userId } });
    const locs = await prisma.locationPreference.findMany({ where: { userId: p.userId } });
    console.log(`\n  User: ${p.user.email}`);
    console.log(`  Title: ${p.title} | Years: ${p.years} | Remote: ${p.remote}`);
    console.log(`  Skills: ${skills.map(s => s.skill.name).join(', ') || 'NONE'}`);
    console.log(`  Roles: ${roles.map(r => r.role + '(' + r.priority + ')').join(', ') || 'NONE'}`);
    console.log(`  Locations: ${locs.map(l => l.region + '(' + l.tier + ')').join(', ') || 'NONE'}`);
  }

  // 7. FRESHNESS CHECK
  console.log('\n--- FRESHNESS CHECK ---');
  const recentJobs = await prisma.job.findMany({
    where: { status: 'ACTIVE' },
    take: 10,
    orderBy: { postedDate: 'desc' },
    select: { title: true, postedDate: true, firstSeenAt: true, lastSeenAt: true },
  });
  for (const j of recentJobs) {
    const ageHours = (Date.now() - new Date(j.postedDate).getTime()) / (1000 * 60 * 60);
    const discoveryDelay = (new Date(j.firstSeenAt).getTime() - new Date(j.postedDate).getTime()) / (1000 * 60 * 60);
    console.log(`  ${j.title} | posted=${j.postedDate.toISOString().slice(0, 16)} | age=${ageHours.toFixed(1)}h | discoveryDelay=${discoveryDelay.toFixed(1)}h`);
  }

  // 8. TELEGRAM STATUS
  console.log('\n--- TELEGRAM ---');
  const tgLinks = await prisma.telegramLink.findMany();
  console.log('Telegram links:', tgLinks.length);
  for (const t of tgLinks) {
    console.log(`  userId=${t.userId} chatId=${t.chatId} status=${t.status}`);
  }

  // 9. WORKER / SCHEDULER CHECK
  console.log('\n--- SCHEDULER EVIDENCE ---');
  const recentRuns = await prisma.sourceRun.findMany({
    take: 20,
    orderBy: { startedAt: 'desc' },
    select: { sourceId: true, status: true, startedAt: true, jobsFetched: true, jobsCreated: true },
  });
  const recentTimes = recentRuns.map(r => r.startedAt.getTime());
  const minTime = Math.min(...recentTimes);
  const maxTime = Math.max(...recentTimes);
  const spanHours = (maxTime - minTime) / (1000 * 60 * 60);
  console.log(`Last ${recentRuns.length} runs span: ${spanHours.toFixed(1)} hours`);
  console.log('Latest run:', recentRuns[0]?.sourceId, recentRuns[0]?.startedAt);

  // 10. FAILED SOURCES
  console.log('\n--- FAILED/DISABLED SOURCES ---');
  const failedSources = await prisma.jobSource.findMany({
    where: {
      OR: [
        { status: 'DISABLED' },
        { status: 'FAIL' },
        { lastError: { not: null } },
      ],
    },
  });
  for (const s of failedSources) {
    console.log(`${s.id}: status=${s.status} lastError=${s.lastError || 'NONE'} consecutiveFailures=${s.consecutiveFailures}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
