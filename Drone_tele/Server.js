const express = require("express");
const { MongoClient } = require("mongodb");
const cors = require("cors");

const app = express();
app.use(cors());

const MONGO_URI =
  "";

const client = new MongoClient(MONGO_URI);

let collection;

async function init() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");
    const db = client.db("drone_telemetry");
    collection = db.collection("flight_data");
    app.listen(3000, () => {
      console.log("🚀 API running on http://localhost:3000");
    });
  } catch (err) {
    console.error("❌ DB Error:", err);
  }
}

init();

//
// PATH API
//
app.get("/path", async (req, res) => {
  try {
    const { start, end } = req.query;

    const query = {
      "metadata.gps_fix": { $regex: /(RTK|3D)/i },
      lat: { $ne: 0 },
      lon: { $ne: 0 },
    };

    if (start && end) {
      query.timestamp = {
        $gte: new Date(start),
        $lte: new Date(end),
      };
    }

    const data = await collection
      .find(query)
      .project({
        _id: 0,
        timestamp: 1,
        lat: 1,
        lon: 1,
        alt: 1,
        voltage: 1,
        pitch: 1,
        roll: 1,
        yaw: 1,
        sats: 1,
        metadata: 1,
      })
      .sort({ timestamp: 1 })
      .limit(10000)
      .toArray();

    console.log(`📊 Returned ${data.length} records`);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

//
// DISTANCE API
// Called ONCE after flight loads — returns total path length + max displacement.
// Realtime per-frame distance is now computed client-side in App.js (no DB needed).
//
app.get("/distance", async (req, res) => {
  try {
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "start and end are required" });
    }

    const dateFilter = {
      timestamp: {
        $gte: new Date(start),
        $lte: new Date(end),
      },
    };

    // Step 1: resolve launch pad = first GPS point of the flight window
    const firstPoint = await collection
      .find({
        ...dateFilter,
        "metadata.gps_fix": { $regex: /(RTK|3D)/i },
        lat: { $ne: 0 },
        lon: { $ne: 0 },
      })
      .sort({ timestamp: 1 })
      .limit(1)
      .toArray();

    if (!firstPoint.length) {
      return res.json({
        totalPathLength_m: 0,
        totalPathLength_km: 0,
        maxDisplacement_m: 0,
        launchPad: null,
      });
    }

    const { lat: launchLat, lon: launchLon } = firstPoint[0];
    const LAUNCH_PAD = [launchLon, launchLat]; // GeoJSON [lon, lat]

    // Step 2: total path length via Haversine step-by-step
    const pathResult = await collection
      .aggregate([
        { $match: { ...dateFilter, lat: { $ne: 0 }, lon: { $ne: 0 } } },
        { $sort: { timestamp: 1 } },
        {
          $setWindowFields: {
            sortBy: { timestamp: 1 },
            output: {
              next_lon: { $shift: { output: "$lon", by: 1 } },
              next_lat: { $shift: { output: "$lat", by: 1 } },
            },
          },
        },
        {
          $addFields: {
            step_m: {
              $function: {
                body: `function(lat1, lon1, lat2, lon2) {
                  if (lat2 == null || lon2 == null) return 0;
                  const R = 6371000;
                  const toRad = d => d * Math.PI / 180;
                  const dLat = toRad(lat2 - lat1);
                  const dLon = toRad(lon2 - lon1);
                  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
                    Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*
                    Math.sin(dLon/2)*Math.sin(dLon/2);
                  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                }`,
                args: ["$lat", "$lon", "$next_lat", "$next_lon"],
                lang: "js",
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            totalPathLength_m: { $sum: "$step_m" },
          },
        },
      ])
      .toArray();

    // Step 3: max displacement from launch pad via $geoNear
    // ✅ key: required for time-series; $match after $geoNear (no query: allowed)
    const displacementResult = await collection
      .aggregate([
        {
          $geoNear: {
            near: { type: "Point", coordinates: LAUNCH_PAD },
            distanceField: "dist_m",
            key: "location",
            spherical: true,
          },
        },
        { $match: dateFilter },
        {
          $group: {
            _id: null,
            maxDisplacement_m: { $max: "$dist_m" },
          },
        },
      ])
      .toArray();

    const totalPathLength_m = pathResult[0]?.totalPathLength_m || 0;
    const maxDisplacement_m = displacementResult[0]?.maxDisplacement_m || 0;

    res.json({
      totalPathLength_m:  Math.round(totalPathLength_m * 100) / 100,
      totalPathLength_km: Math.round((totalPathLength_m / 1000) * 10000) / 10000,
      maxDisplacement_m:  Math.round(maxDisplacement_m * 100) / 100,
      launchPad: { lat: launchLat, lon: launchLon },
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

//
// LATEST POSITION API
//
app.get("/latest", async (req, res) => {
  try {
    const latest = await collection
      .find({ "metadata.gps_fix": { $regex: /(RTK|3D)/i } })
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();

    res.json(latest[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

//
// HEALTH CHECK
//
app.get("/health", async (req, res) => {
  try {
    const count = await collection.countDocuments();
    res.json({ status: "ok", collection: "flight_data", documents: count });
  } catch (err) {
    res.status(500).json({ status: "error" });
  }
});
