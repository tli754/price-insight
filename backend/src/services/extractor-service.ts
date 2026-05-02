import type { AppEnv } from "../config/env.js";
import type { ProductRow } from "../db/schema.js";
import { AppError } from "../lib/app-error.js";
import { getJson, setJson, type RedisClient } from "./cache.js";
import { JinaReaderService } from "./jina-reader.js";
import { OpenAIExtractorService } from "./openai-extractor.js";
import { ProductRepository } from "./product-repository.js";

type ExtractionResponse = {
  cached: boolean;
  product: ProductRow;
};

export class ExtractorService {
  constructor(
    private readonly env: AppEnv,
    private readonly redis: RedisClient,
    private readonly products: ProductRepository,
    private readonly jinaReader: JinaReaderService,
    private readonly extractor: OpenAIExtractorService
  ) {}

  async extractFromUrl(productUrl: string): Promise<ExtractionResponse> {
    const normalizedUrl = normalizeProductUrl(productUrl);
    const cacheKey = `product:url:${normalizedUrl}`;
    const cached = await getJson<ProductRow>(this.redis, cacheKey);

    if (cached) {
      return {
        cached: true,
        product: cached
      };
    }

    const readerContent = await this.jinaReader.read(normalizedUrl);
    const extraction = await this.extractor.extract({
      sourceUrl: normalizedUrl,
      readerContent
    });
    const product = await this.products.saveExtractedProduct({
      extraction,
      rawReaderContent: readerContent
    });

    await setJson(this.redis, cacheKey, product, this.env.REDIS_TTL_SECONDS);

    return {
      cached: false,
      product
    };
  }
}

export function normalizeProductUrl(input: string): string {
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Only http and https URLs are supported.");
    }
    return url.toString();
  } catch {
    throw new AppError(400, "INVALID_URL", "Product URL is invalid.");
  }
}
