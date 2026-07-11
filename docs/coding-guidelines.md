# Coding Guidelines

Conventions **observed in the code** — not new rules. Follow these to keep new
code consistent with existing patterns.

## Language & modules

- **TypeScript strict + ESM.** `apps/backend/tsconfig.json`: `strict: true`,
  `module`/`moduleResolution: NodeNext`, `target: ES2022`, `outDir: dist`,
  `rootDir: src`. All packages are `"type": "module"`.
- **Explicit `.js` extensions** on relative imports (NodeNext requirement):
  `import { createDatabase } from "./db/index.js";`.
- Frontend `tsconfig.json` extends the generated `./.nuxt/tsconfig.json`.

## Backend layering (enforced by convention)

```
routes/  →  services/ (+ *-repository.ts)  →  db/schema.ts
             lib/ (pure helpers)   config/env.ts
```
Routes are thin Fastify plugins; they read dependencies off `fastify` (decorated
in `app.ts`) and never construct DB clients themselves.

## Dependency injection

Construct once in `buildApp` and `app.decorate("name", instance)`; declare the
decoration type in `types/fastify.d.ts`. Optional integrations are `null` when
their env is missing and routes guard on that (`503 *_NOT_CONFIGURED`).

## Validation

Zod at every boundary: environment (`config/env.ts` `envSchema`), request bodies
(`schemas/*.ts`, e.g. `importShopifyProductsSchema`), and even the OpenAI
response (`zodResponseFormat`). Parse at the edge, work with typed data inward.

## Errors

Throw `new AppError(statusCode, code, message)` (`lib/app-error.ts`). The single
handler in `app.ts` renders `{ error: { code, message } }`; `ZodError` becomes
`400 VALIDATION_ERROR`; unknown errors become `500`. Do not hand-roll error
responses in routes (internal routes are the exception — they `reply.status().send()`
explicit shapes because they predate/verify OIDC directly).

## Naming

- Files: kebab-case (`competitor-analysis-service.ts`, `nz-date-range.ts`).
- Classes: PascalCase (`DataForSeoService`, `ProductRepository`).
- DB columns: snake_case in SQL, camelCase in the Drizzle model (`schema.ts`).
- Shared helpers for repeated column shapes (`moneyColumn`, `shopifyId`).

## Lint (`apps/backend/eslint.config.mjs`, `apps/frontend/eslint.config.mjs`)

Flat config, `typescript-eslint` recommended. Unused args must be `_`-prefixed
(`argsIgnorePattern: '^_'`). `no-explicit-any` is disabled only under
`src/__tests__/`. Ignored: `dist/`, `node_modules/`, `drizzle/`. Run
`pnpm --filter <pkg> lint`.

## Logging

Fastify's Pino logger (`Fastify({ logger: true })`); use `request.log.info/warn/error`
with structured objects (`request.log.warn({ taskId, productId }, "...")`), as
webhook routes do. Some services also use `console.info` for pipeline counters
(`competitor-analysis-service.ts`).

## Frontend

Nuxt 4 file-based routing under `app/pages/`; `@nuxt/ui` components; shared types
in `shared/types/`; the global auth guard is `app/middleware/auth.global.ts`.
Diagrams in Markdown use **Mermaid** (per `CLAUDE.md`), never ASCII.

## Money & IDs

Money is `decimal(12,4)` in the DB and handled as numbers via Drizzle
`mode: "number"`; Shopify identifiers are unsigned `bigint`. Currency/price
formatting helpers live in `apps/frontend/app/utils/currency.ts`.
