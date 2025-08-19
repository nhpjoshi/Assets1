// Install dependencies: npm install mongodb digest-fetch
const { MongoClient } = require("mongodb");
const { DigestClient } = require("digest-fetch"); // ✅ FIXED

// ==== CONFIGURATION ====
const MONGO_URI =
  "mongodb+srv://admin:admin@cluster1.n2msm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster1";

const ATLAS_PUBLIC_KEY = "jyvaogjf";
const ATLAS_PRIVATE_KEY = "5d2cc776-f862-4b9b-b3b3-a389553352b2";
const PROJECT_ID = "65afa10de7cfa50a87ebf807";
const CLUSTER_NAME = "Cluster1";

async function main() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();

    // Insert sample docs
    const db = client.db("TestDB");
    const coll = db.collection("TestColl");
    await coll.insertMany([
      {
        title: "Atlas Search with v2 API",
        description: "Testing Node.js integration",
      },
      {
        title: "MongoDB Atlas",
        description: "Using Admin API v2 with Digest Auth",
      },
    ]);
    console.log("✅ Sample documents inserted into TestDB.TestColl");

    // Digest Auth client
    const digestClient = new DigestClient(ATLAS_PUBLIC_KEY, ATLAS_PRIVATE_KEY);

    // API endpoint
    const endpoint = `https://cloud.mongodb.com/api/atlas/v2/groups/${PROJECT_ID}/clusters/${CLUSTER_NAME}/search/indexes`;

    // Index definition
    const indexDefinition = {
      collectionName: "TestColl",
      database: "TestDB",
      name: "default1",
      type: "search",
      definition: {
        analyzer: "lucene.standard",
        searchAnalyzer: "lucene.standard",
        mappings: { dynamic: true },
      },
    };

    // Call Atlas Admin API
    const res = await digestClient.fetch(endpoint, {
      method: "POST",
      body: JSON.stringify(indexDefinition),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/vnd.atlas.2024-05-30+json",
      },
    });

    const data = await res.json();

    const searchResults = await coll
      .aggregate([
        {
          $search: {
            index: "default1", // the index we just created
            text: {
              query: "Atlas",
              path: ["title", "description"], // search in both fields
            },
          },
        },
        { $limit: 5 }, // limit results
      ])
      .toArray();
    console.log("✅ Atlas Search index creation response:", data);
    console.log("✅ Search Results:", searchResults);
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await client.close();
  }
}

main();
