import type { CompetitorProductInput } from "../services/competitor-repository.js";
import type { CompetitorResult } from "../services/dataforseo-service.js";

// Used for case-insensitive comparisons (e.g. matching against OWN_STORE_NAME).
export function normalizeSourceForCompare(source: string): string {
  return source.trim().toLowerCase();
}

// Used when persisting/displaying a source name — preserves casing, defaults blank to "Unknown".
export function normalizeSourceForDisplay(source: string): string {
  const trimmed = source.trim();
  return trimmed.length > 0 ? trimmed : "Unknown";
}

export function filterByCountryAndPriceRange(
  results: CompetitorResult[],
  productPrice: number | null
): CompetitorResult[] {
  return results.filter((r) => {
    if (r.country !== "NZ" && r.country !== "AU") return false;
    if (productPrice != null) {
      if (r.extractedPrice < productPrice / 2 || r.extractedPrice > productPrice * 2) return false;
    }
    return true;
  });
}

export function mapToCompetitorProductInput(
  r: CompetitorResult,
  competitorId: number | null = null
): CompetitorProductInput {
  return {
    competitorId,
    title: r.title,
    externalId: r.externalId,
    productLink: r.link,
    source: normalizeSourceForDisplay(r.source),
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
  };
}
