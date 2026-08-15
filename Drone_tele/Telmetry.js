const fs = require("fs");
const readline = require("readline");
const { MongoClient } = require("mongodb");

// 🔧 CONFIG
const MONGO_URI = "";
const DB_NAME = "droneDB";
const COLLECTION = "telemetry";
const FILE_PATH = "./text.txt";
const BATCH_SIZE = 500;

async function run() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");

    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);

    const fileStream = fs.createReadStream(FILE_PATH);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let operations = [];
    let total = 0;

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const data = JSON.parse(line);

        const timestamp = new Date(data.timestamp);

        const doc = {
          timestamp,
          original_timestamp: data.timestamp,

          attitude: {
            pitch: data.pitch,
            roll: data.roll,
            yaw: data.yaw,
          },

          alt: data.alt,

          location: {
            type: "Point",
            coordinates: [data.lon, data.lat],
          },

          gps_fix: data.gps_fix,
          sats: data.sats,
          voltage: data.voltage,
        };

        operations.push({
          updateOne: {
            filter: {
              timestamp: timestamp,
              "location.coordinates": [data.lon, data.lat],
            },
            update: {
              $set: doc,
            },
            upsert: true,
          },
        });

        if (operations.length >= BATCH_SIZE) {
          const result = await collection.bulkWrite(operations);

          total += result.upsertedCount + result.modifiedCount;

          console.log(
            `🚀 Processed ${total} (Inserted: ${result.upsertedCount}, Updated: ${result.modifiedCount})`
          );

          operations = [];
        }

      } catch (err) {
        console.error("❌ Error parsing line:", err.message);
      }
    }

    // Final batch
    if (operations.length > 0) {
      const result = await collection.bulkWrite(operations);

      total += result.upsertedCount + result.modifiedCount;

      console.log(
        `🚀 Final Processed ${total} (Inserted: ${result.upsertedCount}, Updated: ${result.modifiedCount})`
      );
    }

    // 📍 Indexes (IMPORTANT)
    await collection.createIndex({ timestamp: 1 });
    await collection.createIndex({ location: "2dsphere" });

    // 🔒 Optional: enforce uniqueness (recommended)
    await collection.createIndex(
      { timestamp: 1, "location.coordinates": 1 },
      { unique: true }
    );

    console.log("✅ Import complete with UPSERT + Indexes!");

  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await client.close();
    console.log("🔌 Connection closed");
  }
}

run();
