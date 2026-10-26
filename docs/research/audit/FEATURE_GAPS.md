# Feature gaps and next evidence

This file expands the [earlier gap register](UNVERIFIED_AND_MISSING_FEATURES.md). **Not observed is not absent.** Coverage/status details are in [REVERSE_ENGINEERING_PROGRESS.md](REVERSE_ENGINEERING_PROGRESS.md).

| Priority | Client B | Current status | Safe next step |
| --- | --- | --- | --- |
| High | Backend/API calls and response structures for all modules | Not Verified [E-NET-00](evidence/OBSERVATIONS.md) | Use a supported same-profile, scoped network inspector if available; record only redacted method/path/status/field names. Do not export session data. |
| High | Matterport tour provenance, private-link mode, SDK/API, update sync | Not Verified [E-DT-02](evidence/OBSERVATIONS.md) | Read authorized product settings or vendor documentation; do not infer from iframe. |
| High | Potree point-cloud import/conversion, format, storage policy | Not Verified [E-DT-03](evidence/OBSERVATIONS.md) | Inspect authorized upload documentation or safe UI metadata; no uploads to production. |
| High | Autodesk model handoff and APS/backend relationship | Not Verified [E-DT-04](evidence/OBSERVATIONS.md) | Inspect authorized configuration/help; avoid copying opaque viewer references. |
| High | DroneDeploy or other drone provider integration | **Not Verified** [E-RASTER-01](evidence/OBSERVATIONS.md) | Seek explicit provider label/authorized integration settings or redacted network metadata; aerial image alone is insufficient. |
| High | Structured Location → Building → Area → Asset → System records | Partially Verified for location/level/area labels and `Assets (0)` map marker category only [E-MAP-05](evidence/OBSERVATIONS.md) | Read-only navigation/search for actual record pages; do not assume public marketing mirrors schema. |
| Medium | Native 360 viewer library, hotspot/pin linking, comparison/annotation persistence | Partially Verified for panorama display [E-MEDIA-02](evidence/OBSERVATIONS.md) | Inspect safe viewer controls and labels across more examples; no comment/annotation creation. |
| Medium | Inspection rules, reports, asset/maintenance/AI/analytics modules | Assignment's 27-task/54-question template structure verified; response progress observed; save/validation/report and other modules Not Verified | Look for accessible read-only settings/help; no report generation or production writes. |
| Medium | Other organizations, location tabs, hidden menus | Three current-organization project details first-pass inspected; other organizations and some location states remain partial | Audit visible links one module at a time, respecting permission boundaries. |
| Medium | Global assignment/response breadcrumb reliability | One not-found route observed [E-NAV-01](evidence/OBSERVATIONS.md) | Re-test read-only in a stable session and compare project-scoped link; do not infer backend error. |
| Medium | Durable, sanitized screenshots | Not Verified as local files | Use supported export only; review private site/model imagery before sharing. |

The Program page is **Not Accessible** in the observed account. No bypass is planned. The expanded mission is ongoing; none of these gaps should be silently converted into product requirements.
