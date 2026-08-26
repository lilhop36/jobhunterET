const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== LOCATION EXTRACTION ANALYSIS ===\n');

  // Get a sample of Ethiopian jobs
  const ethiopianJobs = await prisma.job.findMany({
    where: {
      OR: [
        { locationClass: 'ETHIOPIA_LOCAL' },
        { locationClass: 'ETHIOPIA_REMOTE' },
        { tags: { contains: 'ethiopian' } },
      ]
    },
    take: 30,
    select: {
      id: true,
      title: true,
      location: true,
      locationClass: true,
      workPlace: true,
      sourceId: true,
      tags: true,
    },
    orderBy: { firstSeenAt: 'desc' },
  });

  console.log('Ethiopian/local jobs sample:');
  for (const j of ethiopianJobs) {
    const tags = j.tags ? JSON.parse(j.tags) : [];
    console.log(`  ${j.location} | ${j.locationClass} | ${j.workPlace} | tags=[${tags.join(',')}] | src=${j.sourceId}`);
  }

  // Get remote/international jobs
  const intlJobs = await prisma.job.findMany({
    where: {
      locationClass: 'INTERNATIONAL_REMOTE',
    },
    take: 20,
    select: {
      id: true,
      title: true,
      location: true,
      locationClass: true,
      workPlace: true,
      sourceId: true,
    },
    orderBy: { firstSeenAt: 'desc' },
  });

  console.log('\nInternational remote jobs sample:');
  for (const j of intlJobs) {
    console.log(`  ${j.location} | ${j.locationClass} | ${j.workPlace} | src=${j.sourceId}`);
  }

  // Check for "Unknown" or "Not Specified" locations
  const unknownLoc = await prisma.job.count({
    where: {
      OR: [
        { location: { contains: 'not specified', mode: 'insensitive' } },
        { location: { contains: 'unknown', mode: 'insensitive' } },
        { location: { contains: 'n/a', mode: 'insensitive' } },
      ]
    }
  });
  console.log('\nJobs with unclear location:', unknownLoc);

  // Check workPlace distribution
  console.log('\n=== WORKPLACE DISTRIBUTION ===');
  const wpCounts = await prisma.job.groupBy({
    by: ['workPlace'],
    _count: { workPlace: true },
  });
  for (const w of wpCounts) {
    console.log(`  ${w.workPlace}: ${w._count.workPlace}`);
  }

  // Check locationClass distribution
  console.log('\n=== LOCATION CLASS DISTRIBUTION ===');
  const lcCounts = await prisma.job.groupBy({
    by: ['locationClass'],
    _count: { locationClass: true },
  });
  for (const l of lcCounts) {
    console.log(`  ${l.locationClass}: ${l._count.locationClass}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
