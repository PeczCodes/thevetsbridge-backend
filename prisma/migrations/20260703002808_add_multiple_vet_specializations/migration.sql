/*
  Warnings:

  - You are about to drop the column `specialization` on the `VetProfile` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VetSpecialization" ADD VALUE 'EXOTIC_ANIMAL_MEDICINE';
ALTER TYPE "VetSpecialization" ADD VALUE 'EQUINE_MEDICINE';
ALTER TYPE "VetSpecialization" ADD VALUE 'POULTRY_MEDICINE';
ALTER TYPE "VetSpecialization" ADD VALUE 'INTERNAL_MEDICINE';
ALTER TYPE "VetSpecialization" ADD VALUE 'DERMATOLOGY';
ALTER TYPE "VetSpecialization" ADD VALUE 'CARDIOLOGY';
ALTER TYPE "VetSpecialization" ADD VALUE 'DENTISTRY';
ALTER TYPE "VetSpecialization" ADD VALUE 'RADIOLOGY';
ALTER TYPE "VetSpecialization" ADD VALUE 'REPRODUCTION';
ALTER TYPE "VetSpecialization" ADD VALUE 'NUTRITION';
ALTER TYPE "VetSpecialization" ADD VALUE 'BEHAVIOR';
ALTER TYPE "VetSpecialization" ADD VALUE 'PATHOLOGY';

-- DropIndex
DROP INDEX "VetProfile_specialization_idx";

-- AlterTable
ALTER TABLE "VetProfile" DROP COLUMN "specialization",
ADD COLUMN     "specializations" "VetSpecialization"[] DEFAULT ARRAY['GENERAL_PRACTICE']::"VetSpecialization"[];

-- CreateIndex
CREATE INDEX "VetProfile_specializations_idx" ON "VetProfile"("specializations");
