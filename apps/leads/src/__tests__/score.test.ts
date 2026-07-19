import { describe, expect, it } from "vitest";

import { buildScoringContext, recencyScore, scoreDataset, scoreOne } from "../score/score.js";
import { bandScore } from "../score/band.js";
import type { ScoreInput, ValueBandConfig } from "../domain/types.js";

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

const BAND: ValueBandConfig = { rampTop: 0.4, plateauTop: 0.85, decayFloor: 0.3 };

describe("bandScore", () => {
  it("ramps 0→1, plateaus, then decays to the floor", () => {
    expect(bandScore(0, BAND)).toBe(0);
    expect(bandScore(0.2, BAND)).toBeCloseTo(0.5, 10); // half-way up the ramp
    expect(bandScore(BAND.rampTop, BAND)).toBe(1); // top of ramp
    expect(bandScore(0.6, BAND)).toBe(1); // inside the sweet-spot plateau
    expect(bandScore(BAND.plateauTop, BAND)).toBe(1); // top of plateau
    expect(bandScore(1, BAND)).toBeCloseTo(BAND.decayFloor, 10); // enterprise tail → floor
  });

  it("is non-monotonic: a mid percentile beats a top percentile", () => {
    expect(bandScore(0.6, BAND)).toBeGreaterThan(bandScore(0.98, BAND));
  });
});

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

  it("value is non-monotonic in size: a mid-sized lead beats an enterprise one", () => {
    // 11 rows differing only in revenue → percentiles (k+0.5)/11 for distinct k.
    const rows: ScoreInput[] = Array.from({ length: 11 }, (_, i) => make({ salesRevenue: i * 10_000 }));
    const results = scoreDataset(rows, undefined, NOW);
    const mid = results[6]; // pct ≈ 0.59 → sweet-spot plateau
    const top = results[10]; // pct ≈ 0.95 → enterprise tail (down-weighted)

    expect(mid.components.value).toBeGreaterThan(top.components.value);
    expect(mid.reasons).toContain("sweet-spot size");
    expect(top.reasons).toContain("enterprise-scale (down-weighted)");
  });
});
