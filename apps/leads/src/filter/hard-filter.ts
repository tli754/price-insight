import { HARD_FILTER, type HardFilterConfig } from "../config.js";
import type { HardFilterInput, HardFilterResult } from "../domain/types.js";

/**
 * Deterministic qualify/reject gate applied at import (before crawling).
 * Rejections are conservative and config-driven — the goal is to drop clearly
 * unusable rows, not to rank (ranking is the scorer's job). `unknown` platforms
 * are intentionally NOT rejected: the crawler detects platform later.
 */
export function hardFilter(input: HardFilterInput, cfg: HardFilterConfig = HARD_FILTER): HardFilterResult {
  if (!input.domain || input.domain.trim() === "") {
    return { pass: false, reason: "no_domain" };
  }

  if (cfg.allowedPlatforms && input.platform && input.platform !== "unknown") {
    if (!cfg.allowedPlatforms.includes(String(input.platform))) {
      return { pass: false, reason: "unsupported_platform" };
    }
  }

  if (cfg.allowedCountries && input.country) {
    if (!cfg.allowedCountries.includes(input.country.toUpperCase())) {
      return { pass: false, reason: "country_not_allowed" };
    }
  }

  if (cfg.minRevenue > 0 && input.salesRevenue != null && input.salesRevenue < cfg.minRevenue) {
    return { pass: false, reason: "below_min_revenue" };
  }

  // Enterprise ceilings — only enforced when the knob is > 0 (default: disabled).
  // Exclude vendors that are too large for the ICP (they have internal teams).
  if (cfg.maxRevenue > 0 && input.salesRevenue != null && input.salesRevenue > cfg.maxRevenue) {
    return { pass: false, reason: "above_max_revenue" };
  }

  if (cfg.maxProductCount > 0 && input.productCount != null && input.productCount > cfg.maxProductCount) {
    return { pass: false, reason: "enterprise_catalog" };
  }

  return { pass: true, reason: null };
}
