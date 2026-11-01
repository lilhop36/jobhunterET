#!/usr/bin/env node
/**
 * Classify existing jobs with the Ethiopia-only policy.
 *
 * Ingestion enforces the policy for every new row; this script applies it to
 * rows stored before the policy existed. Rows default to REVIEW (not
 * recommendable) until they are classified here.
 *
 *   npm run eligibility:backfill            # apply
 *   npm run eligibility:backfill -- --dry-run
 */
import { PrismaClient } from '@prisma/client';
import { evaluateEthiopiaEligibility } from '../src/modules/eligibility/ethiopia-eligibility';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const jobs = await prisma.job.findMany({
    select: {
      id: true,
      title: true,
      location: true,
      country: true,
      description: true,
      workPlace: true,
      locationClass: true,
    },
  });

  const counts: Record<string, number> = { ELIGIBLE: 0, REVIEW: 0, REJECTED: 0, UNCHANGED: 0 };

  for (let i = 0; i < jobs.length; i += 100) {
    const batch = jobs.slice(i, i + 100);
    await Promise.all(
      batch.map(async (job) => {
        const decision = evaluateEthiopiaEligibility(job);
        counts[decision.status]++;
        if (!dryRun) {
          await prisma.job.update({
            where: { id: job.id },
            data: { eligibility: decision.status, eligibilityReason: decision.reason },
          });
        }
      }),
    );
  }

  console.log(
    `[eligibility] ${dryRun ? 'dry run' : 'updated'} ${jobs.length} job(s): ` +
      `ELIGIBLE ${counts.ELIGIBLE}, REVIEW ${counts.REVIEW}, REJECTED ${counts.REJECTED}`,
  );
}

main()
  .catch((error) => {
    console.error('[eligibility] backfill failed:', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
