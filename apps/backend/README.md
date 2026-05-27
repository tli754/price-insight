# Price Insight Backend

Fastify backend for the extractor flow with:

- Fastify
- Drizzle ORM
- MySQL
- Redis
- Jina Reader
- OpenAI Responses API

## Setup

1. Copy `.env.example` to `.env`
2. Install dependencies
3. Run the dev server

```powershell
npm install
npm run dev
```

## Routes

- `GET /api/health`
- `GET /api/products`
- `GET /api/products/:id`
- `POST /api/products/extract`
- `PATCH /api/products/:id/status`

## Example Request

```json
{
  "productUrl": "https://example.com/products/sample"
}
```
