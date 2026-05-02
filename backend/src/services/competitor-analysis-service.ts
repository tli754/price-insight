import type { CompetitorProductRow, ProductRow } from "../db/schema.js";
import { AppError } from "../lib/app-error.js";
import { getJson, setJson, type RedisClient } from "./cache.js";
import { CompetitorRepository } from "./competitor-repository.js";
import type { CompetitorResult } from "./serp-api-service.js";
import { SerpApiService } from "./serp-api-service.js";

const CACHE_TTL_SECONDS = 604800; // 7 days

export type FetchCompetitorsResponse = {
  cached: boolean;
  query: string;
  competitors: CompetitorResult[];
};

export class CompetitorAnalysisService {
  constructor(
    private readonly serpApi: SerpApiService,
    private readonly redis: RedisClient,
    private readonly competitorRepository: CompetitorRepository
  ) {}

  async fetchCompetitors(product: ProductRow): Promise<FetchCompetitorsResponse> {
    const cacheKey = `competitors:product:${product.id}`;
    const cached = await getJson<CompetitorResult[]>(this.redis, cacheKey);

    if (cached) {
      return { cached: true, query: "", competitors: cached };
    }

    const query = [product.brand, product.productName].filter(Boolean).join(" ");

    if (!query) {
      throw new AppError(422, "MISSING_PRODUCT_NAME", "Product has no name or brand to search with.");
    }

    const results = await this.serpApi.searchShoppingPrices(query);

    if (results.length === 0) {
      throw new AppError(502, "NO_COMPETITOR_RESULTS", "No competitor results found for this product.");
    }

    await setJson(this.redis, cacheKey, results, CACHE_TTL_SECONDS);

    return { cached: false, query, competitors: results };
  }

  async saveCompetitors(productId: number, selected: CompetitorResult[]): Promise<CompetitorProductRow[]> {
    const uniqueSources = [...new Set(selected.map((r) => r.source).filter(Boolean))];
    const competitorMap = new Map<string, number>();

    for (const source of uniqueSources) {
      const comp = await this.competitorRepository.findOrCreateCompetitor(source);
      competitorMap.set(source, comp.id);
    }

    const rows = selected.map((r) => ({
      competitorId: competitorMap.get(r.source) ?? 0,
      title: r.title,
      externalId: r.externalId,
      productLink: r.link,
      source: r.source,
      price: r.rawPrice,
      extractedPrice: r.extractedPrice,
      oldPrice: r.rawOldPrice,
      extractedOldPrice: r.extractedOldPrice,
      thumbnail: r.thumbnail,
      tag: r.tag
    }));

    const saved = await this.competitorRepository.replaceCompetitorProducts(productId, rows);
    await this.redis.del(`competitors:product:${productId}`);

    return saved;
  }
}
