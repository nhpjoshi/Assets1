/**
 * Ingests the synthetic supply chain dataset into MongoDB Atlas:
 *   1. Loads data/supplychainDataset.json
 *   2. Embeds each node's `text` field locally
 *   3. Upserts nodes + edges into Atlas collections
 *   4. Ensures the Atlas Vector Search index exists on the nodes collection
 *
 * Run: node src/ingest.js  (or: npm run ingest)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import * as config from "./config.js";
import * as db from "./db.js";
import { embedBatch } from "./embeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = path.join(__dirname, "..", "data", "supplychainDataset.json");

function loadDataset() {
  if (!fs.existsSync(DATASET_PATH)) {
    throw new Error(
      `${DATASET_PATH} not found. Run \`node data/generateData.js\` first.`
    );
  }
  return JSON.parse(fs.readFileSync(DATASET_PATH, "utf-8"));
}

export async function ingest() {
  const { nodes, edges } = loadDataset();

  console.log(`Embedding ${nodes.length} node descriptions locally...`);
  const texts = nodes.map((n) => n.text);
  const embeddings = await embedBatch(texts);
  nodes.forEach((node, i) => {
    node.embedding = embeddings[i];
  });

  const { client, db: database } = await db.connect();
  try {
    const nodesCol = database.collection(config.NODES_COLLECTION);
    const edgesCol = database.collection(config.EDGES_COLLECTION);

    console.log(`Upserting ${nodes.length} nodes into '${config.NODES_COLLECTION}'...`);
    const nodeOps = nodes.map((n) => ({
      updateOne: { filter: { _id: n._id }, update: { $set: n }, upsert: true },
    }));
    await nodesCol.bulkWrite(nodeOps);

    console.log(
      `Clearing and inserting ${edges.length} edges into '${config.EDGES_COLLECTION}'...`
    );
    await edgesCol.deleteMany({});
    await edgesCol.insertMany(edges);

    // Helpful indexes for graph traversal performance
    await edgesCol.createIndex({ from: 1 });
    await edgesCol.createIndex({ to: 1 });
    await nodesCol.createIndex({ type: 1 });

    console.log("Ensuring Atlas Vector Search index exists...");
    await db.ensureVectorIndex(database);

    console.log("Ingestion complete.");
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingest().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
