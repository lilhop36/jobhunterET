const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.applicationApproval.findMany({ include: { draft: { include: { job: { select: { title: true } } } } }, orderBy: { createdAt: 'asc' } }).then((rows) => {
  console.log(rows.map(r => `${r.createdAt.toISOString()} ${r.draft.job.title.slice(0,30)} ${r.contentHash.slice(0,8)} note=${r.note}`).join('\n'));
  return p.$disconnect();
});
