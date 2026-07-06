/*
  Warnings:

  - The values [ACTIVE] on the enum `ConsultationStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [IN_TRANSIT,FAILED,RETURNED] on the enum `ShipmentStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `breedId` on the `Animal` table. All the data in the column will be lost.
  - You are about to drop the column `speciesId` on the `Animal` table. All the data in the column will be lost.
  - You are about to drop the column `deletedAt` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the `AnimalBreed` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AnimalSpecies` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PaymentEvent` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PaymentTransaction` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `VetEarning` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `VetWithdrawal` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WebhookEvent` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[consultationId]` on the table `MedicalRecord` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[orderId,vendorId]` on the table `Shipment` will be added. If there are existing duplicate values, this will fail.
  - Made the column `shippingCost` on table `Order` required. This step will fail if there are existing NULL values in that column.
  - Made the column `subtotal` on table `Order` required. This step will fail if there are existing NULL values in that column.
  - Made the column `totalPrice` on table `OrderItem` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `shippingFee` to the `Shipment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `vendorId` to the `Shipment` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('CUSTOMER_NO_SHOW', 'VET_NO_SHOW', 'CUSTOMER_CANCELLED', 'VET_CANCELLED', 'PAYMENT_TIMEOUT', 'ADMIN_CANCELLED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED_REFUNDED', 'RESOLVED_RELEASED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ShippingStrategy" AS ENUM ('FLAT_RATE', 'BASE_ADDITIONAL');

-- CreateEnum
CREATE TYPE "ShippingMethod" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "FinancialTxType" AS ENUM ('WITHDRAWAL', 'ESCROW_RELEASE', 'REFUND', 'PLATFORM_COMMISSION', 'ADJUSTMENT', 'BONUS');

-- CreateEnum
CREATE TYPE "FinancialTxStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterEnum
BEGIN;
CREATE TYPE "ConsultationStatus_new" AS ENUM ('SCHEDULED', 'CONFIRMED', 'LIVE', 'COMPLETED', 'DISPUTED', 'RESOLVED', 'CANCELLED');
ALTER TABLE "Consultation" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Consultation" ALTER COLUMN "status" TYPE "ConsultationStatus_new" USING ("status"::text::"ConsultationStatus_new");
ALTER TYPE "ConsultationStatus" RENAME TO "ConsultationStatus_old";
ALTER TYPE "ConsultationStatus_new" RENAME TO "ConsultationStatus";
DROP TYPE "ConsultationStatus_old";
ALTER TABLE "Consultation" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ShipmentStatus_new" AS ENUM ('PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED');
ALTER TABLE "Shipment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Shipment" ALTER COLUMN "status" TYPE "ShipmentStatus_new" USING ("status"::text::"ShipmentStatus_new");
ALTER TABLE "ShipmentEvent" ALTER COLUMN "status" TYPE "ShipmentStatus_new" USING ("status"::text::"ShipmentStatus_new");
ALTER TYPE "ShipmentStatus" RENAME TO "ShipmentStatus_old";
ALTER TYPE "ShipmentStatus_new" RENAME TO "ShipmentStatus";
DROP TYPE "ShipmentStatus_old";
ALTER TABLE "Shipment" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- DropForeignKey
ALTER TABLE "Animal" DROP CONSTRAINT "Animal_breedId_fkey";

-- DropForeignKey
ALTER TABLE "Animal" DROP CONSTRAINT "Animal_speciesId_fkey";

-- DropForeignKey
ALTER TABLE "AnimalBreed" DROP CONSTRAINT "AnimalBreed_speciesId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentEvent" DROP CONSTRAINT "PaymentEvent_paymentId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentTransaction" DROP CONSTRAINT "PaymentTransaction_paymentId_fkey";

-- DropForeignKey
ALTER TABLE "VetEarning" DROP CONSTRAINT "VetEarning_appointmentId_fkey";

-- DropForeignKey
ALTER TABLE "VetEarning" DROP CONSTRAINT "VetEarning_vetId_fkey";

-- DropForeignKey
ALTER TABLE "VetWithdrawal" DROP CONSTRAINT "VetWithdrawal_vetId_fkey";

-- DropIndex
DROP INDEX "Animal_microchipId_idx";

-- DropIndex
DROP INDEX "Animal_slug_idx";

-- DropIndex
DROP INDEX "Animal_speciesId_idx";

-- DropIndex
DROP INDEX "Coupon_code_idx";

-- DropIndex
DROP INDEX "OutboxEvent_published_idx";

-- DropIndex
DROP INDEX "Payment_reference_idx";

-- DropIndex
DROP INDEX "Shipment_orderId_key";

-- DropIndex
DROP INDEX "VendorProduct_slug_idx";

-- DropIndex
DROP INDEX "VendorProfile_slug_idx";

-- DropIndex
DROP INDEX "VetProfile_slug_idx";

-- DropIndex
DROP INDEX "WebhookEventLog_eventId_idx";

-- AlterTable
ALTER TABLE "Animal" DROP COLUMN "breedId",
DROP COLUMN "speciesId";

-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN     "cancellationReason" "CancellationReason",
ADD COLUMN     "customerJoinedAt" TIMESTAMP(3),
ADD COLUMN     "disputeWindowExpiresAt" TIMESTAMP(3),
ADD COLUMN     "files" JSONB,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "summarySubmittedAt" TIMESTAMP(3),
ADD COLUMN     "symptoms" TEXT,
ADD COLUMN     "vetJoinedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MedicalRecord" ADD COLUMN     "consultationId" TEXT;

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "deletedAt",
ALTER COLUMN "shippingCost" SET NOT NULL,
ALTER COLUMN "shippingCost" SET DEFAULT 0.0,
ALTER COLUMN "subtotal" SET NOT NULL,
ALTER COLUMN "subtotal" SET DEFAULT 0.0;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "shipmentId" TEXT,
ALTER COLUMN "totalPrice" SET NOT NULL,
ALTER COLUMN "totalPrice" SET DEFAULT 0.0;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "estimatedDeliveryDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "shippingFee" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "shippingMethod" "ShippingMethod" NOT NULL DEFAULT 'DELIVERY',
ADD COLUMN     "vendorId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockoutUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "VendorProfile" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "VetProfile" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- DropTable
DROP TABLE "AnimalBreed";

-- DropTable
DROP TABLE "AnimalSpecies";

-- DropTable
DROP TABLE "PaymentEvent";

-- DropTable
DROP TABLE "PaymentTransaction";

-- DropTable
DROP TABLE "VetEarning";

-- DropTable
DROP TABLE "VetWithdrawal";

-- DropTable
DROP TABLE "WebhookEvent";

-- DropEnum
DROP TYPE "EarningStatus";

-- DropEnum
DROP TYPE "InventoryTransactionType";

-- DropEnum
DROP TYPE "ListingType";

-- DropEnum
DROP TYPE "VetVerificationStatus";

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorShippingProfile" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "shippingStrategy" "ShippingStrategy" NOT NULL DEFAULT 'FLAT_RATE',
    "baseShippingFee" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "additionalItemFee" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "freeShippingThreshold" DECIMAL(12,2),
    "supportsPickup" BOOLEAN NOT NULL DEFAULT false,
    "estimatedDeliveryDays" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorShippingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "availableBalance" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "reservedBalance" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "totalEarned" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "totalWithdrawn" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerPayoutAccount" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "providerRecipientCode" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerPayoutAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payoutAccountId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "type" "FinancialTxType" NOT NULL,
    "status" "FinancialTxStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT NOT NULL,
    "providerRef" TEXT,
    "providerTransferCode" TEXT,
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialTxStatusLog" (
    "id" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "fromStatus" "FinancialTxStatus",
    "toStatus" "FinancialTxStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialTxStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationSession" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "sessionToken" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationPresence" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "online" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ConsultationPresence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationDispute" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "VendorShippingProfile_vendorId_key" ON "VendorShippingProfile"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBalance_userId_key" ON "UserBalance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerPayoutAccount_workerId_bankCode_accountNumber_key" ON "WorkerPayoutAccount"("workerId", "bankCode", "accountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialTransaction_reference_key" ON "FinancialTransaction"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialTransaction_providerRef_key" ON "FinancialTransaction"("providerRef");

-- CreateIndex
CREATE INDEX "FinancialTransaction_userId_idx" ON "FinancialTransaction"("userId");

-- CreateIndex
CREATE INDEX "FinancialTxStatusLog_txId_idx" ON "FinancialTxStatusLog"("txId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationSession_consultationId_key" ON "ConsultationSession"("consultationId");

-- CreateIndex
CREATE INDEX "ConsultationPresence_consultationId_idx" ON "ConsultationPresence"("consultationId");

-- CreateIndex
CREATE INDEX "ConsultationPresence_userId_idx" ON "ConsultationPresence"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationDispute_consultationId_key" ON "ConsultationDispute"("consultationId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalRecord_consultationId_key" ON "MedicalRecord"("consultationId");

-- CreateIndex
CREATE INDEX "OrderItem_shipmentId_idx" ON "OrderItem"("shipmentId");

-- CreateIndex
CREATE INDEX "OutboxEvent_published_createdAt_idx" ON "OutboxEvent"("published", "createdAt");

-- CreateIndex
CREATE INDEX "Shipment_vendorId_idx" ON "Shipment"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_orderId_vendorId_key" ON "Shipment"("orderId", "vendorId");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorShippingProfile" ADD CONSTRAINT "VendorShippingProfile_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "VendorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecord" ADD CONSTRAINT "MedicalRecord_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "VendorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBalance" ADD CONSTRAINT "UserBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerPayoutAccount" ADD CONSTRAINT "WorkerPayoutAccount_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_payoutAccountId_fkey" FOREIGN KEY ("payoutAccountId") REFERENCES "WorkerPayoutAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTxStatusLog" ADD CONSTRAINT "FinancialTxStatusLog_txId_fkey" FOREIGN KEY ("txId") REFERENCES "FinancialTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationSession" ADD CONSTRAINT "ConsultationSession_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationPresence" ADD CONSTRAINT "ConsultationPresence_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationDispute" ADD CONSTRAINT "ConsultationDispute_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationDispute" ADD CONSTRAINT "ConsultationDispute_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationDispute" ADD CONSTRAINT "ConsultationDispute_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
