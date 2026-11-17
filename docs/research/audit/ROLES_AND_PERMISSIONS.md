# Roles and permissions — observations versus proposed controls

## Verified target observations

- The signed-in account could view `/organizations`, open Client A and Client B organization maps, and navigate Client A location/project/collection pages and profile surfaces.
- The visible Program link to `/organization/ID05/programs/ID06` previously produced `You do not have access to that page.` This demonstrates at least one permission boundary for this account, but not the rule or role causing it.
- Some controls appeared disabled (for example, assignment Edit); their disabled state does not prove an underlying role policy. Upload, delete, report generation, sign-out, and form submission were not exercised.
- No other account or role was tested. The target's role names, tenant-membership model, and authorization implementation are unknown.

## Independent application proposal

Begin with least-privilege capabilities such as `organization.read`, `location.read`, `project.read`, `media.read`, `assignment.read`, `response.read`, `document.read`, and separate write/manage capabilities. Product stakeholders must define actual roles and who may receive each capability; the visible UI does not justify copying a guessed role hierarchy. Every resource lookup must scope by authorized organization, and a hidden button must never be the only enforcement. Default-deny cross-tenant access; test direct deep links, list queries, object storage reads, and all mutations. RLS should bind resources to membership and explicit capability checks, not merely the `authenticated` database role ([Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)).

Do not import target users, credentials, permissions, or protected program data into the new application without separate authorization.
