/*
  Warnings:

  - The values [TRANSFERRED] on the enum `AnimalStatus` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[userId,organizationId]` on the table `OrganizationMember` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[vendorId,productId]` on the table `VendorProduct` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `status` to the `AnimalOwnership` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Organization` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `role` on the `OrganizationMember` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `updatedAt` to the `Product` table without a default value. This is not possible if the table is not empty.
  - Added the required column `firstName` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastName` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `VendorProduct` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `VendorProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `VetProfile` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'MANAGER', 'STAFF', 'VET');

-- CreateEnum
CREATE TYPE "OwnershipStatus" AS ENUM ('ACTIVE', 'TRANSFERRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN', 'REMOVED');

-- AlterEnum
BEGIN;
CREATE TYPE "AnimalStatus_new" AS ENUM ('ACTIVE', 'DECEASED');
ALTER TABLE "Animal" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Animal" ALTER COLUMN "status" TYPE "AnimalStatus_new" USING ("status"::text::"AnimalStatus_new");
ALTER TYPE "AnimalStatus" RENAME TO "AnimalStatus_old";
ALTER TYPE "AnimalStatus_new" RENAME TO "AnimalStatus";
DROP TYPE "AnimalStatus_old";
ALTER TABLE "Animal" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;

-- AlterTable
ALTER TABLE "AnimalOwnership" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "status" "OwnershipStatus" NOT NULL;

-- AlterTable
ALTER TABLE "ChatMessage" ALTER COLUMN "content" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN     "followUpExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DirectChannel" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "OrganizationMember" DROP COLUMN "role",
ADD COLUMN     "role" "OrganizationRole" NOT NULL;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "firstName" TEXT NOT NULL,
ADD COLUMN     "lastName" TEXT NOT NULL,
ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "VendorProduct" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "VendorProfile" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "VetProfile" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "ChatMessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" "AttachmentType" NOT NULL,
    "size" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VetReview" (
    "id" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "vetId" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VetReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorReview" (
    "id" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductReview" (
    "id" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "comment" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatMessageAttachment_messageId_idx" ON "ChatMessageAttachment"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "VetReview_consultationId_key" ON "VetReview"("consultationId");

-- CreateIndex
CREATE INDEX "VetReview_vetId_idx" ON "VetReview"("vetId");

-- CreateIndex
CREATE INDEX "VetReview_reviewerId_idx" ON "VetReview"("reviewerId");

-- CreateIndex
CREATE INDEX "VendorReview_vendorId_idx" ON "VendorReview"("vendorId");

-- CreateIndex
CREATE INDEX "VendorReview_reviewerId_idx" ON "VendorReview"("reviewerId");

-- CreateIndex
CREATE INDEX "ProductReview_productId_idx" ON "ProductReview"("productId");

-- CreateIndex
CREATE INDEX "ProductReview_reviewerId_idx" ON "ProductReview"("reviewerId");

-- CreateIndex
CREATE INDEX "Animal_organizationId_idx" ON "Animal"("organizationId");

-- CreateIndex
CREATE INDEX "Animal_status_idx" ON "Animal"("status");

-- CreateIndex
CREATE INDEX "AnimalOwnership_animalId_idx" ON "AnimalOwnership"("animalId");

-- CreateIndex
CREATE INDEX "AnimalOwnership_userId_idx" ON "AnimalOwnership"("userId");

-- CreateIndex
CREATE INDEX "AnimalOwnership_animalId_endDate_idx" ON "AnimalOwnership"("animalId", "endDate");

-- CreateIndex
CREATE INDEX "ChatMessage_senderId_idx" ON "ChatMessage"("senderId");

-- CreateIndex
CREATE INDEX "Consultation_scheduledAt_idx" ON "Consultation"("scheduledAt");

-- CreateIndex
CREATE INDEX "Consultation_customerId_idx" ON "Consultation"("customerId");

-- CreateIndex
CREATE INDEX "Consultation_vetId_idx" ON "Consultation"("vetId");

-- CreateIndex
CREATE INDEX "Consultation_status_idx" ON "Consultation"("status");

-- CreateIndex
CREATE INDEX "DirectChannel_customerId_idx" ON "DirectChannel"("customerId");

-- CreateIndex
CREATE INDEX "DirectChannel_vetId_idx" ON "DirectChannel"("vetId");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "OrderItem_vendorProductId_idx" ON "OrderItem"("vendorProductId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_userId_organizationId_key" ON "OrganizationMember"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "OutboxEvent_published_idx" ON "OutboxEvent"("published");

-- CreateIndex
CREATE INDEX "OutboxEvent_type_idx" ON "OutboxEvent"("type");

-- CreateIndex
CREATE INDEX "Prescription_animalId_idx" ON "Prescription"("animalId");

-- CreateIndex
CREATE INDEX "Prescription_vetId_idx" ON "Prescription"("vetId");

-- CreateIndex
CREATE INDEX "Prescription_consultationId_idx" ON "Prescription"("consultationId");

-- CreateIndex
CREATE INDEX "PrescriptionItem_productId_idx" ON "PrescriptionItem"("productId");

-- CreateIndex
CREATE INDEX "VendorProduct_vendorId_idx" ON "VendorProduct"("vendorId");

-- CreateIndex
CREATE INDEX "VendorProduct_productId_idx" ON "VendorProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorProduct_vendorId_productId_key" ON "VendorProduct"("vendorId", "productId");

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_vetId_fkey" FOREIGN KEY ("vetId") REFERENCES "VetProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessageAttachment" ADD CONSTRAINT "ChatMessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VetReview" ADD CONSTRAINT "VetReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VetReview" ADD CONSTRAINT "VetReview_vetId_fkey" FOREIGN KEY ("vetId") REFERENCES "VetProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorReview" ADD CONSTRAINT "VendorReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorReview" ADD CONSTRAINT "VendorReview_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "VendorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
