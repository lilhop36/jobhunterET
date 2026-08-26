const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== TESTING SOURCE COLLECTION WITH REAL REQUESTS ===\n');

  // Get all active sources
  const sources = await prisma.jobSource.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { id: 'asc' },
  });

  console.log('Active sources:', sources.length);
  for (const s of sources) {
    console.log(`  ${s.id}: ${s.name} (${s.type}) | health=${s.healthScore}`);
  }

  // Check recent runs for each source
  console.log('\n=== RECENT RUNS (last 3 per source) ===');
  for (const s of sources) {
    const runs = await prisma.sourceRun.findMany({
      where: { sourceId: s.id },
      orderBy: { startedAt: 'desc' },
      take: 3,
    });
    console.log(`\n${s.id}:`);
    for (const r of runs) {
      console.log(`  ${r.startedAt} | ${r.status} | fetched=${r.jobsFetched} created=${r.jobsCreated} dupes=${r.duplicates} err=${r.errors} | ${r.errorMessage || ''}`);
    }
  }

  // Count jobs by source and status
  console.log('\n=== JOB COUNTS BY SOURCE ===');
  for (const s of sources) {
    const total = await prisma.job.count({ where: { sourceId: s.id } });
    const active = await prisma.job.count({ where: { sourceId: s.id, status: 'ACTIVE' } });
    const removed = await prisma.job.count({ where: { sourceId: s.id, status: 'REMOVED' } });
    console.log(`${s.id}: total=${total} active=${active} removed=${removed}`);
  }

  // Check for duplicate sourceJobIds within same source
  console.log('\n=== DUPLICATE SOURCE JOB IDs ===');
  const dupes = await prisma.$queryRaw`
    SELECT sourceId, sourceJobId, COUNT(*) as cnt
    FROM Job
    GROUP BY sourceId, sourceJobId
    HAVING cnt > 1
    LIMIT 20
  `;
  if (dupes.length === 0) {
    console.log('No duplicate (sourceId, sourceJobId) pairs found.');
  } else {
    for (const d of dupes) {
      console.log(`  ${d.sourceId}:${d.sourceJobId} = ${d.cnt} rows`);
    }
  }

  // Check jobs with null/empty critical fields
  console.log('\n=== DATA QUALITY ISSUES ===');
  const allJobs = await prisma.job.findMany({ select: { title: true, company: true, url: true, sourceJobId: true, location: true } });
  let nullTitle = 0, nullCompany = 0, nullUrl = 0, nullSourceJobId = 0, nullLocation = 0;
  for (const j of allJobs) {
    if (!j.title) nullTitle++;
    if (!j.company) nullCompany++;
    if (!j.url) nullUrl++;
    if (!j.sourceJobId) nullSourceJobId++;
    if (!j.location) nullLocation++;
  }
  console.log('Jobs with null/empty title:', nullTitle);
  console.log('Jobs with null/empty company:', nullCompany);
  console.log('Jobs with null/empty url:', nullUrl);
  console.log('Jobs with null sourceJobId:', nullSourceJobId);
  console.log('Jobs with null/empty location:', nullLocation);

  // Check fingerprint duplicates
  console.log('\n=== FINGERPRINT DUPLICATES ===');
  const fpDupes = await prisma.$queryRaw`
    SELECT fingerprint, COUNT(*) as cnt
    FROM Job
    WHERE fingerprint IS NOT NULL
    GROUP BY fingerprint
    HAVING cnt > 1
    LIMIT 10
  `;
  if (fpDupes.length === 0) {
    console.log('No fingerprint duplicates found.');
  } else {
    for (const d of fpDupes) {
      console.log(`  fingerprint="${d.fingerprint.slice(0, 50)}..." = ${d.cnt} rows`);
    }
  }

  // Check timestamps
  console.log('\n=== TIMESTAMP CHECKS ===');
  const futurePosted = await prisma.job.count({ where: { postedDate: { gt: new Date() } } });
  const futureFirstSeen = await prisma.job.count({ where: { firstSeenAt: { gt: new Date() } } });
  const futureLastSeen = await prisma.job.count({ where: { lastSeenAt: { gt: new Date() } } });
  const postedBeforeFirstSeen = await prisma.job.count({
    where: { postedDate: { lt: prisma.job.fields.firstSeenAt } },
  });
  console.log('Jobs with future postedDate:', futurePosted);
  console.log('Jobs with future firstSeenAt:', futureFirstSeen);
  console.log('Jobs with future lastSeenAt:', futureLastSeen);
  console.log('Jobs where postedDate < firstSeenAt:', postedBeforeFirstSeen);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
