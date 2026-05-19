import type { AppEnv } from "../config/env.js";
import type { CompetitorAnalysisService } from "../services/competitor-analysis-service.js";
import type { CompetitorRepository } from "../services/competitor-repository.js";
import type { ProductRepository } from "../services/product-repository.js";

declare module "fastify" {
  interface FastifyInstance {
    env: AppEnv;
    productRepository: ProductRepository;
    competitorRepository: CompetitorRepository;
    competitorAnalysisService: CompetitorAnalysisService;
  }
}
