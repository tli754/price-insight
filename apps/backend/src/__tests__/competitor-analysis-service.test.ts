import { describe, it, expect, vi, beforeEach } from "vitest";

import { CompetitorAnalysisService } from "../services/competitor-analysis-service.js";
import type { ProductRow } from "../db/schema.js";
import type { CompetitorResult } from "../services/dataforseo-service.js";

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
    extractedOldPrice: null,
    currency: "NZD",
    source: "Rival Store",
    link: "https://rival.example.com/widget",
    thumbnail: null,
    tag: null,
    country: "NZ",
    ...overrides
  };
}

// ── Mock factories ────────────────────────────────────────────────────────────

function makeDataForSeoService() {
  return { searchShoppingPrices: vi.fn().mockResolvedValue([]) };
}

function makeCompetitorRepo() {
  return {
    findOrCreateCompetitor: vi.fn().mockResolvedValue({ id: 1, name: "Rival Store", state: "active" }),
    replaceCompetitorProducts: vi.fn().mockResolvedValue([]),
    recordPriceInsight: vi.fn().mockResolvedValue(undefined),
    deleteSuggestedByProduct: vi.fn().mockResolvedValue(undefined),
    insertSuggestedCompetitors: vi.fn().mockResolvedValue(undefined),
    getDeletedExternalIds: vi.fn().mockResolvedValue(new Set()),
    getExistingCompetitorKeys: vi.fn().mockResolvedValue(new Set()),
    recordPricesForConfirmed: vi.fn().mockResolvedValue(undefined)
  };
}

// ── searchAndSuggest — query building ────────────────────────────────────────

describe("CompetitorAnalysisService.searchAndSuggest() — query and errors", () => {
  let dataForSeo: ReturnType<typeof makeDataForSeoService>;
  let repo: ReturnType<typeof makeCompetitorRepo>;
  let service: CompetitorAnalysisService;

  beforeEach(() => {
    dataForSeo = makeDataForSeoService();
    repo = makeCompetitorRepo();
    service = new CompetitorAnalysisService(dataForSeo as any, repo as any);
  });

  it("uses product.title only as the search query (brand is ignored)", async () => {
    dataForSeo.searchShoppingPrices.mockResolvedValue([makeCompetitorResult()]);

    await service.searchAndSuggest(makeProduct({ brand: "Nike", title: "Air Max 90" }));

    expect(dataForSeo.searchShoppingPrices).toHaveBeenCalledWith("Air Max 90", expect.any(Set), undefined);
  });

  it("passes the full title including spec suffixes to DataForSEO", async () => {
    dataForSeo.searchShoppingPrices.mockResolvedValue([makeCompetitorResult()]);

    await service.searchAndSuggest(makeProduct({
      brand: null,
      title: "Rechargeable Round Coffee Digital Scale with Timer – 3kg / 0.1g"
    }));

    expect(dataForSeo.searchShoppingPrices).toHaveBeenCalledWith(
      "Rechargeable Round Coffee Digital Scale with Timer – 3kg / 0.1g",
      expect.any(Set),
      undefined
    );
  });

  it("passes the full title including measurements to DataForSEO", async () => {
    dataForSeo.searchShoppingPrices.mockResolvedValue([makeCompetitorResult()]);

    await service.searchAndSuggest(makeProduct({ brand: null, title: "Coffee Canister 1.2L Airtight" }));

    expect(dataForSeo.searchShoppingPrices).toHaveBeenCalledWith("Coffee Canister 1.2L Airtight", expect.any(Set), undefined);
  });

  it("throws MISSING_PRODUCT_NAME when product has no brand or title", async () => {
    await expect(
      service.searchAndSuggest(makeProduct({ brand: null, title: null as any }))
    ).rejects.toMatchObject({ code: "MISSING_PRODUCT_NAME" });

    expect(dataForSeo.searchShoppingPrices).not.toHaveBeenCalled();
  });

  it("throws NO_COMPETITOR_RESULTS when DataForSEO returns an empty array", async () => {
    dataForSeo.searchShoppingPrices.mockResolvedValue([]);

    await expect(service.searchAndSuggest(makeProduct())).rejects.toMatchObject({
      code: "NO_COMPETITOR_RESULTS"
    });
  });
});

// ── saveCompetitors ───────────────────────────────────────────────────────────

describe("CompetitorAnalysisService.saveCompetitors()", () => {
  let dataForSeo: ReturnType<typeof makeDataForSeoService>;
  let repo: ReturnType<typeof makeCompetitorRepo>;
  let service: CompetitorAnalysisService;

  beforeEach(() => {
    dataForSeo = makeDataForSeoService();
    repo = makeCompetitorRepo();
    service = new CompetitorAnalysisService(dataForSeo as any, repo as any);
  });

  it("saves competitors and triggers price analysis", async () => {
    const selected = [makeCompetitorResult({ extractedPrice: 85.0 })];
    repo.replaceCompetitorProducts.mockResolvedValue([{ id: 1 }] as any);

    await service.saveCompetitors(makeProduct({ price: 99.99 }), selected);

    expect(repo.findOrCreateCompetitor).toHaveBeenCalledWith("Rival Store");
    expect(repo.replaceCompetitorProducts).toHaveBeenCalledOnce();
    expect(repo.recordPriceInsight).toHaveBeenCalledOnce();
  });

  it("skips price analysis when product.price is null", async () => {
    repo.replaceCompetitorProducts.mockResolvedValue([]);

    await service.saveCompetitors(makeProduct({ price: null }), [makeCompetitorResult()]);

    expect(repo.recordPriceInsight).not.toHaveBeenCalled();
  });

  it("normalises a blank source string to 'Unknown'", async () => {
    await service.saveCompetitors(makeProduct(), [makeCompetitorResult({ source: "   " })]);

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
