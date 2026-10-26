-- AlterEnum
ALTER TYPE "AssessmentStatus" ADD VALUE 'RELEASED';

-- DropIndex
DROP INDEX "AssessmentAnswer_assessmentId_questionId_assetId_key";

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "releasedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AssessmentAnswer" ADD COLUMN     "taskResponseId" TEXT;

-- AlterTable
ALTER TABLE "AssessmentQuestion" ADD COLUMN     "taskId" TEXT;

-- CreateTable
CREATE TABLE "AssessmentTask" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isRepeatable" BOOLEAN NOT NULL DEFAULT false,
    "isCompletable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AssessmentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentTaskResponse" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "instance" INTEGER NOT NULL DEFAULT 1,
    "label" TEXT,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentTaskResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentTask_sectionId_idx" ON "AssessmentTask"("sectionId");

-- CreateIndex
CREATE INDEX "AssessmentTaskResponse_assessmentId_idx" ON "AssessmentTaskResponse"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentTaskResponse_assessmentId_taskId_instance_key" ON "AssessmentTaskResponse"("assessmentId", "taskId", "instance");

-- CreateIndex
CREATE INDEX "AssessmentAnswer_taskResponseId_idx" ON "AssessmentAnswer"("taskResponseId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAnswer_assessmentId_questionId_assetId_taskRespon_key" ON "AssessmentAnswer"("assessmentId", "questionId", "assetId", "taskResponseId");

-- CreateIndex
CREATE INDEX "AssessmentQuestion_taskId_idx" ON "AssessmentQuestion"("taskId");

-- AddForeignKey
ALTER TABLE "AssessmentTask" ADD CONSTRAINT "AssessmentTask_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "AssessmentSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTaskResponse" ADD CONSTRAINT "AssessmentTaskResponse_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTaskResponse" ADD CONSTRAINT "AssessmentTaskResponse_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AssessmentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTaskResponse" ADD CONSTRAINT "AssessmentTaskResponse_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentQuestion" ADD CONSTRAINT "AssessmentQuestion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AssessmentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAnswer" ADD CONSTRAINT "AssessmentAnswer_taskResponseId_fkey" FOREIGN KEY ("taskResponseId") REFERENCES "AssessmentTaskResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
