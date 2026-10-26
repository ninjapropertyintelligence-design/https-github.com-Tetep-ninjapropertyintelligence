# Organizations directory — page dossier (first pass)

Route: `/organizations`. Evidence class: **live authenticated UI observation** on 2026-10-20 plus earlier notes in [DASHBOARD_FEATURES.md](../DASHBOARD_FEATURES.md). A screenshot was captured inline (`SS-ORG-001`) but not saved as a durable file. Page completeness: **Partially Verified**.

## Visible structure

- Global dark header: Phygii logo, Help, two icon-only controls, account button.
- Sidebar: organization management context; after selecting Client A, Map, Organizations, Locations, Projects, Collections links were visible.
- Main panel: heading “Organizations”, text input with placeholder “Search organizations”, list of seven organizations, pagination display “1–7 of 7”, previous/next buttons disabled in that state.
- Organization rows observed: Client A, Client B, Client C, Client D, Client E, Client F, Client G. Only Client A was selected; other organizations were not opened.

## Observed navigation

Selecting Client A by mouse moved to `/organization/ID05/explore/map` after a visible loading state; pressing Enter on the Client B row opened `/organization/ID04/explore/map`. Browser Back restored the directory. Rows sit in focusable `MuiListItemButton`-class containers. Searches were case-insensitive substring matches for tested samples; ` gap ` did not match `Client B`, so surrounding whitespace was not trimmed in that case. A no-match query showed `No organizations match your search` and `0–0 of 0`; the clear button restored all seven rows. Pagination buttons stayed disabled. At 600×800, the sidebar became icon-only and the account name was hidden; default viewport was restored. No network request was captured.

## Second-pass audit checklist — pending

- Inspect all visible and overflow actions, including any row menu, toolbar icon tooltip, and account menu.
- Measure columns, alignment, typography, spacing, responsive breakpoints, focus order, hover and selected states.
- Test safe search strings (exact name, partial name, no match, whitespace, special characters) without sending private data.
- Observe loading, empty, error, and pagination states if safely reproducible; do not manufacture errors in production.
- Save a durable, redacted screenshot and sanitized request metadata only after a supported export/capture method is confirmed.
- Compare all seven row labels and destinations without assuming permission to explore other organizations beyond visible links.

Detailed per-control records: [features/organizations.md](../features/organizations.md). QA seeds: [QA_TEST_CASES.md](../QA_TEST_CASES.md).
