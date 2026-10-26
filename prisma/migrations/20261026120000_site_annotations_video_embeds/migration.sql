-- CreateEnum
CREATE TYPE "SiteAnnotationKind" AS ENUM ('POINT', 'AREA');

-- AlterEnum
ALTER TYPE "SpatialEmbedKind" ADD VALUE 'VIDEO';

-- CreateTable
CREATE TABLE "SiteAnnotation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" "SiteAnnotationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#16a34a',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "polygon" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteAnnotation_propertyId_idx" ON "SiteAnnotation"("propertyId");

-- AddForeignKey
ALTER TABLE "SiteAnnotation" ADD CONSTRAINT "SiteAnnotation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAnnotation" ADD CONSTRAINT "SiteAnnotation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAnnotation" ADD CONSTRAINT "SiteAnnotation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

