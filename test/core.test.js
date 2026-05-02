import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzePrice, PriceInsightError } from "../src/core.js";

describe("analyzePrice", () => {
  it("returns market position and margin", () => {
    const result = analyzePrice({
      item: "Wireless mouse",
      price: 24.99,
      currency: "usd",
      reference_prices: [19.99, 22.49, 23.99, 27.99, 29.5],
      cost: 14.75
    });

    assert.equal(result.item, "Wireless mouse");
    assert.equal(result.currency, "USD");
    assert.equal(result.reference_count, 5);
    assert.equal(result.statistics.median, 23.99);
    assert.equal(result.position.label, "fair");
    assert.equal(result.position.percentile, 60);
    assert.equal(result.margin.gross_margin, 10.24);
    assert.equal(result.confidence, "medium");
  });

  it("recommends a raise when the price is low", () => {
    const result = analyzePrice({
      price: 80,
      reference_prices: [100, 110, 120, 130]
    });

    assert.equal(result.position.label, "low");
    assert.match(result.recommendation, /Consider raising/);
  });

  it("warns when price does not cover cost", () => {
    const result = analyzePrice({
      price: 10,
      reference_prices: [8, 10, 12],
      cost: 10
    });

    assert.match(result.recommendation, /^Price does not cover/);
  });

  it("raises helpful errors for invalid payloads", () => {
    const cases = [
      [{}, /price/],
      [{ price: 10, reference_prices: [] }, /non-empty/],
      [{ price: 10, reference_prices: [0] }, /positive number/],
      [{ price: true, reference_prices: [10] }, /positive number/]
    ];

    for (const [payload, errorPattern] of cases) {
      assert.throws(() => analyzePrice(payload), {
        name: PriceInsightError.name,
        message: errorPattern
      });
    }
  });
});
