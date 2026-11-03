/** Delete temporary Phase 8 test accounts (and their uploaded files). */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const emails = args.length
  ? args
  : ['phase8-e2e-', 'phase8-iso-'];

(async () => {
  const users = await prisma.user.findMany({
    where: {
      OR: emails.map((e) =>
        e.endsWith('-') || e.endsWith('@jobhunter.et')
          ? { email: { startsWith: e } }
          : { email: e },
      ),
    },
    select: { id: true, email: true },
  });
  for (const user of users) {
    await prisma.user.delete({ where: { id: user.id } });
    const dir = path.join(process.cwd(), 'uploads', 'cv', user.id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    console.log(`deleted ${user.email} (${user.id})`);
  }
  const remaining = await prisma.applicationDraft.count();
  const packs = await prisma.applicationPackage.count();
  console.log(`remaining drafts=${remaining} packages=${packs}`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});