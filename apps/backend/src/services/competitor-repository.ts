import { asc, and, count, desc, eq, gte, max, ne } from "drizzle-orm";

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
  competitorId: number | null;
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
  country?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  shippingRaw?: string | null;
  shippingExtracted?: number | null;
  extractedOldPrice?: number | null;
};

function normalizeCompetitorName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\bnew zealand\b/gi, "nz")
    .replace(/\baustralia\b/gi, "au")
    .replace(/\s+/g, " ")
    .trim();
}

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
      .where(and(eq(competitorProducts.competitorId, competitorId), ne(competitorProducts.status, "deleted")))
      .orderBy(desc(competitorProducts.createdAt));
  }

  async findOrCreateCompetitor(name: string): Promise<CompetitorRow> {
    const normalized = normalizeCompetitorName(name);
    const all = await this.db.select().from(competitor).orderBy(asc(competitor.name));
    const existing = all.find((c) => normalizeCompetitorName(c.name) === normalized);

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
      .where(and(eq(competitorProducts.productId, productId), ne(competitorProducts.status, "deleted")))
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
      .where(and(eq(competitorProducts.productId, productId), ne(competitorProducts.status, "deleted")))
      .orderBy(desc(competitorProducts.createdAt));
  }

  async replaceCompetitorProducts(
    productId: number,
    items: CompetitorProductInput[]
  ): Promise<CompetitorProductRow[]> {
    for (const item of items) {
      await this.db.transaction(async (tx) => {
        // Find existing record by productId + externalId + competitorId
        const [existing] = item.externalId && item.competitorId != null
          ? await tx
              .select()
              .from(competitorProducts)
              .where(
                and(
                  eq(competitorProducts.productId, productId),
                  eq(competitorProducts.competitorId, item.competitorId),
                  eq(competitorProducts.externalId, item.externalId)
                )
              )
              .limit(1)
          : [];

        let competitorProductId: number;

        if (existing) {
          competitorProductId = existing.id;
        } else {
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
              googlePosition: item.googlePosition ?? null,
              country: item.country ?? null,
              rating: item.rating ?? null,
              reviewCount: item.reviewCount ?? null,
              shippingRaw: item.shippingRaw ?? null,
              shippingExtracted: item.shippingExtracted ?? null,
              extractedOldPrice: item.extractedOldPrice ?? null
            })
            .$returningId();
          competitorProductId = Number(result[0]?.id);
        }

        await tx.insert(priceHistory).values({
          competitorProductId,
          price: item.rawPrice,
          extractedPrice: item.extractedPrice
        });
      });
    }

    return this.getProductsByProductId(productId);
  }

  async getDeletedExternalIds(productId: number): Promise<Set<string>> {
    const rows = await this.db
      .select({ externalId: competitorProducts.externalId })
      .from(competitorProducts)
      .where(and(eq(competitorProducts.productId, productId), eq(competitorProducts.status, "deleted")));
    return new Set(rows.map((r) => r.externalId).filter((id): id is string => id != null));
  }

  async deleteCompetitorProduct(id: number): Promise<void> {
    await this.db
      .update(competitorProducts)
      .set({ status: "deleted" })
      .where(eq(competitorProducts.id, id));
  }

  async getExistingCompetitorKeys(productId: number): Promise<Set<string>> {
    const rows = await this.db
      .select({ externalId: competitorProducts.externalId, source: competitorProducts.source })
      .from(competitorProducts)
      .where(and(
        eq(competitorProducts.productId, productId),
        ne(competitorProducts.status, "suggested")
      ));
    return new Set(rows.map((r) => `${r.externalId}:${r.source}`));
  }

  async recordPricesForConfirmed(productId: number, items: CompetitorProductInput[]): Promise<void> {
    const confirmed = await this.db
      .select({ id: competitorProducts.id, externalId: competitorProducts.externalId, source: competitorProducts.source })
      .from(competitorProducts)
      .where(and(eq(competitorProducts.productId, productId), eq(competitorProducts.status, "confirmed")));

    if (confirmed.length === 0) return;

    // key: externalId:source — both are already normalised when stored
    const lookup = new Map(confirmed.map((c) => [`${c.externalId}:${c.source}`, c.id]));

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    for (const item of items) {
      if (!item.externalId) continue;
      const key = `${item.externalId}:${item.source}`;
      const competitorProductId = lookup.get(key);
      if (!competitorProductId) continue;

      const [todayRecord] = await this.db
        .select({ id: priceHistory.id })
        .from(priceHistory)
        .where(and(
          eq(priceHistory.competitorProductId, competitorProductId),
          gte(priceHistory.capturedAt, startOfToday)
        ))
        .limit(1);

      if (todayRecord) {
        await this.db
          .update(priceHistory)
          .set({ price: item.rawPrice, extractedPrice: item.extractedPrice, capturedAt: new Date() })
          .where(eq(priceHistory.id, todayRecord.id));
      } else {
        await this.db.insert(priceHistory).values({
          competitorProductId,
          price: item.rawPrice,
          extractedPrice: item.extractedPrice
        });
      }
    }
  }

  async deleteSuggestedByProduct(productId: number): Promise<void> {
    await this.db
      .delete(competitorProducts)
      .where(and(eq(competitorProducts.productId, productId), eq(competitorProducts.status, "suggested")));
  }

  async insertSuggestedCompetitors(
    productId: number,
    items: CompetitorProductInput[]
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const item of items) {
        const result = await tx
          .insert(competitorProducts)
          .values({
            productId,
            competitorId: item.competitorId ?? null,
            title: item.title,
            externalId: item.externalId,
            productLink: item.productLink,
            source: item.source,
            currency: item.currency,
            thumbnail: item.thumbnail,
            tag: item.tag,
            googlePosition: item.googlePosition ?? null,
            status: "suggested",
            country: item.country ?? null,
            rating: item.rating ?? null,
            reviewCount: item.reviewCount ?? null,
            shippingRaw: item.shippingRaw ?? null,
            shippingExtracted: item.shippingExtracted ?? null,
            extractedOldPrice: item.extractedOldPrice ?? null
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
  }

  async upsertSuggestedCompetitor(productId: number, item: CompetitorProductInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [existing] = item.externalId
        ? await tx
            .select({ id: competitorProducts.id })
            .from(competitorProducts)
            .where(
              and(
                eq(competitorProducts.productId, productId),
                eq(competitorProducts.externalId, item.externalId),
                eq(competitorProducts.source, item.source),
                eq(competitorProducts.status, "suggested")
              )
            )
            .limit(1)
        : [];

      let competitorProductId: number;

      if (existing) {
        competitorProductId = existing.id;
      } else {
        const result = await tx
          .insert(competitorProducts)
          .values({
            productId,
            competitorId: null,
            title: item.title,
            externalId: item.externalId,
            productLink: item.productLink,
            source: item.source,
            currency: item.currency,
            thumbnail: item.thumbnail,
            tag: item.tag,
            googlePosition: item.googlePosition ?? null,
            status: "suggested",
            country: item.country ?? null,
            rating: item.rating ?? null,
            reviewCount: item.reviewCount ?? null,
            shippingRaw: item.shippingRaw ?? null,
            shippingExtracted: item.shippingExtracted ?? null,
            extractedOldPrice: item.extractedOldPrice ?? null
          })
          .$returningId();
        competitorProductId = Number(result[0]?.id);
      }

      await tx.insert(priceHistory).values({
        competitorProductId,
        price: item.rawPrice,
        extractedPrice: item.extractedPrice
      });
    });
  }

  async confirmCompetitorProduct(id: number): Promise<void> {
    const [row] = await this.db
      .select()
      .from(competitorProducts)
      .where(eq(competitorProducts.id, id))
      .limit(1);

    if (!row) return;

    const comp = await this.findOrCreateCompetitor(row.source);

    await this.db
      .update(competitorProducts)
      .set({ status: "confirmed", competitorId: comp.id })
      .where(eq(competitorProducts.id, id));
  }

  async getCompetitorsByProductId(productId: number) {
    // Subquery: latest capturedAt per competitor product
    const latestPrice = this.db
      .select({
        competitorProductId: priceHistory.competitorProductId,
        maxCapturedAt: max(priceHistory.capturedAt).as("max_captured_at")
      })
      .from(priceHistory)
      .groupBy(priceHistory.competitorProductId)
      .as("latest_price");

    return this.db
      .select({
        id: competitorProducts.id,
        title: competitorProducts.title,
        source: competitorProducts.source,
        thumbnail: competitorProducts.thumbnail,
        productLink: competitorProducts.productLink,
        currency: competitorProducts.currency,
        tag: competitorProducts.tag,
        country: competitorProducts.country,
        googlePosition: competitorProducts.googlePosition,
        status: competitorProducts.status,
        rating: competitorProducts.rating,
        reviewCount: competitorProducts.reviewCount,
        shippingRaw: competitorProducts.shippingRaw,
        shippingExtracted: competitorProducts.shippingExtracted,
        extractedOldPrice: competitorProducts.extractedOldPrice,
        createdAt: competitorProducts.createdAt,
        rawPrice: priceHistory.price,
        extractedPrice: priceHistory.extractedPrice,
        capturedAt: priceHistory.capturedAt
      })
      .from(competitorProducts)
      .leftJoin(latestPrice, eq(latestPrice.competitorProductId, competitorProducts.id))
      .leftJoin(priceHistory, and(
        eq(priceHistory.competitorProductId, competitorProducts.id),
        eq(priceHistory.capturedAt, latestPrice.maxCapturedAt)
      ))
      .where(and(eq(competitorProducts.productId, productId), ne(competitorProducts.status, "deleted")))
      .orderBy(desc(competitorProducts.createdAt));
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
