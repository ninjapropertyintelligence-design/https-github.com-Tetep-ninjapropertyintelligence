# Implementation Report — AI Property Intelligence Platform

## 0. Starting audit

The repository was **completely empty** at the start of this work: no
commits, no branches, nothing on the remote. There was no existing stack,
auth, schema, API patterns, storage, roles, or UI to inspect, reuse, or
preserve — this is a greenfield build, not an incremental one, despite the
brief being written as if extending an existing app.

The full specification describes a multi-year, multi-team enterprise
platform (native iOS/Android apps, live Matterport/PIX4D integrations,
production billing, an LLM tool-gateway AI engine, offline sync, a full
admin console, an observability stack, etc.), written as a 45-day /
~25-parallel-agent plan. Building all of it as tested, production-quality,
non-mocked code in one session is not achievable honestly. After
confirming with the user, this session's scope was set to: **a solid,
real, tested Phase-1 foundation** — multi-tenant schema, auth, server-side
RBAC/scoping, the property graph, portfolio dashboard, property profile,
assets/issues/assessments/evidence/documents, a real configurable
health-scoring engine, audit logging, feature flags, and provider
*abstractions* (not fake live integrations) for Matterport/drone/AI — on a
**Next.js + TypeScript + PostgreSQL/Prisma** stack (also user-selected).
Native mobile is responsive-web-first per the spec's own item 39; billing,
live third-party integrations, and native apps are modeled/deferred rather
than faked.

## 1. Completed

**Foundation**
- Multi-tenant Prisma schema: `Organization → Portfolio → Region →
  Property → Building → Floor → Area → BuildingSystem → Asset`, plus
  `Membership` + `AccessGrant` for RBAC/scoping, `User`.
- Auth: NextAuth v5, credentials + bcrypt + JWT sessions. `src/auth.ts`.
- Tenant isolation: `propertyScopeWhere()` / `issueScopeWhere()`
  (`src/lib/tenant-scope.ts`) — the only sanctioned way to scope a query;
  server-resolved from session, never from client input.
- Permission engine: `src/lib/permissions.ts`, one `Role → Permission[]`
  map, consumed identically by API routes and nav.
- Canonical event system (`Event` table + `src/lib/events.ts`) and a
  separate audit trail (`AuditLog` + `src/lib/audit.ts`).
- Feature flags (`FeatureFlag` + per-org `FeatureFlagOverride`).

**Scoring engine**
- `src/lib/scoring.ts`: configurable category weights
  (`ScoringCategoryWeight`, org override over platform default), Health /
  Risk / Data Confidence / Capital Exposure (12/24/36mo, by category),
  computed from real asset condition + open issues, never invented by an
  LLM. Append-only `PropertyHealthSnapshot` history.
- `AssetConditionHistory` is append-only; `recordAssetConditionChange()`
  (`src/lib/asset-condition.ts`) is the one path that updates it, recomputes
  asset + property health, and emits an event — used identically by the
  manual asset-condition API and by assessment `CONDITION` answers.

**Core domain + API + UI**
- Properties, Assets, Issues, Assessments (templates + sections +
  questions + instances + answers), Evidence, Documents (versioned),
  Vendors — Prisma models, authorized REST-ish API routes
  (`src/app/api/**`), and UI (`src/app/(app)/**`) with loading states via
  React Server Components, explicit empty states, and error handling.
- File storage abstraction (`StorageProvider`) with a real disk-backed
  local implementation using HMAC-signed, expiring upload/download URLs —
  large files never proxy through the app server.
- Matterport/Drone data model (`MatterportConnection/Space/PropertyLink/
  Reference`, `DroneCapture/Dataset/Image/ProcessingJob/Output`) with
  honest empty-state UI on the property Interior/Exterior/Digital Twin
  tabs when nothing is connected.
- Global search (`/api/search`), notifications (`Notification` model +
  header bell + mark-read), CSV reports (property condition, capital
  exposure) reading from the same live data as the dashboards.

**Role-aware web experience**
- Role-based dashboard router (`/dashboard`) rendering four distinct
  views from shared data services: `PortfolioOverview` (Owner / Portfolio
  Admin / Regional Manager / Viewer — same component, scoped query),
  `FacilitiesActionDashboard`, `FieldWorkDashboard` (Inspector/Technician),
  `VendorDashboard`.
- Platform Admin console (`/admin`, gated on `User.isPlatformAdmin`, not
  any org permission) and org Settings (`/settings`: team, subscription,
  feature flags).
- Property profile with all 12 spec tabs (Overview, Exterior, Interior,
  Digital Twin, Assets, Assessments, Issues, Documents, Projects, History,
  Reports, AI) — Overview/Assets/Issues/Assessments/Documents/History/AI
  fully data-backed; Exterior/Interior/Digital Twin show real
  Matterport/drone status with honest empty states; Projects is an
  explicit "deferred to a later phase" state (see §3).
- Assessment runner (`/assessments/[id]`) supporting YES_NO, TEXT,
  NUMBER, SELECT/MULTI_SELECT, CONDITION question types live; PHOTO,
  VIDEO, MEASUREMENT, ASSET, SIGNATURE fall back to a text-note capture
  with an honest "capture UI not available in this phase" label.
- Design system (`src/components/ui/*`): Button, Card, Badge (health
  band / severity / status), StatTile (clickable — every dashboard number
  deep-links to its filtered list per spec §5), EmptyState/ErrorState.

**AI**
- AI tool gateway (`src/lib/ai/tools.ts` + `src/lib/ai/gateway.ts`):
  16 approved tool functions matching the spec's list, each scoped to the
  caller's session so the LLM cannot query outside its tenant/role. Uses
  `@anthropic-ai/sdk`'s beta tool runner. Every query is logged
  (`AIQueryLog`) with tool calls + source refs for traceability.
  **Degrades honestly**: with no `ANTHROPIC_API_KEY` configured (the
  default in this environment), the AI page states plainly that it isn't
  configured rather than fabricating an answer — verified live in both the
  Playwright smoke pass and the e2e suite.
- `AIFinding` model + `ValidationStatus` enum are in the schema for the
  future computer-vision "AI Suggested / Not Verified" workflow — no
  automatic defect detection is implemented, per the spec's explicit
  prohibition on faking this.

**Billing / onboarding scaffolding**
- `SubscriptionPlan` (Founding Partner / Portfolio / Enterprise, seeded
  with the spec's target price bands), `OrganizationSubscription`,
  `SubscriptionItem`, `UsageRecord`, `OnboardingProgress`, `ImportJob` —
  modeled and seeded, surfaced read-only in Settings; no payment
  processor integration (out of scope, see §3).

## 2. In progress / partially built

- **Reports**: CSV only (property condition, capital exposure) — real
  data, no PDF/Excel rendering yet.
- **Assessment → asset linkage**: `CONDITION` questions save against the
  Assessment; the runner UI doesn't yet let the inspector pick which
  specific `Asset` a category-level question applies to, so assessment
  answers don't automatically cascade into `AssetConditionHistory` unless
  the API is called with an explicit `assetId` (the API path fully
  supports it — see `tests/integration/scoring-pipeline.test.ts` — the UI
  wiring for asset selection per question is the remaining piece).
- **Import/CSV bulk upload**: `ImportJob` model + status machine exist;
  the upload → preview → column-mapping → validate → import UI is not
  built.
- **Notifications**: in-app only; email/SMS/Slack/Teams are architected
  (separate channel concept intentionally not baked into the schema) but
  not implemented.

## 3. Deliberately deferred (out of this session's scope)

Flagged rather than faked:

- **Live Matterport / PIX4D integrations.** Data model + UI are ready to
  receive real capture data; no OAuth/API client for either provider is
  implemented. The `InteriorCaptureProvider` / `PhotogrammetryProvider`
  adapter interfaces described in the spec are the next abstraction layer
  to add once real credentials exist to build/test against.
- **Native iOS/Android field app.** Web is responsive down to mobile
  viewport widths; a PWA layer and native app are future workstreams per
  the spec's own stated order (responsive web → PWA → native).
- **Offline sync**, **point cloud/mesh viewer**, **computer-vision defect
  detection** — all explicitly gated behind feature flags
  (`offline_mobile`, `point_cloud`, `computer_vision`) and off by default;
  building fake versions of these would violate "do not mock functionality
  and call it complete."
- **Payment processor integration** (Stripe or similar) for the billing
  models — the data model, plan configuration, and entitlement surface
  exist; charging real money is out of scope without explicit direction.
- **PDF/Excel report rendering**, **document text extraction / vector
  search** (§29) — architected (Document/DocumentVersion support it) but
  only keyword search is implemented.
- **SSO/enterprise auth**, **multi-region DR runbook**, **cost-metering
  pipelines wired to real cloud billing APIs** — modeled, not wired.

## 4. Tests

- **Unit** (`tests/unit/`, Vitest): scoring category weights, health-band
  thresholds, asset-type → category inference, full permission engine
  (role→permission mapping, org-wide vs. scoped role classification).
- **Integration** (`tests/integration/`, Vitest against a real Postgres
  test database):
  - `tenant-isolation.test.ts` — the spec's explicit acceptance case
    ("Org A user requests Org B property → EXPECTED: 403"), implemented
    at the authorization-logic layer every API route shares. **One
    deliberate deviation**: routes return **404**, not 403, for
    cross-tenant/out-of-scope lookups — this avoids confirming a
    resource's existence to a caller who shouldn't see it, which is
    stricter than a 403 would be. Documented in the test file itself.
    Also covers: a scoped role (Regional Manager) with a grant on one
    region cannot see another region in the *same* org; a scoped role
    with **zero** grants sees nothing (secure-by-default, not
    everything); a forged/misconfigured grant naming another org's
    property still can't cross the tenant boundary.
  - `scoring-pipeline.test.ts` — the full spec §12 flow end-to-end
    against real data: an asset condition change appends
    `AssetConditionHistory` (never overwrites), recomputes the asset,
    recomputes the property's health snapshot, and the exposure numbers
    move accordingly.
- **E2E** (`tests/e2e/`, Playwright against a running dev server + seeded
  demo org): login → role-correct dashboard for Owner, Facilities
  Manager, Vendor, Platform Admin; Regional Manager's property list
  scoped to their region only; Vendor blocked from `/admin`; full
  Portfolio → Property → Asset drill-through; AI's honest
  not-configured degradation. All 8 passing against a live browser with
  zero console errors (verified in this session).
- `npm run typecheck`, `npm run lint`, and `npm run build` (production,
  Turbopack) all pass clean as of the final commit in this session.

## 5. Migrations

Three migrations in `prisma/migrations/`, applied to both the dev and test
databases:

1. `20260818020122_init` — full initial schema.
2. `20260818020244_add_membership_vendor_link` — ties a Vendor-role
   `Membership` to its `Vendor` record so vendor users are scoped by
   assignment, not property access.
3. `20260818023207_add_issue_comment_author` — adds the `IssueComment →
   User` relation that was missing from the initial schema (caught by
   `tsc`, not by a runtime surprise).

All additive/non-breaking; no destructive migrations were run.

## 6. Known risks

- **Prisma 7 / Next 16 are very new** (this environment's date is well
  past this assistant's training cutoff) — the driver-adapter pattern
  (`@prisma/adapter-pg`, no `datasource.url` in schema) and Next's
  `proxy.ts` rename are recent breaking changes; this codebase was
  written and verified against the actual installed versions (migration
  ran, client generated, production build succeeded, e2e suite passed
  against a live server), not against training-data assumptions.
- **AI cost/latency are unmeasured** — no `ANTHROPIC_API_KEY` was
  available in this environment to test a live tool-calling round trip;
  the gateway code follows the documented SDK patterns but hasn't been
  run against the real API.
- **Load testing not performed** — the scoring engine's
  `getLatestHealthSnapshots()` uses a `DISTINCT ON` raw query designed for
  portfolio scale, but no load test was run against 1,000+/10,000+
  synthetic properties (spec §62).
- **Single environment tested** — only local dev + a local test database;
  staging/pilot/production environment promotion, secrets management, and
  backup/DR procedures are documented as intent in this report, not
  implemented as runbooks.
- **CSV report / import validation is thin** — no fuzz/malformed-input
  testing on the CSV report endpoints beyond normal use.

## 7. Next workstreams (in priority order)

1. Wire a real Matterport OAuth connection + `InteriorCaptureProvider`
   adapter; same for a PIX4D `PhotogrammetryProvider` adapter.
2. Assessment-runner UI: asset picker per `CONDITION` question so
   inspections cascade into `AssetConditionHistory` without a manual API
   call.
3. CSV/Excel bulk import UI (upload → preview → column mapping →
   validate → import → error report) on top of the existing `ImportJob`
   model.
4. PDF/Excel report rendering.
5. Document text extraction + chunking + search index (spec §29).
6. Stripe (or equivalent) integration behind the existing
   `OrganizationSubscription`/`SubscriptionItem` models.
7. PWA layer for the field experience; native app after that.
8. Load testing at 1,000/10,000-property scale; add caching/materialized
   views to `getLatestHealthSnapshots` if needed at that scale.
9. Staging/pilot environment + secrets + backup/DR runbook.
