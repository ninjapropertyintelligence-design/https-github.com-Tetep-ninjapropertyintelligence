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

---

# Phase 2 — Real Property Data Integration & One Complete Deep-Property Workflow

Phase 2 builds on the Phase-1 foundation above (not rebuilt) to make one real
pilot property — the seeded "Store #1052" — genuinely work end-to-end: real
Matterport interior integration, a real (manually-imported) drone exterior
pipeline, a provider-agnostic AI gateway, document text extraction/search,
PDF/CSV reporting, event-driven score recalculation, and platform-admin
integration recovery tooling. Nothing described as "done" below is mocked in
production code; every honest-degradation path (no Matterport credentials, no
AI provider key) is real code hitting a real `NOT_CONFIGURED` state, not a
canned response.

## Phase 2 — Completed

**AI provider abstraction** (`src/lib/ai/provider.ts`, `provider-factory.ts`,
`providers/{anthropic,openai,null}-provider.ts`) — `AIProvider` interface
(`generateResponse`, `runToolLoop`, `supportsVision`, `supportsStructuredOutput`);
`AnthropicProvider` (manual tool loop over `messages.create`) and
`OpenAIProvider` (Chat Completions API) both drive the **same** tool
gateway (`src/lib/ai/tools.ts`) — no duplicated tool logic. Selected via
`AI_PROVIDER` env var; falls back to `NullProvider` (throws
`AIProviderNotConfiguredError`, caught and surfaced as an honest "AI is not
configured" message) when no matching API key is present.

**Real Matterport integration** (`src/lib/integrations/matterport-provider.ts`,
`src/lib/matterport-service.ts`) — `InteriorCaptureProvider` interface fully
implemented against Matterport's Model API (GraphQL, Basic-auth token/secret)
for `listSpaces`/`getSpace`/`syncSpace`, plus the Showcase embed URL scheme
for `getViewerConfig`. Relationship is `Property → MatterportPropertyLink →
MatterportSpace`, never a duplicate business object. Every mutating action
(`connect`, `disconnect`, `link`, `sync`) is tenant-scoped and permission-gated
(`canManageIntegrations` for org connect/disconnect, `canPerformCapture` for
property-level link/sync/disconnect). Disconnecting removes the connection/link
only — the Property is never touched. Credentials are encrypted at rest
(AES-256-GCM, `src/lib/integrations/crypto.ts`).

**Interior tab** (`src/components/interior/InteriorManager.tsx`,
`/properties/[id]?tab=interior`) — header shows Provider / Status / Last Sync
/ Capture Date / Space ID; renders the live Matterport iframe when connected
and linked; renders the honest "Matterport is not configured" empty state
otherwise (verified live — no credentials exist in this environment); side
panel lists Areas/Assets/Issues/Evidence for the linked space, and clicking an
asset opens its canonical `/assets/[id]` record.

**Real drone exterior pipeline** (`src/lib/drone-service.ts`,
`src/components/exterior/ExteriorManager.tsx`) — full manual-import workflow:
Create Capture → signed direct-upload URL → client computes SHA-256
(Web Crypto) → register Image/Output → server **re-reads the actual bytes
from storage** (`StorageProvider.verifyUpload`) and rejects a mismatched
size/checksum, rather than trusting the client's claim. Large files never
pass through the Next.js server. Extension allowlists per
`DroneOutputType` (`PHOTO_SET`/`ORTHOMOSAIC`/`POINT_CLOUD`/`MESH_3D`/`DSM`/`DTM`).
Exterior tab renders Capture Summary → Photos → Orthomosaic → other outputs,
in that priority order, with an honest empty state when no capture exists.
`ExteriorMarker` lets a user pin a photo/orthomosaic location to an existing
Asset/Issue/Evidence record — never a new duplicate object (schema-enforced:
exactly one of `droneImageId`/`droneOutputId`, exactly one of
`assetId`/`issueId`/`evidenceId`, via a Zod `.refine()`).

**Deep Property Onboarding** (`src/lib/property-onboarding-status.ts`,
`/properties/[id]/onboarding`) — 9-step checklist (details, interior,
exterior, assets, assessment, issues, documents, health-calculable, AI-ready)
with a live completion percentage and deep-links into each tab.

**Data Confidence warnings** (`src/lib/scoring.ts` →
`getDataConfidenceWarnings`) — flags stale/missing interior capture, exterior
capture, and assessments (by months-since) plus zero-asset properties;
rendered as an explicit amber banner on the Overview tab rather than being
silently folded into the confidence number.

**Shared property header** (`src/components/property/PropertyHeaderStats.tsx`)
— Health / Risk / Confidence / Exposure shown identically across every tab,
reading the same `PropertyHealthSnapshot` so numbers never drift tab-to-tab.

**Event-driven recalculation** — `assessment.completed` (already wired in
Phase 1's PATCH `/api/assessments/[id]`), plus newly wired: Matterport
link/sync/disconnect and drone `markCaptureReady` each call
`recalculatePropertyHealth()` synchronously in the same request, so the
property header reflects a linked/synced capture or a ready exterior dataset
immediately — verified in the new e2e test (assessment completion produces a
new `PropertyHealthSnapshot` with a fresh `computedAt`).

**Document intelligence foundation** (`src/lib/document-extraction.ts`) —
`Document → text extraction (pdf-parse) → DocumentChunk → keyword search`.
No vector infra is configured in this environment, so search is **real
Postgres full-text search** (`to_tsvector`/`plainto_tsquery`/`ts_rank`), not a
faked semantic search. Every chunk retains `organizationId`/`propertyId`/
`assetId`/`documentId`/`pageNumber`. `searchDocumentChunks()` is scope-filtered
before any row reaches the caller (verified in
`tests/integration/phase2-ai-documents-reports.test.ts`).

**Reporting v1** — Property Condition Report (PDF + CSV), Executive Summary
(PDF), Capital Exposure (CSV) — all render from one shared query
(`getPropertyReportData`) so the PDF and CSV of the "same" report can never
disagree. PDF rendering uses `pdfkit`'s **standalone** build
(`pdfkit/js/pdfkit.standalone.js`) — see Known Risks below for why the
default entrypoint doesn't work under Next.js/Turbopack.

**AI property-scoping** (`src/lib/ai/gateway.ts`) — when a question is asked
from `/properties/{id}/ai`, the tool surface offered to the model is
literally reduced to property-scoped tools with `propertyId` forced
server-side (`scopeToolsToProperty`) — the model cannot retrieve another
property even if asked, verified by an integration test that a scoped
toolset's `getProperty` ignores/overrides an attacker-supplied `propertyId`.
Evidence references come back as structured `{type, id}` pairs
(`AskAiInline`'s `REF_HREF` map turns them into `[Open Asset →]`-style links)
— never a URL embedded in model-generated text.

**Platform Admin integration operations**
(`src/lib/admin-service.ts`, `/admin` Integrations panel) — inspect Matterport
connections (all orgs), failed drone captures, failed drone processing jobs,
failed document indexing jobs, recent AI query logs, and current AI provider
configuration; retry buttons for Matterport reconnect, drone capture retry,
and document reindex — all audit-logged, all gated on `isPlatformAdmin`
rather than any org-scoped permission. No direct DB manipulation needed.

**Observability** (`src/lib/observability.ts`) — structured
newline-delimited-JSON logging (a real, working sink — stdout, exactly what a
log shipper tails in production) wired into: Matterport API calls
(`matterport.api_call`) and sync duration (`matterport.sync`); drone upload
verification, success/failure + size (`drone.upload`); AI tool calls and the
top-level provider call, success/failure + latency (`ai.tool_call` /
`ai.provider_call`); document indexing jobs, success/failure + duration
(`document.index_job`); PDF report generation, success/failure
(`report.generate`) — this is exactly the log line that caught the pdfkit
bundler bug described below, during the e2e test that generates a real
report.

**Deep-property e2e test** (`tests/e2e/deep-property.spec.ts`) — the full
spec §21 flow against the seeded pilot property: login as Owner → Overview
(header stats) → Interior (confirm honest `NOT_CONFIGURED`) → Exterior (view
2 real seeded drone photos) → Asset (RTU-04 → Condition History) → Issue
(RTU-04 compressor vibration) → create + complete a fresh Assessment via the
real UI → confirm a new health snapshot was computed → Ask AI (confirm honest
degradation, no key configured) → generate a real PDF Property Condition
Report and verify the response is a well-formed PDF. All 9 e2e tests
(8 Phase-1 + this one) pass against a live dev server.

**Seed data** (`prisma/seed.ts`) — the pilot property now has a **real** drone
capture: two genuine on-disk JPEG files (written to `.local-storage/`,
checksummed the same way a real upload would be) registered as `DroneImage`
rows, so `npm run db:seed` produces an Exterior tab with actual photos to
view, not an empty state. Idempotent (guarded by `findFirst`), matching the
rest of the seed script's pattern.

## Phase 2 — Partially completed

- **Drone processing pipeline is manual-only.** `DroneProcessingJob` exists
  in the schema and the admin panel can inspect/retry failed jobs, but there
  is no PIX4D (or equivalent) automation that turns raw photos into an
  orthomosaic/point cloud/mesh — per spec, this was explicitly out of scope
  for Phase 2 ("manual drone output import first, before PIX4D automation").
  Orthomosaic/point-cloud/mesh outputs can be registered and displayed if a
  user uploads them directly, but nothing generates them.
- **Point cloud / mesh viewer.** Files register and download correctly; there
  is no in-browser 3D viewer for `POINT_CLOUD`/`MESH_3D` outputs (photos and
  orthomosaic images render directly; other outputs are listed with a
  download link only) — explicitly de-scoped by spec §6 ("don't block Phase 2
  on point-cloud rendering difficulty").
- **Assessment→asset cascade UI gap carries over from Phase 1** — see Phase 1
  §2 above; unchanged this session.

## Phase 2 — Deferred (not started)

- Automated DJI flight control.
- Full custom photogrammetry engine.
- Advanced CV defect detection (schema hooks — `AIFinding`,
  `ValidationStatus` — exist from Phase 1; no model runs).
- Perfect unified Matterport/drone 3D fusion (single coordinate space across
  both capture types).
- Full CMMS integrations, full payment processing, full SOC 2 program.
- Excel report export (CSV covers structured lists per spec; Excel explicitly
  deferrable).

All of the above are explicitly out of scope per this task's own instructions
(§26) — flagged here for completeness, not silently dropped.

## External credentials required to fully verify

Everything below is **built and testable** (mocked-fetch integration tests
cover the real request/response contracts) but has never made a live round
trip in this environment, because no credentials exist here:

- `MATTERPORT_API_TOKEN` / `MATTERPORT_API_SECRET` (+ optional
  `MATTERPORT_SDK_KEY`) — without these, `MatterportProvider.isConfigured()`
  is `false` and every org sees the honest "Matterport is not configured"
  state. The GraphQL query field names follow Matterport's documented Model
  API shape as of authoring; confirm against
  `https://matterport.github.io/showcase-sdk/` before pointing at a
  production account, since a partner-only API can move under you.
- `AI_PROVIDER` + `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` — without a key,
  `getAIProvider()` returns `NullProvider` and every AI answer states plainly
  that it isn't configured, per spec §28 ("never fake an AI response").
- A real PIX4D (or equivalent) API key would be required to automate the
  currently-manual drone processing step — not attempted this phase.

## Migrations

One migration this phase, applied to both the dev and test databases:

- `20260818032156_phase2_matterport_drone_metadata_exterior_markers_document_chunks`
  — adds `MatterportConnection.errorMessage`; adds `mimeType`/`sizeBytes`/
  `checksum` to `DroneImage`/`DroneOutput`; adds the `ExteriorMarker` model
  (Asset/Issue/Evidence pin, schema-enforced single-target); adds
  `Document.indexStatus`/`indexError`/`indexedAt` and the `DocumentChunk`
  model. All additive/non-breaking — no destructive changes.

## New environment variables

```
AI_PROVIDER=anthropic            # "anthropic" | "openai" | "none" (default: anthropic)
OPENAI_API_KEY=
MATTERPORT_API_TOKEN=
MATTERPORT_API_SECRET=
MATTERPORT_SDK_KEY=              # optional — enables the private/SDK embed instead of public share embed
MATTERPORT_API_BASE_URL=         # optional override, defaults to Matterport's Model API GraphQL endpoint
INTEGRATION_ENCRYPTION_KEY=      # AES-256-GCM key for encrypting stored provider credentials; falls back to NEXTAUTH_SECRET if unset
```

## Tests

- **Unit**: 2 new permission-boundary tests (`canPerformCapture`,
  `canManageIntegrations` role mappings) appended to
  `tests/unit/permissions.test.ts`.
- **Integration** (Vitest against real Postgres, 3 new files, all passing):
  - `tests/integration/phase2-matterport.test.ts` — Org A cannot see/link/
    sync/disconnect Org B's Matterport spaces or links; `MatterportProvider`
    degrades cleanly on missing config and on an unreachable endpoint (no
    live credentials touched).
  - `tests/integration/phase2-drone.test.ts` — cross-tenant capture/dataset/
    image/output access denied; integrity check rejects registering an image
    with no file actually at the storage key; disallowed file extensions
    rejected per output type.
  - `tests/integration/phase2-ai-documents-reports.test.ts` — property-scoped
    AI toolset cannot be redirected to another property by a forged
    `propertyId` argument; org-wide toolset properly reflects portfolio
    scope; document search never returns another org's chunks; report data
    generation throws for an out-of-scope property.
- **E2E** (Playwright, 1 new file): `tests/e2e/deep-property.spec.ts` — see
  above. All 9 e2e specs (8 Phase-1 + 1 Phase-2) pass.
- Full suite as of this session's final commit: `npx tsc --noEmit` clean,
  `npm run lint` clean (0 errors), `npx vitest run` — **46/46 passing across
  7 files**, `npx playwright test` — **9/9 passing**, `npm run build`
  (production, Turbopack) succeeds.

## Known risks

- **`next-auth`/`next/headers` import-chain fragility for Vitest.** Several
  new Phase 2 service files initially imported `SessionContext`/
  `propertyScopeWhere`/`ApiError` from the "heavy" Phase-1 modules
  (`session-context.ts`, `api-utils.ts`), which transitively import
  `next/headers` → breaks under Vitest's Node module resolution (`Cannot
  find module '.../next/server'`). Fixed by routing all new service files
  (and two touched Phase-1 files, `ai/tools.ts`/`ai/gateway.ts`/
  `dashboard.ts`) through the pre-existing lightweight `tenant-scope.ts` and
  a newly-added zero-dependency `api-error.ts`. **Risk**: this is an easy
  mistake to reintroduce — any new `src/lib/*.ts` file that needs
  `SessionContext` or `ApiError` and might be imported by a Vitest
  integration test must import from `tenant-scope.ts`/`api-error.ts`, not
  `session-context.ts`/`api-utils.ts`.
- **`pdfkit`'s default entrypoint is broken under Next.js/Turbopack server
  bundling.** `new PDFDocument()` from the standard `"pdfkit"` import throws
  `ENOENT` trying to read `Helvetica.afm` from a path built off `__dirname`,
  because Turbopack rewrites `__dirname` to a virtual build path that doesn't
  contain pdfkit's font data files. This was caught **live**, by the new
  deep-property e2e test actually generating a report against the running
  dev server — not by a unit test with a mocked renderer. Fixed by importing
  `pdfkit/js/pdfkit.standalone.js` instead, which embeds font metrics inline
  rather than reading them from disk (with a small ambient `.d.ts` since
  `@types/pdfkit` only covers the default entrypoint path). Any future PDF
  work in this codebase must use the standalone import.
- **Matterport Model API contract is unverified against a live account** —
  see External Credentials above; field names could have moved since this
  was authored.
- **Local disk storage does not scale past one server instance** — unchanged
  from Phase 1; still the right abstraction (`StorageProvider`) for an S3/R2
  swap later, just not exercised at that scale here.
- **Full-text search has no relevance tuning** — `ts_rank` on a single
  `english`-config `to_tsvector` is a reasonable default, not tuned (stemming
  edge cases, stop words, multi-language documents are all unaddressed).

## Performance notes

- Drone/document uploads are verified with a **real** disk read + SHA-256
  hash of the actual uploaded bytes (`StorageProvider.verifyUpload`) rather
  than trusting client-reported size/checksum — this is a real integrity
  check, not free, but it's O(file size) once per upload and never proxies
  the file through the app server's request/response cycle.
- PDF generation is synchronous within the request (`drawDocument` awaited
  inline) — fine at pilot-property scale (single-digit seconds for a report
  with ~10 assets), but a portfolio-wide "generate reports for all
  properties" batch job would want to move this off the request path.
- No caching layer was added for `getPropertyReportData`/
  `getPropertyOnboardingStatus`/`getPropertyInteriorStatus` — each recomputes
  from Postgres on every request. Fine at current scale; worth revisiting
  together with the Phase-1 `getLatestHealthSnapshots` load-testing
  workstream if/when portfolio sizes grow.

## Next recommended workstream

1. Obtain real Matterport partner credentials and verify the Model API
   GraphQL contract live (field names, pagination, capture-date exposure);
   adjust `matterport-provider.ts` if the schema has moved.
2. Obtain an `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) and verify a live
   tool-calling round trip end-to-end, including the property-scoped
   restricted toolset, against the real model.
3. PIX4D (or equivalent) automation for the drone processing pipeline —
   `DroneProcessingJob` and the admin retry UI are ready to receive it.
4. ~~Point cloud / mesh 3D viewer for `POINT_CLOUD`/`MESH_3D` outputs.~~ —
   **done, see below.**
5. Move PDF report generation off the request path for portfolio-wide batch
   generation once report volume justifies it.
6. Carry forward Phase 1's remaining next-workstream list (assessment→asset
   picker UI, CSV/Excel bulk import UI, Stripe integration, PWA/native,
   load testing, staging/DR runbook) — none of it was touched this phase.

---

# Post-Phase-2 workstream — Point cloud / 3D mesh viewer

Real in-browser preview for `POINT_CLOUD`/`MESH_3D` drone outputs
(`src/components/exterior/Object3DViewer.tsx`), using `three` — no CDN, a
real npm dependency bundled with the app, code-split via `next/dynamic`
(`ssr: false`) so the WebGL/Canvas code never touches the server render and
only loads when a user actually clicks "View in 3D" on the Exterior tab.

**Supported formats** — only formats this can parse *correctly*, no
hand-rolled binary parsers for anything risky:
- Mesh: `.glb`/`.gltf` (`GLTFLoader`), `.obj` (`OBJLoader`), `.fbx`
  (`FBXLoader`), `.ply` with face data (`PLYLoader`, rendered as a lit
  `THREE.Mesh`).
- Point cloud: `.ply` without face data (`PLYLoader`, rendered as
  `THREE.Points`), `.xyz` (a genuinely trivial whitespace-delimited text
  format — parsed here directly, safe to hand-roll).

**Deliberately NOT supported, with an honest message instead of a guess**:
`.las`/`.laz` (LiDAR binary formats — LAZ is compressed and needs a real
decoder; LAS's binary header layout isn't something to hand-roll from
memory without a spec reference in front of you) and DSM/DTM GeoTIFF
elevation rasters (a fundamentally different data type — heightmap images,
not 3D geometry — out of scope for a mesh/point-cloud viewer). Clicking
"View in 3D" only appears for formats that are actually supported; for
everything else, the existing download link is what's shown — never a
button that leads to a guaranteed error.

**Viewer behavior**: auto-fits the camera to the geometry's bounding box
(so a 2-meter test mesh and a 200-meter real point cloud both frame
correctly), orbit/zoom via `OrbitControls`, a `HemisphereLight` +
`DirectionalLight` pair so glTF/OBJ/PLY materials render lit rather than
flat black, and fixed-pixel (non-distance-attenuated) point size so a
sparse point cloud stays visible regardless of world-space scale.

**Verified live** (not just typechecked): started the actual dev server,
seeded the pilot property with a real ASCII PLY tetrahedron mesh and a real
XYZ point-cloud grid (`prisma/seed.ts`, idempotent per-artifact — safe to
re-run), then drove a real Chromium browser via Playwright to click "View in
3D" on both outputs, confirmed a `<canvas>` element rendered with zero
console errors, screenshotted both (lit grey tetrahedron; a visible grid of
blue points), and confirmed dragging the canvas actually changes the
rendered pixels (real orbit-control interaction, not a static image).
Full gate re-run after the change: `tsc --noEmit` clean, `eslint` clean,
`vitest run` 46/46, `playwright test` 9/9, `next build` succeeds.

**New dependency**: `three` (+ `@types/three` dev dependency) — MIT
licensed, no runtime network calls, ~600KB but only loaded on-demand behind
the dynamic import, never in the initial bundle for users who don't open a
3D output.

---

# Post-Phase-2 workstream — Top 3 audit gaps closed

Follows a full spec-compliance audit (see the "Blueprint Audit" artifact
from this session) against all 120 sections of the master spec. Closed the
three highest-impact gaps ranked against the spec's own Day-45 acceptance
bar.

## 1. AI evaluation suite (spec §29, §97 "AI" criterion)

`tests/ai-eval/benchmark.ts` — the permanent fixture set the spec asks
for: 8 cases, each with a question, expected result, allowed sources, and
a `mustNot` list, covering all six spec test categories (numerical
accuracy, retrieval accuracy, permission compliance, hallucination rate,
missing-data behavior, citation correctness). `tests/integration/
ai-evaluation-suite.test.ts` implements every case 1:1 against fresh,
deterministic fixture data (never the shared demo seed, so expected counts
never drift) — a structural test asserts the two files stay in sync.

Two kinds of case, both real:
- **Deterministic cases** (7 of 8) run on every `vitest` invocation, no AI
  provider required — they call the actual tool functions
  (`src/lib/ai/tools.ts`) the model would call, against known fixture
  data. These enforce the non-negotiable guarantees today: a forged
  cross-org ID returns `found: false`, a nonexistent asset type returns a
  plain zero, every `{type, id}` source ref resolves to a real in-scope
  row, and — provable without any API key — asking a question with no
  provider configured returns the honest "not configured" message with
  **zero** tool calls and **zero** source refs (a direct, automated check
  of hallucination avoidance).
- **Live-model case** (1 of 8) is `describe.skipIf(getAIProvider()
  instanceof NullProvider)` — it asks the real natural-language question
  through `askPropertyAI()` and checks the answer's stated number against
  the same fixture ground truth. It is skipped, not faked, in this
  environment (no API key exists); the moment real credentials are added,
  this suite starts scoring live answer quality automatically, with no
  further code changes.

Result: 8/8 benchmark-covering tests pass (7 run, 1 correctly skipped) —
verified live against Postgres, not just typechecked.

## 2. PhotogrammetryProvider adapter (spec §17)

The audit's most structural finding: drone processing had no provider
abstraction at all — `drone-service.ts` talked directly to Prisma with
zero indirection, meaning a future PIX4D integration would mean
redesigning the service, not swapping an implementation.

Added `src/lib/integrations/photogrammetry-provider.ts` — the
`PhotogrammetryProvider` interface (`createJob`/`uploadImages`/
`startProcessing`/`getStatus`/`getOutputs`/`cancelJob`), mirroring the
spec's exact method list and the same pattern already used for
`InteriorCaptureProvider`/Matterport. `src/lib/integrations/
manual-photogrammetry-provider.ts` implements it for the workflow that
actually exists today (spec §5: manual upload before PIX4D automation) —
`createJob`/`startProcessing` drive a real `DroneProcessingJob` row
through the existing schema; "processing" completes immediately because
the human has already uploaded outputs out-of-band via
`registerDroneOutput()`, not because anything is faked. `drone-service.ts`
now calls `getPhotogrammetryProvider().createJob()` when a dataset is
created and `.startProcessing()` when a capture is marked ready — real
wiring, not a decorative interface nobody calls.

A future PIX4D provider is now a new class implementing the same
interface, selected via `PHOTOGRAMMETRY_PROVIDER` env var — no changes to
`drone-service.ts` or any caller.

One pragmatic scope cut, stated plainly: `DroneCaptureStatus`
(CREATED/UPLOADING/PROCESSING/READY/FAILED) is reused as the job-status
vocabulary rather than adding the spec's separate QUEUED/COMPLETED/
CANCELLED states, to avoid a schema migration for this pass — READY
stands in for "completed," cancellation is FAILED with an explanatory
message. A future provider needing genuinely distinct states is a real
reason to revisit that enum.

Verified with a new integration test asserting a dataset creation
registers a real `DroneProcessingJob` (status CREATED) and marking a
capture ready transitions it to READY with a `completedAt` timestamp, read
back through the provider's own `getStatus()` — not just checked in the
database.

## 3. API response envelope (spec §63)

Every JSON response from this app's ~50 API routes now follows
`{data, error, meta}`, matching spec §63 exactly. This was the widest
blast-radius fix of the three — implemented centrally in
`withApiHandler` (`src/lib/api-utils.ts`) rather than touching each route
file: a route handler still returns a plain value or its own
`NextResponse.json(x, {status})` exactly as before, and the wrapper reads
the body back out and re-wraps it in the envelope, preserving the original
status code. This meant zero changes to any of the ~50 individual route
files.

Client-side, added `src/lib/api-client.ts` (`apiFetch<T>()`) — unwraps
`.data`, throws with the server's `.error` message on failure — and
migrated every component that reads a JSON response body from this app's
own API (`AskAiInline`, `ExteriorManager`, `InteriorManager`,
`CreateIssueForm`, `Header`, `DocumentSearchBox`) to use it instead of raw
`fetch().then(r => r.json())`. Components that only ever read `res.ok` or
an error body's `.error` field (`ConditionUpdateForm`, `IssueStatusForm`,
`AssessmentRunner`, `CommentForm`, `IntegrationsPanel`) needed no change —
the error shape kept `.error` at the same top-level key deliberately, to
minimize the diff.

Explicitly exempt, by design: `/api/auth/[...nextauth]` (NextAuth's own
contract), `/api/uploads/[...key]` (binary file bytes), and the three PDF/
CSV report routes — the envelope is for JSON responses, not file
downloads, and none of these five routes went through `withApiHandler` to
begin with.

Verified live against a running dev server (not just typechecked): logged
in via a real credentials POST, confirmed a successful response returns
`{"data": {...}, "error": null, "meta": {}}` and a 404 returns
`{"data": null, "error": "Property not found", "meta": {}}` with the
status code intact. Full gate re-run: `tsc --noEmit` clean, `eslint`
clean, `vitest run` 55/55 (1 skipped), `playwright test` 9/9 (confirmed
stable at `--workers=1`; two runs hit unrelated cold-Turbopack-compile
timeouts under 2-worker parallelism that don't reproduce standalone or at
`--workers=1` — pre-existing test-infra sensitivity, not a functional
regression), `next build` succeeds.

## Remaining audit gaps

Everything else from the Blueprint Audit is unchanged — still open:
missing portfolio map (§11), unversioned API (§64), no CI/CD (§58), no
bulk import/fuzzy dedup (§68/§69), no MFA or real admin impersonation
(§43/§45), no data retention/secure deletion/backup-DR (§52/§54/§55), no
webhooks (§66), no performance/load-testing evidence (§98/§103), and the
rest of the audit's full findings list. Only the top 3 were in scope for
this pass.
