# Unverified features and evidence needed

Updated 2026-10-20. This is a focused backend-first gap register. [UNVERIFIED_AND_MISSING_FEATURES.md](UNVERIFIED_AND_MISSING_FEATURES.md) contains older UI-level gaps; uninspected projects are **not** now the priority.

| Question | Present evidence | Needed to verify safely |
| --- | --- | --- |
| Which API routes and methods power the dashboard? | Static `/api/v2/...` method/path candidates exist in [the bundle scan](evidence/STATIC_BUNDLE_API_CANDIDATES.md), but no runtime call has been captured. UI routes are not API routes. | Same-profile, authorized, read-only network metadata or vendor API documentation; no tokens/headers/raw payloads retained. |
| What are response schemas and pagination contracts? | UI fields and ranges only. | Redacted field names/types from a scoped capture, with source and coverage limits. |
| How is tenant authorization enforced? | Permission-denied program page and scoped UI lists. | Vendor docs or authorized backend policy evidence; do not probe other tenant IDs. |
| How are Matterport, Potree, Autodesk, and aerial overlays connected? | Rendered iframe/link/asset origins. | Provider configuration or sanitized request metadata; no inference of sync/OAuth/DroneDeploy. |
| Where/how are files stored and processed? | IDS-named S3 asset origins; viewer display. | Authorized architecture docs or sanitized upload/conversion evidence; no upload test in production. |
| Which frontend framework and server stack are used? | Bundled script references and root div. | Source/bundle analysis or vendor documentation; script tags alone insufficient. |
| What formulas drive status/progress? | Display totals and task flags. | Product specification or non-sensitive test fixtures; no production mutations. |

All unknowns stay unknown until the stated evidence exists. No application implementation, backend service, database, or Supabase resource was created during this audit.
