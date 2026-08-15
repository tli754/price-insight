import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { CompetitorResult, ShoppingCandidate } from "../services/dataforseo-service.js";
import type { ProductRow } from "../db/schema.js";
import { buildTestApp } from "./helpers/build-app.js";

// ── OIDC mock ─────────────────────────────────────────────────────────────────

const EXPECTED_SA = "price-insight-invoker@wd-tools.iam.gserviceaccount.com";

const { mockVerifyIdToken } = vi.hoisted(() => ({ mockVerifyIdToken: vi.fn() }));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken(...args: unknown[]) {
      return mockVerifyIdToken(...args);
    }
  },
}));

function validToken() {
  mockVerifyIdToken.mockResolvedValue({
    getPayload: () => ({ email: EXPECTED_SA, email_verified: true }),
  });
}

function invalidToken() {
  mockVerifyIdToken.mockRejectedValue(new Error("Invalid token signature"));
}

const AUTH = { Authorization: `Bearer valid-token` };
const ENV_OVERRIDES = { INTERNAL_OIDC_SERVICE_ACCOUNT: EXPECTED_SA };

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<ShoppingCandidate> = {}): ShoppingCandidate {
  return {
    productId: "goog-prod-123", seller: "Shop A", title: "Blue Widget", price: 99, currency: "NZD",
    oldPrice: null, thumbnail: null, rating: null, reviewCount: null, tag: null, googlePosition: null,
    ...overrides,
  };
}

function makeResult(overrides: Partial<CompetitorResult> = {}): CompetitorResult {
  return {
    title: "Blue Widget", externalId: "goog-prod-123", rawPrice: "$99.00", extractedPrice: 99,
    extractedOldPrice: null, currency: "NZD", source: "Shop A", link: "https://shopa.co.nz/widget",
    country: "NZ", thumbnail: null, tag: null,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 1, externalId: 111, status: "active", title: "Blue Widget", brand: null, handle: "blue-widget",
    price: 100, cost: null, currency: "NZD", thumbnail: null, tags: null, description: null, sku: null,
    weight: null, weightUnit: null, inventoryQuantity: 10, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function shoppingMsg(overrides: Partial<{ taskId: string; productId: number }> = {}) {
  return { type: "process-shopping-pingback" as const, taskId: "task-1", productId: 1, ...overrides };
}

function productInfoMsg(overrides: Partial<{ taskId: string; productId: number }> = {}) {
  return { type: "process-product-info-pingback" as const, taskId: "task-1", productId: 1, ...overrides };
}

describe("POST /internal/competitor-drain-run", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];
  let mocks: Awaited<ReturnType<typeof buildTestApp>>["mocks"];

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => app?.close());

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when Authorization header is missing", async () => {
    ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
    const res = await app.inject({ method: "POST", url: "/internal/competitor-drain-run" });
    expect(res.statusCode).toBe(401);
    expect(mocks.pgmqClient.read).not.toHaveBeenCalled();
  });

  it("returns 401 when token verification fails", async () => {
    invalidToken();
    ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
    const res = await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when OIDC service account is not configured", async () => {
    validToken();
    ({ app, mocks } = await buildTestApp({}, {}));
    const res = await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });
    expect(res.statusCode).toBe(401);
  });

  // ── Empty queue ───────────────────────────────────────────────────────────

  it("returns 200 with all-zero counts when the queue is empty", async () => {
    validToken();
    ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
    const res = await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ processed: 0, failed: 0, archived: 0 });
  });

  // ── process-shopping-pingback ─────────────────────────────────────────────

  describe("process-shopping-pingback messages", () => {
    it("posts product_info tasks and deletes the message on success", async () => {
      validToken();
      ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
      mocks.dataForSeoService.parseShoppingCandidates.mockReturnValue([makeCandidate({ productId: "prod-42" })]);
      mocks.pgmqClient.read
        .mockResolvedValueOnce({ msgId: 1, readCt: 1, message: shoppingMsg({ productId: 7 }) })
        .mockResolvedValueOnce(null);

      const res = await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ processed: 1, failed: 0 });
      expect(mocks.dataForSeoService.postProductInfoTasks).toHaveBeenCalledWith(["prod-42"], 7, expect.any(String));
      expect(mocks.pgmqClient.delete).toHaveBeenCalledWith("dataforseo_competitors", 1);
    });

    it("includes secret and $id/$tag placeholders in the product_info pingback URL", async () => {
      validToken();
      ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
      mocks.dataForSeoService.parseShoppingCandidates.mockReturnValue([makeCandidate()]);
      mocks.pgmqClient.read.mockResolvedValueOnce({ msgId: 1, readCt: 1, message: shoppingMsg() }).mockResolvedValueOnce(null);

      await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });

      const callbackUrl: string = mocks.dataForSeoService.postProductInfoTasks.mock.calls[0][2];
      expect(callbackUrl).toContain("/webhooks/dataforseo/pingback/product_info");
      expect(callbackUrl).toContain("secret=fake-webhook-secret");
      expect(callbackUrl).toContain("id=$id");
      expect(callbackUrl).toContain("tag=$tag");
    });

    it("counts as processed (no candidates) without calling postProductInfoTasks", async () => {
      validToken();
      ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
      mocks.dataForSeoService.parseShoppingCandidates.mockReturnValue([]);
      mocks.pgmqClient.read.mockResolvedValueOnce({ msgId: 1, readCt: 1, message: shoppingMsg() }).mockResolvedValueOnce(null);

      const res = await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });

      expect(res.json()).toMatchObject({ processed: 1, failed: 0 });
      expect(mocks.dataForSeoService.postProductInfoTasks).not.toHaveBeenCalled();
    });

    it("filters out soft-deleted candidates before posting product_info tasks", async () => {
      validToken();
      ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
      mocks.dataForSeoService.parseShoppingCandidates.mockReturnValue([
        makeCandidate({ productId: "prod-1" }),
        makeCandidate({ productId: "prod-deleted" }),
      ]);
      mocks.competitorRepository.getDeletedExternalIds.mockResolvedValue(new Set(["prod-deleted"]));
      mocks.pgmqClient.read.mockResolvedValueOnce({ msgId: 1, readCt: 1, message: shoppingMsg({ productId: 1 }) }).mockResolvedValueOnce(null);

      await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });

      expect(mocks.dataForSeoService.postProductInfoTasks).toHaveBeenCalledWith(["prod-1"], 1, expect.any(String));
    });

    it("leaves the message in the queue (no delete) when the task fetch throws", async () => {
      validToken();
      ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
      mocks.dataForSeoService.fetchShoppingTaskResult.mockRejectedValue(new Error("network error"));
      mocks.pgmqClient.read.mockResolvedValueOnce({ msgId: 1, readCt: 1, message: shoppingMsg() }).mockResolvedValueOnce(null);

      const res = await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ processed: 0, failed: 1, archived: 0 });
      expect(mocks.pgmqClient.delete).not.toHaveBeenCalled();
    });

    it("leaves the message in the queue when postProductInfoTasks throws", async () => {
      validToken();
      ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
      mocks.dataForSeoService.parseShoppingCandidates.mockReturnValue([makeCandidate()]);
      mocks.dataForSeoService.postProductInfoTasks.mockRejectedValue(new Error("API error"));
      mocks.pgmqClient.read.mockResolvedValueOnce({ msgId: 1, readCt: 1, message: shoppingMsg() }).mockResolvedValueOnce(null);

      const res = await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });

      expect(res.json()).toMatchObject({ processed: 0, failed: 1 });
      expect(mocks.pgmqClient.delete).not.toHaveBeenCalled();
    });
  });

  // ── process-product-info-pingback ─────────────────────────────────────────

  describe("process-product-info-pingback messages", () => {
    it("counts as processed (skip) when product is not found", async () => {
      validToken();
      ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
      mocks.productRepository.getProductById.mockResolvedValue(null);
      mocks.pgmqClient.read.mockResolvedValueOnce({ msgId: 1, readCt: 1, message: productInfoMsg() }).mockResolvedValueOnce(null);

      const res = await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });

      expect(res.json()).toMatchObject({ processed: 1, failed: 0 });
      expect(mocks.dataForSeoService.fetchProductInfoTaskResult).not.toHaveBeenCalled();
      expect(mocks.pgmqClient.delete).toHaveBeenCalledWith("dataforseo_competitors", 1);
    });

    it("leaves the message in the queue when the task fetch throws", async () => {
      validToken();
      ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
      mocks.productRepository.getProductById.mockResolvedValue(makeProduct());
      mocks.dataForSeoService.fetchProductInfoTaskResult.mockRejectedValue(new Error("network error"));
      mocks.pgmqClient.read.mockResolvedValueOnce({ msgId: 1, readCt: 1, message: productInfoMsg() }).mockResolvedValueOnce(null);

      const res = await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });

      expect(res.json()).toMatchObject({ processed: 0, failed: 1 });
      expect(mocks.competitorRepository.upsertSuggestedCompetitor).not.toHaveBeenCalled();
    });

    it("keeps NZ and AU results, drops all others", async () => {
      validToken();
      ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
      mocks.productRepository.getProductById.mockResolvedValue(makeProduct());
      mocks.dataForSeoService.fetchProductInfoResults.mockReturnValue([
        makeResult({ country: "NZ", source: "NZ Shop" }),
        makeResult({ country: "AU", source: "AU Shop" }),
        makeResult({ country: "US", source: "US Shop" }),
      ]);
      mocks.pgmqClient.read.mockResolvedValueOnce({ msgId: 1, readCt: 1, message: productInfoMsg() }).mockResolvedValueOnce(null);

      await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });

      expect(mocks.competitorRepository.upsertSuggestedCompetitor).toHaveBeenCalledTimes(2);
    });

    it("filters out prices below 50% or above 200% of product price", async () => {
      validToken();
      ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
      mocks.productRepository.getProductById.mockResolvedValue(makeProduct({ price: 100 }));
      mocks.dataForSeoService.fetchProductInfoResults.mockReturnValue([
        makeResult({ extractedPrice: 49, source: "Too Cheap" }),
        makeResult({ extractedPrice: 100, source: "In Range" }),
        makeResult({ extractedPrice: 201, source: "Too Expensive" }),
      ]);
      mocks.pgmqClient.read.mockResolvedValueOnce({ msgId: 1, readCt: 1, message: productInfoMsg() }).mockResolvedValueOnce(null);

      await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });

      expect(mocks.competitorRepository.upsertSuggestedCompetitor).toHaveBeenCalledTimes(1);
      const [, row] = mocks.competitorRepository.upsertSuggestedCompetitor.mock.calls[0];
      expect(row.source).toBe("In Range");
    });

    it("filters out own store by name (case-insensitive)", async () => {
      validToken();
      ({ app, mocks } = await buildTestApp({}, { ...ENV_OVERRIDES, OWN_STORE_NAME: "White Donkey" }));
      mocks.productRepository.getProductById.mockResolvedValue(makeProduct());
      mocks.dataForSeoService.fetchProductInfoResults.mockReturnValue([
        makeResult({ source: "white donkey" }),
        makeResult({ source: "Other Shop" }),
      ]);
      mocks.pgmqClient.read.mockResolvedValueOnce({ msgId: 1, readCt: 1, message: productInfoMsg() }).mockResolvedValueOnce(null);

      await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });

      expect(mocks.competitorRepository.upsertSuggestedCompetitor).toHaveBeenCalledTimes(1);
      const [, row] = mocks.competitorRepository.upsertSuggestedCompetitor.mock.calls[0];
      expect(row.source).toBe("Other Shop");
    });

    it("maps result fields correctly onto the saved row and records prices", async () => {
      validToken();
      ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
      mocks.productRepository.getProductById.mockResolvedValue(makeProduct());
      mocks.dataForSeoService.fetchProductInfoResults.mockReturnValue([
        makeResult({ title: "Widget Pro", externalId: "ext-999", extractedPrice: 99, source: "  Shop A  " }),
      ]);
      mocks.pgmqClient.read.mockResolvedValueOnce({ msgId: 1, readCt: 1, message: productInfoMsg({ productId: 5 }) }).mockResolvedValueOnce(null);

      await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });

      const [productId, row] = mocks.competitorRepository.upsertSuggestedCompetitor.mock.calls[0];
      expect(productId).toBe(5);
      expect(row).toMatchObject({ title: "Widget Pro", externalId: "ext-999", source: "Shop A" });
      expect(mocks.competitorRepository.recordPricesForConfirmed).toHaveBeenCalledWith(5, expect.any(Array));
    });
  });

  // ── Archive threshold ─────────────────────────────────────────────────────

  it("archives a failed message once read_ct reaches the threshold", async () => {
    validToken();
    ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
    mocks.dataForSeoService.fetchShoppingTaskResult.mockRejectedValue(new Error("permanent failure"));
    mocks.pgmqClient.read.mockResolvedValueOnce({ msgId: 9, readCt: 5, message: shoppingMsg() }).mockResolvedValueOnce(null);

    const res = await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });

    expect(res.json()).toMatchObject({ processed: 0, failed: 1, archived: 1 });
    expect(mocks.pgmqClient.archive).toHaveBeenCalledWith("dataforseo_competitors", 9);
  });

  // ── Batch of mixed messages ───────────────────────────────────────────────

  it("processes both message types in one drain, one failure doesn't block the other", async () => {
    validToken();
    ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
    mocks.productRepository.getProductById.mockResolvedValue(null); // product-info msg -> processed (skip)
    mocks.dataForSeoService.fetchShoppingTaskResult.mockRejectedValue(new Error("boom")); // shopping msg -> fails
    mocks.pgmqClient.read
      .mockResolvedValueOnce({ msgId: 1, readCt: 1, message: shoppingMsg({ productId: 1 }) })
      .mockResolvedValueOnce({ msgId: 2, readCt: 1, message: productInfoMsg({ productId: 2 }) })
      .mockResolvedValueOnce(null);

    const res = await app.inject({ method: "POST", url: "/internal/competitor-drain-run", headers: AUTH });

    expect(res.json()).toMatchObject({ processed: 1, failed: 1 });
  });
});
