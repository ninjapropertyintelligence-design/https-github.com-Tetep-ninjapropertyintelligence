# Site 1 location — spatial media and viewers

Route: `/organization/ID05/locations/ID26` with Media, Raster Overlays, and 3D Embed tabs. Inspected 2026-10-20 in the authorized Chrome tab. **Partially Verified**: one location, one 360 image, all three listed 3D View actions; not a second-pass or network trace. [Evidence ledger](../evidence/OBSERVATIONS.md).

## 3D Embed list

Search `Search 3d embed`; range `1–3 of 3`; previous/next disabled at one page. Typing `Revit` narrowed the list to `1–1 of 1`; the visible × restored all three. Rows show name, Embed type, Level, date/time, and an unlabeled action button. The button opens View/Edit/Delete; only View was used. [E-DT-01, E-DT-05](../evidence/OBSERVATIONS.md).

| Row | Visible fields | View result | Unused actions |
| --- | --- | --- | --- |
| 3D Model | Type 3D Model; Level 1; 2/11/2026 9:35:57 AM | Phygii modal embeds IDS-S3-hosted Potree viewer. [E-DT-03](../evidence/OBSERVATIONS.md) | Edit, Delete. |
| 3DVR Tour | Type VR Showcase; Level 1; 2/11/2026 12:53:59 PM | Phygii modal embeds Matterport `/show/`. [E-DT-02](../evidence/OBSERVATIONS.md) | Edit, Delete. |
| Revit Model | Type Autodesk; Level 1; 2/18/2026 12:16:45 PM | Opens Autodesk Viewer in another tab. [E-DT-04](../evidence/OBSERVATIONS.md) | Edit, Delete. |

Search matching rules beyond this sample, row keyboard support, empty/error states, and menu permissions remain untested. Edit/Delete must not be explored on production without separate authorization.

## Matterport showcase

The embedded viewer exposed play, Dollhouse, Floor Plan, Explore 3D Space, Measurements, Share this Space, and Menu. Play, Floor Plan, Explore 3D Space, and Measurements were used to inspect display behavior; Measurements revealed Settings, Help, Close, Add measurement. Add measurement and Share were not used. Floor Plan rendered a top-down view; 3D Space showed an interior panorama. The outer Phygii dialog was closed afterward. [E-DT-02](../evidence/OBSERVATIONS.md). This supports an iframe display integration, **not** an observed Matterport SDK or backend sync.

## Potree point-cloud viewer

The embedded viewer loaded a visible point cloud. The Appearance panel exposed point budget (10,000,000 displayed), field of view (60 displayed), Eye-Dome-Lighting, background, splat quality, minimum node size, box/lock view. Other visible tools included point, angle, distance, height, area and volume measurement, height profile, clipping, camera projection and navigation views. This is a control inventory only; none of these tools was used to create a measurement. [E-DT-03](../evidence/OBSERVATIONS.md).

## Autodesk Viewer

The external viewer displayed a Revit `.rvt` model with 3D, Site Plan, Floor Plan, FFE Plan, Reflected Ceiling Plan, Roof Plan and Exterior Elevations in its view tree. Visible toolbar labels included Views, Model browser, Properties, Settings, Comments, Print, Screenshot, Share, Pan, Zoom, Orbit, 1st Person, Measure, Section, and Explode. These are Autodesk viewer controls; no Phygii feature equivalence or APS API call was established. The inspection tab was closed, leaving the original Phygii tab open. [E-DT-04](../evidence/OBSERVATIONS.md).

## Native 360 media

Media Type options were All, Project Photos, HD Images, and 360 Images. Deselecting All and choosing 360 Images filtered the grid to that group; All restored the original set. The first thumbnail opened a panorama overlay; its Info panel showed captured timestamp, Ground level, Exterior area, empty category, zero comments, View All Comments, and Create Comment. No comment was created. A canvas was present and no third-party iframe/provider label appeared. [E-MEDIA-01–02](../evidence/OBSERVATIONS.md). The rendered thumbnail host was IDS-named S3, but access policy is unknown. [E-STORAGE-01](../evidence/OBSERVATIONS.md).

## Raster catalog

`Search raster overlays` appears above six rows: Aerial 2-10-2026 (Default, Level Aerial), Site Plan (Ground), Floor Plan (Level 1), FFE Plan (Level 1), RCP (Level1 Above Ceiling), and Roof Plan (Roof). Rows show a file-like label and timestamp. Several filenames ended in `.png.zip`; contents were not downloaded. No DroneDeploy label or host was observed. [E-RASTER-01](../evidence/OBSERVATIONS.md).

On Map View, the `1 Layer` panel listed Aerial 2-10-2026 as a displayed layer; its gear panel offered Opacity with current value 1. The map also had an `Assets (0)` media-marker toggle. No opacity change, layer removal, or production edit was performed. These controls did not reveal the aerial imagery's upstream provider. [E-MAP-05](../evidence/OBSERVATIONS.md).

## Unresolved page-level behavior

Provider configuration, upload sources, access checks, iframe URL generation, model revision/version handling, map/raster display, cross-links between floor plans and 360 images, annotations/hotspots, and target API request/response structures remain **Not Verified**. See [integration catalog](../INTEGRATION_CATALOG.md) and [API analysis](../API_ANALYSIS.md). Inline screenshots are inventoried in [the manifest](../evidence/screenshots/MANIFEST.md); they are not durable local files.
