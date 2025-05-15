const { MongoClient, ServerApiVersion } = require("mongodb");

const uri =
  "mongodb://mongo1:27017,mongo2:27017,mongo3:27017,mongo5:27017/?replicaSet=rs0&retryWrites=true&w=majority";

let client;
let collection;
let lastInsertAddress = null;

// Mapping node IP:port to friendly name
const nodeMap = {
  "mongo1:27017": "mongo1",
  "mongo2:27017": "mongo2",
  "mongo3:27017": "mongo3",
  "mongo5:27017": "mongo5",
};

async function connectToMongo() {
  if (client && client.isConnected()) {
    console.log("✅ Already connected to MongoDB");
    return;
  }

  client = new MongoClient(uri, {
    useUnifiedTopology: true,
    serverApi: ServerApiVersion.v1, // Optional: use stable API
  });

  // Listen to command success events to track which node handled the write
  client.on("commandSucceeded", (event) => {
    if (event.commandName === "insert") {
      lastInsertAddress = nodeMap[event.address] || event.address || "unknown";
    }
  });

  client.on("error", (err) => {
    console.error("❌ MongoDB client error:", err.message);
  });

  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");

    const db = client.db("SampleDB");

    // Create a time-series collection if it doesn't exist
    const options = {
      timeseries: {
        timeField: "timestamp", // The field that holds the timestamp
        metaField: "metadata", // Optional: A field for storing metadata (optional)
      },
    };

    // Use createCollection to create a time-series collection if not present
    await db.createCollection("SampleTimeSeriesCol", options);
    collection = db.collection("SampleTimeSeriesCol");

    console.log("✅ Time-series collection ready for inserts");
  } catch (err) {
    console.error("❌ Initial connection error:", err.message);
  }
}

async function insertDocument() {
  if (!client || !client.topology || client.topology.isDestroyed()) {
    console.warn("⚠️ Reconnecting to MongoDB...");
    await connectToMongo();
  }

  const doc = {
    timestamp: new Date(), // Time field for time-series collection
    randomValue: Math.floor(Math.random() * 100), // Your random data
    metadata: { source: "app", type: "random_data" }, // Optional: Metadata field
  };

  try {
    const result = await collection.insertOne(doc);
    console.log(
      `✅ Inserted: ${result.insertedId} | Handled by: ${
        lastInsertAddress || "unknown"
      }`
    );
  } catch (err) {
    console.error("❌ Error inserting document:", err.message);
  }
}

// Check the connection every 1 second and reconnect if necessary
setInterval(async () => {
  if (!client || !client.isConnected()) {
    console.warn("⚠️ MongoDB connection lost, reconnecting...");
    await connectToMongo();
  }
}, 500); // Check every 1 second

// Insert a new document every 5 seconds
setInterval(insertDocument, 500);

// Initial connection
connectToMongo();
