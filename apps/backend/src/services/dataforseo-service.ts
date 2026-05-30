import { AppError } from "../lib/app-error.js";

export type CompetitorResult = {
  title: string;
  externalId: string | null;
  rawPrice: string | null;
  extractedPrice: number;
  rawOldPrice: string | null;
  extractedOldPrice: number | null;
  currency: string | null;
  source: string;
  sourceIcon?: string | null;
  link: string;
  country?: string | null;
  thumbnail: string | null;
  tag: string | null;
  googlePosition?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  shippingRaw?: string | null;
  shippingExtracted?: number | null;
  totalRaw?: string | null;
  totalExtracted?: number | null;
};

const BASE_URL = "https://api.dataforseo.com";
const LOCATION_CODE = 2554; // New Zealand
const LANGUAGE_CODE = "en";
const PRODUCT_INFO_LIMIT = 20;
const POLL_RETRIES = 8;
const POLL_DELAY_MS = 3000;

type DfsTaskPostResponse = {
  tasks: Array<{
    id: string;
    status_code: number;
    status_message: string;
  }>;
};

type DfsShoppingItem = {
  type: string;
  product_id: string | null;
  seller: string | null;
  title: string | null;
  price: number | null;
  currency: string | null;
  old_price: number | null;
  product_images: string[] | null;
  product_rating: { value: number | null; votes_count: number | null } | null;
  tags: string[] | null;
};

type DfsShoppingGetResponse = {
  tasks: Array<{
    id: string;
    status_code: number;
    result: Array<{
      items: DfsShoppingItem[] | null;
    }> | null;
  }>;
};

type DfsSeller = {
  type: string;
  title: string | null;
  url: string | null;
  seller_rating: { value: number | null; votes_count: number | null } | null;
  seller_review_count: number | null;
  price: {
    current: number | null;
    regular: number | null;
    currency: string | null;
    displayed_price: string | null;
  } | null;
  delivery_info: {
    delivery_message: string | null;
    delivery_price: { current: number | null } | null;
  } | null;
};

type DfsProductInfoGetResponse = {
  tasks: Array<{
    id: string;
    status_code: number;
    result: Array<{
      items: Array<{
        type: string;
        product_id: string | null;
        title: string | null;
        images: string[] | null;
        sellers: DfsSeller[] | null;
      }> | null;
    }> | null;
  }>;
};

type ShoppingCandidate = {
  productId: string;
  seller: string;
  title: string;
  price: number;
  currency: string;
  oldPrice: number | null;
  thumbnail: string | null;
  rating: number | null;
  reviewCount: number | null;
  tag: string | null;
};

function deriveCountry(link: string): string | null {
  try {
    const { hostname } = new URL(link);
    if (hostname.endsWith(".co.nz")) return "NZ";
    if (hostname.endsWith(".com.au")) return "AU";
  } catch {
    // invalid URL
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DataForSeoService {
  private readonly authHeader: string;

  constructor(login: string, password: string) {
    this.authHeader = "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new AppError(
        502,
        "DATAFORSEO_FAILED",
        `DataForSEO POST ${path} failed with ${response.status} ${response.statusText}`
      );
    }

    return response.json() as Promise<T>;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: this.authHeader }
    });

    if (!response.ok) {
      throw new AppError(
        502,
        "DATAFORSEO_FAILED",
        `DataForSEO GET ${path} failed with ${response.status} ${response.statusText}`
      );
    }

    return response.json() as Promise<T>;
  }

  async createShoppingTask(keyword: string): Promise<string> {
    const data = await this.post<DfsTaskPostResponse>(
      "/v3/merchant/google/products/task_post",
      [{ language_code: LANGUAGE_CODE, location_code: LOCATION_CODE, keyword, price_min: 5 }]
    );

    const taskId = data.tasks?.[0]?.id;
    if (!taskId) {
      throw new AppError(502, "DATAFORSEO_FAILED", "DataForSEO Shopping task POST returned no task ID");
    }
    return taskId;
  }

  async getShoppingCandidates(taskId: string): Promise<ShoppingCandidate[]> {
    for (let attempt = 0; attempt < POLL_RETRIES; attempt++) {
      if (attempt > 0) await sleep(POLL_DELAY_MS);

      const data = await this.get<DfsShoppingGetResponse>(
        `/v3/merchant/google/products/task_get/advanced/${taskId}`
      );

      const task = data.tasks?.[0];
      if (!task) continue;

      if (task.status_code === 20100 || task.status_code === 40602) continue; // still in queue

      if (task.status_code !== 20000) {
        return []; // unexpected status — give up
      }

      const items = task.result?.[0]?.items ?? [];
      const seen = new Set<string>();
      const candidates: ShoppingCandidate[] = [];

      for (const item of items) {
        if (item.type !== "google_shopping_serp") continue;
        if (!item.product_id) continue;
        if (!item.seller) continue;
        if (item.price == null) continue;
        if (item.currency !== "NZD") continue;

        const key = `${item.product_id}:${item.seller}:${item.title ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);

        candidates.push({
          productId: item.product_id,
          seller: item.seller,
          title: item.title ?? "",
          price: item.price,
          currency: item.currency,
          oldPrice: item.old_price ?? null,
          thumbnail: item.product_images?.[0] ?? null,
          rating: item.product_rating?.value ?? null,
          reviewCount: item.product_rating?.votes_count ?? null,
          tag: item.tags?.[0] ?? null
        });

        if (candidates.length >= PRODUCT_INFO_LIMIT) break;
      }

      return candidates;
    }

    return [];
  }

  async createProductInfoTask(productId: string): Promise<string> {
    const data = await this.post<DfsTaskPostResponse>(
      "/v3/merchant/google/product_info/task_post",
      [{ language_code: LANGUAGE_CODE, location_code: LOCATION_CODE, product_id: productId }]
    );

    const taskId = data.tasks?.[0]?.id;
    if (!taskId) {
      throw new AppError(502, "DATAFORSEO_FAILED", "DataForSEO Product Info task POST returned no task ID");
    }
    return taskId;
  }

  async getProductInfoResults(taskId: string, candidate: ShoppingCandidate): Promise<CompetitorResult[]> {
    for (let attempt = 0; attempt < POLL_RETRIES; attempt++) {
      if (attempt > 0) await sleep(POLL_DELAY_MS);

      const data = await this.get<DfsProductInfoGetResponse>(
        `/v3/merchant/google/product_info/task_get/advanced/${taskId}`
      );

      const task = data.tasks?.[0];
      if (!task) continue;

      if (task.status_code === 20100 || task.status_code === 40602) continue;

      if (task.status_code !== 20000) {
        return [];
      }

      const item = task.result?.[0]?.items?.[0];
      if (!item) return [];

      const title = item.title ?? candidate.title;
      const externalId = item.product_id ?? candidate.productId;
      const thumbnail = item.images?.[0] ?? candidate.thumbnail;

      const results: CompetitorResult[] = [];

      for (const seller of item.sellers ?? []) {
        if (!seller.title) continue;
        if (!seller.url) continue;
        if (seller.price?.current == null) continue;
        if (seller.price?.currency !== "NZD") continue;

        results.push({
          title,
          externalId,
          rawPrice: seller.price.displayed_price ?? null,
          extractedPrice: seller.price.current,
          rawOldPrice: null,
          extractedOldPrice: seller.price.regular ?? null,
          currency: seller.price.currency,
          source: seller.title,
          sourceIcon: null,
          link: seller.url,
          country: deriveCountry(seller.url),
          thumbnail,
          tag: null,
          googlePosition: null,
          rating: seller.seller_rating?.value ?? null,
          reviewCount: seller.seller_rating?.votes_count ?? null,
          shippingRaw: seller.delivery_info?.delivery_message ?? null,
          shippingExtracted: seller.delivery_info?.delivery_price?.current ?? null,
          totalRaw: null,
          totalExtracted: null
        });
      }

      return results;
    }

    return [];
  }

  async searchShoppingPrices(keyword: string): Promise<CompetitorResult[]> {
    const shoppingTaskId = await this.createShoppingTask(keyword);
    const candidates = await this.getShoppingCandidates(shoppingTaskId);

    if (candidates.length === 0) return [];

    const allResults: CompetitorResult[] = [];

    await Promise.all(
      candidates.map(async (candidate) => {
        try {
          const infoTaskId = await this.createProductInfoTask(candidate.productId);
          const results = await this.getProductInfoResults(infoTaskId, candidate);
          allResults.push(...results);
        } catch {
          // one candidate failing should not abort the whole search
        }
      })
    );

    return allResults;
  }
}
