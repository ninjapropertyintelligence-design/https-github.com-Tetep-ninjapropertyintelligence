-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "assessmentId" TEXT;

-- CreateIndex
CREATE INDEX "Document_assessmentId_idx" ON "Document"("assessmentId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
