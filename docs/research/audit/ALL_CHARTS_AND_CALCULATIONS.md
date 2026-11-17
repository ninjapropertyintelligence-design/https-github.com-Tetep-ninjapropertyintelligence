# Charts, counts, and calculations — partial

No KPI dashboard chart or server-side formula was discovered in the accessible Client A navigation. This is **not** proof that the product has no charts elsewhere. Map marker clusters and the Timeline filter are visualizations, but their aggregation rules were not measured.

| Display | Observed value/format | Verified rule | Unknown |
| --- | --- | --- | --- |
| Directory range | `1–7 of 7`, `1–3 of 3`, `1–1 of 1`, `0–0 of 0` | Range and total update with visible search/status subsets | Page size, server-side pagination, off-by-one rules across pages. |
| Map location count | `Showing 3 Locations`, `Showing 1 Locations`, `Showing 0 Locations` | Count followed tested map search results | Marker-count reconciliation and program-filter semantics. |
| Location media total | `305 Media` at Site 1 | Visible category numbers sum to 305 (27+196+79+0+0+2+1+0+0+0+0) | Unique-item overlap and underlying source aggregation. |
| Project status subset | All 3, Published 1, Completed 2, New 0, In Progress 0 | Matches the three visible row badges | Lifecycle transition rules. |
| Response progress — Site 1 | 23/27 required tasks, 25 complete + 5 incomplete of 30 task responses, 196 uploaded/captured images | Display values only | Numerators, exclusions, rounding, report logic. |
| Response progress — Site 2 | 24/27 required tasks, 21 complete + 2 incomplete of 23 task responses, 204 uploaded/captured images | Display values only [E-ASG-RESP-02](evidence/OBSERVATIONS.md) | Same unknowns. |
| Response progress — Site 3 | 25/27 required tasks, 42 complete + 0 incomplete of 42 task responses, 141 uploaded/captured images | Display values only [E-ASG-RESP-03](evidence/OBSERVATIONS.md) | Same unknowns. |
| Timeline | Six visible dates and a two-handle range slider in map filter chooser | Visible options/slider only | Inclusive endpoints, timezone, item grouping. |

Do not implement formulas solely from displayed values. Reconcile future authorized sample records and obtain product decisions for independent-app semantics before coding.
