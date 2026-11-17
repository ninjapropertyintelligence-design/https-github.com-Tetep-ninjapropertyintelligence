# Phygii page map

Observed 2026-10-20 in the authenticated Phygii tab. Paths below are UI routes, **not API endpoints**. `:id` denotes an observed route parameter pattern, not a claim that all such IDs are accessible. Tabs were observed through visible navigation; an unvisited tab is labeled accordingly.

| Route / route family | Page or section | Verified contents / links | Coverage |
| --- | --- | --- | --- |
| `/organizations` | Organization directory | Search; seven organization rows; pagination | Inspected |
| `/organization/ID05` | Organization overview | Shell/sidebar rendered but main content remained blank | Inspected; no usable overview content |
| `/organization/ID05/explore/map` | Organization map | Satellite map, markers/clusters, location list, search, Program Filter | Inspected |
| `/organization/ID05/explore/map/ID26` | Location map exploration | Media/project/layer/filter drawer; map preview and gallery | Opened and partially inspected |
| `/organization/ID05/locations` | Location directory | Search and three location rows | Inspected |
| `/organization/ID05/locations/ID26` | Site 1 location | Media, Projects, Raster Overlays, Vector Overlays, Assignments, 3D Embed, Info, Collections | All tab labels seen; 360 Media, Raster Overlays and three 3D View actions first-pass inspected [evidence](evidence/OBSERVATIONS.md) |
| `/organization/ID05/locations/ID25` | Site 2 location | Eight tabs; six raster rows, zero vector/assignment/collection rows, three 3D embeds, Info coordinates/heading | Read-only first-pass tab survey [E-LOC-S2-01](evidence/OBSERVATIONS.md) |
| `/organization/ID05/locations/ID27` | Site 3 location | Eight tabs; seven raster rows, zero vector/assignment/collection rows, three 3D embeds, Info coordinates/heading | Read-only first-pass tab survey [E-LOC-S3-01](evidence/OBSERVATIONS.md) |
| `/organization/ID05/projects` | Project directory | Status tabs, search, three project rows | Inspected |
| `/organization/ID05/projects/ID29` | Published Site 1 project | Media, Users, Documents, Assignments, Collections | All five tabs read-only first pass |
| `/organization/ID05/projects/ID28` | Completed Site 2 project | Media, Users, Documents, Assignments, Collections; 138 users in All and 4 in Inactive; four document cards without versions | All five tabs read-only first pass |
| `/organization/ID05/projects/ID30` | Completed Site 3 project | Same five tabs; 198 users in All and 4 in Inactive; four document cards without versions | All five tabs read-only first pass |
| `/organization/ID05/projects/ID29/assignments/403` | Assignment | Assignment tree, Responses, Settings | Inspected |
| `/organization/ID05/projects/ID30/assignments/403` | Same assignment via Site 3 project | Responses tab listed one response for each of Site 1, Site 2, Site 3 | Inspected |
| `/organization/ID05/projects/ID29/assignments/403/responses/ID24` | Response workspace | Task Responses, Info, progress counters | Inspected |
| `/organization/ID05/assignments/403/responses/ID23` | Site 2 response | Released; Task Responses and Info; progress counters | Inspected read-only |
| `/organization/ID05/assignments/403/responses/ID22` | Site 3 response | Released; Task Responses and Info; progress counters | Inspected read-only |
| `/organization/ID05/assignments/403?tab=responses` | Global response-list breadcrumb destination | Rendered “Sorry, that page wasn't found” during this pass | Observed failure once; project-scoped list works |
| `/organization/ID05/collections` | Collections directory | Search, privacy/creator/sort, empty state | Inspected |
| `/organization/ID05/programs/ID06` | Linked program | Access-denied modal | Attempted via link; no contents accessed |
| `/profile` | Account profile | Details and Settings tabs | Inspected read-only |
| `/profile?tab=settings` | Account settings | Password-change fields and composition guidance | Inspected read-only |

## Observed hierarchy

```text
Organizations
└── Client A (ID05)
    ├── Map
    ├── Locations (3)
    │   └── Client A brand 1 350711, Site 1 (ID26)
    │       ├── Media / Projects / Raster Overlays / Vector Overlays
    │       └── Assignments / 3D Embed / Info / Collections
    ├── Projects (3): Site 1 ID29 / Site 2 ID28 / Site 3 ID30
    │   ├── Each has Media / Users / Documents / Assignments / Collections
    │   └── All link to Assignment 403
    │       └── Responses: Site 1 ID24 / Site 2 ID23 / Site 3 ID22
    └── Collections (0 observed)
```

The global Phygii logo links to `/tenants`, but that route was not opened and its purpose is unknown. Client B was opened only to verify keyboard row navigation; other organizations were listed but not investigated. The routes above should guide future authorized checks, not be used to probe IDs or permissions.
