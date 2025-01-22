const express = require("express");
const axios = require("axios");
const { MongoClient, Binary } = require("mongodb");
const cors = require("cors");
const app = express();
const GenAIIP = "192.168.1.5";

const mongoUri =
  "mongodb+srv://<>:<>@cluster0.n2msm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const port = 3000;
app.use(cors());
app.use(express.json());
var db = "BookMarkSS";
var db1 = "Aisurance";
var coll = "BMSearch";
var namespace = `${db}.${coll}`;
const keyVaultNamespace = "encryption.__keyVault";
// const extraOptions = {
//   cryptSharedLibRequired: true,
//   cryptSharedLibPath:
//     "/Users/Shared/mongo_crypt_shared/lib/mongo_crypt_v1.dylib",
// };

// dataKey = "HUiUsexIRBKjoxd9bgxoYQ==";
// const fs = require("fs");
// const provider = "local";
// const path = "./master-key.txt";
// const localMasterKey = fs.readFileSync(path);
// const kmsProviders = {
//   local: {
//     key: localMasterKey,
//   },
// };

// const schema = {
//   bsonType: "object",
//   encryptMetadata: {
//     keyId: [new Binary(Buffer.from(dataKey, "base64"), 4)],
//   },
//   // properties: {
//   //   Link: {
//   //     encrypt: {
//   //       bsonType: "string",
//   //       algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
//   //     },
//   //   },
//   //   Description: {
//   //     encrypt: {
//   //       bsonType: "string",
//   //       algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
//   //     },
//   //   },
//   // },
// };

// var bookmarkschema = {};
// bookmarkschema[namespace] = schema;

// const secureClient = new MongoClient(mongoUri, {
//   useNewUrlParser: true,
//   useUnifiedTopology: true,
//   autoEncryption: {
//     keyVaultNamespace,
//     kmsProviders,
//     schemaMap: bookmarkschema,
//     extraOptions: extraOptions,
//   },
// });

const regularClient = new MongoClient(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// end-key-vault

// start-schema

// API URL
const apiUrl = "http://host.docker.internal:11434/api/embeddings";
const textURL = "http://host.docker.internal:11434/api/generate";
// const mongoUri =
//   "mongodb+srv://AdminCluster:admin@testcluster.n2msm.mongodb.net/";

async function getEmbedding(query) {
  console.log("Query:", query);
  // Define the OpenAI API url and key.
  const url = "http://host.docker.internal:11434/api/embeddings";
  const postData = {
    model: "mxbai-embed-large",
    prompt: query,
  };
  // Call OpenAI API to get the embeddings.
  let response = await axios.post(url, postData);
  return response.data.embedding;
}

async function findSimilarDocuments(embedding) {
  // Replace with your MongoDB url.
  try {
    await regularClient.connect();
    const db = regularClient.db("BookMarkSS"); // Replace with your database name.
    const collection = db.collection("BMSearch"); // Replace with your collection name.
    // Query for similar documents.
    const documents = await collection
      .aggregate([
        {
          $vectorSearch: {
            queryVector: embedding,
            path: "Embeddings",
            index: "vector_index_BookMarks",
            numCandidates: 10, // Adjust the number of candidates as needed.
            limit: 5, // Adjust the limit of results as needed.
          },
        },
      ])
      .toArray();

    return documents;
  } finally {
    await regularClient.close();
  }
}

// Initialize MongoDB client
const mongoClient = new MongoClient(mongoUri);

// Handle POST requests
app.post("/processData", async (req, res) => {
  try {
    const formData = req.body;
    console.log("API response:", formData);
    const now = new Date();
    // Data to be sent in the POST request
    const postData = {
      model: "mxbai-embed-large",
      prompt: req.body.Link + req.body.reference + req.body.description + now,
    };

    // Make POST request
    const response = await axios.post(apiUrl, postData);

    // Combine API response data with other object
    const combinedData = {
      Dataref: req.body.reference,
      Link: req.body.Link,
      Description: req.body.description,
      Date: now,
      Embeddings: response.data.embedding,
    };

    try {
      await regularClient.connect();
      try {
        await regularClient.connect();
        const writeResult = await regularClient
          .db(db)
          .collection(coll)
          .insertOne(combinedData);
      } catch (writeError) {
        console.error("writeError occurred:", writeError);
      }
      // end-insert
      // start-find
      res.status(200).send("Data processed and inserted into MongoDB");
      // end-find
    } finally {
      await regularClient.close();
    }
    // Connect to MongoDB
    // await mongoClient.connect();
    // console.log("Connected to MongoDB");

    // // Select MongoDB database and collection
    // const db = mongoClient.db("BookMarkSS");
    // const collection = db.collection("BMSearch");

    // // Insert combined data into MongoDB
    // const result = await collection.insertOne(combinedData);
    // console.log("Data inserted into MongoDB:", result);

    // // Send response
    // res.status(200).send("Data processed and inserted into MongoDB");
  } finally {
    // Close MongoDB connection
    await mongoClient.close();
  }
});

app.post("/getData", async (req, res) => {
  const query = req.body.query; // Replace with your query or get it from req.query
  try {
    const embedding = await getEmbedding(query);
    const documents = await findSimilarDocuments(embedding);
    const links = documents.map((doc) => doc.Link);
    res.json(links);
    console.log("Links:", links);
  } catch (err) {
    console.error(err);
    res.status(500).send("An error occurred");
  }
});

app.post("/getText", async (req, res) => {
  try {
    const formData = req.body;
    // Data to be sent in the POST request
    const postData = {
      model: "llama3",
      prompt:
        "what is this link, Give me only small introduction? " + req.body.data,
      stream: false,
      trim_output: true,
    };

    console.log(postData);

    // Sending POST request to external API
    const response = await axios.post(textURL, postData);
    console.log(response.data.response);

    // Sending response back to the frontend
    res.status(200).json({ description: response.data.response });
  } catch (error) {
    console.error("Error:", error.message);
    res
      .status(500)
      .json({ error: "An error occurred while processing the request" });
  }
});

app.post("/api/save-input", async (req, res) => {
  try {
    const { input, flag } = req.body;
    const collection = db1.collection("BlockchainTx");

    // Insert document into MongoDB
    const result = await collection.insertOne({
      input,
      flag,
      createdAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: "Input saved successfully",
      id: result.insertedId,
    });
  } catch (error) {
    console.error("Error saving input:", error);
    res.status(500).json({ success: false, message: "Error saving input" });
  }
});

// Start the server
app.listen(port, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${port}`);
});
