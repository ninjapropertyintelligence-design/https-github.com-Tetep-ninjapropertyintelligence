# Digital-twin viewers and backend boundary

Updated 2026-10-20. Detailed read-only controls are in [DIGITAL_TWIN_SPECIFICATION.md](DIGITAL_TWIN_SPECIFICATION.md). These findings establish **what the browser displayed**, not how IDS ingests, stores, authorizes, or synchronizes spatial data.

| Viewer or media | Verified display path | Backend connection status |
| --- | --- | --- |
| Matterport VR Showcase | Phygii modal contains a `my.matterport.com/show/` iframe; floor-plan and 3D-space modes loaded. [E-DT-02](evidence/OBSERVATIONS.md) | Embed/link display verified. Matterport API, SDK, private-model auth, webhooks, and sync **not verified**. |
| Potree point cloud | Phygii modal contains an IDS-named S3-hosted Potree viewer; navigation, appearance, clipping, and measurement controls visible. [E-DT-03](evidence/OBSERVATIONS.md) | Hosted viewer verified. Upload, conversion, point-cloud format, bucket policy, and metadata service **not verified**. |
| Autodesk Viewer | Revit Model opened a `viewer.autodesk.com` tab with model/sheets and viewer controls. [E-DT-04](evidence/OBSERVATIONS.md) | External viewer link verified. Autodesk Platform Services, translation/upload, OAuth, and sync **not verified**. |
| 360 image viewer | Phygii overlay rendered a panorama on canvas with Info and navigation; thumbnails were on an IDS-named S3 host. [E-MEDIA-01–02, E-STORAGE-01](evidence/OBSERVATIONS.md) | UI and asset origin verified. Rendering library, storage access policy, upload/processing pipeline **not verified**. |
| Raster overlay | Aerial/plan raster entries and a map opacity control visible. [E-RASTER-01, E-MAP-05](evidence/OBSERVATIONS.md) | Display verified. DroneDeploy or any other ingestion provider **not verified**. |

No viewer tool that would create measurements, annotations, comments, or shares was used. Opaque model IDs, complete provider URLs, signed query strings, and site images were not retained. See [INTEGRATIONS.md](INTEGRATIONS.md) for the evidence classification.
