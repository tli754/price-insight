import { describe, it, expect } from "vitest";

import { CompetitorRepository } from "../services/competitor-repository.js";
import { makeMockDb } from "./helpers/mock-db.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fakeCompetitorRow = {
  id: 1,
  name: "Rival Store",
  state: "active",
  thumbnail: null,
  createdAt: new Date("2024-01-01")
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CompetitorRepository.getAllCompetitors()", () => {
  it("returns aggregated competitor list", async () => {
    const db = makeMockDb();
    db._select.orderBy.mockResolvedValueOnce([
      { ...fakeCompetitorRow, matchedProducts: 3, lastScraped: null }
    ]);
    const repo = new CompetitorRepository(db as any);

    const result = await repo.getAllCompetitors();

    expect(db.select).toHaveBeenCalledOnce();
    expect(db._select.orderBy).toHaveBeenCalledOnce();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Rival Store");
  });

  it("returns an empty array when there are no competitors", async () => {
    const db = makeMockDb();
    db._select.orderBy.mockResolvedValueOnce([]);
    const repo = new CompetitorRepository(db as any);

    const result = await repo.getAllCompetitors();

    expect(result).toEqual([]);
  });
});

describe("CompetitorRepository.getCompetitorById()", () => {
  it("returns the competitor row when found", async () => {
    const db = makeMockDb();
    db._select.limit.mockResolvedValueOnce([fakeCompetitorRow]);
    const repo = new CompetitorRepository(db as any);

    const result = await repo.getCompetitorById(1);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(1);
    expect(result!.name).toBe("Rival Store");
  });

  it("returns null when the competitor does not exist", async () => {
    const db = makeMockDb();
    db._select.limit.mockResolvedValueOnce([]);
    const repo = new CompetitorRepository(db as any);

    const result = await repo.getCompetitorById(999);

    expect(result).toBeNull();
  });
});

describe("CompetitorRepository.findOrCreateCompetitor()", () => {
  it("returns the existing competitor without inserting", async () => {
    const db = makeMockDb();
    // First select: existing found
    db._select.limit.mockResolvedValueOnce([fakeCompetitorRow]);
    const repo = new CompetitorRepository(db as any);

    const result = await repo.findOrCreateCompetitor("Rival Store");

    expect(db.insert).not.toHaveBeenCalled();
    expect(result.id).toBe(1);
    expect(result.name).toBe("Rival Store");
  });

  it("inserts a new competitor and returns it when not found", async () => {
    const db = makeMockDb();
    // First select: not found
    db._select.limit.mockResolvedValueOnce([]);
    // $returningId returns new id 7
    // Second select: fetch the newly created row
    db._select.limit.mockResolvedValueOnce([{ ...fakeCompetitorRow, id: 7, name: "New Store" }]);
    const repo = new CompetitorRepository(db as any);

    const result = await repo.findOrCreateCompetitor("New Store");

    expect(db.insert).toHaveBeenCalledOnce();
    expect(result.id).toBe(7);
    expect(result.name).toBe("New Store");
  });
});

describe("CompetitorRepository.getSavedCompetitorsWithPrice()", () => {
  it("returns saved competitors with price data for a product", async () => {
    const db = makeMockDb();
    db._select.orderBy.mockResolvedValueOnce([
      { id: 1, title: "Widget XL", extractedPrice: 85.0, capturedAt: new Date() }
    ]);
    const repo = new CompetitorRepository(db as any);

    const result = await repo.getSavedCompetitorsWithPrice(1);

    expect(db._select.leftJoin).toHaveBeenCalledOnce();
    expect(result).toHaveLength(1);
    expect(result[0].extractedPrice).toBe(85.0);
  });

  it("returns an empty array when no competitors are saved", async () => {
    const db = makeMockDb();
    db._select.orderBy.mockResolvedValueOnce([]);
    const repo = new CompetitorRepository(db as any);

    const result = await repo.getSavedCompetitorsWithPrice(42);

    expect(result).toEqual([]);
  });
});

describe("CompetitorRepository.getProductsByCompetitorId()", () => {
  it("returns products linked to a competitor", async () => {
    const db = makeMockDb();
    db._select.orderBy.mockResolvedValueOnce([
      { id: 10, title: "Widget", productLink: "https://rival.example.com", currentPrice: 79.99 }
    ]);
    const repo = new CompetitorRepository(db as any);

    const result = await repo.getProductsByCompetitorId(1);

    expect(db._select.leftJoin).toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });
});
