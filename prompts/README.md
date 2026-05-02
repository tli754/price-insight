# Prompts

Prompt set for the Price Insight extractor service.

## Files

- [`extractor.md`](./extractor.md): main extraction contract and field rules.
- [`extractor-system.md`](./extractor-system.md): system prompt for the LLM.
- [`extractor-user.md`](./extractor-user.md): runtime user prompt template with placeholders.
- [`extractor-validation.md`](./extractor-validation.md): secondary validation prompt for checking extraction output.
- [`extractor-repair.md`](./extractor-repair.md): fallback prompt for repairing malformed LLM output into the required schema.

## Recommended Backend Flow

1. Validate the product URL in Fastify.
2. Check Redis for a cached extractor result.
3. Call Jina Reader when the cache misses.
4. Send `extractor-system.md` plus `extractor-user.md` to the LLM.
5. Parse the JSON output.
6. Optionally validate it with `extractor-validation.md`.
7. If parsing fails, retry once with `extractor-repair.md`.
8. Persist the final normalized product into MySQL.
9. Set `status = pending` and `external_id = null` in backend code.
10. Cache the normalized result in Redis for 24 hours.
