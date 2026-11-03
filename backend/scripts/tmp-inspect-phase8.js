const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const user = await p.user.findFirst({ where: { email: { startsWith: 'phase8-e2e-' } } });
  const draft = await p.applicationDraft.findFirst({ where: { userId: user.id }, include: { revisions: { orderBy: { version: 'asc' } }, package: true, approvals: true, audit: true } });
  console.log('draft revisions:', draft.revisions.map(r => `v${r.version}:${r.contentHash.slice(0,8)}`).join(' '));
  console.log('unique hashes:', new Set(draft.revisions.map(r => r.contentHash)).size);
  console.log('approvals:', draft.approvals.length, 'audit:', draft.audit.length);
  const pkg = JSON.parse(draft.package.content);
  const first = JSON.parse(draft.revisions[0].content);
  console.log('revision 1 equals generated package:', first.cv === pkg.cv && first.coverLetter === pkg.coverLetter);
  const latest = JSON.parse(draft.revisions[draft.revisions.length - 1].content);
  console.log('latest differs from generated:', latest.cv !== pkg.cv || latest.coverLetter !== pkg.coverLetter);
  console.log('package still has only 1 version:', await p.applicationPackage.count({ where: { userId: user.id } }));
  await p.$disconnect();
})();
