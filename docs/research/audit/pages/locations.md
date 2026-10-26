# Client A locations — live first-pass dossier

Observed read-only in the authenticated Chrome tab on 2026-10-20. Route `/organization/ID05/locations`. Coverage is partial; no network requests or response bodies were captured.

## Directory

The page has a breadcrumb to the organization, heading `Locations`, `Search locations`, and duplicated top/bottom range and previous/next controls. A successful load showed `1–3 of 3`; both page buttons were disabled. Three rows were visible:

| Location | Visible address | Detail route |
| --- | --- | --- |
| Client A brand 1 ID35 - Site 1, <state> | <street address>, Site 1, <state> | `/organization/ID05/locations/ID26` |
| Client A brand 1 ID36 - Site 2, <state> | <street address>, Site 2, <state> | `/organization/ID05/locations/ID25` |
| Client A brand 2 ID37 - Site 3, <state> | <street address>, Site 3, <state> | `/organization/ID05/locations/ID27` |

`Site 2` search reduced the list to the one Site 2 row with `1–1 of 1`. `no-such-location-xyz` gave `No locations match your search` and `0–0 of 0`. Search did not change the route. The text-match algorithm, pagination beyond one page, and server-vs-client filtering were not verified.

On the first visit, a loading state with two progress indicators and `0–0 of 0` was followed by `Locations could not be loaded`. One ordinary page reload showed the three rows. This is an observed recoverable load failure, not evidence of an empty dataset or a known root cause.

## Site 2 detail — `/organization/ID05/locations/ID25`

The route loaded after a `LoadingLogo`/progressbar. It showed the name/address, `Map View` link to `/organization/ID05/explore/map/ID25`, and tabs Media, Projects, Raster Overlays, Vector Overlays, Assignments, 3D Embed, Info, Collections. The Media tab displayed Flag, Media Type, Level, Area, Type, Category, Tag (disabled), Sort By, thumbnail-size slider, and Upload; Upload was not used. The Projects tab showed one Completed `2026 Essential Solution` / `Full Capture` project linking to `/organization/ID05/projects/ID28`. Raster Overlays showed six entries including Aerial, Site Plan, Floor Plan, FFE Plan, RCP, Roof Plan. Vector Overlays and Assignments showed empty states. 3D Embed listed a 3D Model, 3DVR Tour, and Revit Model. Info displayed latitude, longitude, and heading; precise coordinates are intentionally omitted from this summary. Collections showed no collections, with Search, Privacy, Creator, and Sort by controls.

## Site 3 detail — `/organization/ID05/locations/ID27`

The page opened read-only with the Site 3 name/address, `Map View` link to `/organization/ID05/explore/map/ID27`, and the same eight named tabs as Site 2. The default Media tab showed photo thumbnails and the same visible filter/size/Upload controls. The Projects tab, after settling, showed one Completed `2026 Essential Solution` / `Full Capture` project linking to `/organization/ID05/projects/ID30`. Other Site 3 tabs have not been audited.

Tab data sometimes arrived one UI update after the selected-tab highlight; the facts above were attributed to their controls only after the next snapshot. These tabs need deliberate per-tab second passes, screenshots, interactions, and individual feature records before this page can be called complete.
