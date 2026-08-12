# Task: Price Insight Product Page UX and Decision Dashboard Planning

## 1. Goal

The goal is to investigate and plan improvements to the Price Insight full product page so it becomes a clear product decision dashboard instead of a long data-heavy report.

The page should help a Shopify merchant answer these questions within the first screen:

- Is my current price competitive?
- Which competitor matters most?
- How many days will current inventory last?
- Are sales improving or declining?
- What action should I take next?

Do not code yet. This task is for investigation and planning only.

---

## 2. Background

Project:

- Name: Price Insight
- Purpose: Shopify product competitor pricing and sales intelligence tool.
- Frontend: Nuxt 4 / Vue.
- Backend: Node.js / TypeScript.
- Existing product page includes:
  - competitor product table
  - competitor price chart
  - price distribution chart
  - AI insights
  - sales history chart
  - order history table
  - product gallery
  - product pricing and inventory details
  - product description and metadata

Current problem:

- The page is too long and dense.
- Important decision information is spread across multiple sections.
- The first screen does not clearly explain pricing position, sales trend, inventory runway, or recommended action.
- AI insights are useful but too text-heavy.
- The current competitor charts are difficult to understand quickly.
- Product details and order history take too much visual space compared with decision-level information.

Business reason:

- Merchants should be able to understand a product’s commercial situation quickly.
- The page should guide action, not only display raw data.
- Better hierarchy will make Price Insight stronger as a portfolio product and more useful for future Shopify users.

Existing decisions:

- Do not use supplier lead time at this stage.
- Inventory should show estimated days remaining based on historical sales only.
- Do not add reorder-date recommendations yet.
- Current sales data may include 7-day, 30-day, and 90-day sales totals.
- Competitor data may include product price, shipping, country, currency, match details, and last updated date.
- Existing AI insights include:
  - pricing recommendation
  - sales trend summary
  - competitor match quality
  - listing improvement

Reference screenshot:

```text
/mnt/data/qweyha520-bar-products-354-06-22-2026_03_44_PM.png
```

---

## 3. Materials

Inspect:

```text
apps/frontend
apps/frontend/pages
apps/frontend/components
apps/frontend/composables
apps/frontend/types
apps/backend
apps/backend/src/routes
apps/backend/src/services
apps/backend/src/repositories
apps/backend/src/db
packages/core
```

Also inspect files related to:

```text
product detail
product page
competitors
price history
sales history
orders
inventory
AI insights
pricing recommendation
listing improvement
charts
Nuxt UI
product analytics
```

Inspect the existing implementation before proposing new component structure.

Identify:

- current product detail route
- main page component
- data-fetching composables
- API endpoints used by the page
- current chart library and chart components
- product, competitor, order, inventory, and AI insight types
- responsive layout approach
- existing shared cards, tables, tabs, badges, and chart patterns

Use existing project patterns first. Do not invent a new design system if reusable components already exist.

---

## 4. Boundaries

Allowed:

- Read and search the codebase.
- Inspect existing page structure and component patterns.
- Inspect current API response shapes.
- Identify affected frontend and backend files.
- Identify data gaps.
- Propose page hierarchy and component structure.
- Propose API additions only where required.
- Propose test plan.
- Create or update a planning document only if required by repo workflow.

Not allowed:

- Do not edit source code.
- Do not edit tests.
- Do not change database schema.
- Do not add dependencies.
- Do not change API contracts.
- Do not modify AI prompt logic.
- Do not alter competitor matching logic.
- Do not alter inventory calculation logic.
- Do not add supplier lead time.
- Do not add reorder date calculations.
- Do not run migrations.
- Do not change deployment configuration.
- Do not implement UI changes before Tao approval.

Approval required before:

- API contract changes.
- Database schema changes.
- New analytics queries.
- New AI report fields.
- Changes to competitor pricing calculation.
- Changes to inventory/runway calculation.
- New chart library or dependency.
- Large page/component refactor.

---

## 5. Investigation Requirements

### 1. Current implementation

Report:

- current product detail page route and main components
- current section order on the page
- current data source for each section
- existing API endpoints and response shapes
- how competitor prices are calculated and displayed
- how shipping is stored and displayed
- whether total landed price can be calculated now
- how sales history is calculated
- how inventory quantity is sourced
- whether 7-day, 30-day, and 90-day sales data already exists
- how AI insights are stored and rendered
- current mobile/responsive behavior
- existing reusable components that should be reused

### 2. Proposed information architecture

Plan a new page hierarchy using tabs or another clear navigation pattern.

Recommended target structure:

```text
Product header
→ Decision Summary
→ Overview
→ Competition
→ Sales
→ AI Insights
→ Product Details
```

Investigate whether tabs are appropriate based on existing UI patterns.

Preferred content structure:

```text
Overview
- Current price
- Market median
- Price position
- Inventory quantity
- Estimated inventory days remaining
- 30-day sales
- 30-day revenue
- Competitor count
- Match confidence
- Main pricing recommendation
- Main next action

Competition
- Competitor table
- Competitor filters
- Price position chart
- Shipping / landed price comparison
- Match confidence
- Closest relevant competitor
- Competitor exclusion or irrelevance workflow, if existing patterns support it

Sales
- Sales summary cards
- 30-day versus previous-30-day comparison
- Units sold chart
- Revenue chart
- Average selling price, if data exists
- Inventory runway
- Recent order list

AI Insights
- Pricing recommendation
- Sales trend summary
- Competitor match quality
- Listing improvement
- Generated date
- Refresh insight action, if already supported

Product Details
- Product gallery
- SKU
- Brand
- Tags
- Inventory
- Description
- Shopify metadata
```

### 3. Decision Summary requirements

Investigate the best implementation approach for a top-level Product Decision Summary.

Target information:

```text
Current Price
Market Median
Price Position
Inventory
Estimated Days Remaining
30-day Sales
30-day Revenue
Competitors
Match Confidence
```

Target recommendation format:

```text
Pricing recommendation
Raise price gradually to $105–$110.

Why:
Current price is materially below comparable competitors.

Confidence:
Medium.

Suggested action:
Test a price increase and monitor conversion.
```

The summary should be understandable without reading long AI paragraphs.

Identify:

- which data already exists
- which values require backend calculation
- which values can be derived in the frontend
- which values are unreliable or unavailable
- whether market median should exclude low-confidence competitor matches
- whether inventory runway should use 30-day sales as the default

### 4. Inventory runway requirements

Do not use supplier lead time.

Plan a simple inventory duration indicator.

Target format:

```text
Inventory: 11 units
Sales rate: 0.6 units/day
Estimated stock cover: 18 days
Based on the last 30 days of sales.
```

Recommended status ranges:

```text
Healthy: more than 45 days
Watch: 21–45 days
Low: 8–20 days
Critical: 7 days or less
No sales data: cannot estimate
```

Investigate:

- current inventory field
- current 7-day, 30-day, and 90-day sales fields
- current inventory alert logic
- whether decimal sales rates should be shown or hidden
- behavior when sales are zero
- behavior when inventory is zero
- behavior when inventory is negative or unavailable
- whether the page can show a switch between 7-day, 30-day, and 90-day rates later without changing backend data

Do not recommend supplier lead time or reorder-date calculations.

### 5. Pricing and competitor section requirements

Investigate replacing the existing separate competitor price chart and price distribution chart with one clearer price-position visualization.

Target concept:

```text
Lowest competitor      Market median      Highest competitor
$128                   $133               $139

Your price
$95
```

The chart should clearly communicate:

```text
You are $33 below the lowest comparable competitor.
You are 26% below the market median.
```

Also investigate whether the competitor table can support:

```text
Competitor price
Shipping cost
Total landed price
Price difference
Match confidence
Availability
Country
Last checked
```

Potential filters:

```text
All competitors
High-confidence matches
In-stock competitors
NZ competitors
Similar capacity / specification competitors
```

Report which of these can be implemented using current data and which require future changes.

### 6. AI insight presentation requirements

The current AI insight section is too dense.

Plan a reusable compact insight card format:

```text
Headline
Recommendation
Evidence
Confidence
Suggested action
```

Example:

```text
Pricing recommendation
Raise price gradually to $105–$110.

Evidence:
Your price is 26% below the market median.

Confidence:
Medium.

Suggested action:
Test the new price for 14 days and monitor conversion.
```

Investigate:

- current AI insight response shape
- whether existing content can be transformed without changing AI generation
- whether individual insight blocks can be rendered as cards
- whether recommendations can be extracted reliably
- whether the frontend should use structured fields or parse existing text
- whether AI insight generation timestamp already exists
- existing refresh/regenerate workflow

Do not change AI prompts or backend AI logic without Tao approval.

### 7. Sales section requirements

Plan a clearer sales section with decision-level information before the detailed order table.

Target layout:

```text
Sales summary cards
→ Trend comparison
→ Sales chart
→ Inventory runway
→ Recent orders table
```

Potential metrics:

```text
Last 30 days units sold
Previous 30 days units sold
Percentage change
Last 30 days revenue
Previous 30 days revenue
Average selling price
```

Potential chart modes:

```text
Units sold
Revenue
Average selling price
```

Investigate:

- current available sales data
- whether comparison periods can be calculated from existing order data
- whether revenue and average selling price are reliable
- whether chart data is currently aggregated server-side or client-side
- whether orders table should be paginated, collapsible, or moved into a separate tab
- whether existing table component supports responsive overflow safely

### 8. UX and responsive design requirements

Assess:

- current text size and readability
- visual density
- spacing between sections
- use of cards and borders
- mobile usability
- table overflow behavior
- chart label readability
- action button discoverability
- loading states
- empty states
- error states

Provide concrete recommendations for:

- desktop layout
- tablet layout
- mobile layout
- tab behavior on smaller screens
- table handling on mobile
- chart fallback behavior
- loading skeletons or loading indicators, if patterns already exist

### 9. Risks

Cover:

- creating too much frontend-only calculation logic
- inconsistent price calculations between frontend and backend
- misleading market median because of weak competitor matches
- shipping data being incomplete
- showing landed price when shipping is unknown
- inventory runway being misleading for low-volume products
- zero sales creating infinite inventory runway
- inventory values being stale
- too many tabs hiding important information
- AI insights being treated as factual when confidence is low
- visual redesign causing API/data-fetching regressions
- responsive tables becoming unusable on mobile
- unnecessary component abstraction
- adding too much scope to one product-page PR

### 10. Options

Provide at least two implementation options.

#### Option A: Frontend-first page restructuring

```text
Reuse existing APIs and data.
Reorganize the page into tabs.
Derive summary metrics in the frontend where safe.
Keep backend contracts unchanged.
```

Pros:

- smaller scope
- faster delivery
- lower backend risk
- suitable for MVP

Cons:

- may duplicate calculation logic
- some metrics may be less reliable
- may not support richer landed-price or confidence rules

#### Option B: Backend product dashboard endpoint

```text
Create a dedicated backend endpoint that returns a normalized product dashboard summary.
Frontend becomes mainly presentational.
```

Pros:

- consistent calculations
- cleaner frontend
- easier future expansion
- easier to test business metrics

Cons:

- larger backend/API scope
- requires approval for API contract change
- more implementation time

Recommendation rule:

```text
Recommend Option A if existing product detail APIs already expose reliable data for decision metrics.

Recommend Option B if the current frontend must combine many inconsistent sources, duplicate business calculations, or make unreliable assumptions.
```

### 11. Test impact

Identify tests needed for:

#### Frontend

- product detail page renders decision summary
- loading state
- empty competitor state
- no sales-data state
- zero inventory state
- zero sales state
- competitor chart with one competitor
- competitor chart with no comparable competitor
- AI insight cards render safely with missing fields
- tab navigation
- mobile table overflow behavior
- product detail page does not regress existing sections

#### Backend, if required

- summary metric calculation
- market median calculation
- price position calculation
- inventory days calculation
- zero-sales handling
- no-competitor handling
- incomplete shipping handling
- match-confidence filtering
- sales comparison period calculation

#### Manual validation

- desktop product page
- mobile product page
- product with competitors
- product without competitors
- product with no orders
- product with low inventory
- product with zero inventory
- product with weak competitor matches
- product with incomplete shipping information
- stale or missing AI insights

### 12. Complexity

Estimate:

```text
Small / Medium / Large
```

Expected likely result:

```text
Medium
```

Reason:

- page restructuring affects multiple existing sections
- charts and tables require careful responsive handling
- business metrics need consistent definitions
- inventory runway and competitor comparison require edge-case behavior
- scope must remain focused and avoid unnecessary backend redesign

---

## 6. Definition of Done

Planning is complete when you provide:

- current product page implementation summary
- current route, components, composables, and APIs
- existing reusable UI components
- affected frontend/backend files
- recommended information architecture
- proposed component hierarchy
- recommendation for tabs versus one-page layout
- decision summary design
- inventory runway calculation recommendation
- competitor and price visualization recommendation
- AI insight presentation recommendation
- sales section recommendation
- responsive/mobile considerations
- data gaps and assumptions
- risks and trade-offs
- recommended implementation option
- approval decisions needed
- test plan
- validation commands that actually exist in the repository
- next implementation prompt

End with:

```text
Waiting for Tao approval.
```
