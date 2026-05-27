import { setTimeout as delay } from "node:timers/promises";

import { PriceInsightError } from "../core.js";

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRIES = 1;

export function buildJinaReaderUrl(productUrl) {
  const normalizedUrl = normalizeProductUrl(productUrl);
  return `https://r.jina.ai/${normalizedUrl}`;
}

export async function readWithJinaReader(productUrl, options = {}) {
  const {
    apiKey = process.env.JINA_API_KEY,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES
  } = options;

  if (typeof fetchImpl !== "function") {
    throw new PriceInsightError("A fetch implementation is required to call Jina Reader.");
  }

  const readerUrl = buildJinaReaderUrl(productUrl);
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(readerUrl, {
        method: "GET",
        headers: readerHeaders(apiKey),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new PriceInsightError(
          `Jina Reader failed with ${response.status} ${response.statusText}`.trim()
        );
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        break;
      }

      await delay(250 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError?.name === "AbortError") {
    throw new PriceInsightError("Jina Reader request timed out.");
  }

  if (lastError instanceof PriceInsightError) {
    throw lastError;
  }

  throw new PriceInsightError(`Jina Reader request failed: ${lastError.message}`);
}

export function normalizeProductUrl(productUrl) {
  if (typeof productUrl !== "string" || productUrl.trim() === "") {
    throw new PriceInsightError("product_url must be a non-empty URL string.");
  }

  let parsed;
  try {
    parsed = new URL(productUrl.trim());
  } catch {
    throw new PriceInsightError("product_url must be a valid URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new PriceInsightError("product_url must use http or https.");
  }

  return parsed.href;
}

function readerHeaders(apiKey) {
  const headers = {
    Accept: "text/plain",
    "User-Agent": "price-insight-extractor/0.1"
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}
