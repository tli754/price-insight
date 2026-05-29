import { afterEach, describe, it, expect } from "vitest";
import { buildTestApp, makeOrderRepository, makeShopifyService } from "./helpers/build-app.js";

describe("POST /api/orders/sync", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 503 SHOPIFY_NOT_CONFIGURED when shopifyService is null", async () => {
    ({ app } = await buildTestApp({ shopifyService: null }));

    const response = await app.inject({ method: "POST", url: "/api/orders/sync" });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("SHOPIFY_NOT_CONFIGURED");
  });

  it("returns 200 with synced count on success", async () => {
    const orderRepository = makeOrderRepository();
    orderRepository.importOrders.mockResolvedValue(12);

    const shopifyService = makeShopifyService();
    shopifyService.fetchOrders.mockResolvedValue([]);

    ({ app } = await buildTestApp({ orderRepository, shopifyService }));

    const response = await app.inject({ method: "POST", url: "/api/orders/sync" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ synced: 12 });
  });

  it("passes the access token from getAccessToken to fetchOrders", async () => {
    const shopifyService = makeShopifyService();
    shopifyService.getAccessToken.mockResolvedValue("tok_xyz");
    shopifyService.fetchOrders.mockResolvedValue([]);

    ({ app } = await buildTestApp({ shopifyService }));

    await app.inject({ method: "POST", url: "/api/orders/sync" });

    expect(shopifyService.fetchOrders).toHaveBeenCalledWith("tok_xyz", undefined);
  });

  it("passes lastSyncedAt to fetchOrders when orders were previously synced", async () => {
    const orderRepository = makeOrderRepository();
    orderRepository.getLastSyncedAt.mockResolvedValue("2024-06-01T12:00:00.000Z");

    const shopifyService = makeShopifyService();
    shopifyService.fetchOrders.mockResolvedValue([]);

    ({ app } = await buildTestApp({ orderRepository, shopifyService }));

    await app.inject({ method: "POST", url: "/api/orders/sync" });

    expect(shopifyService.fetchOrders).toHaveBeenCalledWith(
      "fake-access-token",
      "2024-06-01T12:00:00.000Z"
    );
  });

  it("passes undefined to fetchOrders when no prior sync exists", async () => {
    const orderRepository = makeOrderRepository();
    orderRepository.getLastSyncedAt.mockResolvedValue(null);

    const shopifyService = makeShopifyService();
    shopifyService.fetchOrders.mockResolvedValue([]);

    ({ app } = await buildTestApp({ orderRepository, shopifyService }));

    await app.inject({ method: "POST", url: "/api/orders/sync" });

    expect(shopifyService.fetchOrders).toHaveBeenCalledWith("fake-access-token", undefined);
  });

  it("returns 500 when shopifyService.fetchOrders throws", async () => {
    const shopifyService = makeShopifyService();
    shopifyService.fetchOrders.mockRejectedValue(new Error("Shopify API unavailable"));

    ({ app } = await buildTestApp({ shopifyService }));

    const response = await app.inject({ method: "POST", url: "/api/orders/sync" });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
