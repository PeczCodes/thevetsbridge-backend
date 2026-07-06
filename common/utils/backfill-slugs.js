const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Helper functions corresponding to backend slug utility
function generateSlug(name) {
  if (!name) return 'animal';
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // remove non-alphanumeric chars except spaces and hyphens
    .replace(/\s+/g, '-')     // replace whitespace runs with a single hyphen
    .replace(/-+/g, '-')      // collapse multiple hyphens
    .replace(/^-|-$/g, '');   // trim leading/trailing hyphens
}

async function main() {
  const animals = await prisma.animal.findMany({
    where: {
      OR: [
        { slug: null },
        { slug: '' }
      ]
    }
  });

  console.log(`Found ${animals.length} animals requiring slug backfill.`);

  for (const animal of animals) {
    const baseSlug = generateSlug(animal.name);
    let slug = baseSlug;
    let counter = 2;

    while (true) {
      const exists = await prisma.animal.findFirst({
        where: { slug }
      });
      if (!exists) break;
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    await prisma.animal.update({
      where: { id: animal.id },
      data: { slug }
    });

    console.log(`Backfilled slug for animal "${animal.name}" (ID: ${animal.id}) -> "${slug}"`);
  }

  console.log('Backfill completed successfully.');
}

main()
  .catch((err) => {
    console.error('Error during backfill:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
