# Agent Brief B — ICP Band Scoring Revision (apps/leads)

## Goal
Make the deterministic qualification match the ICP: **exclude BOTH extremes** —
too-small hobby sellers AND enterprise vendors. Today the scorer treats Value
monotonically ("bigger is always better"); change it to a **sweet-spot / band**
model, and add an optional **enterprise ceiling** to the hard filter. Keep scoring
**explainable** (reasons) and **config-driven**.

Runs in an isolated git worktree off `feature/lead-scoring`, in parallel with the
MongoDB-foundation agent. Pure logic + tests only — **no DB, no new dependencies.**

## Context you need
- ICP: NZ, Shopify-first, physical consumer products, **owner-led / SME**, enough
  catalogue + operational complexity to benefit from automation. Exclude no-budget
  micro-sellers and enterprise-with-internal-teams.
- Data reality (Auckland file /102 coverage): Sales Revenue 93, Tech Spend 100,
  SKU 96, Page Rank 97, CRuX 73, MA 38, **CRM 3, AI 3**, Employees 2, Tranco 7.
  ⇒ the automation "gap" barely differentiates (almost everyone lacks CRM/AI);
  the real size/complexity separators are **Sales Revenue** and **SKU**. Use
  **Page Rank** for prominence, not Tranco (too sparse).

## Exact files in scope
Modify:
- `apps/leads/src/config.ts` — extend `HardFilterConfig` with `maxRevenue` and `maxProductCount` (0 = disabled), add their values to `HARD_FILTER`; add a `VALUE_BAND` config `{ rampTop: 0.40, plateauTop: 0.85, decayFloor: 0.30 }`.
- `apps/leads/src/domain/types.ts` — add `productCount: number | null` to `HardFilterInput`; add a `ValueBandConfig` type. Do NOT change `ScoreResult`/`ScoreComponents` shape (the persistence layer mirrors it).
- `apps/leads/src/filter/hard-filter.ts` — add ceiling checks: reject when `maxRevenue > 0` and revenue known & above it (`reason: "above_max_revenue"`); reject when `maxProductCount > 0` and productCount known & above it (`reason: "enterprise_catalog"`). Keep existing checks.
- `apps/leads/src/score/score.ts` — apply a **band curve** to the *size* signals (revenue percentile and SKU percentile); keep tech-spend and prominence (`1 - rankPct`) monotonic. Add reasons `"sweet-spot size"` (in plateau) and `"enterprise-scale (down-weighted)"` (above plateau). Implement the band helper here (or a new `src/score/band.ts`) — do NOT modify `normalize.ts`.
- Tests: `apps/leads/src/__tests__/hard-filter.test.ts` and `score.test.ts` — add band + ceiling cases (below).

Optional new file allowed: `apps/leads/src/score/band.ts` (pure helper).

## Band curve (explainable, deterministic)
```
bandScore(pct, { rampTop, plateauTop, decayFloor }):
  if pct <= rampTop      -> pct / rampTop                                  # 0→1 ramp
  if pct <= plateauTop   -> 1                                              # plateau (sweet spot)
  else                   -> 1 - ((pct - plateauTop)/(1 - plateauTop)) * (1 - decayFloor)  # decay → floor
```
Apply to `revenuePct(salesRevenue)` and `skuPct(productCount)`. Leave
`spendPct` and `1 - rankPct` linear. Value = mean of available parts (unchanged
averaging; only the size parts are reshaped).

## Design decisions (locked for this brief)
- **Ceilings default DISABLED** (`maxRevenue: 0`, `maxProductCount: 0`): we lack
  calibration, so a hard cut risks dropping good leads. The band curve already
  *softly* down-weights the enterprise tail — that is the safe default. Leave a
  documented comment with suggested placeholder values for when Tao calibrates.
- **Keep weights** (value .40 / gap .30 / reach .20 / recency .10) unchanged; add a
  code comment noting gap barely differentiates on this dataset (CRM/AI ~3%).
- **Out of scope** (cannot be derived from the structured export — defer to the
  crawl/AI phases): physical-product detection, owner-led/team-size detection.
  Add a short comment saying so; do not fabricate signals for them.

## Files it MUST NOT modify
- `apps/leads/src/lib/normalize.ts` — keep byte-for-byte stable (shared core).
- `apps/leads/src/db/**`, `package.json`, `.env.example`, `drizzle.config.ts` — **owned by the parallel MongoDB-foundation agent.**
- Anything under `apps/backend/**` or `apps/frontend/**`.
- Do NOT change `pnpm-lock.yaml` (no dependency changes).

## Dependency changes
**None.** If you think you need one, stop and report instead.

## Validation commands (all must pass)
```bash
pnpm --filter @price-insight/leads exec tsc --noEmit   # expect: clean, exit 0
pnpm --filter @price-insight/leads lint                # expect: clean, exit 0
pnpm --filter @price-insight/leads test                # expect: all pass (existing + new band/ceiling cases)
```

## Tests to add
- Band: a mid-percentile size scores higher than a top-percentile (enterprise) size — proves non-monotonicity.
- Band boundaries: pct=0 → 0; pct=rampTop → 1; pct in plateau → 1; pct=1 → decayFloor.
- Ceiling disabled by default → a huge-revenue/huge-catalog row still passes the filter.
- Ceiling enabled (inject config) → rejects with the right reason.
- Reasons include "sweet-spot size" / "enterprise-scale (down-weighted)" appropriately.

## Rules
- Do NOT commit or push. Leave changes in the worktree for Tao to review.
- Keep the core deterministic and DB-free. No network, no new deps.
- If forced outside scope, stop and report.

## Completion report format
```
## Agent B — ICP Band Scoring
### Files changed
- modified / created …
### Behaviour changes
- hard filter: new ceiling checks (default state)
- value: band curve on revenue+SKU; monotonic parts unchanged
- new reasons emitted
### Validation
- tsc: pass/fail
- lint: pass/fail
- test: N passed (list new tests)
### Contract for the importer
- `HardFilterInput` now requires `productCount`
- config knobs added (VALUE_BAND, maxRevenue, maxProductCount) + default states
### Unresolved issues / assumptions
- …
### git diff --stat
```
```
```
