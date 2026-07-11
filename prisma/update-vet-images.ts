/**
 * One-shot script: updates all 20 seeded vets' Media.storageUrl
 * to /doctors/[1-20] (served from the frontend public folder).
 *
 * Updates both:
 *   - VetProfile.avatarMedia.storageUrl  (shown on vet cards + public profile)
 *   - User.avatarMedia.storageUrl        (shown on auth/me avatar fallback)
 *
 * Run: ts-node --project tsconfig.json prisma/update-vet-images.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Same order as the seed — index + 1 = image number
const VET_EMAILS_ORDERED = [
  'adaeze.okonkwo@vetsbridge.dev',
  'emeka.nwosu@vetsbridge.dev',
  'fatima.bello@vetsbridge.dev',
  'chukwudi.eze@vetsbridge.dev',
  'ngozi.eze@vetsbridge.dev',
  'ibrahim.musa@vetsbridge.dev',
  'amara.okafor@vetsbridge.dev',
  'babatunde.adeyemi@vetsbridge.dev',
  'chisom.igwe@vetsbridge.dev',
  'oluwaseun.adebayo@vetsbridge.dev',
  'aisha.usman@vetsbridge.dev',
  'chinedu.obiora@vetsbridge.dev',
  'titilayo.olabisi@vetsbridge.dev',
  'yakubu.garba@vetsbridge.dev',
  'blessing.nwafor@vetsbridge.dev',
  'musa.abubakar@vetsbridge.dev',
  'uchenna.obi@vetsbridge.dev',
  'zainab.sule@vetsbridge.dev',
  'adewale.fadahunsi@vetsbridge.dev',
  'nnenna.okafor@vetsbridge.dev',
];

async function main() {
  console.log('🖼️  Updating vet avatar URLs...\n');

  for (let i = 0; i < VET_EMAILS_ORDERED.length; i++) {
    const email    = VET_EMAILS_ORDERED[i];
    const imageNum = i + 1;
    const imageUrl = `/doctors/${imageNum}.jpg`;

    const user = await prisma.user.findUnique({
      where:   { email },
      include: {
        avatarMedia: true,
        vetProfile:  { include: { avatarMedia: true } },
      },
    });

    if (!user) {
      console.warn(`  ⚠️  User not found for ${email} — skipping`);
      continue;
    }

    await prisma.$transaction(async (tx) => {
      // Update VetProfile avatar (primary — what the frontend reads)
      if (user.vetProfile?.avatarMediaId) {
        await tx.media.update({
          where: { id: user.vetProfile.avatarMediaId },
          data:  { storageUrl: imageUrl, provider: 'EXTERNAL' },
        });
      }

      // Update User avatar (fallback used by auth/me)
      if (user.avatarMediaId) {
        await tx.media.update({
          where: { id: user.avatarMediaId },
          data:  { storageUrl: imageUrl, provider: 'EXTERNAL' },
        });
      }
    });

    console.log(`  ✅  /doctors/${imageNum}  →  ${user.firstName} ${user.lastName}`);
  }

  console.log('\n✨  All avatar URLs updated.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
