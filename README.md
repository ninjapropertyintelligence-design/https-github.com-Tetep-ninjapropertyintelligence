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

### Setup

```bash
npm install
cp .env.example .env   # then fill in DATABASE_URL, NEXTAUTH_SECRET, etc.

npm run db:migrate     # applies prisma/migrations to DATABASE_URL
npm run db:seed        # feature flags, subscription plans, demo org + users + pilot property

npm run dev             # http://localhost:3000
```

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
