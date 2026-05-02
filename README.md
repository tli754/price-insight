# price-insight

`price-insight` is a small JSON-in/JSON-out tool call for comparing one price
against reference prices such as competitor listings, historical sales, or a
manually curated benchmark set.

## Input

```json
{
  "item": "Wireless mouse",
  "price": 24.99,
  "currency": "USD",
  "reference_prices": [19.99, 22.49, 23.99, 27.99, 29.5],
  "cost": 14.75
}
```

Required fields:

- `price`: the price to evaluate.
- `reference_prices`: one or more positive comparison prices.

Optional fields:

- `item`: item name or SKU.
- `currency`: ISO currency code or display label. Defaults to `USD`.
- `cost`: unit cost, used to report margin.

## Run

From a file:

```powershell
node src\cli.js examples\sample.json
```

From stdin:

```powershell
Get-Content examples\sample.json | node src\cli.js
```

The package script runs the sample payload:

```powershell
npm start
```

After installing or linking the package, the same tool is available as:

```powershell
price-insight examples\sample.json
```

## Extractor Service

The extractor service is the first architecture slice:

```text
Product URL -> Jina Reader -> extractor -> structured product JSON
```

Run it against a live product URL:

```powershell
node src\extractor\cli.js https://example.com/product-page
```

Run it against saved Jina Reader output:

```powershell
npm run extract:sample
```

Set `JINA_API_KEY` when you want higher Reader API limits:

```powershell
$env:JINA_API_KEY = "..."
```

The extractor prompt contract lives in [`prompts/extractor.md`](prompts/extractor.md).

## Test

```powershell
npm test
```

## Output

The tool returns JSON with summary statistics, the evaluated price's percentile
position among references, margin details when `cost` is provided, and a short
recommendation:

```json
{
  "item": "Wireless mouse",
  "currency": "USD",
  "price": 24.99,
  "reference_count": 5,
  "statistics": {
    "minimum": 19.99,
    "maximum": 29.5,
    "average": 24.792,
    "median": 23.99
  },
  "position": {
    "label": "fair",
    "percentile": 60.0,
    "difference_to_average": 0.198,
    "difference_to_average_percent": 0.8
  },
  "margin": {
    "cost": 14.75,
    "gross_margin": 10.24,
    "gross_margin_percent": 40.98
  },
  "recommendation": "Price is near the market average. Keep it unless conversion data suggests otherwise.",
  "confidence": "medium"
}
```

## Tool Schema

[`tool_call.json`](tool_call.json) contains a function-style schema for hosts
that register tools before calling them.
