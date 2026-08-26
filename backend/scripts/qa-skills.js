const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== SKILL EXTRACTION ANALYSIS ===\n');

  // Get all unique skills in the database
  const skills = await prisma.skill.findMany({
    orderBy: { name: 'asc' },
  });
  console.log('Total unique skills:', skills.length);
  console.log('Skills:', skills.map(s => s.name).join(', '));

  // Get jobs with skills
  const jobsWithSkills = await prisma.job.findMany({
    where: {
      skills: { some: {} },
    },
    include: {
      skills: { include: { skill: true } },
    },
    take: 30,
    orderBy: { firstSeenAt: 'desc' },
  });

  console.log('\nJobs with skills (sample):');
  for (const j of jobsWithSkills) {
    const skillNames = j.skills.map(s => s.skill.name).join(', ');
    console.log(`  ${j.title} | skills=[${skillNames}] | src=${j.sourceId}`);
  }

  // Check for common tech skills
  const techSkills = ['JavaScript', 'TypeScript', 'React', 'Node.js', 'NestJS', 'Python', 'Java', 'SQL', 'PostgreSQL', 'MongoDB', 'C#', 'C++', 'Docker', 'AWS', 'Git', 'REST API', 'GraphQL', 'Redis', 'Next.js', 'Express'];
  console.log('\n=== TECH SKILL PRESENCE ===');
  for (const ts of techSkills) {
    const count = await prisma.jobSkill.count({
      where: { skill: { name: ts } },
    });
    console.log(`  ${ts}: ${count} jobs`);
  }

  // Check for alias issues
  console.log('\n=== POTENTIAL ALIAS ISSUES ===');
  const allSkillNames = skills.map(s => s.name);
  const aliasCandidates = [
    ['Node', 'Node.js'], ['NodeJS', 'Node.js'], ['ReactJS', 'React'], ['React.js', 'React'],
    ['Full-Stack', 'Full Stack'], ['Fullstack', 'Full Stack'], ['Javascript', 'JavaScript'],
    ['Typescript', 'TypeScript'], ['Postgres', 'PostgreSQL'], ['Mongo', 'MongoDB'],
  ];
  for (const [a, b] of aliasCandidates) {
    const hasA = allSkillNames.includes(a);
    const hasB = allSkillNames.includes(b);
    if (hasA && hasB) {
      console.log(`  DUPLICATE ALIAS: "${a}" and "${b}" both exist as separate skills`);
    } else if (hasA && !hasB) {
      console.log(`  ALIAS ONLY: "${a}" exists but canonical "${b}" does not`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
