-- Widen every sizeBytes column from a 32-bit integer to a 64-bit one.
--
-- int4 caps a single object at 2,147,483,647 bytes (~2.147 GB). Drone point
-- clouds, orthomosaics and meshes routinely exceed that, so registering one
-- threw "value out of range for type integer". On the drone and document
-- upload paths that write into StorageObject the failure was also SILENT,
-- because the tiering ledger write is deliberately best-effort: the upload
-- succeeded, the object was never registered, and it would then never be
-- tiered or costed.
--
-- Widening is lossless — every existing int4 value is a valid int8.
ALTER TABLE "Evidence"        ALTER COLUMN "sizeBytes" SET DATA TYPE BIGINT;
ALTER TABLE "DocumentVersion" ALTER COLUMN "sizeBytes" SET DATA TYPE BIGINT;
ALTER TABLE "DroneImage"      ALTER COLUMN "sizeBytes" SET DATA TYPE BIGINT;
ALTER TABLE "DroneOutput"     ALTER COLUMN "sizeBytes" SET DATA TYPE BIGINT;
ALTER TABLE "StorageObject"   ALTER COLUMN "sizeBytes" SET DATA TYPE BIGINT;
