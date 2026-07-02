import { AppError } from "../lib/app-error.js";
import type { ShopifyOrder } from "./order-repository.js";
import type { ShopifyProduct } from "./product-repository.js";

export class ShopifyService {
  constructor(
    private readonly tokenUrl: string,
    private readonly productsUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly ordersUrl?: string
  ) {}

  async getAccessToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret
    });

    const res = await fetch(this.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body
    });

    if (res.status === 401 || res.status === 403) {
      throw new AppError(401, "SHOPIFY_AUTH_FAILED", "Shopify authentication failed. Check your session token and credentials.");
    }
    if (!res.ok) {
      throw new AppError(502, "SHOPIFY_FAILED", `Shopify token exchange failed: ${res.status}`);
    }

    const data = await res.json() as { access_token?: string };
    if (!data.access_token) {
      throw new AppError(502, "SHOPIFY_FAILED", "Shopify did not return an access token.");
    }

    return data.access_token;
  }

  async *streamProducts(accessToken: string): AsyncGenerator<ShopifyProduct[]> {
    let url: string | null = `${this.productsUrl}?limit=50`;

    while (url) {
      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": accessToken }
      });
      if (!res.ok) {
        throw new AppError(502, "SHOPIFY_FAILED", `Shopify products fetch failed: ${res.status}`);
      }
      const data = (await res.json()) as { products: ShopifyProduct[] };
      yield data.products;
      url = parseNextLink(res.headers.get("Link"));
    }
  }

  async fetchOrders(accessToken: string, updatedAtMin?: string): Promise<ShopifyOrder[]> {
    if (!this.ordersUrl) {
      throw new AppError(503, "SHOPIFY_ORDERS_NOT_CONFIGURED", "Shopify orders URL is not configured.");
    }

    const all: ShopifyOrder[] = [];
    let url: string | null = `${this.ordersUrl}?limit=100&status=any`;
    if (updatedAtMin) {
      url += `&updated_at_min=${encodeURIComponent(updatedAtMin)}`;
    }

    while (url) {
      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": accessToken }
      });
      if (!res.ok) {
        throw new AppError(502, "SHOPIFY_FAILED", `Shopify orders fetch failed: ${res.status}`);
      }
      const data = (await res.json()) as { orders: ShopifyOrder[] };
      all.push(...data.orders);
      url = parseNextLink(res.headers.get("Link"));
    }

    return all;
  }
}

function parseNextLink(link: string | null): string | null {
  if (!link) return null;
  const match = link.match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1] ?? null;
}
