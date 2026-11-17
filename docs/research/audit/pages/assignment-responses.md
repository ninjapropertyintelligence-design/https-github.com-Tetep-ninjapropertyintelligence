# Assignment 403 — cross-project responses

Observed read-only on 2026-10-20 via `/organization/ID05/projects/ID30/assignments/403?tab=responses`. The project-scoped assignment showed four section headings: Check-In (`ID09`), MEP Assets & Utilities (`ID10`), Deficiencies (`ID11`), Check Out (`ID12`). Its Responses tab listed one card for each of the three visible projects. [E-ASG-RESP-01](../evidence/OBSERVATIONS.md)

| Project | Response | State | Task responses | Detail progress observed |
| --- | --- | --- | ---: | --- |
| Site 1 `ID29` | `ID24` | In Progress | 30 | 23/27 required tasks; 25 complete + 5 incomplete task responses; 196 uploaded/captured images (earlier UI pass) |
| Site 2 `ID28` | `ID23` | Released | 23 | 24/27 required tasks; 21 complete + 2 incomplete task responses; 204 uploaded/captured images |
| Site 3 `ID30` | `ID22` | Released | 42 | 25/27 required tasks; 42 complete + 0 incomplete task responses; 141 uploaded/captured images |

These are displayed counters, not validated calculations or API fields. Site 2 and Site 3 detail pages exposed Task Responses and Info tabs, task-status/pending-image/orphaned-answer filters, a task tree, and Generate Report. Their Info tabs displayed Created, Updated, Status and a disabled Edit button. No private answer values were copied; no response was created, edited, deleted, or reported. [E-ASG-RESP-02–03](../evidence/OBSERVATIONS.md)

The Site 3 Task Responses filter menus exposed `All / Complete / Incomplete`, `All / Pending images`, and `All / Orphaned answers`, respectively. No nondefault option was applied. [E-ASG-RESP-04](../evidence/OBSERVATIONS.md)

Navigation caveat: the Site 2 detail's global “Responses” breadcrumb led to `/organization/ID05/assignments/403?tab=responses`, which displayed a not-found message once. The project-scoped assignment Responses tab worked. This could be a transient error or route mismatch; cause unverified. [E-NAV-01](../evidence/OBSERVATIONS.md)

Unknown: assignment/project ownership schema, status transitions, how task counts are computed, whether generated reports are available to this account, answer validation, image ingestion, and network request/response structure.
