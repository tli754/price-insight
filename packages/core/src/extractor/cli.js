#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { PriceInsightError } from "../core.js";
import { extractProductFromReaderContent, extractProductFromUrl } from "./extractor.js";

export async function main(argv = process.argv.slice(2), io = process) {
  try {
    const options = parseArgs(argv);
    const result =
      options.readerFile === null
        ? await extractProductFromUrl(options.productUrl)
        : extractProductFromReaderContent({
            sourceUrl: options.productUrl,
            readerContent: readFileSync(options.readerFile, "utf8")
          });

    io.stdout.write(`${JSON.stringify(result, null, options.compact ? 0 : 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`${JSON.stringify({ error: message })}\n`);
    return 1;
  }
}

function parseArgs(argv) {
  const options = {
    productUrl: null,
    readerFile: null,
    compact: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--compact") {
      options.compact = true;
    } else if (arg === "--reader-file") {
      options.readerFile = argv[index + 1] ?? null;
      index += 1;
      if (options.readerFile === null) {
        throw new PriceInsightError("--reader-file requires a file path.");
      }
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (options.productUrl === null) {
      options.productUrl = arg;
    } else {
      throw new PriceInsightError(`Unexpected argument: ${arg}`);
    }
  }

  if (options.productUrl === null) {
    throw new PriceInsightError("A product URL is required.");
  }

  return options;
}

function printHelp() {
  process.stdout.write(`price-insight-extract

Extract structured product facts from a product URL.

Usage:
  price-insight-extract <product-url>
  price-insight-extract <product-url> --reader-file reader-output.md

Options:
  --compact       Write compact JSON.
  --reader-file   Parse saved Jina Reader output instead of calling Jina.
`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
