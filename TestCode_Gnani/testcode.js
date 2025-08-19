// install dependencies first: npm install mongodb axios
const { MongoClient } = require("mongodb");
const axios = require("axios");

// ==== CONFIG ====
const uri =
  "mongodb+srv://admin:admin@cluster1.n2msm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster1";

// Your Atlas Project/Cluster details (replace with your actual values)
const ATLAS_PUBLIC_KEY = "jyvaogjf";
const ATLAS_PRIVATE_KEY = "5d2cc776-f862-4b9b-b3b3-a389553352b2";
const PROJECT_ID = "65afa10de7cfa50a87ebf807";
const CLUSTER_NAME = "Cluster1";

async function main() {
  const client = new MongoClient(uri);

  try {
    await client.connect();

    // Create DB and Collection
    const db = client.db("TestDB");
    const coll = db.collection("TestColl");

    // Insert sample documents
    await coll.insertMany([
      {
        title: "MongoDB Atlas Search",
        description: "Full-text search on Atlas",
      },
      {
        title: "Node.js connection",
        description: "Connecting with MongoDB driver",
      },
      {
        title: "Atlas indexing",
        description: "Creating search indexes easily",
      },
    ]);

    console.log("Sample data inserted!");

    // ==== Create Atlas Search Index ====
    // API endpoint
    const url = `https://cloud.mongodb.com/api/atlas/v2/groups/${PROJECT_ID}/clusters/${CLUSTER_NAME}/search/indexes`;

    ///api/atlas/v2/groups/{groupId}/clusters/{clusterName}/search/indexes

    // Basic auth
    const auth = {
      username: ATLAS_PUBLIC_KEY,
      password: ATLAS_PRIVATE_KEY,
    };

    // Index definition
    const indexDef = {
      collectionName: "TestColl",
      database: "TestDB",
      name: "default", // index name
      mappings: {
        dynamic: true, // maps all fields automatically
      },
    };

    // Create index
    const response = await axios.post(url, indexDef, { auth });
    console.log("Atlas Search index creation response:", response.data);
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

main();
