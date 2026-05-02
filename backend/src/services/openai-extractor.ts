import OpenAI from "openai";

import type { AppEnv } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { loadPrompt } from "../lib/prompt-loader.js";
import {
  openAIExtractionJsonSchema,
  productExtractionSchema,
  validateExtractionRules,
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
      return validateExtractionRules(productExtractionSchema.parse(parsed));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid extraction payload.";
      throw new AppError(502, "OPENAI_INVALID_SCHEMA", message);
    }
  }
}
