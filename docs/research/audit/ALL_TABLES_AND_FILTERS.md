# List and filter matrix — working register

**Incomplete.** Existing detailed first-pass registers: [list fields](ALL_TABLES_AND_COLUMNS.md) and [filter effects](ALL_FILTERS_AND_SEARCH.md). Lists often use cards/rows rather than HTML tables; labels below are not database columns.

| Surface | Displayed row attributes | Filter/search controls actually observed | Coverage |
| --- | --- | --- | --- |
| Organizations | Name, range/total | Name search; clear | Multiple queries and empty state verified, paging beyond one page unknown. |
| Locations | Name, address, range/total | Search locations | Match/no-match observed; multi-page unknown. |
| Projects | Title, location, program-like text, status, capture type | Search; All/New/In Progress/Published/Completed tabs | Status subsets observed; search intersection unknown. |
| Site 1 Media | Image thumbnails, category groups, Info metadata after opening | Flag, Media Type, Level, Area, Type, Category, Tag (disabled), Sort By, size | `All` vs `360 Images` selection verified [E-MEDIA-01–02](evidence/OBSERVATIONS.md); combinations unknown. |
| Site 1 Raster Overlays | Name, file-like label, Default badge, Level, date/time | Search raster overlays | Six visible rows [E-RASTER-01](evidence/OBSERVATIONS.md); search behavior unknown. |
| Site 1 3D Embed | Name, type, Level, timestamp | Per-row View/Edit/Delete menu | Three visible rows and View verified [E-DT-01–04](evidence/OBSERVATIONS.md); mutation behavior unknown. |
| Response task list | Section/task labels and status counts | Status/pending-image/orphaned-answer filters | Labels observed historically; predicate rules unknown. |
| Collections | Empty state | Search, Privacy, Creator, Sort | Nonempty rows unknown. |

Every remaining option set, combination, sorting direction, pagination boundary, and empty/error state needs a second-pass audit before this becomes an exhaustive contract.
