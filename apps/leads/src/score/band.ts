import type { ValueBandConfig } from "../domain/types.js";

/**
 * Sweet-spot band curve for a size percentile (in [0,1]). Deterministic and
 * explainable — three regimes:
 *
 *   pct <= rampTop      -> pct / rampTop                                        (ramp 0→1)
 *   pct <= plateauTop   -> 1                                                    (sweet-spot plateau)
 *   else                -> 1 - ((pct - plateauTop)/(1 - plateauTop))*(1 - decayFloor)  (decay → floor)
 *
 * The decay down-weights (but does not zero out) the enterprise tail, so being
 * "too big" is penalised symmetrically to being "too small".
 */
export function bandScore(pct: number, cfg: ValueBandConfig): number {
  if (pct <= cfg.rampTop) {
    return cfg.rampTop > 0 ? pct / cfg.rampTop : 1;
  }
  if (pct <= cfg.plateauTop) {
    return 1;
  }
  // plateauTop < 1 here (otherwise the previous branch caught it), so no /0.
  return 1 - ((pct - cfg.plateauTop) / (1 - cfg.plateauTop)) * (1 - cfg.decayFloor);
}
