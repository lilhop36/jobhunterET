const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== ADAPTER RESPONSE TEST ===\n');

  // We can't easily instantiate NestJS injectables here,
  // but we can test the raw HTTP endpoints directly.
  const sources = [
    { name: 'ReliefWeb RSS', url: 'https://reliefweb.int/jobs/rss.xml?advanced-search=%28C87%29' },
    { name: 'Remotive API', url: 'https://remotive.com/api/remote-jobs?limit=5' },
    { name: 'RemoteOK API', url: 'https://remoteok.com/api' },
    { name: 'Jobicy API', url: 'https://jobicy.com/api/v2/remote-jobs?count=5' },
    { name: 'Arbeitnow API', url: 'https://www.arbeitnow.com/api/job-board-api' },
    { name: 'EthioJobs', url: 'https://www.ethiojobs.net' },
    { name: 'EthioNGOJobs', url: 'https://www.ethiongojobs.com' },
    { name: 'GeezJobs', url: 'https://www.geezjobs.com' },
    { name: 'ETCareers', url: 'https://www.etcareers.com' },
    { name: 'HagereJobs', url: 'https://hagerejobs.com/ethiopia-job/' },
  ];

  for (const s of sources) {
    try {
      const start = Date.now();
      const res = await fetch(s.url, {
        method: 'GET',
        headers: { 'User-Agent': 'JobHunter-QA/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      const elapsed = Date.now() - start;
      const text = await res.text();
      console.log(`${s.name}:`);
      console.log(`  HTTP ${res.status} | ${elapsed}ms | ${text.length} bytes`);
      if (res.ok) {
        console.log(`  Preview: ${text.slice(0, 150).replace(/\n/g, ' ')}`);
      } else {
        console.log(`  ERROR: ${text.slice(0, 100)}`);
      }
    } catch (e) {
      console.log(`${s.name}: FAILED - ${e.message}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
