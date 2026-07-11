# External Integrations

Every external service the backend talks to, how it is wired, and the env/secrets
that gate it. Env is validated in `apps/backend/src/config/env.ts`; production
secrets come from Google Secret Manager (`infra/terraform/secrets.tf`).

## Shopify Admin API

- **Code:** `services/shopify-service.ts` (REST), `services/shopify-graphql-service.ts`
  (GraphQL), `lib/order-mapper.ts`, `lib/shopify-hmac.ts`.
- **Auth:** client-credentials exchange (`getAccessToken`) using
  `SHOPIFY_CLIENT_ID`/`SHOPIFY_CLIENT_SECRET` against `SHOPIFY_TOKEN_URL`.
- **Use:** product catalogue + inventory cost, and orders (REST list + GraphQL
  detail). Both services are `null` unless the `SHOPIFY_*` vars are all present;
  routes then return `503 SHOPIFY_NOT_CONFIGURED`.
- **Inbound:** `POST /webhooks/shopify/orders` verifies the Shopify HMAC
  (`lib/shopify-hmac.ts`) before enqueuing an order sync.

## DataForSEO

- **Code:** `services/dataforseo-service.ts`, `routes/dataforseo-webhook.ts`,
  `lib/competitor-filter.ts`.
- **Auth:** HTTP basic (`DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`).
- **Flow:** post Google Shopping / Product Info tasks with a **pingback URL**
  (`WEBHOOK_HOST` + `?secret=…&id=$id&tag=$tag`); results arrive as authenticated
  GET pingbacks whose `secret` is checked with `timingSafeEqual` against
  `DATAFORSEO_WEBHOOK_SECRET`. `location_code 2554`, `language_code en`, NZD-only,
  NZ/AU price-band filtering.
- **Why webhooks:** DataForSEO tasks are asynchronous; the pingback model avoids
  polling. On Cloud Run (scale-to-zero) the pingback re-wakes the backend.

## OpenAI

- **Code:** `services/ai-report-service.ts` (client built in `app.ts`).
- **Auth/config:** `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4.1-mini`).
- **Use:** `chat.completions.parse` with a Zod `response_format`
  (`zodResponseFormat(productAiReportsOutputSchema)`) — structured output, no free
  text. Inline `SYSTEM_PROMPT`; no prompt files.

## Google Cloud Tasks / Cloud Scheduler

- **Code:** `services/cloud-tasks-client.ts`, `services/cloud-tasks-competitor-client.ts`,
  `lib/verify-oidc.ts`; infra in `cloud-tasks.tf`, `service-accounts.tf`.
- **Auth:** the caller sets the task's `oidcToken.serviceAccountEmail` to the
  `invoker` SA; order-worker verifies the OIDC token (audience = request host).
- **Use:** decouple slow order sync and competitor-pingback processing from the
  request; Scheduler replaces the old in-process cron for daily discovery.
- **Optional locally:** clients are `null` when `CLOUD_TASKS_*` env is unset →
  webhooks and discovery run **inline** instead.

## Cloudflare (edge)

Not called from code, but part of the request path: DNS/proxy in front of the LB;
Cloud Armor (`cloud-armor.tf`) restricts the frontend origin to Cloudflare IP
ranges. Ranges are pinned in Terraform and must be updated if Cloudflare changes
them.

## Legacy / inactive integrations (present, not wired)

| Integration | Evidence | Status |
|-------------|----------|--------|
| SerpAPI | `services/serp-api-service.ts`, `SERPAPI_*` in `env.ts`, `backend-serpapi-api-key` secret | Not registered in `app.ts`; superseded by DataForSEO |
| Jina Reader | `packages/core/src/extractor/jinaReader.js`, `backend-jina-api-key` secret | Legacy extractor; unused by the apps |
| Google OAuth | `NUXT_OAUTH_GOOGLE_*` in `apps/frontend/.env.example`, README | **Not** in current code — auth is single shared password |

## Secrets → env mapping (production)

`cloud-run.tf` `backend_secret_env` maps GSM secrets to backend env vars
(`backend-mysql-*`, `backend-openai-*`, `backend-dataforseo-*`, `backend-shopify-*`,
`backend-session-secret`, `backend-dev-auth-password`, plus the legacy
`backend-jina-api-key`/`backend-serpapi-api-key`). order-worker gets only the
DB + Shopify subset (`order_worker_secret_env`).
