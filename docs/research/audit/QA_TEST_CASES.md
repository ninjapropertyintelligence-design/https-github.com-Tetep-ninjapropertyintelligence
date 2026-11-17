# Read-only reconstruction QA seeds

These are acceptance tests for an **independent future application**, not tests run against production Phygii. Observed expected UI wording is included where known; implementation-specific policies remain to be decided. Test data should be synthetic and tenant-isolated.

| ID | Scenario | Steps | Expected / evidence status |
| --- | --- | --- | --- |
| QA-ORG-01 | Organization search | Open directory; enter mixed-case name fragment | Matching rows and range update. Case-insensitive substring behavior verified for several target examples. |
| QA-ORG-02 | Organization no-match | Enter an absent term | Show empty message and `0–0 of 0`; target wording `No organizations match your search` observed. |
| QA-ORG-03 | Clear search | Click named clear control | Blank input and full list return; target clear icon lacked accessible name, so improve that in the new app. |
| QA-ORG-04 | Keyboard row navigation | Focus organization row and press Enter | Authorized organization context opens; verified on Client B in target. |
| QA-ORG-05 | Tenant isolation | Try a visible user's unauthorized tenant ID by direct route in synthetic environment | Denied without leaking tenant data; independent security requirement, target policy unknown. |
| QA-MAP-01 | Location search | On map, search a known city then absent term | Count/list update; no-match message appears. Target examples observed for Site 1 and absent string. |
| QA-MAP-02 | Program filter | Select and clear a program | Chip and location state update consistently; exact target result semantics not yet known. |
| QA-MAP-03 | Preview/Explore | Select a location row then click Explore | Preview appears before navigation; route changes to location map. Verified on Site 1. |
| QA-MAP-04 | Media toggle | Uncheck and recheck one type | Control state changes and restores; marker visibility should be separately verified in the new app. |
| QA-LOC-01 | Directory load failure | Inject a controlled read error in test environment | Show error, not an empty-list message; retry can recover. Target transient failure/reload observed. |
| QA-LOC-02 | Detail tabs | Open each location tab | URL/state and matching panel content settle; avoid stale content after tab highlight. Target asynchronous transition observed. |
| QA-PROJ-01 | Status tabs | Select All, Published, Completed, New, In Progress | Correct subset/range/empty state; target sample counts 3/1/2/0/0. |
| QA-PROJ-02 | Search and status intersection | Search under a status tab | Define product rule before implementation; target combined behavior unverified. |
| QA-SEC-01 | Direct resource authorization | Access another tenant's location/project/media ID | Denied by server/RLS and storage policy; no metadata leak. Proposed security requirement. |

Before a release, expand this into field-level, focus/keyboard, responsive, loading, accessibility, permission, and error-matrix tests for every feature record. Destructive/create/update/delete flows require a separate synthetic or staging environment and explicit product requirements.
