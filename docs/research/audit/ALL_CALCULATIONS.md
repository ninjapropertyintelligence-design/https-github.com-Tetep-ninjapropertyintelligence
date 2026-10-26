# Calculations — evidence versus formulas

**No private formula is verified.** [ALL_CHARTS_AND_CALCULATIONS.md](ALL_CHARTS_AND_CALCULATIONS.md) records observed display values. This file identifies where an independent implementation must define its own mathematics.

| Display | Observed sample | Verified relationship | Unverified rule to define independently |
| --- | --- | --- | --- |
| Project statuses | All 3; Published 1; Completed 2; New/In Progress 0 | Visible subsets sum to three in this sample. | Status lifecycle and hidden/excluded records. |
| Site 1 media | 305 Media in map panel | Previously viewed category numbers summed to 305. | Deduplication, visibility/permission exclusion, project overlap. |
| Response task responses | Site 1 25+5=30; Site 2 21+2=23; Site 3 42+0=42 | Arithmetic matches each displayed total. | Meaning of complete, optional/repeated tasks, deleted/skipped answers. |
| Response tasks | Site 1 23/27; Site 2 24/27; Site 3 25/27 required complete | Displayed ratios only. | Denominator eligibility, rounding, cross-section aggregation. |
| Response images | Site 1 196/196, Site 2 204/204, Site 3 141/141 uploaded/captured | Pairs match within these three samples. | Whether these are independent sets or aliases. |
| Pagination | `1–n of n`, `0–0 of 0` | Visible endpoints fit one-page lists. | Page-size limits, stable sort, server/client pagination. |

Do not derive database functions, billing, scoring, condition indexes, AI metrics, or report calculations from these examples. Use synthetic fixtures and stakeholder-approved definitions before coding.
