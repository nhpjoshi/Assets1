/**
 * The core GraphRAG retrieval pipeline.
 *
 * Step 1 (vector search):   Embed the question, run $vectorSearch on the nodes
 *                            collection to find the most semantically relevant
 *                            seed entities.
 *
 * Step 2 (graph traversal): Walk outward from the seed node ids across the
 *                            edges collection (both forward and backward) to
 *                            pull in every entity connected to them (upstream
 *                            suppliers, downstream products/customers, related
 *                            risk events, etc.) within a bounded number of hops.
 *
 * Step 3 (context assembly): Convert the seed nodes + traversed subgraph + the
 *                            edges that connect them into a compact, structured
 *                            text context.
 *
 * Step 4 (generation):      Hand that context + the original question to an LLM
 *                            (or an extractive fallback if no API key is set).
 */

import * as config from "./config.js";
import { embedText } from "./embeddings.js";

/**
 * Step 1: find the most semantically relevant nodes for the question.
 */
export async function vectorSearchSeeds(db, question, { topK = 4, nodeType = null } = {}) {
  const queryVector = await embedText(question);

  const vectorStage = {
    $vectorSearch: {
      index: config.VECTOR_INDEX_NAME,
      path: "embedding",
      queryVector,
      numCandidates: Math.max(50, topK * 10),
      limit: topK,
    },
  };
  if (nodeType) {
    vectorStage.$vectorSearch.filter = { type: nodeType };
  }

  const pipeline = [
    vectorStage,
    {
      $project: {
        _id: 1,
        type: 1,
        name: 1,
        attributes: 1,
        text: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];

  return db.collection(config.NODES_COLLECTION).aggregate(pipeline).toArray();
}

/**
 * Step 2: traverse the relationship graph outward from the seed nodes.
 * Follows edges both forward and backward so a question about a supplier
 * surfaces downstream products, and a question about a product surfaces
 * upstream suppliers.
 */
export async function graphTraverse(db, seedIds, { maxDepth = 2 } = {}) {
  const edgesCol = db.collection(config.EDGES_COLLECTION);
  const nodesCol = db.collection(config.NODES_COLLECTION);

  const visitedEdges = new Map();
  const visitedIds = new Set(seedIds);
  let frontier = new Set(seedIds);

  for (let depth = 0; depth < maxDepth; depth++) {
    if (frontier.size === 0) break;
    const frontierList = Array.from(frontier);

    const forward = await edgesCol.find({ from: { $in: frontierList } }).toArray();
    const backward = await edgesCol.find({ to: { $in: frontierList } }).toArray();

    const nextFrontier = new Set();
    for (const e of [...forward, ...backward]) {
      const key = `${e.from}|${e.to}|${e.type}`;
      visitedEdges.set(key, e);
      for (const endpoint of [e.from, e.to]) {
        if (!visitedIds.has(endpoint)) {
          nextFrontier.add(endpoint);
          visitedIds.add(endpoint);
        }
      }
    }
    frontier = nextFrontier;
  }

  const subgraphNodes = await nodesCol
    .find({ _id: { $in: Array.from(visitedIds) } })
    .toArray();
  const subgraphEdges = Array.from(visitedEdges.values());

  return { subgraphNodes, subgraphEdges };
}

/**
 * Alternative implementation using MongoDB's native $graphLookup. Kept
 * alongside graphTraverse() to show the idiomatic Atlas aggregation
 * approach. $graphLookup only traverses one direction per call, so this
 * issues two graphLookups (forward and backward) and merges results.
 */
export async function graphTraverseNative(db, seedIds, { maxDepth = 2 } = {}) {
  const pipeline = [
    { $match: { _id: { $in: seedIds } } },
    {
      $graphLookup: {
        from: config.EDGES_COLLECTION,
        startWith: "$_id",
        connectFromField: "to",
        connectToField: "from",
        as: "downstream_edges",
        maxDepth: maxDepth - 1,
      },
    },
    {
      $graphLookup: {
        from: config.EDGES_COLLECTION,
        startWith: "$_id",
        connectFromField: "from",
        connectToField: "to",
        as: "upstream_edges",
        maxDepth: maxDepth - 1,
      },
    },
    {
      $project: {
        _id: 1,
        edges: { $concatArrays: ["$downstream_edges", "$upstream_edges"] },
      },
    },
  ];

  const results = await db.collection(config.NODES_COLLECTION).aggregate(pipeline).toArray();

  const allEdges = new Map();
  const connectedIds = new Set(seedIds);
  for (const r of results) {
    for (const e of r.edges) {
      const key = `${e.from}|${e.to}|${e.type}`;
      allEdges.set(key, e);
      connectedIds.add(e.from);
      connectedIds.add(e.to);
    }
  }

  const nodes = await db
    .collection(config.NODES_COLLECTION)
    .find({ _id: { $in: Array.from(connectedIds) } })
    .toArray();

  return { subgraphNodes: nodes, subgraphEdges: Array.from(allEdges.values()) };
}

/**
 * Step 3: turn the retrieved subgraph into compact text context for the LLM.
 */
export function assembleContext(seedNodes, subgraphNodes, subgraphEdges) {
  const nodeById = new Map(subgraphNodes.map((n) => [n._id, n]));
  const seedIds = new Set(seedNodes.map((n) => n._id));

  const lines = ["RELEVANT ENTITIES (via vector search):"];
  for (const n of seedNodes) {
    lines.push(`- [${n.type}] ${n.name} (${n._id}): ${n.text}`);
  }

  lines.push("\nCONNECTED ENTITIES (via graph traversal):");
  for (const n of subgraphNodes) {
    if (seedIds.has(n._id)) continue;
    lines.push(`- [${n.type}] ${n.name} (${n._id}): ${n.text}`);
  }

  lines.push("\nRELATIONSHIPS:");
  for (const e of subgraphEdges) {
    const fromName = nodeById.get(e.from)?.name || e.from;
    const toName = nodeById.get(e.to)?.name || e.to;
    lines.push(`- ${fromName} --[${e.type}]--> ${toName}`);
  }

  return lines.join("\n");
}

/**
 * Runs the full retrieval pipeline: vector search -> graph traversal ->
 * context assembly.
 */
export async function retrieve(db, question, { topK = 4, maxDepth = 2, nodeType = null } = {}) {
  const seedNodes = await vectorSearchSeeds(db, question, { topK, nodeType });
  const seedIds = seedNodes.map((n) => n._id);

  const { subgraphNodes, subgraphEdges } = await graphTraverse(db, seedIds, { maxDepth });
  const contextText = assembleContext(seedNodes, subgraphNodes, subgraphEdges);

  return { question, seedNodes, subgraphNodes, subgraphEdges, contextText };
}
