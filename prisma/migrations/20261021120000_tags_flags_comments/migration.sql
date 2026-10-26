-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "flaggedAt" TIMESTAMP(3),
ADD COLUMN     "flaggedById" TEXT,
ADD COLUMN     "isFlagged" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TagType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "allowMultiple" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TagType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagValue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tagTypeId" TEXT NOT NULL,
    "propertyId" TEXT,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TagValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceTag" (
    "evidenceId" TEXT NOT NULL,
    "tagValueId" TEXT NOT NULL,

    CONSTRAINT "EvidenceTag_pkey" PRIMARY KEY ("evidenceId","tagValueId")
);

-- CreateTable
CREATE TABLE "TaskResponseTag" (
    "taskResponseId" TEXT NOT NULL,
    "tagValueId" TEXT NOT NULL,

    CONSTRAINT "TaskResponseTag_pkey" PRIMARY KEY ("taskResponseId","tagValueId")
);

-- CreateTable
CREATE TABLE "AssessmentTaskDefaultTag" (
    "taskId" TEXT NOT NULL,
    "tagValueId" TEXT NOT NULL,

    CONSTRAINT "AssessmentTaskDefaultTag_pkey" PRIMARY KEY ("taskId","tagValueId")
);

-- CreateTable
CREATE TABLE "EvidenceComment" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TagType_organizationId_name_key" ON "TagType"("organizationId", "name");

-- CreateIndex
CREATE INDEX "TagValue_tagTypeId_idx" ON "TagValue"("tagTypeId");

-- CreateIndex
CREATE INDEX "TagValue_propertyId_idx" ON "TagValue"("propertyId");

-- CreateIndex
CREATE INDEX "EvidenceTag_tagValueId_idx" ON "EvidenceTag"("tagValueId");

-- CreateIndex
CREATE INDEX "TaskResponseTag_tagValueId_idx" ON "TaskResponseTag"("tagValueId");

-- CreateIndex
CREATE INDEX "EvidenceComment_evidenceId_idx" ON "EvidenceComment"("evidenceId");

-- AddForeignKey
ALTER TABLE "TagType" ADD CONSTRAINT "TagType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagValue" ADD CONSTRAINT "TagValue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagValue" ADD CONSTRAINT "TagValue_tagTypeId_fkey" FOREIGN KEY ("tagTypeId") REFERENCES "TagType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagValue" ADD CONSTRAINT "TagValue_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceTag" ADD CONSTRAINT "EvidenceTag_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceTag" ADD CONSTRAINT "EvidenceTag_tagValueId_fkey" FOREIGN KEY ("tagValueId") REFERENCES "TagValue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskResponseTag" ADD CONSTRAINT "TaskResponseTag_taskResponseId_fkey" FOREIGN KEY ("taskResponseId") REFERENCES "AssessmentTaskResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskResponseTag" ADD CONSTRAINT "TaskResponseTag_tagValueId_fkey" FOREIGN KEY ("tagValueId") REFERENCES "TagValue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTaskDefaultTag" ADD CONSTRAINT "AssessmentTaskDefaultTag_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AssessmentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTaskDefaultTag" ADD CONSTRAINT "AssessmentTaskDefaultTag_tagValueId_fkey" FOREIGN KEY ("tagValueId") REFERENCES "TagValue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceComment" ADD CONSTRAINT "EvidenceComment_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceComment" ADD CONSTRAINT "EvidenceComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_flaggedById_fkey" FOREIGN KEY ("flaggedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
