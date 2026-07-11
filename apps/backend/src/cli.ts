/**
 * Generic dispatcher for one-off scripts in src/scripts/.
 *
 * Usage:
 *   pnpm --filter @price-insight/backend script <name>
 *   pnpm --filter @price-insight/backend script --list
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "scripts");

export async function listAvailableScripts(scriptsDir: string): Promise<string[]> {
  const files = await readdir(scriptsDir);
  return files.filter((f) => f.endsWith(".js") || f.endsWith(".ts")).map((f) => f.replace(/\.(js|ts)$/, ""));
}

export type ResolveResult =
  | { action: "list" }
  | { action: "run"; name: string }
  | { action: "error"; message: string };

export function resolveScript(name: string | undefined, available: string[]): ResolveResult {
  if (!name || name === "--list" || name === "-l") {
    return { action: "list" };
  }
  if (!available.includes(name)) {
    return { action: "error", message: `Unknown script "${name}".` };
  }
  return { action: "run", name };
}

async function main(): Promise<void> {
  const [name] = process.argv.slice(2);
  const available = await listAvailableScripts(SCRIPTS_DIR);
  const result = resolveScript(name, available);

  if (result.action === "list") {
    console.log("Available scripts:\n" + available.map((s) => `  ${s}`).join("\n"));
    process.exit(name ? 0 : 1);
  }

  if (result.action === "error") {
    console.error(result.message);
    console.error("Available scripts:\n" + available.map((s) => `  ${s}`).join("\n"));
    process.exit(1);
  }

  await import(`./scripts/${result.name}.js`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
