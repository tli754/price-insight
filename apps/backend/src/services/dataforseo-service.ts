import { AppError } from "../lib/app-error.js";

export type CompetitorResult = {
  title: string;
  externalId: string | null;
  rawPrice: string | null;
  extractedPrice: number;
  extractedOldPrice: number | null;
  currency: string | null;
  source: string;
  link: string;
  country?: string | null;
  thumbnail: string | null;
  tag: string | null;
  googlePosition?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  shippingRaw?: string | null;
  shippingExtracted?: number | null;
};

const BASE_URL = "https://api.dataforseo.com";
const LOCATION_CODE = 2554; // New Zealand
const LANGUAGE_CODE = "en";
const PRODUCT_INFO_LIMIT = 40;
const POLL_RETRIES = 10;
const POLL_DELAY_MS = 3000;

// 40601/40602 = task in queue; anything else is a permanent result
const PENDING_STATUS_CODES = new Set([40601, 40602]);

type DfsTaskPostResponse = {
  tasks: Array<{
    id: string;
    status_code: number;
    status_message: string;
  }>;
};

type DfsShoppingItem = {
  type: string;
  rank_absolute: number | null;
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

export type DfsShoppingGetResponse = {
  tasks: Array<{
    status_code: number;
    result: Array<{
      items: DfsShoppingItem[] | null;
    }> | null;
  }>;
};

type DfsSeller = {
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

export type DfsProductInfoGetResponse = {
  tasks: Array<{
    status_code: number;
    result: Array<{
      items: Array<{
        product_id: string | null;
        title: string | null;
        images: string[] | null;
        sellers: DfsSeller[] | null;
      }> | null;
    }> | null;
  }>;
};

export type ShoppingCandidate = {
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
  googlePosition: number | null;
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

  // Polls a task_get endpoint directly until status 20000 or a permanent non-pending result.
  // Returns null on timeout or unexpected status code.
  private async pollTaskGet<T>(endpoint: string): Promise<T | null> {
    for (let attempt = 0; attempt < POLL_RETRIES; attempt++) {
      if (attempt > 0) await sleep(POLL_DELAY_MS);

      const data = await this.get<{ tasks: Array<{ status_code: number }> }>(endpoint);
      const statusCode = data.tasks?.[0]?.status_code;

      if (statusCode === 20000) return data as unknown as T;

      if (!PENDING_STATUS_CODES.has(statusCode)) {
        console.warn(`DataForSEO: task_get ${endpoint} returned unexpected status ${statusCode}`);
        return null;
      }
    }

    console.warn(`DataForSEO: task_get ${endpoint} timed out after ${POLL_RETRIES} attempts`);
    return null;
  }

  async postShoppingTasks(products: Array<{ id: number; title: string }>, pingbackUrl: string): Promise<number> {
    const data = await this.post<DfsTaskPostResponse>(
      "/v3/merchant/google/products/task_post",
      products.map((p) => ({
        language_code: LANGUAGE_CODE,
        location_code: LOCATION_CODE,
        keyword: p.title,
        price_min: 5,
        tag: String(p.id),
        pingback_url: pingbackUrl
      }))
    );
    return data.tasks.filter((t) => t.id).length;
  }

  async fetchShoppingTaskResult(taskId: string): Promise<DfsShoppingGetResponse> {
    return this.get<DfsShoppingGetResponse>(
      `/v3/merchant/google/products/task_get/advanced/${taskId}`
    );
  }

  async fetchProductInfoTaskResult(taskId: string): Promise<DfsProductInfoGetResponse> {
    return this.get<DfsProductInfoGetResponse>(
      `/v3/merchant/google/product_info/task_get/advanced/${taskId}`
    );
  }

  async postProductInfoTasks(productIds: string[], tag: number, pingbackUrl: string): Promise<void> {
    await this.post<DfsTaskPostResponse>(
      "/v3/merchant/google/product_info/task_post",
      productIds.map((product_id) => ({
        language_code: LANGUAGE_CODE,
        location_code: LOCATION_CODE,
        product_id,
        tag: String(tag),
        pingback_url: pingbackUrl
      }))
    );
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

  parseShoppingCandidates(data: DfsShoppingGetResponse, ownStoreName?: string, limit = PRODUCT_INFO_LIMIT): ShoppingCandidate[] {
    const items = data.tasks?.[0]?.result?.[0]?.items;
    if (!items) return [];

    const seen = new Set<string>();
    const candidates: ShoppingCandidate[] = [];
    const normalizedOwnStore = ownStoreName?.trim().toLowerCase();

    for (const item of items) {
      if (item.type !== "google_shopping_serp") continue;
      if (!item.product_id) continue;
      if (!item.seller) continue;
      if (item.price == null) continue;
      if (item.currency !== "NZD") continue;
      if (normalizedOwnStore && item.seller.trim().toLowerCase() === normalizedOwnStore) continue;

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
        tag: item.tags?.[0] ?? null,
        googlePosition: item.rank_absolute ?? null
      });

      if (candidates.length >= limit) break;
    }

    return candidates;
  }

  async getShoppingCandidates(taskId: string, ownStoreName?: string): Promise<ShoppingCandidate[]> {
    const data = await this.pollTaskGet<DfsShoppingGetResponse>(
      `/v3/merchant/google/products/task_get/advanced/${taskId}`
    );

    if (!data) return [];

    const candidates = this.parseShoppingCandidates(data, ownStoreName);
    console.info(`DataForSEO: ${candidates.length} shopping candidates found for task ${taskId}`);
    return candidates;
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

  // Parses sellers out of an already-fetched product_info task_get response.
  fetchProductInfoResults(data: DfsProductInfoGetResponse, candidate: ShoppingCandidate): CompetitorResult[] {
    const item = data.tasks?.[0]?.result?.[0]?.items?.[0];
    if (!item) {
      console.warn(`DataForSEO: product_info task_get returned null items`);
      return [];
    }

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
        extractedOldPrice: seller.price.regular ?? null,
        currency: seller.price.currency,
        source: seller.title,
        link: seller.url,
        country: deriveCountry(seller.url),
        thumbnail,
        tag: candidate.tag,
        googlePosition: candidate.googlePosition,
        rating: seller.seller_rating?.value ?? null,
        reviewCount: seller.seller_review_count ?? seller.seller_rating?.votes_count ?? null,
        shippingRaw: (seller.delivery_info?.delivery_message ?? null)?.slice(0, 64) ?? null,
        shippingExtracted: seller.delivery_info?.delivery_price?.current ?? null
      });
    }

    return results;
  }

  async searchShoppingPrices(keyword: string, excludeExternalIds?: Set<string>, ownStoreName?: string): Promise<CompetitorResult[]> {
    const shoppingTaskId = await this.createShoppingTask(keyword);
    const rawCandidates = await this.getShoppingCandidates(shoppingTaskId, ownStoreName);
    const candidates = excludeExternalIds?.size
      ? rawCandidates.filter((c) => !excludeExternalIds.has(c.productId))
      : rawCandidates;

    if (candidates.length === 0) return [];

    const allResults = (await Promise.all(
      candidates.map(async (candidate) => {
        try {
          const taskId = await this.createProductInfoTask(candidate.productId);
          const data = await this.pollTaskGet<DfsProductInfoGetResponse>(
            `/v3/merchant/google/product_info/task_get/advanced/${taskId}`
          );
          if (!data) return [] as CompetitorResult[];
          return this.fetchProductInfoResults(data, candidate);
        } catch (err) {
          console.warn(`DataForSEO: failed to process product ${candidate.productId}:`, err);
          return [] as CompetitorResult[];
        }
      })
    )).flat();

    return allResults;
  }
}
