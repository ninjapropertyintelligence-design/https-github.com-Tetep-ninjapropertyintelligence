-- CreateEnum
CREATE TYPE "DeletionTargetType" AS ENUM ('PROPERTY', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "DeletionRequestStatus" AS ENUM ('PENDING', 'CANCELLED', 'BLOCKED_BY_LEGAL_HOLD', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeletionSurface" AS ENUM ('DATABASE', 'OBJECT_STORAGE', 'SEARCH_INDEX', 'DERIVED_FILES', 'CACHE', 'BACKUP_RETENTION');

-- CreateEnum
CREATE TYPE "DeletionSurfaceStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'SCHEDULED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "LegalHoldScope" AS ENUM ('ORGANIZATION', 'PROPERTY');

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "activePropertyRetentionDays" INTEGER,
    "deletedPropertyGraceDays" INTEGER NOT NULL DEFAULT 30,
    "deletedOrganizationGraceDays" INTEGER NOT NULL DEFAULT 30,
    "archivedCaptureRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "customerTerminationGraceDays" INTEGER NOT NULL DEFAULT 30,
    "backupRetentionDays" INTEGER NOT NULL DEFAULT 35,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalHold" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scopeType" "LegalHoldScope" NOT NULL,
    "propertyId" TEXT,
    "reason" TEXT NOT NULL,
    "placedByUserId" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedByUserId" TEXT,

    CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletionRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetType" "DeletionTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "DeletionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "executedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "DeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletionSurfaceResult" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "surface" "DeletionSurface" NOT NULL,
    "status" "DeletionSurfaceStatus" NOT NULL DEFAULT 'PENDING',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DeletionSurfaceResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_organizationId_key" ON "RetentionPolicy"("organizationId");

-- CreateIndex
CREATE INDEX "LegalHold_organizationId_releasedAt_idx" ON "LegalHold"("organizationId", "releasedAt");

-- CreateIndex
CREATE INDEX "LegalHold_propertyId_idx" ON "LegalHold"("propertyId");

-- CreateIndex
CREATE INDEX "DeletionRequest_organizationId_status_idx" ON "DeletionRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DeletionRequest_status_scheduledFor_idx" ON "DeletionRequest"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "DeletionSurfaceResult_requestId_surface_key" ON "DeletionSurfaceResult"("requestId", "surface");

-- AddForeignKey
ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_placedByUserId_fkey" FOREIGN KEY ("placedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletionRequest" ADD CONSTRAINT "DeletionRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletionRequest" ADD CONSTRAINT "DeletionRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletionSurfaceResult" ADD CONSTRAINT "DeletionSurfaceResult_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DeletionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
