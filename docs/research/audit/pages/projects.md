# Client A projects — live first-pass dossier

Read-only observation on 2026-10-20 at `/organization/ID05/projects`; the current account could view this page. This is a partial UI specification, not an API or database description.

The directory has tabs `All`, `New`, `In Progress`, `Published`, and `Completed`; a `Search projects` field; duplicated top/bottom range plus previous/next buttons; and a list of project rows. All three visible rows are titled `2026 Essential Solution`, show the associated location and `Full Capture` badge, and link to distinct detail routes:

| Status | Location | Detail route |
| --- | --- | --- |
| Completed | Client A brand 1 ID36 - Site 2, <state> | `/organization/ID05/projects/ID28` |
| Published | Client A brand 1 ID35 - Site 1, <state> | `/organization/ID05/projects/ID29` |
| Completed | Client A brand 2 ID37 - Site 3, <state> | `/organization/ID05/projects/ID30` |

`All` showed `1–3 of 3`; `Published` showed one Site 1 row; `Completed` showed the Site 2 and Site 3 rows with `1–2 of 2`. `New` and `In Progress` each showed `0–0 of 0` and the alert `No projects match your search`, even though the search input was blank. Previous/next buttons were disabled in these states. The Completed view's browser URL was `/organization/ID05/projects?filter=completed`; other tab parameters were not recorded. Tab selection updated the list after a brief asynchronous UI transition; immediate snapshots could show a new tab highlight with old rows, so only settled states were recorded.

Project text search, combination of search with status, enabled pagination, sort order, responsive layout, loading/error handling, and detailed row behavior need a second pass. No project was edited, created, or deleted; no network contract was observed.
