import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { SerpApiService } from "../services/serp-api-service.js";

const FAKE_KEY = "test-api-key";

function makeShoppingResponse(overrides: object = {}) {
  return {
    shopping_results: [
      {
        position: 1,
        title: "Widget Pro",
        product_id: "gid-001",
        product_link: "https://store.co.nz/widget",
        immersive_product_page_token: "token-abc",
        price: "$99.00",
        extracted_price: 99.0,
        source: "Store NZ",
        thumbnail: "https://img.example.com/widget.jpg",
        tag: "Best price",
        ...overrides
      }
    ]
  };
}

function makeImmersiveResponse(stores: object[] = []) {
  return { stores };
}

function makeStore(overrides: object = {}) {
  return {
    name: "Merchant NZ",
    logo: "https://merchant.co.nz/favicon.ico",
    link: "https://merchant.co.nz/widget",
    title: "Widget Pro 2024",
    price: "$95.00",
    extracted_price: 95.0,
    original_price: "$120.00",
    extracted_original_price: 120.0,
    shipping: "+ $5.00",
    shipping_extracted: 5.0,
    total: "$100.00",
    extracted_total: 100.0,
    rating: 4.5,
    reviews: 21,
    tag: "Best price",
    ...overrides
  };
}

function mockFetch(shoppingData: object, immersiveData?: object) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = input.toString();
    if (url.includes("google_immersive_product")) {
      return new Response(JSON.stringify(immersiveData ?? { stores: [] }), { status: 200 });
    }
    return new Response(JSON.stringify(shoppingData), { status: 200 });
  });
}

// ── SerpApiService ────────────────────────────────────────────────────────────

describe("SerpApiService", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("NZ locale defaults", () => {
    it("includes NZ locale params in the shopping request URL", async () => {
      const fetchSpy = mockFetch(makeShoppingResponse(), makeImmersiveResponse([makeStore()]));
      const service = new SerpApiService(FAKE_KEY);

      await service.searchShoppingPrices("Widget Pro");

      const shoppingCall = fetchSpy.mock.calls.find(([url]) =>
        url.toString().includes("google_shopping")
      );
      expect(shoppingCall).toBeDefined();
      const calledUrl = new URL(shoppingCall![0].toString());
      expect(calledUrl.searchParams.get("location")).toBe("New Zealand");
      expect(calledUrl.searchParams.get("gl")).toBe("nz");
      expect(calledUrl.searchParams.get("hl")).toBe("en");
      expect(calledUrl.searchParams.get("google_domain")).toBe("google.co.nz");
    });

    it("sends num param defaulting to 40", async () => {
      const fetchSpy = mockFetch(makeShoppingResponse(), makeImmersiveResponse([makeStore()]));
      const service = new SerpApiService(FAKE_KEY);

      await service.searchShoppingPrices("Widget");

      const shoppingCall = fetchSpy.mock.calls.find(([url]) =>
        url.toString().includes("google_shopping")
      );
      const calledUrl = new URL(shoppingCall![0].toString());
      expect(calledUrl.searchParams.get("num")).toBe("40");
    });

    it("sends num param from locale options", async () => {
      const fetchSpy = mockFetch(makeShoppingResponse(), makeImmersiveResponse([makeStore()]));
      const service = new SerpApiService(FAKE_KEY, {
        location: "New Zealand", gl: "nz", hl: "en", google_domain: "google.co.nz", num: 100
      });

      await service.searchShoppingPrices("Widget");

      const shoppingCall = fetchSpy.mock.calls.find(([url]) =>
        url.toString().includes("google_shopping")
      );
      const calledUrl = new URL(shoppingCall![0].toString());
      expect(calledUrl.searchParams.get("num")).toBe("100");
    });

    it("uses custom locale when provided", async () => {
      const fetchSpy = mockFetch(makeShoppingResponse(), makeImmersiveResponse([makeStore()]));
      const service = new SerpApiService(FAKE_KEY, {
        location: "Australia",
        gl: "au",
        hl: "en",
        google_domain: "google.com.au"
      });

      await service.searchShoppingPrices("Widget");

      const shoppingCall = fetchSpy.mock.calls.find(([url]) =>
        url.toString().includes("google_shopping")
      );
      const calledUrl = new URL(shoppingCall![0].toString());
      expect(calledUrl.searchParams.get("location")).toBe("Australia");
      expect(calledUrl.searchParams.get("gl")).toBe("au");
      expect(calledUrl.searchParams.get("google_domain")).toBe("google.com.au");
    });
  });

  describe("store expansion", () => {
    it("expands 1 shopping result with 3 stores into 3 CompetitorResults", async () => {
      mockFetch(
        makeShoppingResponse(),
        makeImmersiveResponse([makeStore(), makeStore({ link: "https://b.co.nz/w", name: "B" }), makeStore({ link: "https://c.co.nz/w", name: "C" })])
      );
      const service = new SerpApiService(FAKE_KEY);

      const results = await service.searchShoppingPrices("Widget");

      expect(results).toHaveLength(3);
    });

    it("maps store fields correctly onto each CompetitorResult", async () => {
      mockFetch(makeShoppingResponse(), makeImmersiveResponse([makeStore()]));
      const service = new SerpApiService(FAKE_KEY);

      const [result] = await service.searchShoppingPrices("Widget");

      expect(result.source).toBe("Merchant NZ");
      expect(result.sourceIcon).toBe("https://merchant.co.nz/favicon.ico");
      expect(result.link).toBe("https://merchant.co.nz/widget");
      expect(result.extractedPrice).toBe(95.0);
      expect(result.rating).toBe(4.5);
      expect(result.reviewCount).toBe(21);
      expect(result.shippingExtracted).toBe(5.0);
      expect(result.totalExtracted).toBe(100.0);
      expect(result.rawOldPrice).toBe("$120.00");
    });

    it("inherits thumbnail and externalId from the shopping result", async () => {
      mockFetch(makeShoppingResponse(), makeImmersiveResponse([makeStore()]));
      const service = new SerpApiService(FAKE_KEY);

      const [result] = await service.searchShoppingPrices("Widget");

      expect(result.thumbnail).toBe("https://img.example.com/widget.jpg");
      expect(result.externalId).toBe("gid-001");
    });

    it("maps position to googlePosition", async () => {
      mockFetch(makeShoppingResponse(), makeImmersiveResponse([makeStore()]));
      const service = new SerpApiService(FAKE_KEY);

      const [result] = await service.searchShoppingPrices("Widget");

      expect(result.googlePosition).toBe(1);
    });

    it("filters out stores with no extracted_price, keeps priced ones", async () => {
      mockFetch(
        makeShoppingResponse(),
        makeImmersiveResponse([makeStore(), makeStore({ extracted_price: undefined, price: undefined })])
      );
      const service = new SerpApiService(FAKE_KEY);

      const results = await service.searchShoppingPrices("Widget");

      expect(results).toHaveLength(1);
      expect(results[0].extractedPrice).toBe(95.0);
    });

    it("falls back to shopping result when all immersive stores have no price", async () => {
      mockFetch(
        makeShoppingResponse(),
        makeImmersiveResponse([
          makeStore({ extracted_price: undefined, price: undefined }),
          makeStore({ extracted_price: undefined, price: undefined })
        ])
      );
      const service = new SerpApiService(FAKE_KEY);

      const results = await service.searchShoppingPrices("Widget");

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe("Store NZ");
      expect(results[0].extractedPrice).toBe(99.0);
    });
  });

  describe("immersive fetch fallback", () => {
    it("falls back to shopping result when immersive returns non-OK", async () => {
      vi.spyOn(global, "fetch").mockImplementation(async (input) => {
        if (input.toString().includes("google_immersive_product")) {
          return new Response("error", { status: 500 });
        }
        return new Response(JSON.stringify(makeShoppingResponse()), { status: 200 });
      });
      const service = new SerpApiService(FAKE_KEY);

      const results = await service.searchShoppingPrices("Widget");

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe("Store NZ");
      expect(results[0].link).toBe("https://store.co.nz/widget");
    });

    it("falls back to shopping result when immersive returns empty stores", async () => {
      mockFetch(makeShoppingResponse(), makeImmersiveResponse([]));
      const service = new SerpApiService(FAKE_KEY);

      const results = await service.searchShoppingPrices("Widget");

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe("Store NZ");
    });

    it("returns a single result with no immersive call when result has no token", async () => {
      const fetchSpy = mockFetch(
        makeShoppingResponse({ immersive_product_page_token: undefined }),
        makeImmersiveResponse([makeStore()])
      );
      const service = new SerpApiService(FAKE_KEY);

      const results = await service.searchShoppingPrices("Widget");

      expect(results).toHaveLength(1);
      const immersiveCalls = fetchSpy.mock.calls.filter(([url]) =>
        url.toString().includes("google_immersive_product")
      );
      expect(immersiveCalls).toHaveLength(0);
    });
  });

  describe("deriveCountry via link", () => {
    it("sets country to NZ for .co.nz links", async () => {
      mockFetch(makeShoppingResponse(), makeImmersiveResponse([makeStore({ link: "https://example.co.nz/p" })]));
      const service = new SerpApiService(FAKE_KEY);
      const [result] = await service.searchShoppingPrices("Widget");
      expect(result.country).toBe("NZ");
    });

    it("sets country to AU for .com.au links", async () => {
      mockFetch(makeShoppingResponse(), makeImmersiveResponse([makeStore({ link: "https://example.com.au/p" })]));
      const service = new SerpApiService(FAKE_KEY);
      const [result] = await service.searchShoppingPrices("Widget");
      expect(result.country).toBe("AU");
    });

    it("sets country to null for other domains", async () => {
      mockFetch(makeShoppingResponse(), makeImmersiveResponse([makeStore({ link: "https://example.com/p" })]));
      const service = new SerpApiService(FAKE_KEY);
      const [result] = await service.searchShoppingPrices("Widget");
      expect(result.country).toBeNull();
    });

    it("sets country to null on invalid URL without throwing", async () => {
      mockFetch(makeShoppingResponse(), makeImmersiveResponse([makeStore({ link: "not-a-url" })]));
      const service = new SerpApiService(FAKE_KEY);
      const [result] = await service.searchShoppingPrices("Widget");
      expect(result.country).toBeNull();
    });

    it("derives country from product_link on shopping fallback", async () => {
      mockFetch(
        makeShoppingResponse({ immersive_product_page_token: undefined, product_link: "https://shop.co.nz/item" }),
        makeImmersiveResponse([])
      );
      const service = new SerpApiService(FAKE_KEY);
      const [result] = await service.searchShoppingPrices("Widget");
      expect(result.country).toBe("NZ");
    });
  });

  describe("pagination", () => {
    it("fetches a second page when the first page equals num results", async () => {
      let callCount = 0;
      vi.spyOn(global, "fetch").mockImplementation(async (input) => {
        const url = input.toString();
        if (url.includes("google_immersive_product")) {
          return new Response(JSON.stringify({ stores: [] }), { status: 200 });
        }
        callCount++;
        // Page 1: full page of 2; page 2: empty → stop
        const body = callCount === 1
          ? { shopping_results: [
              { position: 1, title: "A", product_id: "a", extracted_price: 10, source: "S" },
              { position: 2, title: "B", product_id: "b", extracted_price: 20, source: "S" }
            ] }
          : { shopping_results: [] };
        return new Response(JSON.stringify(body), { status: 200 });
      });

      const service = new SerpApiService(FAKE_KEY, {
        location: "New Zealand", gl: "nz", hl: "en", google_domain: "google.co.nz", num: 2
      });

      const results = await service.searchShoppingPrices("Widget");

      expect(callCount).toBe(2);
      expect(results).toHaveLength(2);
    });

    it("stops after one page when the page has fewer results than num", async () => {
      let shoppingCallCount = 0;
      vi.spyOn(global, "fetch").mockImplementation(async (input) => {
        const url = input.toString();
        if (url.includes("google_immersive_product")) {
          return new Response(JSON.stringify({ stores: [] }), { status: 200 });
        }
        shoppingCallCount++;
        // Returns only 1 result when num=2 → no more pages
        return new Response(
          JSON.stringify({ shopping_results: [
            { position: 1, title: "A", product_id: "a", extracted_price: 10, source: "S" }
          ] }),
          { status: 200 }
        );
      });

      const service = new SerpApiService(FAKE_KEY, {
        location: "New Zealand", gl: "nz", hl: "en", google_domain: "google.co.nz", num: 2
      });

      await service.searchShoppingPrices("Widget");

      expect(shoppingCallCount).toBe(1);
    });

    it("sets the start param on subsequent pages", async () => {
      const calledUrls: string[] = [];
      vi.spyOn(global, "fetch").mockImplementation(async (input) => {
        const url = input.toString();
        if (url.includes("google_immersive_product")) {
          return new Response(JSON.stringify({ stores: [] }), { status: 200 });
        }
        calledUrls.push(url);
        const isFirst = !url.includes("start=");
        const body = isFirst
          ? { shopping_results: [
              { position: 1, title: "A", product_id: "a", extracted_price: 10, source: "S" },
              { position: 2, title: "B", product_id: "b", extracted_price: 20, source: "S" }
            ] }
          : { shopping_results: [] };
        return new Response(JSON.stringify(body), { status: 200 });
      });

      const service = new SerpApiService(FAKE_KEY, {
        location: "New Zealand", gl: "nz", hl: "en", google_domain: "google.co.nz", num: 2
      });

      await service.searchShoppingPrices("Widget");

      const secondPage = calledUrls.find(u => u.includes("start="));
      expect(secondPage).toBeDefined();
      expect(new URL(secondPage!).searchParams.get("start")).toBe("2");
    });
  });

  describe("fallback price guard", () => {
    it("skips shopping result with no extracted_price in fallback path", async () => {
      mockFetch(
        makeShoppingResponse({ immersive_product_page_token: undefined, extracted_price: undefined }),
        makeImmersiveResponse([])
      );
      const service = new SerpApiService(FAKE_KEY);

      const results = await service.searchShoppingPrices("Widget");

      expect(results).toHaveLength(0);
    });

    it("skips shopping result with extracted_price of zero in fallback path", async () => {
      mockFetch(
        makeShoppingResponse({ immersive_product_page_token: undefined, extracted_price: 0 }),
        makeImmersiveResponse([])
      );
      const service = new SerpApiService(FAKE_KEY);

      const results = await service.searchShoppingPrices("Widget");

      expect(results).toHaveLength(0);
    });

    it("includes shopping result with valid extracted_price in fallback path", async () => {
      mockFetch(
        makeShoppingResponse({ immersive_product_page_token: undefined, extracted_price: 49.99 }),
        makeImmersiveResponse([])
      );
      const service = new SerpApiService(FAKE_KEY);

      const results = await service.searchShoppingPrices("Widget");

      expect(results).toHaveLength(1);
      expect(results[0].extractedPrice).toBe(49.99);
    });
  });

  describe("error handling", () => {
    it("throws SERPAPI_FAILED on non-OK shopping response", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(new Response("bad gateway", { status: 502 }));
      const service = new SerpApiService(FAKE_KEY);

      await expect(service.searchShoppingPrices("Widget")).rejects.toMatchObject({
        code: "SERPAPI_FAILED"
      });
    });
  });
});
