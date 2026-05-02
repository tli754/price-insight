import type { AppEnv } from "../config/env.js";
import type { ProductRepository } from "../services/product-repository.js";
import type { ExtractorService } from "../services/extractor-service.js";

declare module "fastify" {
  interface FastifyInstance {
    env: AppEnv;
    productRepository: ProductRepository;
    extractorService: ExtractorService;
  }
}
