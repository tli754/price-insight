import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import internalSyncRoutes from "../routes/internal-sync.js";
import type { ShopifyGQLOrder } from "../services/shopify-graphql-service.js";

const EXPECTED_SA = "price-insight-invoker@wd-tools.iam.gserviceaccount.com";
const HOST = "order-worker-abc123.a.run.app";

const { mockVerifyIdToken } = vi.hoisted(() => ({ mockVerifyIdToken: vi.fn() }));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken(...args: unknown[]) {
      return mockVerifyIdToken(...args);
    }
  },
}));

function makeOrderRepository() {
  return {
    getShopifyOrderUpdatedAt: vi.fn().mockResolvedValue(null),
    upsertMappedOrder: vi.fn().mockResolvedValue({ skipped: false }),
  };
}

function makeShopifyService() {
  return {
    getAccessToken: vi.fn().mockResolvedValue("fake-access-token"),
  };
}

function makeShopifyGraphQLService() {
  return {
    fetchOrders: vi.fn().mockResolvedValue([]),
    fetchOrderById: vi.fn().mockResolvedValue(null),
  };
}

function makeCloudTasksClient() {
  return {
    enqueueSyncOrder: vi.fn().mockResolvedValue(undefined),
  };
}

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

function validToken(email = EXPECTED_SA) {
  mockVerifyIdToken.mockResolvedValue({
    getPayload: () => ({ email, email_verified: true }),
  });
}

function invalidToken() {
  mockVerifyIdToken.mockRejectedValue(new Error("Invalid token signature"));
}

async function buildApp(mocks: {
  orderRepository?: ReturnType<typeof makeOrderRepository>;
  shopifyService?: ReturnType<typeof makeShopifyService> | null;
  shopifyGraphQLService?: ReturnType<typeof makeShopifyGraphQLService> | null;
  cloudTasksClient?: ReturnType<typeof makeCloudTasksClient> | null;
} = {}) {
  const app = Fastify({ logger: false });
  await app.register(internalSyncRoutes as any, {
    orderRepository: mocks.orderRepository ?? makeOrderRepository(),
    shopifyService: "shopifyService" in mocks ? mocks.shopifyService ?? null : makeShopifyService(),
    shopifyGraphQLService: "shopifyGraphQLService" in mocks ? mocks.shopifyGraphQLService ?? null : makeShopifyGraphQLService(),
    cloudTasksClient: "cloudTasksClient" in mocks ? mocks.cloudTasksClient ?? null : makeCloudTasksClient(),
    internalOidcServiceAccount: EXPECTED_SA,
  });
  await app.ready();
  return app;
}

describe("POST /internal/sync-order", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => app?.close());

  it("returns 401 when Authorization header is missing", async () => {
    const orderRepository = makeOrderRepository();
    app = await buildApp({ orderRepository });
    const res = await app.inject({
      method: "POST",
      url: "/internal/sync-order",
      headers: { host: HOST },
      payload: { type: "sync-order", source: "manual", shopifyOrderId: "x", orderName: "x", shopifyUpdatedAt: "x", shopifyOrder: {} },
    });
    expect(res.statusCode).toBe(401);
    expect(orderRepository.upsertMappedOrder).not.toHaveBeenCalled();
  });

  it("returns 401 when token verification fails", async () => {
    invalidToken();
    const orderRepository = makeOrderRepository();
    app = await buildApp({ orderRepository });
    const res = await app.inject({
      method: "POST",
      url: "/internal/sync-order",
      headers: { host: HOST, authorization: "Bearer bad-token" },
      payload: { type: "sync-order", source: "manual", shopifyOrderId: "x", orderName: "x", shopifyUpdatedAt: "x", shopifyOrder: makeGQLOrder() },
    });
    expect(res.statusCode).toBe(401);
    expect(orderRepository.upsertMappedOrder).not.toHaveBeenCalled();
  });

  it("returns 401 when token email does not match expected service account", async () => {
    validToken("someone-else@wd-tools.iam.gserviceaccount.com");
    const orderRepository = makeOrderRepository();
    app = await buildApp({ orderRepository });
    const res = await app.inject({
      method: "POST",
      url: "/internal/sync-order",
      headers: { host: HOST, authorization: "Bearer some-token" },
      payload: { type: "sync-order", source: "manual", shopifyOrderId: "x", orderName: "x", shopifyUpdatedAt: "x", shopifyOrder: makeGQLOrder() },
    });
    expect(res.statusCode).toBe(401);
    expect(orderRepository.upsertMappedOrder).not.toHaveBeenCalled();
  });

  it("processes a scheduled/manual payload directly (no Shopify re-fetch)", async () => {
    validToken();
    const orderRepository = makeOrderRepository();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    app = await buildApp({ orderRepository, shopifyGraphQLService });

    const order = makeGQLOrder();
    const res = await app.inject({
      method: "POST",
      url: "/internal/sync-order",
      headers: { host: HOST, authorization: "Bearer good-token" },
      payload: { type: "sync-order", source: "manual", shopifyOrderId: order.id, orderName: order.name, shopifyUpdatedAt: order.updatedAt, shopifyOrder: order },
    });

    expect(res.statusCode).toBe(200);
    expect(orderRepository.upsertMappedOrder).toHaveBeenCalledOnce();
    expect(shopifyGraphQLService.fetchOrderById).not.toHaveBeenCalled();
  });

  it("webhook-sourced payload re-fetches via GraphQL and upserts", async () => {
    validToken();
    const orderRepository = makeOrderRepository();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    const order = makeGQLOrder();
    shopifyGraphQLService.fetchOrderById.mockResolvedValue(order);
    app = await buildApp({ orderRepository, shopifyGraphQLService });

    const res = await app.inject({
      method: "POST",
      url: "/internal/sync-order",
      headers: { host: HOST, authorization: "Bearer good-token" },
      payload: {
        type: "sync-order",
        source: "webhook",
        webhookId: "wh-1",
        topic: "orders/updated",
        shopDomain: "example.myshopify.com",
        shopifyOrderId: order.id,
        orderName: order.name,
        shopifyUpdatedAt: order.updatedAt,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(shopifyGraphQLService.fetchOrderById).toHaveBeenCalledOnce();
    expect(orderRepository.upsertMappedOrder).toHaveBeenCalledOnce();
  });

  it("skips upsert when stored shopifyUpdatedAt is newer or equal (staleness guard)", async () => {
    validToken();
    const orderRepository = makeOrderRepository();
    orderRepository.getShopifyOrderUpdatedAt.mockResolvedValue(new Date("2026-06-06T02:00:00Z"));
    const shopifyGraphQLService = makeShopifyGraphQLService();
    app = await buildApp({ orderRepository, shopifyGraphQLService });

    const res = await app.inject({
      method: "POST",
      url: "/internal/sync-order",
      headers: { host: HOST, authorization: "Bearer good-token" },
      payload: {
        type: "sync-order",
        source: "webhook",
        webhookId: "wh-1",
        topic: "orders/updated",
        shopDomain: "example.myshopify.com",
        shopifyOrderId: "gid://shopify/Order/1000001051",
        orderName: "#WD1051",
        shopifyUpdatedAt: "2026-06-06T01:00:00Z", // older than stored
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().skipped).toBe(true);
    expect(shopifyGraphQLService.fetchOrderById).not.toHaveBeenCalled();
    expect(orderRepository.upsertMappedOrder).not.toHaveBeenCalled();
  });

  it("returns 502 when webhook-sourced order is not found in Shopify (retryable)", async () => {
    validToken();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    shopifyGraphQLService.fetchOrderById.mockResolvedValue(null);
    app = await buildApp({ shopifyGraphQLService });

    const res = await app.inject({
      method: "POST",
      url: "/internal/sync-order",
      headers: { host: HOST, authorization: "Bearer good-token" },
      payload: {
        type: "sync-order",
        source: "webhook",
        webhookId: "wh-1",
        topic: "orders/updated",
        shopDomain: "example.myshopify.com",
        shopifyOrderId: "gid://shopify/Order/1000001051",
        orderName: "#WD1051",
        shopifyUpdatedAt: "2026-06-06T01:00:00Z",
      },
    });

    expect(res.statusCode).toBe(502);
  });
});

describe("POST /internal/scheduled-order-discovery", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => app?.close());

  it("returns 401 when token verification fails, makes no Shopify calls", async () => {
    invalidToken();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    app = await buildApp({ shopifyGraphQLService });

    const res = await app.inject({
      method: "POST",
      url: "/internal/scheduled-order-discovery",
      headers: { host: HOST, authorization: "Bearer bad-token" },
    });

    expect(res.statusCode).toBe(401);
    expect(shopifyGraphQLService.fetchOrders).not.toHaveBeenCalled();
  });

  it("creates one Cloud Task per discovered order", async () => {
    validToken();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    const cloudTasksClient = makeCloudTasksClient();
    shopifyGraphQLService.fetchOrders.mockResolvedValue([makeGQLOrder(), makeGQLOrder({ id: "gid://shopify/Order/1000001052" })]);
    app = await buildApp({ shopifyGraphQLService, cloudTasksClient });

    const res = await app.inject({
      method: "POST",
      url: "/internal/scheduled-order-discovery",
      headers: { host: HOST, authorization: "Bearer good-token" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(2);
    expect(cloudTasksClient.enqueueSyncOrder).toHaveBeenCalledTimes(2);
  });

  it("returns 200 with 0 tasks created when no orders found", async () => {
    validToken();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    const cloudTasksClient = makeCloudTasksClient();
    shopifyGraphQLService.fetchOrders.mockResolvedValue([]);
    app = await buildApp({ shopifyGraphQLService, cloudTasksClient });

    const res = await app.inject({
      method: "POST",
      url: "/internal/scheduled-order-discovery",
      headers: { host: HOST, authorization: "Bearer good-token" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(0);
    expect(cloudTasksClient.enqueueSyncOrder).not.toHaveBeenCalled();
  });
});
