import type { LeadsEnv } from "../env.js";
import type { CompanyRepository } from "../repo/company-repository.js";

declare module "fastify" {
  interface FastifyInstance {
    env: LeadsEnv;
    companyRepository: CompanyRepository;
  }
}
