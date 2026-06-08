import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { AppError } from "../lib/app-error.js";
import { REPORT_TYPES, type ReportType } from "../types/ai-report.js";

const generateBodySchema = z.object({
  reports: z
    .array(z.enum(REPORT_TYPES))
    .optional()
    .default([...REPORT_TYPES]),
});

const reportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/products/:id/reports/ai/latest", async (request) => {
    const id = parseProductId((request.params as { id: string }).id);

    const product = await fastify.productRepository.getProductById(id);
    if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found.");

    const report = await fastify.aiReportService.getLatestReport(id);
    return { productId: id, report: report ?? null };
  });

  fastify.post("/products/:id/reports/ai", async (request, reply) => {
    const id = parseProductId((request.params as { id: string }).id);

    const product = await fastify.productRepository.getProductById(id);
    if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found.");

    const body = generateBodySchema.parse(request.body ?? {});
    const reportTypes: ReportType[] = body.reports;

    const report = await fastify.aiReportService.generateReport(id, reportTypes);

    reply.code(201);
    return { productId: id, report };
  });
};

export default reportRoutes;

function parseProductId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, "INVALID_PRODUCT_ID", "Product id must be a positive integer.");
  }
  return id;
}
