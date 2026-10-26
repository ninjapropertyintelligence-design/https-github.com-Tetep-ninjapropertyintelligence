# Navigation map — accessible routes found so far

**Partially Verified; not a claim of product-wide completeness.** Routes are browser UI paths, never private API endpoints. The [original page map](PAGE_MAP.md) contains the route list and coverage details; this document groups them by navigation hierarchy and identifies missing audits.

```text
Global organization directory /organizations
└─ Client A /organization/ID05
   ├─ Map /organization/ID05/explore/map
   │  └─ Site 1 exploration /organization/ID05/explore/map/ID26
   ├─ Locations /organization/ID05/locations
   │  ├─ Site 1 /ID26 → Media, Projects, Raster Overlays, Vector Overlays,
   │  │                       Assignments, 3D Embed, Info, Collections
   │  ├─ Site 2 /ID25 → eight tabs read-only first pass
   │  └─ Site 3 /ID27 → eight tabs read-only first pass
   ├─ Projects /organization/ID05/projects
   │  ├─ Published Site 1 project /ID29 → Media, Users, Documents,
   │  │  Assignments, Collections
   │  │  └─ Assignment /403 → Assignment, Responses, Settings
   │  │     └─ Responses: Site 1 /40655, Site 2 /40654, Site 3 /ID22
   │  ├─ Completed Site 2 /ID28 → five tabs first-pass inspected
   │  └─ Completed Site 3 /ID30 → five tabs first-pass inspected
   └─ Collections /organization/ID05/collections → empty state observed
Account profile /profile → Details, Settings
Linked program /organization/ID05/programs/ID06 → access denied
Global logo /tenants → destination observed, not opened
```

Site 1's 3D Embed tab has three View paths—Matterport showcase, Potree point cloud, and Autodesk Viewer—and its Media tab has a native 360 gallery. These are **content viewers**, not additional sidebar routes. [E-DT-01–04, E-MEDIA-01–02](evidence/OBSERVATIONS.md)

Only one of seven listed organizations was materially audited. Other modules may be permission-dependent or undiscovered. Do not probe guessed IDs or bypass the denied program route. Second-pass coverage is tracked in [REVERSE_ENGINEERING_PROGRESS.md](REVERSE_ENGINEERING_PROGRESS.md).
