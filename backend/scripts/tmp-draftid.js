const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.applicationDraft
  .findFirst({
    where: { user: { email: { startsWith: 'phase8-e2e-' } } },
    select: { id: true, jobId: true, userId: true, job: { select: { title: true } } },
  })
  .then((d) => { console.log(JSON.stringify(d)); return p.$disconnect(); });
