// Offline leads CLI. Currently one subcommand:
//
//   tsx src/cli.ts import <file.xlsx>
//
// It validates env, connects to Mongo, ensures indexes, runs the import, prints
// the summary, and closes the connection. Arg parsing is hand-rolled (no dep).

import { loadEnv } from "./env.js";
import { connect, close } from "./db/mongo.js";
import { ensureIndexes } from "./db/indexes.js";
import { runImport } from "./import/importer.js";

function usage(): void {
  console.error("Usage: tsx src/cli.ts import <file.xlsx>");
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command !== "import") {
    usage();
    process.exitCode = 1;
    return;
  }

  const filePath = rest[0];
  if (!filePath) {
    console.error("Error: missing <file.xlsx> argument.");
    usage();
    process.exitCode = 1;
    return;
  }

  loadEnv(); // validate env early (throws on bad config)
  const db = await connect();
  try {
    await ensureIndexes(db);
    const summary = await runImport(filePath);
    console.log("Import complete:");
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exitCode = 1;
  void close();
});
