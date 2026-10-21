-- AlterTable
ALTER TABLE "AssessmentAnswer" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "AssessmentTaskResponse" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAnswer_assessmentId_clientId_key" ON "AssessmentAnswer"("assessmentId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentTaskResponse_assessmentId_clientId_key" ON "AssessmentTaskResponse"("assessmentId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_organizationId_clientId_key" ON "Evidence"("organizationId", "clientId");
