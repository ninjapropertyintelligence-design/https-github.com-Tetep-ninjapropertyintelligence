-- CreateEnum
CREATE TYPE "ExpirySource" AS ENUM ('MANUAL', 'AI_PHOTO');

-- CreateEnum
CREATE TYPE "ExpiryStatus" AS ENUM ('ACTIVE', 'RENEWED', 'DISMISSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'EXPIRY_UPCOMING';
ALTER TYPE "NotificationType" ADD VALUE 'EXPIRY_OVERDUE';

-- CreateTable
CREATE TABLE "ExpiryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "assetId" TEXT,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "expiresAt" DATE NOT NULL,
    "lastInspectedAt" DATE,
    "servicedBy" TEXT,
    "notes" TEXT,
    "source" "ExpirySource" NOT NULL DEFAULT 'MANUAL',
    "evidenceId" TEXT,
    "confidence" DOUBLE PRECISION,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "status" "ExpiryStatus" NOT NULL DEFAULT 'ACTIVE',
    "notifyContractor" BOOLEAN NOT NULL DEFAULT false,
    "lastReminderDays" INTEGER,
    "lastOverdueNoticeAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpiryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpiryItem_organizationId_status_expiresAt_idx" ON "ExpiryItem"("organizationId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "ExpiryItem_propertyId_idx" ON "ExpiryItem"("propertyId");

-- CreateIndex
CREATE INDEX "ExpiryItem_assetId_idx" ON "ExpiryItem"("assetId");

-- AddForeignKey
ALTER TABLE "ExpiryItem" ADD CONSTRAINT "ExpiryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpiryItem" ADD CONSTRAINT "ExpiryItem_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpiryItem" ADD CONSTRAINT "ExpiryItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpiryItem" ADD CONSTRAINT "ExpiryItem_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
