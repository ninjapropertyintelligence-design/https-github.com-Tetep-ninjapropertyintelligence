# Reverse-engineering progress — Immersion Data Solutions / Phygii

Updated: 2026-10-20. Status: **authenticated Phygii tab verified; three project details and their shared assignment/response list inspected; spatial media first pass complete**. This tracker does not imply exhaustive coverage.

## Access and evidence status

- Prior session: authenticated `app.phygii.ai` UI was observed in the user's Chrome profile; see [DASHBOARD_FEATURES.md](DASHBOARD_FEATURES.md), [PAGE_MAP.md](PAGE_MAP.md), and [USER_FLOWS.md](USER_FLOWS.md). These are historical UI notes, not retained REA Evidence IDs.
- Current session: the Chrome extension exposes the intended `Tom` profile and one `app.phygii.ai` tab. After manual sign-in, the authenticated Organizations page and Client A map were verified. Screenshots were captured inline (`SS-ORG-*`, `SS-MAP-*`), but no durable local image or sanitized network capture has been saved. No credential field was accessed.
- REA MCP responds, but its browser tools require a literal loopback CDP endpoint. No binary target is open, and the target is a browser dashboard, so native decompilation is not relevant.
- Do not mark previously viewed pages fully verified until they receive a second-pass live audit. The Program route previously showed access denied; that is **Not Accessible** in the observed account.
- No production data has been changed. No credentials, cookies, tokens, private answer values, or other-profile content are stored in these documents.
- The Site 2 and Site 3 completed-project tabs (Media, Users, Documents, Assignments, Collections) were opened read-only. Their distinct user totals, document access states, and empty collection tabs are logged in [E-PROJ-S2-01–04 and E-PROJ-S3-01–04](evidence/OBSERVATIONS.md). No user names/emails were retained.
- Assignment `403` was linked from all three project cards, and its project-scoped Responses tab displayed three separate project responses. Site 2 and Site 3 released-response counters were inspected. A global Responses breadcrumb returned a not-found page once; the Projects directory also temporarily failed to load before a single reload succeeded. These are observed transient/navigation states, not proof of permanent absence. [E-ASG-RESP-01–03](evidence/OBSERVATIONS.md)
- A read-only assignment-template pass opened all 27 task and 54 question accordions to inventory visible types/flags. No submitted answers were retained. [Task inventory](pages/assignment-task-inventory.md)
- Site 1 spatial-media inspection verified Matterport VR Showcase, IDS-S3-hosted Potree point cloud, Autodesk Viewer link, native 360 gallery, and aerial raster catalog. See [observation ledger](evidence/OBSERVATIONS.md), [digital-twin specification](DIGITAL_TWIN_SPECIFICATION.md), and [integration catalog](INTEGRATION_CATALOG.md). **DroneDeploy and private backend integration methods remain unverified.**
- All 18 requested root documentation filenames now exist, but many are **partial registers/proposals**, not exhaustive specifications. Page-level and feature-level second passes remain. The architecture/data-model files describe an independent proposed product, not discovered target internals.

## Status key

**Verified** = independently observed for that particular checklist item; **Partially Verified** = some relevant UI was observed, but important states/details remain; **Not Verified** = not tested or no durable evidence; **Not Accessible** = permission boundary observed. Historical UI observations are marked at most **Partially Verified** for page-level completeness.

| Page/module | Discovered | Screenshots captured | UI elements inventoried | Interactions inspected | Forms documented | Tables documented | Filters documented | Calculations examined | Observable APIs documented | Workflows documented | QA coverage created | Remaining unknowns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Organizations directory | Verified | Partially Verified | Partially Verified | Partially Verified | Not Verified | Partially Verified | Partially Verified | Not Verified | Not Verified | Partially Verified | Partially Verified | Search edge cases, multi-page behavior, hover/focus, hidden actions |
| Organization overview | Partially Verified | Not Verified | Partially Verified | Not Verified | Not Verified | Not Verified | Not Verified | Not Verified | Not Verified | Not Verified | Not Verified | Blank content cause, intended overview |
| Organization map | Verified | Partially Verified | Partially Verified | Partially Verified | Not Verified | Partially Verified | Partially Verified | Not Verified | Not Verified | Partially Verified | Not Verified | Marker interactions, full filter effects, map states |
| Site 1 map exploration | Verified | Partially Verified | Partially Verified | Partially Verified | Not Verified | Not Verified | Partially Verified | Not Verified | Not Verified | Partially Verified | Not Verified | Media gallery detail, layer/filter effects, marker interactions |
| Locations directory | Verified | Partially Verified | Partially Verified | Partially Verified | Not Verified | Partially Verified | Partially Verified | Not Verified | Not Verified | Partially Verified | Not Verified | Search edge cases, enabled pagination, retry/error cause |
| Site 1 location detail/tabs | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Not Verified | Not Verified | Partially Verified | Not Verified | Spatial viewer first pass done; full media/overlay interactions, empty/error states |
| Site 1 digital-twin/3D embeds | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Not Verified | Partially Verified | Not Verified | Not Verified | Not Verified | Partially Verified | Not Verified | Provider setup, data loading, hotspot/measurement persistence, second pass |
| Site 2 location detail | Verified | Not Verified | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Not Verified | Not Verified | Partially Verified | Not Verified | Eight tabs read-only first pass; media/overlay interactions not tested |
| Site 3 location detail | Verified | Partially Verified | Partially Verified | Partially Verified | Not Verified | Partially Verified | Partially Verified | Not Verified | Not Verified | Partially Verified | Not Verified | Eight tabs read-only first pass; media/overlay interactions not tested |
| Projects directory | Verified | Partially Verified | Partially Verified | Partially Verified | Not Verified | Partially Verified | Partially Verified | Not Verified | Not Verified | Partially Verified | Not Verified | Search, pagination, sort, error states |
| Published project detail/tabs | Partially Verified | Not Verified | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Not Verified | Not Verified | Partially Verified | Not Verified | All five tabs first-pass inspected; document actions/edit states untested |
| Site 2/Site 3 project details | Verified | Not Verified | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Not Verified | Not Verified | Partially Verified | Not Verified | All five tabs surveyed; mutations, media detail and pagination not tested |
| Assignment detail | Partially Verified | Not Verified | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Not Verified | Partially Verified | Not Verified | 27-task/54-question structure and flags inspected; write/validation rule semantics unknown |
| Response detail | Partially Verified | Not Verified | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Partially Verified | Not Verified | Partially Verified | Not Verified | Progress formulas and write paths |
| Collections directory | Partially Verified | Not Verified | Partially Verified | Partially Verified | Not Verified | Partially Verified | Partially Verified | Not Verified | Not Verified | Partially Verified | Not Verified | Non-empty states and privacy semantics |
| Profile Details/Settings | Partially Verified | Not Verified | Partially Verified | Partially Verified | Partially Verified | Not Verified | Not Verified | Partially Verified | Not Verified | Partially Verified | Not Verified | Edit mode, validation, success/error states |
| Linked Program page | Not Accessible | Not Verified | Not Accessible | Not Accessible | Not Accessible | Not Accessible | Not Accessible | Not Accessible | Not Accessible | Not Accessible | Not Accessible | Access-denied modal observed; no bypass planned |

## Module order and second-pass audit

1. Organizations directory — live first-pass records in [pages/organizations.md](pages/organizations.md) and [features/organizations.md](features/organizations.md); header controls and live second pass **pending**.
2. Organization map and locations — live map first pass in [pages/organization-map.md](pages/organization-map.md); map second pass and locations first/second passes **pending**.
3. Projects/documents, assignments/responses, collections, profile — three project details and the three-response assignment list now have a read-only first pass; deeper task tree, nonempty collections, and write-path behavior **pending**.
4. Cross-module UI/API/permissions/responsive audit — **pending** after stable browser access.

The expanded 2026-10-20 mission adds asset, inspection, analytics, integration, and spatial specifications. Their named documents are working drafts only; a heading or file's existence is **not** verification of a feature. The current Chrome-extension path provides UI/DOM evidence but no authenticated network API capture.

Public IDS/vendor research is separately logged in [evidence/PUBLIC_SOURCES.md](evidence/PUBLIC_SOURCES.md). The published Location → Building → Areas → Assets → Systems model, asset fields, ML/analytics, and SSO/RBAC are **public claims**, not authenticated UI observations for this account. Public research has not identified a DroneDeploy relationship.

After each module, repeat a deliberate sweep of hidden menus, hover/focus states, disabled controls, pagination, empty/error/loading states, and cross-links before promoting its status to Verified.

## Reconnection needed

The extension is connected to the intended profile and authenticated dashboard access is verified. Continue read-only browser work only on `app.phygii.ai`, without copying profile files or cookies. REA browser capture remains unavailable without a scoped loopback CDP endpoint; the Chrome extension provides Playwright-based UI observation.
