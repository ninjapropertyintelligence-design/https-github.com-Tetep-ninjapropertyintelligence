-- PostGIS spatial queries (spec §11).
--
-- WHY geography AND NOT geometry. With SRID 4326, `geometry` measures in
-- DEGREES: ST_Distance between New York and Los Angeles returns 44.74, and a
-- degree of longitude is ~111 km at the equator and ~0 at the poles. Code
-- treating that as a distance would be wrong by an amount that varies with
-- latitude. `geography` measures on the spheroid and returns 3,944,422 — real
-- metres. Radius search is only meaningful on geography.
--
-- WHY A TRIGGER AND NOT A GENERATED COLUMN. A GENERATED ALWAYS column is the
-- stronger guarantee and was tried first, but Prisma misreads the generation
-- expression as a DEFAULT and every subsequent `migrate diff` emits
-- `ALTER COLUMN "geo" DROP DEFAULT` — which Postgres REJECTS on a generated
-- column ("use DROP EXPRESSION instead"). That would make every future
-- migration in this project fail to apply. A trigger keeps the same property
-- that matters (the database maintains it, so no application code path can
-- forget to) while leaving Prisma's view of the column plain.
--
-- NOTE ON ARGUMENT ORDER: ST_MakePoint takes (X, Y) = (longitude, latitude).
-- Swapping them is the classic GIS bug and fails silently, placing points in
-- the wrong hemisphere or in the sea. Asserted in the test suite.
CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE "Property" ADD COLUMN "geo" geography(Point, 4326);

CREATE OR REPLACE FUNCTION property_sync_geo() RETURNS trigger AS $$
BEGIN
  IF NEW."latitude" IS NULL OR NEW."longitude" IS NULL THEN
    NEW."geo" := NULL;
  ELSE
    NEW."geo" := ST_SetSRID(ST_MakePoint(NEW."longitude", NEW."latitude"), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BEFORE INSERT OR UPDATE, unconditionally: latitude/longitude remain the
-- single source of truth and `geo` is always recomputed from them, so a
-- client that writes `geo` directly cannot put a wrong value in it either.
CREATE TRIGGER property_sync_geo_trigger
  BEFORE INSERT OR UPDATE ON "Property"
  FOR EACH ROW EXECUTE FUNCTION property_sync_geo();

-- Backfill rows that already exist; the trigger only covers future writes.
UPDATE "Property"
  SET "geo" = ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography
  WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;

-- GiST is what makes ST_DWithin an index lookup instead of a full scan.
-- Without it a radius search degrades linearly and gets switched off at
-- exactly the portfolio size where it starts to matter.
CREATE INDEX "Property_geo_idx" ON "Property" USING GIST ("geo");
