import { MongoClient } from "mongodb";
import * as config from "./config.js";

/**
 * Opens a MongoDB client + db handle. Caller is responsible for closing
 * `client` when done (see ingest.js / app.js for the pattern).
 */
export async function connect() {
  config.requireMongoUri();
  const client = new MongoClient(config.MONGODB_URI);
  await client.connect();
  const db = client.db(config.MONGODB_DB);
  return { client, db };
}

export function vectorIndexDefinition() {
  return {
    fields: [
      {
        type: "vector",
        path: "embedding",
        numDimensions: config.EMBEDDING_DIMENSIONS,
        similarity: "cosine",
      },
      { type: "filter", path: "type" },
    ],
  };
}

/**
 * Creates the Atlas Vector Search index if it doesn't already exist.
 * Requires an Atlas cluster (M10+, or M0/M2/M5 which now support Search).
 * If index creation via the driver isn't available for your cluster tier,
 * this prints the JSON so you can paste it into
 * Atlas UI -> Database -> Search -> Create Search Index -> JSON Editor.
 */
export async function ensureVectorIndex(db) {
  const collection = db.collection(config.NODES_COLLECTION);
  const existing = await collection.listSearchIndexes().toArray();

  if (existing.some((idx) => idx.name === config.VECTOR_INDEX_NAME)) {
    console.log(`Vector index '${config.VECTOR_INDEX_NAME}' already exists.`);
    return;
  }

  const definition = vectorIndexDefinition();
  try {
    await collection.createSearchIndex({
      name: config.VECTOR_INDEX_NAME,
      type: "vectorSearch",
      definition,
    });
    console.log(
      `Requested creation of vector index '${config.VECTOR_INDEX_NAME}'. ` +
        `It may take a minute to become queryable.`
    );
  } catch (err) {
    console.log(
      `Could not create the vector search index programmatically (${err.message}).`
    );
    console.log(
      "Create it manually in Atlas UI -> Database -> Search -> " +
        "Create Search Index -> JSON Editor, on the " +
        `'${config.NODES_COLLECTION}' collection, named ` +
        `'${config.VECTOR_INDEX_NAME}', with this definition:\n`
    );
    console.log(JSON.stringify(definition, null, 2));
  }
}
