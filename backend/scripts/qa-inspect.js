const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRaw`
    SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
  `;
  console.log('TABLES:');
  console.log(tables.map(r => r.name).join('\n'));

  const counts = {};
  for (const t of tables.map(r => r.name)) {
    try {
      const c = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "${t}"`);
      counts[t] = c[0]?.c ?? 0;
    } catch (e) {}
  }
  console.log('\nCOUNTS:');
  for (const [k, v] of Object.entries(counts)) {
    console.log(k + ': ' + v);
  }

  console.log('\nJOB SOURCES:');
  const sources = await prisma.jobSource.findMany({ select: { id: true, name: true, status: true, lastSuccessfulRun: true, lastFailedRun: true, consecutiveFailures: true, healthScore: true } });
  for (const s of sources) {
    console.log(`${s.id} | ${s.name} | ${s.status} | failures=${s.consecutiveFailures} | health=${s.healthScore} | lastOK=${s.lastSuccessfulRun} | lastFAIL=${s.lastFailedRun}`);
  }

  console.log('\nUSERS:');
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true, status: true, notificationsPaused: true, matchThreshold: true } });
  for (const u of users) {
    console.log(`${u.id} | ${u.email} | ${u.role} | ${u.status} | paused=${u.notificationsPaused} | threshold=${u.matchThreshold}`);
  }

  console.log('\nJOBS (sample 5):');
  const jobs = await prisma.job.findMany({ take: 5, select: { id: true, title: true, company: true, location: true, status: true, sourceId: true, sourceJobId: true, postedDate: true, firstSeenAt: true, lastSeenAt: true, workPlace: true } });
  for (const j of jobs) {
    console.log(`${j.id} | ${j.title} | ${j.company} | ${j.location} | ${j.status} | src=${j.sourceId}:${j.sourceJobId} | posted=${j.postedDate} | first=${j.firstSeenAt} | last=${j.lastSeenAt} | wp=${j.workPlace}`);
  }

  console.log('\nNOTIFICATIONS (sample 5):');
  const notifs = await prisma.notification.findMany({ take: 5, select: { id: true, userId: true, jobId: true, channel: true, status: true, score: true, sentAt: true } });
  for (const n of notifs) {
    console.log(`${n.id} | user=${n.userId} | job=${n.jobId} | ${n.channel} | ${n.status} | score=${n.score} | sent=${n.sentAt}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
