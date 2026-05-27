import { describe, it, expect, vi, beforeEach } from "vitest";

import { CompetitorAnalysisService } from "../services/competitor-analysis-service.js";
import type { ProductRow } from "../db/schema.js";
import type { CompetitorResult } from "../services/serp-api-service.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProduct(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 1,
    externalId: 111111111,
    status: "active",
    title: "Blue Widget",
    brand: "Acme",
    handle: "blue-widget",
    price: 99.99,
    currency: "NZD",
    thumbnail: null,
    tags: null,
    description: null,
    sku: null,
    weight: null,
    weightUnit: null,
    inventoryQuantity: 10,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides
  };
}

function makeCompetitorResult(overrides: Partial<CompetitorResult> = {}): CompetitorResult {
  return {
    title: "Competitor Widget",
    externalId: "ext-001",
    rawPrice: "$89.00",
    extractedPrice: 89.0,
    rawOldPrice: null,
    extractedOldPrice: null,
    currency: "NZD",
    source: "Rival Store",
    link: "https://rival.example.com/widget",
    thumbnail: null,
    tag: null,
    ...overrides
  };
}

// ── Mock factories ────────────────────────────────────────────────────────────

function makeSerpApi() {
  return { searchShoppingPrices: vi.fn().mockResolvedValue([]) };
}

function makeRedis() {
  return {
    connect: vi.fn(),
    quit: vi.fn(),
    ping: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1)
  };
}

function makeCompetitorRepo() {
  return {
    findOrCreateCompetitor: vi.fn().mockResolvedValue({ id: 1, name: "Rival Store", state: "active" }),
    replaceCompetitorProducts: vi.fn().mockResolvedValue([]),
    recordPriceInsight: vi.fn().mockResolvedValue(undefined)
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CompetitorAnalysisService.fetchCompetitors()", () => {
  let serpApi: ReturnType<typeof makeSerpApi>;
  let redis: ReturnType<typeof makeRedis>;
  let repo: ReturnType<typeof makeCompetitorRepo>;
  let service: CompetitorAnalysisService;

  beforeEach(() => {
    serpApi = makeSerpApi();
    redis = makeRedis();
    repo = makeCompetitorRepo();
    service = new CompetitorAnalysisService(serpApi as any, redis as any, repo as any);
  });

  it("returns cached result and skips SerpAPI on a cache hit", async () => {
    const cached = [makeCompetitorResult()];
    redis.get.mockResolvedValue(JSON.stringify(cached));

    const result = await service.fetchCompetitors(makeProduct());

    expect(result.cached).toBe(true);
    expect(result.competitors).toHaveLength(1);
    expect(serpApi.searchShoppingPrices).not.toHaveBeenCalled();
  });

  it("calls SerpAPI and stores results in cache on a cache miss", async () => {
    redis.get.mockResolvedValue(null);
    serpApi.searchShoppingPrices.mockResolvedValue([makeCompetitorResult()]);

    const result = await service.fetchCompetitors(makeProduct());

    expect(result.cached).toBe(false);
    expect(result.competitors).toHaveLength(1);
    expect(serpApi.searchShoppingPrices).toHaveBeenCalledWith("Acme Blue Widget");
    expect(redis.set).toHaveBeenCalledOnce();
  });

  it("builds the search query from brand + title", async () => {
    serpApi.searchShoppingPrices.mockResolvedValue([makeCompetitorResult()]);
    const product = makeProduct({ brand: "Nike", title: "Air Max 90" });

    await service.fetchCompetitors(product);

    expect(serpApi.searchShoppingPrices).toHaveBeenCalledWith("Nike Air Max 90");
  });

  it("throws MISSING_PRODUCT_NAME when product has no brand or title", async () => {
    const product = makeProduct({ brand: null, title: null as any });

    await expect(service.fetchCompetitors(product)).rejects.toMatchObject({
      code: "MISSING_PRODUCT_NAME"
    });
    expect(serpApi.searchShoppingPrices).not.toHaveBeenCalled();
  });

  it("throws NO_COMPETITOR_RESULTS when SerpAPI returns an empty array", async () => {
    redis.get.mockResolvedValue(null);
    serpApi.searchShoppingPrices.mockResolvedValue([]);

    await expect(service.fetchCompetitors(makeProduct())).rejects.toMatchObject({
      code: "NO_COMPETITOR_RESULTS"
    });
  });
});

describe("CompetitorAnalysisService.saveCompetitors()", () => {
  let serpApi: ReturnType<typeof makeSerpApi>;
  let redis: ReturnType<typeof makeRedis>;
  let repo: ReturnType<typeof makeCompetitorRepo>;
  let service: CompetitorAnalysisService;

  beforeEach(() => {
    serpApi = makeSerpApi();
    redis = makeRedis();
    repo = makeCompetitorRepo();
    service = new CompetitorAnalysisService(serpApi as any, redis as any, repo as any);
  });

  it("saves competitors, triggers price analysis, and busts the cache", async () => {
    const selected = [makeCompetitorResult({ extractedPrice: 85.0 })];
    repo.replaceCompetitorProducts.mockResolvedValue([{ id: 1 }] as any);

    await service.saveCompetitors(makeProduct({ price: 99.99 }), selected);

    expect(repo.findOrCreateCompetitor).toHaveBeenCalledWith("Rival Store");
    expect(repo.replaceCompetitorProducts).toHaveBeenCalledOnce();
    expect(repo.recordPriceInsight).toHaveBeenCalledOnce();
    expect(redis.del).toHaveBeenCalledWith("competitors:product:1");
  });

  it("skips price analysis when product.price is null", async () => {
    const selected = [makeCompetitorResult()];
    repo.replaceCompetitorProducts.mockResolvedValue([]);

    await service.saveCompetitors(makeProduct({ price: null }), selected);

    expect(repo.recordPriceInsight).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalled();
  });

  it("normalises a blank source string to 'Unknown'", async () => {
    const selected = [makeCompetitorResult({ source: "   " })];

    await service.saveCompetitors(makeProduct(), selected);

    expect(repo.findOrCreateCompetitor).toHaveBeenCalledWith("Unknown");
  });

  it("deduplicates sources — one findOrCreateCompetitor call per unique source", async () => {
    const selected = [
      makeCompetitorResult({ source: "Store A" }),
      makeCompetitorResult({ source: "Store A" }),
      makeCompetitorResult({ source: "Store B" })
    ];
    repo.findOrCreateCompetitor
      .mockResolvedValueOnce({ id: 1, name: "Store A", state: "active" })
      .mockResolvedValueOnce({ id: 2, name: "Store B", state: "active" });

    await service.saveCompetitors(makeProduct(), selected);

    expect(repo.findOrCreateCompetitor).toHaveBeenCalledTimes(2);
  });
});
