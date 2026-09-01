-- CreateEnum
CREATE TYPE "ImportRowAction" AS ENUM ('CREATED', 'UPDATED', 'SKIPPED_DUPLICATE', 'SKIPPED_ERROR');

-- AlterEnum
ALTER TYPE "ImportStatus" ADD VALUE 'ROLLED_BACK';

-- AlterTable
ALTER TABLE "ImportJob" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "duplicateCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "targetPortfolioId" TEXT,
ADD COLUMN     "undoneAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ImportRowResult" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "action" "ImportRowAction" NOT NULL,
    "entityId" TEXT,
    "beforeImage" JSONB,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRowResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportRowResult_importJobId_idx" ON "ImportRowResult"("importJobId");

-- CreateIndex
CREATE INDEX "ImportRowResult_importJobId_action_idx" ON "ImportRowResult"("importJobId", "action");

-- AddForeignKey
ALTER TABLE "ImportRowResult" ADD CONSTRAINT "ImportRowResult_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
