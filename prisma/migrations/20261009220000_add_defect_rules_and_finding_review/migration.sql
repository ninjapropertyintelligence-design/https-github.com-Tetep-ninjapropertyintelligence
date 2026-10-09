-- Adds the review half of AI findings (asset, box, defect class, the issue a
-- confirmation created) and the organization-owned DefectRule table that
-- turns a defect class into suggested severity, cost and condition hit.
-- Nothing has written AIFinding rows yet, so the new foreign key on the
-- existing reviewedById column has no rows to violate.

-- AlterTable
ALTER TABLE "AIFinding" ADD COLUMN     "assetId" TEXT,
ADD COLUMN     "boundingBox" JSONB,
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "defectClass" TEXT,
ADD COLUMN     "imageHeight" INTEGER,
ADD COLUMN     "imageWidth" INTEGER,
ADD COLUMN     "issueId" TEXT,
ADD COLUMN     "modelName" TEXT,
ADD COLUMN     "reviewNote" TEXT;

-- CreateTable
CREATE TABLE "DefectRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "defectClass" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "assetCategory" TEXT,
    "defaultSeverity" "IssueSeverity" NOT NULL,
    "conditionPenalty" INTEGER NOT NULL DEFAULT 0,
    "defaultRepairCostCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefectRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DefectRule_organizationId_idx" ON "DefectRule"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DefectRule_organizationId_defectClass_key" ON "DefectRule"("organizationId", "defectClass");

-- CreateIndex
CREATE UNIQUE INDEX "AIFinding_issueId_key" ON "AIFinding"("issueId");

-- CreateIndex
CREATE INDEX "AIFinding_assetId_idx" ON "AIFinding"("assetId");

-- AddForeignKey
ALTER TABLE "AIFinding" ADD CONSTRAINT "AIFinding_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIFinding" ADD CONSTRAINT "AIFinding_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIFinding" ADD CONSTRAINT "AIFinding_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRule" ADD CONSTRAINT "DefectRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

