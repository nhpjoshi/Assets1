/**
 * Text embedding model, using Voyage AI's hosted embedding API.
 *
 * Supports EITHER of MongoDB's two ways to authenticate with Voyage models
 * (see src/config.js for details on the difference):
 *   - VOYAGE_API_KEY        -> hits https://api.voyageai.com/v1/embeddings
 *   - MONGODB_MODEL_API_KEY -> hits https://ai.mongodb.com/v1/embeddings
 *
 * Query text and document text are embedded slightly differently
 * (`inputType: "query"` vs `inputType: "document"`) - Voyage's models are
 * trained to take advantage of this distinction for better retrieval
 * quality, so ingestion and querying use different helper functions below.
 */

import { VoyageAIClient } from "voyageai";
import * as config from "./config.js";

const BATCH_SIZE = 128; // Voyage API's max list length per request

let client = null;

function getClient() {
  if (!client) {
    config.requireVoyageApiKey();
    const apiKey = config.VOYAGE_API_KEY || config.MONGODB_MODEL_API_KEY;
    const options = { apiKey };
    if (config.VOYAGE_BASE_URL) {
      options.baseUrl = config.VOYAGE_BASE_URL;
    }
    client = new VoyageAIClient(options);
  }
  return client;
}

/**
 * Embed a single piece of text. Use inputType "query" for user questions
 * and "document" for entity descriptions being indexed.
 */
export async function embedText(text, inputType = "query") {
  const c = getClient();
  const response = await c.embed({
    input: text,
    model: config.EMBEDDING_MODEL,
    inputType,
  });
  return response.data[0].embedding;
}

/**
 * Embed a batch of texts (used during ingestion for entity descriptions).
 * Chunks requests to respect Voyage's 128-input-per-request limit.
 */
export async function embedBatch(texts, inputType = "document") {
  const c = getClient();
  const vectors = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const chunk = texts.slice(i, i + BATCH_SIZE);
    const response = await c.embed({
      input: chunk,
      model: config.EMBEDDING_MODEL,
      inputType,
    });
    vectors.push(...response.data.map((d) => d.embedding));
    console.log(`  embedded ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length}`);
  }

  return vectors;
}
