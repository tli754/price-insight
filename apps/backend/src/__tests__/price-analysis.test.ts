import { describe, it, expect } from "vitest";
import { analyzePrice } from "../lib/price-analysis.js";

describe("analyzePrice", () => {
  it("returns correct statistics for a typical payload", () => {
    const result = analyzePrice({
      price: 24.99,
      reference_prices: [19.99, 22.49, 23.99, 27.99, 29.5],
      item: "Wireless mouse",
      currency: "NZD"
    });

    expect(result.item).toBe("Wireless mouse");
    expect(result.currency).toBe("NZD");
    expect(result.price).toBe(24.99);
    expect(result.reference_count).toBe(5);
    expect(result.statistics.minimum).toBe(19.99);
    expect(result.statistics.maximum).toBe(29.5);
    expect(result.statistics.median).toBe(23.99);
  });

  it("labels price as 'low' when more than 10% below average", () => {
    // refs avg = 115, price = 80 → -30.4% below
    const result = analyzePrice({ price: 80, reference_prices: [100, 110, 120, 130] });
    expect(result.position.label).toBe("low");
    expect(result.recommendation).toMatch(/Consider raising/);
  });

  it("labels price as 'high' when more than 10% above average", () => {
    // refs avg = 115, price = 145 → +26% above
    const result = analyzePrice({ price: 145, reference_prices: [100, 110, 120, 130] });
    expect(result.position.label).toBe("high");
    expect(result.recommendation).toMatch(/above the market average/);
  });

  it("labels price as 'fair' within ±10% of average", () => {
    // refs avg = 100, price = 100
    const result = analyzePrice({ price: 100, reference_prices: [90, 95, 100, 105, 110] });
    expect(result.position.label).toBe("fair");
    expect(result.recommendation).toMatch(/near the market average/);
  });

  it("calculates gross margin when cost is provided", () => {
    const result = analyzePrice({
      price: 100,
      reference_prices: [90, 100, 110],
      cost: 60
    });
    expect(result.margin).not.toBeNull();
    expect(result.margin!.cost).toBe(60);
    expect(result.margin!.gross_margin).toBe(40);
    expect(result.margin!.gross_margin_percent).toBe(40);
  });

  it("warns when price does not cover cost", () => {
    const result = analyzePrice({
      price: 10,
      reference_prices: [8, 10, 12],
      cost: 10
    });
    expect(result.recommendation).toMatch(/^Price does not cover/);
  });

  it("returns null margin when cost is not provided", () => {
    const result = analyzePrice({ price: 50, reference_prices: [40, 50, 60] });
    expect(result.margin).toBeNull();
  });

  it("returns confidence 'low' for < 4 refs, 'medium' for 4-9, 'high' for ≥ 10", () => {
    const low = analyzePrice({ price: 50, reference_prices: [40, 50, 60] });
    expect(low.confidence).toBe("low");

    const medium = analyzePrice({ price: 50, reference_prices: [40, 45, 50, 55, 60] });
    expect(medium.confidence).toBe("medium");

    const high = analyzePrice({
      price: 50,
      reference_prices: [40, 42, 44, 46, 48, 50, 52, 54, 56, 58]
    });
    expect(high.confidence).toBe("high");
  });

  it("defaults currency to 'USD' when not provided", () => {
    const result = analyzePrice({ price: 50, reference_prices: [40, 50, 60] });
    expect(result.currency).toBe("USD");
  });
});
