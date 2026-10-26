-- CreateEnum
CREATE TYPE "OverlayKind" AS ENUM ('RASTER', 'VECTOR');

-- CreateEnum
CREATE TYPE "OverlayCategory" AS ENUM ('AERIAL', 'SITE_PLAN', 'FLOOR_PLAN', 'FFE_PLAN', 'REFLECTED_CEILING_PLAN', 'ROOF_PLAN', 'OTHER');

-- CreateTable
CREATE TABLE "PropertyOverlay" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "floorId" TEXT,
    "kind" "OverlayKind" NOT NULL,
    "category" "OverlayCategory" NOT NULL DEFAULT 'OTHER',
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "north" DOUBLE PRECISION,
    "south" DOUBLE PRECISION,
    "east" DOUBLE PRECISION,
    "west" DOUBLE PRECISION,
    "defaultOpacity" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyOverlay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropertyOverlay_propertyId_kind_idx" ON "PropertyOverlay"("propertyId", "kind");

-- AddForeignKey
ALTER TABLE "PropertyOverlay" ADD CONSTRAINT "PropertyOverlay_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyOverlay" ADD CONSTRAINT "PropertyOverlay_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyOverlay" ADD CONSTRAINT "PropertyOverlay_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyOverlay" ADD CONSTRAINT "PropertyOverlay_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
