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

type SerpApiLocale = {
  location: string;
  gl: string;
  hl: string;
  google_domain: string;
  num?: number;
};

const NZ_LOCALE: SerpApiLocale = {
  location: "New Zealand",
  gl: "nz",
  hl: "en",
  google_domain: "google.co.nz"
};

type SerpApiShoppingResult = {
  position?: number;
  title?: string;
  product_id?: string;
  product_link?: string;
  immersive_product_page_token?: string;
  price?: string;
  extracted_price?: number;
  old_price?: string;
  extracted_old_price?: number;
  source?: string;
  thumbnail?: string;
  tag?: string;
};

type SerpApiImmersiveStore = {
  name?: string;
  logo?: string;
  link?: string;
  title?: string;
  price?: string;
  extracted_price?: number;
  original_price?: string;
  extracted_original_price?: number;
  shipping?: string;
  shipping_extracted?: number;
  total?: string;
  extracted_total?: number;
  rating?: number;
  reviews?: number;
  tag?: string;
  details_and_offers?: string[];
};

type SerpApiResponse = {
  shopping_results?: SerpApiShoppingResult[];
};

type SerpApiImmersiveResponse = {
  stores?: SerpApiImmersiveStore[];
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

export class SerpApiService {
  constructor(
    private readonly apiKey: string,
    private readonly locale: SerpApiLocale = NZ_LOCALE
  ) {}

  async searchShoppingPrices(query: string): Promise<CompetitorResult[]> {
    const num = this.locale.num ?? 40;
    const allResults: CompetitorResult[] = [];

    // Paginate until we have no more results or hit the num limit.
    // SerpAPI returns at most 100 per page; we step by num.
    for (let start = 0; ; start += num) {
      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google_shopping");
      url.searchParams.set("q", query);
      url.searchParams.set("api_key", this.apiKey);
      url.searchParams.set("location", this.locale.location);
      url.searchParams.set("gl", this.locale.gl);
      url.searchParams.set("hl", this.locale.hl);
      url.searchParams.set("google_domain", this.locale.google_domain);
      url.searchParams.set("num", String(num));
      if (start > 0) url.searchParams.set("start", String(start));

      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new AppError(
          502,
          "SERPAPI_FAILED",
          `SerpAPI request failed with ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as SerpApiResponse;
      const page = data.shopping_results ?? [];
      if (page.length === 0) break;

      const expanded = await Promise.all(page.map((r) => this.expandToStores(r)));
      allResults.push(...expanded.flat());

      // Stop if this page was shorter than requested — no more pages.
      if (page.length < num) break;
    }

    return allResults;
  }

  private async expandToStores(r: SerpApiShoppingResult): Promise<CompetitorResult[]> {
    const stores = r.immersive_product_page_token
      ? await this.fetchStores(r.immersive_product_page_token)
      : null;

    const pricedStores = stores?.filter(
      (s) => typeof s.extracted_price === "number" && s.extracted_price > 0
    ) ?? null;

    // No token, immersive failed, empty stores, or all stores had no price — fall back to shopping result
    if (!pricedStores || pricedStores.length === 0) {
      if (typeof r.extracted_price !== "number" || r.extracted_price <= 0) return [];
      return [
        {
          title: r.title ?? "",
          externalId: r.product_id ?? null,
          rawPrice: r.price ?? null,
          extractedPrice: r.extracted_price,
          extractedOldPrice: r.extracted_old_price ?? null,
          currency: null,
          source: r.source ?? "",
          link: r.product_link ?? "",
          country: deriveCountry(r.product_link ?? ""),
          thumbnail: r.thumbnail ?? null,
          tag: r.tag ?? null,
          googlePosition: r.position ?? null,
          rating: null,
          reviewCount: null,
          shippingRaw: null,
          shippingExtracted: null
        }
      ];
    }

    return pricedStores.map((s) => ({
        title: s.title ?? r.title ?? "",
        externalId: r.product_id ?? null,
        rawPrice: s.price ?? null,
        extractedPrice: s.extracted_price as number,
        extractedOldPrice: s.extracted_original_price ?? null,
        currency: null,
        source: s.name ?? "",
        link: s.link ?? "",
        country: deriveCountry(s.link ?? ""),
        thumbnail: r.thumbnail ?? null,
        tag: s.tag ?? null,
        googlePosition: r.position ?? null,
        rating: s.rating ?? null,
        reviewCount: s.reviews ?? null,
        shippingRaw: s.shipping ?? null,
        shippingExtracted: s.shipping_extracted ?? null
      }));
  }

  private async fetchStores(token: string): Promise<SerpApiImmersiveStore[]> {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_immersive_product");
    url.searchParams.set("page_token", token);
    url.searchParams.set("api_key", this.apiKey);

    try {
      const response = await fetch(url.toString());
      if (!response.ok) return [];
      const data = (await response.json()) as SerpApiImmersiveResponse;
      return data?.stores ?? [];
    } catch {
      return [];
    }
  }
}
