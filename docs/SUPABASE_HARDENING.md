# Supabase hardening — required before real data

This platform talks to Postgres **only** through Prisma, as the `postgres`
role. It does not use Supabase client libraries, the Data API (PostgREST), or
the anon key anywhere in `src/`.

Supabase, however, exposes the `public` schema through PostgREST **by
default**, and grants the `anon` and `authenticated` roles full table
privileges. That combination bypasses every access control this application
implements.

## The problem, as measured

Verified directly against the project database:

```sql
-- anon and authenticated each hold SELECT/INSERT/UPDATE/DELETE
-- on all 69 tables in the public schema:
SELECT grantee, privilege_type, count(*)
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated')
  AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
GROUP BY grantee, privilege_type;

-- ...and row level security is enabled on none of them:
SELECT count(*) FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false;
```

Supabase's own linter reports this at **ERROR** level
(`rls_disabled_in_public`, 67 tables).

The anon key is **public by design** — it is meant to ship to browsers. So
the effective position is that anyone holding it can read and write every
table directly, with none of the application's tenant scoping,
role permissions, MFA gating, or audit logging in the path. The careful
`propertyScopeWhere` boundary in `src/lib/tenant-scope.ts` is simply not
involved in a PostgREST request.

Note what is *not* claimed here: an end-to-end HTTP request against
`/rest/v1/` was not executed, because the development environment's proxy
blocks that host. What is confirmed is the mechanism — the grants, the
absent RLS, and PostgREST's default exposure of `public`.

## Why it is not yet an incident

At the time of writing every application table is empty. Nothing has
leaked because there is nothing to leak. This must be closed **before**
seeding, before the first real organization, and before any customer data
lands.

## Fix

Two options. They are not mutually exclusive, and doing both is reasonable.

### Option A — stop exposing `public` through the Data API (preferred)

Dashboard → **Project Settings → API → Exposed schemas**: remove `public`.

This is the most direct fix for an application that does not use the Data
API at all: the endpoint stops serving these tables entirely, rather than
serving them and relying on per-table rules to return nothing.

### Option B — enable RLS on every table

```sql
-- Safe for this application: the `postgres` role that Prisma connects as
-- has rolbypassrls = true (verified), so RLS does not affect it. The `anon`
-- and `authenticated` roles do not, so with RLS on and no policies defined
-- they can read and write nothing.
ALTER TABLE public."AIFinding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AIQueryLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AccessGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Area" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Assessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AssessmentAnswer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AssessmentQuestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AssessmentSection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AssessmentTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Asset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AssetConditionHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Building" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BuildingSystem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CostRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DeletionRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DeletionSurfaceResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DocumentChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DocumentVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DroneCapture" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DroneDataset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DroneImage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DroneOutput" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DroneProcessingJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ExteriorMarker" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."FeatureFlag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."FeatureFlagOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Floor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."IdempotencyKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ImpersonationSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ImportJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ImportRowResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Issue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."IssueComment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LegalHold" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MatterportConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MatterportPropertyLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MatterportReference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MatterportSpace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MfaRecoveryCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OnboardingProgress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OrganizationSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Portfolio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProductEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Property" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PropertyHealthSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Region" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RetentionPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SavedView" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ScoringCategoryWeight" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StorageObject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StorageTieringPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SubscriptionItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SubscriptionPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."UsageRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Vendor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WebhookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WebhookEndpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
```

`spatial_ref_sys` is deliberately omitted: it is a PostGIS system table
owned by the extension, and it holds no customer data. The linter flags it;
it is not worth the risk of interfering with coordinate transforms.

### New tables need the same treatment

Enabling RLS today does not cover a table added by a future migration.
Whichever option is chosen, re-run the check after any migration that adds
tables:

```sql
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false;
```

## Other linter findings (lower severity)

- **`property_sync_geo` has a mutable `search_path`** (WARN). This is the
  trigger that keeps `Property.geo` in sync with latitude/longitude. Worth
  pinning: `ALTER FUNCTION public.property_sync_geo() SET search_path = public, pg_temp;`
- **`postgis` installed in `public`** (WARN). It is there deliberately —
  Prisma connects with `?schema=public`, so the `geography` type must resolve
  on that search path. Moving the extension would require the application's
  connection string and the migration to agree on a different schema.
- **`st_estimatedextent` is executable by `anon`** (WARN). A PostGIS
  function, exposed as a side effect of the extension living in an exposed
  schema. Option A removes this along with everything else.
