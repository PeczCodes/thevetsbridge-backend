const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const animals = await prisma.animal.findMany({
    include: {
      ownerships: true,
    },
  });
  console.log('ANIMALS IN DB:', JSON.stringify(animals, null, 2));

  const targetAnimal = await prisma.animal.findUnique({
    where: { id: 'cmqu6ji9z0003u5z3xghdeuyv' },
    include: {
      ownerships: true,
    },
  });
  console.log('TARGET ANIMAL:', JSON.stringify(targetAnimal, null, 2));
}

main().catch(err => {
  console.error(err);
}).finally(async () => {
  await prisma.$disconnect();
});
