# Plan: Implement Click-Triggered OpenAI Product Reports Stored in Database

## Environment
- Worker repo: /srv/price-insight
- Current branch: feature/load_orders
- Coordination repo: /srv/price-insight

## Source Task File
- Task file: task-08062026-openai-product-reports.md

## Task Summary

Add a manually triggered AI report feature to the product detail page. Users click "Generate AI Report" to call the backend, which gathers product/competitor/sales data, sanitises PII, calls OpenAI, validates the structured response, persists it to a new `product_ai_reports` table, and returns it to the frontend. Page load fetches the latest saved report only — no OpenAI call on load.

Four report types:
1. Pricing Recommendation
2. Competitor Match Quality
3. Sales Trend Summary
4. Product Listing Improvement

---

## Files Inspected

- `apps/backend/src/db/schema.ts` — Drizzle schema: MySQL, `int` ids, no existing `json` columns
- `apps/backend/src/config/env.ts` — `OPENAI_API_KEY` + `OPENAI_MODEL` already configured, Zod-validated
- `apps/backend/src/app.ts` — service construction + Fastify decoration pattern
- `apps/backend/src/types/fastify.d.ts` — typed Fastify instance interface
- `apps/backend/src/routes/products.ts` — product routes, `parseProductId` helper, AppError pattern
- `apps/backend/src/routes/analysis.ts` — competitor routes: confirms route/service/repo pattern
- `apps/backend/src/services/product-repository.ts` — constructor injection, Drizzle query style
- `apps/backend/src/services/order-repository.ts` — `getProductSalesHistory` returns PII (customerFirstName/lastName in line items — must be stripped)
- `apps/backend/src/__tests__/helpers/build-app.ts` — test helper: `vi.fn()` stubs, `makeXxx()` factories
- `apps/backend/src/__tests__/products.test.ts` — test pattern: `buildTestApp`, `app.inject()`
- `apps/backend/drizzle/meta/_journal.json` — next migration index: **0005**
- `apps/backend/package.json` — `openai@^5.1.0`, `zod@^3.24.4` already installed
- `apps/frontend/app/pages/products/[id].vue` — product detail page with useFetch + $fetch patterns
- `apps/frontend/shared/types/competitor.ts`, `product.ts` — frontend shared type patterns
- `apps/frontend/nuxt.config.ts` — `/api/**` proxied to backend via `NUXT_GATEWAY_URL`

---

## Affected Apps / Packages

- `apps/backend` — DB schema, migration, new service, new repository, new routes, tests
- `apps/frontend` — new shared types, updated product detail page

---

## Proposed Files to Change

### New files
| File | Purpose |
|------|---------|
| `apps/backend/src/db/schema.ts` | Add `productAiReports` table |
| `apps/backend/drizzle/0005_product_ai_reports.sql` | Migration SQL |
| `apps/backend/drizzle/meta/0005_snapshot.json` | Drizzle snapshot (generated) |
| `apps/backend/src/services/ai-report-repository.ts` | DB reads/writes for `product_ai_reports` |
| `apps/backend/src/services/ai-report-service.ts` | Payload builder + OpenAI call + validation |
| `apps/backend/src/routes/reports.ts` | Two new endpoints: GET latest, POST generate |
| `apps/backend/src/__tests__/ai-report.test.ts` | Route + service tests |

### Modified files
| File | Change |
|------|--------|
| `apps/backend/src/app.ts` | Construct + decorate `aiReportRepository`, `aiReportService`; register `reportRoutes` |
| `apps/backend/src/types/fastify.d.ts` | Add `aiReportRepository`, `aiReportService` to interface |
| `apps/backend/src/__tests__/helpers/build-app.ts` | Add `makeAiReportRepository()`, `makeAiReportService()` factories |
| `apps/frontend/shared/types/ai-report.ts` | New file: all AI report TypeScript types |
| `apps/frontend/app/pages/products/[id].vue` | Add AI report panel: useFetch for latest, $fetch for generate |

---

## Existing Patterns Found

1. **Service pattern**: Class with `constructor(private db: Database)`, exported as named class.
2. **Fastify decoration**: `app.decorate("serviceName", instance)` in `app.ts`; typed in `fastify.d.ts`.
3. **Route pattern**: `FastifyPluginAsync`, `parseProductId` helper reused, `AppError` for errors.
4. **DB schema**: `int().autoincrement().primaryKey()`, camelCase Drizzle columns → snake_case SQL. No `json` columns exist yet but `json` is importable from `drizzle-orm/mysql-core`.
5. **Migration**: `db:generate` produces numbered SQL + snapshot. Next is `0005`.
6. **Test pattern**: `makeXxx()` factory → `vi.fn()` stubs → `buildTestApp({ xRepository })` → `app.inject()`.
7. **Zod**: Used for env validation and request body validation. Will use for OpenAI response validation.
8. **OpenAI SDK v5**: `openai@^5.1.0` — uses `client.responses.parse()` with `json_schema` structured output or `client.chat.completions.create()` with `response_format: { type: "json_object" }`.

---

## Implementation Plan

### Step 1 — Database schema + migration

Add `productAiReports` table to `schema.ts`:

```ts
export const productAiReports = mysqlTable(
  "product_ai_reports",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).notNull(), // 'pending' | 'success' | 'failed'
    model: varchar("model", { length: 100 }).notNull(),
    reportTypes: json("report_types").notNull(), // string[]
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    inputSnapshot: json("input_snapshot"),
    output: json("output"),
    errorMessage: text("error_message"),
    generatedBy: varchar("generated_by", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => ({
    productCreatedIdx: index("idx_product_ai_reports_product_created").on(table.productId, table.createdAt),
    productStatusIdx: index("idx_product_ai_reports_product_status").on(table.productId, table.status),
    inputHashIdx: index("idx_product_ai_reports_input_hash").on(table.inputHash),
  })
);
```

Run `pnpm --filter @price-insight/backend db:generate` to produce `0005_product_ai_reports.sql`.

### Step 2 — AiReportRepository

```ts
class AiReportRepository {
  constructor(private db: Database) {}
  async getLatestSuccessful(productId: number): Promise<ProductAiReportRow | null>
  async insert(data: NewProductAiReportRow): Promise<number>  // returns id
  async updateCompleted(id: number, status: 'success' | 'failed', output: unknown, errorMessage: string | null, completedAt: Date): Promise<void>
}
```

### Step 3 — AiReportService

```ts
class AiReportService {
  constructor(
    private aiReportRepository: AiReportRepository,
    private productRepository: ProductRepository,
    private competitorRepository: CompetitorRepository,
    private orderRepository: OrderRepository,
    private openai: OpenAI,
    private model: string
  ) {}

  async getLatestReport(productId: number): Promise<ProductAiReportRow | null>
  async generateReport(productId: number, reportTypes: ReportType[]): Promise<ProductAiReportRow>
  private buildPayload(product, competitors, salesHistory): SanitizedAiPayload  // strips PII
  private callOpenAI(payload): Promise<ProductAiReportsOutput>
  private validateResponse(raw: unknown): ProductAiReportsOutput  // Zod schema
}
```

**PII stripping rule**: `buildPayload` must NOT include customer names, emails, phones, or addresses. Sales line items sent to OpenAI should only contain: `{ date, qty, unitPrice, financialStatus }` — no customer fields.

**Input hash**: SHA-256 of the sanitized JSON payload for deduplication awareness (not blocking, just stored).

### Step 4 — Report routes

New file `routes/reports.ts`:

```
GET  /api/products/:id/reports/ai/latest  → aiReportService.getLatestReport(id)
POST /api/products/:id/reports/ai         → aiReportService.generateReport(id, body.reports)
```

Register in `app.ts` under `/api` prefix.

### Step 5 — Prompt file

Add `prompts/ai-reports-system.md` and `prompts/ai-reports-user.md` following existing pattern in `/prompts/`.

### Step 6 — Frontend shared types

New file `apps/frontend/shared/types/ai-report.ts` with all report output interfaces.

### Step 7 — Product detail page AI panel

Add to `apps/frontend/app/pages/products/[id].vue`:

- `useFetch` on load: `GET /api/products/:id/reports/ai/latest`
- `$fetch` on button click: `POST /api/products/:id/reports/ai`
- AI report UCard with:
  - Loading / error state
  - Generate / Refresh button
  - Four report sections (collapsible or tabs)
  - Generated timestamp

Placement: after the Competitor Products card, before Sales History.

---

## Risks / Edge Cases

1. **OpenAI response validation failure** — Zod parse can fail. Service must save `failed` status record with error message; route returns the failed record. Product page must not break.
2. **Large product pages** — If competitor + sales data is large, the prompt payload may hit token limits. Payload builder should limit: max 20 competitor records, max 12 monthly buckets, max 50 anonymised order lines.
3. **Missing data** — Products with no competitors or no sales should still work; AI returns `INSUFFICIENT_DATA` for those report types.
4. **OpenAI SDK v5 structured output** — Need to verify whether `client.responses.parse()` or `client.chat.completions.create()` is the right entrypoint in v5. The existing env has `OPENAI_MODEL=gpt-4.1-mini`; structured output (`json_schema`) is supported on gpt-4.1 family.
5. **Concurrent clicks** — Two rapid button clicks could generate two simultaneous records. Acceptable for first version; add debounce on frontend.
6. **Long generation time** — OpenAI calls can take 5-30s. Frontend must show loading state and not timeout.
7. **`json` Drizzle column** — Not currently used in schema; import `json` from `drizzle-orm/mysql-core`. MySQL 5.7+ required (already satisfied if current schema runs fine).

---

## Database Impact

- New table: `product_ai_reports`
- New migration: `drizzle/0005_product_ai_reports.sql`
- Foreign key: `product_id → products.id ON DELETE CASCADE`
- Three indexes: `(product_id, created_at)`, `(product_id, status)`, `(input_hash)`
- No changes to existing tables

---

## API Impact

Two new endpoints added to existing product route namespace:

```
GET  /api/products/:id/reports/ai/latest
POST /api/products/:id/reports/ai
```

No changes to existing endpoints.

---

## UI Impact

- Product detail page (`/products/:id`) gains an **AI Insights** card between Competitor Products and Sales History
- Generate/Refresh button, loading state, error state, four report sections
- No other pages affected

---

## Infrastructure / Config Impact

- `OPENAI_API_KEY` already configured
- `OPENAI_MODEL` already configured (default `gpt-4.1-mini`)
- No new env vars needed
- No deployment config changes

---

## Dependency Impact

- `openai@^5.1.0` — already installed, no install needed
- `zod@^3.24.4` — already installed
- No new dependencies

---

## Test Plan

### Backend tests (`apps/backend/src/__tests__/ai-report.test.ts`)

- `GET /api/products/:id/reports/ai/latest` returns `{ report: null }` when no report exists
- `GET /api/products/:id/reports/ai/latest` returns latest `success` report
- `GET /api/products/:id/reports/ai/latest` returns 404 when product not found
- `POST /api/products/:id/reports/ai` calls aiReportService.generateReport
- `POST /api/products/:id/reports/ai` returns 404 when product not found
- `POST /api/products/:id/reports/ai` returns 400 for invalid product id
- `AiReportService.buildPayload` strips customer PII from sales line items
- `AiReportService.validateResponse` rejects malformed OpenAI output

### Validation commands

```bash
pnpm --filter @price-insight/backend db:generate
pnpm turbo typecheck --filter=@price-insight/backend
pnpm turbo test --filter=@price-insight/backend
pnpm turbo typecheck --filter=@price-insight/frontend
```

---

## Approval Status
APPROVED TO IMPLEMENT — 2026-06-08

## Implementation Notes

- Migration generated as `0005_flat_mister_sinister.sql` (Drizzle auto-names)
- `json` column type added to Drizzle schema imports (first use in this project)
- `buildPayload` verified to strip `customerFirstName`, `customerLastName`, `orderId`, `orderNumber` from order lines before sending to OpenAI
- Pre-existing lint error `suggestedCompetitors is assigned but never used` in `[id].vue` fixed as part of file edit
- 14 new backend tests, all passing
- 6 pre-existing test failures in `competitor-analysis-service.test.ts` and `product-repository.test.ts` — not caused by these changes
- Frontend lint: 0 errors (28 pre-existing warnings, all unrelated)
- Backend TypeScript build: clean
