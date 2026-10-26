# Modals, popovers, alerts, and progress states — partial

| Surface | Trigger / exact observed content | Outcome / gap |
| --- | --- | --- |
| Account menu | Click account button → Profile, Logout | Escape dismissed; Logout not selected. |
| Map location preview | Click Site 1 location row → name/address and Explore | Explore navigated to location map. |
| Add Filters popover | Click `Add Filters` on location map → seven expandable groups | Options inspected; no filter applied. |
| All-media gallery overlay | Click `View all media` → thumbnails and filter/sort/size controls | Closed without opening an item. |
| Organization no-match alert | Search absent term → `No organizations match your search` | Clear restored rows. |
| Map no-match alert | Search absent term → `There were no results matching your search.` | Changing query restored row. |
| Location no-match alert | Search absent term → `No locations match your search` | Changing query restored row. |
| Location load error | After loading indicators → `Locations could not be loaded` | One normal reload recovered three rows; cause unknown. |
| Project empty alert | New or In Progress tab → `No projects match your search` | Blank query; not a verified search fault. |
| Program access denial | Historical linked program visit → `You do not have access to that page.` | Boundary respected; no bypass. |
| Loading | `LoadingLogo`, progressbar on page transitions; two inline progress indicators on location list | Durations/timeout rules unknown. |

No confirmation dialog for destructive actions was opened. Success toasts and network error formats outside the one location failure are unverified.
