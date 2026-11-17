# Unverified and inaccessible coverage

This file is a gap register, not a claim that a feature exists. Updated 2026-10-20; see [REVERSE_ENGINEERING_PROGRESS.md](REVERSE_ENGINEERING_PROGRESS.md) for per-page status.

| Area | Known gap | Safe next evidence needed |
| --- | --- | --- |
| Browser/REA | Codex Chrome extension is connected, but REA browser tools require a loopback CDP endpoint not exposed by this connection | Use only supported same-profile network inspection if made available; do not copy cookies/profile files or move to another profile |
| Screenshots | Captures exist inline in the task, not as durable files | Supported screenshot export with review/redaction, especially media thumbnails |
| API | No authenticated request/response metadata captured | Scoped, read-only network metadata capture omitting headers, tokens, cookies, and private values |
| Organizations | Help and two badge/icon controls; pagination with more than one page; error and keyboard/focus states | Open safe UI only, no download/upload/data changes; observe if available |
| Other organizations | Client B opened only to verify Enter navigation; five more listed but not opened | Read-only page-by-page inventory, respecting permission errors |
| Map | Marker click effects, cluster behavior, project/layer/filter application, temporal slider, responsive layout | Read-only toggles/selection with state restoration; no location data edits |
| Locations | Search edge cases, multi-page pagination, error root cause, deeper Site 2/Site 3 per-control audit | Eight-tab first pass completed; second-pass screenshots and per-control records remain; do not infer server issue from transient error |
| Projects | Search/status combinations, detailed Completed projects, document action outcomes | Read-only viewing; do not alter access checkboxes, upload, or generate reports |
| Assignments/responses | Full task/question tree, formulas, response validation, role-gated controls | Read-only expansion and count reconciliation; no answers, edits, deletes, submissions |
| Collections/profile | Nonempty collection states, profile Edit behavior and validation | Read-only inspection only; do not edit account details or password fields |
| Program | Linked route showed access denied | Mark Not Accessible; do not bypass or probe IDs |
| Independent design | Status transitions, field validation, media retention, role capabilities, API contracts | Product decisions and authorized sample data; target UI alone is insufficient |

No module has achieved exhaustive feature-level coverage. Absence from the current UI is not proof of product-wide absence.
