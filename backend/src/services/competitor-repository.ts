import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../db/index.js";
import {
  competitor,
  competitorProducts,
  priceHistory,
  priceInsights,
  type CompetitorProductRow,
  type CompetitorRow,
} from "../db/schema.js";
import type { PriceAnalysisResult } from "../lib/price-analysis.js";

export type CompetitorProductInput = {
  competitorId: number;
  title: string;
  externalId: string | null;
  productLinkHash: string;
  productLink: string;
  source: string;
  price: string | null;
  extractedPrice: number;
  oldPrice: string | null;
  extractedOldPrice: number | null;
  currency: string | null;
  thumbnail: string | null;
  tag: string | null;
};

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
      .where(and(eq(competitorProducts.productId, productId), eq(competitorProducts.state, "active")))
      .orderBy(desc(competitorProducts.lastSeenAt));
  }

  async replaceCompetitorProducts(
    productId: number,
    items: CompetitorProductInput[]
  ): Promise<CompetitorProductRow[]> {
    const now = new Date();

    await this.db.transaction(async (tx) => {
      await tx
        .update(competitorProducts)
        .set({ state: "inactive" })
        .where(eq(competitorProducts.productId, productId));

      for (const item of items) {
        const [existing] = await tx
          .select()
          .from(competitorProducts)
          .where(
            and(
              eq(competitorProducts.productId, productId),
              eq(competitorProducts.competitorId, item.competitorId),
              eq(competitorProducts.productLinkHash, item.productLinkHash)
            )
          )
          .limit(1);

        let competitorProductId = existing?.id;

        if (existing) {
          await tx
            .update(competitorProducts)
            .set({
              ...item,
              state: "active",
              lastSeenAt: now
            })
            .where(eq(competitorProducts.id, existing.id));
        } else {
          const result = await tx
            .insert(competitorProducts)
            .values({
              ...item,
              productId,
              state: "active",
              lastSeenAt: now
            })
            .$returningId();
          competitorProductId = Number(result[0]?.id);
        }

        if (!competitorProductId) continue;

        await tx.insert(priceHistory).values({
          competitorProductId,
          price: item.extractedPrice,
          oldPrice: item.extractedOldPrice,
          currency: item.currency,
          observedAt: now
        });
      }
    });
    return this.getProductsByProductId(productId);
  }

  async recordPriceInsight(productId: number, analysis: PriceAnalysisResult): Promise<void> {
    await this.db.insert(priceInsights).values({
      productId,
      referenceCount: analysis.reference_count,
      minimumPrice: analysis.statistics.minimum,
      maximumPrice: analysis.statistics.maximum,
      averagePrice: analysis.statistics.average,
      medianPrice: analysis.statistics.median,
      positionLabel: analysis.position.label,
      percentile: analysis.position.percentile,
      differenceToAverage: analysis.position.difference_to_average,
      differenceToAveragePercent: analysis.position.difference_to_average_percent,
      recommendation: analysis.recommendation,
      confidence: analysis.confidence,
      analysisPayload: analysis as unknown as Record<string, unknown>
    });
  }
}
