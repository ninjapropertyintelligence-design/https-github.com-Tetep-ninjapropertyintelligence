# Phygii user flows and visible rules

Observed in the authenticated Phygii UI on 2026-10-20. `Verified` means the navigation/control state was seen; it does not imply that a write operation was tested.

## Browse an organization and its locations — verified

1. Open Organizations; use the visible organization list/search.
2. Select Client A to enter its organization context (ID `ID05`).
3. Use Locations to view three rows, or Map to view the same locations as a list and map markers.
4. Open Site 1 location (ID `ID26`) to see Media, Projects, Overlays, Assignments, 3D Embed, Info, and Collections tabs.

Visible rule: lists expose pagination even when all records fit one page. Search results were observed for organization/location names, but full matching and pagination semantics remain unknown.

## Find a project and inspect documents — verified

1. Open the organization Projects list and use the status tabs.
2. Select one of Site 1 (`ID29`), Site 2 (`ID28`), or Site 3 (`ID30`).
3. Open Documents to see four entries and access-checkbox states.
4. In Site 1, expand Site Survey to see three dated PDF versions. In Site 2 and Site 3, expand the four cards to see “No document versions.”

Visible rule: Site 1 is Published; Site 2 and Site 3 are Completed. Site 2 and Site 3 have different user totals (138 and 198), both with four shown by the Inactive filter. Site 3 Site Survey's Capture Access is unchecked, unlike its other document cards and Site 2's. The meaning of statuses and transition permissions is unknown. Upload Document and access controls were not used.

## Review an assignment and response — verified

1. From the project Assignments tab, open active assignment `403`.
2. Expand a section/task to inspect displayed task/question flags.
3. Open Responses to see three project-specific cards: Site 1 In Progress `ID24`, Site 2 Released `ID23`, Site 3 Released `ID22`.
4. Review progress counters and task-response outline; switch to Info for created/updated/status.

Visible rule: task configuration distinguishes Required, Repeatable, Completable, metadata capture, marker placement, and question Type. Displayed response counters differ by project: Site 1 23/27 required tasks and 25+5 task responses; Site 2 24/27 and 21+2; Site 3 25/27 and 42+0. The exact computation, save lifecycle, and report eligibility are unknown. [Response dossier](pages/assignment-responses.md)

The assignment template's 27 tasks/54 questions were opened read-only for a structural count; question types and flags are in the [task inventory](pages/assignment-task-inventory.md). No answer was entered or saved.

Navigation exception: the Site 2 response's global Responses breadcrumb led once to a not-found page, while the project-scoped assignment list remained accessible. Do not assume that route is a supported navigation flow.

## Account settings — verified read-only

The account menu exposes Profile and Logout. Profile Details and Settings display disabled fields and an Edit button. Settings shows password rules: eight or more characters, uppercase, lowercase, numeral, special character. No edit or password action was performed.

## Access boundary — verified

Following the project’s Program link showed an access-denied modal. This is a server/UI permission boundary in the observed session; no alternative route or bypass was tried.

## Visible but untested actions

Media Upload, Upload Document, Add/Edit/Delete response, Generate Report, document access-checkbox changes, profile Edit, and assignment Settings Edit are visible affordances. Their effect, prerequisites, and reversibility are **unverified**. Any future test against production requires specific user authorization and safe test data; no such test was done here.
