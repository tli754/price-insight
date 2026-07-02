import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { ShoppingCandidate, CompetitorResult } from "../services/dataforseo-service.js";
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
  return `/webhooks/dataforseo/pingback/shopping?${p}`;
}

function infoUrl(overrides: Record<string, string> = {}): string {
  const p = new URLSearchParams({ secret: SECRET, id: "task-1", tag: "1", ...overrides });
  return `/webhooks/dataforseo/pingback/product_info?${p}`;
}

// ── Shopping pingback ─────────────────────────────────────────────────────────

describe("GET /webhooks/dataforseo/pingback/shopping", () => {
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
      url: "/webhooks/dataforseo/pingback/shopping?id=task-1&tag=1"
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Param validation ──────────────────────────────────────────────────────

  it("returns 200 and skips when taskId is missing", async () => {
    const res = await app.inject({ method: "GET", url: shoppingUrl({ id: "" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.cloudTasksCompetitorClient!.enqueue).not.toHaveBeenCalled();
  });

  it("returns 200 and skips when productId is not a number", async () => {
    const res = await app.inject({ method: "GET", url: shoppingUrl({ tag: "abc" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.cloudTasksCompetitorClient!.enqueue).not.toHaveBeenCalled();
  });

  it("returns 200 and skips when productId is zero", async () => {
    const res = await app.inject({ method: "GET", url: shoppingUrl({ tag: "0" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.cloudTasksCompetitorClient!.enqueue).not.toHaveBeenCalled();
  });

  it("returns 200 and skips when productId is negative", async () => {
    const res = await app.inject({ method: "GET", url: shoppingUrl({ tag: "-5" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.cloudTasksCompetitorClient!.enqueue).not.toHaveBeenCalled();
  });

  // ── Enqueue path ──────────────────────────────────────────────────────────

  it("enqueues a process-shopping-pingback task and returns 200", async () => {
    const res = await app.inject({ method: "GET", url: shoppingUrl({ id: "task-42", tag: "7" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.cloudTasksCompetitorClient!.enqueue).toHaveBeenCalledWith({
      type: "process-shopping-pingback",
      taskId: "task-42",
      productId: 7,
    });
    expect(mocks.dataForSeoService.fetchShoppingTaskResult).not.toHaveBeenCalled();
  });

  // ── Inline fallback (cloudTasksCompetitorClient: null) ────────────────────

  describe("inline fallback", () => {
    beforeEach(async () => {
      await app.close();
      ({ app, mocks } = await buildTestApp({ cloudTasksCompetitorClient: null }));
    });

    it("fetches from DataForSEO inline when no Cloud Tasks client", async () => {
      await app.inject({ method: "GET", url: shoppingUrl() });
      expect(mocks.dataForSeoService.fetchShoppingTaskResult).toHaveBeenCalledWith("task-1");
    });

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
      expect(mocks.dataForSeoService.postProductInfoTasks).not.toHaveBeenCalled();
    });

    it("filters soft-deleted candidates before posting product_info tasks", async () => {
      mocks.dataForSeoService.parseShoppingCandidates.mockReturnValue([
        makeCandidate({ productId: "prod-1" }),
        makeCandidate({ productId: "prod-deleted" }),
      ]);
      mocks.competitorRepository.getDeletedExternalIds.mockResolvedValue(new Set(["prod-deleted"]));

      await app.inject({ method: "GET", url: shoppingUrl() });

      expect(mocks.dataForSeoService.postProductInfoTasks).toHaveBeenCalledWith(
        ["prod-1"],
        1,
        expect.any(String)
      );
    });

    it("returns 200 even when postProductInfoTasks throws", async () => {
      mocks.dataForSeoService.parseShoppingCandidates.mockReturnValue([makeCandidate()]);
      mocks.dataForSeoService.postProductInfoTasks.mockRejectedValue(new Error("API error"));

      const res = await app.inject({ method: "GET", url: shoppingUrl() });
      expect(res.statusCode).toBe(200);
    });
  });
});

// ── Product info pingback ─────────────────────────────────────────────────────

describe("GET /webhooks/dataforseo/pingback/product_info", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];
  let mocks: Awaited<ReturnType<typeof buildTestApp>>["mocks"];

  beforeEach(async () => {
    ({ app, mocks } = await buildTestApp());
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
      url: "/webhooks/dataforseo/pingback/product_info?id=task-1&tag=1"
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Param validation ──────────────────────────────────────────────────────

  it("returns 200 and skips when productId is invalid", async () => {
    const res = await app.inject({ method: "GET", url: infoUrl({ tag: "not-a-number" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.cloudTasksCompetitorClient!.enqueue).not.toHaveBeenCalled();
  });

  it("returns 200 and skips when taskId is missing", async () => {
    const res = await app.inject({ method: "GET", url: infoUrl({ id: "" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.cloudTasksCompetitorClient!.enqueue).not.toHaveBeenCalled();
  });

  // ── Enqueue path ──────────────────────────────────────────────────────────

  it("enqueues a process-product-info-pingback task and returns 200", async () => {
    const res = await app.inject({ method: "GET", url: infoUrl({ id: "task-99", tag: "5" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.cloudTasksCompetitorClient!.enqueue).toHaveBeenCalledWith({
      type: "process-product-info-pingback",
      taskId: "task-99",
      productId: 5,
    });
    expect(mocks.dataForSeoService.fetchProductInfoTaskResult).not.toHaveBeenCalled();
  });

  // ── Inline fallback (cloudTasksCompetitorClient: null) ────────────────────

  describe("inline fallback", () => {
    beforeEach(async () => {
      await app.close();
      ({ app, mocks } = await buildTestApp({ cloudTasksCompetitorClient: null }));
      mocks.productRepository.getProductById.mockResolvedValue(makeProduct());
    });

    it("fetches from DataForSEO inline when no Cloud Tasks client", async () => {
      await app.inject({ method: "GET", url: infoUrl() });
      expect(mocks.dataForSeoService.fetchProductInfoTaskResult).toHaveBeenCalledWith("task-1");
    });

    it("returns 200 when product not found", async () => {
      mocks.productRepository.getProductById.mockResolvedValue(null);
      const res = await app.inject({ method: "GET", url: infoUrl() });
      expect(res.statusCode).toBe(200);
      expect(mocks.dataForSeoService.fetchProductInfoTaskResult).not.toHaveBeenCalled();
    });

    it("returns 200 when task fetch throws", async () => {
      mocks.dataForSeoService.fetchProductInfoTaskResult.mockRejectedValue(new Error("network error"));
      const res = await app.inject({ method: "GET", url: infoUrl() });
      expect(res.statusCode).toBe(200);
      expect(mocks.competitorRepository.upsertSuggestedCompetitor).not.toHaveBeenCalled();
    });

    it("upserts NZ/AU results and returns 200", async () => {
      mocks.dataForSeoService.fetchProductInfoResults.mockReturnValue([
        makeResult({ country: "NZ", source: "Shop A" })
      ]);
      const res = await app.inject({ method: "GET", url: infoUrl() });
      expect(res.statusCode).toBe(200);
      expect(mocks.competitorRepository.upsertSuggestedCompetitor).toHaveBeenCalledTimes(1);
    });
  });
});
