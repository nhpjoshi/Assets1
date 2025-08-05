function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class Node {
  constructor(id, vector) {
    this.id = id;
    this.vector = vector;
    this.neighbors = new Map(); // level -> array of node IDs
  }
}

class HNSW {
  constructor(maxLevel = 4) {
    this.nodes = [];
    this.maxLevel = maxLevel;
  }

  cosineSimilarity(a, b) {
    let dot = 0,
      normA = 0,
      normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  angleDegrees(similarity) {
    // Clamp to avoid invalid acos
    const clamped = Math.min(1, Math.max(-1, similarity));
    return Math.acos(clamped) * (180 / Math.PI);
  }

  addNode(vector) {
    const id = this.nodes.length;
    const node = new Node(id, vector);
    const level = Math.floor(Math.random() * (this.maxLevel + 1));

    console.log(
      `\n🔷 Inserting Node ${id} [${vector.join(", ")}] at level ${level}`
    );

    for (let l = this.maxLevel; l >= 0; l--) {
      const bestId = this.searchAtLayer(vector, l);
      if (bestId !== -1) {
        if (!node.neighbors.has(l)) node.neighbors.set(l, []);
        node.neighbors.get(l).push(bestId);

        const neighborNode = this.nodes[bestId];
        if (!neighborNode.neighbors.has(l)) neighborNode.neighbors.set(l, []);
        neighborNode.neighbors.get(l).push(id);

        const sim = this.cosineSimilarity(vector, neighborNode.vector);
        const angle = this.angleDegrees(sim);
        console.log(
          `  ↳ Connected at level ${l} with Node ${bestId} (Similarity: ${sim.toFixed(
            3
          )}, Angle: ${angle.toFixed(2)}°)`
        );
      }
    }

    this.nodes.push(node);
  }

  searchAtLayer(query, level) {
    let bestSim = -1;
    let bestId = -1;
    for (const node of this.nodes) {
      if (node.neighbors.has(level)) {
        const sim = this.cosineSimilarity(query, node.vector);
        if (sim > bestSim) {
          bestSim = sim;
          bestId = node.id;
        }
      }
    }
    return bestId;
  }

  async search(query) {
    let current = 0;
    let currentSim = this.cosineSimilarity(query, this.nodes[current].vector);

    console.log(
      `\n🔍 Starting search from Node ${current} [${this.nodes[
        current
      ].vector.join(", ")}] → Similarity: ${currentSim.toFixed(3)}`
    );

    for (let l = this.maxLevel; l >= 0; l--) {
      console.log(`\n⬇️  Level ${l}: Navigating...`);
      let improved = true;
      while (improved) {
        console.log("  🔄 Checking neighbors...");
        improved = false;
        const neighbors = this.nodes[current].neighbors.get(l) || [];
        for (const neighborId of neighbors) {
          const sim = this.cosineSimilarity(
            query,
            this.nodes[neighborId].vector
           
          );
           console.log(sim))
          const angle = this.angleDegrees(sim);
          console.log(
            `    Comparing with Node ${neighborId} → Similarity: ${sim.toFixed(
              3
            )}, Angle: ${angle.toFixed(2)}°`
          );

          await sleep(700);

          if (sim < currentSim) {
            console.log(" ✅ Better! Moving.");
            current = neighborId;
            currentSim = sim;
            improved = true;
            break;
          } else {
            console.log(" ❌ Not better.");
          }
        }
      }
    }

    console.log(
      `\n✅ Final Result → Best match: Node ${current} with Similarity: ${currentSim.toFixed(
        4
      )}\n`
    );
    return current;
  }
}

// -------------------------- Demo --------------------------
(async () => {
  const hnsw = new HNSW(2);

  const data = [
    [1, 0],
    [0.5, 0.5],
    [0, 1],
    [-1, 0],
    [0.6, 0.8],
  ];

  for (const vec of data) {
    hnsw.addNode(vec);
    // console.log("adding vector");
  }

  const query = [0.9, 0.7];
  await hnsw.search(query);
})();
