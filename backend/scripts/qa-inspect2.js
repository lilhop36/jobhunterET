const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Sample jobs with their tags and skills
  const jobs = await prisma.job.findMany({
    take: 20,
    select: {
      id: true,
      title: true,
      company: true,
      location: true,
      locationClass: true,
      workPlace: true,
      employmentType: true,
      experienceLevel: true,
      status: true,
      sourceId: true,
      tags: true,
      skills: { include: { skill: true } },
      postedDate: true,
      firstSeenAt: true,
      lastSeenAt: true,
      parseConfidence: true,
    },
    orderBy: { firstSeenAt: 'desc' },
  });

  console.log('=== SAMPLE JOBS ===');
  for (const j of jobs) {
    const skillNames = j.skills.map(s => s.skill.name).join(', ');
    const tags = j.tags ? JSON.parse(j.tags) : [];
    console.log(`\nID: ${j.id}`);
    console.log(`Title: ${j.title}`);
    console.log(`Company: ${j.company}`);
    console.log(`Location: ${j.location}`);
    console.log(`LocationClass: ${j.locationClass}`);
    console.log(`WorkPlace: ${j.workPlace}`);
    console.log(`EmploymentType: ${j.employmentType}`);
    console.log(`ExperienceLevel: ${j.experienceLevel}`);
    console.log(`Status: ${j.status}`);
    console.log(`Source: ${j.sourceId}`);
    console.log(`Tags: [${tags.join(', ')}]`);
    console.log(`Skills: [${skillNames}]`);
    console.log(`Posted: ${j.postedDate}`);
    console.log(`FirstSeen: ${j.firstSeenAt}`);
    console.log(`LastSeen: ${j.lastSeenAt}`);
    console.log(`ParseConfidence: ${j.parseConfidence}`);
  }

  // Get candidate profiles
  console.log('\n=== CANDIDATE PROFILES ===');
  const profiles = await prisma.candidateProfile.findMany({
    include: {
      user: { select: { id: true, email: true } },
      user: { select: { id: true, email: true } },
    },
  });
  for (const p of profiles) {
    console.log(`\nUser: ${p.user.email}`);
    console.log(`Title: ${p.title}`);
    console.log(`Years: ${p.years}`);
    console.log(`Remote: ${p.remote}`);
    console.log(`MinSalary: ${p.minSalary}`);
    console.log(`ExcludeOnsite: ${p.excludeOnsite}`);
    console.log(`EmploymentTypes: ${p.employmentTypes}`);
  }

  // Get user skills
  console.log('\n=== USER SKILLS & ROLES ===');
  const users = await prisma.user.findMany({
    include: {
      skills: { include: { skill: true } },
      targetRoles: true,
      locations: true,
    },
  });
  for (const u of users) {
    console.log(`\nUser: ${u.email}`);
    console.log(`Skills: ${u.skills.map(s => s.skill.name).join(', ')}`);
    console.log(`Roles: ${u.targetRoles.map(r => r.role + '(' + r.priority + ')').join(', ')}`);
    console.log(`Locations: ${u.locations.map(l => l.region + '(' + l.tier + ')').join(', ')}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
