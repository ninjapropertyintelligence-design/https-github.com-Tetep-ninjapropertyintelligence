# QA and acceptance tests — independent product

These are **future tests**, not tests executed against production Phygii. Existing seeds for directories/map/project states are in [QA_TEST_CASES.md](QA_TEST_CASES.md). Use synthetic, authorized fixtures.

| ID | Scenario | Independent-app acceptance condition | Evidence or decision |
| --- | --- | --- | --- |
| QA-DT-01 | 360 media filter | Selecting 360-only shows that group; All restores the original set; no stale thumbnail selection. | Target UI behavior [E-MEDIA-01](evidence/OBSERVATIONS.md); exact new UX can improve accessibility. |
| QA-DT-02 | 360 viewer | Open selected panorama; show capture/level/area/category; keyboard-accessible close and next/previous; failure state. | Target display [E-MEDIA-02](evidence/OBSERVATIONS.md); keyboard/error requirements proposed. |
| QA-DT-03 | Matterport | Authorized tour loads in isolated embed; unavailable/private model gives bounded error; no provider credential appears in browser logs. | Target embed [E-DT-02](evidence/OBSERVATIONS.md); security/error policy proposed. |
| QA-DT-04 | Point cloud | Authorized Potree bundle loads; loading/progress/unsupported-device states; no cross-tenant asset access. | Target viewer [E-DT-03](evidence/OBSERVATIONS.md); authorization policy proposed. |
| QA-DT-05 | Autodesk | Authorized external/custom viewer opens requested model/sheet or fails safely; link expiry and licensing handled. | Target viewer [E-DT-04](evidence/OBSERVATIONS.md); integration choice proposed. |
| QA-DT-06 | Raster provenance | Aerial/plan layer records show source, timestamp, level, and permission-safe display; missing tiles do not break map. | Target catalog [E-RASTER-01](evidence/OBSERVATIONS.md); provenance requirement proposed. |
| QA-SEC-02 | Storage isolation | Another tenant cannot list/read thumbnails, original media, point-cloud data, or signed-view instructions. | Independent security requirement; target policy unknown. |
| QA-INSP-01 | Progress | Required/optional/repeatable/skipped synthetic tasks reconcile to specified counters and report data. | Target numbers visible; formula not verified. |

Before release, add provider-contract tests, accessibility audit, visual review with original assets, API schema tests, import/export tests if those features are approved, and recovery tests for failed background conversion. Never use production target IDs or private imagery as fixtures.
