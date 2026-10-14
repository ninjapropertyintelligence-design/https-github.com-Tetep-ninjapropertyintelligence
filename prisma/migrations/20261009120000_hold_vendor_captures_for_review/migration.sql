-- Vendor-delivered captures are tied to the capture-job site they were
-- delivered against, so they can be held back until that site is accepted.
-- Nullable: anything captured by the organization itself needs no review,
-- and every existing row keeps its current visibility.

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN "captureJobSiteId" TEXT;

-- AlterTable
ALTER TABLE "DroneCapture" ADD COLUMN "captureJobSiteId" TEXT;

-- AlterTable
ALTER TABLE "MatterportPropertyLink" ADD COLUMN "captureJobSiteId" TEXT;

-- CreateIndex
CREATE INDEX "Evidence_captureJobSiteId_idx" ON "Evidence"("captureJobSiteId");

-- CreateIndex
CREATE INDEX "DroneCapture_captureJobSiteId_idx" ON "DroneCapture"("captureJobSiteId");

-- CreateIndex
CREATE INDEX "MatterportPropertyLink_captureJobSiteId_idx" ON "MatterportPropertyLink"("captureJobSiteId");

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_captureJobSiteId_fkey" FOREIGN KEY ("captureJobSiteId") REFERENCES "CaptureJobSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DroneCapture" ADD CONSTRAINT "DroneCapture_captureJobSiteId_fkey" FOREIGN KEY ("captureJobSiteId") REFERENCES "CaptureJobSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterportPropertyLink" ADD CONSTRAINT "MatterportPropertyLink_captureJobSiteId_fkey" FOREIGN KEY ("captureJobSiteId") REFERENCES "CaptureJobSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
