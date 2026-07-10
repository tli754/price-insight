import { AppError } from "../lib/app-error.js";
import type { ShopifyOrder } from "./order-repository.js";
import type { ShopifyProduct } from "./product-repository.js";

export class ShopifyService {
  // Derived from productsUrl (.../products.json -> .../inventory_items.json) so
  // cost enrichment needs no extra config.
  private readonly inventoryItemsUrl: string;

  constructor(
    private readonly tokenUrl: string,
    private readonly productsUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly ordersUrl?: string
  ) {
    this.inventoryItemsUrl = productsUrl.replace(/products\.json.*$/, "inventory_items.json");
  }

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
      await this.attachInventoryCosts(accessToken, data.products);
      yield data.products;
      url = parseNextLink(res.headers.get("Link"));
    }
  }

  /**
   * Best-effort enrichment: sets `variant.cost` from Shopify InventoryItem.cost.
   * Requires the `read_inventory` scope — if it's missing (403) or any error
   * occurs, costs are simply left unset and the sync continues unaffected.
   */
  private async attachInventoryCosts(accessToken: string, products: ShopifyProduct[]): Promise<void> {
    const ids: number[] = [];
    for (const p of products) {
      for (const v of p.variants) {
        if (v.inventory_item_id != null) ids.push(v.inventory_item_id);
      }
    }
    if (ids.length === 0) return;

    // Records every returned item, including an explicit `null` cost (cost cleared
    // in Shopify) so importers can tell that apart from "not fetched" (item absent).
    const costById = new Map<number, string | null>();
    try {
      // Shopify caps `ids` per request; chunk conservatively.
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const res = await fetch(`${this.inventoryItemsUrl}?ids=${chunk.join(",")}&limit=${chunk.length}`, {
          headers: { "X-Shopify-Access-Token": accessToken }
        });
        if (!res.ok) return; // missing read_inventory scope or transient error — skip costs
        const data = (await res.json()) as { inventory_items?: { id: number; cost: string | null }[] };
        for (const it of data.inventory_items ?? []) {
          costById.set(it.id, it.cost);
        }
      }
    } catch {
      return; // network/parse failure — leave costs unset
    }

    for (const p of products) {
      for (const v of p.variants) {
        // Leaving v.cost undefined for items the lookup didn't return signals
        // "unavailable" downstream; a stored null here means "explicitly no cost".
        if (v.inventory_item_id != null && costById.has(v.inventory_item_id)) {
          v.cost = costById.get(v.inventory_item_id) ?? null;
        }
      }
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
