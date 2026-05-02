import OpenAI from "openai";

import type { AppEnv } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { loadPrompt } from "../lib/prompt-loader.js";
import {
  openAIExtractionJsonSchema,
  openAIValidationJsonSchema,
  productExtractionSchema,
  validateExtractionRules,
  validationResponseSchema,
  type ProductExtraction
} from "../schemas/product.js";

type ExtractInput = {
  sourceUrl: string;
  readerContent: string;
};

export class OpenAIExtractorService {
  private readonly client: OpenAI;

  constructor(private readonly env: AppEnv) {
    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY
    });
  }

  async extract(input: ExtractInput): Promise<ProductExtraction> {
    const [systemPrompt, userPromptTemplate] = await Promise.all([
      loadPrompt("extractor-system.md"),
      loadPrompt("extractor-user.md")
    ]);

    const userPrompt = userPromptTemplate
      .replace("{{SOURCE_URL}}", input.sourceUrl)
      .replace("{{READER_CONTENT}}", input.readerContent);

    const response = await this.client.responses.create({
      model: this.env.OPENAI_MODEL,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      text: {
        format: {
          type: "json_schema",
          ...openAIExtractionJsonSchema
        }
      }
    });

    const outputText = response.output_text;
    if (!outputText) {
      throw new AppError(502, "OPENAI_EMPTY", "OpenAI returned no extraction output.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw new AppError(502, "OPENAI_INVALID_JSON", "OpenAI returned invalid JSON.");
    }

    try {
      const extracted = validateExtractionRules(productExtractionSchema.parse(parsed));
      return this.validate(input, extracted);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid extraction payload.";
      throw new AppError(502, "OPENAI_INVALID_SCHEMA", message);
    }
  }

  private async validate(input: ExtractInput, extraction: ProductExtraction): Promise<ProductExtraction> {
    const validationSystemPrompt = await loadPrompt("extractor-validation.md");

    const userPrompt = [
      "Validate this product extraction.",
      "",
      `Source URL:\n${input.sourceUrl}`,
      "",
      `Jina Reader Content:\n${input.readerContent}`,
      "",
      `Extracted JSON:\n${JSON.stringify(extraction, null, 2)}`,
      "",
      "Return strict JSON only using the validation schema."
    ].join("\n");

    let outputText: string | null | undefined;
    try {
      const response = await this.client.responses.create({
        model: this.env.OPENAI_MODEL,
        input: [
          { role: "system", content: validationSystemPrompt },
          { role: "user", content: userPrompt }
        ],
        text: {
          format: {
            type: "json_schema",
            ...openAIValidationJsonSchema
          }
        }
      });
      outputText = response.output_text;
    } catch {
      return extraction;
    }

    if (!outputText) return extraction;

    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      return extraction;
    }

    try {
      const result = validationResponseSchema.parse(parsed);
      return validateExtractionRules(result.normalized);
    } catch {
      return extraction;
    }
  }
}
