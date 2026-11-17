# Master feature inventory — working register

Status: incomplete, authenticated Chrome extension connected. Source class `H` means historical authenticated UI notes; `L` means current live UI observation. Neither is a REA Evidence ID or saved screenshot. Feature IDs below are local documentation identifiers, not production IDs.

| Feature ID | Page/module | Feature | Exact visible label | Current evidence | Detail |
| --- | --- | --- | --- | --- | --- |
| ORG-001 | Global shell | Logo/navigation | Phygii logo | H; destination link observed | [features/organizations.md](features/organizations.md) |
| ORG-002 | Global shell | Help | Help | L; clicked, no distinct in-tab result verified [E-HELP-01](evidence/OBSERVATIONS.md) | Same |
| ORG-003 | Global shell | Icon-only control A | No accessible label; visual upload-cloud icon | H; not used | Same |
| ORG-004 | Global shell | Icon-only control B | No accessible label; visual download icon | H; not used | Same |
| ORG-005 | Global shell | Account menu | <user initials> | L; Profile/Logout menu opened, dismissed without selection | Same |
| ORG-006 | Organizations | Search | Search organizations | L; partial/case/empty/whitespace tested | Same |
| ORG-007 | Organizations | Organization row | Client A (representative) | L; mouse and keyboard Enter navigation verified | Same |
| ORG-008 | Organizations | Pagination | Go to previous/next page | L; disabled at seven of seven | Same |
| ORG-009 | Organization shell | Sidebar navigation | Map, Organizations, Locations, Projects, Collections | L; collapse/expand and 600px layout tested | Same |
| ORG-010 | Organizations | Search clear control | No accessible name; visual × | Live click verified | [features/organizations.md](features/organizations.md) |
| LOC-001 | Locations | Directory and search | Search locations | L; match/no-match and load-error/reload observed | [pages/locations.md](pages/locations.md) |
| LOC-002 | Map | Location map/list | Search Locations, Program Filter | L; search, program selection, preview/Explore verified | [pages/organization-map.md](pages/organization-map.md) |
| MAP-001 | Location map | Media marker-type toggles | HD Images and 10 other types | L; one checkbox toggled/restored | [pages/organization-map.md](pages/organization-map.md) |
| MAP-002 | Location map | Project/layer/filter panels | 1 Project, 1 Layer, 0 Filters | L; opened, no data-changing actions | Same |
| MAP-003 | Location map | Filter chooser | Level, Area, Type, Category, Tag, Custom Metadata, Timeline | L; options observed, none applied | Same |
| MAP-004 | Location map | All-media gallery | View all media | L; opened/closed overlay | Same |
| LOC-003 | Location detail | Media gallery and filters | Flag, Media Type, Level, Area, Type, Category, Tag, Sort By | H; viewed | Same |
| LOC-004 | Location detail | Overlay tabs | Raster Overlays, Vector Overlays | L; Site 2 6/Site 3 7 raster rows, both vector empty [E-LOC-S2-01, E-LOC-S3-01](evidence/OBSERVATIONS.md) | Same |
| LOC-005 | Location detail | 3D embeds | 3D Embed | L; three entries at each inspected location; only Site 1 View actions tested | Same |
| PROJ-001 | Projects | Directory/status tabs | All, New, In Progress, Published, Completed | L; counts and empty states verified | [pages/projects.md](pages/projects.md) |
| PROJ-002 | Project detail | Document cards and versions | Documents, Document versions | H; expanded | Same |
| PROJ-003 | Project detail | Document access controls | Info Tab Access, Capture Access | H; states observed, not changed | Same |
| ASG-001 | Assignment | Section/task/question tree | Assignment | L; 4 sections, 27 tasks, 54 question headings [E-ASG-TEMPLATE-01](evidence/OBSERVATIONS.md) | [Task inventory](pages/assignment-task-inventory.md) |
| ASG-002 | Assignment | Settings flags | Settings | H; read-only | Same |
| ASG-003 | Assignment | Question configuration | Type, Required, Repeatable, Is Label | L; all 54 inspected [E-ASG-TEMPLATE-02](evidence/OBSERVATIONS.md) | [Task inventory](pages/assignment-task-inventory.md) |
| PROJ-004 | Project detail | Users/status filter | Users, All, Active, Inactive | L; Site 2/Site 3 counts and filter first pass [E-PROJ-S2-02, E-PROJ-S3-02](evidence/OBSERVATIONS.md) | Personal values omitted |
| PROJ-005 | Project detail | Per-project documents/collections | Documents, Collections | L; access/version/empty states [E-PROJ-S2-03–04, E-PROJ-S3-03–04](evidence/OBSERVATIONS.md) | Mutations untested |
| RESP-001 | Response | Completion/image metrics | Tasks, Task Responses, Images | L; three project-specific count sets [E-ASG-RESP-01–03](evidence/OBSERVATIONS.md) | [Response dossier](pages/assignment-responses.md) |
| RESP-002 | Response | Response actions | Add new response, Edit response, Delete response, Generate Report | H; not used | Same |
| COLL-001 | Collections | Directory/empty state | No collections | H; viewed | Same |
| PROF-001 | Profile | Details/Settings | Details, Settings, Edit | H; viewed read-only | Same |
| DT-001 | Site 1 3D Embed | Three spatial entries | 3D Model, 3DVR Tour, Revit Model | L; names/type/level/time and View menus verified [E-DT-01](evidence/OBSERVATIONS.md) | [DIGITAL_TWIN_SPECIFICATION.md](DIGITAL_TWIN_SPECIFICATION.md) |
| DT-002 | VR Showcase | Matterport embed | IDS External Tool; Matterport | L; iframe host `/show/`, floor plan/3D/measurement UI [E-DT-02](evidence/OBSERVATIONS.md) | [INTEGRATION_CATALOG.md](INTEGRATION_CATALOG.md) |
| DT-003 | 3D Model | Point-cloud viewer | Potree Viewer | L; iframe host and tool groups [E-DT-03](evidence/OBSERVATIONS.md) | Same |
| DT-004 | Revit Model | External BIM viewer | Autodesk Viewer | L; external tab/views/tools [E-DT-04](evidence/OBSERVATIONS.md) | Same |
| DT-005 | Site 1 Media | 360 panorama | 360 Images | L; filter, gallery, overlay, info [E-MEDIA-01, E-MEDIA-02](evidence/OBSERVATIONS.md) | [DIGITAL_TWIN_SPECIFICATION.md](DIGITAL_TWIN_SPECIFICATION.md) |
| DT-006 | Site 1 Media | Image asset origin | IDS-named S3 image host | L; hostname-only DOM observation [E-STORAGE-01](evidence/OBSERVATIONS.md) | [INTEGRATION_CATALOG.md](INTEGRATION_CATALOG.md) |
| GEO-001 | Site 1 Raster Overlays | Aerial and plan catalog | Aerial 2-10-2026, Site Plan, Floor Plan, FFE Plan, RCP, Roof Plan | L; list verified [E-RASTER-01](evidence/OBSERVATIONS.md) | Provider, including DroneDeploy, unknown |
| GEO-002 | Site 1 map | Aerial layer and opacity | 1 Layer; Aerial 2-10-2026; Opacity | L; panel/slider observed, unchanged [E-MAP-05](evidence/OBSERVATIONS.md) | Upstream imagery provider and tile path unknown |
| ASSET-001 | Site 1 map | Asset marker category | Assets (0) | L; toggle/count observed [E-MAP-05](evidence/OBSERVATIONS.md) | No asset registry/detail verified |

ORG-005 through ORG-010 have individual 35-field first-pass records in `features/organizations.md`; ORG-001 through ORG-004 and all later modules still need them. Every module needs a second-pass audit. Missing features and untested states are **unknown**, not absent.

`L` entries DT-001–DT-006 and GEO-001 are live observations, but their backend contracts, full edge states, and role behavior remain **Not Verified**. No provider should be inferred from a generic aerial image or from the native 360 gallery.

## Expanded mission category matrix

This matrix tracks the 18 requested investigation categories. `Partially Verified` is deliberately conservative: it means a related authenticated UI was observed, **not** that the whole module has been inventoried. Public IDS claims are logged separately in [PUBLIC_SOURCES.md](evidence/PUBLIC_SOURCES.md).

| Category | Authenticated dashboard status | Public-only / next verification |
| --- | --- | --- |
| Organization / enterprise management | Partially Verified: organization directory, scoped sidebar [DASHBOARD_FEATURES.md](DASHBOARD_FEATURES.md) | Admin/membership management not verified. |
| Property portfolio | Partially Verified: location directory and organization map [PAGE_MAP.md](PAGE_MAP.md) | Cross-portfolio comparisons not verified. |
| Property / building / floor / area | Partially Verified: location detail, Level/Area labels [E-MEDIA-02, E-RASTER-01](evidence/OBSERVATIONS.md) | Building entity is public claim [P-IDS-01](evidence/PUBLIC_SOURCES.md), not observed UI. |
| Digital twin / 360 | Partially Verified: native 360, Matterport, Potree, Autodesk [E-DT-02–04, E-MEDIA-02](evidence/OBSERVATIONS.md) | Hotspots, linking, persistence, other locations pending. |
| Asset identification / tracking | Partially Verified only for `Assets (0)` map type [E-MAP-05](evidence/OBSERVATIONS.md) | Asset fields/geotagging are public claims [P-IDS-03](evidence/PUBLIC_SOURCES.md); no record page found. |
| Inspection / condition assessment | Partially Verified: assignment/response UI [DASHBOARD_FEATURES.md](DASHBOARD_FEATURES.md) | Answer, validation, deficiency and condition workflow rules unknown. |
| Facilities / maintenance | Not Verified as a dashboard module | Public use cases [P-IDS-03–04](evidence/PUBLIC_SOURCES.md); no work-order UI confirmed. |
| Project / construction planning | Partially Verified: project list/detail, documents, assignment [PAGE_MAP.md](PAGE_MAP.md) | Scheduling/budgeting/construction execution unknown. |
| Documentation / file management | Partially Verified: documents and versions [DASHBOARD_FEATURES.md](DASHBOARD_FEATURES.md) | Upload/download/version mutations untested. |
| Survey / measurement / reality capture | Partially Verified: viewer measurement controls, survey-like assignment [E-DT-02–04](evidence/OBSERVATIONS.md) | Capture workflow and saved measurements unknown; public inputs [P-IDS-01](evidence/PUBLIC_SOURCES.md). |
| Brand compliance | Not Verified in this dashboard account | Public ML/brand use case [P-IDS-02, P-IDS-04](evidence/PUBLIC_SOURCES.md). |
| Reporting / analytics | Partially Verified: counts, Generate Report button (unused) [ANALYTICS_AND_REPORTING.md](ANALYTICS_AND_REPORTING.md) | Portfolio reporting is public offering [P-IDS-04](evidence/PUBLIC_SOURCES.md); output unverified. |
| Artificial intelligence | Not Verified in authenticated UI | Public technical article describes selective ML and query orchestration [P-IDS-02](evidence/PUBLIC_SOURCES.md). |
| Mapping / aerial / geospatial | Partially Verified: map, aerial layer and raster catalog [E-RASTER-01, E-MAP-05](evidence/OBSERVATIONS.md) | DroneDeploy and overlay pipeline unknown. |
| User management / permissions | Partially Verified: visible Program access denial and disabled control [ROLES_AND_PERMISSIONS.md](ROLES_AND_PERMISSIONS.md) | Public SSO/RBAC claim [P-IDS-02](evidence/PUBLIC_SOURCES.md); exact grants unknown. |
| Import / export / integration | Partially Verified for viewer connections only [INTEGRATION_CATALOG.md](INTEGRATION_CATALOG.md) | Data import/export and CMMS/ERP sync not verified; public article says integrations expanding. |
| Administration / configuration | Partially Verified: account Profile/Settings [DASHBOARD_FEATURES.md](DASHBOARD_FEATURES.md) | Tenant admin/configuration pages unknown. |
| Notifications / alerts / audit history | Not Verified | Top-bar icon-only controls not characterized; no audit page found. |

Do not mark a category fully Verified until every accessible route, relevant state, action, and second-pass check is documented. A public statement never upgrades dashboard status.
