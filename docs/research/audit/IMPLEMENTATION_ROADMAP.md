# Independent implementation roadmap — proposal, not authorization to code

This plan assumes an original Next.js/TypeScript/Tailwind/Supabase product. It is conditional on resolving the evidence gaps and product decisions in [UNVERIFIED_AND_MISSING_FEATURES.md](UNVERIFIED_AND_MISSING_FEATURES.md). No implementation has begun.

| Stage | Scope / deliverables | Dependencies and verification gate | Rough complexity |
| --- | --- | --- | --- |
| 0. Product contract | Decide tenant roles, entities, status transitions, media rights, retention, required workflows, representative synthetic fixtures | Stakeholder approval; permission model documented | Medium |
| 1. Secure foundation | App shell, auth, memberships, RLS, storage policies, audit events, CI/test harness | Cross-tenant and direct-ID denial tests pass | High |
| 2. Read-only directories | Organizations, locations, projects; search/status/empty/error/loading/pagination | Typed API contract and fixture tests; accessible responsive shell | Medium |
| 3. Maps and media | Provider/licensing selection, clustering, previews, layers, gallery, filters, thumbnail pipeline | Map performance and private-object access tests | High |
| 4. Project workspaces | Project detail, documents/versions, assignment tree, response display | Approved data model and progress formulas | High |
| 5. Authorized write workflows | Uploads, edits, responses, reports, collections | Separate product approval, validation, audit, staging tests | Very high |
| 6. Hardening | Accessibility, responsive layouts, observability, security review, migrations, load tests | Full QA matrix and no critical tenant leaks | High |

Effort cannot be responsibly estimated in person-weeks from UI observation alone: media scale, number of roles, reporting rules, integration needs, and hidden workflows remain unknown. The stage-level complexity is a planning heuristic only. See [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md), [DATA_MODEL_PROPOSAL.md](DATA_MODEL_PROPOSAL.md), and [QA_TEST_CASES.md](QA_TEST_CASES.md).
