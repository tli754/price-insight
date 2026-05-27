import { AppError } from "../lib/app-error.js";

export class JinaReaderService {
  constructor(private readonly apiKey: string) {}

  async read(productUrl: string): Promise<string> {
    const response = await fetch(`https://r.jina.ai/${productUrl}`, {
      headers: {
        Accept: "text/plain",
        Authorization: `Bearer ${this.apiKey}`
      }
    });

    if (!response.ok) {
      throw new AppError(
        502,
        "JINA_READER_FAILED",
        `Jina Reader request failed with ${response.status} ${response.statusText}`
      );
    }

    const content = await response.text();
    if (!content.trim()) {
      throw new AppError(502, "JINA_READER_EMPTY", "Jina Reader returned empty content.");
    }

    return content;
  }
}
