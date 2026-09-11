-- CreateEnum
CREATE TYPE "StorageTier" AS ENUM ('STANDARD', 'INFREQUENT_ACCESS', 'ARCHIVE', 'DEEP_ARCHIVE');

-- CreateEnum
CREATE TYPE "StorageObjectKind" AS ENUM ('DRONE_IMAGE', 'DRONE_OUTPUT', 'DOCUMENT_VERSION', 'EVIDENCE');

-- CreateEnum
CREATE TYPE "StorageRestoreState" AS ENUM ('NOT_REQUESTED', 'IN_PROGRESS', 'AVAILABLE', 'FAILED');

-- CreateTable
CREATE TABLE "StorageTieringPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "infrequentAccessAfterDays" INTEGER DEFAULT 90,
    "archiveAfterDays" INTEGER DEFAULT 365,
    "deepArchiveAfterDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageTieringPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageObject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "kind" "StorageObjectKind" NOT NULL,
    "sizeBytes" INTEGER,
    "currentTier" "StorageTier" NOT NULL DEFAULT 'STANDARD',
    "objectCreatedAt" TIMESTAMP(3) NOT NULL,
    "lastTransitionedAt" TIMESTAMP(3),
    "restoreState" "StorageRestoreState" NOT NULL DEFAULT 'NOT_REQUESTED',
    "restoreRequestedAt" TIMESTAMP(3),
    "restoreExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorageTieringPolicy_organizationId_key" ON "StorageTieringPolicy"("organizationId");

-- CreateIndex
CREATE INDEX "StorageObject_organizationId_currentTier_idx" ON "StorageObject"("organizationId", "currentTier");

-- CreateIndex
CREATE INDEX "StorageObject_organizationId_objectCreatedAt_idx" ON "StorageObject"("organizationId", "objectCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StorageObject_organizationId_storageKey_key" ON "StorageObject"("organizationId", "storageKey");

-- AddForeignKey
ALTER TABLE "StorageTieringPolicy" ADD CONSTRAINT "StorageTieringPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
