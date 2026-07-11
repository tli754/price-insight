# Roadmap

The repository does not contain an authoritative product roadmap. `README.md`
lists a "Planned" feature set, but that file is **stale** in other respects
(it describes GKE/Redis/Google-OAuth/SerpAPI, none of which match current code),
so its forward-looking items are treated as **indicative only**, not verified
commitments.

This document instead records what is **observable** in the repo: the migration
already completed, and the cleanup implied by leftover code.

## Completed direction (evidenced by code)

- **GKE → Cloud Run.** Live infra is Terraform + Cloud Run (`infra/terraform/`);
  `k8s/` is legacy. Terraform comments reference the migration
  (`cloud-run.tf`, `cloud-tasks.tf`).
- **Redis/BullMQ → Cloud Tasks + Cloud Scheduler.** No Redis/BullMQ in code;
  `cloud-tasks.tf` says the queue "mirrors today's BullMQ defaultJobOptions."
- **SerpAPI → DataForSEO.** DataForSEO is the wired competitor source; SerpAPI
  code remains but is unused.
- **Google OAuth → single-password auth.** `routes/auth.ts` + `auth.global.ts`.

## Observable cleanup backlog (technical debt)

These are concrete, low-risk follow-ups visible in the tree today:

| Item | Evidence |
|------|----------|
| Update or replace stale `README.md` | describes GKE/Redis/OAuth/SerpAPI/port 3001/`codex-review.yml`/`.ai/tasks` |
| Remove legacy `k8s/` tree (incl. `k8s/redis/`) + `k8s/README.md` | superseded by Cloud Run + Terraform |
| Remove SerpAPI dead code | `services/serp-api-service.ts`, `scripts/investigate-serp.ts`, `__tests__/serp-api-service.test.ts` |
| Remove core extractor dead code | `packages/core/src/extractor/*` (`jinaReader.js`) |
| Drop unused env/secrets | `SERPAPI_*` in `config/env.ts`; `backend-jina-api-key`, `backend-serpapi-api-key`, `gateway_secrets` in Terraform |
| Fix stale `apps/frontend/.env.example` | still lists `NUXT_OAUTH_GOOGLE_*`/`NUXT_SESSION_PASSWORD` |
| Refresh stale Terraform comment | `cloud-run.tf` "BullMQ/node-cron … PR 4 hasn't shipped" |
| Consider consolidating duplicate endpoints | `POST /api/products/import` vs `/api/products/sync` |
| Consider unifying price analysis | `packages/core/src/core.js` vs `apps/backend/src/lib/price-analysis.ts` |

## Indicative future features (from `README.md`, unverified)

Listed for context only; not confirmed by code:
- Historical price trend tracking & charting
- Price alert notifications (email / webhook)
- Multi-store / multi-brand support
- Bulk product import & competitor-mapping UI
- Margin optimisation recommendations

## Unknown

- Prioritisation, owners, and timelines for any of the above — not present in the
  repository.
- Whether the "MCP knowledge server" implied by a task filename is planned — no
  corresponding code, config, or task body exists in the repo.
