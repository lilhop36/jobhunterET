const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const d = await p.applicationDraft.findUnique({ where: { id: 'cmw0drb32006fzt0v6kiqruiy' }, include: { revisions: { orderBy: { version: 'desc' } }, audit: { orderBy: { createdAt: 'asc' } } } });
  console.log('attestedHash:', d.attestedHash);
  console.log('latest:', d.revisions[0].version, d.revisions[0].contentHash);
  for (const a of d.audit) console.log(a.createdAt.toISOString(), a.action, a.detail);
  await p.$disconnect();
})();
