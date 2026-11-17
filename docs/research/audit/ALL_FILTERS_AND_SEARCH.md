# Filters and search — partial behavior matrix

| Screen | Control | Verified effect | Unknowns |
| --- | --- | --- | --- |
| Organizations | Text search | Case-insensitive substring for tested names; surrounding space not trimmed in one test; no-match/clear/count observed | Full algorithm, backend/client execution, limits. |
| Organization map | Location text search | `Park` → one location; absent term → zero and explicit message | Case/space behavior, map-marker effect. |
| Organization map | Program Filter | One option rendered as chip; clear removed it; three rows remained | Membership/combination semantics. |
| Location map | Media-type toggles | HD Images checkbox state changed and restored | Whether/map-marker rendering and zero-count types behave as expected. |
| Location map | Add Filters | Level/Area/Type/Category/Tag/Custom Metadata/Timeline choices visible | Applied-filter count and predicate semantics. |
| Location media/gallery | Flag, media type, level, area, type, category, tag, sort, thumbnail size | Controls visible, Tag disabled in observed gallery | Most options and query effects. |
| Locations | Text search | `Site 2` → one row; absent term → zero/alert | Case, whitespace, URL/API. |
| Projects | Status tabs | All 3, Published 1, Completed 2, New/In Progress 0 | Search intersection and status transitions. |
| Site 2/Site 3 project Users | All/Active/Inactive | All totals 138/198; Inactive yielded four in each project; All restored | Active count and server/client filtering not checked. |
| Project Assignments | Active/Inactive/All | Site 2: 1/0/1, with the same assignment `403` linked from Site 3 | Cross-project cardinality and filter query behavior. |
| Assignment Responses | All filter and search | Controls visible above three-response list | Query effects and pagination not tested. |
| Response Task Responses | Task Response Status, Pending Images, Orphaned Answers | Options observed: All/Complete/Incomplete; All/Pending images; All/Orphaned answers. Default All preserved. [E-ASG-RESP-04](evidence/OBSERVATIONS.md) | Nondefault results, combination semantics, and backend/client execution untested. |
| Collections | Privacy, Creator, Sort by | Controls visible in empty state | Nonempty behavior. |
| Site 1 Media | Media Type multi-select | `All` toggled off all types; selecting `360 Images` showed only that group; `All` restored the initial selected set [E-MEDIA-01](evidence/OBSERVATIONS.md) | Filter intersection with Level/Area/Type/Category; persistence across navigation. |
| Site 1 3D Embed | `Search 3d embed` | `Revit` narrowed three rows to Revit Model (`1–1 of 1`); clear × restored three [E-DT-05](evidence/OBSERVATIONS.md) | Case/substring behavior, server/client execution, no-match messaging. |

Source details: [organizations feature records](features/organizations.md), [map](pages/organization-map.md), [locations](pages/locations.md), [projects](pages/projects.md).
