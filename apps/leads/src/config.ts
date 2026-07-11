// Tunable knobs for the deterministic pipeline. Kept in one place so the rubric
// can be adjusted without touching logic.

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
  /** Restrict to these 2-letter country codes. null disables the check. */
  allowedCountries: string[] | null;
  /** Reject platforms not in this set. null disables the check (keep everything,
   *  incl. 'unknown', so the crawler can detect platform later). */
  allowedPlatforms: string[] | null;
}

export const HARD_FILTER: HardFilterConfig = {
  minRevenue: 0,
  allowedCountries: null,
  allowedPlatforms: null
};

/** Recency decay (months) applied to last-activity dates. */
export const RECENCY = {
  freshMonths: 12, // full credit within this window
  staleMonths: 36, // decays to `floor` by here
  floor: 0.3,
  nullNeutral: 0.5 // score when no activity date is known
};
