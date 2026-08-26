const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, passwordHash: true, role: true },
  });
  console.log('USERS:');
  for (const u of users) {
    console.log(`${u.email} | hash=${u.passwordHash.slice(0, 20)}... | role=${u.role}`);
  }

  // Check if demo1234 matches
  const bcrypt = require('bcryptjs');
  for (const u of users) {
    const match = bcrypt.compareSync('demo1234', u.passwordHash);
    console.log(`${u.email} matches demo1234: ${match}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
