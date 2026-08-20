import 'reflect-metadata';
import { RemotiveAdapter } from '../src/modules/sources/adapters/remotive.adapter';
import { EthiojobsAdapter } from '../src/modules/sources/adapters/ethiojobs.adapter';
import { GeezJobsAdapter } from '../src/modules/sources/adapters/geezjobs.adapter';
import { EthioNgoJobsAdapter } from '../src/modules/sources/adapters/ethiongojobs.adapter';
import { ReliefWebAdapter } from '../src/modules/sources/adapters/reliefweb.adapter';
import { ArbeitnowAdapter } from '../src/modules/sources/adapters/arbeitnow.adapter';
import { JobicyAdapter } from '../src/modules/sources/adapters/jobicy.adapter';
import { RemoteOKAdapter } from '../src/modules/sources/adapters/remoteok.adapter';
import { LandingJobsAdapter } from '../src/modules/sources/adapters/landingjobs.adapter';
import { EtcareersAdapter } from '../src/modules/sources/adapters/etcareers.adapter';

async function run() {
  const adapters = [
    new ReliefWebAdapter(),
    new RemotiveAdapter(),
    new ArbeitnowAdapter(),
    new EthioNgoJobsAdapter(),
    new GeezJobsAdapter(),
    new EthiojobsAdapter(),
    new JobicyAdapter(),
    new RemoteOKAdapter(),
    new LandingJobsAdapter(),
    new EtcareersAdapter(),
  ];

  for (const a of adapters) {
    console.log('--- Adapter', (a as any).sourceId ?? a.constructor.name);
    try {
      const jobs = await a.fetchJobs();
      console.log('Fetched', jobs.length, 'jobs');
      console.log(jobs.slice(0, 2).map((j) => ({ title: j.title, company: j.company, location: j.location, url: j.url })));
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
    }
    console.log('');
  }
}

run().catch((e) => console.error(e));
