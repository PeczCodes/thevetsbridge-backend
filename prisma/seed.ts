import { PrismaClient, AnimalType, AnimalSex, ApplicationStatus, VetSpecialization, OwnershipStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting VetsBridge database seeding...');

  // 1. System Settings
  console.log('Seeding system settings...');
  await prisma.systemSetting.upsert({
    where: { key: 'commission_rate' },
    update: { value: '5' },
    create: {
      key: 'commission_rate',
      value: '5',
    },
  });

  // Common password hash for test accounts
  const defaultPassword = await argon2.hash('Password123!');

  // 2. Admin User
  console.log('Seeding admin user...');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@vetsbridge.org' },
    update: {
      isAdmin: true,
      isActive: true,
    },
    create: {
      email: 'admin@vetsbridge.org',
      passwordHash: defaultPassword,
      firstName: 'System',
      lastName: 'Administrator',
      displayName: 'VetsBridge Admin',
      isAdmin: true,
      isActive: true,
    },
  });

  // 3. Veterinarian User + Profile + Balance
  console.log('Seeding veterinarian...');
  const vetUser = await prisma.user.upsert({
    where: { email: 'dr.sarah@vetsbridge.org' },
    update: {
      isActive: true,
    },
    create: {
      email: 'dr.sarah@vetsbridge.org',
      passwordHash: defaultPassword,
      firstName: 'Sarah',
      lastName: 'Alabi',
      displayName: 'Dr. Sarah Alabi',
      phone: '+2348021112233',
      isActive: true,
    },
  });

  const vetProfile = await prisma.vetProfile.upsert({
    where: { userId: vetUser.id },
    update: {
      status: ApplicationStatus.APPROVED,
      isAvailable: true,
      isActive: true,
    },
    create: {
      userId: vetUser.id,
      licenseNumber: 'VCN-2024-8841',
      licenseCountry: 'Nigeria',
      specializations: [
        VetSpecialization.GENERAL_PRACTICE,
        VetSpecialization.SMALL_ANIMAL_MEDICINE,
        VetSpecialization.SURGERY,
      ],
      experience: 7,
      consultationFee: 15000.0,
      emergencyFee: 25000.0,
      bio: 'Senior Veterinary Surgeon with 7+ years of clinical and telemedicine experience in companion animal care.',
      slug: 'dr-sarah-alabi',
      status: ApplicationStatus.APPROVED,
      isAvailable: true,
      isActive: true,
      rating: 4.9,
      totalConsults: 18,
    },
  });

  await prisma.userBalance.upsert({
    where: { userId: vetUser.id },
    update: {},
    create: {
      userId: vetUser.id,
      availableBalance: 0.0,
      reservedBalance: 0.0,
      totalEarned: 0.0,
      totalWithdrawn: 0.0,
    },
  });

  // 4. Vendor User + Profile + Balance
  console.log('Seeding vendor...');
  const vendorUser = await prisma.user.upsert({
    where: { email: 'vendor@vetsbridge.org' },
    update: {
      isActive: true,
    },
    create: {
      email: 'vendor@vetsbridge.org',
      passwordHash: defaultPassword,
      firstName: 'Kolawole',
      lastName: 'Balogun',
      displayName: 'Apex Pet Supplies',
      phone: '+2348034445566',
      isActive: true,
    },
  });

  const vendorProfile = await prisma.vendorProfile.upsert({
    where: { userId: vendorUser.id },
    update: {
      status: ApplicationStatus.APPROVED,
      isActive: true,
    },
    create: {
      userId: vendorUser.id,
      businessName: 'Apex Veterinary & Pet Supplies Ltd',
      businessPhone: '+2348034445566',
      businessAddress: '14 Commercial Avenue, Yaba, Lagos',
      bio: 'Direct importer and authorized distributor of premium veterinary pharmaceuticals, clinical diets, and pet supplies.',
      slug: 'apex-pet-supplies',
      status: ApplicationStatus.APPROVED,
      isActive: true,
      rating: 5.0,
      totalSales: 42,
    },
  });

  await prisma.userBalance.upsert({
    where: { userId: vendorUser.id },
    update: {},
    create: {
      userId: vendorUser.id,
      availableBalance: 0.0,
      reservedBalance: 0.0,
      totalEarned: 0.0,
      totalWithdrawn: 0.0,
    },
  });

  // 5. Customer (Pet Owner) + Animal
  console.log('Seeding customer & pet...');
  const customerUser = await prisma.user.upsert({
    where: { email: 'customer@vetsbridge.org' },
    update: {
      isActive: true,
    },
    create: {
      email: 'customer@vetsbridge.org',
      passwordHash: defaultPassword,
      firstName: 'Emeka',
      lastName: 'Nwosu',
      displayName: 'Emeka Nwosu',
      phone: '+2348057778899',
      isActive: true,
    },
  });

  await prisma.userBalance.upsert({
    where: { userId: customerUser.id },
    update: {},
    create: {
      userId: customerUser.id,
      availableBalance: 0.0,
      reservedBalance: 0.0,
      totalEarned: 0.0,
      totalWithdrawn: 0.0,
    },
  });

  let customerAnimal = await prisma.animal.findFirst({
    where: {
      ownerships: {
        some: { userId: customerUser.id },
      },
    },
  });

  if (!customerAnimal) {
    customerAnimal = await prisma.animal.create({
      data: {
        name: 'Max',
        type: AnimalType.PET,
        breed: 'German Shepherd',
        sex: AnimalSex.MALE,
        color: 'Black & Tan',
        estimatedAgeMonths: 24,
        slug: 'max-gsd-emeka',
        ownerships: {
          create: {
            userId: customerUser.id,
            status: OwnershipStatus.ACTIVE,
          },
        },
      },
    });
  }

  // 6. Marketplace Sample Products & Listings
  console.log('Seeding marketplace products...');
  const sampleProducts = [
    {
      name: 'Broad-Spectrum Dewormer Tablets (Pack of 10)',
      description: 'Effective multi-wormer against roundworms, tapeworms, and hookworms for dogs and puppies.',
      requiresPrescription: false,
      sku: 'APEX-DEW-001',
      slug: 'broad-spectrum-dewormer-tablets',
      price: 4500.0,
      stock: 80,
    },
    {
      name: 'Nutri-Cal High-Calorie Dietary Supplement 120g',
      description: 'Veterinarian-formulated high-calorie nutritional gel supplement for convalescent or active pets.',
      requiresPrescription: false,
      sku: 'APEX-NUT-002',
      slug: 'nutri-cal-high-calorie-supplement',
      price: 9200.0,
      stock: 45,
    },
    {
      name: 'Chlorhexidine Medicated Antiseptic Pet Shampoo 500ml',
      description: 'Antibacterial and antifungal cleansing shampoo for dogs and cats experiencing dermatological conditions.',
      requiresPrescription: false,
      sku: 'APEX-SHP-003',
      slug: 'chlorhexidine-medicated-shampoo-500ml',
      price: 6800.0,
      stock: 30,
    },
  ];

  for (const item of sampleProducts) {
    let product = await prisma.product.findFirst({
      where: { name: item.name },
    });

    if (!product) {
      product = await prisma.product.create({
        data: {
          name: item.name,
          description: item.description,
          requiresPrescription: item.requiresPrescription,
        },
      });
    }

    await prisma.vendorProduct.upsert({
      where: {
        vendorId_productId: {
          vendorId: vendorProfile.id,
          productId: product.id,
        },
      },
      update: {
        price: item.price,
        stock: item.stock,
        isActive: true,
      },
      create: {
        vendorId: vendorProfile.id,
        productId: product.id,
        price: item.price,
        stock: item.stock,
        sku: item.sku,
        slug: item.slug,
        isActive: true,
      },
    });
  }

  console.log('\n✅ Database seeded successfully!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔐 Sample Accounts Created (Password for all: Password123!)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`• Admin:        admin@vetsbridge.org`);
  console.log(`• Veterinarian: dr.sarah@vetsbridge.org`);
  console.log(`• Vendor:       vendor@vetsbridge.org`);
  console.log(`• Customer:     customer@vetsbridge.org`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
