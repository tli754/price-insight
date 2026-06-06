import { and, count as sqlCount, desc, eq, inArray, like, max, or, sum as sqlSum } from "drizzle-orm";

import type { Database } from "../db/index.js";
import {
  customerAddresses,
  customers,
  orderItems,
  orders,
  products
} from "../db/schema.js";
import type { MappedCustomer, MappedAddress, MappedOrder } from "../lib/order-mapper.js";

// ── Shopify API types ──────────────────────────────────────────────────────────

export type ShopifyAddress = {
  id: number | null;
  name: string | null;
  company: string | null;
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
  state: string | null;
  currency: string | null;
  verified_email: boolean | null;
  tags: string | null;
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
  current_quantity: number | null;
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
  source_name: string | null;
  referring_site: string | null;
  landing_site: string | null;
  processed_at: string | null;
  total_weight: number | null;
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
      phone: data.phone ?? null,
      state: data.state ?? null,
      currency: data.currency ?? null,
      verifiedEmail: data.verified_email ?? null,
      tags: data.tags ?? null
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
      addressName: address.name ?? null,
      company: address.company ?? null,
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
      sourceName: data.source_name ?? null,
      referringSite: data.referring_site ?? null,
      landingSite: data.landing_site ?? null,
      processedAt: data.processed_at ? new Date(data.processed_at) : null,
      totalWeight: data.total_weight ?? null,
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
        currentQuantity: item.current_quantity ?? null,
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

  async listOrders(opts: {
    page: number;
    limit: number;
    search?: string;
    financialStatus?: string;
    fulfillmentStatus?: string;
  }): Promise<{ items: OrderListRow[]; total: number; totalSales: number | null }> {
    const { page, limit, search, financialStatus, fulfillmentStatus } = opts;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (search) {
      conditions.push(
        or(
          like(orders.orderNumber, `%${search}%`),
          like(orders.email, `%${search}%`)
        )
      );
    }
    if (financialStatus) conditions.push(eq(orders.financialStatus, financialStatus));
    if (fulfillmentStatus) conditions.push(eq(orders.fulfillmentStatus, fulfillmentStatus));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total, totalSales }]] = await Promise.all([
      this.db
        .select({
          id: orders.id,
          shopifyOrderId: orders.shopifyOrderId,
          orderNumber: orders.orderNumber,
          email: orders.email,
          customerFirstName: customers.firstName,
          customerLastName: customers.lastName,
          financialStatus: orders.financialStatus,
          fulfillmentStatus: orders.fulfillmentStatus,
          currency: orders.currency,
          totalPrice: orders.totalPrice,
          totalShipping: orders.totalShipping,
          itemCount: sqlCount(orderItems.id),
          shopifyCreatedAt: orders.shopifyCreatedAt
        })
        .from(orders)
        .leftJoin(customers, eq(orders.customerId, customers.id))
        .leftJoin(orderItems, eq(orders.id, orderItems.orderId))
        .where(where)
        .groupBy(orders.id)
        .orderBy(desc(orders.shopifyCreatedAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ total: sqlCount(orders.id), totalSales: sqlSum(orders.totalPrice) })
        .from(orders)
        .where(where)
    ]);

    return {
      items: rows as OrderListRow[],
      total: Number(total),
      totalSales: totalSales != null ? parseFloat(String(totalSales)) : null,
    };
  }

  // ── GraphQL-based upsert ───────────────────────────────────────────────────

  private async upsertMappedCustomer(customer: MappedCustomer): Promise<number> {
    const [existing] = await this.db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.shopifyCustomerId, customer.shopifyCustomerId))
      .limit(1);

    const payload = {
      shopifyCustomerId: customer.shopifyCustomerId,
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone,
      state: customer.state,
      currency: customer.currency,
      verifiedEmail: customer.verifiedEmail,
      tags: customer.tags,
    };

    if (existing) {
      await this.db.update(customers).set(payload).where(eq(customers.id, existing.id));
      return existing.id;
    }

    const result = await this.db.insert(customers).values(payload).$returningId();
    return Number(result[0]?.id);
  }

  private async upsertMappedAddress(customerId: number, address: MappedAddress): Promise<void> {
    if (!address.shopifyAddressId) return;

    const [existing] = await this.db
      .select({ id: customerAddresses.id })
      .from(customerAddresses)
      .where(eq(customerAddresses.shopifyAddressId, address.shopifyAddressId))
      .limit(1);

    const payload = {
      customerId,
      shopifyAddressId: address.shopifyAddressId,
      addressName: address.addressName,
      company: address.company,
      address1: address.address1,
      address2: address.address2,
      city: address.city,
      province: address.province,
      country: address.country,
      zip: address.zip,
    };

    if (existing) {
      await this.db.update(customerAddresses).set(payload).where(eq(customerAddresses.id, existing.id));
    } else {
      await this.db.insert(customerAddresses).values(payload);
    }
  }

  async upsertMappedOrder(mapped: MappedOrder): Promise<{ skipped: boolean }> {
    // Upsert customer + address first (outside transaction — idempotent).
    let customerId: number | null = null;
    if (mapped.customer) {
      customerId = await this.upsertMappedCustomer(mapped.customer);
      if (mapped.customer.address) {
        await this.upsertMappedAddress(customerId, mapped.customer.address);
      }
    }

    // Staleness check — find existing order row.
    const [existing] = await this.db
      .select({ id: orders.id, shopifyUpdatedAt: orders.shopifyUpdatedAt })
      .from(orders)
      .where(eq(orders.shopifyOrderId, mapped.shopifyOrderId))
      .limit(1);

    if (existing?.shopifyUpdatedAt) {
      const stored = new Date(existing.shopifyUpdatedAt);
      if (mapped.shopifyUpdatedAt <= stored) {
        return { skipped: true };
      }
    }

    // Upsert order + replace line items inside a transaction.
    await this.db.transaction(async (tx) => {
      const orderPayload = {
        shopifyOrderId: mapped.shopifyOrderId,
        customerId,
        orderNumber: mapped.orderNumber,
        email: mapped.email,
        financialStatus: mapped.financialStatus,
        fulfillmentStatus: mapped.fulfillmentStatus,
        currency: mapped.currency,
        subtotalPrice: mapped.subtotalPrice,
        totalPrice: mapped.totalPrice,
        totalTax: mapped.totalTax,
        totalShipping: mapped.totalShipping,
        totalDiscounts: mapped.totalDiscounts,
        sourceName: mapped.sourceName,
        processedAt: mapped.processedAt,
        cancelledAt: mapped.cancelledAt,
        shopifyCreatedAt: mapped.shopifyCreatedAt,
        shopifyUpdatedAt: mapped.shopifyUpdatedAt,
      };

      let orderId: number;
      if (existing) {
        await tx.update(orders).set(orderPayload).where(eq(orders.id, existing.id));
        orderId = existing.id;
      } else {
        const result = await tx.insert(orders).values(orderPayload).$returningId();
        orderId = Number(result[0]?.id);
      }

      // Resolve product FK mappings.
      const shopifyProductIds = mapped.items
        .map((i) => i.shopifyProductId)
        .filter((id): id is number => id != null);

      const productLookup = new Map<number, number>();
      if (shopifyProductIds.length > 0) {
        const rows = await tx
          .select({ id: products.id, externalId: products.externalId })
          .from(products)
          .where(inArray(products.externalId, shopifyProductIds));
        for (const row of rows) productLookup.set(row.externalId, row.id);
      }

      // Replace line items.
      await tx.delete(orderItems).where(eq(orderItems.orderId, orderId));

      if (mapped.items.length > 0) {
        await tx.insert(orderItems).values(
          mapped.items.map((item) => ({
            orderId,
            productId: item.shopifyProductId != null
              ? (productLookup.get(item.shopifyProductId) ?? null)
              : null,
            shopifyLineItemId: item.shopifyLineItemId,
            shopifyProductId: item.shopifyProductId,
            shopifyVariantId: item.shopifyVariantId,
            title: item.title,
            variantTitle: item.variantTitle,
            sku: item.sku,
            quantity: item.quantity,
            currentQuantity: item.currentQuantity,
            unitPrice: item.unitPrice,
            totalDiscount: item.totalDiscount,
          }))
        );
      }
    });

    return { skipped: false };
  }

  async getOrderById(id: number): Promise<OrderDetailRow | null> {
    const [order] = await this.db
      .select()
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);

    if (!order) return null;

    const [customer, address, items] = await Promise.all([
      order.customerId
        ? this.db
            .select()
            .from(customers)
            .where(eq(customers.id, order.customerId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
      order.customerId
        ? this.db
            .select()
            .from(customerAddresses)
            .where(eq(customerAddresses.customerId, order.customerId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
      this.db
        .select({
          id: orderItems.id,
          orderId: orderItems.orderId,
          productId: orderItems.productId,
          shopifyLineItemId: orderItems.shopifyLineItemId,
          shopifyProductId: orderItems.shopifyProductId,
          shopifyVariantId: orderItems.shopifyVariantId,
          title: orderItems.title,
          variantTitle: orderItems.variantTitle,
          sku: orderItems.sku,
          quantity: orderItems.quantity,
          currentQuantity: orderItems.currentQuantity,
          unitPrice: orderItems.unitPrice,
          totalDiscount: orderItems.totalDiscount,
          createdAt: orderItems.createdAt,
          productTitle: products.title
        })
        .from(orderItems)
        .leftJoin(products, eq(orderItems.productId, products.id))
        .where(eq(orderItems.orderId, id))
    ]);

    return { order, customer, address, items };
  }
}

export type OrderListRow = {
  id: number;
  shopifyOrderId: number;
  orderNumber: string;
  email: string | null;
  customerFirstName: string | null;
  customerLastName: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  currency: string | null;
  totalPrice: number | null;
  totalShipping: number | null;
  itemCount: number;
  shopifyCreatedAt: Date | null;
};

export type OrderDetailRow = {
  order: typeof import("../db/schema.js").orders.$inferSelect;
  customer: typeof import("../db/schema.js").customers.$inferSelect | null;
  address: typeof import("../db/schema.js").customerAddresses.$inferSelect | null;
  items: (typeof import("../db/schema.js").orderItems.$inferSelect & { productTitle: string | null })[];
};
