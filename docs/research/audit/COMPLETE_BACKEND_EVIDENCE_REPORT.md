# Immersion Data Solutions / Phygii — consolidated backend evidence report

**Date:** 2026-10-20  
**Scope:** Authorized, read-only investigation of the user's existing authenticated Chrome dashboard, plus inert inspection of a publicly retrievable frontend bundle.  
**Status:** Partial backend reconstruction from browser and static-client evidence. **No private backend, database, authenticated HTTP request/response, or server-side integration was accessed or verified. No application was built.**

## 1. Executive conclusion

The dashboard visibly organizes information by organization, location, project, assignment, response, and media/spatial asset. Its current frontend bundle contains literal code that constructs candidate `/api/v2/...` calls for many of those resources. This is meaningful evidence about **client expectations**, but it is not proof of live server endpoints, response schemas, database tables, or integration mechanics. The authenticated Chrome-extension connection used for the audit can inspect pages and rendered DOM, but does not expose network request/response capture. REA's browser recorder requires a loopback CDP endpoint not attached to this Chrome profile. [E-NET-00](evidence/OBSERVATIONS.md)

The browser displayed Matterport, Potree, Autodesk Viewer, S3-hosted images, and map attributions. Those establish browser-facing viewer and asset boundaries. They do **not** establish how IDS uploads, transforms, synchronizes, authorizes, or pays for these services. DroneDeploy was **not verified**. [E-DT-02–04, E-STORAGE-01, E-MAP-05, E-RASTER-01](evidence/OBSERVATIONS.md)

## 2. Evidence levels used throughout this report

| Level | Meaning | Examples in this audit |
| --- | --- | --- |
| Verified UI/runtime observation | Seen in the authenticated page or rendered iframe/asset DOM | Project→location links; response counters; Matterport iframe host |
| Verified static-client observation | Literal text or request construction in the downloaded current browser bundle; code **not executed** by the audit | `/api/v2/projects` inside a `post(...)` call; `project` payload keys |
| Inference | Plausible explanation of observations, not directly demonstrated | A project likely has a stored association to a location |
| Unknown | Evidence absent or tool boundary prevents confirmation | Actual HTTP responses, server framework, database, provider sync |

Local IDs such as `E-JS-01` refer to the [observation ledger](evidence/OBSERVATIONS.md). They are not network captures. The only REA parent Evidence ID in this backend pass records an **incomplete** static-analysis attempt, not a completed decompilation.

## 3. What is established about the application structure

The authenticated UI showed an organization directory, organization-scoped maps and lists, project headers linking locations and programs, project assignment cards, assignment sections/tasks/questions, project-specific response cards, and location/project media, document, raster, and 3D-embed tabs. [E-CLB-ORG-01, E-CLB-PROJ-01–02, E-ASG-TEMPLATE-01, E-ASG-RESP-01, E-DT-01](evidence/OBSERVATIONS.md)

This is a **display relationship map**, not a database ERD:

```text
Organization → visible Locations and Projects
Project → displayed Location and Program links
Project ↔ displayed Assignment card
Assignment → Sections → Tasks → Questions
Assignment/Project → displayed Response cards → progress and task responses
Location/Project → Media, Documents, Raster layers, and 3D embeds
```

Assignment `403` appeared under three Client A project cards, with distinct project-specific response cards. Client B assignment `ID08` had a completed response for one project and a not-started response for another. This supports a UI-level association, not a claim about join tables, copies versus shared templates, or foreign keys. [E-ASG-RESP-01, E-CLB-ASG-02](evidence/OBSERVATIONS.md) The fuller relationship assessment is in [DATA_RELATIONSHIPS.md](DATA_RELATIONSHIPS.md).

### Visible field and rule examples

- Project UI: title, location, program, date range, status, and capture label. [E-PROJ-S2-01, E-CLB-PROJ-01–02](evidence/OBSERVATIONS.md)
- Assignment UI: sections, tasks, question headings, task/question flags, and response statuses. [E-ASG-TEMPLATE-01–03, E-CLB-ASG-01–02](evidence/OBSERVATIONS.md)
- Response UI: task completion, required-task, task-response, and image counters. Sample sums match displayed totals, but formulas and validation are unknown. [E-ASG-RESP-02–03](evidence/OBSERVATIONS.md)
- Document UI: category, version area, and visible Info/Capture access checkmarks. Their enforcement was not tested. [E-PROJ-S2-03, E-PROJ-S3-03](evidence/OBSERVATIONS.md)

No status transition, upload, answer submission, report generation, edit, delete, communication, or payment action was performed. [CALCULATIONS_AND_BUSINESS_RULES.md](CALCULATIONS_AND_BUSINESS_RULES.md) separates display arithmetic from backend rules.

## 4. Frontend artifact and static API evidence

After one ordinary reload of the same authorized Chrome tab, the DOM referenced `/assets/index-BfZVkNuh.js`. That public asset returned JavaScript without using browser credentials. It was 5,626,375 bytes; SHA-256 `201fb21c65f909c07ca959dabe6ef7cda25297b73ba5118f600b1e41d3f958e1`. The page also referenced `/runtime-config.js`, `/krpano/krpano.js`, Google Analytics/Tag Manager, and LinkedIn Insight scripts. A `div#root` was visible. These tags do not prove a specific frontend framework, script execution, or data transmission. [E-TECH-01, E-JS-01](evidence/OBSERVATIONS.md)

REA attempted `analyze_javascript_application` on the downloaded bundle. Retained parent Evidence ID: `ev_6430112e4adad7e455d0731e8b6d62bc26452ea2820bba86c47976eec6c3947d`. Its worker exhausted the default approximately 1 GiB heap while processing the 5.6 MB minified file: **zero JavaScript files parsed; no semantic route findings**. A separate bounded literal-text scan then selected code syntactically matching `Iy.get/post/put/delete(...)` with an immediate first argument containing `/api/v2/`. The resulting findings below are **static route candidates**, not REA-derived semantic conclusions and not live traffic. [E-JS-01](evidence/OBSERVATIONS.md)

| Candidate method/path in bundle | Static payload or purpose visible | Runtime status |
| --- | --- | --- |
| `POST /api/v2/organizations` | `organization` with `name`, `tenant_id`, `kind` | Not invoked or captured |
| `POST /api/v2/locations` | `organization_id`; `location` includes name/address/city/state/zip/year_built/latitude/longitude/heading | Not invoked or captured |
| `POST /api/v2/projects` | `location_id`; `project` includes name/description/start_date/completion_date/status/capture_scope | Not invoked or captured |
| `POST /api/v2/projects/create_bulk` | Bulk-project candidate | Not invoked or captured |
| `POST /api/v2/assignment_responses/{id}/task_responses` | A `data` member; shape unresolved | Not invoked or captured |
| `POST /api/v2/assignment_responses/{id}/import_workbook` | Multipart construction | Not invoked or captured |
| `POST /api/v2/locations/{id}/embeds` | Spatial embed candidate | Not invoked or captured |
| `POST /api/v2/locations/{id}/raster_overlays/create_through_image` | Raster creation candidate | Not invoked or captured |
| `PUT /api/v2/locations/{id}/embeds/{id}` | Embed update candidate | Not invoked or captured |
| `PUT /api/v2/panoramas/{id}` | Panorama update candidate | Not invoked or captured |
| `GET /api/v2/assignments/{id}/export_csv` | Export candidate | Not invoked or captured |
| `DELETE /api/v2/projects/{id}` | Deletion candidate | Not invoked or captured |

The scan also found literal families for users/admin, profile settings, HD photos, user photos, videos, programs, organization settings, location-copy jobs, CSV upload, query-tool actions, and assignment task responses. The [full bounded candidate inventory](evidence/STATIC_BUNDLE_API_CANDIDATES.md) records additional examples and the scan's limits. `/api/v3/projects` and `/api/v5/projects` strings were excluded from target API claims because nearby `projectKey`/notice/statistics code looked like a bundled third-party library. This is a cautious classification, not a complete dependency audit.

**Important:** No `POST`, `PUT`, or `DELETE` above was sent. The presence of code does not prove that the signed-in account can perform any such action. Static payload names do not prove server-required fields or database columns. The scan is incomplete, especially for list/read operations using computed paths or another client.

## 5. Digital twins and third-party boundaries

| Surface | What the browser displayed | Backend mechanism still unknown |
| --- | --- | --- |
| Matterport VR Showcase | A Phygii modal wrapped `my.matterport.com/show/`; floor-plan and 3D-space viewing worked. [E-DT-02](evidence/OBSERVATIONS.md) | Model creation/import, OAuth, SDK, webhooks, token handling, server sync |
| Potree point cloud | A Phygii modal loaded a Potree viewer from `ids-3dmodels-prod.s3.amazonaws.com`; viewer controls appeared. [E-DT-03](evidence/OBSERVATIONS.md) | Capture source, conversion job, file format, bucket policy, authorization |
| Autodesk Viewer | A `viewer.autodesk.com` tab displayed a Revit model and sheets. [E-DT-04](evidence/OBSERVATIONS.md) | Whether Autodesk Platform Services is used, translation/upload, account authorization |
| 360 media | Phygii overlay rendered a panorama with Info/navigation; thumbnails used an IDS-named S3 host. [E-MEDIA-01–02, E-STORAGE-01](evidence/OBSERVATIONS.md) | Panorama library, storage policy, ingestion, signed-link lifecycle |
| Raster/aerial layer | Location catalog and map opacity panel displayed an aerial layer. [E-RASTER-01, E-MAP-05](evidence/OBSERVATIONS.md) | Overlay source, georeferencing, tiling, DroneDeploy or other provider |

The `krpano.js` script reference is **not** proof that the inspected 360 overlay uses krpano. Google/LinkedIn script references are **not** proof of emitted analytics data. Mapbox/OpenStreetMap/Maxar attribution indicates visible map content, not the aerial-overlay supplier. [INTEGRATIONS.md](INTEGRATIONS.md) and [DIGITAL_TWIN_VIEWERS.md](DIGITAL_TWIN_VIEWERS.md) retain these boundaries.

## 6. What is not yet known about the backend

| Backend question | Current answer | Evidence required to answer it |
| --- | --- | --- |
| Which endpoints actually run when pages load or filters change? | Unknown; only static code candidates | Same-profile, authorized network metadata or vendor API documentation |
| What do responses contain? | Unknown | Redacted response field names/types from permitted capture or API specification |
| Which host resolves the candidate `/api/v2/` paths? | Unknown at runtime | Captured request origin/path without credentials or sensitive query values |
| How are organizations isolated and roles enforced? | Unknown | Vendor policy/source documentation or authorized, non-invasive role evidence; no ID probing |
| Which database, tables, keys, or queues exist? | Unknown | Vendor architecture/schema documentation; not inferable from UI IDs |
| How are media and spatial assets uploaded, converted, and linked? | Unknown | Authorized architecture docs or sanitized metadata from a read-only capture |
| How are Matterport/Autodesk/DroneDeploy integrated server-side? | Unknown; DroneDeploy not observed at all | Provider configuration/docs or sanitized integration call evidence |
| What formulas compute progress and statuses? | Unknown beyond displayed arithmetic | Product rules or safe test fixtures, not production edits |

## 7. Safe next evidence step

The practical next step is a **supported network inspector connected to this same authorized Chrome profile/tab**, or a vendor-provided API specification. Capture only a narrow read-only action such as opening a list/detail page. Retain timestamp, action, method, same-origin path with sensitive values removed, status, content type, and redacted JSON field **names/types** where permitted. Do **not** retain cookies, auth headers, bearer tokens, signed URLs, raw private payloads, personal contacts, operational access instructions, or response answer values. Do not replay requests or test other tenants' IDs. [API_OBSERVATIONS.md](API_OBSERVATIONS.md)

Until that capture is available, a backend implementation would be an **independent design**, not a reproduction of verified IDS internals. The [implementation plan](IMPLEMENTATION_PLAN.md) is separate and has **not** been executed.

## 8. Documentation index

The 19 requested audit filenames exist. For backend-focused reading, start with [API_OBSERVATIONS.md](API_OBSERVATIONS.md), [static API candidates](evidence/STATIC_BUNDLE_API_CANDIDATES.md), [DATA_RELATIONSHIPS.md](DATA_RELATIONSHIPS.md), [INTEGRATIONS.md](INTEGRATIONS.md), [DIGITAL_TWIN_VIEWERS.md](DIGITAL_TWIN_VIEWERS.md), [TECHNICAL_FINDINGS.md](TECHNICAL_FINDINGS.md), [CALCULATIONS_AND_BUSINESS_RULES.md](CALCULATIONS_AND_BUSINESS_RULES.md), [UNVERIFIED_FEATURES.md](UNVERIFIED_FEATURES.md), and [AUDIT_PROGRESS.md](AUDIT_PROGRESS.md). The full [observation ledger](evidence/OBSERVATIONS.md) gives source actions and limits for every local evidence ID. The other requested files remain available for UI reference; project-by-project completion is no longer the active priority.

## 9. Safety and provenance

All dashboard actions were read-only viewing/navigation. No production data was changed, no messages or payments were sent, and no other Chrome profile was used for target analysis. No password, cookie, authentication token, signed provider value, or complete private model URL was requested, extracted, or saved. The publicly retrievable JS asset was acquired without session credentials and analyzed inertly. Inline screenshots exist in the Codex task, but no durable sanitized screenshot files were exported. This report is an evidence-based partial audit, **not** a complete backend specification or claim of exhaustive platform coverage.
