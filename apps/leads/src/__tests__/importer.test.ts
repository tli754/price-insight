import { describe, expect, it, vi } from "vitest";

import { runImport } from "../import/importer.js";
import type { CompanyRepository, UpsertInput } from "../repo/company-repository.js";
import { scoreDataset } from "../score/score.js";
import { hardFilter } from "../filter/hard-filter.js";
import type { RawRow } from "../import/xlsx-parser.js";

const NOW = new Date("2026-07-12T00:00:00Z");

/** In-memory repository that records every upsert. */
function fakeRepo(): CompanyRepository & { calls: UpsertInput[] } {
  const calls: UpsertInput[] = [];
  return {
    calls,
    async upsertByDomain(input: UpsertInput) {
      calls.push(input);
    },
    // Read/query methods are unused by the importer — stubbed to satisfy the
    // expanded CompanyRepository surface.
    async list() {
      return { items: [], total: 0 };
    },
    async getById() {
      return null;
    },
    async updateStatus() {
      return false;
    }
  };
}

function row(overrides: RawRow = {}): RawRow {
  return {
    "Root Domain": "a.com",
    Company: "A",
    "eCommerce Platform": "Shopify",
    "Sales Revenue": 100000,
    "Technology Spend": 2000,
    SKU: 50,
    "Page Rank": 1000,
    Emails: "hi@a.com",
    Country: "NZ",
    "Last Indexed": 46300,
    ...overrides
  };
}

describe("runImport", () => {
  it("scores passers once (batch), rejects no-domain rows, and summarises", async () => {
    const repo = fakeRepo();
    const rows: RawRow[] = [
      row({ "Root Domain": "a.com" }),
      row({ "Root Domain": "b.com", "Sales Revenue": 5000 }),
      row({ "Root Domain": "  " }), // blank → no_domain reject, not persisted
      row({ "Root Domain": "a.com" }) // duplicate domain (idempotency handled by repo)
    ];
    const score = vi.fn(scoreDataset);

    const summary = await runImport("in-memory.xlsx", {
      repo,
      readRows: () => rows,
      score,
      now: NOW
    });

    expect(summary).toEqual({
      total: 4,
      rejected: 1,
      scored: 3,
      byReason: { no_domain: 1 }
    });

    // Batch scoring: called exactly once, over the 3 passers.
    expect(score).toHaveBeenCalledTimes(1);
    expect(score.mock.calls[0][0]).toHaveLength(3);

    // The domain-less row is counted but never upserted.
    expect(repo.calls).toHaveLength(3);
    expect(repo.calls.map((c) => c.domain)).toEqual(["a.com", "b.com", "a.com"]);
  });

  it("gives passers a score + exactly one history entry with status 'scored'", async () => {
    const repo = fakeRepo();
    const summary = await runImport("in-memory.xlsx", {
      repo,
      readRows: () => [row()],
      now: NOW
    });

    expect(summary.scored).toBe(1);
    const [call] = repo.calls;
    expect(call.status).toBe("scored");
    expect(call.fields.filterReason).toBeNull();
    expect(call.fields.score).toBeDefined();
    expect(call.fields.score?.scoredAt).toEqual(NOW);
    expect(call.fields.score?.weights).toMatchObject({ value: 0.4 });
    expect(call.scoreEntry).toBeDefined();
    expect(call.scoreEntry?.createdAt).toEqual(NOW);
    // One import → one appended history entry (append-only).
    expect(call.scoreEntry?.overall).toBe(call.fields.score?.overall);
    expect(call.source).toMatchObject({ source: "store-leads", sourceFile: "in-memory.xlsx" });
  });

  it("upserts a domain-bearing rejection with filterReason and no score", async () => {
    const repo = fakeRepo();
    // Inject a filter that rejects everything (simulates enabled ceilings).
    const summary = await runImport("in-memory.xlsx", {
      repo,
      readRows: () => [row({ "Root Domain": "big.com" })],
      filter: () => ({ pass: false, reason: "above_max_revenue" }),
      now: NOW
    });

    expect(summary).toEqual({
      total: 1,
      rejected: 1,
      scored: 0,
      byReason: { above_max_revenue: 1 }
    });
    const [call] = repo.calls;
    expect(call.domain).toBe("big.com");
    expect(call.status).toBe("rejected");
    expect(call.fields.filterReason).toBe("above_max_revenue");
    expect(call.fields.score).toBeUndefined();
    expect(call.scoreEntry).toBeUndefined();
  });

  it("returns an empty summary for a header-only / empty sheet", async () => {
    const repo = fakeRepo();
    const summary = await runImport("empty.xlsx", { repo, readRows: () => [], now: NOW });
    expect(summary).toEqual({ total: 0, rejected: 0, scored: 0, byReason: {} });
    expect(repo.calls).toHaveLength(0);
  });

  it("uses the real hard-filter by default (only no_domain rejects on this dataset)", async () => {
    const repo = fakeRepo();
    const summary = await runImport("in-memory.xlsx", {
      repo,
      readRows: () => [row(), row({ "Root Domain": null })],
      filter: hardFilter,
      now: NOW
    });
    expect(summary.scored).toBe(1);
    expect(summary.byReason).toEqual({ no_domain: 1 });
  });
});
