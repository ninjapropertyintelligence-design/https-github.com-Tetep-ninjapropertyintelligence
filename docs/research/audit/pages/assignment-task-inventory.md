# Assignment 403 — template structure (read-only)

Observed in the authenticated Client A UI on 2026-10-20 via a project-scoped assignment page. The four expandable sections contained **27 task headings and 54 question headings**. This is a structural inventory of visible configuration, not a copy of submitted answers, database schema, or implementation code. Questions were opened only to read type/flag labels; their full instructional text is intentionally not reproduced for an independent build. Local evidence: [E-ASG-TEMPLATE-01–03](../evidence/OBSERVATIONS.md).

| Section | Task ID | Visible task label | Questions | Types shown | Required questions |
| --- | ---: | --- | ---: | --- | ---: |
| Check-In | ID38 | Check In | 1 | text | 1 |
| MEP Assets & Utilities | ID39 | Electrical Assets | 3 | text, photo_simple | 3 |
| MEP Assets & Utilities | ID40 | Cabling Racks | 2 | photo_simple | 2 |
| MEP Assets & Utilities | ID41 | Fire Extinguishers | 1 | photo_simple | 1 |
| MEP Assets & Utilities | ID42 | Fire Alarm Panel | 2 | photo_simple | 2 |
| MEP Assets & Utilities | ID43 | Gas Meter | 2 | photo_simple | 2 |
| MEP Assets & Utilities | ID44 | Electric Meter | 2 | photo_simple | 2 |
| MEP Assets & Utilities | ID45 | Thermostats | 2 | photo_simple | 2 |
| MEP Assets & Utilities | ID46 | Refridgeration - Cases | 2 | photo_simple | 2 |
| MEP Assets & Utilities | ID47 | Refridgeration - Reach-in (medium temp doors) | 2 | photo_simple | 2 |
| MEP Assets & Utilities | ID48 | Refridgeration - Reach-in (frozen doors), Coffin Cases | 2 | photo_simple | 2 |
| MEP Assets & Utilities | ID49 | Walk in Coolers/Freezers | 2 | photo_simple | 2 |
| MEP Assets & Utilities | ID50 | Cabinets | 1 | photo_simple | 1 |
| MEP Assets & Utilities | ID51 | Interior Lighting | 1 | photo_simple | 1 |
| MEP Assets & Utilities | ID52 | Exterior Lighting | 1 | photo_simple | 1 |
| MEP Assets & Utilities | ID53 | HVAC | 1 | photo_simple | 1 |
| MEP Assets & Utilities | ID16 | Gas Dispensers | 1 | photo_simple | 1 |
| MEP Assets & Utilities | ID17 | Signage | 8 | photo_simple, text | 4 |
| MEP Assets & Utilities | ID18 | Bollards | 3 | photo_simple, number, text | 2 |
| Deficiencies | ID54 | Sales Floor | 2 | photo_simple, text | 2 |
| Deficiencies | ID55 | BOH | 2 | photo_simple, text | 2 |
| Deficiencies | ID56 | Office area | 2 | photo_simple, text | 2 |
| Deficiencies | ID57 | Restrooms | 2 | photo_simple, text | 2 |
| Deficiencies | ID58 | Vestibule | 2 | photo_simple, text | 2 |
| Deficiencies | ID59 | Exterior Facade | 2 | photo_simple, text | 2 |
| Deficiencies | ID60 | Parking Lot | 2 | photo_simple, text | 2 |
| Check Out | ID61 | Check Out | 1 | text | 1 |

Question configuration totals: `photo_simple` 38, `text` 15, `number` 1; Required Yes 49 / No 5; Repeatable Yes 43 / No 11; Is Label No for all 54. Every one of the 27 expanded tasks displayed Required Yes, Repeatable Yes, Completable Yes, Skip Metadata Capture No, Skip Marker Placement No, Is Custom No. Their Repeatable Label was typically `Response`; Check Out displayed `Check Out`; Gas Dispensers, Signage, and Bollards had an empty displayed label. This is a statement about the visible template only, not a generalized product rule.

Representative nested details: Check In's Default Metadata showed Level 1 / Photo Area Interior and Target Type Area / Title Interior. Electrical Assets showed Photo Type Inspection, Level 1, Photo Area Interior, Photo Category Electrical, and the same Area target. Sales Floor showed Photo Category Deficiencies. A text question under Electrical Assets was Required Yes and Repeatable Yes, while its photo prompts used `photo_simple`. Some Signage/Bollards questions were optional; no response validation was exercised.

Unknown: whether every task's metadata/target differs, how `photo_simple` is stored or uploaded, how repeatability changes answer cardinality, how completion counts are calculated, and what server-side validation applies. Do not infer these from the labels alone.
