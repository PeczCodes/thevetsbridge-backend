/**
 * Multiply consultationFee × 3 for every VetProfile where fee < 11000.
 *
 * Run: npx ts-node --project tsconfig.json prisma/multiply-fees.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Preview before touching anything
  const affected = await prisma.vetProfile.findMany({
    where: { consultationFee: { lt: 11000 } },
    select: {
      id: true,
      consultationFee: true,
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: { consultationFee: 'asc' },
  });

  if (affected.length === 0) {
    console.log('No vets with consultationFee < 11000. Nothing to update.');
    return;
  }

  console.log(`\n📋  ${affected.length} vets will be updated:\n`);
  for (const v of affected) {
    const before = Number(v.consultationFee);
    console.log(
      `  ${v.user.firstName} ${v.user.lastName}`.padEnd(30) +
      `₦${before.toLocaleString()}  →  ₦${(before * 3).toLocaleString()}`,
    );
  }

  // Single atomic UPDATE — Prisma Decimal columns map to NUMERIC in Postgres
  const result = await prisma.$executeRaw`
    UPDATE "VetProfile"
    SET    "consultationFee" = "consultationFee" * 3
    WHERE  "consultationFee" < 11000
  `;

  console.log(`\n✅  Updated ${result} rows.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
