#!/usr/bin/env node
/**
 * Backfill Phase 4 dedup data for jobs stored before cross-source grouping.
 *
 * For every existing job this sets `crossSourceKey` and creates the
 * JobSourceListing row that represents its original board posting. It does not
 * merge historical duplicates: collapsing rows would have to re-point
 * applications, matches and notifications, and a wrong merge loses data. New
 * ingests group correctly from now on.
 *
 *   npm run listings:backfill            # apply
 *   npm run listings:backfill -- --dry-run
 */
import { PrismaClient } from '@prisma/client';
import { buildCrossSourceKey } from '../src/modules/jobs/job-fidelity';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const jobs = await prisma.job.findMany({
    select: { id: true, company: true, title: true, location: true, sourceId: true, sourceJobId: true, url: true },
  });

  let keyed = 0;
  let listed = 0;
  let batch: any[] = [];
  const flush = async () => {
    if (!batch.length) return;
    if (!dryRun) await prisma.$transaction(batch);
    batch = [];
  };

  for (const job of jobs) {
    const crossSourceKey = buildCrossSourceKey(job.company, job.title, job.location);
    if (crossSourceKey) keyed++;
    if (!job.sourceJobId) continue;
    listed++;
    if (dryRun) continue;
    batch.push(
      prisma.jobSourceListing.upsert({
        where: { sourceId_sourceJobId: { sourceId: job.sourceId, sourceJobId: job.sourceJobId } },
        create: { jobId: job.id, sourceId: job.sourceId, sourceJobId: job.sourceJobId, url: job.url },
        update: { jobId: job.id, url: job.url },
      }),
    );
    if (crossSourceKey) {
      batch.push(prisma.job.update({ where: { id: job.id }, data: { crossSourceKey } }));
    }
    if (batch.length >= 400) await flush();
  }
  await flush();

  console.log(
    `[listings] ${dryRun ? 'dry run' : 'updated'} ${jobs.length} job(s): ` +
      `${keyed} keyed, ${listed} listing(s)`,
  );
}

main()
  .catch((error) => {
    console.error('[listings] backfill failed:', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
