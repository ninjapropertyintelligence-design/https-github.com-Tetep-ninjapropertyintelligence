# Observed read-only workflows

Updated 2026-10-20. This file tracks workflows only to explain visible data/backend boundaries; a project-by-project UI census is no longer the priority. Expanded sequences are in [USER_WORKFLOWS.md](USER_WORKFLOWS.md) and [USER_FLOWS.md](USER_FLOWS.md).

| Flow | Verified visible sequence | Backend question left open |
| --- | --- | --- |
| Select an organization | Directory → organization → scoped map/list context. [E-CLB-ORG-01, E-CLC-01](evidence/OBSERVATIONS.md) | Membership and tenant-scoping mechanism. |
| Find a project and its location | Project list/status tab → project header → linked location/program. [E-CLB-PROJ-01–02, E-PROJ-S2-01](evidence/OBSERVATIONS.md) | List/query contract, relationship cardinality, program authorization. |
| Review an assignment response | Project assignment card → Responses tab → response status/progress detail. [E-ASG-RESP-01–03, E-CLB-ASG-02](evidence/OBSERVATIONS.md) | Response ownership, state transitions, progress formula. |
| View spatial material | Location → 3D Embed or Media/Raster tab → modal, viewer tab, or layer panel. [E-DT-01–04, E-MEDIA-01–02, E-RASTER-01](evidence/OBSERVATIONS.md) | Provider-link issuance, asset authorization, ingestion and conversion. |

No create/edit/delete, report generation, upload, communication, payment, or permission-changing workflow was executed. Any such behavior remains unverified, even where the UI shows a control.
