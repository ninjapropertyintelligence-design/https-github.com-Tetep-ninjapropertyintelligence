# Phygii network shapes (sanitized)

Observed in the user's existing signed-in Chrome tab with DevTools Network on 2026-10-20. The six pages below were previously visited through the dashboard; this pass did not enumerate IDs or tenants. DevTools was filtered to **Fetch/XHR** for app calls. This is runtime evidence of responses, **not** a database schema or an exhaustive HAR. No request was replayed or modified. No header contents, response values, customer records, URL IDs, full URLs, cookies, or tokens are retained here.

Notation: `string`, `number`, `boolean`, `object`, and `array<T>` describe observed JSON values. `null` means the sampled value was null; its non-null type is **UNKNOWN**. `array<UNKNOWN>` means the sampled array was empty or its elements were not exposed. These shapes do not establish which fields are required or nullable for other records.

The observed first-party data endpoint was the API host `graphql.immersiondata.com` (hostname only). Its inspected calls used **POST**, path **`/`**, **no query parameter names**, and returned **200**. The operation is therefore distinguished below by its *response root*, not by a different URL path. The listed statuses apply to the inspected calls; responses not fully accessible in DevTools are marked **UNKNOWN**. An authentication-related `token` request and unrelated analytics/error-reporting requests also appeared, but their bodies were intentionally not inspected.

## 1. Organizations

| Method | Path | Query parameter names | Status | Observed response root |
| --- | --- | --- | --- | --- |
| POST | `/` | None | 200 | `data.me` |
| POST | `/` | None | 200 | `data.tenantBySubdomain` |
| POST | `/` | None | 200 | `data.organizations` |

```text
data.me: object { id: string, firstName: string, lastName: string }
data.tenantBySubdomain: object {
  myUserRole: string, myPermissions: object {}, id: string,
  name: string, subdomain: string,
  logo: object { height: null, width: null, name: null, url: string }
}
data.organizations: object {
  edges: array<object> [{
    cursor: string,
    node: object { name: string, id: string, kind: string,
                   isActive: boolean, myUserRole: string }
  }]
}
```

**UNKNOWN:** Other pagination fields, fields not selected by these GraphQL operations, and types behind sampled null/empty objects.

## 2. Locations

| Method | Path | Query parameter names | Status | Observed response root |
| --- | --- | --- | --- | --- |
| POST | `/` | None | 200 | `data.me`, `data.organization.tenant`, `data.tenantBySubdomain` |
| POST | `/` | None | 200 | `data.organization` (permissions and score variants) |
| POST | `/` | None | 200 | `data.organizations.totalCount` |
| POST | `/` | None | 200 | `data.locations.edges` |

```text
data.organization.tenant: object { subdomain: string }
data.organization: object {
  name: string, id: string, isActive: boolean, myUserRole: string,
  myPermissions: object {
    read: array<string>, create: array<string>,
    update: array<string>, delete: array<string>
  },
  matterportPrivateModels: boolean, mapFilterMenuDisplay: string,
  logo: object { url: string }
}
data.organization (separate score response): object {
  phygiiScore: string, portfolioLocationsCount: string,
  phygiiComponentScores: object {
    completeness: number, currency: number, fidelity: number
  }
}
data.organizations: object { totalCount: number }
data.locations: object {
  edges: array<object> [{
    cursor: string,
    node: object {
      id: string, name: string,
      address: object { streetLine1: string, city: string,
                        state: string, postalCode: string },
      phygiiScore: null, lastCapturedAt: string
    }
  }]
}
```

The `me` and `tenantBySubdomain` shapes matched the Organizations section. **UNKNOWN:** Non-null type of `phygiiScore`, other location fields, and any fields absent from this operation's selection set.

## 3. Location Media tab — “Flagged” filter applied

The location's **MEDIA** tab was opened and its **Flag → Flagged** option applied. In an isolated capture of that filter action, **no Phygii GraphQL Fetch/XHR call** appeared; the observed Fetch/XHRs were unrelated analytics. This supports only that this particular filter action did not fetch new app data in the sampled session. The page-load calls below were inspected separately; they are not claimed to have been caused by the filter.

| Method | Path | Query parameter names | Status | Observed response root |
| --- | --- | --- | --- | --- |
| POST | `/` | None | 200 | `data.location` (summary, detail, videos) |
| POST | `/` | None | 200 | `data.image.reps` |
| POST | `/` | None | 200 | Unwrapped image-metadata objects (field names below) |

```text
data.location (summary): object { id: string, name: string }
data.location (detail): object {
  id: string, name: string,
  address: object { streetLine1: string, city: string,
                    state: string, postalCode: string },
  position: object { latitude: number, longitude: number },
  heading: number,
  metadataTypes: array<object> [{
    type: string,
    values: array<object> [{ id: string, name: string }]
  }],
  assignableCustomFields: array<UNKNOWN>,
  phygiiScore: null, lastCapturedAt: string,
  phygiiComponentScores: object {
    completeness: null, currency: null, fidelity: null
  }
}
data.location.videos: object { edges: array<UNKNOWN> }
data.image.reps: array<object> [{ url: string, name: string }]

Unwrapped sampled metadata object: object {
  author: object { id: string },
  metadata: array<object> [{ type: string, id: string, value: string }],
  customFieldMetadata: array<UNKNOWN>, flagged: boolean,
  position: object { heading: number }
}
Another unwrapped metadata object additionally exposed
  capturedAt: string, published: boolean.
```

Repeated `data.image.reps` calls had the same sampled shape. **UNKNOWN:** Why some metadata responses appeared unwrapped, video-edge element type, empty custom-field element type, filter behavior on other locations, and any fields not selected by these operations.

## 4. Project

| Method | Path | Query parameter names | Status | Observed response root |
| --- | --- | --- | --- | --- |
| POST | `/` | None | 200 | `data.project` (summary, detail, videos) |
| POST | `/` | None | 200 | `data.organization` (score), `data.image.reps` |

```text
data.project (summary): object { id: string, locationId: string, name: string }
data.project (detail): object {
  id: string, name: string, description: string, status: string,
  startDate: string, completionDate: string, programId: string,
  location: object {
    id: string, name: string,
    metadataTypes: array<object> [{
      type: string,
      values: array<object> [{ id: string, name: string }]
    }],
    assignableCustomFields: array<UNKNOWN>
  },
  program: object { name: string }
}
data.project.videos: object { edges: array<UNKNOWN> }
data.image.reps: array<object> [{ url: string, name: string }]
```

The score response matched the Locations score fragment. Repeated image-representation and metadata responses also appeared. **UNKNOWN:** Non-empty video/custom-field element types and fields not selected by the observed Project operations.

## 5. Assignment

| Method | Path | Query parameter names | Status | Observed response root |
| --- | --- | --- | --- | --- |
| POST | `/` | None | 200 | `data.assignment` (small summary) |
| POST | `/` | None | 200 | `data.organization` (permissions/score) |
| POST | `/` | None | 200 | Large assignment response; complete shape **UNKNOWN** |

```text
data.assignment (small summary): object { id: string, title: string }
data.organization: object {
  name: string, id: string, isActive: boolean, myUserRole: string,
  myPermissions: object {
    read: array<string>, create: array<string>,
    update: array<string>, delete: array<string>
  },
  matterportPrivateModels: boolean, mapFilterMenuDisplay: string,
  logo: object { url: string }
}
```

The separate organization score response matched Locations. **UNKNOWN:** The large assignment body's complete nested task/question structure. DevTools' accessible response text remained incomplete even in compact view; no body was copied/exported to work around that limit.

## 6. Response

| Method | Path | Query parameter names | Status | Observed response root |
| --- | --- | --- | --- | --- |
| POST | `/` | None | 200 | `data.assignmentResponse` (summary and detail) |
| POST | `/` | None | 200 | `data.assignmentTaskResponse` |
| POST | `/` | None | 200 | `data.location.metadataTypes` |
| POST | `/` | None | 200 | Large additional response; complete shape **UNKNOWN** |

```text
data.assignmentResponse (summary): object { id: string }
data.assignmentResponse (detail): object {
  id: string,
  project: object {
    id: string, name: string, locationId: string,
    location: object { id: string, name: string }
  },
  status: string, createdAt: string, updatedAt: string,
  startsAt: null, endsAt: null,
  taskStatuses: array<object> [{ taskId: string, completed: boolean }]
}
data.assignmentTaskResponse: object {
  guid: string,
  metadata: array<object> [{ id: string, type: string, value: string }],
  target: object {
    targetType: string, coordinates: null,
    objectMappingTree: object { title: string }
  },
  assignmentAnswers: object {
    edges: array<object> [{
      node: object {
        id: string, questionId: string, createdAt: string,
        updatedAt: string, answerText: string,
        answerPhotoType: null, answerPhoto: null, uuid: string
      }
    }]
  },
  creator: object { id: string, firstName: string, lastName: string },
  user: object { id: string, firstName: string, lastName: string }
}
data.location.metadataTypes: array<object> [{
  type: string,
  values: array<object> [{ id: string, name: string }]
}]
```

An additional sampled JSON response contained `errorMessage: null`; its operation/purpose is **UNKNOWN**. The organization permissions response matched Assignment. **UNKNOWN:** The complete large response body, non-null types behind sampled null fields, and unselected fields.

## Cross-page checks

- **`/runtime-config.js` setting names:** `window.runtimeConfig` defined `apiBaseUrl`, `platformGraphQLBaseUrl`, `phygitalTwinGraphQLBaseUrl`, `viewerBaseUrl`, `keycloakUrl`, `explorerKeycloakClientId`, `phygiiKeycloakClientId`, `phygiiHostname`, `explorerHostname`, `mapboxToken`, `mapboxStyleUrl`, `mapboxStyleShowRoadsAtZoom`, `rasterOverlayResizeSize`, and `airbrakeEnvironment`. Values were not retained. The script request showed status **200**; its method was not separately inspected (**UNKNOWN**).
- **Authentication transport:** An inspected GraphQL request had an **Authorization: Bearer** header. Header value was not retained. Whether any cookie also participates in authentication is **UNKNOWN**; the `token` request was deliberately not opened.
- **Photo URL expiry:** In the sampled Media load, some JPEG image requests had an expiry query parameter and other JPEG image requests did not. Only presence/absence was recorded; URL paths, query values, and signature material were not retained. Whether every photo class uses the same URL policy is **UNKNOWN**.
- **WebSocket/EventSource:** The DevTools **Socket** filter showed zero requests in the sampled Media and Response captures, and no `eventsource` request type appeared in their all-types lists. Thus **none was observed in those captures**. Other pages/times and background reconnection behavior are **UNKNOWN**.
- **Ancillary traffic:** An auth-related `token` request plus telemetry/error-reporting requests were visible. Their response bodies, header values, and customer data were not inspected. Their complete method/path/query/status/shape inventories are **UNKNOWN**, intentionally.