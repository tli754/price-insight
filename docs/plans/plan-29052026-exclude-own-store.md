# Plan: Exclude Own Store from Competitor Results

**Date:** 2026-05-29
**Branch:** feature/serp-nz-locale
**Status:** Investigation complete — awaiting APPROVED TO IMPLEMENT

---

## Task Summary

When SerpAPI returns competitor results, the user's own store (e.g. "White Donkey") appears in the list. It should be excluded before results are saved to `competitor_products`.

---

## Root Cause

`SerpApiService.searchShoppingPrices` returns every store including the user's own. There is no existing mechanism to identify or exclude the user's store. No store name is currently stored in env config.

---

## Proposed Fix

Add an optional env var `OWN_STORE_NAME`. In `searchAndSuggest`, filter out any result whose `source` matches (case-insensitive, trimmed) before saving to DB and before returning to the frontend.

---

## Files to Change

| File | Change |
|---|---|
| `apps/backend/src/config/env.ts` | Add `OWN_STORE_NAME: z.string().optional()` |
| `apps/backend/src/services/competitor-analysis-service.ts` | In `searchAndSuggest`, filter results where `normalizeSource(r.source).toLowerCase() === ownStoreName.toLowerCase()` |
| `apps/backend/.env.example` | Document `OWN_STORE_NAME` |

---

## Implementation

### `env.ts`
```ts
OWN_STORE_NAME: z.string().optional(),
```

### `competitor-analysis-service.ts` — in `searchAndSuggest`, after getting results:
```ts
const ownStore = this.ownStoreName?.trim().toLowerCase();
const filtered = ownStore
  ? results.filter(r => normalizeSource(r.source).toLowerCase() !== ownStore)
  : results;
```

Constructor receives `ownStoreName: string | undefined` (passed from `app.ts` via `env.OWN_STORE_NAME`).

### `app.ts`
```ts
const competitorAnalysisService = new CompetitorAnalysisService(
  serpApi, redis, competitorRepository, env.OWN_STORE_NAME
);
```

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Store name in SerpAPI result may not exactly match `OWN_STORE_NAME` | Low | Case-insensitive compare handles minor variations |
| `OWN_STORE_NAME` not set → no filtering, existing behaviour preserved | None | Optional field, default undefined = no filter |

---

## Waiting for: APPROVED TO IMPLEMENT
