import type { CompetitorProductRow, ProductRow } from "../db/schema.js";
import { AppError } from "../lib/app-error.js";
import { analyzePrice } from "../lib/price-analysis.js";
import { CompetitorRepository } from "./competitor-repository.js";
import type { CompetitorResult } from "./dataforseo-service.js";
import { DataForSeoService } from "./dataforseo-service.js";

export class CompetitorAnalysisService {
  constructor(
    private readonly dataForSeo: DataForSeoService,
    private readonly competitorRepository: CompetitorRepository,
    private readonly ownStoreName?: string
  ) {}

  async searchAndSuggest(product: ProductRow): Promise<CompetitorResult[]> {
    const query = [product.brand, product.title].filter(Boolean).join(" ");

    if (!query) {
      throw new AppError(422, "MISSING_PRODUCT_NAME", "Product has no name or brand to search with.");
    }

    const results = await this.dataForSeo.searchShoppingPrices(query);

    if (results.length === 0) {
      throw new AppError(502, "NO_COMPETITOR_RESULTS", "No competitor results found for this product.");
    }

    const ownStore = this.ownStoreName?.trim().toLowerCase();
    const filtered = ownStore
      ? results.filter(r => normalizeSource(r.source).toLowerCase() !== ownStore)
      : results;

    await this.competitorRepository.deleteSuggestedByProduct(product.id);

    const rows = filtered.map((r) => ({
      competitorId: null,
      title: r.title,
      externalId: r.externalId,
      productLink: r.link,
      source: normalizeSource(r.source),
      currency: r.currency,
      thumbnail: r.thumbnail,
      tag: r.tag,
      googlePosition: r.googlePosition ?? null,
      rawPrice: r.rawPrice,
      extractedPrice: r.extractedPrice,
      country: r.country ?? null,
      rating: r.rating ?? null,
      reviewCount: r.reviewCount ?? null,
      shippingRaw: r.shippingRaw ?? null,
      shippingExtracted: r.shippingExtracted ?? null,
      extractedOldPrice: r.extractedOldPrice ?? null
    }));

    await this.competitorRepository.insertSuggestedCompetitors(product.id, rows);

    return filtered;
  }

  async saveCompetitors(product: ProductRow, selected: CompetitorResult[]): Promise<CompetitorProductRow[]> {
    const uniqueSources = [...new Set(selected.map((r) => normalizeSource(r.source)))];
    const competitorMap = new Map<string, number>();

    for (const source of uniqueSources) {
      const comp = await this.competitorRepository.findOrCreateCompetitor(source);
      competitorMap.set(source, comp.id);
    }

    const rows = selected.map((r) => ({
      competitorId: competitorMap.get(normalizeSource(r.source)) ?? 0,
      title: r.title,
      externalId: r.externalId,
      productLink: r.link,
      source: normalizeSource(r.source),
      currency: r.currency,
      thumbnail: r.thumbnail,
      tag: r.tag,
      googlePosition: r.googlePosition ?? null,
      rawPrice: r.rawPrice,
      extractedPrice: r.extractedPrice,
      country: r.country ?? null,
      rating: r.rating ?? null,
      reviewCount: r.reviewCount ?? null,
      shippingRaw: r.shippingRaw ?? null,
      shippingExtracted: r.shippingExtracted ?? null,
      extractedOldPrice: r.extractedOldPrice ?? null
    }));

    const saved = await this.competitorRepository.replaceCompetitorProducts(product.id, rows);

    if (typeof product.price === "number" && rows.length > 0) {
      const analysis = analyzePrice({
        price: product.price,
        reference_prices: rows.map((row) => row.extractedPrice),
        item: product.title,
        currency: product.currency ?? rows.find((row) => row.currency)?.currency ?? undefined
      });
      await this.competitorRepository.recordPriceInsight(product.id, analysis);
    }

    return saved;
  }
}

function normalizeSource(source: string): string {
  const trimmed = source.trim();
  return trimmed.length > 0 ? trimmed : "Unknown";
}
