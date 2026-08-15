import 'reflect-metadata';
import fetch from 'node-fetch';
import { RemotiveAdapter } from '../src/modules/sources/adapters/remotive.adapter';
import { EthiojobsAdapter } from '../src/modules/sources/adapters/ethiojobs.adapter';
import { GeezJobsAdapter } from '../src/modules/sources/adapters/geezjobs.adapter';
import { EthioNgoJobsAdapter } from '../src/modules/sources/adapters/ethiongojobs.adapter';

async function run() {
  const adapters = [
    new RemotiveAdapter(),
    new EthiojobsAdapter(),
    new GeezJobsAdapter(),
    new EthioNgoJobsAdapter(),
  ];

  for (const a of adapters) {
    console.log('--- Adapter', (a as any).sourceId ?? a.constructor.name);
    try {
      const jobs = await a.fetchJobs();
      console.log('Fetched', jobs.length, 'jobs');
      console.log(jobs.slice(0, 3).map((j) => ({ title: j.title, company: j.company, url: j.url }))); 
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
    }
  }
}

run().catch((e) => console.error(e));
