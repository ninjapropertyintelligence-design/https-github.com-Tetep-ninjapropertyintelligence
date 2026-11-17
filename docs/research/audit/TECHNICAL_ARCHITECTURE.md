# Independent implementation architecture — proposal

No application has been implemented. This architecture is for a functionally similar **original** product, not a claim about the target dashboard's internal stack. Revisit framework/package versions, release notes, and data handling before starting development.

## System boundaries

| Layer | Proposed responsibility | Rationale / status |
| --- | --- | --- |
| Next.js App Router + TypeScript | Tenant-aware routes, server-rendered lists/details, route handlers for validated operations | Proposed; maps the visible page hierarchy. [Current App Router guide](https://nextjs.org/docs/app). |
| Tailwind CSS | Original design tokens, responsive shell, reusable list/filter/tab/modal primitives | Proposed; do not copy logos, imagery, or proprietary assets. [Current Next.js installation guide](https://tailwindcss.com/docs/installation/framework-guides/nextjs). |
| Supabase Auth + PostgreSQL | Identity, tenant membership, relational entities, row-level policies | Proposed; use cookie-aware SSR clients and verified server authorization. [Supabase SSR guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs), [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security). |
| Private object storage | Photos, 360 media, models, documents, raster overlays with signed/authorized reads | Proposed; Storage policies must enforce tenant scope. [Storage access control](https://supabase.com/docs/guides/storage/security/access-control). |
| Map adapter | Map viewport, clustering, layer display, location previews; provider chosen after licensing review | UI map behavior observed, exact target SDK/API unverified. |
| Background workers | Optional image thumbnails, media metadata extraction, document previews, report generation | Proposed only; no target job/queue behavior observed. |
| Spatial provider adapters | Native 360 renderer; rights-compliant Matterport embed, Potree point cloud, Autodesk viewer/link; optional drone provider only if independently chosen | Target visibly uses first three display boundaries [E-DT-02–04](evidence/OBSERVATIONS.md); SDKs, backend APIs, and DroneDeploy use **not verified**. |

Use server components for initial authorized reads, client components only for map interaction, rich filters, media gallery, and responsive control state. Keep tenant selection explicit in routes and server-side checks. Never expose a Supabase secret/service-role key to browser bundles. Use publishable client credentials only where appropriate; enforce RLS even when route handlers validate permissions. Avoid authorization based on user-editable metadata. For update policies, define both existing-row and new-row checks; test cross-tenant read and write denial. Pin versions and lockfiles at implementation time. The current Supabase changelog includes an upcoming TLS cipher change and database-version breaking changes; verify deployment compatibility before rollout, rather than freezing assumptions in this plan ([Supabase changelog](https://supabase.com/changelog.md)).

## Component contracts to design

`AppShell`, `TenantNavigation`, `PageBreadcrumbs`, `SearchableList`, `PaginationRange`, `StatusTabs`, `EmptyState`, `LoadError`, `LocationMap`, `MarkerPreview`, `FilterChooser`, `MediaTypeToggle`, `MediaGallery`, `DocumentVersionList`, `AssignmentTree`, `ProgressSummary`, and `ProfileSettings`. Each requires typed props, loading/error/empty states, keyboard behavior, accessibility names, and independent visual assets. Component-specific observed behavior is in the page dossiers; broad component names here are implementation proposals.

Add a provider-neutral `SpatialAssetViewer` boundary so tenant authorization, provenance, loading/expired-link handling, and error telemetry are shared, while Matterport, Potree, Autodesk, native 360, and raster renderers remain separate. Use only licensed provider APIs and server-held secrets. The observed Phygii iframe/link pattern does not define the new app's backend design; details are in [INTEGRATION_CATALOG.md](INTEGRATION_CATALOG.md).

## API boundary — proposed, not observed target endpoints

Define typed read operations for organizations, locations, projects, media, layers, assignments, responses, collections, and profile. The URL path, HTTP verb, pagination envelope, and schemas must be designed for the new app; [API_ANALYSIS.md](API_ANALYSIS.md) contains **no** discovered target API contracts. Use stable cursor or explicit page/size pagination; choose one and document it. Validate query/filter inputs on the server, enforce tenant authorization on every resource, and return typed loading/empty/error states. Design write APIs only after the product owner approves scope and business rules.

## Verification gates

Before implementation: approve entity/status definitions, privacy model, chosen map provider, media licensing, retention rules, and sample-data source. During implementation: unit-test filters/calculations, integration-test RLS and storage rules, browser-test key read-only flows and accessibility, and security-test cross-tenant object IDs. No deployment or data migration is authorized by this document.
