/**
 * One-time script: backfill slugs for VetProfiles and VendorProfiles
 * that were created before slug auto-generation was added.
 *
 * Run: npx ts-node --project tsconfig.json prisma/backfill-slugs.ts
 */

import { PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';

const logger = new Logger('BackfillSlugs');

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function uniqueSlug(
  base: string,
  checkExists: (slug: string) => Promise<boolean>,
): Promise<string> {
  let slug = base;
  let counter = 2;
  while (await checkExists(slug)) {
    slug = `${base}-${counter}`;
    counter++;
  }
  return slug;
}

async function main() {
  const prisma = new PrismaClient();

  try {
    // ── Backfill VetProfiles ──────────────────────────────────────────────────
    const vetsWithoutSlug = await prisma.vetProfile.findMany({
      where: { slug: null },
      include: { user: true },
    });

    logger.log(`Found ${vetsWithoutSlug.length} vet profile(s) without slugs`);

    for (const vet of vetsWithoutSlug) {
      const fullName = `${vet.user.firstName} ${vet.user.lastName}`;
      const baseSlug = generateSlug(fullName);
      const slug = await uniqueSlug(baseSlug, async (s) => {
        const existing = await prisma.vetProfile.findFirst({
          where: { slug: s, id: { not: vet.id } },
        });
        return !!existing;
      });

      await prisma.vetProfile.update({ where: { id: vet.id }, data: { slug } });
      logger.log(`  ✓ VetProfile ${vet.id} → slug: "${slug}"`);
    }

    // ── Backfill VendorProfiles ───────────────────────────────────────────────
    const vendorsWithoutSlug = await prisma.vendorProfile.findMany({
      where: { slug: null },
      include: { user: true },
    });

    logger.log(`Found ${vendorsWithoutSlug.length} vendor profile(s) without slugs`);

    for (const vendor of vendorsWithoutSlug) {
      const fullName = `${vendor.user.firstName} ${vendor.user.lastName}`;
      const baseSlug = generateSlug(fullName);
      const slug = await uniqueSlug(baseSlug, async (s) => {
        const existing = await prisma.vendorProfile.findFirst({
          where: { slug: s, id: { not: vendor.id } },
        });
        return !!existing;
      });

      await prisma.vendorProfile.update({ where: { id: vendor.id }, data: { slug } });
      logger.log(`  ✓ VendorProfile ${vendor.id} → slug: "${slug}"`);
    }

    logger.log('Slug backfill complete!');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  logger.error('Error during slug backfill', e);
  process.exit(1);
});
