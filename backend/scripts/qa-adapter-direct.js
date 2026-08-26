const { ReliefWebAdapter } = require('./dist/modules/sources/adapters/reliefweb.adapter');

async function main() {
  console.log('=== RELIEFWEB ADAPTER DIRECT TEST ===\n');
  const adapter = new ReliefWebAdapter();
  try {
    const start = Date.now();
    const jobs = await adapter.fetchJobs();
    const elapsed = Date.now() - start;
    console.log(`Fetched ${jobs.length} jobs in ${elapsed}ms`);
    for (const j of jobs.slice(0, 5)) {
      console.log(`  ${j.title} | ${j.company} | ${j.location} | ${j.sourceJobId}`);
    }
  } catch (e) {
    console.log('FAILED:', e.message);
  }
}

main().catch(e => console.error(e));
