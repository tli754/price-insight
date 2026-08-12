# Price Insight Documentation

Verified, code-derived reference for this repository. Where the top-level
`README.md` or `k8s/README.md` disagree with these documents, **the code (and
these docs) are authoritative** — the older prose is partly stale (see
`roadmap.md` / `../AI_CONTEXT.md`).

| Document | Covers |
|----------|--------|
| [architecture.md](architecture.md) | Runtime shape, the three Cloud Run services, and the three data pipelines |
| [architecture/](architecture/README.md) | Deep dives: layering conventions, current Postgres data model, pipeline sequence detail |
| [repository-structure.md](repository-structure.md) | Monorepo layout, Turbo task graph, per-app directories |
| [database.md](database.md) | MySQL/Drizzle schema, connection, migration workflow — **stale**: the backend migrated to Postgres/Supabase (`127639c9`); see [architecture/data-model.md](architecture/data-model.md) for current facts |
| [services.md](services.md) | Backend service & repository classes |
| [api.md](api.md) | HTTP routes, auth tiers, webhooks, internal endpoints |
| [deployment.md](deployment.md) | Build/Deploy workflows, migrate-before-traffic, rollback |
| [infrastructure.md](infrastructure.md) | Terraform: Cloud Run, LB, Cloud Armor, IAM, secrets |
| [coding-guidelines.md](coding-guidelines.md) | Conventions observed in the codebase |
| [integrations.md](integrations.md) | Shopify, DataForSEO, OpenAI, Cloud Tasks, Cloudflare |
| [testing.md](testing.md) | Vitest suites, helpers, coverage gaps |
| [development-workflow.md](development-workflow.md) | Local setup, commands, change process |
| [roadmap.md](roadmap.md) | Completed migrations + observable cleanup backlog |

See also `../AI_CONTEXT.md` for a single-file orientation.

## Task/plan/decision records

The Asked → Decided+Built chain, in-repo (git-tracked snapshot of the
canonical `~/workers/doc/{tasks,plans}` — see
`.claude/skills/planning/SKILL.md`'s "Decisions (ADRs) and the docs/
snapshot" section for the regeneration command and full explanation):

| Document | Covers |
|----------|--------|
| [execution-plans/tasks/](execution-plans/tasks/INDEX.md) | Raw task briefs — "Asked", preserved verbatim |
| [execution-plans/completed/](execution-plans/completed/INDEX.md) | Plan files — "Decided + Built" fused into one file per feature |
| [decisions/](decisions/TEMPLATE.md) | ADRs for foundational/cross-cutting decisions that outlive any single plan (e.g. `0001-mysql-to-supabase-postgres-migration.md`) |
| `contracts/active/`, `contracts/completed/` | Scaffolded, currently unused — price-insight's default workflow doesn't split "decided" into a separate contract file the way `docs/decisions/` and the plan file already cover it between them. Left in place in case a future feature's decision genuinely needs to be reviewed independently of its plan. |
