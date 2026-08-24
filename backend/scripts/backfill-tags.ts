/**
 * Backfill tags on existing jobs that were collected before the classifier.
 * Run once: npx ts-node scripts/backfill-tags.ts
 */
import { PrismaClient } from '@prisma/client';
import { classifyJob, type SourceConfig } from '../src/modules/sources/source-classifier';
import * as sourceConfigs from '../src/modules/sources/source-configs.json';

const prisma = new PrismaClient();

async function main() {
  const cfgMap: Record<string, SourceConfig> = {};
  for (const src of (sourceConfigs as any).sources) {
    cfgMap[src.id] = src;
  }

  // Find all jobs without tags (empty or null)
  const jobs = await prisma.job.findMany({
    where: { OR: [{ tags: null }, { tags: '[]' }] },
    select: { id: true, title: true, location: true, locationClass: true, workPlace: true, sourceId: true },
  });

  console.log(`Found ${jobs.length} jobs without tags`);

  let updated = 0;
  for (const job of jobs) {
    const cfg = cfgMap[job.sourceId];
    const result = classifyJob(cfg ?? { id: job.sourceId, defaultTags: [], defaultLocationClass: job.locationClass }, {
      title: job.title,
      location: job.location,
      locationClass: job.locationClass,
      workPlace: job.workPlace,
    });

    await prisma.job.update({
      where: { id: job.id },
      data: {
        tags: JSON.stringify(result.tags),
        locationClass: result.locationClass,
      },
    });
    updated++;
    if (updated % 50 === 0) console.log(`  Updated ${updated}/${jobs.length}...`);
  }

  console.log(`\nDone! Updated ${updated} jobs with classification tags.`);

  // Show distribution
  const allJobs = await prisma.job.findMany({ select: { tags: true } });
  const tagCounts: Record<string, number> = {};
  for (const j of allJobs) {
    if (!j.tags) continue;
    try {
      const tags: string[] = JSON.parse(j.tags);
      for (const t of tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    } catch {}
  }
  console.log('\nTag distribution:');
  Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).forEach(([tag, count]) => {
    console.log(`  ${tag}: ${count}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
