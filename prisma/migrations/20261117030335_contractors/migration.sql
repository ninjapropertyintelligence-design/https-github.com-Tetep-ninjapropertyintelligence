-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "serviceVendorId" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "emergencyPhone" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "servesAllProperties" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "VendorProperty" (
    "vendorId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorProperty_pkey" PRIMARY KEY ("vendorId","propertyId")
);

-- CreateIndex
CREATE INDEX "VendorProperty_propertyId_idx" ON "VendorProperty"("propertyId");

-- CreateIndex
CREATE INDEX "Asset_serviceVendorId_idx" ON "Asset"("serviceVendorId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_serviceVendorId_fkey" FOREIGN KEY ("serviceVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorProperty" ADD CONSTRAINT "VendorProperty_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorProperty" ADD CONSTRAINT "VendorProperty_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
