/**
 * Prisma seed — 20 veterinarians
 *
 * Run:
 *   npx ts-node --project tsconfig.json -e "require('tsconfig-paths/register')" prisma/seed.ts
 *   OR add to package.json → "prisma": { "seed": "ts-node prisma/seed.ts" }
 *   then: npx prisma db seed
 *
 * What it creates per vet:
 *   1. Media row  (avatarMedia stub — storageUrl is a placeholder; update the URL
 *                  directly in the DB as discussed)
 *   2. User row   (avatarMediaId linked to the Media row)
 *   3. VetProfile (status: APPROVED, linked via userId, avatarMediaId mirrored)
 *   4. UserBalance row (required by the wallet system)
 *
 * Password: "password"  (argon2 hash, same algorithm as HashingService)
 */

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

// ─── Data ────────────────────────────────────────────────────────────────────

const SPECIALIZATIONS = [
  'GENERAL_PRACTICE',
  'SMALL_ANIMAL_MEDICINE',
  'LARGE_ANIMAL_MEDICINE',
  'EXOTIC_ANIMAL_MEDICINE',
  'EQUINE_MEDICINE',
  'POULTRY_MEDICINE',
  'SURGERY',
  'INTERNAL_MEDICINE',
  'EMERGENCY_CRITICAL_CARE',
  'DERMATOLOGY',
  'CARDIOLOGY',
  'DENTISTRY',
  'RADIOLOGY',
  'REPRODUCTION',
  'NUTRITION',
  'BEHAVIOR',
  'PATHOLOGY',
] as const;

type Spec = (typeof SPECIALIZATIONS)[number];

// prettier-ignore
const VETS: Array<{
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  licenseNumber: string;
  primarySpec: Spec;
  secondarySpec?: Spec;
  experience: number;
  bio: string;
  consultationFee: number;
  rating: number;
  totalConsults: number;
}> = [
  {
    firstName: 'Adaeze',    lastName: 'Okonkwo',
    email: 'adaeze.okonkwo@vetsbridge.dev',   phone: '+2348011111001',
    licenseNumber: 'VCN-2019-001', primarySpec: 'SMALL_ANIMAL_MEDICINE',
    secondarySpec: 'DERMATOLOGY',
    experience: 8,  bio: 'Specialist in small animal medicine with a focus on skin conditions. 8 years of clinical practice across Lagos and Abuja.',
    consultationFee: 8000,  rating: 4.8, totalConsults: 312,
  },
  {
    firstName: 'Emeka',     lastName: 'Nwosu',
    email: 'emeka.nwosu@vetsbridge.dev',      phone: '+2348011111002',
    licenseNumber: 'VCN-2016-002', primarySpec: 'SURGERY',
    secondarySpec: 'EMERGENCY_CRITICAL_CARE',
    experience: 11, bio: 'Board-certified veterinary surgeon with over a decade of soft-tissue and orthopaedic surgery experience.',
    consultationFee: 15000, rating: 4.9, totalConsults: 541,
  },
  {
    firstName: 'Fatima',    lastName: 'Bello',
    email: 'fatima.bello@vetsbridge.dev',     phone: '+2348011111003',
    licenseNumber: 'VCN-2020-003', primarySpec: 'POULTRY_MEDICINE',
    experience: 5,  bio: 'Expert in poultry health, disease surveillance, and flock management. Works closely with commercial and backyard farms.',
    consultationFee: 5000,  rating: 4.6, totalConsults: 188,
  },
  {
    firstName: 'Chukwudi',  lastName: 'Eze',
    email: 'chukwudi.eze@vetsbridge.dev',     phone: '+2348011111004',
    licenseNumber: 'VCN-2018-004', primarySpec: 'LARGE_ANIMAL_MEDICINE',
    secondarySpec: 'REPRODUCTION',
    experience: 9,  bio: 'Cattle and ruminant specialist with expertise in reproduction and herd health programmes across South-East Nigeria.',
    consultationFee: 7000,  rating: 4.7, totalConsults: 260,
  },
  {
    firstName: 'Ngozi',     lastName: 'Eze',
    email: 'ngozi.eze@vetsbridge.dev',        phone: '+2348011111005',
    licenseNumber: 'VCN-2021-005', primarySpec: 'GENERAL_PRACTICE',
    experience: 4,  bio: 'General practitioner passionate about preventive care and wellness consultations for all companion animals.',
    consultationFee: 4500,  rating: 4.5, totalConsults: 95,
  },
  {
    firstName: 'Ibrahim',   lastName: 'Musa',
    email: 'ibrahim.musa@vetsbridge.dev',     phone: '+2348011111006',
    licenseNumber: 'VCN-2014-006', primarySpec: 'INTERNAL_MEDICINE',
    secondarySpec: 'CARDIOLOGY',
    experience: 13, bio: 'Internist specialising in complex multi-system diseases and cardiac conditions in dogs and cats.',
    consultationFee: 12000, rating: 4.9, totalConsults: 620,
  },
  {
    firstName: 'Amara',     lastName: 'Okafor',
    email: 'amara.okafor@vetsbridge.dev',     phone: '+2348011111007',
    licenseNumber: 'VCN-2022-007', primarySpec: 'NUTRITION',
    experience: 3,  bio: 'Dedicated to evidence-based nutritional counselling for pets and livestock across all life stages.',
    consultationFee: 4000,  rating: 4.4, totalConsults: 47,
  },
  {
    firstName: 'Babatunde', lastName: 'Adeyemi',
    email: 'babatunde.adeyemi@vetsbridge.dev', phone: '+2348011111008',
    licenseNumber: 'VCN-2015-008', primarySpec: 'EQUINE_MEDICINE',
    secondarySpec: 'SURGERY',
    experience: 12, bio: 'Equine veterinarian experienced in sport horse medicine, lameness evaluation, and field surgery.',
    consultationFee: 20000, rating: 4.8, totalConsults: 430,
  },
  {
    firstName: 'Chisom',    lastName: 'Igwe',
    email: 'chisom.igwe@vetsbridge.dev',      phone: '+2348011111009',
    licenseNumber: 'VCN-2019-009', primarySpec: 'BEHAVIOR',
    experience: 7,  bio: 'Certified animal behaviourist helping pet owners address anxiety, aggression, and training challenges.',
    consultationFee: 6000,  rating: 4.7, totalConsults: 205,
  },
  {
    firstName: 'Oluwaseun', lastName: 'Adebayo',
    email: 'oluwaseun.adebayo@vetsbridge.dev', phone: '+2348011111010',
    licenseNumber: 'VCN-2017-010', primarySpec: 'RADIOLOGY',
    experience: 10, bio: 'Diagnostic imaging specialist with expertise in X-ray, ultrasound, and advanced cross-sectional imaging.',
    consultationFee: 10000, rating: 4.8, totalConsults: 370,
  },
  {
    firstName: 'Aisha',     lastName: 'Usman',
    email: 'aisha.usman@vetsbridge.dev',      phone: '+2348011111011',
    licenseNumber: 'VCN-2020-011', primarySpec: 'EXOTIC_ANIMAL_MEDICINE',
    experience: 6,  bio: 'Exotic animal vet with hands-on experience treating reptiles, birds, rabbits, and small mammals.',
    consultationFee: 9000,  rating: 4.6, totalConsults: 142,
  },
  {
    firstName: 'Chinedu',   lastName: 'Obiora',
    email: 'chinedu.obiora@vetsbridge.dev',   phone: '+2348011111012',
    licenseNumber: 'VCN-2013-012', primarySpec: 'PATHOLOGY',
    experience: 14, bio: 'Veterinary pathologist providing necropsy, histopathology, and clinical pathology consultation services.',
    consultationFee: 11000, rating: 4.9, totalConsults: 680,
  },
  {
    firstName: 'Titilayo',  lastName: 'Olabisi',
    email: 'titilayo.olabisi@vetsbridge.dev', phone: '+2348011111013',
    licenseNumber: 'VCN-2018-013', primarySpec: 'DENTISTRY',
    experience: 8,  bio: 'Veterinary dental specialist offering oral health exams, extractions, and periodontal care for companion animals.',
    consultationFee: 8500,  rating: 4.7, totalConsults: 289,
  },
  {
    firstName: 'Yakubu',    lastName: 'Garba',
    email: 'yakubu.garba@vetsbridge.dev',     phone: '+2348011111014',
    licenseNumber: 'VCN-2016-014', primarySpec: 'LARGE_ANIMAL_MEDICINE',
    secondarySpec: 'NUTRITION',
    experience: 11, bio: 'Livestock health specialist serving smallholder and commercial farmers in Northern Nigeria.',
    consultationFee: 6500,  rating: 4.6, totalConsults: 390,
  },
  {
    firstName: 'Blessing',  lastName: 'Nwafor',
    email: 'blessing.nwafor@vetsbridge.dev',  phone: '+2348011111015',
    licenseNumber: 'VCN-2021-015', primarySpec: 'SMALL_ANIMAL_MEDICINE',
    secondarySpec: 'BEHAVIOR',
    experience: 4,  bio: 'Small animal vet with a special interest in feline medicine and behavioural enrichment.',
    consultationFee: 5500,  rating: 4.5, totalConsults: 88,
  },
  {
    firstName: 'Musa',      lastName: 'Abubakar',
    email: 'musa.abubakar@vetsbridge.dev',    phone: '+2348011111016',
    licenseNumber: 'VCN-2012-016', primarySpec: 'REPRODUCTION',
    secondarySpec: 'LARGE_ANIMAL_MEDICINE',
    experience: 15, bio: 'Senior theriogenologist with extensive experience in bovine, ovine, and caprine reproduction.',
    consultationFee: 14000, rating: 5.0, totalConsults: 790,
  },
  {
    firstName: 'Uchenna',   lastName: 'Obi',
    email: 'uchenna.obi@vetsbridge.dev',      phone: '+2348011111017',
    licenseNumber: 'VCN-2019-017', primarySpec: 'EMERGENCY_CRITICAL_CARE',
    experience: 7,  bio: '24/7 emergency and critical care veterinarian with ICU management and toxicology expertise.',
    consultationFee: 13000, rating: 4.8, totalConsults: 355,
  },
  {
    firstName: 'Zainab',    lastName: 'Sule',
    email: 'zainab.sule@vetsbridge.dev',      phone: '+2348011111018',
    licenseNumber: 'VCN-2023-018', primarySpec: 'GENERAL_PRACTICE',
    experience: 2,  bio: 'Recent graduate bringing fresh evidence-based approaches to everyday companion animal care.',
    consultationFee: 3500,  rating: 4.3, totalConsults: 22,
  },
  {
    firstName: 'Adewale',   lastName: 'Fadahunsi',
    email: 'adewale.fadahunsi@vetsbridge.dev', phone: '+2348011111019',
    licenseNumber: 'VCN-2017-019', primarySpec: 'CARDIOLOGY',
    secondarySpec: 'INTERNAL_MEDICINE',
    experience: 10, bio: 'Veterinary cardiologist offering echocardiography, Holter monitoring, and cardiac disease management.',
    consultationFee: 16000, rating: 4.9, totalConsults: 410,
  },
  {
    firstName: 'Nnenna',    lastName: 'Okafor',
    email: 'nnenna.okafor@vetsbridge.dev',    phone: '+2348011111020',
    licenseNumber: 'VCN-2018-020', primarySpec: 'POULTRY_MEDICINE',
    secondarySpec: 'PATHOLOGY',
    experience: 9,  bio: 'Poultry disease diagnostician and health consultant with a focus on biosecurity and outbreak control.',
    consultationFee: 7500,  rating: 4.7, totalConsults: 310,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  Seeding 20 veterinarians...\n');

  // Hash the shared password ONCE — argon2.hash() is slow by design
  const passwordHash = await argon2.hash('password');

  for (const vet of VETS) {
    const vetSlug = slugify(`${vet.firstName} ${vet.lastName}`);
    const userMediaPublicId = `seed_user_${randomUUID()}`;
    const vetMediaPublicId  = `seed_vet_${randomUUID()}`;

    await prisma.$transaction(async (tx) => {
      // ── 1. Create the User-level avatar Media stub ──────────────────────────
      //   storageUrl is a placeholder. You said you'll update the URL directly
      //   in the DB — this row wires up the FK so nothing else needs to change.
      const userAvatarMedia = await tx.media.create({
        data: {
          id:              randomUUID(),
          publicId:        userMediaPublicId,
          storageUrl:      `https://placeholder.vetsbridge.dev/avatars/${vetSlug}-user.jpg`,
          provider:        'EXTERNAL',
          status:          'READY',
          ownerType:       'USER',
          ownerId:         'placeholder', // updated below once we have userId
          resourceType:    'PROFILE_IMAGE',
          uploadedBy:      'seed',
        },
      });

      // ── 2. Create the User ──────────────────────────────────────────────────
      const user = await tx.user.create({
        data: {
          email:          vet.email,
          phone:          vet.phone,
          passwordHash,
          firstName:      vet.firstName,
          lastName:       vet.lastName,
          displayName:    `Dr. ${vet.firstName} ${vet.lastName}`,
          isActive:       true,
          avatarMediaId:  userAvatarMedia.id,
        },
      });

      // Backfill ownerId now that we have the real userId
      await tx.media.update({
        where: { id: userAvatarMedia.id },
        data:  { ownerId: user.id },
      });

      // ── 3. Create the VetProfile-level avatar Media stub ───────────────────
      //   VetProfile has its own avatarMediaId — this is what surfaces on vet
      //   cards and the public profile page.
      const vetAvatarMedia = await tx.media.create({
        data: {
          id:              randomUUID(),
          publicId:        vetMediaPublicId,
          storageUrl:      `https://placeholder.vetsbridge.dev/avatars/${vetSlug}-vet.jpg`,
          provider:        'EXTERNAL',
          status:          'READY',
          ownerType:       'VET',
          ownerId:         user.id,          // we have the userId now
          resourceType:    'PROFILE_IMAGE',
          uploadedBy:      'seed',
        },
      });

      // ── 4. Create the VetProfile ────────────────────────────────────────────
      const specializations: Spec[] = vet.secondarySpec
        ? [vet.primarySpec, vet.secondarySpec]
        : [vet.primarySpec];

      await tx.vetProfile.create({
        data: {
          userId:           user.id,
          slug:             vetSlug,
          specializations,
          licenseNumber:    vet.licenseNumber,
          licenseCountry:   'Nigeria',
          experience:       vet.experience,
          bio:              vet.bio,
          status:           'APPROVED',
          isAvailable:      true,
          isActive:         true,
          rating:           vet.rating,
          totalConsults:    vet.totalConsults,
          consultationFee:  vet.consultationFee,
          avatarMediaId:    vetAvatarMedia.id,
          qualifications:   [],
          languages:        ['English'],
        },
      });

      // ── 5. Create UserBalance (required by wallet/payout system) ───────────
      await tx.userBalance.create({
        data: { userId: user.id },
      });
    });

    console.log(`  ✅  ${vet.firstName} ${vet.lastName} — ${vet.primarySpec}`);
  }

  console.log('\n✨  Done. 20 vets seeded successfully.');
  console.log('👉  Update storageUrl directly in the Media table for each vet\'s avatarMediaId.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
