// Tunable knobs for the deterministic pipeline. Kept in one place so the rubric
// can be adjusted without touching logic.

import type { ValueBandConfig } from "./domain/types.js";

export interface ScoreWeights {
  value: number;
  gap: number;
  reach: number;
  recency: number;
}

export const WEIGHTS: ScoreWeights = {
  value: 0.4,
  gap: 0.3,
  reach: 0.2,
  recency: 0.1
};

/** Leads scoring at/above this (0..100) are eligible for Phase-3 AI analysis. */
export const AI_SCORE_THRESHOLD = 70;

export interface HardFilterConfig {
  /** Reject when revenue is known and below this. 0 disables the check. */
  minRevenue: number;
  /** Reject when revenue is known and ABOVE this (enterprise ceiling). 0 disables. */
  maxRevenue: number;
  /** Reject when SKU count is known and ABOVE this (enterprise catalog). 0 disables. */
  maxProductCount: number;
  /** Restrict to these 2-letter country codes. null disables the check. */
  allowedCountries: string[] | null;
  /** Reject platforms not in this set. null disables the check (keep everything,
   *  incl. 'unknown', so the crawler can detect platform later). */
  allowedPlatforms: string[] | null;
}

export const HARD_FILTER: HardFilterConfig = {
  minRevenue: 0,
  // Enterprise ceilings are DEFAULT DISABLED (0). We lack calibration data, and
  // the VALUE_BAND curve already *softly* down-weights the enterprise tail, so a
  // hard cut here risks dropping good leads. Enable + tune once Tao calibrates.
  // Suggested placeholder starting points: maxRevenue: 50_000_000, maxProductCount: 10_000.
  maxRevenue: 0,
  maxProductCount: 0,
  allowedCountries: null,
  allowedPlatforms: null
};

/**
 * Sweet-spot band for the SIZE value signals (revenue percentile, SKU percentile).
 * Percentiles below `rampTop` ramp up linearly; between `rampTop` and `plateauTop`
 * sit in the sweet spot (full credit); above `plateauTop` decay toward `decayFloor`
 * at percentile 1.0. This makes Value non-monotonic: mid-sized SMEs beat both
 * micro-sellers and enterprise vendors — matching the ICP.
 */
export const VALUE_BAND: ValueBandConfig = {
  rampTop: 0.4,
  plateauTop: 0.85,
  decayFloor: 0.3
};

/** Recency decay (months) applied to last-activity dates. */
export const RECENCY = {
  freshMonths: 12, // full credit within this window
  staleMonths: 36, // decays to `floor` by here
  floor: 0.3,
  nullNeutral: 0.5 // score when no activity date is known
};
