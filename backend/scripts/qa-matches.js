const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== MATCH SCORE ANALYSIS ===\n');

  // Get the best matches
  const bestMatches = await prisma.jobMatch.findMany({
    take: 20,
    orderBy: { score: 'desc' },
    include: {
      job: {
        select: {
          title: true,
          company: true,
          location: true,
          workPlace: true,
          employmentType: true,
          experienceLevel: true,
          sourceId: true,
          skills: { include: { skill: true } },
        },
      },
      user: { select: { email: true } },
    },
  });

  console.log('Top 20 matches:');
  for (const m of bestMatches) {
    const jobSkills = m.job.skills.map(s => s.skill.name).join(', ');
    console.log(`\nscore=${m.score} | user=${m.user.email}`);
    console.log(`  job: ${m.job.title} | ${m.job.company} | ${m.job.location}`);
    console.log(`  roleScore=${m.roleScore} skillScore=${m.skillScore} expScore=${m.experienceScore} locScore=${m.locationScore} empScore=${m.employmentScore} freshScore=${m.freshnessScore} salScore=${m.salaryScore}`);
    console.log(`  matched: [${m.matchedSkills}] | missing: [${m.missingSkills}] | related: [${m.relatedSkills}]`);
    console.log(`  reasons: [${m.reasons}]`);
    console.log(`  summary: ${m.summary}`);
    console.log(`  job skills: [${jobSkills}]`);
  }

  // Check why no matches above 75
  console.log('\n=== MATCH THRESHOLD ANALYSIS ===');
  const above75 = await prisma.jobMatch.count({ where: { score: { gte: 75 } } });
  const above70 = await prisma.jobMatch.count({ where: { score: { gte: 70 } } });
  const above50 = await prisma.jobMatch.count({ where: { score: { gte: 50 } } });
  console.log('Matches >= 75:', above75);
  console.log('Matches >= 70:', above70);
  console.log('Matches >= 50:', above50);

  // Check user thresholds
  const users = await prisma.user.findMany({
    select: { id: true, email: true, matchThreshold: true },
  });
  console.log('\nUser thresholds:');
  for (const u of users) {
    const above = await prisma.jobMatch.count({ where: { userId: u.id, score: { gte: u.matchThreshold } } });
    console.log(`  ${u.email}: threshold=${u.matchThreshold} matches_above=${above}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
