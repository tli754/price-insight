import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../db/index.js";
import { productAiReports, type NewProductAiReportRow, type ProductAiReportRow } from "../db/schema.js";

export class AiReportRepository {
  constructor(private readonly db: Database) {}

  async getLatestSuccessful(productId: number): Promise<ProductAiReportRow | null> {
    const [row] = await this.db
      .select()
      .from(productAiReports)
      .where(and(eq(productAiReports.productId, productId), eq(productAiReports.status, "success")))
      .orderBy(desc(productAiReports.createdAt))
      .limit(1);
    return row ?? null;
  }

  async getById(id: number): Promise<ProductAiReportRow | null> {
    const [row] = await this.db
      .select()
      .from(productAiReports)
      .where(eq(productAiReports.id, id))
      .limit(1);
    return row ?? null;
  }

  async insert(data: NewProductAiReportRow): Promise<number> {
    const result = await this.db.insert(productAiReports).values(data).$returningId();
    return Number(result[0]?.id);
  }

  async updateCompleted(
    id: number,
    status: "success" | "failed",
    output: unknown,
    errorMessage: string | null,
    completedAt: Date
  ): Promise<void> {
    await this.db
      .update(productAiReports)
      .set({ status, output, errorMessage, completedAt })
      .where(eq(productAiReports.id, id));
  }
}
