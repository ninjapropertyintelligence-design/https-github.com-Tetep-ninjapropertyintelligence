# Buttons and actions register — partial

`Observed` means the named state/action was seen; `not invoked` is deliberate for risky or production-mutating controls. This is not a complete application-wide census.

| Screen | Control | Tested state/outcome | Client B |
| --- | --- | --- | --- |
| Global header | Help; two badge/icon buttons; account `<user initials>` | Account menu opened and dismissed | Help/badge effects not tested; icon buttons lacked useful accessible names. |
| Sidebar | Toggle and section links | Expand/collapse and selected navigation verified | Focus/tooltip behavior incomplete. |
| Organizations | Search clear ×; organization rows; previous/next | Clear and two row navigation paths verified; paging disabled | Multi-page behavior unknown. |
| Map list | Program Filter open/clear; location row; Explore | Option selected/cleared; preview then Explore route verified | Marker click and other location previews unknown. |
| Location map | `1 Project`, `305 Media`, `1 Layer`, `0 Filters` | Panels opened | Project/layer/filter application not tested. |
| Location map | Media-type checkboxes; `View all media` | HD Images unchecked/rechecked; gallery opened/closed | Media item/detail effects unknown. |
| Location map | Add/Clear Layers; Add/Clear Filters | Add Filters chooser opened only | Clear/apply effects not tested. |
| Location detail | Upload | Visible, **not invoked** | Permission, format, limits, outcomes unknown. |
| Projects | Status tabs and rows | All/New/In Progress/Published/Completed subsets observed | Project writes not tested. |
| Site 2/Site 3 project Users | All/Inactive/All filter sequence | Counts changed to four Inactive each, then returned to full totals | User editing/invitation/pagination untested. |
| Site 2/Site 3 Documents | Expand four document cards each | All eight cards displayed no versions; access check states read | Upload Document and access toggles not invoked. |
| Site 2/Site 3 project Collections | Tab and empty-state controls | `0–0 of 0`, search/privacy/creator/sort visible | Nonempty collection behavior unknown. |
| Response breadcrumb | “Responses” from Site 2 released detail | Global route returned a not-found page once | Root cause and persistence unknown. |
| Assignment/response | Add/Edit/Delete/Generate Report | Historical visibility only, **not invoked** | Mutations/report output unknown. |
| Account | Logout | Menu item visible, **not invoked** | Sign-out outcome unknown. |
| Site 1 3D Embed | Per-row menu: View/Edit/Delete | Menu opened; only View invoked for three rows | Edit/Delete never invoked; permissions/confirmation unknown. [E-DT-01–04](evidence/OBSERVATIONS.md) |
| Matterport showcase | Floor Plan, Explore 3D Space, Measurements | Mode changes observed; Measurements overlay opened then closed | Add measurement, Share, Menu, Dollhouse outcomes untested. [E-DT-02](evidence/OBSERVATIONS.md) |
| Potree point cloud | Appearance, measurement, clipping, navigation tools | Controls visible only | Actual measurement result/persistence untested. [E-DT-03](evidence/OBSERVATIONS.md) |
| Autodesk Viewer | Views, model tools, measure/section/screenshot/share | Controls visible; new tab closed after inspection | Tool result and provider permissions untested. [E-DT-04](evidence/OBSERVATIONS.md) |
| 360 Media | Media Type All/360 Images; double-click thumbnail; Info | Filtered gallery and panorama viewer opened, then filter restored | Other media types and comment creation untested. [E-MEDIA-01–02](evidence/OBSERVATIONS.md) |

See [MASTER_FEATURE_INVENTORY.md](MASTER_FEATURE_INVENTORY.md) for IDs and [UNVERIFIED_AND_MISSING_FEATURES.md](UNVERIFIED_AND_MISSING_FEATURES.md) for gaps.
