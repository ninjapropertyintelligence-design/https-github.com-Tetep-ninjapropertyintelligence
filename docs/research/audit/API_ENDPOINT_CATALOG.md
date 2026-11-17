# Observable API endpoint catalog

**No target API endpoint has been verified through runtime traffic.** The authenticated Chrome extension supports UI automation but not a supported network capture in this task; REA browser capture requires a loopback CDP endpoint not available for this user tab. A bounded static scan of the current public frontend bundle found candidate method/path strings and payload field names, cataloged in [STATIC_BUNDLE_API_CANDIDATES.md](evidence/STATIC_BUNDLE_API_CANDIDATES.md). Those strings are not confirmed server behavior. No response schema, status code, or cache behavior is asserted here. UI routes in [PAGE_MAP.md](PAGE_MAP.md) must not be mistaken for API paths.

| UI operation | Candidate read-only request to inspect later | Target method/path/shape |
| --- | --- | --- |
| Open organizations directory | List authorized organizations | Unknown |
| Search organization/location/project | Filter list | Unknown; server-vs-client unknown |
| Open map/location detail | Read location, markers, media, layers | Unknown |
| Open project/assignment/response | Read detail and children | Unknown |
| Open media gallery | Read media metadata/thumbnail URLs | Unknown |
| View Matterport, Potree, or Autodesk spatial asset | Resolve authorized display instruction/reference, if any | Unknown; only rendered iframe/link origins observed [E-DT-02–04](evidence/OBSERVATIONS.md) |
| Open raster overlay | Read layer metadata and possibly map imagery | Unknown; aerial catalog does not prove DroneDeploy [E-RASTER-01](evidence/OBSERVATIONS.md) |

Future capture protocol: remain in the user's authorized tab, collect only same-origin method/path/status/content type and redacted field **names/types** where permitted, never headers/cookies/tokens/private values, and never replay or synthesize state-changing requests. Do not infer backend contracts from visible route IDs. See [API_ANALYSIS.md](API_ANALYSIS.md).
