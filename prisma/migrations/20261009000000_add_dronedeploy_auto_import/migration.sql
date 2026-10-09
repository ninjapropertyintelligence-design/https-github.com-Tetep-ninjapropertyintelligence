-- CreateEnum
CREATE TYPE "DroneDeployImportStatus" AS ENUM ('UNMATCHED', 'IMPORTING', 'IMPORTED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "DroneDeployExportStatus" AS ENUM ('REQUESTED', 'IMPORTED', 'FAILED');

-- CreateTable
CREATE TABLE "DroneDeployConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "errorMessage" TEXT,
    "importSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchRadiusMeters" INTEGER NOT NULL DEFAULT 300,
    "lastPolledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DroneDeployConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DroneDeployImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalPlanId" TEXT NOT NULL,
    "planName" TEXT,
    "planCreatedAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "status" "DroneDeployImportStatus" NOT NULL DEFAULT 'UNMATCHED',
    "propertyId" TEXT,
    "matchedBy" TEXT,
    "matchDistanceMeters" DOUBLE PRECISION,
    "captureId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DroneDeployImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DroneDeployExportImport" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "outputType" "DroneOutputType" NOT NULL,
    "externalExportId" TEXT,
    "status" "DroneDeployExportStatus" NOT NULL DEFAULT 'REQUESTED',
    "droneOutputId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DroneDeployExportImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DroneDeployConnection_organizationId_key" ON "DroneDeployConnection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DroneDeployImport_captureId_key" ON "DroneDeployImport"("captureId");

-- CreateIndex
CREATE INDEX "DroneDeployImport_organizationId_status_idx" ON "DroneDeployImport"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DroneDeployImport_organizationId_externalPlanId_key" ON "DroneDeployImport"("organizationId", "externalPlanId");

-- CreateIndex
CREATE INDEX "DroneDeployExportImport_status_idx" ON "DroneDeployExportImport"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DroneDeployExportImport_importId_layer_key" ON "DroneDeployExportImport"("importId", "layer");

-- AddForeignKey
ALTER TABLE "DroneDeployConnection" ADD CONSTRAINT "DroneDeployConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DroneDeployImport" ADD CONSTRAINT "DroneDeployImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DroneDeployImport" ADD CONSTRAINT "DroneDeployImport_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DroneDeployImport" ADD CONSTRAINT "DroneDeployImport_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "DroneCapture"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DroneDeployExportImport" ADD CONSTRAINT "DroneDeployExportImport_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DroneDeployImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

