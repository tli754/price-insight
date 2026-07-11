import { describe, expect, it } from "vitest";

import { buildScoringContext, recencyScore, scoreDataset, scoreOne } from "../score/score.js";
import type { ScoreInput } from "../domain/types.js";

const NOW = new Date("2026-07-01T00:00:00Z");

function make(overrides: Partial<ScoreInput>): ScoreInput {
  return {
    salesRevenue: null,
    technologySpend: null,
    productCount: null,
    prominenceRank: null,
    hasAi: false,
    hasCrm: false,
    hasMarketingAutomation: false,
    hasEmail: false,
    hasPhone: false,
    hasNamedPerson: false,
    lastActivityAt: null,
    ...overrides
  };
}

describe("recencyScore", () => {
  it("full credit when fresh, floor when stale, neutral when unknown", () => {
    expect(recencyScore(new Date("2026-06-01T00:00:00Z"), NOW)).toBe(1);
    expect(recencyScore(new Date("2020-01-01T00:00:00Z"), NOW)).toBe(0.3);
    expect(recencyScore(null, NOW)).toBe(0.5);
  });
});

describe("scoreOne / scoreDataset", () => {
  const dataset: ScoreInput[] = [
    // strong: high revenue, automation gap, reachable, fresh
    make({
      salesRevenue: 200000,
      technologySpend: 5000,
      productCount: 500,
      prominenceRank: 10,
      hasEmail: true,
      hasNamedPerson: true,
      lastActivityAt: new Date("2026-06-01T00:00:00Z")
    }),
    // weak: low everything, already has AI+CRM, unreachable, stale
    make({
      salesRevenue: 5000,
      technologySpend: 100,
      productCount: 5,
      prominenceRank: 5_000_000,
      hasAi: true,
      hasCrm: true,
      lastActivityAt: new Date("2020-01-01T00:00:00Z")
    })
  ];

  it("ranks the strong lead above the weak one", () => {
    const [strong, weak] = scoreDataset(dataset, undefined, NOW);
    expect(strong.overall).toBeGreaterThan(weak.overall);
    expect(strong.overall).toBeGreaterThan(60);
    expect(weak.overall).toBeLessThan(40);
  });

  it("surfaces reasons and clamps components to 0..1", () => {
    const ctx = buildScoringContext(dataset);
    const strong = scoreOne(dataset[0], ctx, undefined, NOW);
    expect(strong.reasons).toContain("no AI tooling");
    expect(strong.reasons).toContain("email on file");
    for (const c of Object.values(strong.components)) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it("handles all-missing value signals without NaN", () => {
    const [only] = scoreDataset([make({ hasEmail: true })], undefined, NOW);
    expect(Number.isNaN(only.overall)).toBe(false);
    expect(only.components.value).toBe(0);
  });
});
