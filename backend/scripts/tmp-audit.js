const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.applicationDraft.findFirst({ where: { user: { email: { startsWith: 'phase8-e2e-' } } }, include: { audit: { orderBy: { createdAt: 'asc' } } } }).then((d) => {
  for (const a of d.audit) console.log(a.createdAt.toISOString(), a.action, a.detail);
  return p.$disconnect();
});
