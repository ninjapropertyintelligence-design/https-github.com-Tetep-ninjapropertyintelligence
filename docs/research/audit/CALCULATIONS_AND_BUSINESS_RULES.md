# Calculations and business rules: observed versus unknown

Updated 2026-10-20. This document records display arithmetic and UI flags, **not** target formulas or server validation. Detailed samples are in [ALL_CALCULATIONS.md](ALL_CALCULATIONS.md) and [BUSINESS_RULES.md](BUSINESS_RULES.md).

| Display or rule surface | Verified observation | Unverified behavior |
| --- | --- | --- |
| Project status tabs | Three Client A cards divided into one Published and two Completed in the observed list. [E-PROJ-S2-01, E-PROJ-S3-01, E-PROJ-S1-01](evidence/OBSERVATIONS.md) | Transition graph, role permissions, hidden statuses, and server filtering. |
| Task-response counts | Site 2 21 complete + 2 incomplete = 23; Site 3 42 + 0 = 42. [E-ASG-RESP-02–03](evidence/OBSERVATIONS.md) | What constitutes complete; repeated, skipped, deleted, or hidden responses. |
| Required task progress | Site 2 displayed 24/27; Site 3 25/27; Client B response displayed 0/0 required while 20/21 tasks were complete. [E-ASG-RESP-02–03, E-CLB-ASG-02](evidence/OBSERVATIONS.md) | Denominator construction, optional-task treatment, rounding, and status effects. |
| Image counters | Uploaded and captured counts matched in the inspected released responses. [E-ASG-RESP-02–03](evidence/OBSERVATIONS.md) | Whether they always match or represent independent sets. |
| Question/task configuration | Required, Repeatable, Completable, type, and metadata flags were rendered on assignment `403`. [E-ASG-TEMPLATE-02–03](evidence/OBSERVATIONS.md) | Actual input validation, repetition limits, conditional logic, and persistence. |
| Collection privacy/access checks | Privacy filters and document access checkmarks appeared. [E-PROJ-S2-03–04](evidence/OBSERVATIONS.md) | Enforcement rules; controls were not changed. |

No scoring, analytics, billing, condition index, report formula, or backend business-rule code was observed. Any independent implementation needs separately specified rules and synthetic tests; it must not treat these sample totals as an algorithm.
