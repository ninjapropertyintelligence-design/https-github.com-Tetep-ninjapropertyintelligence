-- CreateEnum
CREATE TYPE "SpatialEmbedKind" AS ENUM ('MATTERPORT', 'POINT_CLOUD', 'BIM', 'OTHER');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "availableInCapture" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showInInfoTab" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "SpatialEmbed" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "floorId" TEXT,
    "kind" "SpatialEmbedKind" NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpatialEmbed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpatialEmbed_propertyId_idx" ON "SpatialEmbed"("propertyId");

-- AddForeignKey
ALTER TABLE "SpatialEmbed" ADD CONSTRAINT "SpatialEmbed_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpatialEmbed" ADD CONSTRAINT "SpatialEmbed_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpatialEmbed" ADD CONSTRAINT "SpatialEmbed_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpatialEmbed" ADD CONSTRAINT "SpatialEmbed_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
