import { AppError } from "../lib/app-error.js";
import type { ShopifyProduct } from "./product-repository.js";

export class ShopifyService {
  constructor(
    private readonly tokenUrl: string,
    private readonly productsUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string
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

  async fetchAllProducts(accessToken: string): Promise<ShopifyProduct[]> {
    const all: ShopifyProduct[] = [];
    let url: string | null = `${this.productsUrl}?limit=100`;

    while (url) {
      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": accessToken }
      });
      if (!res.ok) {
        throw new AppError(502, "SHOPIFY_FAILED", `Shopify products fetch failed: ${res.status}`);
      }
      const data = (await res.json()) as { products: ShopifyProduct[] };
      all.push(...data.products);
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
