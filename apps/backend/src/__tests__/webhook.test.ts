import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { CompetitorResult, ShoppingCandidate } from "../services/dataforseo-service.js";
import type { ProductRow } from "../db/schema.js";
import { buildTestApp } from "./helpers/build-app.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<ShoppingCandidate> = {}): ShoppingCandidate {
  return {
    productId: "goog-prod-123",
    seller: "Shop A",
    title: "Blue Widget",
    price: 99,
    currency: "NZD",
    oldPrice: null,
    thumbnail: null,
    rating: null,
    reviewCount: null,
    tag: null,
    googlePosition: null,
    ...overrides
  };
}

function makeResult(overrides: Partial<CompetitorResult> = {}): CompetitorResult {
  return {
    title: "Blue Widget",
    externalId: "goog-prod-123",
    rawPrice: "$99.00",
    extractedPrice: 99,
    extractedOldPrice: null,
    currency: "NZD",
    source: "Shop A",
    link: "https://shopa.co.nz/widget",
    country: "NZ",
    thumbnail: null,
    tag: null,
    ...overrides
  };
}

function makeProduct(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 1,
    externalId: 111,
    status: "active",
    title: "Blue Widget",
    brand: null,
    handle: "blue-widget",
    price: 100,
    currency: "NZD",
    thumbnail: null,
    tags: null,
    description: null,
    sku: null,
    weight: null,
    weightUnit: null,
    inventoryQuantity: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

// ── URL helpers ───────────────────────────────────────────────────────────────

const SECRET = "fake-webhook-secret";

function shoppingUrl(overrides: Record<string, string> = {}): string {
  const p = new URLSearchParams({ secret: SECRET, id: "task-1", tag: "1", ...overrides });
  return `/webhook/dataforseo/pingback/shopping?${p}`;
}

function infoUrl(overrides: Record<string, string> = {}): string {
  const p = new URLSearchParams({ secret: SECRET, id: "task-1", tag: "1", ...overrides });
  return `/webhook/dataforseo/pingback/product_info?${p}`;
}

// ── Shopping pingback ─────────────────────────────────────────────────────────

describe("GET /webhook/dataforseo/pingback/shopping", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];
  let mocks: Awaited<ReturnType<typeof buildTestApp>>["mocks"];

  beforeEach(async () => {
    ({ app, mocks } = await buildTestApp());
  });
  afterEach(() => app.close());

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when secret is wrong", async () => {
    const res = await app.inject({ method: "GET", url: shoppingUrl({ secret: "WRONG" }) });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when secret is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/webhook/dataforseo/pingback/shopping?id=task-1&tag=1"
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Param validation ──────────────────────────────────────────────────────

  it("returns 200 and skips when taskId is missing", async () => {
    const res = await app.inject({ method: "GET", url: shoppingUrl({ id: "" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.dataForSeoService.fetchShoppingTaskResult).not.toHaveBeenCalled();
  });

  it("returns 200 and skips when productId is not a number", async () => {
    const res = await app.inject({ method: "GET", url: shoppingUrl({ tag: "abc" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.dataForSeoService.fetchShoppingTaskResult).not.toHaveBeenCalled();
  });

  it("returns 200 and skips when productId is zero", async () => {
    const res = await app.inject({ method: "GET", url: shoppingUrl({ tag: "0" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.dataForSeoService.fetchShoppingTaskResult).not.toHaveBeenCalled();
  });

  it("returns 200 and skips when productId is negative", async () => {
    const res = await app.inject({ method: "GET", url: shoppingUrl({ tag: "-5" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.dataForSeoService.fetchShoppingTaskResult).not.toHaveBeenCalled();
  });

  // ── DataForSEO fetch ──────────────────────────────────────────────────────

  it("returns 200 when task fetch throws", async () => {
    mocks.dataForSeoService.fetchShoppingTaskResult.mockRejectedValue(new Error("network error"));
    const res = await app.inject({ method: "GET", url: shoppingUrl() });
    expect(res.statusCode).toBe(200);
    expect(mocks.dataForSeoService.postProductInfoTasks).not.toHaveBeenCalled();
  });

  it("returns 200 and skips when no candidates found", async () => {
    mocks.dataForSeoService.parseShoppingCandidates.mockReturnValue([]);
    const res = await app.inject({ method: "GET", url: shoppingUrl() });
    expect(res.statusCode).toBe(200);
    expect(mocks.competitorRepository.getDeletedExternalIds).not.toHaveBeenCalled();
    expect(mocks.dataForSeoService.postProductInfoTasks).not.toHaveBeenCalled();
  });

  // ── Soft-delete filter ────────────────────────────────────────────────────

  it("returns 200 and skips when all candidates are soft-deleted", async () => {
    mocks.dataForSeoService.parseShoppingCandidates.mockReturnValue([
      makeCandidate({ productId: "deleted-prod" })
    ]);
    mocks.competitorRepository.getDeletedExternalIds.mockResolvedValue(new Set(["deleted-prod"]));

    const res = await app.inject({ method: "GET", url: shoppingUrl() });
    expect(res.statusCode).toBe(200);
    expect(mocks.dataForSeoService.postProductInfoTasks).not.toHaveBeenCalled();
  });

  it("filters out soft-deleted candidates before posting product_info tasks", async () => {
    mocks.dataForSeoService.parseShoppingCandidates.mockReturnValue([
      makeCandidate({ productId: "prod-1" }),
      makeCandidate({ productId: "prod-deleted" }),
      makeCandidate({ productId: "prod-2" })
    ]);
    mocks.competitorRepository.getDeletedExternalIds.mockResolvedValue(new Set(["prod-deleted"]));

    await app.inject({ method: "GET", url: shoppingUrl() });

    expect(mocks.dataForSeoService.postProductInfoTasks).toHaveBeenCalledWith(
      ["prod-1", "prod-2"],
      1,
      expect.any(String)
    );
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it("posts product_info tasks with correct productId from tag", async () => {
    mocks.dataForSeoService.parseShoppingCandidates.mockReturnValue([
      makeCandidate({ productId: "prod-42" })
    ]);

    await app.inject({ method: "GET", url: shoppingUrl({ tag: "7" }) });

    expect(mocks.dataForSeoService.postProductInfoTasks).toHaveBeenCalledWith(
      ["prod-42"],
      7,
      expect.any(String)
    );
  });

  it("includes secret, $id and $tag placeholders in the product_info pingback URL", async () => {
    mocks.dataForSeoService.parseShoppingCandidates.mockReturnValue([makeCandidate()]);

    await app.inject({ method: "GET", url: shoppingUrl() });

    const callbackUrl: string = mocks.dataForSeoService.postProductInfoTasks.mock.calls[0][2];
    expect(callbackUrl).toContain("/webhook/dataforseo/pingback/product_info");
    expect(callbackUrl).toContain(`secret=${SECRET}`);
    expect(callbackUrl).toContain("id=$id");
    expect(callbackUrl).toContain("tag=$tag");
  });

  it("returns 200 even when postProductInfoTasks throws", async () => {
    mocks.dataForSeoService.parseShoppingCandidates.mockReturnValue([makeCandidate()]);
    mocks.dataForSeoService.postProductInfoTasks.mockRejectedValue(new Error("API error"));

    const res = await app.inject({ method: "GET", url: shoppingUrl() });
    expect(res.statusCode).toBe(200);
  });
});

// ── Product info pingback ──────────────────────────────────────────────────────

describe("GET /webhook/dataforseo/pingback/product_info", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];
  let mocks: Awaited<ReturnType<typeof buildTestApp>>["mocks"];

  beforeEach(async () => {
    ({ app, mocks } = await buildTestApp());
    mocks.productRepository.getProductById.mockResolvedValue(makeProduct());
  });
  afterEach(() => app.close());

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when secret is wrong", async () => {
    const res = await app.inject({ method: "GET", url: infoUrl({ secret: "WRONG" }) });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when secret is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/webhook/dataforseo/pingback/product_info?id=task-1&tag=1"
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Param validation ──────────────────────────────────────────────────────

  it("returns 200 and skips when productId is invalid", async () => {
    const res = await app.inject({ method: "GET", url: infoUrl({ tag: "not-a-number" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.productRepository.getProductById).not.toHaveBeenCalled();
  });

  it("returns 200 and skips when product is not found", async () => {
    mocks.productRepository.getProductById.mockResolvedValue(null);
    const res = await app.inject({ method: "GET", url: infoUrl() });
    expect(res.statusCode).toBe(200);
    expect(mocks.dataForSeoService.fetchProductInfoTaskResult).not.toHaveBeenCalled();
  });

  // ── DataForSEO fetch ──────────────────────────────────────────────────────

  it("returns 200 when task fetch throws", async () => {
    mocks.dataForSeoService.fetchProductInfoTaskResult.mockRejectedValue(new Error("network error"));
    const res = await app.inject({ method: "GET", url: infoUrl() });
    expect(res.statusCode).toBe(200);
    expect(mocks.competitorRepository.upsertSuggestedCompetitor).not.toHaveBeenCalled();
  });

  it("returns 200 and skips when all results are filtered out", async () => {
    mocks.dataForSeoService.fetchProductInfoResults.mockReturnValue([
      makeResult({ country: "US" })
    ]);
    const res = await app.inject({ method: "GET", url: infoUrl() });
    expect(res.statusCode).toBe(200);
    expect(mocks.competitorRepository.upsertSuggestedCompetitor).not.toHaveBeenCalled();
  });

  // ── Country filter ────────────────────────────────────────────────────────

  it("keeps NZ and AU results, drops all others", async () => {
    mocks.dataForSeoService.fetchProductInfoResults.mockReturnValue([
      makeResult({ country: "NZ", source: "NZ Shop" }),
      makeResult({ country: "AU", source: "AU Shop" }),
      makeResult({ country: "US", source: "US Shop" }),
      makeResult({ country: null, source: "Unknown Shop" })
    ]);

    await app.inject({ method: "GET", url: infoUrl() });

    expect(mocks.competitorRepository.upsertSuggestedCompetitor).toHaveBeenCalledTimes(2);
    const sources = mocks.competitorRepository.upsertSuggestedCompetitor.mock.calls.map(
      (call: unknown[]) => (call[1] as { source: string }).source
    );
    expect(sources).toContain("NZ Shop");
    expect(sources).toContain("AU Shop");
    expect(sources).not.toContain("US Shop");
    expect(sources).not.toContain("Unknown Shop");
  });

  // ── Price range filter ────────────────────────────────────────────────────

  it("filters out prices below 50% of product price", async () => {
    // product price = 100, minimum = 50
    mocks.dataForSeoService.fetchProductInfoResults.mockReturnValue([
      makeResult({ extractedPrice: 49, source: "Too Cheap" }),
      makeResult({ extractedPrice: 50, source: "Lower Bound" })
    ]);

    await app.inject({ method: "GET", url: infoUrl() });

    expect(mocks.competitorRepository.upsertSuggestedCompetitor).toHaveBeenCalledTimes(1);
    const [, row] = mocks.competitorRepository.upsertSuggestedCompetitor.mock.calls[0];
    expect(row.source).toBe("Lower Bound");
  });

  it("filters out prices above 200% of product price", async () => {
    // product price = 100, maximum = 200
    mocks.dataForSeoService.fetchProductInfoResults.mockReturnValue([
      makeResult({ extractedPrice: 200, source: "Upper Bound" }),
      makeResult({ extractedPrice: 201, source: "Too Expensive" })
    ]);

    await app.inject({ method: "GET", url: infoUrl() });

    expect(mocks.competitorRepository.upsertSuggestedCompetitor).toHaveBeenCalledTimes(1);
    const [, row] = mocks.competitorRepository.upsertSuggestedCompetitor.mock.calls[0];
    expect(row.source).toBe("Upper Bound");
  });

  it("does not filter by price when product price is null", async () => {
    mocks.productRepository.getProductById.mockResolvedValue(makeProduct({ price: null }));
    mocks.dataForSeoService.fetchProductInfoResults.mockReturnValue([
      makeResult({ extractedPrice: 1, source: "Very Cheap" }),
      makeResult({ extractedPrice: 99999, source: "Very Expensive" })
    ]);

    await app.inject({ method: "GET", url: infoUrl() });

    expect(mocks.competitorRepository.upsertSuggestedCompetitor).toHaveBeenCalledTimes(2);
  });

  // ── Own store filter ──────────────────────────────────────────────────────

  it("filters out own store by name (case-insensitive)", async () => {
    const { app: ownApp, mocks: ownMocks } = await buildTestApp(
      {},
      { OWN_STORE_NAME: "White Donkey" }
    );
    ownMocks.productRepository.getProductById.mockResolvedValue(makeProduct());
    ownMocks.dataForSeoService.fetchProductInfoResults.mockReturnValue([
      makeResult({ source: "white donkey" }),   // lowercase — should be excluded
      makeResult({ source: "WHITE DONKEY" }),   // uppercase — should be excluded
      makeResult({ source: "Other Shop" })
    ]);

    await ownApp.inject({ method: "GET", url: infoUrl() });

    expect(ownMocks.competitorRepository.upsertSuggestedCompetitor).toHaveBeenCalledTimes(1);
    const [, row] = ownMocks.competitorRepository.upsertSuggestedCompetitor.mock.calls[0];
    expect(row.source).toBe("Other Shop");

    await ownApp.close();
  });

  it("does not filter by store name when OWN_STORE_NAME is not set", async () => {
    mocks.dataForSeoService.fetchProductInfoResults.mockReturnValue([
      makeResult({ source: "Any Store" })
    ]);

    await app.inject({ method: "GET", url: infoUrl() });

    expect(mocks.competitorRepository.upsertSuggestedCompetitor).toHaveBeenCalledTimes(1);
  });

  // ── DB writes ─────────────────────────────────────────────────────────────

  it("calls upsertSuggestedCompetitor with correct productId and row for each result", async () => {
    mocks.dataForSeoService.fetchProductInfoResults.mockReturnValue([
      makeResult({ source: "Shop A", extractedPrice: 99, country: "NZ" }),
      makeResult({ source: "Shop B", extractedPrice: 120, country: "AU" })
    ]);

    await app.inject({ method: "GET", url: infoUrl({ tag: "5" }) });

    expect(mocks.competitorRepository.upsertSuggestedCompetitor).toHaveBeenCalledTimes(2);
    expect(mocks.competitorRepository.upsertSuggestedCompetitor).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ source: "Shop A", extractedPrice: 99 })
    );
    expect(mocks.competitorRepository.upsertSuggestedCompetitor).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ source: "Shop B", extractedPrice: 120 })
    );
  });

  it("calls recordPricesForConfirmed with all saved rows", async () => {
    mocks.dataForSeoService.fetchProductInfoResults.mockReturnValue([
      makeResult({ source: "Shop A" }),
      makeResult({ source: "Shop B", country: "AU" })
    ]);

    await app.inject({ method: "GET", url: infoUrl({ tag: "3" }) });

    expect(mocks.competitorRepository.recordPricesForConfirmed).toHaveBeenCalledWith(
      3,
      expect.arrayContaining([
        expect.objectContaining({ source: "Shop A" }),
        expect.objectContaining({ source: "Shop B" })
      ])
    );
  });

  it("does not call recordPricesForConfirmed when all results are filtered", async () => {
    mocks.dataForSeoService.fetchProductInfoResults.mockReturnValue([
      makeResult({ country: "US" })
    ]);

    await app.inject({ method: "GET", url: infoUrl() });

    expect(mocks.competitorRepository.recordPricesForConfirmed).not.toHaveBeenCalled();
  });

  it("maps result fields correctly onto the saved row", async () => {
    mocks.dataForSeoService.fetchProductInfoResults.mockReturnValue([
      makeResult({
        title: "Widget Pro",
        externalId: "ext-999",
        rawPrice: "$99.00",
        extractedPrice: 99,
        extractedOldPrice: 120,
        currency: "NZD",
        source: "  Shop A  ",
        link: "https://shopa.co.nz/widget",
        country: "NZ",
        thumbnail: "https://img.example.com/w.jpg",
        tag: "sale",
        googlePosition: 3,
        rating: 4.5,
        reviewCount: 100,
        shippingRaw: "Free shipping",
        shippingExtracted: 0
      })
    ]);

    await app.inject({ method: "GET", url: infoUrl() });

    const [, row] = mocks.competitorRepository.upsertSuggestedCompetitor.mock.calls[0];
    expect(row).toMatchObject({
      title: "Widget Pro",
      externalId: "ext-999",
      rawPrice: "$99.00",
      extractedPrice: 99,
      extractedOldPrice: 120,
      currency: "NZD",
      source: "Shop A",        // trimmed
      productLink: "https://shopa.co.nz/widget",
      country: "NZ",
      thumbnail: "https://img.example.com/w.jpg",
      tag: "sale",
      googlePosition: 3,
      rating: 4.5,
      reviewCount: 100,
      shippingRaw: "Free shipping",
      shippingExtracted: 0,
      competitorId: null
    });
  });
});
