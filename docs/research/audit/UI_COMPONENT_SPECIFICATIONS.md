# UI component catalog — partial, evidence-based

Live evidence is linked by page dossier; component names below are labels for an original design system, not evidence of the target's source-code component tree. Measurements are limited to observed screenshots and DOM; precise design tokens require a separate visual audit.

| Component | Observed appearance/behavior | State gaps / independent design notes |
| --- | --- | --- |
| Global header | Dark navy bar, Phygii logo, Help, two icon/badge controls, account menu `<user initials>` | Icon effects and accessibility labels unknown; new app should label every control. [Organizations](pages/organizations.md) |
| Organization sidebar | Expanded left rail with organization logo/context and Explore/Manage groups; icon-only at 600px and after toggle | Exact breakpoint/width not measured; links must remain keyboard accessible. [Organizations](features/organizations.md) |
| Searchable list card | White surface; input at top; duplicated range/pagination above/below rows; hover/focus not fully measured | Provide explicit loading, error, empty, result states. [Locations](pages/locations.md), [Projects](pages/projects.md) |
| Status tabs | All/New/In Progress/Published/Completed above project list | Count/empty states observed; focus and responsive behavior unverified. [Projects](pages/projects.md) |
| Location map/drawer | Satellite map, clustered markers, white right drawer with search/list or location details | Map implementation/provider not established. [Map](pages/organization-map.md) |
| Filter chooser | Popover with expandable Level/Area/Type/Category/Tag/Custom Metadata/Timeline groups | Option semantics and applied-filter behavior unverified. [Map](pages/organization-map.md) |
| Media gallery | Overlay with thumbnail grid, seven selectors, sort, size slider | Item detail/edit flow unverified; use licensed original content. [Map](pages/organization-map.md) |
| Empty/error alert | `No ... match your search`, `No collections`, and `Locations could not be loaded` observed | Distinguish network error from zero results. [Locations](pages/locations.md) |

Live DOM included `Mui...` class names, which supports a Material UI-style component-library inference but does not establish exact package/version or proprietary source structure. Original implementation may use Tailwind and accessible primitives without copying target markup/assets.
