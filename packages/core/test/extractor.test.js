import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractProductFromReaderContent, extractProductFromUrl } from "../src/extractor/extractor.js";
import { buildJinaReaderUrl } from "../src/extractor/jinaReader.js";

const readerContent = `Title: Acme Dash Mouse - Wireless Ergonomic Mouse

URL Source: https://shop.example.com/products/acme-dash-mouse

Markdown Content:
# Acme Dash Mouse - Wireless Ergonomic Mouse

Brand: Acme
Model: Dash Mouse
Category: Computer Accessories
Availability: In stock
Price: US$24.99

- Color: Black
- Connectivity: Bluetooth and USB receiver
- Weight: 92 g`;

describe("extractProductFromReaderContent", () => {
  it("extracts product facts from saved reader output", () => {
    const result = extractProductFromReaderContent({
      sourceUrl: "https://shop.example.com/products/acme-dash-mouse",
      readerContent
    });

    assert.equal(result.product_name, "Acme Dash Mouse - Wireless Ergonomic Mouse");
    assert.equal(result.brand, "Acme");
    assert.equal(result.model_or_variant, "Dash Mouse");
    assert.equal(result.current_price, 24.99);
    assert.equal(result.currency, "USD");
    assert.equal(result.availability, "In stock");
    assert.equal(result.product_category, "Computer Accessories");
    assert.equal(result.confidence, "high");
    assert.ok(result.key_specs.includes("Color: Black"));
    assert.ok(result.key_specs.includes("Connectivity: Bluetooth and USB receiver"));
  });

  it("returns low confidence when key product facts are missing", () => {
    const result = extractProductFromReaderContent({
      sourceUrl: "https://shop.example.com/empty",
      readerContent: "Markdown Content:\nNo visible product data."
    });

    assert.equal(result.product_name, null);
    assert.equal(result.current_price, null);
    assert.equal(result.confidence, "low");
  });
});

describe("extractProductFromUrl", () => {
  it("calls Jina Reader through an injectable fetch implementation", async () => {
    let requestedUrl = null;
    const fetchImpl = async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => readerContent
      };
    };

    const result = await extractProductFromUrl("https://shop.example.com/products/acme-dash-mouse", {
      fetchImpl,
      retries: 0
    });

    assert.equal(
      requestedUrl,
      buildJinaReaderUrl("https://shop.example.com/products/acme-dash-mouse")
    );
    assert.equal(result.current_price, 24.99);
  });
});
