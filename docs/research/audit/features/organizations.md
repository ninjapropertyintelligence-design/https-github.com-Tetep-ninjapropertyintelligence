# Organizations — individual feature records

Observed live on the authenticated `/organizations` page on 2026-10-20. `SS-ORG-001` is a screenshot captured inline in this Codex task, not yet a durable file. `UI-LIVE-ORG` denotes directly observed page/DOM state, **not** a REA Evidence ID. Unknown behavior is not inferred from control names.

## ORG-005 — Account menu

1. **ID:** ORG-005.
2. **Page/navigation:** Global header on `/organizations` and organization pages.
3. **Feature:** Account menu.
4. **Exact label:** `<user initials>`; menu items `Profile` and `Logout`.
5. **Screenshot:** `SS-ORG-003`, captured inline only.
6. **Purpose/business function:** Exposes profile and sign-out navigation (inferred from labels; sign-out not invoked).
7. **UI location:** Right end of dark top bar.
8. **Visibility:** Present for this authenticated account; roles unknown.
9. **Interactions:** Click opened menu; Escape dismissed it.
10. **Inputs/types:** None.
11. **Required/optional:** Not applicable.
12. **Default/placeholder:** Closed by default.
13. **Options:** Profile; Logout.
14. **Validation/restrictions:** None observed.
15. **Search behavior:** Not applicable.
16. **Filtering:** Not applicable.
17. **Sorting:** Not applicable.
18. **Pagination:** Not applicable.
19. **Calculations/formatting:** Account initials/label rendered in header; derivation unknown.
20. **Loading/progress:** None when opening/closing menu.
21. **Success/failure:** Menu appeared on click and disappeared with Escape; destination failures untested.
22. **Empty-data behavior:** Not applicable.
23. **Keyboard/mouse:** Mouse open and Escape close verified; keyboard open/focus cycling untested.
24. **Navigation:** `Profile` destination previously observed as `/profile`; current click not repeated. `Logout` not selected.
25. **State changes:** Open/closed popover state only in current test.
26. **Workflow:** Account/profile access; sign-out flow untested.
27. **API request:** Not captured.
28. **Response structure:** Not captured.
29. **Permission evidence:** Current authenticated account could see menu; other permissions unknown.
30. **Edge cases:** Outside click, responsive behavior, and session expiry untested.
31. **Dependencies:** Authenticated header/session.
32. **Independent implementation:** Provide a semantic menu, keyboard focus management, and explicit sign-out confirmation/redirect behavior suited to the new product.
33. **QA acceptance:** Button opens menu, Escape closes it without logout, Profile navigates when authorized, and keyboard focus is restored.
34. **Evidence:** `UI-LIVE-ORG` menu snapshot and `SS-ORG-003`; historical `/profile` route observation.
35. **Confidence:** Verified for menu items/open/close; Profile and Logout effects not verified in this live pass.

## ORG-006 — Organization search

1. **ID:** ORG-006.
2. **Page/navigation:** Organizations → `/organizations`.
3. **Feature:** Search organization names.
4. **Exact label:** `Search organizations`.
5. **Screenshot:** `SS-ORG-001` (default state only; inline).
6. **Purpose/business function:** Find an organization in the directory (observed effect).
7. **UI location:** Top of main list card.
8. **Visibility:** Visible to this authenticated account; other roles unknown.
9. **Interactions:** Focus, type, and use separate clear icon.
10. **Inputs/types:** Single text string.
11. **Required/optional:** Optional; blank input shows all seven rows.
12. **Default/placeholder:** Blank; `Search organizations`.
13. **Options:** Free text; no suggestions observed.
14. **Validation/restrictions:** No visible validation or maximum length observed.
15. **Search behavior:** `Client B` and `gap` each yielded `Client B`; `farm` yielded `Client A`; `G` yielded four rows containing that letter. `no-such-org-xyz` and ` gap ` yielded no rows. The tested matching is case-insensitive substring matching; surrounding whitespace was not trimmed in the tested query.
16. **Filtering:** Visible rows update with query; server vs client execution unknown.
17. **Sorting:** No sort control seen; match ranking unknown.
18. **Pagination:** Count changed from `1–7 of 7` to `1–1 of 1` and `0–0 of 0`; page buttons stayed disabled.
19. **Calculations/formatting:** Range uses `start–end of total`; larger-page arithmetic unknown.
20. **Loading/progress:** None seen during these quick searches.
21. **Success/failure:** Match shows a row; miss shows `No organizations match your search`; network error not tested.
22. **Empty-data behavior:** No-match alert and `0–0 of 0`; truly empty organization directory unknown.
23. **Keyboard/mouse:** Typing verified; Enter/Escape/focus-ring behavior untested.
24. **Navigation:** Query did not change `/organizations` URL.
25. **State changes:** Input, row list, count, and clear-icon visibility changed.
26. **Workflow:** [Organization selection](../workflows/organization-selection.md).
27. **API request:** Not captured.
28. **Response structure:** Not captured.
29. **Permission evidence:** Current signed-in account could use it; role matrix unknown.
30. **Edge cases:** Lowercase, partial substring, no-match, and surrounding-whitespace queries tested; Unicode and long text untested.
31. **Dependencies:** Organization dataset, result counter, clear control ORG-010.
32. **Independent implementation:** Define a documented, case-insensitive search rule with an explicit empty state; do not assume the private algorithm.
33. **QA acceptance:** Blank shows all fixtures; lowercase match works; miss shows empty state; clear restores all; no record changes.
34. **Evidence:** `UI-LIVE-ORG` DOM snapshots for blank, `Client B`, `gap`, `farm`, `G`, whitespace, miss, and cleared states; `SS-ORG-001`.
35. **Confidence:** Verified only for listed examples; API and untested states unknown.

## ORG-010 — Search clear button

1. **ID:** ORG-010.
2. **Page/navigation:** Organizations → `/organizations`.
3. **Feature:** Clear the current query.
4. **Exact label:** No accessible name; visual `×` icon.
5. **Screenshot:** No durable image; nonempty state not captured.
6. **Purpose/business function:** Restore the unfiltered list (observed).
7. **UI location:** Right end of search input.
8. **Visibility:** Appeared for a nonempty query, absent when blank.
9. **Interactions:** Click verified; keyboard untested.
10. **Inputs/types:** No separate input; acts on text query.
11. **Required/optional:** Not applicable.
12. **Default/placeholder:** Hidden in default blank state.
13. **Options:** None.
14. **Validation/restrictions:** None observed.
15. **Search behavior:** Removes active search term.
16. **Filtering:** Restored seven rows.
17. **Sorting:** No effect observed.
18. **Pagination:** Restored `1–7 of 7`.
19. **Calculations/formatting:** Count follows restored list; implementation unknown.
20. **Loading/progress:** None observed.
21. **Success/failure:** Successful click blanked field; failure unknown.
22. **Empty-data behavior:** Cleared the no-match alert.
23. **Keyboard/mouse:** Mouse click verified; missing accessible name is an accessibility issue to avoid in a new design.
24. **Navigation:** URL stayed `/organizations`.
25. **State changes:** Query blank; full list visible; icon disappeared.
26. **Workflow:** [Organization selection](../workflows/organization-selection.md).
27. **API request:** Not captured.
28. **Response structure:** Not captured.
29. **Permission evidence:** Same page as ORG-006; role matrix unknown.
30. **Edge cases:** Only one nonempty miss query cleared.
31. **Dependencies:** ORG-006.
32. **Independent implementation:** Give the clear button an accessible name and predictable focus behavior.
33. **QA acceptance:** Nonempty query reveals control; click restores blank input/list/count; keyboard action is supported.
34. **Evidence:** `UI-LIVE-ORG` input DOM and post-click snapshot.
35. **Confidence:** Verified for mouse clear, unknown for keyboard/API.

## ORG-007 — Organization row

1. **ID:** ORG-007.
2. **Page/navigation:** Organizations → `/organizations`.
3. **Feature:** Open organization workspace.
4. **Exact label:** Tested row `Client A`; six other names visible.
5. **Screenshot:** `SS-ORG-001` inline default list.
6. **Purpose/business function:** Select organization context.
7. **UI location:** Row in main list below pagination strip.
8. **Visibility:** Seven rows for this account; other account visibility unknown.
9. **Interactions:** Mouse clicked Client A; pressing Enter on the focusable `MuiListItemButton`-class Client B row also navigated.
10. **Inputs/types:** No form input; route contains organization ID.
11. **Required/optional:** Not applicable.
12. **Default/placeholder:** No row selected on directory.
13. **Options:** Client A, Client B, Client C, Client D, Client E, Client F, Client G.
14. **Validation/restrictions:** No row validation observed; other organizations' access unknown.
15. **Search behavior:** Row shown/hidden by ORG-006.
16. **Filtering:** Search only; no other filter seen.
17. **Sorting:** No sort control; displayed order appears alphabetical but rule unverified.
18. **Pagination:** Seven of seven visible; buttons disabled.
19. **Calculations/formatting:** Tested label rendered 16px, Roboto/Helvetica/Arial stack, dark text at current viewport.
20. **Loading/progress:** `LoadingLogo` image and progressbar appeared after selection.
21. **Success/failure:** Client A opened map; other rows and errors untested.
22. **Empty-data behavior:** Search miss hides rows and shows alert.
23. **Keyboard/mouse:** Mouse click and Enter verified on different rows; Space and focus treatment unknown.
24. **Navigation:** Client A → `/organization/ID05/explore/map`; Client B → `/organization/ID04/explore/map`.
25. **State changes:** Directory replaced by map/sidebar; browser Back restored directory.
26. **Workflow:** [Organization selection](../workflows/organization-selection.md).
27. **API request:** Not captured.
28. **Response structure:** Not captured.
29. **Permission evidence:** This account could open Client A and Client B; remaining rows/roles untested.
30. **Edge cases:** Loading seen; denied/missing organization untested.
31. **Dependencies:** Authenticated organization list and destination map.
32. **Independent implementation:** Use semantic links and server-enforced membership checks with original identifiers/data.
33. **QA acceptance:** Authorized row opens its workspace; Back restores directory; independent app denies unauthorized tenant IDs.
34. **Evidence:** `UI-LIVE-ORG` row DOM, click/Enter/loading/destination/Back snapshots; `SS-ORG-001`.
35. **Confidence:** Verified for the two tested routes/interactions; others unknown.

## ORG-008 — Result range and pagination buttons

1. **ID:** ORG-008.
2. **Page/navigation:** Organizations → `/organizations`.
3. **Feature:** Show list range and page controls.
4. **Exact labels:** `1–7 of 7`; `Go to previous page`; `Go to next page` (duplicated above/below list).
5. **Screenshot:** `SS-ORG-001` inline.
6. **Purpose/business function:** Display position and permit page changes (latter inferred).
7. **UI location:** Upper and lower edges of list.
8. **Visibility:** Both strips visible in default and filtered states.
9. **Interactions:** Buttons disabled in all tested states; enabled behavior untested.
10. **Inputs/types:** No page-size input visible.
11. **Required/optional:** Not applicable.
12. **Default/placeholder:** `1–7 of 7`.
13. **Options:** Previous and next only.
14. **Validation/restrictions:** Both disabled when one page/zero results.
15. **Search behavior:** Count responds to ORG-006.
16. **Filtering:** Count mirrors filtered result set.
17. **Sorting:** None visible.
18. **Pagination:** `1–7 of 7`, `1–1 of 1`, `0–0 of 0` observed; multi-page behavior unknown.
19. **Calculations/formatting:** En dash in range, `of` before total.
20. **Loading/progress:** No independent loading state seen.
21. **Success/failure:** Disabled state observed; enabled success/errors unknown.
22. **Empty-data behavior:** `0–0 of 0` with no-match alert.
23. **Keyboard/mouse:** Disabled controls not activated; enabled keyboard behavior unknown.
24. **Navigation:** No observed navigation from these controls.
25. **State changes:** Both strips updated together with search.
26. **Workflow:** Directory browsing.
27. **API request:** Not captured.
28. **Response structure:** Not captured.
29. **Permission evidence:** Current authenticated directory only.
30. **Edge cases:** One page and zero matches seen; multi-page unknown.
31. **Dependencies:** Search/list result set.
32. **Independent implementation:** Define pagination contract and keep duplicated controls synchronized.
33. **QA acceptance:** Both strips agree; zero results show `0–0 of 0`; edge buttons disable correctly.
34. **Evidence:** `UI-LIVE-ORG` default/match/miss/clear snapshots; `SS-ORG-001`.
35. **Confidence:** Verified for observed states, unknown for enabled pagination.

## ORG-009 — Sidebar toggle/navigation

1. **ID:** ORG-009.
2. **Page/navigation:** Global sidebar at `/organizations`, then organization context.
3. **Feature:** Expand/collapse sidebar and expose section links.
4. **Exact labels:** `Manage`, `Organizations` expanded; toggle itself had no accessible name.
5. **Screenshot:** `SS-ORG-001` expanded state inline; collapsed state not saved.
6. **Purpose/business function:** Navigation and space-saving layout (inferred).
7. **UI location:** Left edge; circular button on boundary.
8. **Visibility:** At default 1054×748 viewport, sidebar labels were expanded. At temporary 600×800 viewport, it displayed as a narrow icon-only rail, and the account name was hidden. Viewport was reset afterward.
9. **Interactions:** Toggle clicked twice; collapsed to icon-only link, then restored.
10. **Inputs/types:** None.
11. **Required/optional:** Not applicable.
12. **Default/placeholder:** Expanded initially.
13. **Options:** Expanded/collapsed.
14. **Validation/restrictions:** None observed.
15. **Search behavior:** No sidebar search seen.
16. **Filtering:** None seen.
17. **Sorting:** None seen.
18. **Pagination:** Not applicable.
19. **Calculations/formatting:** Sidebar width changed; exact size unmeasured.
20. **Loading/progress:** None observed.
21. **Success/failure:** Toggle worked both ways; failure unknown.
22. **Empty-data behavior:** Not applicable.
23. **Keyboard/mouse:** Mouse verified; keyboard/focus unknown; independent implementation should label toggle.
24. **Navigation:** Directory link `/organizations`; organization context shows Map, Locations, Projects, Collections links.
25. **State changes:** Text labels hide/restore without URL change.
26. **Workflow:** Directory and organization navigation.
27. **API request:** Not captured.
28. **Response structure:** Not captured.
29. **Permission evidence:** Links visible to current account; no role matrix.
30. **Edge cases:** Narrow 600px viewport observed; persistence/reload and other breakpoints unknown.
31. **Dependencies:** Global navigation shell and current context.
32. **Independent implementation:** Semantic labeled toggle, visible active route, responsive keyboard-accessible navigation.
33. **QA acceptance:** Toggle changes presentation not route; links remain operable and named.
34. **Evidence:** `UI-LIVE-ORG` accessibility before/after toggle and 600px snapshot; `SS-ORG-001` and `SS-ORG-002` inline.
35. **Confidence:** Verified desktop toggle and one narrow breakpoint; other states unknown.

## Outstanding second pass

ORG-001 through ORG-005 (logo, Help, two badge/icon controls, account menu) need individual records. Header icon effects were not activated. Hover, keyboard, responsive, enabled multi-page pagination, loading/error states, and sanitized network evidence remain unverified. This module is **Partially Verified**.
