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

type SerpApiLocale = {
  location: string;
  gl: string;
  hl: string;
  google_domain: string;
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
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_shopping");
    url.searchParams.set("q", query);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("location", this.locale.location);
    url.searchParams.set("gl", this.locale.gl);
    url.searchParams.set("hl", this.locale.hl);
    url.searchParams.set("google_domain", this.locale.google_domain);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new AppError(
        502,
        "SERPAPI_FAILED",
        `SerpAPI request failed with ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as SerpApiResponse;

    const candidates = (data.shopping_results ?? []).filter(
      (r) => typeof r.extracted_price === "number" && r.extracted_price > 0
    );

    const results = await Promise.all(candidates.map((r) => this.expandToStores(r)));
    return results.flat();
  }

  private async expandToStores(r: SerpApiShoppingResult): Promise<CompetitorResult[]> {
    const stores = r.immersive_product_page_token
      ? await this.fetchStores(r.immersive_product_page_token)
      : null;

    if (!stores || stores.length === 0) {
      return [
        {
          title: r.title ?? "",
          externalId: r.product_id ?? null,
          rawPrice: r.price ?? null,
          extractedPrice: r.extracted_price as number,
          rawOldPrice: r.old_price ?? null,
          extractedOldPrice: r.extracted_old_price ?? null,
          currency: null,
          source: r.source ?? "",
          sourceIcon: null,
          link: r.product_link ?? "",
          country: deriveCountry(r.product_link ?? ""),
          thumbnail: r.thumbnail ?? null,
          tag: r.tag ?? null,
          googlePosition: r.position ?? null,
          rating: null,
          reviewCount: null,
          shippingRaw: null,
          shippingExtracted: null,
          totalRaw: null,
          totalExtracted: null
        }
      ];
    }

    return stores
      .filter((s) => typeof s.extracted_price === "number" && (s.extracted_price ?? 0) > 0)
      .map((s) => ({
        title: s.title ?? r.title ?? "",
        externalId: r.product_id ?? null,
        rawPrice: s.price ?? null,
        extractedPrice: s.extracted_price as number,
        rawOldPrice: s.original_price ?? null,
        extractedOldPrice: s.extracted_original_price ?? null,
        currency: null,
        source: s.name ?? "",
        sourceIcon: s.logo ?? null,
        link: s.link ?? "",
        country: deriveCountry(s.link ?? ""),
        thumbnail: r.thumbnail ?? null,
        tag: s.tag ?? null,
        googlePosition: r.position ?? null,
        rating: s.rating ?? null,
        reviewCount: s.reviews ?? null,
        shippingRaw: s.shipping ?? null,
        shippingExtracted: s.shipping_extracted ?? null,
        totalRaw: s.total ?? null,
        totalExtracted: s.extracted_total ?? null
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
