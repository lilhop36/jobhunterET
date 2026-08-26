/**
 * Backfill canonical categories on existing jobs that were collected before
 * category-aware collection landed.
 *
 * Run once: npx ts-node scripts/backfill-categories.ts
 */
import { PrismaClient } from '@prisma/client';
import { mapSourceCategories } from '../src/modules/sources/categories/category-mapper';
import * as sourceConfigs from '../src/modules/sources/source-configs.json';

const prisma = new PrismaClient();

async function main() {
  // Find all jobs without categories (empty or null)
  const jobs = await prisma.job.findMany({
    where: { OR: [{ categories: null }, { categories: '[]' }] },
    select: { id: true, title: true, sourceId: true, sourceJobId: true, rawData: true },
  });

  console.log(`Found ${jobs.length} jobs without categories`);

  let updated = 0;
  let unmapped = 0;
  const bucket: Record<string, number> = {};

  for (const job of jobs) {
    const sourceCats = (job.rawData as any)?.sourceCategories as string[] | undefined;
    const categories = mapSourceCategories(job.sourceId, sourceCats ?? [], {
      title: job.title,
      skills: [],
      sourceJobId: job.sourceJobId,
    } as any);

    const payload = JSON.stringify(categories);

    await prisma.job.update({
      where: { id: job.id },
      data: { categories: payload },
    });

    updated++;
    for (const c of categories) bucket[c] = (bucket[c] ?? 0) + 1;
    if (categories.length === 0) unmapped++;

    if (updated % 100 === 0) console.log(`  Updated ${updated}/${jobs.length}...`);
  }

  console.log(`\nDone! Updated ${updated} jobs.`);
  console.log(`  Unmapped: ${unmapped}`);
  console.log('\nCategory distribution:');
  Object.entries(bucket)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => console.log(`  ${cat}: ${count}`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
