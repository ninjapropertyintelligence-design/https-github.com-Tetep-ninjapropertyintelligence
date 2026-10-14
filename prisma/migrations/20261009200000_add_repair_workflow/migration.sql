-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REPAIR_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'REPAIR_VERIFIED';
ALTER TYPE "NotificationType" ADD VALUE 'REPAIR_SENT_BACK';

-- CreateEnum
CREATE TYPE "RepairPhotoStage" AS ENUM ('BEFORE', 'AFTER');

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN "repairStage" "RepairPhotoStage";

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN "repairNotes" TEXT,
ADD COLUMN "repairSentBackAt" TIMESTAMP(3),
ADD COLUMN "repairSentBackReason" TEXT,
ADD COLUMN "repairSubmittedAt" TIMESTAMP(3),
ADD COLUMN "repairSubmittedById" TEXT,
ADD COLUMN "verifiedAt" TIMESTAMP(3),
ADD COLUMN "verifiedById" TEXT;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_repairSubmittedById_fkey" FOREIGN KEY ("repairSubmittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
