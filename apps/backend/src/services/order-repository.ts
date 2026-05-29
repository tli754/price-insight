import { eq, inArray, max } from "drizzle-orm";

import type { Database } from "../db/index.js";
import {
  customerAddresses,
  customers,
  orderItems,
  orders,
  products
} from "../db/schema.js";

// ── Shopify API types ──────────────────────────────────────────────────────────

export type ShopifyAddress = {
  id: number | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  zip: string | null;
};

export type ShopifyCustomer = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  default_address: ShopifyAddress | null;
};

export type ShopifyLineItem = {
  id: number;
  product_id: number | null;
  variant_id: number | null;
  title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  price: string;
  total_discount: string;
};

export type ShopifyOrder = {
  id: number;
  order_number: number;
  email: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  currency: string | null;
  subtotal_price: string | null;
  total_price: string | null;
  total_tax: string | null;
  total_shipping_price_set: { shop_money: { amount: string } } | null;
  total_discounts: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  customer: ShopifyCustomer | null;
  line_items: ShopifyLineItem[];
};

// ── Repository ────────────────────────────────────────────────────────────────

export class OrderRepository {
  constructor(private readonly db: Database) {}

  async getLastSyncedAt(): Promise<string | null> {
    const [row] = await this.db
      .select({ maxUpdatedAt: max(orders.shopifyUpdatedAt) })
      .from(orders)
      .limit(1);
    const val = row?.maxUpdatedAt;
    if (!val) return null;
    return val instanceof Date ? val.toISOString() : String(val);
  }

  private async upsertCustomer(data: ShopifyCustomer): Promise<number> {
    const [existing] = await this.db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.shopifyCustomerId, data.id))
      .limit(1);

    const payload = {
      shopifyCustomerId: data.id,
      email: data.email,
      firstName: data.first_name,
      lastName: data.last_name,
      phone: data.phone ?? null
    };

    if (existing) {
      await this.db.update(customers).set(payload).where(eq(customers.id, existing.id));
      return existing.id;
    }

    const result = await this.db.insert(customers).values(payload).$returningId();
    return Number(result[0]?.id);
  }

  private async upsertCustomerAddress(customerId: number, address: ShopifyAddress): Promise<void> {
    if (!address.id) return;

    const [existing] = await this.db
      .select({ id: customerAddresses.id })
      .from(customerAddresses)
      .where(eq(customerAddresses.shopifyAddressId, address.id))
      .limit(1);

    const payload = {
      customerId,
      shopifyAddressId: address.id,
      address1: address.address1 ?? null,
      address2: address.address2 ?? null,
      city: address.city ?? null,
      province: address.province ?? null,
      country: address.country ?? null,
      zip: address.zip ?? null
    };

    if (existing) {
      await this.db.update(customerAddresses).set(payload).where(eq(customerAddresses.id, existing.id));
    } else {
      await this.db.insert(customerAddresses).values(payload);
    }
  }

  private async upsertOrder(data: ShopifyOrder, customerId: number | null): Promise<number> {
    const shipping = data.total_shipping_price_set?.shop_money?.amount ?? null;

    const payload = {
      shopifyOrderId: data.id,
      customerId,
      orderNumber: String(data.order_number),
      email: data.email ?? null,
      financialStatus: data.financial_status ?? null,
      fulfillmentStatus: data.fulfillment_status ?? null,
      currency: data.currency ?? null,
      subtotalPrice: data.subtotal_price ? parseFloat(data.subtotal_price) : null,
      totalPrice: data.total_price ? parseFloat(data.total_price) : null,
      totalTax: data.total_tax ? parseFloat(data.total_tax) : null,
      totalShipping: shipping ? parseFloat(shipping) : null,
      totalDiscounts: data.total_discounts ? parseFloat(data.total_discounts) : null,
      cancelledAt: data.cancelled_at ? new Date(data.cancelled_at) : null,
      shopifyCreatedAt: data.created_at ? new Date(data.created_at) : null,
      shopifyUpdatedAt: data.updated_at ? new Date(data.updated_at) : null
    };

    const [existing] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.shopifyOrderId, data.id))
      .limit(1);

    if (existing) {
      await this.db.update(orders).set(payload).where(eq(orders.id, existing.id));
      return existing.id;
    }

    const result = await this.db.insert(orders).values(payload).$returningId();
    return Number(result[0]?.id);
  }

  private async upsertOrderItems(
    orderId: number,
    items: ShopifyLineItem[],
    productLookup: Map<number, number>
  ): Promise<void> {
    for (const item of items) {
      const productId = item.product_id != null ? (productLookup.get(item.product_id) ?? null) : null;

      const payload = {
        orderId,
        productId,
        shopifyLineItemId: item.id,
        shopifyProductId: item.product_id ?? null,
        shopifyVariantId: item.variant_id ?? null,
        title: item.title,
        variantTitle: item.variant_title ?? null,
        sku: item.sku ?? null,
        quantity: item.quantity,
        unitPrice: item.price ? parseFloat(item.price) : null,
        totalDiscount: item.total_discount ? parseFloat(item.total_discount) : null
      };

      const [existing] = await this.db
        .select({ id: orderItems.id })
        .from(orderItems)
        .where(eq(orderItems.shopifyLineItemId, item.id))
        .limit(1);

      if (existing) {
        await this.db.update(orderItems).set(payload).where(eq(orderItems.id, existing.id));
      } else {
        await this.db.insert(orderItems).values(payload);
      }
    }
  }

  async importOrders(shopifyOrders: ShopifyOrder[]): Promise<number> {
    const shopifyProductIds = [
      ...new Set(
        shopifyOrders
          .flatMap((o) => o.line_items.map((li) => li.product_id))
          .filter((id): id is number => id != null)
      )
    ];

    const productLookup = new Map<number, number>();
    if (shopifyProductIds.length > 0) {
      const rows = await this.db
        .select({ id: products.id, externalId: products.externalId })
        .from(products)
        .where(inArray(products.externalId, shopifyProductIds))
        .orderBy(products.id);
      for (const row of rows) {
        productLookup.set(row.externalId, row.id);
      }
    }

    let count = 0;
    for (const order of shopifyOrders) {
      let customerId: number | null = null;

      if (order.customer) {
        customerId = await this.upsertCustomer(order.customer);
        if (order.customer.default_address) {
          await this.upsertCustomerAddress(customerId, order.customer.default_address);
        }
      }

      const orderId = await this.upsertOrder(order, customerId);
      await this.upsertOrderItems(orderId, order.line_items, productLookup);
      count++;
    }

    return count;
  }
}
