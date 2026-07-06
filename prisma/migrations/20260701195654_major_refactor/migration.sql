/*
  Warnings:

  - You are about to drop the column `photoUrl` on the `Animal` table. All the data in the column will be lost.
  - You are about to drop the column `url` on the `ChatMessageAttachment` table. All the data in the column will be lost.
  - You are about to drop the column `avatarUrl` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `city` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `country` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `postalCode` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `state` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `street` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `licenseDocUrl` on the `VetProfile` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[photoMediaId]` on the table `Animal` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[slug]` on the table `Animal` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[mediaId]` on the table `ChatMessageAttachment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[avatarMediaId]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[slug]` on the table `VendorProduct` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[avatarMediaId]` on the table `VendorProfile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[slug]` on the table `VendorProfile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[licenseDocMediaId]` on the table `VetProfile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[avatarMediaId]` on the table `VetProfile` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `mediaId` to the `ChatMessageAttachment` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AnimalAgeType" AS ENUM ('EXACT', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "MediaOwnerType" AS ENUM ('USER', 'VET', 'VENDOR', 'PRODUCT', 'ANIMAL', 'CONSULTATION', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "MediaResourceType" AS ENUM ('PROFILE_IMAGE', 'PRODUCT_IMAGE', 'PRODUCT_VIDEO', 'LOGO', 'BANNER', 'LICENSE_DOCUMENT', 'MEDICAL_DOCUMENT', 'CONSULTATION_IMAGE', 'CONSULTATION_VIDEO');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'UPLOADING', 'READY', 'DELETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaProvider" AS ENUM ('CLOUDINARY', 'S3', 'R2', 'EXTERNAL');

-- DropIndex
DROP INDEX "ChatMessage_channelId_idx";

-- DropIndex
DROP INDEX "ChatMessage_consultationId_idx";

-- AlterTable
ALTER TABLE "Animal" DROP COLUMN "photoUrl",
ADD COLUMN     "ageType" "AnimalAgeType",
ADD COLUMN     "estimatedAgeMonths" INTEGER,
ADD COLUMN     "medicalNotes" TEXT,
ADD COLUMN     "photoMediaId" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "weight" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "type" "MessageType" NOT NULL DEFAULT 'TEXT',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ChatMessageAttachment" DROP COLUMN "url",
ADD COLUMN     "mediaId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "avatarUrl",
DROP COLUMN "city",
DROP COLUMN "country",
DROP COLUMN "postalCode",
DROP COLUMN "state",
DROP COLUMN "street",
ADD COLUMN     "avatarMediaId" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "VendorProduct" ADD COLUMN     "slug" TEXT;

-- AlterTable
ALTER TABLE "VendorProfile" ADD COLUMN     "avatarMediaId" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "slug" TEXT,
ALTER COLUMN "rating" SET DEFAULT 5.0;

-- AlterTable
ALTER TABLE "VetProfile" DROP COLUMN "licenseDocUrl",
ADD COLUMN     "avatarMediaId" TEXT,
ADD COLUMN     "licenseDocMediaId" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ALTER COLUMN "rating" SET DEFAULT 5.0;

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "UploadIntent" (
    "id" TEXT NOT NULL,
    "ownerType" "MediaOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "resourceType" "MediaResourceType" NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "provider" "MediaProvider" NOT NULL DEFAULT 'CLOUDINARY',
    "providerAssetId" TEXT,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "ownerType" "MediaOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "resourceType" "MediaResourceType" NOT NULL,
    "mimeType" TEXT,
    "format" TEXT,
    "bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "duration" DOUBLE PRECISION,
    "originalFilename" TEXT,
    "version" TEXT,
    "etag" TEXT,
    "sha256" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "dbVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UploadIntent_uploaderId_idx" ON "UploadIntent"("uploaderId");

-- CreateIndex
CREATE UNIQUE INDEX "Media_publicId_key" ON "Media"("publicId");

-- CreateIndex
CREATE INDEX "Media_ownerType_ownerId_idx" ON "Media"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "Media_uploadedBy_idx" ON "Media"("uploadedBy");

-- CreateIndex
CREATE UNIQUE INDEX "Animal_photoMediaId_key" ON "Animal"("photoMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "Animal_slug_key" ON "Animal"("slug");

-- CreateIndex
CREATE INDEX "Animal_slug_idx" ON "Animal"("slug");

-- CreateIndex
CREATE INDEX "ChatMessage_consultationId_createdAt_idx" ON "ChatMessage"("consultationId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_channelId_createdAt_idx" ON "ChatMessage"("channelId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessageAttachment_mediaId_key" ON "ChatMessageAttachment"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "User_avatarMediaId_key" ON "User"("avatarMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorProduct_slug_key" ON "VendorProduct"("slug");

-- CreateIndex
CREATE INDEX "VendorProduct_slug_idx" ON "VendorProduct"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "VendorProfile_avatarMediaId_key" ON "VendorProfile"("avatarMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorProfile_slug_key" ON "VendorProfile"("slug");

-- CreateIndex
CREATE INDEX "VendorProfile_slug_idx" ON "VendorProfile"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "VetProfile_licenseDocMediaId_key" ON "VetProfile"("licenseDocMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "VetProfile_avatarMediaId_key" ON "VetProfile"("avatarMediaId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_avatarMediaId_fkey" FOREIGN KEY ("avatarMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VetProfile" ADD CONSTRAINT "VetProfile_licenseDocMediaId_fkey" FOREIGN KEY ("licenseDocMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VetProfile" ADD CONSTRAINT "VetProfile_avatarMediaId_fkey" FOREIGN KEY ("avatarMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorProfile" ADD CONSTRAINT "VendorProfile_avatarMediaId_fkey" FOREIGN KEY ("avatarMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_photoMediaId_fkey" FOREIGN KEY ("photoMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessageAttachment" ADD CONSTRAINT "ChatMessageAttachment_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
