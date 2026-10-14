-- Product analytics (spec §105).
--
-- A third event stream, deliberately separate from Event (business facts
-- about the portfolio) and AuditLog (compliance record, with IP addresses).
-- Product analytics is high-volume and disposable; sharing either table
-- would drown that data and force one retention policy onto things that
-- need different ones. See the ProductEvent model comment.

-- CreateTable
CREATE TABLE "ProductEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "feature" TEXT NOT NULL,
    "impersonated" BOOLEAN NOT NULL DEFAULT false,
    "role" "Role",
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductEvent_organizationId_occurredAt_idx" ON "ProductEvent"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProductEvent_organizationId_feature_occurredAt_idx" ON "ProductEvent"("organizationId", "feature", "occurredAt");

-- CreateIndex
CREATE INDEX "ProductEvent_userId_occurredAt_idx" ON "ProductEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProductEvent_feature_occurredAt_idx" ON "ProductEvent"("feature", "occurredAt");

-- AddForeignKey
ALTER TABLE "ProductEvent" ADD CONSTRAINT "ProductEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEvent" ADD CONSTRAINT "ProductEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

