# User workflow register — partial

| Flow | Verified read-only sequence | Evidence / unknowns |
| --- | --- | --- |
| Select organization | Organizations → search/row → loading → Client A map; Back restores list | [Organization selection](workflows/organization-selection.md). Membership/denial rules unverified. |
| Find map location | Client A map → Search Locations → Site 1 row → preview → Explore → location map | [Map dossier](pages/organization-map.md). Marker interaction unverified. |
| Browse location media | Location map → `305 Media` → type toggles → View all media → gallery → close | Toggle state and overlay verified; item detail/action behavior unverified. |
| Open location detail | Locations list → Site 2/Site 3 row → LoadingLogo → tabbed detail | [Locations](pages/locations.md). Save/edit/upload flows not attempted. |
| Browse project statuses | Projects → All/Published/Completed/New/In Progress tabs → row subset/empty alert | [Projects](pages/projects.md). Search combination and writes unknown. |
| Inspect assignment response | Project → Assignment → Responses → response detail (historical) | [USER_FLOWS.md](USER_FLOWS.md). Full task path/calculations unverified. |
| View profile | Account menu → Profile → Details/Settings (historical) | Password fields deliberately not used; edit outcomes unknown. |

Each linked dossier records observations, but this is not yet a complete end-to-end workflow library. No production form submission, deletion, communication, payment, or report generation was performed. Proposed independent QA seeds are in [QA_TEST_CASES.md](QA_TEST_CASES.md).
