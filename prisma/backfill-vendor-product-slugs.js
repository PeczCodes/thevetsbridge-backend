const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function generateSlug(name) {
  if (!name) return 'product';
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  const listings = await prisma.vendorProduct.findMany({
    include: {
      vendor: true,
      product: true,
    }
  });

  console.log(`Found ${listings.length} vendor product listings in the database.`);

  for (const listing of listings) {
    const vendorPrefix = listing.vendor?.businessName || 'vendor';
    const baseSlug = generateSlug(`${vendorPrefix} ${listing.product.name}`);
    
    let slug = baseSlug;
    let counter = 2;

    while (true) {
      const exists = await prisma.vendorProduct.findFirst({
        where: {
          slug,
          id: { not: listing.id }
        }
      });
      if (!exists) break;
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    await prisma.vendorProduct.update({
      where: { id: listing.id },
      data: { slug }
    });

    console.log(`Updated listing ID ${listing.id} slug: "${listing.slug}" -> "${slug}"`);
  }

  console.log('Vendor product slug backfill completed.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
