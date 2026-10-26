# Backend and API observations

Updated 2026-10-20. **Audit only. No target backend request, response schema, or database table has been verified at runtime.** Static frontend code contains candidate `/api/v2/...` paths and methods, cataloged separately in [the bounded bundle scan](evidence/STATIC_BUNDLE_API_CANDIDATES.md); they are not captured traffic or proven live endpoints. The existing authenticated Chrome profile is controlled through the Codex extension for UI/DOM inspection. That connection does not expose a supported network recorder. REA browser capture needs a separate literal loopback CDP endpoint, which has not been available for this tab. Do not infer an API from an application page route or a viewer URL. [E-NET-00](evidence/OBSERVATIONS.md)

## Evidence boundary

| Evidence class | What was actually observed | Backend conclusion allowed |
| --- | --- | --- |
| Authenticated UI routes | Organization, location, project, assignment, and response pages contain numeric IDs; tab selection can appear in a query string. [API_ANALYSIS.md](API_ANALYSIS.md) | These are client-visible route identifiers. API paths, verbs, and authorization rules remain unknown. |
| UI relationships | Project headers link locations and programs; an assignment appears under multiple project cards, while response cards are project-specific. [E-PROJ-S2-01, E-PROJ-S3-01, E-ASG-RESP-01](evidence/OBSERVATIONS.md) | The application presents these relationships. Storage cardinality, joins, and service ownership remain unknown. |
| Counts and statuses | Assignment/response/task/image counters and statuses appear in rendered UI. [E-ASG-RESP-01–03, E-CLB-ASG-02](evidence/OBSERVATIONS.md) | Display values are verified; calculation algorithms and source fields are not. |
| Browser asset boundaries | Matterport iframe, IDS-hosted Potree viewer, Autodesk Viewer link, and S3-hosted thumbnails. [E-DT-02–04, E-STORAGE-01](evidence/OBSERVATIONS.md) | Browser display origins are verified; server-to-server synchronization, upload pipelines, credentials, and provider APIs are not. |
| Frontend script tags | `/runtime-config.js`, a hashed `/assets/index-*.js` bundle, `/krpano/krpano.js`, Google Analytics/Tag Manager, and LinkedIn Insight script references appeared in the authenticated page DOM. [E-TECH-01](evidence/OBSERVATIONS.md) | Script references show page loading intent; they do not prove execution, data transmission, API contracts, or backend technologies. |
| Static bundle request construction | The current public JS bundle contains literal `Iy.post/put/delete/get` call sites with `/api/v2/...` path strings and selected payload field names. [E-JS-01](evidence/OBSERVATIONS.md) | Candidate client code only. No call was executed; server support, authorization, response contract, and code-path reachability remain unverified. |

## Request/response evidence status

| Question | Status | Reason |
| --- | --- | --- |
| Same-origin API host/base path | Unknown at runtime | Bundle has `/api/v2` path candidates, but no request metadata or resolved host captured. |
| HTTP methods, URL patterns, status codes | Static method/path candidates only; runtime unknown | No request metadata captured. |
| Request/response field names and types | Unknown | No sanitized body/schema capture. |
| Authentication and tenant-scoping implementation | Unknown | No headers, cookies, tokens, or backend policy inspected; permission-denied UI is not a policy specification. |
| Pagination/filter transport | Unknown | UI controls observed; client-side versus server-side behavior unverified. |
| Media upload, conversion, and spatial-provider sync | Unknown | Only read-only rendered assets/viewers observed. |
| Database engine, schema, queues, object metadata | Unknown | No private backend source or database access supplied. |

## Safe route to stronger evidence

Use only a supported inspector attached to this **same authorized Chrome profile/tab**, or a vendor-provided API specification. For a narrow read-only action, retain only timestamp, page/action label, same-origin method and path with sensitive query values removed, status, content type, and redacted JSON field **names/types** if permitted. Exclude all request/response header values, cookies, bearer tokens, signed URLs, private answer values, contacts, and raw payloads. Do not replay requests or test unauthorized IDs. Record tool/source, capture window, and limits for every finding. Until such evidence exists, [API_ENDPOINT_CATALOG.md](API_ENDPOINT_CATALOG.md) remains a list of runtime questions, not confirmed endpoints. Static candidates are [here](evidence/STATIC_BUNDLE_API_CANDIDATES.md).
