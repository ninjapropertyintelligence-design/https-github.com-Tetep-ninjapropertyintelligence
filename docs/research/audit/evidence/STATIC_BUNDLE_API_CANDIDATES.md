# Static frontend bundle: API route candidates

Observed 2026-10-20. The authorized dashboard page, after one normal reload, referenced `/assets/index-BfZVkNuh.js`. The asset returned `application/javascript` without using Chrome cookies, tokens, or profile files and was examined as inert text. File size: 5,626,375 bytes. SHA-256: `201fb21c65f909c07ca959dabe6ef7cda25297b73ba5118f600b1e41d3f958e1`. No target request was sent to any route below.

REA `analyze_javascript_application` was attempted on this bundle directory. Its retained parent Evidence ID is `ev_6430112e4adad7e455d0731e8b6d62bc26452ea2820bba86c47976eec6c3947d`. The worker exhausted its default ~1 GiB heap during static analysis of the 5.6 MB minified file; it parsed **zero** JavaScript files and produced no semantic route findings. This table therefore comes from a bounded literal-text scan and must **not** be attributed to a completed REA analysis. The bundle was not executed.

## Candidate route strings in request construction

The scan selected calls syntactically matching `Iy.get/post/put/delete(...)` where the immediate first argument contained a literal `/api/v2/` segment. `${...}` interpolation is shown as `{id}`. This does not identify the client library or prove that any code path executed. It misses computed routes, aliases, and other request clients.

| Static method | Candidate path | Evidence class |
| --- | --- | --- |
| GET | `/api/v2/assignments/{id}/export_csv` | Literal in frontend request construction; **not invoked** |
| POST | `/api/v2/organizations` | Same; code constructs an `organization` object with `name`, `tenant_id`, `kind` |
| POST | `/api/v2/locations` | Same; code constructs `organization_id` plus `location` fields including name/address/city/state/zip/year_built/latitude/longitude/heading |
| POST | `/api/v2/projects` | Same; code constructs `location_id` plus `project` fields `name`, `description`, `start_date`, `completion_date`, `status`, `capture_scope` |
| POST | `/api/v2/projects/create_bulk` | Same |
| POST | `/api/v2/assignment_responses/{id}/task_responses` | Same; code passes a `data` member whose runtime shape was not resolved |
| POST | `/api/v2/assignment_responses/{id}/import_workbook` | Same; static multipart construction visible; **not invoked** |
| POST | `/api/v2/locations/{id}/embeds` | Same |
| POST | `/api/v2/locations/{id}/raster_overlays/create_through_image` | Same |
| POST | `/api/v2/locations/{id}/copy` | Same |
| POST | `/api/v2/projects/{id}/copy` | Same |
| PUT | `/api/v2/locations/{id}/embeds/{id}` | Same |
| PUT | `/api/v2/projects/{id}` | Same |
| PUT | `/api/v2/panoramas/{id}` | Same |
| DELETE | `/api/v2/locations/{id}/embeds/{id}` | Same |
| DELETE | `/api/v2/projects/{id}` | Same |

Additional literal route families found by the same bounded scan include admin users, assignments CSV upload, HD photos, location copy jobs, organization settings/example images/query-tool actions, programs and program users, user photos, profile settings, account activation, videos, and assignment task-response deletion. These are code strings, not available-feature or permission claims. The bundle also contained `/api/v3/projects` and `/api/v5/projects` in code mentioning `projectKey`, notices, and query statistics; those were **excluded** from the target API inventory because they appear to belong to a bundled third-party library, not proven IDS routes.

## Interpretation limits

- No successful authenticated HTTP capture exists: host/base URL resolution, actual methods, status codes, response bodies, and schemas remain unverified.
- The table is not complete. In particular, the literal scan found only one `Iy.get` route; it cannot establish the absence of list/read endpoints.
- Code may be dormant, role-gated, obsolete, or bundled from another context. No mutation route was called or tested.
- Static payload field names above are observed code syntax, not confirmed server requirements or database columns.
- Do not use this file to generate requests against production, bypass permissions, or infer credentials. See [API_OBSERVATIONS.md](../API_OBSERVATIONS.md).
