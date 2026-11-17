# Digital twin and spatial-media specification — observed scope

Status: **Partially Verified**. Evidence is for one accessible location, not all IDS tenants or the entire Phygii product. Direct evidence IDs are in [the observation ledger](evidence/OBSERVATIONS.md). Public vendor documentation is explicitly separate below. No application code has been written.

## Distinct viewer types

| Surface | Direct behavior | Data boundary visible to browser | Confidence |
| --- | --- | --- | --- |
| Phygii Media → 360 Images | Filter to category, thumbnail grid, double-click opens exterior panorama with Info metadata and adjacent-image navigation. A canvas renders inside a Phygii overlay. [E-MEDIA-01, E-MEDIA-02](evidence/OBSERVATIONS.md) | Media thumbnails came from an IDS-named S3 host in the observed DOM. [E-STORAGE-01](evidence/OBSERVATIONS.md) | Verified for this sample; library/backend unknown. |
| 3D Embed → VR Showcase | View opens a Phygii modal wrapping a Matterport `/show/` iframe. Floor Plan and Explore 3D Space worked; Measurements mode opened with Add measurement. [E-DT-01, E-DT-02](evidence/OBSERVATIONS.md) | `my.matterport.com` is a third-party display boundary. | Verified embed/provider; creation, sync, and API arrangement unknown. |
| 3D Embed → 3D Model | View opens embedded Potree point-cloud viewer; appearance, clipping, navigation, measurement and profiling tools are visible. [E-DT-01, E-DT-03](evidence/OBSERVATIONS.md) | Potree page loads from `ids-3dmodels-prod.s3.amazonaws.com`. | Verified viewer/hosting origin; ingestion and access-control model unknown. |
| 3D Embed → Revit Model | View opens Autodesk Viewer in a new tab with a 3D view and named plan/elevation sheets. [E-DT-01, E-DT-04](evidence/OBSERVATIONS.md) | `viewer.autodesk.com`; opaque model/sheet references withheld. | Verified external viewer link; APS/backend integration unknown. |
| Raster Overlays | Location lists aerial and plan layers, including an Aerial default, with several `.png.zip` filenames. [E-RASTER-01](evidence/OBSERVATIONS.md) | No provider or transfer method shown. | Verified catalog labels; DroneDeploy **not verified**. |

### Confirmed interaction inventory

- Matterport: initial play, Floor Plan radio, Explore 3D Space radio, and Measurements mode were used for viewing. The mode exposed Settings, Help, Close, and Add measurement. Add measurement, Share, and Menu were **not** used. Dollhouse was listed but not opened. [E-DT-02](evidence/OBSERVATIONS.md)
- Potree: Appearance showed point budget, field of view, Eye-Dome-Lighting, background and rendering controls. Tool groups visibly included point/angle/distance/height/area/volume measurement, height profile, clipping, and camera/navigation options. Tool results and persistence were not tested. [E-DT-03](evidence/OBSERVATIONS.md)
- Autodesk: visible View tree, Model browser, Properties, Settings, Comments, Print, Screenshot, Share, Pan, Zoom, Orbit, 1st Person, Measure, Section, and Explode. These are viewer capabilities, **not** evidence of corresponding Phygii backend features. No state-changing tool was used. [E-DT-04](evidence/OBSERVATIONS.md)
- Phygii 360 overlay: Info showed captured date, level, area, category, comment count, View All Comments, and Create Comment. No comment was created. [E-MEDIA-02](evidence/OBSERVATIONS.md)

### Independent product requirements to validate

Design each spatial asset as a typed record attached to an authorized organization/location, with an explicit provider/display mode: native 360 media, third-party tour embed, point-cloud viewer bundle, external BIM model, or raster overlay. Store display metadata separately from provider credentials; never place long-lived provider secrets or privileged storage credentials in the browser. Design per-type loading, permission-denied, expired-link, empty, and unavailable-provider states. Give 360 media accessible alternatives and keyboard navigation. Scope every asset read to tenant membership and location permission. These are **proposed requirements**, not findings about Phygii internals.

Unknowns requiring authorized evidence: capture-device/source provenance; tour-to-location/room mapping; hotspots and asset pins; annotation persistence; 360 viewer library; point-cloud source format and conversion; overlay georeferencing/tiling; cross-view linking; comparison mode; spatial search; API methods and schemas. None should be declared implemented in the target because a checklist mentions them.

## Independent public references (not target evidence)

[Matterport's Embed SDK quickstart](https://matterport.github.io/developer-docs/embed-sdk/quickstart/) documents an iframe-based integration and optional SDK controls; the observed iframe does **not** prove SDK use. [Matterport's private-model embed guide](https://matterport.github.io/developer-docs/oauth/private-model-embed/) is relevant if a new app needs non-public models. [Potree's getting-started guide](https://potree.github.io/getting_started.html) documents browser point-cloud rendering from hosted converted data. [Autodesk's Viewer tutorial](https://get-started.aps.autodesk.com/tutorials/simple-viewer/viewer/) describes a possible custom-viewer approach; it does not describe the observed Phygii implementation.
