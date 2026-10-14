-- Cost metering and property-level COGS (spec §49/§50).
--
-- The two dropped enum values (STORAGE_GB, AI_TOKENS) had no writer anywhere
-- in the codebase and no rows: UsageRecord was a model with zero code behind
-- it. Storage is now split per tier because the tiers are priced an order of
-- magnitude apart, and AI tokens are split into input and output because they
-- are priced differently.

-- AlterEnum
BEGIN;
CREATE TYPE "UsageMetricType_new" AS ENUM ('STORAGE_STANDARD_GB_MONTH', 'STORAGE_IA_GB_MONTH', 'STORAGE_ARCHIVE_GB_MONTH', 'STORAGE_DEEP_ARCHIVE_GB_MONTH', 'BANDWIDTH_GB', 'PROCESSING_JOB', 'AI_REQUEST', 'AI_INPUT_TOKENS', 'AI_OUTPUT_TOKENS', 'MATTERPORT_ALLOCATION', 'GEOCODING_REQUEST', 'DOCUMENT_INDEX_JOB', 'REPORT_GENERATION', 'DB_USAGE');
ALTER TABLE "UsageRecord" ALTER COLUMN "metricType" TYPE "UsageMetricType_new" USING ("metricType"::text::"UsageMetricType_new");
ALTER TYPE "UsageMetricType" RENAME TO "UsageMetricType_old";
ALTER TYPE "UsageMetricType_new" RENAME TO "UsageMetricType";
DROP TYPE "public"."UsageMetricType_old";
COMMIT;

-- AlterTable
ALTER TABLE "UsageRecord" ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "CostRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "metricType" "UsageMetricType" NOT NULL,
    "unitCostMicros" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostRate_organizationId_metricType_effectiveFrom_idx" ON "CostRate"("organizationId", "metricType", "effectiveFrom");

-- CreateIndex
CREATE INDEX "CostRate_metricType_effectiveFrom_idx" ON "CostRate"("metricType", "effectiveFrom");

-- CreateIndex
CREATE INDEX "UsageRecord_organizationId_propertyId_recordedAt_idx" ON "UsageRecord"("organizationId", "propertyId", "recordedAt");

-- CreateIndex
CREATE INDEX "UsageRecord_organizationId_recordedAt_idx" ON "UsageRecord"("organizationId", "recordedAt");

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRate" ADD CONSTRAINT "CostRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

