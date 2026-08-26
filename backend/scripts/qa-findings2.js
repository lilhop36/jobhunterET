const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== ADDITIONAL QA FINDINGS ===\n');

  // 1. HAHU STATUS BUG
  console.log('--- HAHU STATUS BUG ---');
  const hahu = await prisma.jobSource.findUnique({ where: { id: 'hahu' } });
  console.log(`hahu status: ${hahu.status}`);
  console.log(`hahu lastError: ${hahu.lastError}`);
  console.log(`hahu consecutiveFailures: ${hahu.consecutiveFailures}`);
  console.log('BUG: hahu is ACTIVE but lastError says "Auto-disabled". Should be DISABLED.');

  // 2. "Not Specified" LOCATION BUG
  console.log('\n--- NOT SPECIFIED LOCATION BUG ---');
  const allJobsForLoc = await prisma.job.findMany({
    where: {
      OR: [
        { location: { contains: 'Not Specified' } },
        { location: { contains: 'not specified' } },
      ]
    },
    select: { id: true, title: true, location: true, locationClass: true, workPlace: true },
  });
  console.log(`Jobs with "Not Specified" location: ${allJobsForLoc.length}`);
  for (const j of allJobsForLoc) {
    console.log(`  ${j.id} | ${j.title} | loc=${j.location} | class=${j.locationClass} | wp=${j.workPlace}`);
  }

  // 3. FINGERPRINT DUPLICATES DETAIL
  console.log('\n--- FINGERPRINT DUPLICATES ---');
  const fpDupes = await prisma.$queryRaw`
    SELECT id, title, company, location, fingerprint, sourceId, sourceJobId
    FROM Job
    WHERE fingerprint IN (
      SELECT fingerprint FROM Job GROUP BY fingerprint HAVING COUNT(*) > 1
    )
    ORDER BY fingerprint
  `;
  for (const d of fpDupes) {
    console.log(`  ${d.id} | ${d.title} | ${d.company} | ${d.location}`);
    console.log(`    fingerprint: ${(d.fingerprint || '').slice(0, 80)}...`);
    console.log(`    source: ${d.sourceId}:${d.sourceJobId}`);
  }

  // 4. SKILL EXTRACTION ON REAL JOBS
  console.log('\n--- SKILL EXTRACTION ON REAL JOBS ---');
  const jobsWithSkills = await prisma.job.findMany({
    where: { skills: { some: {} } },
    include: { skills: { include: { skill: true } } },
    take: 20,
    orderBy: { firstSeenAt: 'desc' },
  });
  let jobsWithoutSkills = 0;
  let jobsWithSkillsCount = 0;
  for (const j of jobsWithSkills) {
    if (j.skills.length === 0) jobsWithoutSkills++;
    else jobsWithSkillsCount++;
  }
  console.log(`Sample jobs with skills relation: ${jobsWithSkills.length}`);
  console.log(`Jobs with 0 skills in sample: ${jobsWithoutSkills}`);
  console.log(`Jobs with >0 skills in sample: ${jobsWithSkillsCount}`);

  console.log('\nSample job skills:');
  for (const j of jobsWithSkills.slice(0, 10)) {
    console.log(`  ${j.title}: [${j.skills.map(s => s.skill.name).join(', ')}]`);
  }

  // 5. CHECK MATCHED AT
  console.log('\n--- MATCHED AT ANALYSIS ---');
  const matchedNull = await prisma.job.count({ where: { status: 'ACTIVE', matchedAt: null } });
  const matchedNotNull = await prisma.job.count({ where: { status: 'ACTIVE', matchedAt: { not: null } } });
  console.log(`ACTIVE jobs with matchedAt=NULL: ${matchedNull}`);
  console.log(`ACTIVE jobs with matchedAt!=NULL: ${matchedNotNull}`);

  // 6. CHECK SOURCE JOB ID FORMATS
  console.log('\n--- SOURCE JOB ID FORMATS ---');
  const sampleJobs = await prisma.job.findMany({
    take: 10,
    select: { sourceId: true, sourceJobId: true },
  });
  for (const j of sampleJobs) {
    console.log(`  ${j.sourceId}: ${j.sourceJobId}`);
  }

  // 7. CHECK CROSS-SOURCE DUPLICATES
  console.log('\n--- CROSS-SOURCE DUPLICATE CHECK ---');
  const crossDupes = await prisma.$queryRaw`
    SELECT sourceJobId, COUNT(DISTINCT sourceId) as sourceCount
    FROM Job
    GROUP BY sourceJobId
    HAVING sourceCount > 1
    LIMIT 10
  `;
  if (crossDupes.length === 0) {
    console.log('No cross-source duplicate sourceJobIds found.');
  } else {
    for (const d of crossDupes) {
      console.log(`  sourceJobId ${d.sourceJobId} appears in ${d.sourceCount} sources`);
    }
  }

  // 8. CHECK FOR NULL SOURCEJOBID
  console.log('\n--- NULL SOURCEJOBID CHECK ---');
  const nullSjid = await prisma.job.count({ where: { sourceJobId: null } });
  console.log('Jobs with null sourceJobId:', nullSjid);
  const emptySjid = await prisma.job.count({ where: { sourceJobId: '' } });
  console.log('Jobs with empty sourceJobId:', emptySjid);

  // 9. CHECK EXPIRED JOBS
  console.log('\n--- EXPIRED JOBS ---');
  const expired = await prisma.job.count({ where: { status: 'EXPIRED' } });
  console.log('EXPIRED jobs:', expired);
  const expiredSample = await prisma.job.findMany({
    where: { status: 'EXPIRED' },
    take: 5,
    select: { id: true, title: true, deadline: true, statusChangedAt: true },
  });
  for (const j of expiredSample) {
    console.log(`  ${j.title} | deadline=${j.deadline} | changed=${j.statusChangedAt}`);
  }

  // 10. NOTIFICATION DEDUP CHECK
  console.log('\n--- NOTIFICATION DEDUP ---');
  const notifCount = await prisma.notification.count();
  const uniquePairs = await prisma.notification.groupBy({
    by: ['userId', 'jobId'],
    _count: { userId: true },
  });
  console.log('Total notifications:', notifCount);
  console.log('Unique (userId, jobId) pairs:', uniquePairs.length);
  console.log('Dedup constraint working:', notifCount === uniquePairs.length);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
