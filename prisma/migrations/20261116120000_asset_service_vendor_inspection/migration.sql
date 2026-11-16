-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "lastInspectedAt" TIMESTAMP(3),
ADD COLUMN     "serviceVendorId" TEXT;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_serviceVendorId_fkey" FOREIGN KEY ("serviceVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

