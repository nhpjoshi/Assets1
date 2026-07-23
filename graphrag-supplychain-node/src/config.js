import "dotenv/config";

export const MONGODB_URI = process.env.MONGODB_URI || "";
export const MONGODB_DB = process.env.MONGODB_DB || "supplychain_graphrag";
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "";

export const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY || "";
export const MONGODB_MODEL_API_KEY = process.env.MONGODB_MODEL_API_KEY || "";
export const VOYAGE_BASE_URL = process.env.MONGODB_MODEL_API_KEY
  ? "https://ai.mongodb.com/v1"
  : undefined;

export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "voyage-3.5";

export const NODES_COLLECTION = "nodes";
export const EDGES_COLLECTION = "edges";
export const VECTOR_INDEX_NAME = "nodes_vector_index";
export const EMBEDDING_DIMENSIONS = 1024;

export function requireMongoUri() {
  if (!MONGODB_URI) {
    throw new Error(
      "MONGODB_URI is not set. Copy .env.example to .env and fill in your " +
        "Atlas connection string."
    );
  }
}

export function requireVoyageApiKey() {
  if (!VOYAGE_API_KEY && !MONGODB_MODEL_API_KEY) {
    throw new Error(
      "Neither VOYAGE_API_KEY nor MONGODB_MODEL_API_KEY is set. Copy .env.example " +
        "to .env and fill in one of: a Voyage AI key from https://www.voyageai.com, " +
        "or a Model API Key from the Atlas UI (Organization -> Model API Keys)."
    );
  }
}
