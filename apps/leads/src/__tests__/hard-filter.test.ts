import { describe, expect, it } from "vitest";

import { hardFilter } from "../filter/hard-filter.js";
import type { HardFilterInput } from "../domain/types.js";

const base: HardFilterInput = {
  domain: "karibou.co.nz",
  country: "NZ",
  platform: "shopify",
  salesRevenue: 84553
};

describe("hardFilter", () => {
  it("passes a valid row with default config", () => {
    expect(hardFilter(base)).toEqual({ pass: true, reason: null });
  });

  it("rejects a missing domain", () => {
    expect(hardFilter({ ...base, domain: null })).toEqual({ pass: false, reason: "no_domain" });
  });

  it("rejects below minRevenue when configured", () => {
    const r = hardFilter({ ...base, salesRevenue: 1000 }, { minRevenue: 5000, allowedCountries: null, allowedPlatforms: null });
    expect(r).toEqual({ pass: false, reason: "below_min_revenue" });
  });

  it("rejects disallowed country when configured", () => {
    const r = hardFilter(base, { minRevenue: 0, allowedCountries: ["AU"], allowedPlatforms: null });
    expect(r).toEqual({ pass: false, reason: "country_not_allowed" });
  });

  it("does not reject unknown platform even with an allowlist", () => {
    const r = hardFilter(
      { ...base, platform: "unknown" },
      { minRevenue: 0, allowedCountries: null, allowedPlatforms: ["shopify"] }
    );
    expect(r.pass).toBe(true);
  });
});
