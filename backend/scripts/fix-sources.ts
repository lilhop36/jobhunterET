import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Re-enable ETCareers
  const etcareers = await prisma.jobSource.findUnique({ where: { id: 'etcareers' } });
  if (etcareers) {
    await prisma.jobSource.update({
      where: { id: 'etcareers' },
      data: { status: 'ACTIVE', consecutiveFailures: 0, lastError: null, lastFailedRun: null },
    });
    console.log('Re-enabled ETCareers source');
  } else {
    console.log('ETCareers source not found — skipping');
  }

  // 2. Remove orphan hahu source
  const hahu = await prisma.jobSource.findUnique({ where: { id: 'hahu' } });
  if (hahu) {
    await prisma.jobSource.delete({ where: { id: 'hahu' } });
    console.log('Deleted orphan hahu source');
  } else {
    console.log('hahu source not found — skipping');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
