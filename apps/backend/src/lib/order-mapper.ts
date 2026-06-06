import type { ShopifyGQLOrder } from "../services/shopify-graphql-service.js";

export type MappedAddress = {
  shopifyAddressId: number | null;
  addressName: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  zip: string | null;
};

export type MappedCustomer = {
  shopifyCustomerId: number;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  state: string | null;
  currency: string | null;
  verifiedEmail: boolean | null;
  tags: string | null;
  address: MappedAddress | null;
};

export type MappedOrderItem = {
  shopifyLineItemId: number;
  shopifyProductId: number | null;
  shopifyVariantId: number | null;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  currentQuantity: number | null;
  unitPrice: number | null;
  totalDiscount: number | null;
};

export type MappedOrder = {
  shopifyOrderId: number;
  shopifyUpdatedAt: Date;
  orderNumber: string;
  email: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  currency: string | null;
  subtotalPrice: number | null;
  totalPrice: number | null;
  totalTax: number | null;
  totalShipping: number | null;
  totalDiscounts: number | null;
  sourceName: string | null;
  processedAt: Date | null;
  cancelledAt: Date | null;
  shopifyCreatedAt: Date | null;
  customer: MappedCustomer | null;
  items: MappedOrderItem[];
};

export function extractGidId(gid: string): number {
  const part = gid.split("/").pop();
  if (!part) throw new Error(`Invalid Shopify GID: ${gid}`);
  const n = parseInt(part, 10);
  if (isNaN(n)) throw new Error(`Non-numeric GID segment: ${gid}`);
  return n;
}

function parseMoney(amount: string | null | undefined): number | null {
  if (amount == null) return null;
  const n = parseFloat(amount);
  return isNaN(n) ? null : n;
}

function normalizeStatus(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.toLowerCase();
}

export function mapGraphQLOrder(order: ShopifyGQLOrder): MappedOrder {
  const shopifyOrderId = extractGidId(order.id);

  const customer: MappedCustomer | null = order.customer
    ? {
        shopifyCustomerId: extractGidId(order.customer.id),
        email: order.customer.email,
        firstName: order.customer.firstName,
        lastName: order.customer.lastName,
        phone: order.customer.phone ?? null,
        state: normalizeStatus(order.customer.state),
        currency: null, // not available on GraphQL Customer node
        verifiedEmail: null, // not available on GraphQL Customer node
        tags: Array.isArray(order.customer.tags) && order.customer.tags.length > 0
          ? order.customer.tags.join(", ")
          : null,
        address: order.customer.defaultAddress
          ? {
              shopifyAddressId: extractGidId(order.customer.defaultAddress.id),
              addressName: order.customer.defaultAddress.name ?? null,
              company: order.customer.defaultAddress.company ?? null,
              address1: order.customer.defaultAddress.address1 ?? null,
              address2: order.customer.defaultAddress.address2 ?? null,
              city: order.customer.defaultAddress.city ?? null,
              province: order.customer.defaultAddress.province ?? null,
              country: order.customer.defaultAddress.country ?? null,
              zip: order.customer.defaultAddress.zip ?? null,
            }
          : null,
      }
    : null;

  const items: MappedOrderItem[] = order.lineItems.nodes.map((li) => {
    const unitPrice = parseMoney(li.originalUnitPriceSet.shopMoney.amount);
    const discountedTotal = parseMoney(li.discountedTotalSet.shopMoney.amount);
    const totalDiscount =
      unitPrice != null && discountedTotal != null
        ? Math.max(0, Math.round((unitPrice * li.quantity - discountedTotal) * 10000) / 10000)
        : null;

    return {
      shopifyLineItemId: extractGidId(li.id),
      shopifyProductId: li.product ? extractGidId(li.product.id) : null,
      shopifyVariantId: li.variant ? extractGidId(li.variant.id) : null,
      title: li.title,
      variantTitle: li.variantTitle ?? null,
      sku: li.sku ?? null,
      quantity: li.quantity,
      currentQuantity: null,
      unitPrice,
      totalDiscount,
    };
  });

  return {
    shopifyOrderId,
    shopifyUpdatedAt: new Date(order.updatedAt),
    orderNumber: order.name.replace(/^#/, ""),
    email: order.email ?? null,
    financialStatus: normalizeStatus(order.displayFinancialStatus),
    fulfillmentStatus: normalizeStatus(order.displayFulfillmentStatus),
    currency: order.currencyCode,
    subtotalPrice: parseMoney(order.subtotalPriceSet.shopMoney.amount),
    totalPrice: parseMoney(order.totalPriceSet.shopMoney.amount),
    totalTax: parseMoney(order.totalTaxSet.shopMoney.amount),
    totalShipping: parseMoney(order.totalShippingPriceSet.shopMoney.amount),
    totalDiscounts: parseMoney(order.totalDiscountsSet.shopMoney.amount),
    sourceName: order.sourceName ?? null,
    processedAt: order.processedAt ? new Date(order.processedAt) : null,
    cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : null,
    shopifyCreatedAt: new Date(order.createdAt),
    customer,
    items,
  };
}
