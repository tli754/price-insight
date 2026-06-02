import { afterEach, describe, it, expect } from "vitest";
import { buildTestApp, makeOrderRepository } from "./helpers/build-app.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeOrderListItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    shopifyOrderId: 123456789,
    orderNumber: "1001",
    email: "test@example.com",
    customerFirstName: "Jane",
    customerLastName: "Doe",
    financialStatus: "paid",
    fulfillmentStatus: "fulfilled",
    currency: "NZD",
    totalPrice: 109.98,
    totalShipping: 10.0,
    itemCount: 2,
    shopifyCreatedAt: new Date("2024-01-15T10:00:00Z"),
    ...overrides
  };
}

function makeOrderDetail(overrides: Record<string, unknown> = {}) {
  return {
    order: {
      id: 1,
      shopifyOrderId: 123456789,
      orderNumber: "1001",
      email: "test@example.com",
      financialStatus: "paid",
      fulfillmentStatus: "fulfilled",
      currency: "NZD",
      totalPrice: 109.98,
      totalShipping: 10.0,
      sourceName: "web",
      referringSite: null,
      landingSite: null,
      shopifyCreatedAt: new Date("2024-01-15T10:00:00Z"),
      ...overrides
    },
    customer: null,
    address: null,
    items: []
  };
}

// ── GET /api/orders ───────────────────────────────────────────────────────────

describe("GET /api/orders", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with items array, total, page, limit", async () => {
    const orderRepository = makeOrderRepository();
    orderRepository.listOrders.mockResolvedValue({ items: [makeOrderListItem()], total: 1 });
    ({ app } = await buildTestApp({ orderRepository }));

    const response = await app.inject({ method: "GET", url: "/api/orders" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(body.items).toHaveLength(1);
    expect(body.items[0].orderNumber).toBe("1001");
  });

  it("returns empty items and total 0 when no orders exist", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: "GET", url: "/api/orders" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ items: [], total: 0, page: 1, limit: 20 });
  });

  it("forwards search param to listOrders", async () => {
    const orderRepository = makeOrderRepository();
    ({ app } = await buildTestApp({ orderRepository }));

    await app.inject({ method: "GET", url: "/api/orders?search=1001" });

    expect(orderRepository.listOrders).toHaveBeenCalledWith(
      expect.objectContaining({ search: "1001" })
    );
  });

  it("forwards financialStatus filter to listOrders", async () => {
    const orderRepository = makeOrderRepository();
    ({ app } = await buildTestApp({ orderRepository }));

    await app.inject({ method: "GET", url: "/api/orders?financialStatus=paid" });

    expect(orderRepository.listOrders).toHaveBeenCalledWith(
      expect.objectContaining({ financialStatus: "paid" })
    );
  });

  it("forwards pagination params to listOrders", async () => {
    const orderRepository = makeOrderRepository();
    ({ app } = await buildTestApp({ orderRepository }));

    await app.inject({ method: "GET", url: "/api/orders?page=2&limit=5" });

    expect(orderRepository.listOrders).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, limit: 5 })
    );
  });

  it("defaults page to 1 and limit to 20", async () => {
    const orderRepository = makeOrderRepository();
    ({ app } = await buildTestApp({ orderRepository }));

    await app.inject({ method: "GET", url: "/api/orders" });

    expect(orderRepository.listOrders).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20 })
    );
  });
});

// ── GET /api/orders/:id ───────────────────────────────────────────────────────

describe("GET /api/orders/:id", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with full detail when order exists", async () => {
    const orderRepository = makeOrderRepository();
    const detail = makeOrderDetail();
    orderRepository.getOrderById.mockResolvedValue(detail);
    ({ app } = await buildTestApp({ orderRepository }));

    const response = await app.inject({ method: "GET", url: "/api/orders/1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ item: { order: { id: 1 } } });
  });

  it("returns 404 when order is not found", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: "GET", url: "/api/orders/999" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("ORDERS_NOT_FOUND");
  });

  it("returns 400 when id is not a number", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: "GET", url: "/api/orders/abc" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_ID");
  });

  it("returns detail with null customer and address for guest order", async () => {
    const orderRepository = makeOrderRepository();
    orderRepository.getOrderById.mockResolvedValue(makeOrderDetail());
    ({ app } = await buildTestApp({ orderRepository }));

    const response = await app.inject({ method: "GET", url: "/api/orders/1" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.item.customer).toBeNull();
    expect(body.item.address).toBeNull();
  });

  it("does not expose POST/PUT/DELETE on /api/orders/:id", async () => {
    ({ app } = await buildTestApp());

    const [post, put, del] = await Promise.all([
      app.inject({ method: "POST", url: "/api/orders/1" }),
      app.inject({ method: "PUT", url: "/api/orders/1" }),
      app.inject({ method: "DELETE", url: "/api/orders/1" })
    ]);

    expect(post.statusCode).toBe(404);
    expect(put.statusCode).toBe(404);
    expect(del.statusCode).toBe(404);
  });
});
