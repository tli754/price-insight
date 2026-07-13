import { describe, expect, it } from "vitest";

import {
  companySchema,
  scoreComponentsSchema,
  type CompanyDoc
} from "../db/collections.js";

const NOW = new Date("2026-07-01T00:00:00Z");

function makeCompany(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    domain: "example.com",
    platform: "shopify",
    country: "NZ",
    status: "scored",
    signals: {
      salesRevenue: 120000,
      hasMarketingAutomation: false,
      hasCrm: false,
      hasAi: false
    },
    contacts: [{ type: "email", value: "hi@example.com", isPrimary: true }],
    sources: [{ source: "seed-list", importedAt: NOW }],
    score: {
      overall: 82,
      components: { value: 0.9, gap: 0.7, reach: 0.6, recency: 1 },
      reasons: ["email on file"],
      weights: { value: 0.4, gap: 0.3, reach: 0.2, recency: 0.1 },
      scoredAt: NOW
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

describe("companySchema", () => {
  it("parses a valid companies document (and applies array/status defaults)", () => {
    const parsed = companySchema.parse(makeCompany());
    expect(parsed.domain).toBe("example.com");
    expect(parsed.status).toBe("scored");
    // defaulted arrays present even when omitted
    expect(Array.isArray(parsed.scoreHistory)).toBe(true);
    expect(parsed.scoreHistory).toEqual([]);
  });

  it("defaults status to 'new' and platform to 'unknown' when omitted", () => {
    const parsed = companySchema.parse(
      makeCompany({ status: undefined, platform: undefined })
    );
    expect(parsed.status).toBe("new");
    expect(parsed.platform).toBe("unknown");
  });

  it("fails when domain is missing", () => {
    const result = companySchema.safeParse(makeCompany({ domain: undefined }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "domain")).toBe(true);
    }
  });

  it("fails when status is not a known lifecycle token", () => {
    const result = companySchema.safeParse(makeCompany({ status: "bogus" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "status")).toBe(true);
    }
  });

  it("validates the embedded score.components shape", () => {
    // standalone component schema
    expect(scoreComponentsSchema.safeParse({ value: 0.5, gap: 0.5, reach: 0.5, recency: 0.5 }).success).toBe(true);
    // missing a component key on the embedded score fails the whole document
    const result = companySchema.safeParse(
      makeCompany({
        score: {
          overall: 50,
          components: { value: 0.5, gap: 0.5, reach: 0.5 }, // recency missing
          reasons: [],
          weights: {},
          scoredAt: NOW
        }
      })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.join(".") === "score.components.recency")
      ).toBe(true);
    }
  });

  it("infers a usable CompanyDoc type", () => {
    const doc: CompanyDoc = companySchema.parse(makeCompany());
    expect(doc.signals.hasAi).toBe(false);
  });
});
