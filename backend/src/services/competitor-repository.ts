import { asc, count, desc, eq, max } from "drizzle-orm";

import type { Database } from "../db/index.js";
import {
  competitor,
  competitorProducts,
  priceHistory,
  priceInsights,
  products,
  type CompetitorProductRow,
  type CompetitorRow
} from "../db/schema.js";
import type { PriceAnalysisResult } from "../lib/price-analysis.js";

export type CompetitorProductInput = {
  competitorId: number;
  title: string;
  externalId: string | null;
  productLink: string;
  source: string;
  currency: string | null;
  thumbnail: string | null;
  tag: string | null;
  googlePosition?: number | null;
  rawPrice: string | null;
  extractedPrice: number;
};

export class CompetitorRepository {
  constructor(private readonly db: Database) {}

  async getAllCompetitors() {
    return this.db
      .select({
        id: competitor.id,
        name: competitor.name,
        state: competitor.state,
        thumbnail: competitor.thumbnail,
        createdAt: competitor.createdAt,
        matchedProducts: count(competitorProducts.id),
        lastScraped: max(competitorProducts.createdAt)
      })
      .from(competitor)
      .leftJoin(competitorProducts, eq(competitorProducts.competitorId, competitor.id))
      .groupBy(competitor.id)
      .orderBy(asc(competitor.name));
  }

  async getCompetitorById(id: number): Promise<CompetitorRow | null> {
    const [row] = await this.db
      .select()
      .from(competitor)
      .where(eq(competitor.id, id))
      .limit(1);
    return row ?? null;
  }

  async getProductsByCompetitorId(competitorId: number) {
    return this.db
      .select({
        id: competitorProducts.id,
        thumbnail: competitorProducts.thumbnail,
        title: competitorProducts.title,
        productLink: competitorProducts.productLink,
        source: competitorProducts.source,
        googlePosition: competitorProducts.googlePosition,
        currency: competitorProducts.currency,
        currentPrice: priceHistory.extractedPrice,
        lastCheckedAt: priceHistory.capturedAt,
        matchedProductId: products.id,
        matchedProductTitle: products.title
      })
      .from(competitorProducts)
      .leftJoin(priceHistory, eq(priceHistory.competitorProductId, competitorProducts.id))
      .leftJoin(products, eq(products.id, competitorProducts.productId))
      .where(eq(competitorProducts.competitorId, competitorId))
      .orderBy(desc(competitorProducts.createdAt));
  }

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
      .where(eq(competitorProducts.productId, productId))
      .orderBy(desc(competitorProducts.createdAt));
  }

  async getSavedCompetitorsWithPrice(productId: number) {
    return this.db
      .select({
        id: competitorProducts.id,
        title: competitorProducts.title,
        source: competitorProducts.source,
        thumbnail: competitorProducts.thumbnail,
        productLink: competitorProducts.productLink,
        currency: competitorProducts.currency,
        tag: competitorProducts.tag,
        createdAt: competitorProducts.createdAt,
        rawPrice: priceHistory.price,
        extractedPrice: priceHistory.extractedPrice,
        capturedAt: priceHistory.capturedAt
      })
      .from(competitorProducts)
      .leftJoin(priceHistory, eq(priceHistory.competitorProductId, competitorProducts.id))
      .where(eq(competitorProducts.productId, productId))
      .orderBy(desc(competitorProducts.createdAt));
  }

  async replaceCompetitorProducts(
    productId: number,
    items: CompetitorProductInput[]
  ): Promise<CompetitorProductRow[]> {
    await this.db.transaction(async (tx) => {
      await tx.delete(competitorProducts).where(eq(competitorProducts.productId, productId));

      for (const item of items) {
        const result = await tx
          .insert(competitorProducts)
          .values({
            productId,
            competitorId: item.competitorId,
            title: item.title,
            externalId: item.externalId,
            productLink: item.productLink,
            source: item.source,
            currency: item.currency,
            thumbnail: item.thumbnail,
            tag: item.tag,
            googlePosition: item.googlePosition ?? null
          })
          .$returningId();

        const competitorProductId = Number(result[0]?.id);

        await tx.insert(priceHistory).values({
          competitorProductId,
          price: item.rawPrice,
          extractedPrice: item.extractedPrice
        });
      }
    });

    return this.getProductsByProductId(productId);
  }

  async deleteCompetitorProduct(id: number): Promise<void> {
    await this.db.delete(competitorProducts).where(eq(competitorProducts.id, id));
  }

  async recordPriceInsight(productId: number, analysis: PriceAnalysisResult): Promise<void> {
    await this.db.insert(priceInsights).values({
      productId,
      minPrice: analysis.statistics.minimum,
      maxPrice: analysis.statistics.maximum,
      summary: analysis.recommendation,
      marketPosition: analysis.position.label
    });
  }
}
