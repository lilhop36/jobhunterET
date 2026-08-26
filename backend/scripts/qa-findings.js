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
  const notSpecified = await prisma.job.findMany({
    where: { location: { contains: 'Not Specified', mode: 'insensitive' } },
    select: { id: true, title: true, location: true, locationClass: true, workPlace: true },
  });
  console.log(`Jobs with "Not Specified" location: ${notSpecified.length}`);
  for (const j of notSpecified) {
    console.log(`  ${j.id} | ${j.title} | loc=${j.location} | class=${j.locationClass} | wp=${j.workPlace}`);
  }
  console.log('BUG: "Not Specified" should not be classified as ETHIOPIA_LOCAL.');

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
    console.log(`    fingerprint: ${d.fingerprint?.slice(0, 80)}...`);
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
  console.log(`Sample jobs with skills: ${jobsWithSkills.length}`);
  console.log(`Jobs with 0 skills in sample: ${jobsWithoutSkills}`);
  console.log(`Jobs with >0 skills in sample: ${jobsWithSkillsCount}`);

  // Check actual skill names
  console.log('\nSample job skills:');
  for (const j of jobsWithSkills.slice(0, 10)) {
    console.log(`  ${j.title}: [${j.skills.map(s => s.skill.name).join(', ')}]`);
  }

  // 5. CHECK MATCHED AT - WHY CYCLES SHOW 0
  console.log('\n--- MATCHED AT ANALYSIS ---');
  const matchedNull = await prisma.job.count({ where: { status: 'ACTIVE', matchedAt: null } });
  const matchedNotNull = await prisma.job.count({ where: { status: 'ACTIVE', matchedAt: { not: null } } });
  console.log(`ACTIVE jobs with matchedAt=NULL: ${matchedNull}`);
  console.log(`ACTIVE jobs with matchedAt!=NULL: ${matchedNotNull}`);
  console.log('This explains why match cycles show jobs=0 - all ACTIVE jobs have been matched.');

  // 6. CHECK SOURCE JOB ID FORMATS
  console.log('\n--- SOURCE JOB ID FORMATS ---');
  const sampleJobs = await prisma.job.findMany({
    take: 10,
    select: { sourceId: true, sourceJobId: true },
  });
  for (const j of sampleJobs) {
    console.log(`  ${j.sourceId}: ${j.sourceJobId}`);
  }

  // 7. CHECK DUPLICATE SOURCE JOB IDs ACROSS SOURCES
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

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
