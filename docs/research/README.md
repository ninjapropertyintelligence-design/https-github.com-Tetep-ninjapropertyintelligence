# Product research: Phygii (Immersion Data Solutions)

Reference notes from a read-only review of the Phygii dashboard, made in October 2026
with access we are authorized to use. They describe what the product does as seen from
its own screens and network panel. They are not a specification to copy: everything in
this repository is our own design, data model and code.

What was and was not done:

- Only pages already reachable from our signed-in account were opened. Nothing was
  edited, submitted, replayed or enumerated, and no security control was bypassed.
- No credentials, cookies, tokens, header values or response values were kept.
- Customer data is redacted. Organizations are `Client A`–`Client G`, their stores are
  `Site 1`–`Site 5`, street addresses are `<street address>`, states are `<state>`, and
  record and store numbers are `ID01`, `ID02` and so on (the same number always maps to
  the same placeholder, so cross-references between files still line up).

## Contents

| Path | What it is |
| --- | --- |
| [PHYGII_FEATURE_DETAILS.md](PHYGII_FEATURE_DETAILS.md) | Controls and behaviors seen on the survey, media and project screens. Sections 1–3 only; the original was cut off at section 4. |
| [API_SHAPES.md](API_SHAPES.md) | Sanitized shapes of the GraphQL responses behind six pages: field names and types only. |
| [audit/](audit/) | The full audit: page map, features, forms, workflows, roles, calculations, digital-twin viewers, integrations, gaps and an implementation plan. Start with `audit/MASTER_FEATURE_INVENTORY.md` and `audit/COMPLETE_BACKEND_EVIDENCE_REPORT.md`. |
| [audit/evidence/](audit/evidence/) | What each claim rests on (`OBSERVATIONS.md`, labelled `E-…`) and public sources. |

Where these notes say **UNKNOWN** or **Not Verified**, nothing was observed, and the
gap was filled by our own choices rather than guesses about their backend.

## How the notes map to what we built

| Observed in Phygii | Here |
| --- | --- |
| Assignments with repeatable tasks and task responses | `AssessmentTask` / `AssessmentTaskResponse`, `src/lib/assessment-service.ts` |
| Survey templates | `src/lib/template-service.ts`, `/assessments/templates` |
| Programs and projects, archive, bulk import | `src/lib/project-service.ts`, `/projects` |
| Location media, tags, flags, comments | `src/lib/tag-service.ts`, `src/lib/media-gallery.ts`, property Media tab |
| Collections | `src/lib/collection-service.ts`, `/collections` |
| Raster/vector map overlays | `src/lib/overlay-service.ts` |
| Matterport, point cloud and Autodesk viewers | `src/lib/embed-service.ts`, property Digital Twin tab |
| Released reports | `src/lib/reports/`, report versions on the assessment page |
| Device-made IDs for offline capture | `clientId` columns, `src/lib/client-id.ts` |
