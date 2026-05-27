export type PriceAnalysisResult = {
  item: string | null;
  currency: string;
  price: number;
  reference_count: number;
  statistics: {
    minimum: number;
    maximum: number;
    average: number;
    median: number;
  };
  position: {
    label: "low" | "fair" | "high";
    percentile: number;
    difference_to_average: number;
    difference_to_average_percent: number;
  };
  margin: {
    cost: number;
    gross_margin: number;
    gross_margin_percent: number;
  } | null;
  recommendation: string;
  confidence: "low" | "medium" | "high";
};

export function analyzePrice(payload: {
  price: number;
  reference_prices: number[];
  item?: string | null;
  currency?: string;
  cost?: number | null;
}): PriceAnalysisResult {
  const references = [...payload.reference_prices].sort((a, b) => a - b);
  const avg = mean(references);
  const mid = median(references);
  const percentile = percentileRank(payload.price, references);
  const difference = payload.price - avg;
  const differencePercent = (difference / avg) * 100;
  const label = positionLabel(differencePercent);
  const currency = payload.currency ?? "USD";
  const cost = payload.cost ?? null;

  return {
    item: payload.item ?? null,
    currency,
    price: roundMoney(payload.price),
    reference_count: references.length,
    statistics: {
      minimum: roundMoney(Math.min(...references)),
      maximum: roundMoney(Math.max(...references)),
      average: roundMoney(avg),
      median: roundMoney(mid)
    },
    position: {
      label,
      percentile: roundTo(percentile, 2),
      difference_to_average: roundMoney(difference),
      difference_to_average_percent: roundTo(differencePercent, 2)
    },
    margin: cost !== null ? {
      cost: roundMoney(cost),
      gross_margin: roundMoney(payload.price - cost),
      gross_margin_percent: roundTo(((payload.price - cost) / payload.price) * 100, 2)
    } : null,
    recommendation: recommendation(label, cost, payload.price),
    confidence: confidence(references.length)
  };
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number {
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

function percentileRank(price: number, refs: number[]): number {
  const below = refs.filter(v => v < price).length;
  const equal = refs.filter(v => v === price).length;
  return ((below + 0.5 * equal) / refs.length) * 100;
}

function positionLabel(pct: number): "low" | "fair" | "high" {
  if (pct <= -10) return "low";
  if (pct >= 10) return "high";
  return "fair";
}

function recommendation(label: "low" | "fair" | "high", cost: number | null, price: number): string {
  if (cost !== null && cost >= price) return "Price does not cover unit cost. Reprice or reduce cost before selling.";
  if (label === "low") return "Price is meaningfully below the market average. Consider raising it if demand is healthy.";
  if (label === "high") return "Price is meaningfully above the market average. Confirm the offer has enough differentiation.";
  return "Price is near the market average. Keep it unless conversion data suggests otherwise.";
}

function confidence(count: number): "low" | "medium" | "high" {
  if (count >= 10) return "high";
  if (count >= 4) return "medium";
  return "low";
}

function roundMoney(v: number): number {
  return roundTo(v, 3);
}

function roundTo(v: number, places: number): number {
  const m = 10 ** places;
  return Math.round((v + Number.EPSILON) * m) / m;
}
