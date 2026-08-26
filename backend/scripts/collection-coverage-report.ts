/**
 * Collection coverage report — read-only adapter sweep.
 *
 * Usage:
 *   npx ts-node scripts/collection-coverage-report.ts            # read-only across all sources
 *   npx ts-node scripts/collection-coverage-report.ts --source=ethiojobs --mode=deep
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    source: args.find((a) => a.startsWith('--source='))?.split('=')[1],
    mode: (args.find((a) => a.startsWith('--mode='))?.split('=')[1] as 'FAST' | 'DEEP' | undefined) ?? 'FAST',
  };
}

async function main() {
  const opts = parseArgs();

  // Dynamically import adapters to avoid circular deps at boot
  const { EthiojobsAdapter } = await import('./src/modules/sources/adapters/ethiojobs.adapter');
  const { EthioNgoJobsAdapter } = await import('./src/modules/sources/adapters/ethiongojobs.adapter');
  const { JobicyAdapter } = await import('./src/modules/sources/adapters/jobicy.adapter');
  const { ArbeitnowAdapter } = await import('./src/modules/sources/adapters/arbeitnow.adapter');
  const { GeezJobsAdapter } = await import('./src/modules/sources/adapters/geezjobs.adapter');
  const { EtcareersAdapter } = await import('./src/modules/sources/adapters/etcareers.adapter');
  const { RemotiveAdapter } = await import('./src/modules/sources/adapters/remotive.adapter');
  const { RemoteOKAdapter } = await import('./src/modules/sources/adapters/remoteok.adapter');
  const { LandingJobsAdapter } = await import('./src/modules/sources/adapters/landingjobs.adapter');
  const { ReliefWebAdapter } = await import('./src/modules/sources/adapters/reliefweb.adapter');
  const { HagereJobsAdapter } = await import('./src/modules/sources/adapters/hagerejobs.adapter');

  const adapters = [
    { id: 'ethiojobs', adapter: new EthiojobsAdapter() },
    { id: 'ethiongojobs', adapter: new EthioNgoJobsAdapter() },
    { id: 'jobicy', adapter: new JobicyAdapter() },
    { id: 'arbeitnow', adapter: new ArbeitnowAdapter() },
    { id: 'geezjobs', adapter: new GeezJobsAdapter() },
    { id: 'etcareers', adapter: new EtcareersAdapter() },
    { id: 'remotive', adapter: new RemotiveAdapter() },
    { id: 'remoteok', adapter: new RemoteOKAdapter() },
    { id: 'landingjobs', adapter: new LandingJobsAdapter() },
    { id: 'reliefweb', adapter: new ReliefWebAdapter() },
    { id: 'hagerejobs', adapter: new HagereJobsAdapter() },
  ];

  const sourceIds = opts.source ? [opts.source] : adapters.map((a) => a.id);
  const mode = opts.mode;

  console.log(`\nCollection coverage report (mode=${mode})\n`);
  console.log(`  ${'SOURCE'.padEnd(16)} ${'MODE'.padEnd(6)} ${'CATEGORY'.padEnd(40)} ${'PAGES'.padStart(6)} ${'FETCHED'.padStart(8)} ${'NEW'.padStart(6)} ${'DUPES'.padStart(6)} ${'ERR'.padStart(5)} ${'STOPPED'.padEnd(18)}`);
  console.log('─'.repeat(100));

  const totals: Record<string, { fetched: number; errors: number }> = {};

  for (const { id: sourceId, adapter } of adapters) {
    if (!sourceIds.includes(sourceId)) continue;

    try {
      // Read-only: call adapter directly with mode-aware request
      const since = new Date(Date.now() - (mode === 'DEEP' ? 14 : 2) * 86_400_000);
      const result = await (adapter as any).collect?.({
        mode,
        since,
        maxPages: mode === 'DEEP' ? 55 : 12,
        maxRequests: mode === 'DEEP' ? 60 : 14,
        requestDelayMs: 800,
        categories: mode === 'DEEP' ? ['technology', 'engineering'] : [],
      }) ?? { jobs: [], pagesFetched: 0, requestsMade: 0, categories: [], errors: [] };

      for (const cat of result.categories) {
        printCategoryRow(sourceId, mode, cat.category, cat.pagesFetched, cat.jobsFetched, 0, cat.errors, cat.stoppedReason);
      }

      totals[sourceId] = result.categories.reduce(
        (acc: any, c: any) => ({
          fetched: acc.fetched + c.jobsFetched,
          errors: acc.errors + c.errors,
        }),
        { fetched: 0, errors: 0 },
      );
    } catch (e: any) {
      printCategoryRow(sourceId, mode, 'latest', 0, 0, 0, 1, `ERROR: ${e?.message?.slice(0, 30)}`);
      totals[sourceId] = { fetched: 0, errors: 1 };
    }
  }

  // Coverage from DB
  console.log('\n' + '─'.repeat(100));
  console.log('Coverage (active jobs in DB):');
  console.log(`  ${'SOURCE'.padEnd(16)} ${'ACTIVE'.padStart(8)} ${'WITH_CATS'.padStart(12)}`);
  console.log('─'.repeat(40));

  for (const sourceId of sourceIds) {
    const count = await prisma.job.count({
      where: { sourceId, status: 'ACTIVE' },
    });
    const catCount = await prisma.job.count({
      where: { sourceId, status: 'ACTIVE', categories: { not: null } },
    });
    console.log(`  ${sourceId.padEnd(16)} ${String(count).padStart(8)} ${String(catCount).padStart(12)}`);
  }

  console.log('\nTotals:');
  for (const [sourceId, stat] of Object.entries(totals)) {
    console.log(`  ${sourceId}: fetched=${stat.fetched}, errors=${stat.errors}`);
  }
}

function printCategoryRow(sourceId: string, mode: string, category: string, pages: number, fetched: number, newJobs: number, dupes: number, errors: number, stopped: string) {
  const cat = category.length > 38 ? category.slice(0, 35) + '...' : category;
  console.log(`  ${sourceId.padEnd(14)} ${mode.padEnd(6)} ${cat.padEnd(40)} ${String(pages).padStart(6)} ${String(fetched).padStart(8)} ${String(newJobs).padStart(6)} ${String(dupes).padStart(6)} ${String(errors).padStart(5)} ${stopped.padEnd(18)}`);
}

main().catch(console.error).finally(async () => {
  await prisma.$disconnect();
});
