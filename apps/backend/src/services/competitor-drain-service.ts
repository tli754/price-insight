import { filterByCountryAndPriceRange, mapToCompetitorProductInput, normalizeSourceForCompare } from "../lib/competitor-filter.js";
import type { CompetitorTaskPayload } from "../lib/competitor-task-payload.js";
import type { CompetitorRepository } from "./competitor-repository.js";
import type { DataForSeoService, DfsProductInfoGetResponse, DfsShoppingGetResponse } from "./dataforseo-service.js";
import type { ProductRepository } from "./product-repository.js";

export type CompetitorDrainDeps = {
  dataForSeoService: DataForSeoService;
  competitorRepository: CompetitorRepository;
  productRepository: ProductRepository;
  ownStoreName: string | undefined;
  webhookHost: string;
  dataForSeoWebhookSecret: string;
};

/**
 * Processes one message from the dataforseo_competitors queue — moved here
 * from the old internal-competitor.ts routes unchanged (see ADR 0002).
 * Throws on failure so drainQueue can apply the leave-in-queue/archive
 * policy; the caller is responsible for catching.
 */
export async function processCompetitorTaskMessage(deps: CompetitorDrainDeps, payload: CompetitorTaskPayload): Promise<void> {
  if (payload.type === "process-shopping-pingback") {
    await processShoppingPingback(deps, payload.taskId, payload.productId);
    return;
  }
  await processProductInfoPingback(deps, payload.taskId, payload.productId);
}

async function processShoppingPingback(deps: CompetitorDrainDeps, taskId: string, productId: number): Promise<void> {
  const data: DfsShoppingGetResponse = await deps.dataForSeoService.fetchShoppingTaskResult(taskId);

  const candidates = deps.dataForSeoService.parseShoppingCandidates(data, deps.ownStoreName);
  if (candidates.length === 0) return;

  const deletedIds = await deps.competitorRepository.getDeletedExternalIds(productId);
  const filtered = deletedIds.size ? candidates.filter((c) => !deletedIds.has(c.productId)) : candidates;
  if (filtered.length === 0) return;

  const webhookBase = `${deps.webhookHost}/webhooks/dataforseo/pingback/product_info`;
  await deps.dataForSeoService.postProductInfoTasks(
    filtered.map((c) => c.productId),
    productId,
    `${webhookBase}?secret=${deps.dataForSeoWebhookSecret}&id=$id&tag=$tag`
  );
}

async function processProductInfoPingback(deps: CompetitorDrainDeps, taskId: string, productId: number): Promise<void> {
  const product = await deps.productRepository.getProductById(productId);
  if (!product) return;

  const data: DfsProductInfoGetResponse = await deps.dataForSeoService.fetchProductInfoTaskResult(taskId);

  const stub = {
    productId: "", seller: "", title: "", price: 0, currency: "NZD",
    oldPrice: null, thumbnail: null, rating: null, reviewCount: null, tag: null, googlePosition: null,
  };
  const results = deps.dataForSeoService.fetchProductInfoResults(data, stub);

  const ownStore = deps.ownStoreName ? normalizeSourceForCompare(deps.ownStoreName) : null;
  const productPrice = product.price != null ? Number(product.price) : null;

  const filteredResults = filterByCountryAndPriceRange(results, productPrice);
  const toSave = ownStore ? filteredResults.filter((r) => normalizeSourceForCompare(r.source) !== ownStore) : filteredResults;
  if (toSave.length === 0) return;

  const rows = toSave.map((r) => mapToCompetitorProductInput(r));

  await Promise.all(rows.map((row) => deps.competitorRepository.upsertSuggestedCompetitor(productId, row)));
  await deps.competitorRepository.recordPricesForConfirmed(productId, rows);
}
