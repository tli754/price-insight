import { describe, it, expect, beforeEach } from "vitest";

import { OrderRepository } from "../services/order-repository.js";
import type { ShopifyOrder, ShopifyCustomer, ShopifyLineItem } from "../services/order-repository.js";
import { makeMockDb } from "./helpers/mock-db.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCustomer(overrides: Partial<ShopifyCustomer> = {}): ShopifyCustomer {
  return {
    id: 111222333,
    email: "test@example.com",
    first_name: "Jane",
    last_name: "Doe",
    phone: "+64211234567",
    state: "enabled",
    currency: "NZD",
    verified_email: true,
    tags: null,
    default_address: {
      id: 999000111,
      name: "Jane Doe",
      company: null,
      address1: "1 Queen St",
      address2: null,
      city: "Auckland",
      province: "Auckland",
      country: "NZ",
      zip: "1010"
    },
    ...overrides
  };
}

function makeLineItem(overrides: Partial<ShopifyLineItem> = {}): ShopifyLineItem {
  return {
    id: 555666777,
    product_id: 888999000,
    variant_id: 100200300,
    title: "Blue Widget",
    variant_title: "Large",
    sku: "BW-L-001",
    quantity: 2,
    current_quantity: 2,
    price: "49.99",
    total_discount: "0.00",
    ...overrides
  };
}

function makeShopifyOrder(overrides: Partial<ShopifyOrder> = {}): ShopifyOrder {
  return {
    id: 123456789,
    order_number: 1001,
    email: "test@example.com",
    financial_status: "paid",
    fulfillment_status: "fulfilled",
    currency: "NZD",
    subtotal_price: "99.98",
    total_price: "109.98",
    total_tax: "15.00",
    total_shipping_price_set: { shop_money: { amount: "10.00" } },
    total_discounts: "0.00",
    source_name: "web",
    referring_site: null,
    landing_site: null,
    processed_at: "2024-01-15T10:00:00Z",
    total_weight: null,
    cancelled_at: null,
    created_at: "2024-01-15T10:00:00Z",
    updated_at: "2024-01-15T10:30:00Z",
    customer: makeCustomer(),
    line_items: [makeLineItem()],
    ...overrides
  };
}

// ── getLastSyncedAt ───────────────────────────────────────────────────────────

describe("OrderRepository.getLastSyncedAt()", () => {
  it("returns ISO string of max shopify_updated_at when orders exist", async () => {
    const db = makeMockDb();
    const date = new Date("2024-06-01T12:00:00Z");
    db._select.limit.mockResolvedValueOnce([{ maxUpdatedAt: date }]);
    const repo = new OrderRepository(db as any);

    const result = await repo.getLastSyncedAt();

    expect(result).toBe(date.toISOString());
  });

  it("returns null when no orders exist", async () => {
    const db = makeMockDb();
    db._select.limit.mockResolvedValueOnce([{ maxUpdatedAt: null }]);
    const repo = new OrderRepository(db as any);

    const result = await repo.getLastSyncedAt();

    expect(result).toBeNull();
  });
});

// ── importOrders — customer mapping ──────────────────────────────────────────

describe("OrderRepository.importOrders() — customer mapping", () => {
  it("inserts a new customer with correct field mapping", async () => {
    const db = makeMockDb();
    // product lookup (orderBy)
    db._select.orderBy.mockResolvedValueOnce([]);
    // customer lookup → not found
    db._select.limit
      .mockResolvedValueOnce([])   // customer lookup
      .mockResolvedValueOnce([])   // address lookup
      .mockResolvedValueOnce([])   // order lookup
      .mockResolvedValueOnce([]);  // line item lookup
    const repo = new OrderRepository(db as any);

    await repo.importOrders([makeShopifyOrder()]);

    const insertCall = db.insert.mock.calls[0];
    expect(insertCall).toBeDefined();
    const valuesArg = db.insert.mock.results[0].value.values.mock.calls[0][0];
    expect(valuesArg.shopifyCustomerId).toBe(111222333);
    expect(valuesArg.email).toBe("test@example.com");
    expect(valuesArg.firstName).toBe("Jane");
    expect(valuesArg.lastName).toBe("Doe");
    expect(valuesArg.phone).toBe("+64211234567");
  });
});

// ── importOrders — address mapping ───────────────────────────────────────────

describe("OrderRepository.importOrders() — address mapping", () => {
  it("inserts a new address with correct field mapping", async () => {
    const db = makeMockDb();
    db._select.orderBy.mockResolvedValueOnce([]);
    db._select.limit
      .mockResolvedValueOnce([])   // customer lookup
      .mockResolvedValueOnce([])   // address lookup
      .mockResolvedValueOnce([])   // order lookup
      .mockResolvedValueOnce([]);  // line item lookup
    const repo = new OrderRepository(db as any);

    await repo.importOrders([makeShopifyOrder()]);

    // insert calls: [0]=customer, [1]=address, [2]=order, [3]=line_item
    const addressValues = db.insert.mock.results[1].value.values.mock.calls[0][0];
    expect(addressValues.shopifyAddressId).toBe(999000111);
    expect(addressValues.address1).toBe("1 Queen St");
    expect(addressValues.city).toBe("Auckland");
    expect(addressValues.country).toBe("NZ");
    expect(addressValues.zip).toBe("1010");
  });

  it("skips address upsert when shopify address id is null", async () => {
    const db = makeMockDb();
    db._select.orderBy.mockResolvedValueOnce([]);
    db._select.limit
      .mockResolvedValueOnce([])   // customer lookup
      .mockResolvedValueOnce([])   // order lookup
      .mockResolvedValueOnce([]);  // line item lookup
    const repo = new OrderRepository(db as any);

    const order = makeShopifyOrder({
      customer: makeCustomer({ default_address: { id: null, name: null, company: null, address1: "1 Queen St", address2: null, city: "Auckland", province: "Auckland", country: "NZ", zip: "1010" } })
    });

    await repo.importOrders([order]);

    // Should be: customer, order, line_item (no address insert)
    expect(db.insert).toHaveBeenCalledTimes(3);
  });
});

// ── importOrders — order mapping ─────────────────────────────────────────────

describe("OrderRepository.importOrders() — order mapping", () => {
  it("maps all order fields correctly", async () => {
    const db = makeMockDb();
    db._select.orderBy.mockResolvedValueOnce([]);
    db._select.limit
      .mockResolvedValueOnce([])   // customer lookup
      .mockResolvedValueOnce([])   // address lookup
      .mockResolvedValueOnce([])   // order lookup
      .mockResolvedValueOnce([]);  // line item lookup
    const repo = new OrderRepository(db as any);

    await repo.importOrders([makeShopifyOrder()]);

    // insert[2] = order insert
    const orderValues = db.insert.mock.results[2].value.values.mock.calls[0][0];
    expect(orderValues.shopifyOrderId).toBe(123456789);
    expect(orderValues.orderNumber).toBe("1001");
    expect(orderValues.email).toBe("test@example.com");
    expect(orderValues.financialStatus).toBe("paid");
    expect(orderValues.fulfillmentStatus).toBe("fulfilled");
    expect(orderValues.currency).toBe("NZD");
    expect(orderValues.totalShipping).toBe(10.0);
    expect(orderValues.cancelledAt).toBeNull();
    expect(orderValues.shopifyUpdatedAt).toBeInstanceOf(Date);
  });
});

// ── importOrders — line item mapping ─────────────────────────────────────────

describe("OrderRepository.importOrders() — line item mapping", () => {
  it("maps all line item fields correctly", async () => {
    const db = makeMockDb();
    // product lookup returns a match
    db._select.orderBy.mockResolvedValueOnce([{ id: 7, externalId: 888999000 }]);
    db._select.limit
      .mockResolvedValueOnce([])   // customer lookup
      .mockResolvedValueOnce([])   // address lookup
      .mockResolvedValueOnce([])   // order lookup
      .mockResolvedValueOnce([]);  // line item lookup
    const repo = new OrderRepository(db as any);

    await repo.importOrders([makeShopifyOrder()]);

    // insert[3] = line item insert
    const itemValues = db.insert.mock.results[3].value.values.mock.calls[0][0];
    expect(itemValues.shopifyLineItemId).toBe(555666777);
    expect(itemValues.shopifyProductId).toBe(888999000);
    expect(itemValues.shopifyVariantId).toBe(100200300);
    expect(itemValues.productId).toBe(7); // matched from product lookup
    expect(itemValues.title).toBe("Blue Widget");
    expect(itemValues.variantTitle).toBe("Large");
    expect(itemValues.sku).toBe("BW-L-001");
    expect(itemValues.quantity).toBe(2);
    expect(itemValues.unitPrice).toBe(49.99);
    expect(itemValues.totalDiscount).toBe(0.0);
  });
});

// ── importOrders — duplicate upsert prevention ───────────────────────────────

describe("OrderRepository.importOrders() — duplicate upsert prevention", () => {
  it("updates existing order instead of inserting a duplicate", async () => {
    const db = makeMockDb();
    db._select.orderBy.mockResolvedValueOnce([]);
    db._select.limit
      .mockResolvedValueOnce([])          // customer lookup → new
      .mockResolvedValueOnce([])          // address lookup → new
      .mockResolvedValueOnce([{ id: 55 }]) // order lookup → exists
      .mockResolvedValueOnce([]);         // line item lookup → new
    const repo = new OrderRepository(db as any);

    await repo.importOrders([makeShopifyOrder()]);

    // update called for order; insert NOT called for order (3 inserts: customer, address, line_item)
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(3);
  });
});

// ── importOrders — incremental sync ──────────────────────────────────────────

describe("OrderRepository.getLastSyncedAt() — incremental sync", () => {
  it("returns the correct ISO string to use as updated_at_min", async () => {
    const db = makeMockDb();
    const date = new Date("2024-03-20T08:00:00.000Z");
    db._select.limit.mockResolvedValueOnce([{ maxUpdatedAt: date }]);
    const repo = new OrderRepository(db as any);

    const result = await repo.getLastSyncedAt();

    expect(result).toBe("2024-03-20T08:00:00.000Z");
  });
});

// ── importOrders — guest order (no customer) ─────────────────────────────────

describe("OrderRepository.importOrders() — guest order", () => {
  it("processes a guest order with no customer without error", async () => {
    const db = makeMockDb();
    db._select.orderBy.mockResolvedValueOnce([]);
    db._select.limit
      .mockResolvedValueOnce([])   // order lookup
      .mockResolvedValueOnce([]);  // line item lookup
    const repo = new OrderRepository(db as any);

    const guestOrder = makeShopifyOrder({ customer: null, email: "guest@example.com" });
    const count = await repo.importOrders([guestOrder]);

    expect(count).toBe(1);
    // insert: order + line_item only (no customer, no address)
    expect(db.insert).toHaveBeenCalledTimes(2);
    const orderValues = db.insert.mock.results[0].value.values.mock.calls[0][0];
    expect(orderValues.customerId).toBeNull();
  });
});

// ── importOrders — missing local product match ────────────────────────────────

describe("OrderRepository.importOrders() — missing product match", () => {
  it("sets product_id to null when no local product matches the Shopify product ID", async () => {
    const db = makeMockDb();
    // product lookup returns nothing
    db._select.orderBy.mockResolvedValueOnce([]);
    db._select.limit
      .mockResolvedValueOnce([])   // customer lookup
      .mockResolvedValueOnce([])   // address lookup
      .mockResolvedValueOnce([])   // order lookup
      .mockResolvedValueOnce([]);  // line item lookup
    const repo = new OrderRepository(db as any);

    await repo.importOrders([makeShopifyOrder()]);

    const itemValues = db.insert.mock.results[3].value.values.mock.calls[0][0];
    expect(itemValues.productId).toBeNull();
  });
});

// ── importOrders — cancelled order ───────────────────────────────────────────

describe("OrderRepository.importOrders() — cancelled order", () => {
  it("stores cancelled_at and still upserts the order", async () => {
    const db = makeMockDb();
    db._select.orderBy.mockResolvedValueOnce([]);
    db._select.limit
      .mockResolvedValueOnce([])   // customer lookup
      .mockResolvedValueOnce([])   // address lookup
      .mockResolvedValueOnce([])   // order lookup
      .mockResolvedValueOnce([]);  // line item lookup
    const repo = new OrderRepository(db as any);

    const cancelledOrder = makeShopifyOrder({ cancelled_at: "2024-01-16T09:00:00Z" });
    const count = await repo.importOrders([cancelledOrder]);

    expect(count).toBe(1);
    const orderValues = db.insert.mock.results[2].value.values.mock.calls[0][0];
    expect(orderValues.cancelledAt).toBeInstanceOf(Date);
    expect(orderValues.cancelledAt.toISOString()).toBe("2024-01-16T09:00:00.000Z");
  });
});

// ── importOrders — discounted order ──────────────────────────────────────────

describe("OrderRepository.importOrders() — discounted order", () => {
  it("stores total_discounts on order and total_discount on line items", async () => {
    const db = makeMockDb();
    db._select.orderBy.mockResolvedValueOnce([]);
    db._select.limit
      .mockResolvedValueOnce([])   // customer lookup
      .mockResolvedValueOnce([])   // address lookup
      .mockResolvedValueOnce([])   // order lookup
      .mockResolvedValueOnce([]);  // line item lookup
    const repo = new OrderRepository(db as any);

    const discountedOrder = makeShopifyOrder({
      total_discounts: "15.00",
      line_items: [makeLineItem({ total_discount: "15.00" })]
    });

    await repo.importOrders([discountedOrder]);

    const orderValues = db.insert.mock.results[2].value.values.mock.calls[0][0];
    expect(orderValues.totalDiscounts).toBe(15.0);

    const itemValues = db.insert.mock.results[3].value.values.mock.calls[0][0];
    expect(itemValues.totalDiscount).toBe(15.0);
  });
});

// ── importOrders — decimal money handling ────────────────────────────────────

describe("OrderRepository.importOrders() — decimal money handling", () => {
  it("parses money string fields as numbers (not kept as strings)", async () => {
    const db = makeMockDb();
    db._select.orderBy.mockResolvedValueOnce([]);
    db._select.limit
      .mockResolvedValueOnce([])   // customer lookup
      .mockResolvedValueOnce([])   // address lookup
      .mockResolvedValueOnce([])   // order lookup
      .mockResolvedValueOnce([]);  // line item lookup
    const repo = new OrderRepository(db as any);

    await repo.importOrders([makeShopifyOrder()]);

    const orderValues = db.insert.mock.results[2].value.values.mock.calls[0][0];
    expect(typeof orderValues.subtotalPrice).toBe("number");
    expect(typeof orderValues.totalPrice).toBe("number");
    expect(typeof orderValues.totalTax).toBe("number");
    expect(orderValues.subtotalPrice).toBe(99.98);
    expect(orderValues.totalPrice).toBe(109.98);
  });
});
