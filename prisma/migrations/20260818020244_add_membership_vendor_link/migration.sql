-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "vendorId" TEXT;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
