# Client A map and location exploration

Observed live in the authenticated user's Chrome tab on 2026-10-20. Evidence markers `UI-LIVE-MAP` and `SS-MAP-*` refer to visible DOM/screenshot states in this Codex task, not REA Evidence IDs or durable image files. No production records were edited.

## Organization map — `/organization/ID05/explore/map`

- Satellite-style map with Mapbox, OpenStreetMap, and Maxar attribution, zoom controls, marker clusters, and a right-side location drawer. The exact map SDK and tile contract were not inspected.
- The drawer showed `Showing 3 Locations`: Client A brand 1 ID36 (Site 2, <state>), Client A brand 1 ID35 (Site 1, <state>), and Client A brand 2 ID37 (Site 3, <state>), each with a street/city address.
- `Search Locations` filtered the list as typed: `Park` showed one Site 1 row, while `no-such-location-xyz` showed `Showing 0 Locations` and `There were no results matching your search.` The URL stayed on the map. Whether matching is server-side or client-side is unknown.
- `Program Filter` offered one observed option, `Refresh - Essential Program`. Selecting it rendered a selected chip and retained all three listed locations; `Clear` removed the chip. We did not establish whether all three locations belong to that program or whether the filter affects map markers differently.
- Selecting the Site 1 row opened a map preview with its name/address and an `Explore` action. The route did not change until `Explore` was clicked.

## Selected location map — `/organization/ID05/explore/map/ID26`

- `Explore` navigated to the location-specific map, centered on Site 1, and displayed a location drawer. The drawer linked `Location #ID26` to `/organization/ID05/locations/ID26`.
- Summary tabs: `1 Project`, `305 Media`, `1 Layer`, `0 Filters`.
- Media tab displayed checked marker-category toggles: HD Images (27), Project Photos (196), 360 Images (79), Project Videos (0), Video Embeds (0), 3D Models (2), 3DVR Tours (1), Custom Embeds (0), Points of Interest (0), Areas of Interest (0), Assets (0). These category counts add to 305, but whether every item is unique or included in the gallery was not verified. Unchecking/rechecking HD Images changed its checkbox state and restored it. Map marker-count changes were not measured.
- Project tab showed `2026 Essential Solution` / `Full Capture` under an expanded Projects group, with a checkbox. It was not toggled.
- Layer tab showed `Aerial 2-10-2026` plus `Add Layers` and `Clear Layers`. Neither action was used.
- Filter tab showed `There are currently no filters applied`, `Add Filters`, and `Clear Filters`. `Add Filters` opened a chooser with Level, Area, Type, Category, Tag, Custom Metadata, and Timeline. No filter was applied.
- Level choices: Ground, Level 1, Roof, Aerial. Area: Interior, Exterior. Type: Inspection. Category: HVAC, Electrical, Cabling Racks, Fire Extinguishers, Gas Meter, Electric Meter, Thermostats, Cases, Reach in - MT, Reach in - Frozen, Interior Lighting, Exterior Lighting, Cabinets, Gas Dispensers. Tag reported no tags. Custom Metadata reported no custom metadata. Timeline offered date grouping and a two-handle slider with visible dates from 02/05/2026 to 04/17/2026. Exact filtering semantics remain untested.
- The map exposed controls with tooltips `Center map on location`, `Don't follow media`, `Filter for flagged items`, and `Decluster`; their effects were not tested.
- `View all media` opened a gallery overlay on the same location-map route with query `?ro=ID21`. It showed thumbnails and selectors for Flag, Level, Area, Type, Category, Tag (disabled), and Sort By (default `Media Type`), plus a thumbnail-size slider. We closed the gallery without opening or editing any media item. The meaning of `ro` is unknown.

## Evidence and gaps

`SS-MAP-001` shows the three-location map; `SS-MAP-002` the selected-location media drawer; `SS-MAP-003` the filter chooser; `SS-MAP-004` the gallery overlay. These were captured inline only. No sanitized network capture or durable image export was available. We did not test project/layer/filter application, marker clicks, geolocation, error states, responsive map layout, or permission differences.
