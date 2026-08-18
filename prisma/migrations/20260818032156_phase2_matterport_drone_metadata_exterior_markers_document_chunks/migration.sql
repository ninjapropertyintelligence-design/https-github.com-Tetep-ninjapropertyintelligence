-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "indexError" TEXT,
ADD COLUMN     "indexStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "indexedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DroneImage" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "sizeBytes" INTEGER;

-- AlterTable
ALTER TABLE "DroneOutput" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "sizeBytes" INTEGER;

-- AlterTable
ALTER TABLE "MatterportConnection" ADD COLUMN     "errorMessage" TEXT;

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "propertyId" TEXT,
    "assetId" TEXT,
    "chunkIndex" INTEGER NOT NULL,
    "pageNumber" INTEGER,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExteriorMarker" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "droneImageId" TEXT,
    "droneOutputId" TEXT,
    "assetId" TEXT,
    "issueId" TEXT,
    "evidenceId" TEXT,
    "label" TEXT,
    "xNormalized" DOUBLE PRECISION NOT NULL,
    "yNormalized" DOUBLE PRECISION NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExteriorMarker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");

-- CreateIndex
CREATE INDEX "DocumentChunk_organizationId_idx" ON "DocumentChunk"("organizationId");

-- CreateIndex
CREATE INDEX "DocumentChunk_propertyId_idx" ON "DocumentChunk"("propertyId");

-- CreateIndex
CREATE INDEX "ExteriorMarker_propertyId_idx" ON "ExteriorMarker"("propertyId");

-- CreateIndex
CREATE INDEX "ExteriorMarker_droneImageId_idx" ON "ExteriorMarker"("droneImageId");

-- CreateIndex
CREATE INDEX "ExteriorMarker_droneOutputId_idx" ON "ExteriorMarker"("droneOutputId");

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExteriorMarker" ADD CONSTRAINT "ExteriorMarker_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExteriorMarker" ADD CONSTRAINT "ExteriorMarker_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExteriorMarker" ADD CONSTRAINT "ExteriorMarker_droneImageId_fkey" FOREIGN KEY ("droneImageId") REFERENCES "DroneImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExteriorMarker" ADD CONSTRAINT "ExteriorMarker_droneOutputId_fkey" FOREIGN KEY ("droneOutputId") REFERENCES "DroneOutput"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExteriorMarker" ADD CONSTRAINT "ExteriorMarker_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExteriorMarker" ADD CONSTRAINT "ExteriorMarker_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExteriorMarker" ADD CONSTRAINT "ExteriorMarker_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExteriorMarker" ADD CONSTRAINT "ExteriorMarker_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
