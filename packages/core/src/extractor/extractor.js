import { PriceInsightError } from "../core.js";
import { normalizeProductUrl, readWithJinaReader } from "./jinaReader.js";

const CURRENCY_SYMBOLS = new Map([
  ["US$", "USD"],
  ["NZ$", "NZD"],
  ["A$", "AUD"],
  ["AU$", "AUD"],
  ["C$", "CAD"],
  ["CA$", "CAD"],
  ["£", "GBP"],
  ["€", "EUR"],
  ["¥", "JPY"]
]);

const CURRENCY_CODES = new Set([
  "USD",
  "NZD",
  "AUD",
  "CAD",
  "GBP",
  "EUR",
  "JPY",
  "CNY",
  "HKD",
  "SGD"
]);

export async function extractProductFromUrl(productUrl, options = {}) {
  const sourceUrl = normalizeProductUrl(productUrl);
  const readerContent = await readWithJinaReader(sourceUrl, options);
  return extractProductFromReaderContent({ sourceUrl, readerContent });
}

export function extractProductFromReaderContent({ sourceUrl, readerContent }) {
  const normalizedSourceUrl = normalizeProductUrl(sourceUrl);
  if (typeof readerContent !== "string" || readerContent.trim() === "") {
    throw new PriceInsightError("reader_content must be a non-empty string.");
  }

  const lines = readerContent
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const title = extractTitle(lines);
  const price = extractCurrentPrice(lines);
  const keySpecs = extractKeySpecs(lines);

  const result = {
    source_url: normalizedSourceUrl,
    product_name: cleanValue(title),
    brand: cleanValue(extractLabeledValue(lines, ["Brand", "Manufacturer"])),
    model_or_variant: cleanValue(
      extractLabeledValue(lines, ["Model", "Model number", "Variant", "SKU", "Item model number"])
    ),
    current_price: price?.amount ?? null,
    currency: price?.currency ?? null,
    availability: cleanValue(extractAvailability(lines)),
    seller_or_store: cleanValue(extractSeller(lines, normalizedSourceUrl)),
    product_category: cleanValue(extractLabeledValue(lines, ["Category", "Department"])),
    key_specs: keySpecs,
    evidence: {
      title_source: title,
      price_source: price?.raw ?? null,
      spec_count: keySpecs.length
    },
    confidence: confidence(title, price, keySpecs)
  };

  return result;
}

function extractTitle(lines) {
  const titleLine = lines.find((line) => /^title\s*:/i.test(line));
  if (titleLine) {
    return stripMarkdown(titleLine.replace(/^title\s*:\s*/i, ""));
  }

  const heading = lines.find((line) => /^#\s+/.test(line));
  if (heading) {
    return stripMarkdown(heading.replace(/^#+\s*/, ""));
  }

  return null;
}

function extractCurrentPrice(lines) {
  const candidates = [];

  lines.forEach((line, index) => {
    if (isIgnoredPriceLine(line)) {
      return;
    }

    const match = findPriceInLine(line);
    if (!match) {
      return;
    }

    candidates.push({
      ...match,
      score: priceLineScore(line, index)
    });
  });

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.score - a.score || a.amount - b.amount);
  return candidates[0];
}

function findPriceInLine(line) {
  const symbolPattern = /(NZ\$|AU\$|US\$|CA\$|A\$|C\$|\$|£|€|¥)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
  const codeBeforePattern = /\b(USD|NZD|AUD|CAD|GBP|EUR|JPY|CNY|HKD|SGD)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
  const codeAfterPattern = /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(USD|NZD|AUD|CAD|GBP|EUR|JPY|CNY|HKD|SGD)\b/i;

  const symbolMatch = line.match(symbolPattern);
  if (symbolMatch) {
    const symbol = normalizeCurrencySymbol(symbolMatch[1]);
    return {
      amount: parseAmount(symbolMatch[2]),
      currency: CURRENCY_SYMBOLS.get(symbol) ?? null,
      raw: symbolMatch[0].trim()
    };
  }

  const codeBeforeMatch = line.match(codeBeforePattern);
  if (codeBeforeMatch) {
    return {
      amount: parseAmount(codeBeforeMatch[2]),
      currency: normalizeCurrencyCode(codeBeforeMatch[1]),
      raw: codeBeforeMatch[0].trim()
    };
  }

  const codeAfterMatch = line.match(codeAfterPattern);
  if (codeAfterMatch) {
    return {
      amount: parseAmount(codeAfterMatch[1]),
      currency: normalizeCurrencyCode(codeAfterMatch[2]),
      raw: codeAfterMatch[0].trim()
    };
  }

  return null;
}

function priceLineScore(line, index) {
  const lower = line.toLowerCase();
  let score = 1000 - index;

  if (/\b(now|sale|price|current|our price)\b/.test(lower)) {
    score += 50;
  }

  if (/\b(was|rrp|list price|original|save|discount|shipping|delivery|per month|installment|instalment)\b/.test(lower)) {
    score -= 100;
  }

  return score;
}

function isIgnoredPriceLine(line) {
  return /\b(shipping|delivery|coupon|points|finance|installment|instalment|per month)\b/i.test(line);
}

function extractAvailability(lines) {
  const availabilityLine = extractLabeledValue(lines, ["Availability", "Stock"]);
  if (availabilityLine) {
    return availabilityLine;
  }

  const match = lines.find((line) =>
    /\b(in stock|out of stock|sold out|available|unavailable|pre-?order|backorder)\b/i.test(line)
  );

  return match ? stripMarkdown(match) : null;
}

function extractSeller(lines, sourceUrl) {
  const seller = extractLabeledValue(lines, ["Seller", "Store", "Sold by"]);
  if (seller) {
    return seller;
  }

  return new URL(sourceUrl).hostname.replace(/^www\./, "");
}

function extractKeySpecs(lines) {
  const specs = [];
  const labels = [
    "Color",
    "Colour",
    "Size",
    "Storage",
    "Capacity",
    "Connectivity",
    "Material",
    "Dimensions",
    "Weight",
    "Pack",
    "Quantity",
    "Screen size",
    "Processor",
    "Memory"
  ];

  for (const label of labels) {
    const value = extractLabeledValue(lines, [label]);
    if (value) {
      specs.push(`${label}: ${value}`);
    }
  }

  for (const line of lines) {
    if (specs.length >= 12) {
      break;
    }

    if (/^[-*]\s+/.test(line) && looksLikeSpec(line)) {
      specs.push(stripMarkdown(line.replace(/^[-*]\s+/, "")));
    }
  }

  return [...new Set(specs.map((spec) => spec.trim()).filter(Boolean))].slice(0, 12);
}

function extractLabeledValue(lines, labels) {
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const patterns = [
      new RegExp(`^${escaped}\\s*:\\s*(.+)$`, "i"),
      new RegExp(`^[-*]\\s+${escaped}\\s*:\\s*(.+)$`, "i"),
      new RegExp(`^\\|?\\s*${escaped}\\s*\\|\\s*(.+?)\\s*\\|?$`, "i"),
      new RegExp(`^\\*\\*${escaped}\\*\\*\\s*:?\\s*(.+)$`, "i")
    ];

    for (const line of lines) {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          return stripMarkdown(match[1]);
        }
      }
    }
  }

  return null;
}

function looksLikeSpec(line) {
  return /\b(color|colour|size|storage|capacity|connectivity|material|dimension|weight|model|sku|pack|memory|processor)\b/i.test(
    line
  );
}

function confidence(productName, price, keySpecs) {
  if (productName && price && keySpecs.length >= 2) {
    return "high";
  }

  if (productName && price) {
    return "medium";
  }

  return "low";
}

function parseAmount(value) {
  return Number.parseFloat(value.replace(/,/g, ""));
}

function normalizeCurrencySymbol(symbol) {
  return symbol.toUpperCase();
}

function normalizeCurrencyCode(code) {
  const normalized = code.toUpperCase();
  return CURRENCY_CODES.has(normalized) ? normalized : null;
}

function cleanValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = stripMarkdown(value).trim();
  return cleaned === "" ? null : cleaned;
}

function stripMarkdown(value) {
  return String(value)
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
