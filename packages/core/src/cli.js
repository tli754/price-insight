#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { analyzePrice, PriceInsightError } from "./core.js";

export function main(argv = process.argv.slice(2), io = process) {
  try {
    const { inputPath, compact } = parseArgs(argv);
    const payload = readPayload(inputPath);
    const result = analyzePrice(payload);
    const indentation = compact ? 0 : 2;
    io.stdout.write(`${JSON.stringify(result, null, indentation)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`${JSON.stringify({ error: message })}\n`);
    return 1;
  }
}

function parseArgs(argv) {
  const options = {
    inputPath: null,
    compact: false
  };

  for (const arg of argv) {
    if (arg === "--compact") {
      options.compact = true;
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (options.inputPath === null) {
      options.inputPath = arg;
    } else {
      throw new PriceInsightError(`Unexpected argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  process.stdout.write(`price-insight

Analyze a target price against reference prices.

Usage:
  price-insight [input.json] [--compact]

Reads JSON from stdin when input.json is omitted.
`);
}

function readPayload(inputPath) {
  const content =
    inputPath === null
      ? readFileSync(0, "utf8")
      : readFileSync(inputPath, "utf8");

  const payload = JSON.parse(content);
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PriceInsightError("Top-level JSON value must be an object.");
  }

  return payload;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
