-- Shot positions on a capture job site: the route a technician walks.
--
-- Hand-written rather than generated, for the same reason as the earlier
-- migrations in this series: `prisma migrate dev` wants to reset the
-- development database because older migrations were edited after being
-- applied and no longer match their checksums.

CREATE TYPE "CaptureShotKind" AS ENUM ('PHOTO', 'IMAGE_360');

CREATE TABLE "CaptureShot" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "CaptureShotKind" NOT NULL DEFAULT 'IMAGE_360',
    "sequence" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaptureShot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CaptureShot_siteId_idx" ON "CaptureShot"("siteId");
-- Two shots at the same position in one route would make the count wrong and
-- the walking order ambiguous.
CREATE UNIQUE INDEX "CaptureShot_siteId_sequence_key" ON "CaptureShot"("siteId", "sequence");

ALTER TABLE "CaptureShot" ADD CONSTRAINT "CaptureShot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "CaptureJobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Evidence records which shot position it satisfied. Nullable: most evidence
-- is not taken against a route at all.
ALTER TABLE "Evidence" ADD COLUMN "captureShotId" TEXT;
CREATE INDEX "Evidence_captureShotId_idx" ON "Evidence"("captureShotId");
-- SET NULL, not CASCADE: deleting a route must never delete the imagery that
-- was captured for it.
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_captureShotId_fkey" FOREIGN KEY ("captureShotId") REFERENCES "CaptureShot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
