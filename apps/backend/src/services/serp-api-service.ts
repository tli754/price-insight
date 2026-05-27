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
  link: string;
  thumbnail: string | null;
  tag: string | null;
};

type SerpApiShoppingResult = {
  title?: string;
  product_id?: string;
  product_link?: string;
  price?: string;
  extracted_price?: number;
  old_price?: string;
  extracted_old_price?: number;
  source?: string;
  thumbnail?: string;
  tag?: string;
};

type SerpApiResponse = {
  shopping_results?: SerpApiShoppingResult[];
};

export class SerpApiService {
  constructor(private readonly apiKey: string) {}

  async searchShoppingPrices(query: string): Promise<CompetitorResult[]> {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_shopping");
    url.searchParams.set("q", query);
    url.searchParams.set("api_key", this.apiKey);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new AppError(
        502,
        "SERPAPI_FAILED",
        `SerpAPI request failed with ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as SerpApiResponse;

    return (data.shopping_results ?? [])
      .filter((r) => typeof r.extracted_price === "number" && r.extracted_price > 0)
      .map((r) => ({
        title: r.title ?? "",
        externalId: r.product_id ?? null,
        rawPrice: r.price ?? null,
        extractedPrice: r.extracted_price as number,
        rawOldPrice: r.old_price ?? null,
        extractedOldPrice: r.extracted_old_price ?? null,
        currency: null,
        source: r.source ?? "",
        link: r.product_link ?? "",
        thumbnail: r.thumbnail ?? null,
        tag: r.tag ?? null
      }));
  }
}
