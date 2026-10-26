# Phygii API analysis — evidence and gaps

Inspection date: 2026-10-20. **No authenticated API request or response body was captured.** The user's intended Chrome profile is now connected through the Codex extension with Playwright-style UI automation, but this interface has not exposed a supported network-inspection or loopback CDP endpoint. An earlier native DevTools attempt switched profile focus unexpectedly, so it was not repeated. No cookies, tokens, authorization headers, or browser-profile data were copied or saved. A later inert scan of the publicly retrievable current frontend bundle found candidate `/api/v2/...` request-construction strings; see [static candidates](evidence/STATIC_BUNDLE_API_CANDIDATES.md). Those are **not** runtime network evidence.

A read-only check of the supported tab evaluation surface also did not expose Resource Timing (`performance`) for this page. No request URL or payload was collected through that route. This is a tooling limitation, not evidence that the dashboard makes no API calls.

## Verified browser-level observations

| Observation | What it supports | What it does **not** establish |
| --- | --- | --- |
| UI paths under `app.phygii.ai/organization/...` | Client-visible routing structure | API base URL, HTTP verbs, or backend resource names |
| `?tab=settings` and other tab query parameters | Some tab state is represented in the URL | Whether tab changes issue network requests |
| Search/filter/pagination controls | The UI can express list queries | Query parameter names, server-side vs client-side filtering |
| Project, assignment, response IDs in links | Stable-looking UI identifiers | Database schema, ID type, or authorization semantics |
| Assignment `403` linked from three project cards; response list shows three project-specific records | UI exposes a cross-project assignment/response relationship | Join-table design, ownership, reuse implementation, or endpoint contract |
| Service-worker registration shown in DevTools | A service worker is registered for the site | Cache policy, offline support, or PWA functionality |
| Map attributions | Mapbox/OpenStreetMap/Maxar content is displayed | Exact tile endpoints, SDK, paid plan, or map data contract |
| Matterport `/show/` iframe, Potree S3-hosted frame, Autodesk Viewer link | Viewer origin/display boundary for three spatial assets at one location; see [evidence ledger](evidence/OBSERVATIONS.md) | Target API calls, server-to-server sync, OAuth, provider SDK, or database schema |
| IDS S3 media-image host | Browser asset origin for visible thumbnails | Upload API, bucket policy, whether all media are public/private |
| Aerial raster catalog | A named layer and several `.png.zip` display filenames | DroneDeploy connection, storage format, raster transformation pipeline |

## UI-derived resource model — **hypothesis, not an observed API schema**

The interface suggests these independent-app entities and relationships:

```text
Organization ──< Location ──< Project
                             Project ── Assignment (association/cardinality unknown)
                             Assignment ──< Response (each displayed with a project)
                               │              ├──< Section ──< Task ──< Question
                               ├──< Document   └──< Task Response / Answer
                               ├──< Media
                               └──< Collection links
Location ──< Raster Overlay / Vector Overlay / 3D Embed
```

Visible UI fields include status, title, location, date range, category, version count, task completion counts, image counts, and geographic coordinates. These are display-level observations only. Field names, nullability, pagination envelope, error format, authorization rules, and mutation behavior are **unknown**.

## Request/response inventory

| Candidate operation for an independent app | Observed Phygii method/path? | Observed response shape? |
| --- | --- | --- |
| List organizations, locations, projects, collections | No | No |
| Read location/project/assignment/response detail | No | No |
| Search/filter/paginate lists | No | No |
| Fetch media, overlays, documents, versions, embeds | No | No |
| Read or update profile/settings | No | No |
| Upload media/documents or generate report | Deliberately not exercised | No |

Do not treat route names or the hypothesized model as discovered API contracts. For actual network evidence, use a supported inspector scoped to this same authenticated tab or a vendor-provided API description. Record only method, same-origin path, status, content type, and **redacted field names/types**; do not collect request headers, cookies, tokens, personal answer values, or raw private payloads. Do not replay state-changing requests.

The current Chrome-extension connection supports UI/DOM automation, not authenticated request/response inspection. REA's browser recorder requires loopback CDP, which is not connected to this profile. Accordingly, the integration findings in [INTEGRATION_CATALOG.md](INTEGRATION_CATALOG.md) are rendered-browser evidence only; **zero endpoints or response structures are confirmed by observed traffic**. Static candidate paths do not change that limit.
