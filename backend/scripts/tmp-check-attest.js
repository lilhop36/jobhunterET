const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.applicationDraft.findFirst({ where: { user: { email: { startsWith: 'phase8-e2e-' } } }, include: { revisions: { orderBy: { version: 'desc' }, take: 1 } } }).then((d) => {
  console.log(JSON.stringify({ attestedHash: d.attestedHash, latestHash: d.revisions[0].contentHash, latestVersion: d.revisions[0].version }));
  return p.$disconnect();
});
