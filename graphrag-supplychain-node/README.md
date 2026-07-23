# GraphRAG for Supply Chain Management — MongoDB Atlas Demo (Node.js)

A working demonstration of **GraphRAG** (Graph-augmented Retrieval-Augmented Generation)
applied to supply chain risk analysis, built entirely on **MongoDB Atlas** and Node.js.

Instead of plain vector-RAG (which only finds *semantically similar* text), this project
combines:

1. **Atlas Vector Search** — finds the entities most relevant to a natural-language question.
2. **Graph traversal** over an edges collection — walks the supply chain relationship graph
   from those entities (suppliers → components → products → factories → shipments →
   customers) to pull in *structurally connected* context that pure vector search would miss.
3. An **LLM** (Claude) — synthesizes the retrieved subgraph + text into a grounded answer.

Example question this unlocks: *"If Supplier Nexon Circuits in Taiwan is hit by a typhoon,
which end products and customers are at risk?"* — a pure vector search over supplier
descriptions won't know which products use Nexon's parts. Graph traversal will.

## Why MongoDB Atlas for GraphRAG

- A **single database** holds both the vector index (for semantic retrieval) and the
  graph edges (for relationship traversal) — no separate graph database needed.
- `$graphLookup` performs recursive graph traversal natively in the aggregation pipeline
  (this demo also ships a hand-rolled BFS traversal as the default, with the native
  `$graphLookup` version included for comparison — see `src/graphRag.js`).
- Atlas Vector Search indexes live on the same collections, so seed nodes for traversal
  come straight from a `$vectorSearch` stage.
- Everything is one query language (MQL/aggregation pipelines) — no separate query
  language to bridge (e.g. no Cypher-to-Mongo translation layer).

## Architecture

```
Supply chain data (suppliers, parts, products, factories, shipments, risk events)
        │
        ▼
Ingestion pipeline → generates text embeddings for each entity
        │
        ▼
MongoDB Atlas
 ├── nodes collection   (entities + embeddings, Atlas Vector Search index)
 └── edges collection   (typed relationships, traversed via graph lookup)
        │
        ▼
GraphRAG query engine
 1. Embed the user question
 2. $vectorSearch → seed nodes most relevant to the question
 3. Graph traversal from seed nodes → connected subgraph (configurable depth)
 4. Assemble structured context (entities + relationships + risk events)
        │
        ▼
LLM → grounded natural-language answer, citing the graph path
```

## Data model

**`nodes` collection** — one document per entity, all sharing a common shape:

```json
{
  "_id": "supplier_004",
  "type": "Supplier",
  "name": "Nexon Circuits",
  "attributes": { "country": "Taiwan", "tier": 1, "risk_score": 0.42 },
  "text": "Nexon Circuits is a Tier-1 semiconductor supplier based in Taiwan...",
  "embedding": [0.0123, -0.045, ...]
}
```

Entity types: `Supplier`, `Component`, `Product`, `Factory`, `Warehouse`,
`DistributionCenter`, `Customer`, `Shipment`, `RiskEvent`.

**`edges` collection** — directed, typed relationships:

```json
{ "from": "supplier_004", "to": "component_012", "type": "SUPPLIES" }
{ "from": "component_012", "to": "product_002",  "type": "USED_IN" }
{ "from": "product_002",   "to": "factory_001",  "type": "MANUFACTURED_AT" }
{ "from": "risk_event_003","to": "supplier_004", "type": "AFFECTS" }
```

Traversal walks `from → to` (and the reverse direction) starting at the vector-search
seed nodes, so a question about a supplier surfaces every downstream product, factory,
and customer connected to it — and a question about a product surfaces every upstream
supplier it depends on.

## Project layout

```
graphrag-supplychain/
├── README.md
├── package.json
├── .env.example
├── data/
│   └── generateData.js       # synthetic supply chain dataset generator
├── src/
│   ├── config.js              # env/config loading
│   ├── db.js                  # MongoDB Atlas connection + index setup
│   ├── embeddings.js          # Voyage AI embedding model client
│   ├── ingest.js               # loads nodes/edges + embeds + creates vector index
│   ├── graphRag.js             # the core GraphRAG retrieval pipeline
│   └── llm.js                  # optional LLM answer generation (Anthropic API)
└── app.js                      # CLI entry point to run example queries
```

## Setup

### 1. Prerequisites

- A MongoDB Atlas cluster (M10+ recommended; free tier M0 also supports Atlas Search/Vector Search)
- Node.js 18+
- A Voyage AI API key for embeddings — get one free at
  [voyageai.com](https://www.voyageai.com) (dashboard -> API keys). Voyage is
  Anthropic's recommended embeddings partner.
- (Optional) an Anthropic API key, to have an LLM write the final answer instead of
  just returning the retrieved context

### 2. Install

```bash
cd graphrag-supplychain
npm install
```

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/
MONGODB_DB=supplychain_graphrag
VOYAGE_API_KEY=pa-...                # required — powers embeddings
EMBEDDING_MODEL=voyage-3.5           # 1024-dim general-purpose model
ANTHROPIC_API_KEY=sk-ant-...         # optional — omit to get extractive answers
```

### 4. Generate synthetic data

```bash
npm run generate-data
```

This writes `data/supplychainDataset.json` — ~9 entity types, ~42 nodes, ~55 edges,
including a handful of active "risk events" (a typhoon near Taiwan, a port strike, a
lithium export quota change) so query results are interesting.

### 5. Ingest into Atlas

```bash
npm run ingest
```

This will:
- Embed every node's `text` field via the Voyage AI API (`voyage-3.5`,
  `inputType: "document"`)
- Insert all nodes and edges into Atlas
- Create the Atlas Vector Search index programmatically (`createSearchIndex`).
  If your Atlas tier/driver doesn't support this, the script prints the equivalent
  index JSON to paste into **Atlas UI → Search → Create Search Index → JSON Editor**.

### 6. Query

```bash
node app.js "If Nexon Circuits in Taiwan is hit by a typhoon, which products and customers are at risk?"
```

or run the bundled example questions:

```bash
npm run examples
```

Each answer prints:
- The vector-search seed nodes (why they were chosen)
- The graph traversal stats (what was pulled in)
- The final synthesized answer

## Example questions this dataset supports

- "Which suppliers does Product X depend on, directly or indirectly?"
- "If Factory Y goes offline, which products and customers are affected?"
- "What single points of failure exist in our supplier network?"
- "Which shipments are delayed because of the port strike, and what products do they carry?"
- "Find alternate suppliers for components affected by the Taiwan risk event."

## Notes on scaling this to a real deployment

- Swap `generateData.js` for real ERP/procurement system exports (SAP, Oracle SCM, etc).
- To use a different embedding model/dimension size (e.g. `voyage-3-large` at 2048
  dimensions, or a Voyage domain-specific model like `voyage-finance-2`), update
  `EMBEDDING_MODEL` in `.env` and `EMBEDDING_DIMENSIONS` in `src/config.js` to match,
  then re-run `npm run ingest` so stored embeddings and the vector index stay consistent.
- For very large graphs, cap traversal depth and add `$match` restrictions (already
  parameterized as `maxDepth` in `src/graphRag.js`) to keep it bounded. The native
  `graphTraverseNative()` function shows how to enforce this directly in `$graphLookup`
  via `maxDepth` and `restrictSearchWithMatch`.
- Consider an `updatedAt` field + change streams to keep embeddings fresh as entities change.
