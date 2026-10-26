# Business rules — observed versus undecided

## Verified UI behavior

- Organization directory search matched tested fragments without case sensitivity; one surrounding-whitespace query did not match. This is observed example behavior, not a complete algorithm.
- Project directory status tabs divided the three visible Client A projects into Published (one) and Completed (two); New/In Progress had zero in the observed account.
- A map location selection opened a preview; Explore moved to its detailed map route. The detailed map categorized 305 visible media counts and offered filters/layers.
- The linked program route denied access. No rule explaining the denial was visible.
- The Locations page could show a load error and recover on reload; a load error must not be equated with zero locations.

## Inferences requiring independent product decisions

- Tenant membership probably scopes organizations and descendants, but actual target role rules are unobserved.
- Project status likely follows a lifecycle; allowed transitions and who can change them are unknown.
- Assignment Required/Repeatable/Completable flags likely affect response completion; actual validation and progress formulas are unknown.
- Media category counts may aggregate by type; uniqueness and deduplication were not verified.
- Collection privacy might affect visibility; nonempty examples and authorization effects were not observed.

For the original application, specify each rule with inputs, outputs, exceptions, and synthetic acceptance fixtures before implementation. Do not copy target-only names/identifiers or infer hidden behavior from disabled controls.
