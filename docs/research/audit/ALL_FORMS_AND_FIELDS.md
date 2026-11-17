# Forms and fields register — partial

No production form was submitted. `Verified` here means visible and/or safe transient text entry, not validation or server persistence.

| Screen | Field/control | Type/default | Observed behavior / gap |
| --- | --- | --- | --- |
| Organizations | `Search organizations` | Text, blank | Search examples and clear state verified; see [ORG-006](features/organizations.md). |
| Organization map | `Search Locations` | Text, blank | Site 1 match and no-match tested. [Map](pages/organization-map.md) |
| Organization map | `Program Filter` | Selection, blank | One visible option `Refresh - Essential Program`; selected chip/clear observed. |
| Map filter chooser | Level, Area, Type, Category, Tag, Custom Metadata, Timeline | Expandable checkboxes/date range | Options inventoried; none applied. |
| Locations | `Search locations` | Text, blank | Site 2 match and no-match tested. [Locations](pages/locations.md) |
| Location Media | Flag, Media Type, Level, Area, Type, Category, Tag, Sort By, size slider | Dropdowns/slider; Tag disabled | Visible on Site 2/Site 3; options/combined semantics largely unknown. |
| Projects | `Search projects` | Text, blank | Visible; not submitted in live pass. [Projects](pages/projects.md) |
| Profile Settings | Password-change fields | Sensitive input | Historical visibility only; deliberately not focused, read, or filled. [DASHBOARD_FEATURES.md](DASHBOARD_FEATURES.md) |

Required/optional rules, max lengths, validation, save outcomes, error text, and role permissions are unknown unless explicitly stated in the linked records. Do not infer them from placeholders.
