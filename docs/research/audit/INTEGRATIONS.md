# Observed integrations and unverified connections

Updated 2026-10-20. [INTEGRATION_CATALOG.md](INTEGRATION_CATALOG.md) contains the fuller display-boundary analysis. **An external page or asset shown in the browser is not evidence of a server-to-server integration.**

| External or hosted service | Verified browser observation | Not established |
| --- | --- | --- |
| Matterport | `/show/` iframe displayed an interactive VR Showcase. [E-DT-02](evidence/OBSERVATIONS.md) | Import/sync API, account link, OAuth, webhook, backend credential storage. |
| Potree on IDS S3 | Potree viewer loaded from `ids-3dmodels-prod.s3.amazonaws.com`. [E-DT-03](evidence/OBSERVATIONS.md) | Conversion pipeline, source capture system, storage permission model. |
| Autodesk Viewer | External viewer tab displayed a Revit model. [E-DT-04](evidence/OBSERVATIONS.md) | Autodesk Platform Services or other backend API, file translation, permissions. |
| IDS S3 media | Rendered image thumbnails used an IDS-named S3 host. [E-STORAGE-01](evidence/OBSERVATIONS.md) | Bucket policy, upload endpoints, CDN, all-object access controls. |
| Mapbox/OpenStreetMap/Maxar | Attribution appeared on the map. [E-MAP-05](evidence/OBSERVATIONS.md) | Exact SDK, tile URLs, commercial account, aerial-layer supplier. |
| Analytics script references | Google Analytics/Tag Manager and LinkedIn Insight script tags appeared in DOM. [E-TECH-01](evidence/OBSERVATIONS.md) | Script execution, emitted events, recipient data, configuration. |
| krpano script reference | `/krpano/krpano.js` appeared in DOM. [E-TECH-01](evidence/OBSERVATIONS.md) | Whether the inspected 360 overlay uses krpano or what services it calls. |
| DroneDeploy | No host, branding, viewer, or request was observed in this audit. [E-RASTER-01, E-NET-00](evidence/OBSERVATIONS.md) | Any DroneDeploy connection. Aerial imagery alone is insufficient. |

No private backend integration call was captured. Public vendor documentation in [evidence/PUBLIC_SOURCES.md](evidence/PUBLIC_SOURCES.md) describes possibilities, not IDS tenant configuration.
