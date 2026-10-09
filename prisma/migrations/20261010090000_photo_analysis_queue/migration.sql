-- CreateEnum
CREATE TYPE "PhotoAnalysisJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "autoAnalyzePhotos" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "PhotoAnalysisJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "PhotoAnalysisJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "findingId" TEXT,
    "startedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotoAnalysisJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhotoAnalysisJob_evidenceId_key" ON "PhotoAnalysisJob"("evidenceId");

-- CreateIndex
CREATE INDEX "PhotoAnalysisJob_status_updatedAt_idx" ON "PhotoAnalysisJob"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "PhotoAnalysisJob_organizationId_idx" ON "PhotoAnalysisJob"("organizationId");

-- AddForeignKey
ALTER TABLE "PhotoAnalysisJob" ADD CONSTRAINT "PhotoAnalysisJob_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoAnalysisJob" ADD CONSTRAINT "PhotoAnalysisJob_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

