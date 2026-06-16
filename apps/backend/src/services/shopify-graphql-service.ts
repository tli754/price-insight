import { AppError } from "../lib/app-error.js";

const ORDER_BY_ID_QUERY = `
  query GetOrder($id: ID!) {
    order(id: $id) {
      id
      name
      email
      createdAt
      updatedAt
      processedAt
      cancelledAt
      displayFinancialStatus
      displayFulfillmentStatus
      currencyCode
      tags
      sourceName
      subtotalPriceSet      { shopMoney { amount currencyCode } }
      totalDiscountsSet     { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      totalTaxSet           { shopMoney { amount currencyCode } }
      totalPriceSet         { shopMoney { amount currencyCode } }
      lineItems(first: 50) {
        pageInfo { hasNextPage }
        nodes {
          id title sku vendor quantity variantTitle
          variant { id }
          product { id }
          originalUnitPriceSet { shopMoney { amount currencyCode } }
          discountedTotalSet   { shopMoney { amount currencyCode } }
        }
      }
    }
  }
`;

const ORDERS_QUERY = `
  query GetOrders($cursor: String, $query: String) {
    orders(first: 100, after: $cursor, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        email
        createdAt
        updatedAt
        processedAt
        cancelledAt
        displayFinancialStatus
        displayFulfillmentStatus
        currencyCode
        tags
        sourceName
        subtotalPriceSet      { shopMoney { amount currencyCode } }
        totalDiscountsSet     { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        totalTaxSet           { shopMoney { amount currencyCode } }
        totalPriceSet         { shopMoney { amount currencyCode } }
        lineItems(first: 50) {
          pageInfo { hasNextPage }
          nodes {
            id title sku vendor quantity variantTitle
            variant { id }
            product { id }
            originalUnitPriceSet { shopMoney { amount currencyCode } }
            discountedTotalSet   { shopMoney { amount currencyCode } }
          }
        }
      }
    }
  }
`;

const LINE_ITEM_BUDGET_THRESHOLD = 100; // pause if GraphQL cost budget drops below this
const LINE_ITEM_TRUNCATION_WARNING = true;

export type ShopifyGQLMoneySet = {
  shopMoney: { amount: string; currencyCode: string };
};

export type ShopifyGQLLineItem = {
  id: string;
  title: string;
  sku: string | null;
  vendor: string | null;
  quantity: number;
  variantTitle: string | null;
  variant: { id: string } | null;
  product: { id: string } | null;
  originalUnitPriceSet: ShopifyGQLMoneySet;
  discountedTotalSet: ShopifyGQLMoneySet;
};

export type ShopifyGQLCustomer = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  state: string;
  tags: string[];
  defaultAddress: {
    id: string;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    country: string | null;
    zip: string | null;
    name: string | null;
    company: string | null;
  } | null;
};

export type ShopifyGQLOrder = {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  cancelledAt: string | null;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  currencyCode: string;
  tags: string[];
  sourceName: string | null;
  subtotalPriceSet: ShopifyGQLMoneySet;
  totalDiscountsSet: ShopifyGQLMoneySet;
  totalShippingPriceSet: ShopifyGQLMoneySet;
  totalTaxSet: ShopifyGQLMoneySet;
  totalPriceSet: ShopifyGQLMoneySet;
  customer?: ShopifyGQLCustomer | null;
  lineItems: { nodes: ShopifyGQLLineItem[] };
};

type ThrottleStatus = {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
};

type SingleOrderGraphQLResponse = {
  data?: {
    order?: (Omit<ShopifyGQLOrder, "lineItems"> & {
      lineItems: {
        pageInfo: { hasNextPage: boolean };
        nodes: ShopifyGQLLineItem[];
      };
    }) | null;
  };
  errors?: Array<{ message: string }>;
};

type GraphQLResponse = {
  data?: {
    orders?: {
      pageInfo: { hasNextPage: boolean; endCursor: string };
      nodes: Array<
        Omit<ShopifyGQLOrder, "lineItems"> & {
          lineItems: {
            pageInfo: { hasNextPage: boolean };
            nodes: ShopifyGQLLineItem[];
          };
        }
      >;
    };
  };
  extensions?: {
    cost?: {
      throttleStatus?: ThrottleStatus;
    };
  };
  errors?: Array<{ message: string }>;
};

export class ShopifyGraphQLService {
  private readonly graphqlUrl: string;

  constructor(productsUrl: string) {
    this.graphqlUrl = productsUrl.replace(/\/products\.json(\?.*)?$/, "/graphql.json");
  }

  /**
   * Yields one page of orders at a time (up to 100 per page).
   * Handles Shopify cost-based throttling — waits for budget to restore
   * before fetching the next page if currentlyAvailable drops below the threshold.
   */
  async *streamOrders(
    accessToken: string,
    filter: string
  ): AsyncGenerator<ShopifyGQLOrder[]> {
    let cursor: string | null = null;
    // Always include status:any so closed/cancelled orders are returned.
    // Without this Shopify defaults to open orders only.
    const effectiveFilter = filter ? `${filter} status:any` : "status:any";

    do {
      const res = await fetch(this.graphqlUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: ORDERS_QUERY,
          variables: { cursor: cursor ?? undefined, query: effectiveFilter },
        }),
      });

      if (!res.ok) {
        throw new AppError(502, "SHOPIFY_GRAPHQL_FAILED", `Shopify GraphQL request failed: ${res.status}`);
      }

      const json = (await res.json()) as GraphQLResponse;

      if (json.errors?.length) {
        const msg = json.errors[0].message;
        // THROTTLED is recoverable — wait 2 s and retry this page
        if (msg.toLowerCase().includes("throttled")) {
          await sleep(2000);
          continue;
        }
        throw new AppError(502, "SHOPIFY_GRAPHQL_ERROR", `Shopify GraphQL error: ${msg}`);
      }

      const page = json.data?.orders;
      if (!page) break;

      // Warn when any order on this page has truncated line items
      if (LINE_ITEM_TRUNCATION_WARNING) {
        for (const order of page.nodes) {
          if (order.lineItems.pageInfo.hasNextPage) {
            console.warn(
              `[shopify-graphql] Order ${order.name} (${order.id}) has >50 line items — only first 50 were fetched.`
            );
          }
        }
      }

      // Strip the extra pageInfo from lineItems before yielding (callers expect ShopifyGQLOrder)
      yield page.nodes.map((o) => ({
        ...o,
        lineItems: { nodes: o.lineItems.nodes },
      }));

      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;

      // Throttle: if budget is low, wait for it to partially restore before next page
      const throttle = json.extensions?.cost?.throttleStatus;
      if (throttle && cursor && throttle.currentlyAvailable < LINE_ITEM_BUDGET_THRESHOLD) {
        const needed = LINE_ITEM_BUDGET_THRESHOLD - throttle.currentlyAvailable;
        const waitMs = Math.ceil((needed / throttle.restoreRate) * 1000) + 200;
        await sleep(waitMs);
      }
    } while (cursor);
  }

  /**
   * Fetches a single order by its GID. Returns null when not found.
   */
  async fetchOrderById(accessToken: string, gid: string): Promise<ShopifyGQLOrder | null> {
    const res = await fetch(this.graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query: ORDER_BY_ID_QUERY, variables: { id: gid } }),
    });

    if (!res.ok) {
      throw new AppError(502, "SHOPIFY_GRAPHQL_FAILED", `Shopify GraphQL request failed: ${res.status}`);
    }

    const json = (await res.json()) as SingleOrderGraphQLResponse;

    if (json.errors?.length) {
      throw new AppError(502, "SHOPIFY_GRAPHQL_ERROR", `Shopify GraphQL error: ${json.errors[0].message}`);
    }

    const order = json.data?.order;
    if (!order) return null;

    if (order.lineItems.pageInfo.hasNextPage) {
      console.warn(`[shopify-graphql] Order ${order.name} (${order.id}) has >50 line items — only first 50 were fetched.`);
    }

    return { ...order, lineItems: { nodes: order.lineItems.nodes } };
  }

  /**
   * Collects all orders into a single array.
   * Suitable for small incremental syncs (e.g. last 36 hours).
   * For bulk initial loads prefer streamOrders() to avoid large memory spikes.
   */
  async fetchOrders(accessToken: string, filter: string): Promise<ShopifyGQLOrder[]> {
    const all: ShopifyGQLOrder[] = [];
    for await (const page of this.streamOrders(accessToken, filter)) {
      all.push(...page);
    }
    return all;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
