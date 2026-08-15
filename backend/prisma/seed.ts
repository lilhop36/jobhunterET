import { PrismaClient, SourceType, SourceTier, SourceStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { SKILL_DICT } from '../src/modules/matching/matching-engine';

const prisma = new PrismaClient();

/**
 * Dev-only seed. Refuses to run unless SEED_DEMO_DATA=true (Phase 0.3 of the
 * QA protocol): the demo admin user and demo job postings it creates must never
 * reach a production database. The script lives under prisma/ (not src/), so
 * `nest build` never compiles it into the production bundle.
 */
async function main() {
  if (process.env.SEED_DEMO_DATA !== 'true') {
    console.log('SEED_DEMO_DATA !== "true" — seed skipped (dev-only demo data).');
    return;
  }
  console.log('Seeding…');

  // Skills dictionary
  for (const name of SKILL_DICT) {
    await prisma.skill.upsert({ where: { name }, create: { name }, update: {} });
  }

  // Sources
  const sources: {
    id: string;
    name: string;
    type: SourceType;
    baseUrl: string;
    priorityTier: SourceTier;
    status: SourceStatus;
    lastError?: string | null;
  }[] = [
    { id: 'reliefweb', name: 'ReliefWeb (Ethiopia)', type: 'RSS', baseUrl: 'https://reliefweb.int/jobs/rss.xml?advanced-search=(C87)', priorityTier: 'ETHIOPIA', status: 'ACTIVE' },
    { id: 'ethiojobs', name: 'Ethiojobs.net', type: 'HTML', baseUrl: 'https://ethiojobs.net', priorityTier: 'ETHIOPIA', status: 'ACTIVE' },
    { id: 'ethiongojobs', name: 'EthioNGOJobs', type: 'JSON', baseUrl: 'https://ethiongojobs.com/wp-json/wp/v2/posts', priorityTier: 'ETHIOPIA', status: 'ACTIVE' },
    { id: 'geez', name: 'GeezJobs', type: 'HTML', baseUrl: 'https://geezjobs.com', priorityTier: 'ETHIOPIA', status: 'ACTIVE' },
    { id: 'remotive', name: 'Remotive', type: 'JSON', baseUrl: 'https://remotive.com/api/remote-jobs', priorityTier: 'REMOTE', status: 'ACTIVE' },
    { id: 'arbeitnow', name: 'Arbeitnow', type: 'JSON', baseUrl: 'https://www.arbeitnow.com/api/job-board-api', priorityTier: 'REMOTE', status: 'ACTIVE' },
    // HaHuJobs domain is parked (for sale at HugeDomains) — no real data possible.
    { id: 'hahu', name: 'HaHuJobs', type: 'HTML', baseUrl: 'https://hahujobs.com', priorityTier: 'ETHIOPIA', status: 'DISABLED', lastError: 'Domain expired — parked at HugeDomains' },
  ];
  for (const s of sources) {
    await prisma.jobSource.upsert({ where: { id: s.id }, create: { ...s, lastSuccessfulRun: new Date() }, update: s });
  }

  // Admin user (first registered → ADMIN)
  const email = 'amara@jobhunter.et';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash('demo1234', 10),
        role: 'ADMIN',
        matchThreshold: 70,
        profile: {
          create: {
            title: 'Software Engineer',
            summary: 'Backend-focused engineer who enjoys building clean APIs and data services.',
            years: 2,
            remote: true,
            minSalary: 700,
            excludeOnsite: true,
            employmentTypes: ['FULL_TIME', 'CONTRACT'],
            onboardDone: true,
          },
        },
      },
    });
    const skillMap: Record<string, string> = {};
    for (const n of ['Node.js', 'TypeScript', 'JavaScript', 'PostgreSQL', 'NestJS', 'REST API', 'Git', 'Docker']) {
      const s = await prisma.skill.upsert({ where: { name: n }, create: { name: n }, update: {} });
      skillMap[n] = s.id;
      await prisma.candidateSkill.create({ data: { userId: user.id, skillId: s.id } });
    }
    await prisma.targetRole.createMany({
      data: [
        { userId: user.id, role: 'Backend Developer', priority: 'HIGH' },
        { userId: user.id, role: 'Full Stack Developer', priority: 'HIGH' },
        { userId: user.id, role: 'Frontend Developer', priority: 'MEDIUM' },
      ],
    });
    await prisma.locationPreference.createMany({
      data: [
        { userId: user.id, region: 'Ethiopia', tier: 'HIGH' },
        { userId: user.id, region: 'Remote', tier: 'HIGH' },
        { userId: user.id, region: 'USA', tier: 'MEDIUM' },
      ],
    });
    console.log('Created admin user', email);
  }

  // Seed jobs
  const jobSeeds = [
    { title: 'Junior Backend Developer', company: 'Addis Software Solutions', location: 'Addis Ababa, Ethiopia', locationClass: 'ETHIOPIA_LOCAL', employmentType: 'FULL_TIME', experienceLevel: 'ENTRY', salary: null, skills: ['Node.js', 'TypeScript', 'PostgreSQL', 'AWS'], sourceId: 'ethiojobs', desc: 'Build REST APIs for fintech clients. Node.js, TypeScript, PostgreSQL.' },
    { title: 'Backend Developer (NestJS)', company: 'Gebeya Inc.', location: 'Addis Ababa / Remote (Ethiopia)', locationClass: 'ETHIOPIA_REMOTE', employmentType: 'FULL_TIME', experienceLevel: 'MID', salary: null, skills: ['NestJS', 'Node.js', 'PostgreSQL', 'GraphQL'], sourceId: 'hahu', desc: 'Design GraphQL APIs with NestJS. Hybrid remote.' },
    { title: 'Backend Engineer', company: 'NexaPay', location: 'Remote (EMEA)', locationClass: 'INTERNATIONAL_REMOTE', employmentType: 'FULL_TIME', experienceLevel: 'MID', salary: 3500, skills: ['Node.js', 'TypeScript', 'PostgreSQL', 'NestJS'], sourceId: 'remotive', desc: 'Cross-border payment rails. TypeScript, event-driven, PostgreSQL.' },
    { title: 'Full Stack Developer', company: 'Safaricom Ethiopia', location: 'Addis Ababa, Ethiopia', locationClass: 'ETHIOPIA_LOCAL', employmentType: 'FULL_TIME', experienceLevel: 'MID', salary: null, skills: ['React', 'Node.js', 'MongoDB', 'TypeScript'], sourceId: 'ethiojobs', desc: 'M-PESA ecosystem web apps. React + Node.js BFFs.' },
    { title: 'Frontend Developer', company: 'HaHu Labs', location: 'Addis Ababa, Ethiopia', locationClass: 'ETHIOPIA_LOCAL', employmentType: 'FULL_TIME', experienceLevel: 'ENTRY', salary: null, skills: ['React', 'TypeScript', 'CSS', 'Next.js'], sourceId: 'hahu', desc: 'Consumer apps for Ethiopian market. React + Next.js.' },
    { title: 'Senior Backend Engineer', company: 'Flutterwave', location: 'Remote (Africa)', locationClass: 'INTERNATIONAL_REMOTE', employmentType: 'FULL_TIME', experienceLevel: 'SENIOR', salary: 5200, skills: ['Node.js', 'PostgreSQL', 'Microservices', 'AWS'], sourceId: 'remotive', desc: 'Payment processing microservices at scale.' },
    { title: 'Data Engineer', company: 'Ethio Telecom', location: 'Addis Ababa, Ethiopia', locationClass: 'ETHIOPIA_LOCAL', employmentType: 'FULL_TIME', experienceLevel: 'MID', salary: null, skills: ['Python', 'SQL', 'Spark', 'Airflow'], sourceId: 'ethiojobs', desc: 'ETL pipelines for subscriber analytics. Python, Spark, Airflow.' },
    { title: 'ICT Officer', company: 'UNDP Ethiopia', location: 'Addis Ababa, Ethiopia', locationClass: 'ETHIOPIA_LOCAL', employmentType: 'CONTRACT', experienceLevel: 'MID', salary: null, skills: ['IT Support', 'Networking', 'Systems Administration'], sourceId: 'reliefweb', desc: 'Country-office infrastructure, networks and user support.' },
  ];

  for (const j of jobSeeds) {
    const sourceJobId = `seed-${j.title}`.replace(/\s+/g, '-');
    const exists = await prisma.job.findUnique({ where: { sourceId_sourceJobId: { sourceId: j.sourceId, sourceJobId } } });
    if (exists) continue;
    const skillIds: string[] = [];
    for (const raw of j.skills) {
      const s = await prisma.skill.upsert({ where: { name: raw }, create: { name: raw }, update: {} });
      skillIds.push(s.id);
    }
    await prisma.job.create({
      data: {
        title: j.title,
        company: j.company,
        location: j.location,
        locationClass: j.locationClass as any,
        employmentType: j.employmentType as any,
        experienceLevel: j.experienceLevel as any,
        workPlace: j.locationClass.includes('REMOTE') ? 'REMOTE' : 'ONSITE',
        salary: j.salary,
        url: 'https://example.com/job',
        sourceId: j.sourceId,
        sourceJobId,
        description: j.desc,
        postedDate: new Date(Date.now() - Math.random() * 48 * 3600 * 1000),
        deadline: new Date(Date.now() + (10 + Math.random() * 30) * 86400 * 1000),
        firstSeenAt: new Date(Date.now() - Math.random() * 24 * 3600 * 1000),
        lastSeenAt: new Date(),
        status: 'ACTIVE',
        parseConfidence: 80 + Math.floor(Math.random() * 15),
        skills: { create: skillIds.map((skillId) => ({ skillId })) },
      },
    });
  }

  const jobCount = await prisma.job.count();
  console.log(`Seeded ${jobCount} jobs. Done.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
