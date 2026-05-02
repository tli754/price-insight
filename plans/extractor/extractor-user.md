# Extractor User Prompt Template

Use this as the runtime user prompt sent to the LLM with the system prompt.

```text
Extract product data from the following product page content.

Source URL:
{{SOURCE_URL}}

Jina Reader Content:
{{READER_CONTENT}}

Return strict JSON only using the agreed schema.
```
