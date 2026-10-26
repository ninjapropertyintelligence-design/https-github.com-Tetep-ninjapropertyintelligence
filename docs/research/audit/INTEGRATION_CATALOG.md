# Integration catalog — observed connections versus options

Scope: one authenticated Client A location, inspected 2026-10-20. [Evidence IDs](evidence/OBSERVATIONS.md) refer to read-only UI/DOM observations, **not** private API traffic. No credentials, signed values, or complete provider links are stored here.

| System | Verified connection at this location | What can be said about the backend | Remaining unknown |
| --- | --- | --- | --- |
| Matterport | `VR Showcase` opens iframe at `my.matterport.com/show/`; Matterport UI loads and navigates. [E-DT-01, E-DT-02](evidence/OBSERVATIONS.md) | Phygii supplies a browser-displayable embed URL or equivalent frame source. This is an inference from the rendered iframe, not an observed database/API contract. | Who creates the tour; whether ID is manually entered, imported, or synced; private/public model mode; SDK; OAuth; webhooks. |
| Potree + IDS S3 | `3D Model` opens Potree page on an IDS-named S3 host. [E-DT-03](evidence/OBSERVATIONS.md) | A hosted static viewer bundle and associated point-cloud content are browser-accessible in the observed session. | Source format, converter job, asset manifest, S3 policy, URL issuance, backend metadata. |
| Autodesk Viewer | `Revit Model` opens `viewer.autodesk.com` with opaque model/sheet reference. [E-DT-04](evidence/OBSERVATIONS.md) | Phygii can navigate the browser to an Autodesk-hosted viewer reference. | Autodesk Platform Services use, upload, translation, OAuth, ownership, permissions, link lifecycle. |
| IDS S3 image assets | Visible media thumbnails resolve to IDS-named S3 host; signed URL query keys observed only on two logo assets. [E-STORAGE-01](evidence/OBSERVATIONS.md) | Browser fetches assets from S3-origin host. | Public/private bucket, CDN, server proxy, authorization mechanism for other assets, upload pipeline. |
| Aerial/raster overlays | Catalog includes an Aerial default and plan rasters; Site 1 map shows the aerial layer with an Opacity control. [E-RASTER-01, E-MAP-05](evidence/OBSERVATIONS.md) | No provider or backend transport observed. Mapbox/OpenStreetMap/Maxar attribution identifies the basemap ecosystem, not the aerial-overlay source. | DroneDeploy connection, source survey system, georeferencing, tiling, export/ingestion process. |

**DroneDeploy status: Not Verified.** Neither the aerial label nor `.png.zip` overlay filenames identify DroneDeploy. IDS [public marketing](https://www.immersiondata.com/why-phygii) describes drone/reality-capture capabilities, but that also does not establish a DroneDeploy integration in this tenant. No DroneDeploy host, branding, link, or request was observed. [DroneDeploy's API-key guide](https://help.dronedeploy.com/hc/en-us/articles/1500004860561-REST-API-Key) and [Tile Template API guide](https://help.dronedeploy.com/hc/en-us/articles/1500004860601-REST-Tile-Template-API) are **independent design research only**; current vendor guidance favors GraphQL for most new uses and treats several REST paths as legacy. Do not use these as evidence of Phygii's endpoints.

IDS's [public technical article](https://www.immersiondata.com/resources/how-the-phygii-engine-works-a-technical-view-of-structured-property-intelligence) says external CMMS, ERP, and building-system integrations are expanding, while field/spatial capture and standardization are current strengths [P-IDS-01–02](evidence/PUBLIC_SOURCES.md). It does **not** identify a specific connected system for this tenant. The observed viewer embeds/links above should not be mistaken for enterprise data-sync integrations.

## Proposed independent connector pattern

1. Authorized tenant admin registers a provider connection through a server-side authorization flow or a supported provider share/embed mechanism; store only necessary encrypted provider credentials server-side. Do not scrape the user's current browser session.
2. Persist a neutral `spatial_assets` record: tenant, location, type, provider, display metadata, provenance, sensitivity, version, and provider reference. No frontend dependency on vendor-specific schema.
3. Server issues short-lived authorized view instructions or signed asset links after checking tenant/location scope; frontend uses an isolated provider adapter. Avoid exposing private provider tokens in URLs, logs, or analytics.
4. For uploads, queue validation, virus/media checks, conversion/tiling/thumbnail generation, and failure/retry states. Record source lineage and provider terms. This is a product proposal, **not** an observed IDS pipeline.
5. Define explicit connector tests: denied cross-tenant access, expired links, deleted/unavailable provider asset, partial conversion, duplicate import, schema changes, audit trail, and legal/licensing review.

Before implementing any specific provider, verify current vendor docs/terms and obtain the account owner's authorization. No integration has been configured by this investigation.
