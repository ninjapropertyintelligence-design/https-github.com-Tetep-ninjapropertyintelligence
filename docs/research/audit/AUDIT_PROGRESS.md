# IDS/Phygii full-platform audit progress

Updated 2026-10-20. **Audit only; no application development or production changes.** This is a live checklist, not a declaration of exhaustive coverage. The user's existing authenticated Chrome tab is the UI evidence source. Local `E-*` identifiers are observation references, not REA Evidence IDs or network captures.

## Current priority (user-directed change)

Project-by-project coverage is **deprioritized**. The active goal is backend evidence and documentation: map verified browser/display relationships, identify static frontend API candidates, and obtain runtime request/response evidence only through a supported same-profile, authorized method. The eight previously missing named documentation files have been created. [API_OBSERVATIONS.md](API_OBSERVATIONS.md), [TECHNICAL_FINDINGS.md](TECHNICAL_FINDINGS.md), and [static bundle API candidates](evidence/STATIC_BUNDLE_API_CANDIDATES.md) distinguish code strings from captured traffic. No live API calls or response schemas are yet verified.

## Organization coverage

| Organization visible in directory | Directory identified | Projects inventoried | Locations inventoried | Project-by-project feature audit | Remaining work |
| --- | --- | --- | --- | --- | --- |
| Client A `ID05` | Yes | 3 of 3 visible in current list | 3 of 3 visible in current list | First-pass UI across three projects; assignment `403` 27 tasks/54 questions | Deeper controls, media, write-path effects, network, second-pass completeness |
| Client B `ID04` | Yes | 2 of 2 visible in current list | 2 shown on map | Published project `ID32` partially inspected; New project `ID33` pending | Finish both projects, both locations, assignment `ID08` question flags, viewers, secondary actions |
| Client C `ID02` | Yes | 0 visible; empty list inspected | 0 visible; map and directory inspected | No project cards to audit; Collections empty | Header, program filter/options, second-pass states pending |
| Client D `ID03` | Yes | 0 visible; empty list inspected | 0 visible; map and directory inspected | No project cards to audit; Collections empty | Header and second-pass states pending |
| Client E | Yes | Pending | Pending | Pending | Same |
| Client F | Yes | Pending | Pending | Pending | Same |
| Client G | Yes | Pending | Pending | Pending | Same |

## Evidence and safety status

- [Existing Client A ledger](evidence/OBSERVATIONS.md) is preserved.
- Client B first-pass findings are in [Client B project dossier](pages/client-b-site-5-project.md) and will be appended to the evidence ledger as the project audit continues.
- No credentials, authentication tokens, cookies, personal user-contact values, or operational survey instructions/PINs are stored in audit files.
- REA MCP is connected, but its browser capture requires a loopback CDP endpoint unavailable for this Chrome-extension session. No authenticated API request/response capture exists.
- No upload, report generation, edit, delete, communication, payment, or permission change has been made.
- Screenshots captured through this Chrome connection are inline only until a supported durable export/redaction path is verified.

## Completion gate

Do **not** mark an organization or project complete until its accessible pages/tabs, lists/pagination, filters, safe secondary controls, surveys, viewer types, read-only statuses, and distinctive features have been revisited and documented. A permission denial remains a boundary, not a missing-feature conclusion. Backend/network and state-changing behavior remain unverified until safe authorized evidence exists.
