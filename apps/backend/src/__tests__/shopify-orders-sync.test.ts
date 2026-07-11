import { afterEach, describe, it, expect } from "vitest";

import { buildTestApp, makeShopifyService, makeShopifyGraphQLService, makeCloudTasksClient } from "./helpers/build-app.js";
import type { ShopifyGQLOrder } from "../services/shopify-graphql-service.js";

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

describe("POST /api/shopify/orders/sync", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 400 when mode is missing", async () => {
    ({ app } = await buildTestApp());
    const res = await app.inject({ method: "POST", url: "/api/shopify/orders/sync", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_MODE");
  });

  it("returns 400 when mode is not 'last30days'", async () => {
    ({ app } = await buildTestApp());
    const res = await app.inject({ method: "POST", url: "/api/shopify/orders/sync", payload: { mode: "all" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_MODE");
  });

  it("returns 503 when Shopify is not configured", async () => {
    ({ app } = await buildTestApp());
    const res = await app.inject({ method: "POST", url: "/api/shopify/orders/sync", payload: { mode: "last30days" } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("SHOPIFY_NOT_CONFIGURED");
  });

  it("returns 503 when Cloud Tasks is not configured", async () => {
    const shopifyService = makeShopifyService();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    ({ app } = await buildTestApp({ shopifyService, shopifyGraphQLService, cloudTasksClient: null }));
    const res = await app.inject({ method: "POST", url: "/api/shopify/orders/sync", payload: { mode: "last30days" } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("QUEUE_NOT_CONFIGURED");
  });

  it("returns 202 with queued counts when orders are found", async () => {
    const shopifyService = makeShopifyService();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    const cloudTasksClient = makeCloudTasksClient();
    shopifyGraphQLService.fetchOrders.mockResolvedValue([makeGQLOrder(), makeGQLOrder({ id: "gid://shopify/Order/1000001052", name: "#WD1052" })]);
    ({ app } = await buildTestApp({ shopifyService, shopifyGraphQLService, cloudTasksClient }));

    const res = await app.inject({ method: "POST", url: "/api/shopify/orders/sync", payload: { mode: "last30days", source: "manual" } });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("queued");
    expect(body.ordersDiscovered).toBe(2);
    expect(body.jobsEnqueued).toBe(2);
    expect(body.mode).toBe("last30days");
    expect(body.source).toBe("manual");
  });

  it("enqueues one task per discovered order", async () => {
    const shopifyService = makeShopifyService();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    const cloudTasksClient = makeCloudTasksClient();
    shopifyGraphQLService.fetchOrders.mockResolvedValue([makeGQLOrder()]);
    ({ app } = await buildTestApp({ shopifyService, shopifyGraphQLService, cloudTasksClient }));

    await app.inject({ method: "POST", url: "/api/shopify/orders/sync", payload: { mode: "last30days" } });

    expect(cloudTasksClient.enqueueSyncOrder).toHaveBeenCalledTimes(1);
    const [, payload] = cloudTasksClient.enqueueSyncOrder.mock.calls[0];
    expect(payload.type).toBe("sync-order");
    expect(payload.source).toBe("manual");
    expect(payload.shopifyOrderId).toBe("gid://shopify/Order/1000001051");
  });

  it("task payload contains raw Shopify order data", async () => {
    const shopifyService = makeShopifyService();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    const cloudTasksClient = makeCloudTasksClient();
    const order = makeGQLOrder();
    shopifyGraphQLService.fetchOrders.mockResolvedValue([order]);
    ({ app } = await buildTestApp({ shopifyService, shopifyGraphQLService, cloudTasksClient }));

    await app.inject({ method: "POST", url: "/api/shopify/orders/sync", payload: { mode: "last30days" } });

    const payload = cloudTasksClient.enqueueSyncOrder.mock.calls[0][1];
    expect(payload.shopifyOrder).toEqual(order);
    expect(payload.shopifyUpdatedAt).toBe(order.updatedAt);
    expect(payload.orderName).toBe(order.name);
  });

  it("returns 202 with 0 orders when none found", async () => {
    const shopifyService = makeShopifyService();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    const cloudTasksClient = makeCloudTasksClient();
    shopifyGraphQLService.fetchOrders.mockResolvedValue([]);
    ({ app } = await buildTestApp({ shopifyService, shopifyGraphQLService, cloudTasksClient }));

    const res = await app.inject({ method: "POST", url: "/api/shopify/orders/sync", payload: { mode: "last30days" } });

    expect(res.statusCode).toBe(202);
    expect(res.json().ordersDiscovered).toBe(0);
    expect(cloudTasksClient.enqueueSyncOrder).not.toHaveBeenCalled();
  });
});
