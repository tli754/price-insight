import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const promptsRoot = path.resolve(__dirname, "../../../prompts");
const promptCache = new Map<string, string>();

export async function loadPrompt(filename: string): Promise<string> {
  if (promptCache.has(filename)) {
    return promptCache.get(filename)!;
  }

  const fullPath = path.join(promptsRoot, filename);
  const content = await readFile(fullPath, "utf8");
  promptCache.set(filename, content);
  return content;
}
