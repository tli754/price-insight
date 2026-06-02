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
    const query = product.title || "";

    if (!query) {
      throw new AppError(422, "MISSING_PRODUCT_NAME", "Product has no name or brand to search with.");
    }

    const deletedExternalIds = await this.competitorRepository.getDeletedExternalIds(product.id);
    console.info(`[searchAndSuggest] product=${product.id} keyword="${query}" deletedIds=${deletedExternalIds.size}`);
    const raw = await this.dataForSeo.searchShoppingPrices(query, deletedExternalIds, this.ownStoreName);

    const results = raw.filter((r) => {
      if (r.country !== "NZ" && r.country !== "AU") return false;
      if (product.price != null) {
        const lo = Number(product.price) / 2;
        const hi = Number(product.price) * 2;
        if (r.extractedPrice < lo || r.extractedPrice > hi) return false;
      }
      return true;
    });

    console.info(`[searchAndSuggest] product=${product.id} raw=${raw.length} filtered=${results.length}`);

    if (results.length === 0) {
      throw new AppError(502, "NO_COMPETITOR_RESULTS", "No competitor results found for this product.");
    }

    const rows = results.map((r) => ({
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

    const existingKeys = await this.competitorRepository.getExistingCompetitorKeys(product.id);
    const newRows = rows.filter((r) => !existingKeys.has(`${r.externalId}:${r.source}`));

    await this.competitorRepository.recordPricesForConfirmed(product.id, rows);
    await this.competitorRepository.deleteSuggestedByProduct(product.id);
    await this.competitorRepository.insertSuggestedCompetitors(product.id, newRows);

    console.info(`[searchAndSuggest] product=${product.id} new_suggested=${newRows.length} skipped=${rows.length - newRows.length}`);

    return results;
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
