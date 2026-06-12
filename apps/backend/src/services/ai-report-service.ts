import crypto from "node:crypto";

import type OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { ZodError } from "zod";

import type { ProductAiReportRow } from "../db/schema.js";
import { productAiReportsOutputSchema, type ProductAiReportsOutput, type ReportType } from "../types/ai-report.js";
import type { AiReportRepository } from "./ai-report-repository.js";
import type { CompetitorRepository } from "./competitor-repository.js";
import type { OrderRepository } from "./order-repository.js";
import type { ProductRepository } from "./product-repository.js";

const SYSTEM_PROMPT =
  "You are a pricing and ecommerce analysis assistant for a small online retailer. " +
  "Use only the supplied data. Do not invent facts. If data is missing, lower confidence or return " +
  "INSUFFICIENT_DATA where appropriate. Keep recommendations practical, concise, and suitable for a " +
  "store owner. Return JSON only.";

export class AiReportService {
  constructor(
    private readonly aiReportRepository: AiReportRepository,
    private readonly productRepository: ProductRepository,
    private readonly competitorRepository: CompetitorRepository,
    private readonly orderRepository: OrderRepository,
    private readonly openai: OpenAI,
    private readonly model: string
  ) {}

  async getLatestReport(productId: number): Promise<ProductAiReportRow | null> {
    return this.aiReportRepository.getLatestSuccessful(productId);
  }

  async generateReport(productId: number, reportTypes: ReportType[]): Promise<ProductAiReportRow> {
    const [product, competitors, salesHistory] = await Promise.all([
      this.productRepository.getProductById(productId),
      this.competitorRepository.getCompetitorsByProductId(productId),
      this.orderRepository.getProductSalesHistory(productId, { page: 1, limit: 50 }),
    ]);

    if (!product) throw new Error("Product not found");

    const payload = this.buildPayload(product, competitors, salesHistory, reportTypes);
    const inputHash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

    const reportId = await this.aiReportRepository.insert({
      productId,
      status: "pending",
      model: this.model,
      reportTypes,
      inputHash,
      inputSnapshot: payload,
    });

    let output: ProductAiReportsOutput | null = null;
    let errorMessage: string | null = null;
    let status: "success" | "failed" = "failed";

    try {
      output = await this.callOpenAI(payload);
      status = "success";
    } catch (err) {
      if (err instanceof ZodError) {
        errorMessage = `OpenAI response failed schema validation (${err.issues.length} issues)`;
      } else {
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    }

    await this.aiReportRepository.updateCompleted(reportId, status, output, errorMessage, new Date());

    const record = await this.aiReportRepository.getById(reportId);
    return record!;
  }

  buildPayload(
    product: NonNullable<Awaited<ReturnType<ProductRepository["getProductById"]>>>,
    competitors: Awaited<ReturnType<CompetitorRepository["getCompetitorsByProductId"]>>,
    salesHistory: Awaited<ReturnType<OrderRepository["getProductSalesHistory"]>>,
    reportTypes: ReportType[]
  ) {
    const confirmedCompetitors = competitors
      .filter((c) => c.status === "confirmed")
      .slice(0, 20)
      .map((c) => ({
        id: c.id,
        title: c.title,
        source: c.source,
        currency: c.currency,
        country: c.country,
        extractedPrice: c.extractedPrice,
        shippingRaw: c.shippingRaw,
        status: c.status,
        capturedAt: c.capturedAt instanceof Date ? c.capturedAt.toISOString() : c.capturedAt,
      }));

    // Strip PII: exclude customer names, emails, and addresses from order lines
    const anonymisedItems = salesHistory.items.slice(0, 50).map((item) => ({
      date: item.processedAt,
      qty: item.qty,
      unitPrice: item.unitPrice,
      financialStatus: item.financialStatus,
    }));

    return {
      product: {
        id: product.id,
        title: product.title,
        sku: product.sku,
        brand: product.brand,
        price: product.price,
        currency: product.currency,
        inventoryQuantity: product.inventoryQuantity,
        tags: product.tags,
        description: product.description,
        imageUrls: product.images.slice(0, 5).map((img) => img.src),
      },
      competitors: confirmedCompetitors,
      sales: {
        summary: salesHistory.summary,
        monthly: salesHistory.monthly.slice(0, 12),
        recentOrders: anonymisedItems,
      },
      requestedReports: reportTypes,
    };
  }

  private async callOpenAI(payload: unknown): Promise<ProductAiReportsOutput> {
    const response = await this.openai.chat.completions.parse({
      model: this.model,
      response_format: zodResponseFormat(productAiReportsOutputSchema, "product_ai_report"),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });

    const choice = response.choices[0];
    if (!choice) throw new Error("OpenAI returned no choices");

    if (choice.finish_reason === "length") {
      throw new Error("OpenAI response was truncated (token limit reached)");
    }

    const parsed = choice.message.parsed;
    if (!parsed) throw new Error("OpenAI returned empty parsed output");

    return parsed;
  }
}
