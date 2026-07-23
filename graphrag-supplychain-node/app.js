/**
 * CLI entry point for the GraphRAG supply chain demo.
 *
 * Usage:
 *   node app.js "If Nexon Circuits in Taiwan is hit by a typhoon, which
 *   products and customers are at risk?"
 *
 *   node app.js --examples      # run a set of bundled example questions
 */

import * as db from "./src/db.js";
import { retrieve } from "./src/graphRag.js";
import { generateAnswer } from "./src/llm.js";

const EXAMPLE_QUESTIONS = [
  "If Supplier Nexon Circuits in Taiwan is hit by a typhoon, which end products " +
    "and customers are at risk?",
  "Which suppliers does the UrbanMove E-Scooter depend on, directly or indirectly?",
  "What is currently causing shipment delays, and which products are affected?",
  "Find single points of failure: which supplier feeds the most products?",
];

async function runQuery(database, question, { topK = 4, maxDepth = 2 } = {}) {
  console.log(`\n${"=".repeat(80)}\nQUESTION: ${question}\n${"=".repeat(80)}`);

  const result = await retrieve(database, question, { topK, maxDepth });

  console.log(`\nVector search seed nodes (${result.seedNodes.length}):`);
  for (const n of result.seedNodes) {
    console.log(`  - [${n.type}] ${n.name}  (score=${(n.score || 0).toFixed(3)})`);
  }

  console.log(
    `\nGraph traversal pulled in ${result.subgraphNodes.length} total nodes ` +
      `and ${result.subgraphEdges.length} relationships.`
  );

  const answer = await generateAnswer(result);
  console.log(`\nANSWER:\n${answer}\n`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(
      "Usage:\n" +
        '  node app.js "your question here"\n' +
        "  node app.js --examples\n"
    );
    process.exit(1);
  }

  const { client, db: database } = await db.connect();
  try {
    if (args[0] === "--examples") {
      for (const q of EXAMPLE_QUESTIONS) {
        await runQuery(database, q);
      }
    } else {
      await runQuery(database, args.join(" "));
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
