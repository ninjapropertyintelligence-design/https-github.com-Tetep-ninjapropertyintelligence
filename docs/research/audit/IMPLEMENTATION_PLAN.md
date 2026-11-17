# Independent implementation plan — not started

Goal: build a **functionally similar, independently developed** multi-tenant operations dashboard with Next.js, TypeScript, Tailwind CSS, and Supabase. Reproduce observed user needs and interaction patterns, not Phygii code, private assets, branding, API contracts, or data. This is a plan only; no application code or Supabase project was created.

## Scope and evidence boundary

Prioritize verified flows: organization selection, location directory/map, location detail tabs, project directory/detail, documents and versions, assignment tree, response progress, collections empty states, and profile settings. Treat map behavior, report generation, uploads, editing, exact statuses, and API payloads as product-design decisions requiring fresh requirements rather than copied behavior. Do not import any private Phygii content into development or tests.

## Suggested architecture

| Layer | Independent design choice |
| --- | --- |
| Web UI | Next.js App Router with TypeScript and Tailwind CSS; nested layouts for organization/location/project contexts; accessible tabs, tables, filters, dialogs, and empty states. |
| Authentication | Supabase Auth with server-side session handling; define organization membership and roles in application tables, not editable user metadata. |
| Data | Supabase Postgres tables for organizations, memberships, locations, projects, project documents/versions, media, overlays/embeds, assignments, sections, tasks, questions, responses, answers, and collections. Use explicit foreign keys and status constraints. |
| Authorization | Row Level Security on every exposed table, scoped by membership and resource ownership. Re-check authorization server-side for writes and report generation. Test cross-organization denial explicitly. |
| Files | Supabase Storage buckets partitioned by organization/resource; signed or policy-controlled reads; separate upload metadata from object storage. Define retention/versioning deliberately. |
| Maps | Select a licensed map provider and geocoding/tiles contract independently. Use location coordinates with cluster/list synchronization; avoid reusing Phygii map tokens or tiles. |
| Reports | Later phase: server-side, queued generation from authorized response data, with audit trail and explicit approval before any external delivery. |

## Proposed data model (design proposal, not reverse-engineered schema)

1. `organizations`, `organization_memberships`, `profiles`.
2. `locations` with geospatial coordinates and organization ID; `projects` with location, dates, type, and status.
3. `media_assets`, `documents`, `document_versions`, `raster_overlays`, `vector_overlays`, `embeds` with organization/resource ownership and storage references.
4. `assignments`, `assignment_sections`, `tasks`, `questions` with order and explicit configuration flags. Model a separate `project_assignments` association so one template can be linked to multiple projects, as the observed UI permits; this is an **independent design choice**, not a discovered Phygii join table.
5. `responses`, `task_responses`, `answers`, `response_images` with completion state and audit timestamps. In the proposed schema, tie each response to an authorized project–assignment association, not merely to an assignment ID, and test that users cannot read a response through another project's link.
6. `collections`, `collection_items` as optional cross-resource organization.

Keep UI progress counters derived from task/response records, then cache only if profiling shows a need. Use UUIDs or another new identifier scheme; do not mirror observed production IDs.

For the proposed Postgres schema, index foreign-key columns used in project/assignment/response joins, enforce uniqueness on project–assignment pairs, and apply membership-scoped RLS to the association and response tables. Those controls are implementation safeguards, not claims about the target's backend. The UI showed one assignment `403` linked from three projects and three distinct project responses; see [response dossier](pages/assignment-responses.md).

## Delivery sequence

1. **Requirements and safety:** confirm actor roles, allowed tenant boundaries, field semantics, statuses, media rights, retention, and what “functionally similar” means for reports and maps. Create synthetic fixtures only.
2. **Foundation:** initialize Next.js/TypeScript/Tailwind, Supabase local development, migrations, typed data access, authentication, membership-based RLS, and automated denial tests.
3. **Read-only MVP:** organization switcher, location/project lists, detail tabs, responsive layout, empty/loading/error states, and map/list view with licensed sample tiles.
4. **Structured content:** document metadata and versions, overlays/embeds, assignment hierarchy, response progress summaries, and safe search/filter/pagination.
5. **Controlled mutations:** separately specify and implement uploads, assignment/response editing, access controls, and report generation with authorization checks, confirmations, audit logs, and rollback/recovery paths.
6. **Verification:** unit tests for progress calculations and status rules; integration tests for RLS and storage policies; browser tests for each read/write flow; accessibility and performance checks; security review before deployment.

## Acceptance criteria for initial read-only release

- A member sees only their authorized organizations, locations, projects, files, and responses; cross-tenant requests are denied at the database/storage layer.
- Key page states match the **observed information architecture** using synthetic data, without copying Phygii visual assets or private text.
- List search, filters, sort, and pagination have documented, deterministic behavior.
- Assignment and response progress is calculated from defined rules and tested for incomplete/optional/repeatable tasks.
- Unknown production behaviors remain explicitly labeled as design choices, not assumed equivalences.

## Current documentation references

- [Next.js App Router](https://nextjs.org/docs/app) for route/layout structure.
- [Supabase server-side auth clients for Next.js](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs) for current session patterns.
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) for tenant isolation.
- [Supabase changelog](https://supabase.com/changelog) should be rechecked before implementation, especially for auth, storage, and API changes.

Supabase guidance influenced the proposed membership-scoped RLS, avoidance of user-editable metadata for authorization, and separation of public client keys from secret service credentials. Package versions and exact integration APIs must be checked again when implementation begins.
