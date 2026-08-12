# Task: Replace SerpAPI competitor search with DataForSEO Google Shopping flow

## Goal
Migrate Price Insight competitor search from SerpAPI to DataForSEO.

## Rules
- Investigation first.
- Do not implement until Tony says: APPROVED TO IMPLEMENT.
- Do not edit `.env`, secrets, production config, or deployment files.
- Keep SerpAPI code temporarily unless removal is approved.
- Use small, reviewable changes.

## Required DataForSEO Flow

### 1. Create Google Shopping Products task

POST:
https://api.dataforseo.com/v3/merchant/google/products/task_post

Request:

```json
[
  {
    "language_code": "en",
    "location_code": 2554,
    "keyword": "<product keyword>",
    "price_min": 5
  }
]
```

Response: 

```bash
~/workers/data/products-task_post.json
```

### 2. Get Google Shopping Products results

GET:
https://api.dataforseo.com/v3/merchant/google/products/task_get/advanced/{task_id}

Use:
tasks[0].result[0].items[]

Only use:
item.type === "google_shopping_serp"

Filter out:
- currency !== NZD
- missing seller
- missing price
- missing product_id

Deduplicate by:
`${item.product_id}:${item.seller}:${item.title}`

Limit Product Info enrichment to first 20 cleaned candidates.

Response: 

```bash
~/workers/data/products-task_get.json
```


### 3. Create Product Info task

POST:
https://api.dataforseo.com/v3/merchant/google/product_info/task_post

Request:

```json
[
    {
        "language_code": "en",
        "location_code": 2554,
        "product_id": "<product id>"
    }
]
```

Response: 

```bash
~/workers/data/product-info_post.json
```

### 4. Get Product Info result

GET:
https://api.dataforseo.com/v3/merchant/google/product_info/task_get/advanced/{task_id}

Use:
tasks[0].result[0].items[0]

Filter sellers:
- seller.title exists
- seller.url exists
- seller.price.current exists
- seller.price.currency === NZD


Response: 

```bash
~/workers/data/product-info_get.json
```

## Final Save Logic

### competitors
Deduplicate sellers by normalized seller name.

### competitor_products
Save seller offer as competitor product.

### price_history
Save current price snapshot.

## Architecture Requirement

Create a decated service for DataForSEO connections 
create a test script for this service and can test the connections from shell 


## Investigation Output Required

1. Current SerpAPI files and flow
2. Affected backend routes/services/repositories/cache
3. Proposed DataForSEO service structure
4. Field mapping
5. Risks
6. Test plan
7. Exact files expected to change
