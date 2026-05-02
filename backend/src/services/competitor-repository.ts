import { eq } from "drizzle-orm";

import type { Database } from "../db/index.js";
import {
  competitor,
  competitorProducts,
  type CompetitorProductRow,
  type CompetitorRow,
  type NewCompetitorProductRow
} from "../db/schema.js";

export class CompetitorRepository {
  constructor(private readonly db: Database) {}

  async findOrCreateCompetitor(name: string): Promise<CompetitorRow> {
    const [existing] = await this.db
      .select()
      .from(competitor)
      .where(eq(competitor.name, name))
      .limit(1);

    if (existing) return existing;

    const result = await this.db.insert(competitor).values({ name }).$returningId();
    const insertedId = Number(result[0]?.id);
    const [created] = await this.db
      .select()
      .from(competitor)
      .where(eq(competitor.id, insertedId))
      .limit(1);
    return created!;
  }

  async getProductsByProductId(productId: number): Promise<CompetitorProductRow[]> {
    return this.db
      .select()
      .from(competitorProducts)
      .where(eq(competitorProducts.productId, productId));
  }

  async replaceCompetitorProducts(
    productId: number,
    items: Omit<NewCompetitorProductRow, "productId">[]
  ): Promise<CompetitorProductRow[]> {
    await this.db.transaction(async (tx) => {
      await tx.delete(competitorProducts).where(eq(competitorProducts.productId, productId));
      if (items.length > 0) {
        await tx.insert(competitorProducts).values(items.map((item) => ({ ...item, productId })));
      }
    });
    return this.getProductsByProductId(productId);
  }
}
