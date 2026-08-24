/**
 * SQLite-compatible seed — populates initial job sources.
 * Run: npx ts-node scripts/seed-sqlite.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding job sources (SQLite)…');

  const sources = [
    { id: 'reliefweb', name: 'ReliefWeb (Ethiopia)', type: 'RSS', baseUrl: 'https://reliefweb.int/jobs/rss.xml?advanced-search=(C87)', priorityTier: 'ETHIOPIA', status: 'ACTIVE' },
    { id: 'ethiojobs', name: 'Ethiojobs.net', type: 'HTML', baseUrl: 'https://ethiojobs.net', priorityTier: 'ETHIOPIA', status: 'ACTIVE' },
    { id: 'ethiongojobs', name: 'EthioNGOJobs', type: 'JSON', baseUrl: 'https://ethiongojobs.com/wp-json/wp/v2/posts', priorityTier: 'ETHIOPIA', status: 'ACTIVE' },
    { id: 'geez', name: 'GeezJobs', type: 'HTML', baseUrl: 'https://geezjobs.com', priorityTier: 'ETHIOPIA', status: 'ACTIVE' },
    { id: 'remotive', name: 'Remotive', type: 'JSON', baseUrl: 'https://remotive.com/api/remote-jobs', priorityTier: 'REMOTE', status: 'ACTIVE' },
    { id: 'arbeitnow', name: 'Arbeitnow', type: 'JSON', baseUrl: 'https://www.arbeitnow.com/api/job-board-api', priorityTier: 'REMOTE', status: 'ACTIVE' },
    { id: 'hahu', name: 'HaHuJobs', type: 'HTML', baseUrl: 'https://hahujobs.com', priorityTier: 'ETHIOPIA', status: 'DISABLED', lastError: 'Domain expired — parked at HugeDomains' },
    { id: 'jobicy', name: 'Jobicy', type: 'API', baseUrl: 'https://jobicy.com/api/v2/remote-jobs', priorityTier: 'REMOTE', status: 'ACTIVE' },
    { id: 'remoteok', name: 'RemoteOK', type: 'JSON', baseUrl: 'https://remoteok.com/api', priorityTier: 'REMOTE', status: 'ACTIVE' },
    { id: 'landingjobs', name: 'LandingJobs', type: 'JSON', baseUrl: 'https://www.landing.jobs/api/v1/jobs', priorityTier: 'INTERNATIONAL', status: 'ACTIVE' },
    { id: 'etcareers', name: 'ETCareers', type: 'RSS', baseUrl: 'https://etcareers.com/jobs.rss', priorityTier: 'ETHIOPIA', status: 'ACTIVE' },
  ];

  for (const s of sources) {
    await prisma.jobSource.upsert({
      where: { id: s.id },
      create: { ...s, lastSuccessfulRun: new Date() } as any,
      update: s as any,
    });
    console.log(`  ✓ ${s.name}`);
  }

  console.log(`Seeded ${sources.length} sources. Done.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
