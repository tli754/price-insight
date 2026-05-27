export class PriceInsightError extends Error {
  constructor(message) {
    super(message);
    this.name = "PriceInsightError";
  }
}

export function analyzePrice(payload) {
  const data = normalizePayload(payload);
  const references = [...data.referencePrices].sort((a, b) => a - b);
  const average = mean(references);
  const midpoint = median(references);
  const percentile = percentileRank(data.price, references);
  const difference = data.price - average;
  const differencePercent = (difference / average) * 100;
  const label = positionLabel(differencePercent);

  return {
    item: data.item,
    currency: data.currency,
    price: roundMoney(data.price),
    reference_count: references.length,
    statistics: {
      minimum: roundMoney(Math.min(...references)),
      maximum: roundMoney(Math.max(...references)),
      average: roundMoney(average),
      median: roundMoney(midpoint)
    },
    position: {
      label,
      percentile: roundTo(percentile, 2),
      difference_to_average: roundMoney(difference),
      difference_to_average_percent: roundTo(differencePercent, 2)
    },
    margin: margin(data.price, data.cost),
    recommendation: recommendation(label, data.cost, data.price),
    confidence: confidence(references.length)
  };
}

function normalizePayload(payload) {
  if (!isPlainObject(payload)) {
    throw new PriceInsightError("Payload must be a JSON object.");
  }

  const price = positiveNumber(payload.price, "price");
  if (!Array.isArray(payload.reference_prices) || payload.reference_prices.length === 0) {
    throw new PriceInsightError("reference_prices must be a non-empty array.");
  }

  const referencePrices = payload.reference_prices.map((value, index) =>
    positiveNumber(value, `reference_prices[${index}]`)
  );

  if (payload.item !== undefined && typeof payload.item !== "string") {
    throw new PriceInsightError("item must be a string when provided.");
  }

  const currency = payload.currency ?? "USD";
  if (typeof currency !== "string" || currency.trim() === "") {
    throw new PriceInsightError("currency must be a non-empty string.");
  }

  const cost = payload.cost === undefined ? null : positiveNumber(payload.cost, "cost");

  return {
    item: payload.item ?? null,
    price,
    currency: currency.trim().toUpperCase(),
    referencePrices,
    cost
  };
}

function positiveNumber(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new PriceInsightError(`${fieldName} must be a positive number.`);
  }

  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values) {
  const midpoint = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return values[midpoint];
  }

  return (values[midpoint - 1] + values[midpoint]) / 2;
}

function percentileRank(price, references) {
  const below = references.filter((value) => value < price).length;
  const equal = references.filter((value) => value === price).length;
  return ((below + 0.5 * equal) / references.length) * 100;
}

function positionLabel(differencePercent) {
  if (differencePercent <= -10) {
    return "low";
  }

  if (differencePercent >= 10) {
    return "high";
  }

  return "fair";
}

function recommendation(label, cost, price) {
  if (cost !== null && cost >= price) {
    return "Price does not cover unit cost. Reprice or reduce cost before selling.";
  }

  if (label === "low") {
    return "Price is meaningfully below the market average. Consider raising it if demand is healthy.";
  }

  if (label === "high") {
    return "Price is meaningfully above the market average. Confirm the offer has enough differentiation.";
  }

  return "Price is near the market average. Keep it unless conversion data suggests otherwise.";
}

function confidence(referenceCount) {
  if (referenceCount >= 10) {
    return "high";
  }

  if (referenceCount >= 4) {
    return "medium";
  }

  return "low";
}

function margin(price, cost) {
  if (cost === null) {
    return null;
  }

  const grossMargin = price - cost;
  const grossMarginPercent = (grossMargin / price) * 100;

  return {
    cost: roundMoney(cost),
    gross_margin: roundMoney(grossMargin),
    gross_margin_percent: roundTo(grossMarginPercent, 2)
  };
}

function roundMoney(value) {
  return roundTo(value, 3);
}

function roundTo(value, places) {
  const multiplier = 10 ** places;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}
