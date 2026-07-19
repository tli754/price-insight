import { RECENCY, VALUE_BAND, WEIGHTS, type ScoreWeights } from "../config.js";
import type { ScoreInput, ScoreResult } from "../domain/types.js";
import { clamp, percentileFn, round } from "../lib/normalize.js";
import { bandScore } from "./band.js";

/**
 * Percentile context built from the whole dataset — scoring is relative, so a
 * store's value signals are ranked against its peers (robust to units/outliers).
 */
export interface ScoringContext {
  revenuePct: (v: number | null) => number | null;
  spendPct: (v: number | null) => number | null;
  skuPct: (v: number | null) => number | null;
  // prominence: rank where LOWER is better, so prominence = 1 - percentile(rank)
  rankPct: (v: number | null) => number | null;
}

export function buildScoringContext(inputs: ScoreInput[]): ScoringContext {
  return {
    revenuePct: percentileFn(inputs.map((i) => i.salesRevenue)),
    spendPct: percentileFn(inputs.map((i) => i.technologySpend)),
    skuPct: percentileFn(inputs.map((i) => i.productCount)),
    rankPct: percentileFn(inputs.map((i) => i.prominenceRank))
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Recency credit from a last-activity date (full within freshMonths, decays to floor). */
export function recencyScore(lastActivityAt: Date | null, now: Date): number {
  if (!lastActivityAt) return RECENCY.nullNeutral;
  const monthsAgo = (now.getTime() - lastActivityAt.getTime()) / (30 * 86_400_000);
  if (monthsAgo <= RECENCY.freshMonths) return 1;
  if (monthsAgo >= RECENCY.staleMonths) return RECENCY.floor;
  const span = RECENCY.staleMonths - RECENCY.freshMonths;
  const decayed = 1 - ((monthsAgo - RECENCY.freshMonths) / span) * (1 - RECENCY.floor);
  return clamp(decayed, RECENCY.floor, 1);
}

export function scoreOne(
  input: ScoreInput,
  ctx: ScoringContext,
  weights: ScoreWeights = WEIGHTS,
  now: Date = new Date()
): ScoreResult {
  const reasons: string[] = [];

  // Value — fit with the ICP (owner-led SME with real operational complexity),
  // NOT raw "bigger is better". The SIZE signals (revenue, SKU count) run through
  // a sweet-spot band so micro-sellers AND enterprise vendors are down-weighted;
  // tech-spend and prominence stay monotonic (more/better is still better).
  // Out of scope here (not in the structured export): physical-product detection
  // and owner-led / team-size detection — deferred to the crawl/AI phases; we do
  // NOT fabricate signals for them.
  const valueParts: number[] = [];
  const rev = ctx.revenuePct(input.salesRevenue);
  const spend = ctx.spendPct(input.technologySpend);
  const sku = ctx.skuPct(input.productCount);
  const rank = ctx.rankPct(input.prominenceRank);
  if (rev != null) valueParts.push(bandScore(rev, VALUE_BAND)); // size → banded
  if (spend != null) valueParts.push(spend); // tech-spend: monotonic
  if (sku != null) valueParts.push(bandScore(sku, VALUE_BAND)); // size → banded
  if (rank != null) valueParts.push(1 - rank); // prominence: monotonic (lower rank = higher)
  const value = mean(valueParts);

  // Explain the size verdict from the dominant size percentile (revenue or SKU).
  const sizePcts = [rev, sku].filter((p): p is number => p != null);
  if (sizePcts.length > 0) {
    const sizePct = Math.max(...sizePcts);
    if (sizePct > VALUE_BAND.plateauTop) reasons.push("enterprise-scale (down-weighted)");
    else if (sizePct > VALUE_BAND.rampTop) reasons.push("sweet-spot size");
  }

  // Automation gap — the sales opportunity. NOTE: on the current dataset this
  // barely differentiates leads (CRM & AI adoption are ~3% coverage, so almost
  // everyone "lacks" them). Weights are kept as-is; revisit once coverage improves.
  const gapAi = input.hasAi ? 0.2 : 1;
  const gapCrm = input.hasCrm ? 0.5 : 1;
  const receptivity = input.hasMarketingAutomation ? 1 : 0.6;
  const gap = mean([gapAi, gapCrm, receptivity]);
  if (!input.hasAi) reasons.push("no AI tooling");
  if (!input.hasCrm) reasons.push("no CRM");
  if (input.hasMarketingAutomation) reasons.push("uses marketing automation");

  // Reachability — can we actually contact them.
  const reach =
    (input.hasEmail ? 0.6 : 0) + (input.hasNamedPerson ? 0.25 : 0) + (input.hasPhone ? 0.15 : 0);
  if (input.hasEmail) reasons.push("email on file");
  if (!input.hasEmail && !input.hasPhone) reasons.push("no direct contact");

  // Recency — still an active business.
  const recency = recencyScore(input.lastActivityAt, now);

  const overall =
    100 * (weights.value * value + weights.gap * gap + weights.reach * reach + weights.recency * recency);

  return {
    overall: round(overall, 2),
    components: {
      value: round(value, 4),
      gap: round(gap, 4),
      reach: round(reach, 4),
      recency: round(recency, 4)
    },
    reasons
  };
}

/** Score a whole dataset (builds the percentile context once). */
export function scoreDataset(
  inputs: ScoreInput[],
  weights: ScoreWeights = WEIGHTS,
  now: Date = new Date()
): ScoreResult[] {
  const ctx = buildScoringContext(inputs);
  return inputs.map((i) => scoreOne(i, ctx, weights, now));
}
