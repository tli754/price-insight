import { AppError } from "../lib/app-error.js";

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

type GraphQLResponse = {
  data?: {
    orders?: {
      pageInfo: { hasNextPage: boolean; endCursor: string };
      nodes: ShopifyGQLOrder[];
    };
  };
  errors?: Array<{ message: string }>;
};

export class ShopifyGraphQLService {
  private readonly graphqlUrl: string;

  constructor(productsUrl: string) {
    this.graphqlUrl = productsUrl.replace(/\/products\.json(\?.*)?$/, "/graphql.json");
  }

  async fetchOrders(accessToken: string, filter: string): Promise<ShopifyGQLOrder[]> {
    const all: ShopifyGQLOrder[] = [];
    let cursor: string | null = null;

    do {
      const res = await fetch(this.graphqlUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: ORDERS_QUERY,
          variables: { cursor: cursor ?? undefined, query: filter },
        }),
      });

      if (!res.ok) {
        throw new AppError(502, "SHOPIFY_GRAPHQL_FAILED", `Shopify GraphQL request failed: ${res.status}`);
      }

      const json = (await res.json()) as GraphQLResponse;

      if (json.errors?.length) {
        throw new AppError(502, "SHOPIFY_GRAPHQL_ERROR", `Shopify GraphQL error: ${json.errors[0].message}`);
      }

      const page = json.data?.orders;
      if (!page) break;

      all.push(...page.nodes);
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);

    return all;
  }
}
