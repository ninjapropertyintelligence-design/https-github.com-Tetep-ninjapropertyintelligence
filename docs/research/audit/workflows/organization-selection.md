# Workflow: select an organization (live read-only observation)

1. Start at `/organizations` with the authenticated directory visible.
2. Observe the list and search control. Do not infer search behavior; it was not used.
3. Select the Client A row. A `LoadingLogo` image and progressbar appeared.
4. Observe `/organization/ID05/explore/map` and sidebar links for Map, Organizations, Locations, Projects, Collections.
5. Use browser Back to return to `/organizations`; the seven-row list reappears.

Verified live: mouse selection of Client A, Enter activation of Client B, loading indicator, both destination URLs, sidebar context, and Back restoration. Client B map displayed two locations; Client A map displayed three. Unverified: Space-key activation, error recovery, API call, permission check, and whether every organization has the same modules. No data mutation occurred. This sequence is a reproducible read-only QA candidate, not a completed end-to-end acceptance test.
