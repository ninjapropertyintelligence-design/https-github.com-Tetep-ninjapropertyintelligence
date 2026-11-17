# Lists, tables, and displayed fields — partial

Most observed list views use cards/rows rather than semantic HTML tables. The labels below are visible display fields, not database columns or API field names.

| List | Observed row fields | Range/status | Unverified |
| --- | --- | --- | --- |
| Organizations | Name | Seven rows; `1–7 of 7` | Hidden fields, sort, multi-page. |
| Locations | Name and address | Three rows; `1–3 of 3` | Sort and enabled pagination. |
| Projects | Title, location, repeated program/title text, status, `Full Capture` | Three rows; status subsets 1/2/0 | Exact duplicate-text meaning, sort, pagination. |
| Location Projects | Title, repeated program/title, status, capture type | One row at Site 2/Site 3 | Other locations and search behavior. |
| Raster Overlays | Name, file-like label, default indicator, level, date/time | Site 1 6; Site 2 6; Site 3 7 [E-RASTER-01, E-LOC-S2-01, E-LOC-S3-01](evidence/OBSERVATIONS.md) | File contents and provider/ingestion source. |
| 3D Embed | Name, embed type, level, timestamp | Three at each inspected location; only Site 1 View actions opened [E-DT-01–04](evidence/OBSERVATIONS.md) | Other-location viewer origins, Edit/Delete behavior and backend integration. |
| Project Users | Avatar/initials, name, email, Active/Inactive | Site 2 138 All / 4 Inactive; Site 3 198 All / 4 Inactive; Site 1 0 in earlier view | Contact values intentionally omitted; full paging/filter semantics. |
| Documents | Title/category/date/access flags; versions | Four cards per inspected project; Site 1 Site Survey had three versions; Site 2/Site 3 cards showed no versions | Full metadata/schema and edit rights. |
| Assignment Responses | Project link, task-response count, created/updated, status | Three cards on project-scoped Assignment 403 list | Full columns, formulas, paging, cross-project ownership. |
| Collections | Search/privacy/creator/sort above empty state | Zero observed in Client A | Nonempty row structure. |

Do not use these display fields as a discovered private schema. Sources: [Locations](pages/locations.md), [Projects](pages/projects.md), [assignment responses](pages/assignment-responses.md), [DASHBOARD_FEATURES.md](DASHBOARD_FEATURES.md).
