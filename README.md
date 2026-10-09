# AI Property Intelligence Platform

**Property → Evidence → Asset → Condition → Issue → History → Cost → Decision.**

A multi-tenant SaaS platform for portfolios of commercial properties: a
configurable health/risk scoring engine, a permission-scoped AI tool
gateway, role-aware dashboards (Owner, Portfolio Admin, Regional Manager,
Facilities Manager, Inspector, Technician, Vendor, Viewer, Platform Admin),
and provider abstractions for Matterport (interior capture) and
photogrammetry (drone/PIX4D exterior capture).

See `IMPLEMENTATION_REPORT.md` for what's built vs. deferred against the
full platform specification, migrations, known risks, and next workstreams.

## Stack

- **Next.js 16** (App Router, TypeScript, Turbopack) — one deployable for web UI + API routes
- **PostgreSQL + Prisma 7** (driver adapter: `@prisma/adapter-pg` / node-postgres)
- **NextAuth v5 (Auth.js)** — credentials + JWT sessions; SSO plugs in later behind the same `session.user` shape
- **Tailwind CSS v4** — small in-house design system (`src/components/ui/*`)
- **Anthropic SDK** (`@anthropic-ai/sdk`) — AI tool gateway, tool-runner pattern
- **Mapbox GL JS** — portfolio map (degrades gracefully without a token)
- **Vitest** (unit + integration) and **Playwright** (e2e)

## Getting started

### Prerequisites

- Node.js 22+
- PostgreSQL 16 (local or remote)
- **PostGIS** — required, not optional. The spatial migration runs
  `CREATE EXTENSION postgis`, so a stock Postgres without it fails partway
  through `db:deploy` and leaves the schema half-applied.

  ```bash
  # Debian/Ubuntu
  sudo apt-get install postgresql-16-postgis-3
  # macOS (Homebrew)
  brew install postgis
  ```

  Supabase, RDS and most managed Postgres offerings already have it available;
  the migration enables it for you.

### Fastest path: Docker

If you have Docker, this brings up PostGIS, applies every migration, seeds the
demo organization and serves the app:

```bash
docker compose up
# then open http://localhost:3000 and log in as owner@demo.com / password123
```

It uses the `postgis/postgis` image rather than plain `postgres`, because the
spatial migration enables the PostGIS extension and fails partway on a stock
image. `docker compose down -v` removes the database volume and starts clean.

Caveat: this compose file has been syntax-checked but not executed end to end —
the environment it was written in has no Docker daemon. If it misbehaves, the
manual setup below is the well-trodden path.

### Setup

```bash
npm install            # postinstall runs `prisma generate`
cp .env.example .env   # then fill in DATABASE_URL, NEXTAUTH_SECRET, etc.

createdb property_intel          # or point DATABASE_URL at an existing database
npm run db:deploy                # applies prisma/migrations to DATABASE_URL
npm run db:seed                  # feature flags, plans, demo org + users + pilot property

npm run dev                      # http://localhost:3000
```

`db:deploy` (`prisma migrate deploy`) is the right command for simply getting a
working database: it applies the existing migrations and never prompts. Use
`db:migrate` (`prisma migrate dev`) only when authoring a new migration — it is
interactive and will try to generate one.

Running the tests also needs a second database, `DATABASE_URL_TEST`, with the
same migrations applied.

Demo login (any account, password `password123` — see `prisma/seed.ts` for
the full list and what each role can see):

| Email | Role | Scope |
|---|---|---|
| `owner@demo.com` | Owner | Entire org |
| `portfolioadmin@demo.com` | Portfolio Admin | Entire org |
| `regionalmanager@demo.com` | Regional Manager | Midwest region only |
| `facilitiesmanager@demo.com` | Facilities Manager | Store #1052 only |
| `inspector@demo.com` | Inspector | Store #1052 only |
| `technician@demo.com` | Technician | Store #1052 only |
| `vendor@demo.com` | Vendor (ABC Roofing) | Assigned issues at Store #1052 only |
| `viewer@demo.com` | Viewer | Entire org, read-only |
| `platformadmin@demo.com` | Platform Admin | Cross-org console at `/admin` |

### Environment variables

See `.env.example`. Everything except `DATABASE_URL` / `NEXTAUTH_SECRET` is
optional and the app degrades gracefully without it:

- `ANTHROPIC_API_KEY` unset → AI pages show an honest "AI is not configured"
  message instead of a fabricated answer.
- `NEXT_PUBLIC_MAPBOX_TOKEN` unset → the Map page shows a plain scored list
  instead of the interactive map (the Mapbox integration code is real and
  activates the moment a token is set).
- `STORAGE_PROVIDER=local` (default) → files go to a disk-backed signed-URL
  provider (`.local-storage/`, gitignored) behind the exact same
  `StorageProvider` interface a production S3 adapter would implement.

### Tests

```bash
npm run test         # unit + integration (Vitest, real Postgres via DATABASE_URL_TEST)
npm run test:e2e      # Playwright, requires `npm run db:seed` against the dev DB first
npm run typecheck
npm run lint
npm run build
```

Create `property_intel_test` as a separate database and set
`DATABASE_URL_TEST` before running `npm run test` — integration tests run
real Prisma queries (cross-tenant isolation, the scoring pipeline) against
it, never against your dev data.

## Architecture

### Tenant isolation

Every organization-owned row carries `organizationId` directly or is only
reachable through a parent that does. The server **never trusts a
client-supplied `organizationId`/`propertyId`** — `src/lib/session-context.ts`
resolves the authenticated user's active organization + role + scoped
`AccessGrant`s server-side on every request, and `src/lib/tenant-scope.ts`'s
`propertyScopeWhere()` / `issueScopeWhere()` are the *only* sanctioned way to
build a scoped Prisma query. Roles are either org-wide (Owner, Portfolio
Admin, Viewer) or require explicit `AccessGrant` rows (Regional Manager,
Facilities Manager, Inspector, Technician, Vendor) — a scoped role with zero
grants sees **nothing**, not everything. See
`tests/integration/tenant-isolation.test.ts`.

### One permission engine

`src/lib/permissions.ts` maps each `Role` to a fixed set of `Permission`
strings; nothing else checks role names directly. API routes call
`requirePermission(ctx, "canManageAssets")`, UI nav calls the same
`can(ctx, ...)` helper (`src/lib/nav.ts`) — hiding a nav link is a UX
convenience, the backend permission check is what actually gates access.

### One scoring engine

`src/lib/scoring.ts` is the only place Health / Risk / Data Confidence /
Capital Exposure numbers are computed, from configurable category weights
(`ScoringCategoryWeight`, platform default + optional per-org override).
Every dashboard, the property page, CSV reports, and the AI tool gateway
read the same persisted `PropertyHealthSnapshot` — nothing recomputes its
own version. Asset condition changes are append-only
(`AssetConditionHistory`) and always flow through
`src/lib/asset-condition.ts`'s `recordAssetConditionChange()`, which
appends history, recomputes the asset, recomputes the property snapshot,
and emits a canonical event in one call — see
`tests/integration/scoring-pipeline.test.ts` for the full flow.

### One event system

`src/lib/events.ts` emits canonical events (`issue.created`,
`asset.condition_changed`, etc.) to the `Event` table, which is the single
source for the property History tab and dashboard activity feeds.
`src/lib/audit.ts` writes a separate `AuditLog` for the compliance/security
trail (logins, exports, admin actions) — a different concern from the
product-facing Event feed, not a duplicate of it.

### AI tool gateway

`src/lib/ai/tools.ts` defines the approved backend functions
(`getPortfolioSummary`, `getProperty`, `getIssues`, ...), each closed over
the caller's `SessionContext` so a tool call cannot reach outside the
caller's tenant/scope — there is no `organizationId` parameter the model
could pass to escape it. `src/lib/ai/gateway.ts` wires these into
`@anthropic-ai/sdk`'s tool runner: the LLM calls tools, the backend performs
every database operation and calculation, and the model only ever narrates
already-computed numbers. Every query is logged to `AIQueryLog` with its
tool calls and source references for traceability (spec's "AI must return
verified values" and "every material AI response should be traceable").

### AI photo analysis

A vendor's capture-job photo uploaded against an asset is queued
(`PhotoAnalysisJob`) and analysed straight after the upload responds. The
result is a SUGGESTED `AIFinding`; nothing changes a score or a cost until a
person confirms it, when the organization's defect rule
(`/settings/defect-rules`) turns it into an Issue and a condition change.

Work the upload did not finish (a function that timed out, an instance that
went away, a provider failure being retried) is swept up by
`GET /api/v1/cron/photo-analysis` with `Authorization: Bearer $CRON_SECRET`,
scheduled in `vercel.json`. **Once a day**, because the Vercel team is on
the Hobby plan, which allows nothing more frequent and fails every
deployment otherwise; `tests/unit/vercel-crons.test.ts` enforces that. On a
paid plan, set the schedule to `*/5 * * * *` and delete that test. The same
sweep can be run by hand from `POST /api/v1/admin/photo-analysis/run`
(platform admin).

Vercel runs crons on **production** deployments only.

### Provider abstractions (Matterport / drone)

`MatterportConnection` / `MatterportSpace` / `MatterportPropertyLink` /
`MatterportReference` and `DroneCapture` / `DroneDataset` /
`DroneProcessingJob` / `DroneOutput` model the data; the Interior and
Exterior property tabs read from these tables today with an honest empty
state when nothing is connected yet. The `InteriorCaptureProvider` /
`PhotogrammetryProvider` adapter interfaces described in the spec are the
next layer to add on top once a live Matterport/PIX4D integration is
wired up — the schema and UI don't assume Matterport is present anywhere
else in the app.

### Auto-import (DroneDeploy, Insta360)

**DroneDeploy** (`src/lib/dronedeploy-import-service.ts`). An organization
connects its own DroneDeploy account under Administration → DroneDeploy.
Each import pass then lists the account's maps, files each new one to the
single property within the match radius (300 m by default) of the map's
location, requests its exports, and on a later pass streams each finished
export into storage as a `DroneOutput`. The capture ends up `READY`, the
same as a manual upload. A map with no location, no nearby property, or
more than one nearby property waits on that page for a person to file it.
Maps created before the account was connected are never imported.

Passes run from the "Check now" button, from `POST /api/v1/admin/dronedeploy/run`
(platform admin), or on a schedule via `GET /api/v1/cron/dronedeploy` with
`Authorization: Bearer $CRON_SECRET`. For Vercel Cron, add an entry to the
`crons` array in `vercel.json`:

```json
{ "path": "/api/v1/cron/dronedeploy", "schedule": "*/15 * * * *" }
```

(Vercel's Hobby plan only allows daily crons, so a schedule this frequent
needs a paid plan.) The GraphQL operations follow DroneDeploy's public docs
but have not been run against a live account from this environment. Run
`npm run dronedeploy:introspect` with a real key before relying on it.

**Insta360** (`src/components/media/Insta360ImportPanel.tsx`). Insta360 has
no cloud API, so this import runs in the browser. On a property's 360° Views
tab, choose the camera's SD card folder. Each file's EXIF/XMP is read
(`src/lib/media/panorama-metadata.ts`) for capture time, GPS and projection.
Camera originals (`.insp`/`.insv`) are skipped with a note to export them as
360 JPGs first. Panoramas shot more than 1 km from the property are held back
unless included. Each file is hashed and checked against the panoramas the
property already has, so re-importing a card uploads only new files.

**Shot positions.** When the property is on an open capture job with a 360
route, the importer also proposes the route position for each panorama
(`src/lib/capture/shot-matching.ts`):

- By GPS: a geotagged photo goes to the nearest pinned position within 30 m.
- By walking order: if the photos left over exactly match the positions
  left over, they are paired in shooting order.
- Otherwise the photo is left for a person to choose.

Every proposal can be changed before upload. Pins come from four places:
staff placing them on the job page (map with `NEXT_PUBLIC_MAPBOX_TOKEN`, or
pasted coordinates); the previous job at the same site, matched by position
name; or the first geotagged photo filed against an unpinned position.

### File storage

`src/lib/storage.ts` defines a `StorageProvider` interface; large files
never pass through the app server — clients get a signed upload URL and PUT
directly to storage. The `local` provider (used in dev) is a real,
working disk-backed implementation with HMAC-signed, expiring URLs — the
same contract a production S3 adapter would fulfill behind the same
interface.

## Directory structure

```
prisma/schema.prisma        Full domain schema (see comments throughout)
prisma/seed.ts               Demo org, users per role, pilot property + shallow properties
src/auth.ts                  NextAuth config
src/lib/                     Domain services (scoring, permissions, tenant-scope, events, audit, ai/, storage, csv)
src/app/api/                 Route handlers (REST-ish, one folder per resource)
src/app/(app)/                Authenticated app shell + role-routed dashboard + property/asset/issue/assessment pages
src/components/ui/            Design system primitives (Button, Card, Badge, StatTile, EmptyState...)
src/components/dashboard/     Role-specific dashboard views
src/components/property/      Property-page tab components
tests/unit/                   Vitest unit tests (scoring, permissions)
tests/integration/            Vitest integration tests against real Postgres (tenant isolation, scoring pipeline)
tests/e2e/                    Playwright e2e tests against a running dev server
```
