# Phygii dashboard — observed features

Inspection date: 2026-10-20. Scope: the authenticated Phygii tab in the user's existing Chrome profile, using read-only UI navigation. This is an observation record for an independently developed application, not a specification of Phygii's internal code or permissions.

Environment check: the registered `rea-agents@6.7.0` MCP responded, its 207 tools were enumerated, and the REA reverse-engineering skill was accessible. The user's intended Chrome tab is now reachable through the Codex extension's Playwright-style UI automation, but not through REA's loopback-CDP browser tools. No Chrome profile data was copied. REA's binary-analysis capabilities were not needed for this browser-only inspection.

## Evidence convention

- **Verified**: visible in the authenticated UI or its address bar during this inspection.
- **Inferred**: a reasonable interpretation of visible controls, not exercised or confirmed by server behavior.
- **Unknown**: requires a separate, authorized test or direct access not available in this session.

Screenshots of the map, lists, galleries, tabs, forms, and profile settings were viewed during inspection but could not be saved as durable workspace image files through the existing Chrome connection. No screenshot of another Chrome profile is part of this report. Do not treat this document as a visual archive.

## Navigation and organization scope

| Feature | Verified observation |
| --- | --- |
| Global organizations | Search field and a paginated list of seven visible organizations: Client A, Client B, Client C, Client D, Client E, Client F, Client G. |
| Organization sections | For Client A (organization `ID05`), the left navigation exposes Map, Organizations, Locations, Projects, Collections. |
| Top bar | Phygii logo, Help control, two icon-only controls, and an account menu. The icon-only controls were not used; their behavior is unknown. |
| Account | Menu entries Profile and Logout. Profile has Details and Settings tabs. Fields appeared disabled and an Edit button was visible; its effect was not tested. Settings shows a password-change form and visible password-composition rules. No credential fields were used. |

Only Client A was inspected beyond the global organizations list. The other six organizations may have different data or capabilities.

## Locations and map

- **Verified:** The Client A location list has search and pagination and shows three locations: Client A brand 1 ID35 (Site 1, <state>), Client A brand 1 ID36 (Site 2, <state>), and Client A brand 2 ID37 (Site 3, <state>).
- **Verified:** Map view shows a satellite basemap with zoom controls, clustered markers, a location list, location search, and a Program Filter. Attributions visibly include Mapbox, OpenStreetMap, and Maxar. A live second session verified one location search match, a zero-match state, selection/clearing of the one visible program option, and Site 1 preview-to-Explore navigation; full filter and marker effects remain unknown.
- **Verified:** Site 1 map exploration shows `1 Project`, `305 Media`, `1 Layer`, `0 Filters` panels, media-type marker toggles, an Add Filters chooser, and an all-media gallery overlay. See [pages/organization-map.md](pages/organization-map.md) for exact observed options, counts, and unknowns.
- **Verified:** The Site 1 location detail has tabs: Media, Projects, Raster Overlays, Vector Overlays, Assignments, 3D Embed, Info, Collections, plus a Map View link.
- **Verified:** Media shows a photo gallery, thumbnail-size control, and filters labeled Flag, Media Type, Level, Area, Type, Category, and Tag; Tag appeared disabled. Sort By and Upload are visible. No upload or media edit was attempted.
- **Verified:** Projects at that location lists one published Full Capture project.
- **Verified:** Raster Overlays lists six items/categories: Aerial, Site Plan, Floor Plan, FFE Plan, RCP, Roof Plan. Vector Overlays showed zero items.
- **Verified:** Assignments has Active/Inactive/All filters but showed zero items for the location-level list.
- **Verified:** 3D Embed lists three entries: a 3D Model, a VR Showcase, and an Autodesk embed.
- **Verified in a later read-only spatial pass:** Site 1's VR Showcase opens a Matterport `/show/` iframe; the 3D Model opens an IDS-S3-hosted Potree point-cloud viewer; Revit Model opens Autodesk Viewer in a new tab. The Media Type filter isolates 360 Images and opens a Phygii panorama overlay. The raster catalog lists an Aerial default and plan overlays. These are viewer/storage-origin observations only. [E-DT-01–04, E-MEDIA-01–02, E-RASTER-01](evidence/OBSERVATIONS.md)
- **Unknown:** How Phygii's backend creates or updates those references; whether Matterport SDK/OAuth, Autodesk Platform Services, or DroneDeploy is used. See [integration catalog](INTEGRATION_CATALOG.md).
- **Verified:** Info shows latitude, longitude, and heading. Collections showed zero items with search, privacy, creator, and sort controls.
- **Verified at the other two locations:** Site 2 has six raster overlays and Site 3 seven; both have zero vector overlays, zero location-level assignments, and empty Collections tabs. Both list three 3D embeds by type (`3D Model`, `VR Showcase`, `Autodesk`) and show latitude/longitude/heading fields. The zero location-level assignment lists coexist with one assignment on each project's Assignments tab; do not equate these scopes. [E-LOC-S2-01, E-LOC-S3-01](evidence/OBSERVATIONS.md)
- **Unknown:** Map marker selection, layer rendering beyond the visible aerial layer, overlay downloads, media metadata edits, and upload workflows were not exercised.

## Projects and documents

- **Verified:** Client A Projects has All, New, In Progress, Published, and Completed status tabs, search, and pagination. Three Full Capture projects were listed: two Completed and one Published.
- **Verified:** The inspected Published project (`ID29`, “2026 Essential Solution”) shows a date range, linked location, linked program, status, and tabs Media, Users, Documents, Assignments, Collections.
- **Verified for Site 1 only:** Users showed zero users with search and status filter. This is not an organization-wide count.
- **Verified:** Documents showed four named entries: Site Survey, DWG 2D Plans, PDF 2D Plans, Revit Model. Rows display categories, timestamps, and Info Tab Access/Capture Access checkbox states. The controls were not changed.
- **Verified:** Opening the Site Survey document card expanded metadata (name, author, category, tags). Its Document versions section listed three dated PDF versions.
- **Verified:** Assignments showed one active assignment linked to the project. The Site 1 project Collections tab displayed `0–0 of 0`, “No collections”, and search/privacy/creator/sort controls. [E-PROJ-S1-01](evidence/OBSERVATIONS.md)
- **Verified for Site 2 and Site 3:** Both completed projects have the same five tabs and link to Assignment `403`. Site 2 Users showed `1–25 of 138`; Site 3 Users showed `1–25 of 198`. Their Inactive filter showed four each; All was restored. No names or email addresses were retained. Both Collections tabs showed `0–0 of 0` with search/privacy/creator/sort controls. [E-PROJ-S2-01–04, E-PROJ-S3-01–04](evidence/OBSERVATIONS.md)
- **Verified for Site 2 and Site 3:** Each Documents tab showed Site Survey, DWG 2D Plans, PDF 2D Plans, Revit Model. All four Site 2 cards displayed checked Info Tab Access and Capture Access; all four expanded to “No document versions.” Site 3's first three displayed both checks; Site Survey displayed Info Tab Access checked and Capture Access unchecked. All four Site 3 cards expanded to “No document versions.” The visible checkboxes were not changed. [E-PROJ-S2-03, E-PROJ-S3-03](evidence/OBSERVATIONS.md)
- **Verified:** Attempting the visible Program link resulted in “You do not have access to that page.” No bypass was attempted.
- **Unknown:** Whether visible Upload Document, access toggles, or other document controls are available to this account in edit mode.

## Assignments and responses

- **Verified:** Assignment `403` (“2025 Essential Solution”) is Active and has Assignment, Responses, Settings tabs.
- **Verified:** Assignment tree has four sections: Check-In, MEP Assets & Utilities, Deficiencies, Check Out. Expanding Check-In revealed a task and nested question, with visible flags such as Required, Repeatable, Completable, Skip Metadata Capture, Skip Marker Placement, and answer Type.
- **Verified in a full read-only tree pass:** The four sections contain 27 task headings and 54 question headings. The visible question types were `photo_simple` (38), `text` (15), and `number` (1); 49 questions displayed Required Yes. All 27 task summaries displayed Required/Repeatable/Completable Yes. These are template settings, not tested validation behavior. [E-ASG-TEMPLATE-01–03](evidence/OBSERVATIONS.md), [task inventory](pages/assignment-task-inventory.md)
- **Verified:** The project-scoped Assignment `403` Responses tab showed three project-specific responses: Site 1 `ID24` In Progress with 30 task responses, Site 2 `ID23` Released with 23, and Site 3 `ID22` Released with 42. This supersedes the earlier one-response observation. [E-ASG-RESP-01](evidence/OBSERVATIONS.md)
- **Verified:** Assignment Settings displays read-only controls for Completable, Enable Task Duplication, Repeatable, Task Metadata Location, Load Responses, Active Status, and Version. Edit was disabled in the observed state.
- **Verified:** Response detail displays task and image progress counters: 23 complete of 27 required/total tasks; 25 complete, 5 incomplete, 30 total task responses; 196 uploaded and 196 captured images. It has Task Responses and Info tabs.
- **Verified:** Task Responses contains status, pending-image, and orphaned-answer filters and a section/task outline. Add new response, Edit response, Delete response, Load All, and Generate Report controls were visible but not used. Info displays created/updated/status fields with disabled Edit.
- **Verified:** Site 2 response `ID23` showed 24 of 27 required tasks complete; 21 complete and 2 incomplete task responses (23 total); 204 images uploaded and 204 captured. Site 3 response `ID22` showed 25 of 27 required tasks complete; 42 complete and 0 incomplete task responses; 141 uploaded and 141 captured images. Both were Released. These counts are UI observations, not validated formulas. [E-ASG-RESP-02–03](evidence/OBSERVATIONS.md)
- **Verified navigation exception:** The Site 2 response's “Responses” breadcrumb led to `/organization/ID05/assignments/403?tab=responses` and a not-found page during this pass. The project-scoped assignment Responses tab was accessible. Whether this is a persistent routing bug is unknown. [E-NAV-01](evidence/OBSERVATIONS.md)
- **Unknown:** Actual report output, answer validation, task mutation rules, image ingestion, and save/submit behavior.

## Technology observations

- **Verified:** The UI changes browser paths and `?tab=` query parameters during navigation. That alone does not prove a particular frontend framework.
- **Verified:** Map attribution identifies Mapbox/OpenStreetMap/Maxar as map data or rendering dependencies; exact SDK and licensing are not proven.
- **Verified:** Chrome DevTools previously showed a service-worker registration and a hashed JavaScript asset. Live DOM classes include `MuiListItemButton` and other `Mui...` names, evidence consistent with Material UI components; exact package/version, frontend framework, bundler, and backend stack are **unverified**.

## Safety and coverage limits

No production data was changed; no messages, payments, uploads, report generation, or destructive controls were activated. Personal contact details, answer text, credentials, tokens, and cookies were intentionally omitted from these notes. A previous native-DevTools attempt became unreliable across Chrome profiles, so no network payloads were collected; current work uses only the intended Chrome tab through its extension. The pages listed here are those reached from the visible navigation for one organization, not a guarantee that every authorized Phygii page has been discovered.
