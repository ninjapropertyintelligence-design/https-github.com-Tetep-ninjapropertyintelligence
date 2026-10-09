-- AlterTable
ALTER TABLE "AIFinding" ADD COLUMN     "assetId" TEXT,
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "confirmedScore" INTEGER,
ADD COLUMN     "defects" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "recommendedAction" TEXT,
ADD COLUMN     "requestedById" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "suggestedScore" INTEGER,
ADD COLUMN     "suggestedSeverity" "IssueSeverity";

-- Backfill: a finding belongs to its evidence's organization. Added nullable
-- and filled before NOT NULL so a database that already holds findings
-- migrates instead of failing on the constraint.
UPDATE "AIFinding" f SET "organizationId" = e."organizationId"
FROM "Evidence" e WHERE e."id" = f."evidenceId";

ALTER TABLE "AIFinding" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "AIFinding_organizationId_status_idx" ON "AIFinding"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AIFinding_assetId_idx" ON "AIFinding"("assetId");

-- AddForeignKey
ALTER TABLE "AIFinding" ADD CONSTRAINT "AIFinding_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

