# Observable data relationships

Updated 2026-10-20. This maps **rendered application relationships**, not the target's database schema. See [API_OBSERVATIONS.md](API_OBSERVATIONS.md) for the network-evidence boundary. Proposed tables for a separate application are in [DATA_MODEL_PROPOSAL.md](DATA_MODEL_PROPOSAL.md), not here.

| Relationship shown in UI | Direct evidence | Unknown backend detail |
| --- | --- | --- |
| Organization → locations/projects | Organization selection changes the map and list context; Client A showed three locations/projects, Client B two, Client C and Client D none. [E-CLB-ORG-01, E-CLB-PROJ-01, E-CLC-01, E-CLD-01](evidence/OBSERVATIONS.md) | Tenant ownership, membership policy, and whether the displayed lists are exhaustive for other roles. |
| Project → location | Project headers link to a named location. [E-PROJ-S2-01, E-PROJ-S3-01, E-CLB-PROJ-02](evidence/OBSERVATIONS.md) | Foreign key, cardinality, and whether a project may span locations. |
| Project → program | Project headers display a program link. [E-PROJ-S2-01, E-CLB-PROJ-02](evidence/OBSERVATIONS.md) | Program data model; one linked program route denied access. |
| Project ↔ assignment | Assignment `403` appeared on three Client A project cards; Client B `ID08` appeared on its project card. [E-PROJ-S2-04, E-PROJ-S3-04, E-CLB-PROJ-02](evidence/OBSERVATIONS.md) | Shared template versus copied records, join table, and ownership. |
| Assignment → section → task → question | Assignment `403` displayed four sections, 27 tasks, 54 questions; assignment `ID08` displayed three sections, 21 tasks, 69 question headings. [E-ASG-TEMPLATE-01–03, E-CLB-ASG-01](evidence/OBSERVATIONS.md) | Stored nesting, versioning, conditional branching, and validation. |
| Assignment/project → response | Assignment `403` listed three project-specific response cards; `ID08` listed a completed and a not-started card. [E-ASG-RESP-01, E-CLB-ASG-02](evidence/OBSERVATIONS.md) | Whether responses belong to assignment, project, user, or a composite key in storage. |
| Location/project → media, documents, overlays, embeds | UI tabs expose these collections; one Site 1 location displayed distinct raster and 3D-embed records. [E-DT-01, E-RASTER-01, E-PROJ-S2-03](evidence/OBSERVATIONS.md) | Physical storage, version ownership, media processing, and access checks. |

Do not turn this display graph into a claimed entity-relationship diagram for IDS. Numeric route IDs are UI identifiers only. No database joins, table names, or column types were observed.
