-- AlterTable
ALTER TABLE "AIFinding" ADD COLUMN     "boundingBox" JSONB,
ADD COLUMN     "defectClass" TEXT,
ADD COLUMN     "imageHeight" INTEGER,
ADD COLUMN     "imageWidth" INTEGER,
ADD COLUMN     "issueId" TEXT;

-- CreateTable
CREATE TABLE "DefectRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "defectClass" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "defaultSeverity" "IssueSeverity" NOT NULL,
    "conditionHit" INTEGER NOT NULL,
    "repairCostCents" INTEGER NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefectRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DefectRule_organizationId_defectClass_key" ON "DefectRule"("organizationId", "defectClass");

-- CreateIndex
CREATE UNIQUE INDEX "AIFinding_issueId_key" ON "AIFinding"("issueId");

-- AddForeignKey
ALTER TABLE "AIFinding" ADD CONSTRAINT "AIFinding_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRule" ADD CONSTRAINT "DefectRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

