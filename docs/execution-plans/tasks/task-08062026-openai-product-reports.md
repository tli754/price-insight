# Task: Implement Click-Triggered OpenAI Product Reports Stored in Database

## Context

Price Insight product detail pages already show product metadata, competitor products, competitor price charts, sales history, product images, and description.

We need to implement four AI-generated product reports using the OpenAI API:

1. Pricing recommendation
2. Competitor match quality
3. Sales trend summary
4. Product listing improvement

The feature must be triggered manually from the product detail page by a button click. Generated reports must be persisted to the database so users can view previous/latest reports without calling OpenAI every time the page loads.

Important workflow rules:

- Investigation before implementation.
- No coding until Tony approves the investigation plan.
- Small focused changes.
- No production secret changes.
- No deployment config changes without approval.
- Workers must explain planned changes before editing code.
- Frontend must never call OpenAI directly.
- OpenAI calls must happen in the backend only.
- Reports must not send customer personal information to OpenAI.

---

## Phase 1 — Investigation Only

Start with investigation only. Do not edit implementation files.

### Required startup steps

1. Run the normal startup check for the worker.
2. Read the latest task file from `~/workers/doc/tasks` unless Tony gives a specific task filename.
3. Create or update a plan file in `~/workers/doc/plans`.
4. Inspect the repository structure.
5. Identify affected apps/packages.
6. Identify current product detail page route/component.
7. Identify current product detail page data loading flow.
8. Identify current backend endpoints for product details, competitors, and sales history.
9. Identify existing database schema/migration pattern.
10. Identify existing Drizzle ORM conventions.
11. Identify existing OpenAI integration, if any.
12. Identify existing environment variable conventions.
13. Identify existing frontend API/composable conventions.
14. Identify existing testing patterns.

### Do not do in Phase 1

- Do not edit source files.
- Do not edit test files.
- Do not add dependencies.
- Do not run migrations.
- Do not change environment files.
- Do not change deployment configuration.
- Do not call the OpenAI API using production data.

### Phase 1 output required

Return an investigation summary with:

- Files inspected
- Existing product detail page flow
- Existing backend data flow
- Existing database/migration conventions
- Proposed database table design
- Proposed backend API design
- Proposed frontend UI placement
- Proposed OpenAI request/response schema
- Risks
- Test impact
- Validation commands
- Any missing data fields
- Estimated complexity

End Phase 1 with:

```text
Waiting for Tony approval.
```

---

## Feature Goal

Add a manually triggered AI report feature to the product detail page.

User flow:

1. User opens a product detail page.
2. Page loads product data and the latest saved AI report, if one exists.
3. User clicks a button such as **Generate AI Report** or **Refresh AI Report**.
4. Frontend calls backend endpoint.
5. Backend gathers product, competitor, sales, and listing data.
6. Backend removes customer PII and prepares compact AI payload.
7. Backend calls OpenAI API.
8. Backend validates structured JSON response.
9. Backend stores report output in the database.
10. Frontend displays the saved/generated report on the product detail page.

Reports to generate:

1. Pricing recommendation
2. Competitor match quality
3. Sales trend summary
4. Product listing improvement

---

## Required Behaviour

### Triggering

Reports must only be generated when the user clicks a button on the product detail page.

Do not call OpenAI automatically on page load.

Page load should only fetch existing saved reports from the backend/database.

### Persistence

Generated reports must be saved to the database.

The product detail page should show the latest saved report for the product.

When the user clicks refresh/generate again, create a new report record or update according to the approved design.

Preferred first implementation:

- Save each generation as a report snapshot/history record.
- Show the latest successful report on the product detail page.
- Keep previous reports available in the database for future audit/history, even if no UI history view is built yet.

If the existing project pattern strongly favours update-in-place instead of snapshots, explain this in investigation before implementation.

---

## Proposed Database Design

Investigate existing naming conventions before implementing.

Suggested table:

```ts
type ProductAiReportRecord = {
  id: number;
  productId: number;
  status: 'pending' | 'success' | 'failed';
  model: string;
  reportTypes: string[]; // pricing, competitorMatch, salesTrend, listingImprovement
  inputHash: string;
  inputSnapshot: unknown; // sanitized payload only, no customer PII
  output: ProductAiReportsOutput | null;
  errorMessage: string | null;
  generatedBy: string | null; // nullable for now if no user auth identity is available
  createdAt: Date;
  completedAt: Date | null;
};
```

Possible SQL table name:

```text
product_ai_reports
```

Suggested columns:

```text
id BIGINT PRIMARY KEY AUTO_INCREMENT
product_id BIGINT NOT NULL
status VARCHAR(20) NOT NULL
model VARCHAR(100) NOT NULL
report_types JSON NOT NULL
input_hash VARCHAR(64) NOT NULL
input_snapshot JSON NULL
output JSON NULL
error_message TEXT NULL
generated_by VARCHAR(255) NULL
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
completed_at TIMESTAMP NULL
```

Indexes to consider:

```text
idx_product_ai_reports_product_created_at(product_id, created_at)
idx_product_ai_reports_product_status(product_id, status)
idx_product_ai_reports_input_hash(input_hash)
```

Foreign key:

```text
product_id -> products.id
```

Investigation must confirm the real database engine and migration style before implementing.

---

## Backend API Design

Preferred endpoints:

### 1. Get latest saved report

```http
GET /api/products/:id/reports/ai/latest
```

Purpose:

- Load the latest successful saved AI report for this product.
- Must not call OpenAI.

Response:

```ts
type GetLatestProductAiReportResponse = {
  productId: number;
  report: {
    id: number;
    status: 'success';
    model: string;
    reportTypes: Array<'pricing' | 'competitorMatch' | 'salesTrend' | 'listingImprovement'>;
    output: ProductAiReportsOutput;
    createdAt: string;
    completedAt: string | null;
  } | null;
};
```

### 2. Generate new report by button click

```http
POST /api/products/:id/reports/ai
```

Purpose:

- Triggered by product detail page button.
- Calls OpenAI from backend.
- Stores result in database.
- Returns saved report record.

Request:

```ts
type GenerateProductAiReportRequest = {
  reports?: Array<'pricing' | 'competitorMatch' | 'salesTrend' | 'listingImprovement'>;
  forceRefresh?: boolean;
};
```

Default behaviour:

- If `reports` is omitted, generate all four reports.
- `forceRefresh` can be supported but should not be required for the first version because clicking the button already means user wants generation.

Response:

```ts
type GenerateProductAiReportResponse = {
  productId: number;
  report: {
    id: number;
    status: 'success' | 'failed';
    model: string;
    reportTypes: Array<'pricing' | 'competitorMatch' | 'salesTrend' | 'listingImprovement'>;
    output: ProductAiReportsOutput | null;
    errorMessage: string | null;
    createdAt: string;
    completedAt: string | null;
  };
};
```

### Optional future endpoint, not required first

```http
GET /api/products/:id/reports/ai
```

Purpose:

- Return report history.
- Not required unless easy and approved.

---

## Report Output Types

```ts
type ProductAiReportsOutput = {
  pricing?: PricingRecommendationReport;
  competitorMatch?: CompetitorMatchQualityReport;
  salesTrend?: SalesTrendSummaryReport;
  listingImprovement?: ProductListingImprovementReport;
};
```

### 1. Pricing Recommendation

Purpose:
Recommend whether to hold, increase, decrease, or test the product price.

Inputs:

- Product title
- SKU
- Current price
- Currency
- Cost price, if available
- Inventory
- Brand
- Category/tags
- Competitor products
- Competitor prices
- Competitor shipping prices, if available
- Competitor country
- Competitor status/confirmation
- Last updated date
- Sales summary
- Sales history

Expected output:

```ts
type PricingRecommendationReport = {
  recommendation: 'HOLD_PRICE' | 'INCREASE_PRICE' | 'DECREASE_PRICE' | 'TEST_PRICE' | 'INSUFFICIENT_DATA';
  confidence: 'low' | 'medium' | 'high';
  currentPrice: number | null;
  competitorLowestPrice: number | null;
  competitorHighestPrice: number | null;
  competitorAveragePrice: number | null;
  competitorMedianPrice: number | null;
  pricePosition: 'low' | 'lower-middle' | 'middle' | 'upper-middle' | 'high' | 'unknown';
  suggestedPriceRange: {
    min: number | null;
    max: number | null;
  };
  summary: string;
  reasoning: string[];
  action: string;
  risks: string[];
};
```

---

### 2. Competitor Match Quality

Purpose:
Analyse whether competitor products are direct matches, similar products, weak matches, or should be rejected.

Inputs:

- Our product title
- Description
- Specifications
- Size/capacity
- Material
- Images, if available as URLs
- Tags/category
- Competitor title
- Competitor description, if available
- Competitor image, if available as URL
- Competitor price
- Competitor URL
- Store name
- Existing confirmation status

Expected output:

```ts
type CompetitorMatchQualityReport = {
  competitors: Array<{
    competitorProductId: number | string;
    matchType: 'DIRECT_MATCH' | 'SIMILAR_PRODUCT' | 'WEAK_MATCH' | 'REJECTED' | 'UNKNOWN';
    matchScore: number; // 0-100
    confidence: 'low' | 'medium' | 'high';
    reasons: string[];
    warning: string | null;
  }>;
  summary: string;
  recommendedActions: string[];
};
```

Rules:

- Do not treat all cheaper products as valid competitors.
- Compare size, material, product type, visible features, title wording, and description.
- If product information is missing, reduce confidence.
- If a competitor appears too different, classify it as `WEAK_MATCH` or `REJECTED`.
- The model must not invent product attributes.

---

### 3. Sales Trend Summary

Purpose:
Summarise sales performance and explain whether demand looks stable, increasing, slowing, or unclear.

Inputs:

- Total sold
- Total revenue
- Orders count
- Average selling price
- Last sale date
- Sales last 7 days
- Sales last 30 days
- Sales last 90 days
- Monthly units sold
- Monthly revenue
- Recent anonymised order lines
- Current inventory

Expected output:

```ts
type SalesTrendSummaryReport = {
  trend: 'GROWING' | 'STABLE' | 'SLOWING' | 'SEASONAL' | 'INSUFFICIENT_DATA';
  confidence: 'low' | 'medium' | 'high';
  bestMonth: string | null;
  recentPerformance: string;
  summary: string;
  insights: string[];
  action: string;
  risks: string[];
};
```

Rules:

- If the current month is incomplete, say that clearly.
- Do not overreact to partial-month sales.
- Mention whether most orders are single-unit purchases if the data supports it.
- Use plain English suitable for a store owner.

---

### 4. Product Listing Improvement

Purpose:
Analyse product title, description, specifications, images, and customer/return feedback to suggest listing improvements.

Inputs:

- Current product title
- Description
- Bullet points
- Specifications
- Images
- Price
- Inventory
- Tags/category
- Customer feedback, if available
- Return reasons, if available
- Competitor titles, if useful

Expected output:

```ts
type ProductListingImprovementReport = {
  listingScore: number; // 0-100
  mainIssues: string[];
  improvedTitle: string;
  improvedBulletPoints: string[];
  recommendedDescriptionChanges: string[];
  riskWarnings: string[];
  seoKeywords: string[];
  imageSuggestions: string[];
  summary: string;
};
```

Rules:

- Do not make unsupported claims.
- Do not overpromise compatibility, especially induction compatibility.
- Make recommendations that reduce customer confusion and returns.
- Use clear ecommerce wording.
- Keep output practical.

---

## OpenAI API Requirements

Use the OpenAI API from the backend only.

### Required environment variables

Investigate existing naming convention first. Likely variables:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
```

Do not add real secrets.
Do not commit `.env` values.
Do not modify production secret configuration without approval.

### Structured output

The OpenAI response must be parsed and validated.

Preferred approach:

- Use JSON schema / structured outputs if the installed OpenAI SDK supports it.
- Validate response with existing validation library if available.
- If no validation library exists, propose whether to add one in the investigation plan.

The app must not trust raw LLM output blindly.

### Prompting requirements

System message:

```text
You are a pricing and ecommerce analysis assistant for a small online retailer. Use only the supplied data. Do not invent facts. If data is missing, lower confidence or return INSUFFICIENT_DATA where appropriate. Keep recommendations practical, concise, and suitable for a store owner. Return JSON only.
```

User message should include a compact JSON payload:

```ts
{
  product: {...},
  competitors: [...],
  sales: {...},
  listing: {...},
  feedback: {...},
  requestedReports: ['pricing', 'competitorMatch', 'salesTrend', 'listingImprovement']
}
```

---

## Data Preparation Rules

Before sending data to OpenAI:

1. Remove unnecessary fields.
2. Do not send customer personal information.
3. Do not send customer names, emails, phone numbers, addresses, or payment details.
4. Only send product-level sales aggregation and anonymised order-line data.
5. Limit competitor records to confirmed or relevant candidates where possible.
6. Include enough product content for listing analysis.
7. Include image URLs only if useful and allowed by existing architecture.
8. Store only sanitized `inputSnapshot` in the database.
9. Do not store raw full orders in report input snapshots.

---

## Frontend Requirements

Add an AI report panel to the product detail page.

Suggested placement:

- Near the top of the product detail page, after product title and before competitor charts; or
- Above the competitor table as an **AI Insights** section.

UI must include:

- **Generate AI Report** button if no saved report exists.
- **Refresh AI Report** button if a saved report already exists.
- Loading state while backend generates report.
- Error state if generation fails.
- Latest generated timestamp.
- Four report cards/sections:
  - Pricing Recommendation
  - Competitor Match Quality
  - Sales Trend Summary
  - Product Listing Improvement

Page load behaviour:

- Fetch latest saved report from backend/database.
- Do not call OpenAI on page load.
- Show empty state if there is no saved report.

Button click behaviour:

- Disable button while request is running.
- Call `POST /api/products/:id/reports/ai`.
- Replace displayed report with returned saved report.
- Keep existing product page usable if generation fails.

Suggested empty state copy:

```text
No AI report has been generated for this product yet. Click Generate AI Report to analyse pricing, competitors, sales trend, and listing quality.
```

Suggested button labels:

```text
Generate AI Report
Refresh AI Report
```

---

## Error Handling Requirements

Handle:

- Missing OpenAI API key
- OpenAI timeout
- Invalid JSON response
- Schema validation failure
- Product not found
- No competitor data
- No sales data
- Database insert/update failure
- Network/API errors

Expected behaviour:

- Return safe backend errors.
- Save failed report status if a generation attempt was created.
- Show user-friendly frontend error.
- Log enough detail for debugging.
- Do not expose API keys or sensitive payloads in logs.
- Do not break the product detail page if AI reports fail.

---

## Testing Requirements

Testing worker should add tests after implementation.

### Backend tests

Cover:

- Latest report endpoint returns `null` when no report exists.
- Latest report endpoint returns latest successful report.
- Generate endpoint creates a database report record.
- Generate endpoint stores successful OpenAI output.
- Generate endpoint stores failed status on OpenAI/schema failure if appropriate.
- Product report payload builder removes customer PII.
- Missing OpenAI key returns controlled error.
- Mocked OpenAI response is parsed correctly.
- Invalid OpenAI response is rejected.
- Product not found returns correct error.
- Selected report types work if implemented.

### Frontend tests, if existing framework supports it

Cover:

- AI report panel renders empty state.
- Generate button triggers backend request.
- Button shows loading/disabled state.
- Saved report renders correctly.
- Error state displays cleanly.
- Existing product page still renders without reports.

### Manual validation

Use one product with:

- Product details
- Confirmed competitors
- Sales history
- Description/images

Validate:

- Page load does not call OpenAI.
- Clicking button calls backend generation endpoint.
- OpenAI is called only from backend.
- No customer PII is sent.
- Report is saved to database.
- Reloading product page shows latest saved report without calling OpenAI.
- Refresh button creates or updates report according to approved design.
- Reports are practical and not hallucinated.
- Failure does not break product detail page.

---

## Validation Commands

Investigate exact commands from package scripts first.

Likely commands may include:

```bash
pnpm install
pnpm turbo lint --filter=@price-insight/backend
pnpm turbo typecheck --filter=@price-insight/backend
pnpm turbo test --filter=@price-insight/backend
pnpm turbo lint --filter=@price-insight/frontend
pnpm turbo typecheck --filter=@price-insight/frontend
pnpm turbo test --filter=@price-insight/frontend
```

Use the correct package names discovered in the repo.

Known package names may be:

```text
@price-insight/backend
@price-insight/frontend
@price-insight/core
```

---

## Implementation Guidance After Approval

Only after Tony approves the investigation plan:

1. Add shared report output types if appropriate.
2. Add database table/migration for product AI reports.
3. Add Drizzle schema/model for product AI reports.
4. Add backend service for preparing sanitized report input payload.
5. Add OpenAI client wrapper/service.
6. Add structured output schema and parser.
7. Add backend endpoint to fetch latest saved report.
8. Add backend endpoint to generate and persist new report.
9. Add frontend API call/composable.
10. Add product detail AI report panel with Generate/Refresh button.
11. Add tests.
12. Run validation commands.
13. Summarise diffs and risks.

---

## PR Checklist

Before PR is ready:

- [ ] Investigation completed and approved by Tony
- [ ] Report generation is triggered only by button click
- [ ] Page load fetches saved report only and does not call OpenAI
- [ ] OpenAI is called from backend only
- [ ] Reports are stored in database
- [ ] Latest saved report appears on product detail page
- [ ] No secrets committed
- [ ] No customer PII sent to OpenAI
- [ ] Stored input snapshot is sanitized
- [ ] Report outputs are structured and validated
- [ ] Product page works without OpenAI reports
- [ ] Error handling added
- [ ] Backend tests added or updated
- [ ] Frontend tests added or updated where practical
- [ ] Lint/typecheck/tests run with results documented
- [ ] PR description explains architecture, database changes, risks, and validation

---

## Final Worker Response Format

When finished, report:

```text
Summary
- ...

Files Changed
- ...

Database Changes
- ...

Architecture Notes
- ...

Risks / Trade-offs
- ...

Validation
- command: result

Follow-up Recommendations
- ...
```
