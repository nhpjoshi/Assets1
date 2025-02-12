const express = require("express");
const { MongoClient } = require("mongodb");
const cors = require("cors");

const app = express();
const port = 5022;

app.use(cors());
app.use(express.json());

const uri = "mongodb://localhost:27017/?replicaSet=myReplicaSet&directConnection=true";
const client = new MongoClient(uri);

let session;
let logs = [];

async function connectDB() {
  await client.connect();
  console.log("Connected to MongoDB");
}
connectDB();

const db = client.db("testDB");
const collection = db.collection("accounts");



app.post("/initiate-transaction", async (req, res) => {
    try {
      session = client.startSession();
      session.startTransaction({
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" }
      });
  
      logs.push("Transaction Started");
  
      // Insert document if it doesn't exist
      const existing = await collection.findOne({ _id: 1 });
      if (!existing) {
        await collection.insertOne({ _id: 1, name: "Alice", balance: 100 }, { writeConcern: { w: "majority" } });
        logs.push("Inserted initial document with Balance 100");
      }
  
      // Fetch Primary Data inside transaction
      const primaryData = await collection.findOne({ _id: 1 }, { session });
  
      res.json({ message: "Transaction initiated", logs, primaryData });
    } catch (err) {
      logs.push(`Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });
  

  app.post("/update-to-200", async (req, res) => {
    try {
      if (!session) {
        return res.status(400).json({ error: "No active transaction" });
      }
  
      await collection.updateOne(
        { _id: 1 },
        { $set: { balance: 200 } },
        { session, writeConcern: { w: "majority" } }
      );
  
      logs.push("Updated balance to 200 within transaction");
  
      // Fetch updated primary data within the transaction
      const primaryData = await collection.findOne({ _id: 1 }, { session });
  
      res.json({ message: "Balance updated to 200", logs, primaryData });
    } catch (err) {
      logs.push(`Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });
  
  
  app.post("/commit-transaction", async (req, res) => {
    try {
      if (!session) {
        return res.status(400).json({ error: "No active transaction" });
      }
  
      await session.commitTransaction();
      logs.push("Transaction Committed. Changes replicated.");
  
      session.endSession();
      session = null;
  
      // Fetch secondary data after replication
      const secondaryClient = new MongoClient(uri, { readPreference: "secondary" });
      await secondaryClient.connect();
      const secondaryCollection = secondaryClient.db("testDB").collection("accounts");
      const secondaryData = await secondaryCollection.findOne({ _id: 1 });
  
      res.json({ message: "Transaction committed", logs, secondaryData });
    } catch (err) {
      logs.push(`Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });
  

app.get("/logs", (req, res) => {
  res.json({ logs });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
