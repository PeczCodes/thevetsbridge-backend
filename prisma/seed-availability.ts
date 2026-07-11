/**
 * Prisma script to seed realistic VetAvailability for all seeded vets.
 *
 * Run: npx ts-node --project tsconfig.json prisma/seed-availability.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Schedules template: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
const SCHEDULES = [
  // 1. Standard Weekday (Mon-Fri 09:00 - 17:00)
  [
    { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
    { dayOfWeek: 2, startTime: '09:00', endTime: '17:00' },
    { dayOfWeek: 3, startTime: '09:00', endTime: '17:00' },
    { dayOfWeek: 4, startTime: '09:00', endTime: '17:00' },
    { dayOfWeek: 5, startTime: '09:00', endTime: '17:00' },
  ],
  // 2. Early + Saturday (Mon-Fri 08:00 - 15:00, Sat 09:00 - 13:00)
  [
    { dayOfWeek: 1, startTime: '08:00', endTime: '15:00' },
    { dayOfWeek: 2, startTime: '08:00', endTime: '15:00' },
    { dayOfWeek: 3, startTime: '08:00', endTime: '15:00' },
    { dayOfWeek: 4, startTime: '08:00', endTime: '15:00' },
    { dayOfWeek: 5, startTime: '08:00', endTime: '15:00' },
    { dayOfWeek: 6, startTime: '09:00', endTime: '13:00' },
  ],
  // 3. Late/Evening Shift (Mon-Fri 13:00 - 21:00)
  [
    { dayOfWeek: 1, startTime: '13:00', endTime: '21:00' },
    { dayOfWeek: 2, startTime: '13:00', endTime: '21:00' },
    { dayOfWeek: 3, startTime: '13:00', endTime: '21:00' },
    { dayOfWeek: 4, startTime: '13:00', endTime: '21:00' },
    { dayOfWeek: 5, startTime: '13:00', endTime: '21:00' },
  ],
  // 4. Tue-Sat Shift (Tue-Fri 09:00 - 17:00, Sat 10:00 - 16:00)
  [
    { dayOfWeek: 2, startTime: '09:00', endTime: '17:00' },
    { dayOfWeek: 3, startTime: '09:00', endTime: '17:00' },
    { dayOfWeek: 4, startTime: '09:00', endTime: '17:00' },
    { dayOfWeek: 5, startTime: '09:00', endTime: '17:00' },
    { dayOfWeek: 6, startTime: '10:00', endTime: '16:00' },
  ],
];

async function main() {
  console.log('📅 Seeding vet availabilities...\n');

  // Fetch all approved vets
  const vets = await prisma.vetProfile.findMany({
    select: {
      id: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });

  if (vets.length === 0) {
    console.log('No vets found to seed availability for.');
    return;
  }

  let totalSlots = 0;

  for (let i = 0; i < vets.length; i++) {
    const vet = vets[i];
    // Assign a schedule template cyclically/pseudo-randomly
    const scheduleTemplate = SCHEDULES[i % SCHEDULES.length];

    await prisma.$transaction(async (tx) => {
      // Clear existing availability for this vet first (idempotent seed)
      await tx.vetAvailability.deleteMany({
        where: { vetId: vet.id },
      });

      // Insert new availability slots
      await tx.vetAvailability.createMany({
        data: scheduleTemplate.map((slot) => ({
          vetId: vet.id,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
          isActive: true,
        })),
      });
    });

    totalSlots += scheduleTemplate.length;
    console.log(
      `  ✅ Available days seeded for Dr. ${vet.user.firstName} ${vet.user.lastName} (Template ${
        (i % SCHEDULES.length) + 1
      })`
    );
  }

  console.log(`\n✨ Done. Seeded ${totalSlots} availability rows across ${vets.length} vets.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
