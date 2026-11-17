# Page hierarchy — discovered, not exhaustive

Source: historical and live read-only Phygii UI observations from 2026-10-20, summarized in [PAGE_MAP.md](PAGE_MAP.md). An authenticated Chrome-extension connection is now working. URLs are UI routes, not API endpoints. Only the Client A organization was deeply explored beyond the global directory.

```text
Global header
├── Phygii logo → /tenants [destination not opened]
├── Help [clicked; destination/effect not verified]
├── two unlabeled icon buttons [not opened]
└── account menu
    ├── Profile → /profile
    │   ├── Details
    │   └── Settings → /profile?tab=settings
    └── Logout [not selected]

Organizations → /organizations
└── Client A → organization ID05
    ├── Overview → /organization/ID05 [main panel rendered blank]
    ├── Map → /organization/ID05/explore/map
    │   └── Site 1 Explore → /organization/ID05/explore/map/ID26
    │       └── View all media overlay → same route with ?ro=ID21
    ├── Locations → /organization/ID05/locations
    │   ├── Client A brand 1 350711, Site 1 → /organization/ID05/locations/ID26
    │   │   ├── Media
    │   │   ├── Projects
    │   │   ├── Raster Overlays
    │   │   ├── Vector Overlays
    │   │   ├── Assignments
    │   │   ├── 3D Embed
    │   │   ├── Info
    │   │   └── Collections
    │   ├── Client A brand 1 350796, Site 2 → /organization/ID05/locations/ID25 [eight tabs first-pass inspected]
    │   └── Client A brand 2 750067, Site 3 → /organization/ID05/locations/ID27 [eight tabs first-pass inspected]
    ├── Projects → /organization/ID05/projects
    │   ├── Completed Site 2 project → /organization/ID05/projects/ID28 [five tabs first-pass inspected]
    │   ├── Published Site 1 project → /organization/ID05/projects/ID29
    │   │   ├── Media
    │   │   ├── Users
    │   │   ├── Documents
    │   │   ├── Assignments
    │   │   │   └── Assignment 403 → /organization/ID05/projects/ID29/assignments/403
    │   │   │       ├── Assignment
    │   │   │       ├── Responses → Site 1 40655, Site 2 40654, Site 3 ID22
    │   │   │       │   ├── Task Responses
    │   │   │       │   └── Info
    │   │   │       └── Settings
    │   │   └── Collections [empty state first-pass inspected]
    │   └── Completed Site 3 project → /organization/ID05/projects/ID30 [five tabs first-pass inspected]
    ├── Collections → /organization/ID05/collections [empty]
    └── Linked Program → /organization/ID05/programs/ID06 [access denied]
```

Client B was opened briefly to verify keyboard navigation, but not audited. The remaining five organizations were listed but not opened. Do not infer identical modules, record counts, or permission sets for them. See [REVERSE_ENGINEERING_PROGRESS.md](REVERSE_ENGINEERING_PROGRESS.md) for coverage gaps.
