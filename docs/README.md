# Price Insight Documentation

Verified, code-derived reference for this repository. Where the top-level
`README.md` or `k8s/README.md` disagree with these documents, **the code (and
these docs) are authoritative** — the older prose is partly stale (see
`roadmap.md` / `../AI_CONTEXT.md`).

| Document | Covers |
|----------|--------|
| [architecture.md](architecture.md) | Runtime shape, the three Cloud Run services, and the three data pipelines |
| [repository-structure.md](repository-structure.md) | Monorepo layout, Turbo task graph, per-app directories |
| [database.md](database.md) | MySQL/Drizzle schema, connection, migration workflow |
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
