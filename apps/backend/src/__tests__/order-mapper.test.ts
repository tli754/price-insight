import { describe, it, expect } from "vitest";

import { extractGidId, mapGraphQLOrder } from "../lib/order-mapper.js";
import type { ShopifyGQLOrder } from "../services/shopify-graphql-service.js";

function makeGQLOrder(overrides: Partial<ShopifyGQLOrder> = {}): ShopifyGQLOrder {
  return {
    id: "gid://shopify/Order/6283106812059",
    name: "#WD3550",
    email: "test@example.com",
    createdAt: "2026-05-27T07:19:44Z",
    updatedAt: "2026-05-27T07:19:46Z",
    processedAt: "2026-05-27T07:19:40Z",
    cancelledAt: null,
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    currencyCode: "NZD",
    tags: ["vip"],
    sourceName: "web",
    subtotalPriceSet: { shopMoney: { amount: "81.00", currencyCode: "NZD" } },
    totalDiscountsSet: { shopMoney: { amount: "0.00", currencyCode: "NZD" } },
    totalShippingPriceSet: { shopMoney: { amount: "18.00", currencyCode: "NZD" } },
    totalTaxSet: { shopMoney: { amount: "2.35", currencyCode: "NZD" } },
    totalPriceSet: { shopMoney: { amount: "99.00", currencyCode: "NZD" } },
    customer: {
      id: "gid://shopify/Customer/8988196012187",
      email: "test@example.com",
      firstName: "Linda",
      lastName: "Hopkinson",
      phone: null,
      state: "DISABLED",
      tags: ["Shop"],
      defaultAddress: {
        id: "gid://shopify/MailingAddress/9868902006939",
        address1: "17 Rhodes Street",
        address2: "Pareora",
        city: "Timaru District",
        province: "Canterbury",
        country: "New Zealand",
        zip: "7912",
        name: "Linda Hopkinson",
        company: null,
      },
    },
    lineItems: {
      nodes: [
        {
          id: "gid://shopify/LineItem/14436684562587",
          title: "800ML Electric Hot Water Kettle White",
          sku: "EK-W-800",
          vendor: "White Donkey",
          quantity: 2,
          variantTitle: null,
          variant: { id: "gid://shopify/ProductVariant/45673272836251" },
          product: { id: "gid://shopify/Product/8304185606299" },
          originalUnitPriceSet: { shopMoney: { amount: "81.00", currencyCode: "NZD" } },
          discountedTotalSet: { shopMoney: { amount: "152.00", currencyCode: "NZD" } },
        },
      ],
    },
    ...overrides,
  };
}

describe("extractGidId()", () => {
  it("extracts numeric ID from a Shopify GID", () => {
    expect(extractGidId("gid://shopify/Order/6283106812059")).toBe(6283106812059);
  });

  it("extracts numeric ID from a Customer GID", () => {
    expect(extractGidId("gid://shopify/Customer/8988196012187")).toBe(8988196012187);
  });

  it("throws for an invalid GID", () => {
    expect(() => extractGidId("not-a-gid")).toThrow();
  });
});

describe("mapGraphQLOrder()", () => {
  it("maps shopify GID to numeric shopifyOrderId", () => {
    const result = mapGraphQLOrder(makeGQLOrder());
    expect(result.shopifyOrderId).toBe(6283106812059);
  });

  it("strips # prefix from order name for orderNumber", () => {
    const result = mapGraphQLOrder(makeGQLOrder());
    expect(result.orderNumber).toBe("WD3550");
  });

  it("lowercases displayFinancialStatus", () => {
    const result = mapGraphQLOrder(makeGQLOrder({ displayFinancialStatus: "PAID" }));
    expect(result.financialStatus).toBe("paid");
  });

  it("lowercases displayFulfillmentStatus", () => {
    const result = mapGraphQLOrder(makeGQLOrder({ displayFulfillmentStatus: "UNFULFILLED" }));
    expect(result.fulfillmentStatus).toBe("unfulfilled");
  });

  it("parses money fields as numbers", () => {
    const result = mapGraphQLOrder(makeGQLOrder());
    expect(result.totalPrice).toBe(99.0);
    expect(result.subtotalPrice).toBe(81.0);
    expect(result.totalShipping).toBe(18.0);
  });

  it("parses updatedAt as a Date", () => {
    const result = mapGraphQLOrder(makeGQLOrder());
    expect(result.shopifyUpdatedAt).toBeInstanceOf(Date);
    expect(result.shopifyUpdatedAt.toISOString()).toBe("2026-05-27T07:19:46.000Z");
  });

  it("sets cancelledAt to null when not cancelled", () => {
    const result = mapGraphQLOrder(makeGQLOrder({ cancelledAt: null }));
    expect(result.cancelledAt).toBeNull();
  });

  it("maps customer GID to numeric shopifyCustomerId", () => {
    const result = mapGraphQLOrder(makeGQLOrder());
    expect(result.customer?.shopifyCustomerId).toBe(8988196012187);
  });

  it("lowercases customer state", () => {
    const result = mapGraphQLOrder(makeGQLOrder());
    expect(result.customer?.state).toBe("disabled");
  });

  it("maps customer tags array to comma-separated string", () => {
    const result = mapGraphQLOrder(makeGQLOrder());
    expect(result.customer?.tags).toBe("Shop");
  });

  it("sets customer to null when order has no customer", () => {
    const result = mapGraphQLOrder(makeGQLOrder({ customer: null }));
    expect(result.customer).toBeNull();
  });

  it("maps line item GID to numeric shopifyLineItemId", () => {
    const result = mapGraphQLOrder(makeGQLOrder());
    expect(result.items[0].shopifyLineItemId).toBe(14436684562587);
  });

  it("maps line item product and variant GIDs", () => {
    const result = mapGraphQLOrder(makeGQLOrder());
    expect(result.items[0].shopifyProductId).toBe(8304185606299);
    expect(result.items[0].shopifyVariantId).toBe(45673272836251);
  });

  it("computes totalDiscount as unitPrice * qty - discountedTotal", () => {
    // unitPrice=81, qty=2 → gross=162, discountedTotal=152 → discount=10
    const result = mapGraphQLOrder(makeGQLOrder());
    expect(result.items[0].totalDiscount).toBe(10);
  });

  it("sets totalDiscount to 0 when no discount applied", () => {
    const order = makeGQLOrder();
    order.lineItems.nodes[0].discountedTotalSet.shopMoney.amount = "162.00"; // no discount
    const result = mapGraphQLOrder(order);
    expect(result.items[0].totalDiscount).toBe(0);
  });

  it("sets product and variant to null when absent on line item", () => {
    const order = makeGQLOrder();
    order.lineItems.nodes[0].product = null;
    order.lineItems.nodes[0].variant = null;
    const result = mapGraphQLOrder(order);
    expect(result.items[0].shopifyProductId).toBeNull();
    expect(result.items[0].shopifyVariantId).toBeNull();
  });
});
