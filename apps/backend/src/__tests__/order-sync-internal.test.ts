import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { buildTestApp, makeShopifyGraphQLService, makeShopifyService } from "./helpers/build-app.js";
import type { ShopifyGQLOrder } from "../services/shopify-graphql-service.js";

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

function makeGQLOrder(overrides: Partial<ShopifyGQLOrder> = {}): ShopifyGQLOrder {
  return {
    id: "gid://shopify/Order/1000001051",
    name: "#WD1051",
    email: "customer@example.com",
    createdAt: "2026-06-06T01:00:00Z",
    updatedAt: "2026-06-06T01:05:00Z",
    processedAt: "2026-06-06T01:00:00Z",
    cancelledAt: null,
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    currencyCode: "NZD",
    tags: [],
    sourceName: "web",
    subtotalPriceSet: { shopMoney: { amount: "50.00", currencyCode: "NZD" } },
    totalDiscountsSet: { shopMoney: { amount: "0.00", currencyCode: "NZD" } },
    totalShippingPriceSet: { shopMoney: { amount: "10.00", currencyCode: "NZD" } },
    totalTaxSet: { shopMoney: { amount: "0.00", currencyCode: "NZD" } },
    totalPriceSet: { shopMoney: { amount: "60.00", currencyCode: "NZD" } },
    customer: null,
    lineItems: { nodes: [] },
    ...overrides,
  };
}

describe("POST /internal/order-sync-run", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];
  let mocks: Awaited<ReturnType<typeof buildTestApp>>["mocks"];

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => app?.close());

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when Authorization header is missing", async () => {
    ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
    const res = await app.inject({ method: "POST", url: "/internal/order-sync-run" });
    expect(res.statusCode).toBe(401);
    expect(mocks.pgmqClient.read).not.toHaveBeenCalled();
  });

  it("returns 401 when token verification fails", async () => {
    invalidToken();
    ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
    const res = await app.inject({ method: "POST", url: "/internal/order-sync-run", headers: AUTH });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when OIDC service account is not configured", async () => {
    validToken();
    ({ app, mocks } = await buildTestApp({}, {}));
    const res = await app.inject({ method: "POST", url: "/internal/order-sync-run", headers: AUTH });
    expect(res.statusCode).toBe(401);
  });

  // ── Discovery ─────────────────────────────────────────────────────────────

  it("enqueues one message per discovered order, tagged scheduled_1am", async () => {
    validToken();
    const shopifyService = makeShopifyService();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    shopifyGraphQLService.fetchOrders.mockResolvedValue([makeGQLOrder(), makeGQLOrder({ id: "gid://shopify/Order/1000001052" })]);
    ({ app, mocks } = await buildTestApp({ shopifyService, shopifyGraphQLService }, ENV_OVERRIDES));

    const res = await app.inject({ method: "POST", url: "/internal/order-sync-run", headers: AUTH });

    expect(res.statusCode).toBe(200);
    expect(res.json().discovered).toBe(2);
    expect(mocks.pgmqClient.send).toHaveBeenCalledTimes(2);
    const [queueName, payload] = mocks.pgmqClient.send.mock.calls[0];
    expect(queueName).toBe("shopify_orders");
    expect(payload.source).toBe("scheduled_1am");
  });

  it("discovery failure does not block draining already-queued messages", async () => {
    validToken();
    const shopifyService = makeShopifyService();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    shopifyGraphQLService.fetchOrders.mockRejectedValue(new Error("Shopify API down"));
    ({ app, mocks } = await buildTestApp({ shopifyService, shopifyGraphQLService }, ENV_OVERRIDES));

    const order = makeGQLOrder();
    mocks.pgmqClient.read
      .mockResolvedValueOnce({ msgId: 1, readCt: 1, message: { type: "sync-order", source: "manual", shopifyOrderId: order.id, orderName: order.name, shopifyUpdatedAt: order.updatedAt, shopifyOrder: order } })
      .mockResolvedValueOnce(null);

    const res = await app.inject({ method: "POST", url: "/internal/order-sync-run", headers: AUTH });

    expect(res.statusCode).toBe(200);
    expect(res.json().discovered).toBe(0);
    expect(res.json().processed).toBe(1);
    expect(mocks.orderRepository.upsertMappedOrder).toHaveBeenCalledOnce();
  });

  // ── Drain ─────────────────────────────────────────────────────────────────

  it("returns 200 with all-zero counts when the queue is empty", async () => {
    validToken();
    ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));

    const res = await app.inject({ method: "POST", url: "/internal/order-sync-run", headers: AUTH });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ discovered: 0, processed: 0, failed: 0, archived: 0 });
  });

  it("processes a scheduled/manual message directly and deletes it on success", async () => {
    validToken();
    const order = makeGQLOrder();
    ({ app, mocks } = await buildTestApp({}, ENV_OVERRIDES));
    mocks.pgmqClient.read
      .mockResolvedValueOnce({ msgId: 42, readCt: 1, message: { type: "sync-order", source: "manual", shopifyOrderId: order.id, orderName: order.name, shopifyUpdatedAt: order.updatedAt, shopifyOrder: order } })
      .mockResolvedValueOnce(null);

    const res = await app.inject({ method: "POST", url: "/internal/order-sync-run", headers: AUTH });

    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBe(1);
    expect(mocks.orderRepository.upsertMappedOrder).toHaveBeenCalledOnce();
    expect(mocks.pgmqClient.delete).toHaveBeenCalledWith("shopify_orders", 42);
  });

  it("webhook-sourced message re-fetches via GraphQL before upserting", async () => {
    validToken();
    const shopifyService = makeShopifyService();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    const order = makeGQLOrder();
    shopifyGraphQLService.fetchOrderById.mockResolvedValue(order);
    ({ app, mocks } = await buildTestApp({ shopifyService, shopifyGraphQLService }, ENV_OVERRIDES));
    mocks.pgmqClient.read
      .mockResolvedValueOnce({
        msgId: 1, readCt: 1,
        message: { type: "sync-order", source: "webhook", webhookId: "wh-1", topic: "orders/updated", shopDomain: "x.myshopify.com", shopifyOrderId: order.id, orderName: order.name, shopifyUpdatedAt: order.updatedAt },
      })
      .mockResolvedValueOnce(null);

    const res = await app.inject({ method: "POST", url: "/internal/order-sync-run", headers: AUTH });

    expect(res.statusCode).toBe(200);
    expect(shopifyGraphQLService.fetchOrderById).toHaveBeenCalledOnce();
    expect(mocks.orderRepository.upsertMappedOrder).toHaveBeenCalledOnce();
  });

  it("skips upsert when stored shopifyUpdatedAt is newer (staleness guard), still deletes the message", async () => {
    validToken();
    const shopifyService = makeShopifyService();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    ({ app, mocks } = await buildTestApp({ shopifyService, shopifyGraphQLService }, ENV_OVERRIDES));
    mocks.orderRepository.getShopifyOrderUpdatedAt.mockResolvedValue(new Date("2026-06-06T02:00:00Z"));
    mocks.pgmqClient.read
      .mockResolvedValueOnce({
        msgId: 1, readCt: 1,
        message: { type: "sync-order", source: "webhook", webhookId: "wh-1", topic: "orders/updated", shopDomain: "x.myshopify.com", shopifyOrderId: "gid://shopify/Order/1000001051", orderName: "#WD1051", shopifyUpdatedAt: "2026-06-06T01:00:00Z" },
      })
      .mockResolvedValueOnce(null);

    const res = await app.inject({ method: "POST", url: "/internal/order-sync-run", headers: AUTH });

    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBe(1);
    expect(shopifyGraphQLService.fetchOrderById).not.toHaveBeenCalled();
    expect(mocks.orderRepository.upsertMappedOrder).not.toHaveBeenCalled();
    expect(mocks.pgmqClient.delete).toHaveBeenCalledWith("shopify_orders", 1);
  });

  it("leaves a failed message in the queue (no delete, no archive) below the threshold", async () => {
    validToken();
    const shopifyService = makeShopifyService();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    shopifyGraphQLService.fetchOrderById.mockResolvedValue(null); // "order not found" -> throws in processSyncOrderMessage
    ({ app, mocks } = await buildTestApp({ shopifyService, shopifyGraphQLService }, ENV_OVERRIDES));
    mocks.pgmqClient.read
      .mockResolvedValueOnce({
        msgId: 7, readCt: 2,
        message: { type: "sync-order", source: "webhook", webhookId: "wh-1", topic: "orders/updated", shopDomain: "x.myshopify.com", shopifyOrderId: "gid://shopify/Order/1000001051", orderName: "#WD1051", shopifyUpdatedAt: "2026-06-06T01:00:00Z" },
      })
      .mockResolvedValueOnce(null);

    const res = await app.inject({ method: "POST", url: "/internal/order-sync-run", headers: AUTH });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ processed: 0, failed: 1, archived: 0 });
    expect(mocks.pgmqClient.delete).not.toHaveBeenCalled();
    expect(mocks.pgmqClient.archive).not.toHaveBeenCalled();
  });

  it("archives a failed message once read_ct reaches the threshold", async () => {
    validToken();
    const shopifyService = makeShopifyService();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    shopifyGraphQLService.fetchOrderById.mockResolvedValue(null);
    ({ app, mocks } = await buildTestApp({ shopifyService, shopifyGraphQLService }, ENV_OVERRIDES));
    mocks.pgmqClient.read
      .mockResolvedValueOnce({
        msgId: 7, readCt: 5,
        message: { type: "sync-order", source: "webhook", webhookId: "wh-1", topic: "orders/updated", shopDomain: "x.myshopify.com", shopifyOrderId: "gid://shopify/Order/1000001051", orderName: "#WD1051", shopifyUpdatedAt: "2026-06-06T01:00:00Z" },
      })
      .mockResolvedValueOnce(null);

    const res = await app.inject({ method: "POST", url: "/internal/order-sync-run", headers: AUTH });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ processed: 0, failed: 1, archived: 1 });
    expect(mocks.pgmqClient.archive).toHaveBeenCalledWith("shopify_orders", 7);
  });

  it("one message's failure doesn't stop the rest of the batch from being processed", async () => {
    validToken();
    const shopifyService = makeShopifyService();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    ({ app, mocks } = await buildTestApp({ shopifyService, shopifyGraphQLService }, ENV_OVERRIDES));

    const order = makeGQLOrder();
    mocks.pgmqClient.read
      .mockResolvedValueOnce({
        msgId: 1, readCt: 1,
        message: { type: "sync-order", source: "webhook", webhookId: "wh-1", topic: "orders/updated", shopDomain: "x.myshopify.com", shopifyOrderId: "gid://shopify/Order/999", orderName: "#999", shopifyUpdatedAt: "2026-06-06T01:00:00Z" },
      })
      .mockResolvedValueOnce({ msgId: 2, readCt: 1, message: { type: "sync-order", source: "manual", shopifyOrderId: order.id, orderName: order.name, shopifyUpdatedAt: order.updatedAt, shopifyOrder: order } })
      .mockResolvedValueOnce(null);
    shopifyGraphQLService.fetchOrderById.mockResolvedValue(null); // first message fails (not found)

    const res = await app.inject({ method: "POST", url: "/internal/order-sync-run", headers: AUTH });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ processed: 1, failed: 1 });
    expect(mocks.orderRepository.upsertMappedOrder).toHaveBeenCalledOnce();
  });
});
