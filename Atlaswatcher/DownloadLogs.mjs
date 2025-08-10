// download-atlas-log.mjs
import DigestFetch from "digest-fetch";
import { createWriteStream } from "fs";
import { pipeline } from "stream";
import { promisify } from "util";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const streamPipeline = promisify(pipeline);

// ---- Prefer env vars; fall back to provided values for convenience ----
// export ATLAS_PUBLIC_KEY="jyvaogjf"
// export ATLAS_PRIVATE_KEY="5d2cc776-f862-4b9b-b3b3-a389553352b2"
// export ATLAS_PROJECT_ID="65afa10de7cfa50a87ebf807"
// export ATLAS_HOST="atlas-h2icea-shard-00-00.n2msm.mongodb.net"
const PUBLIC_KEY = process.env.ATLAS_PUBLIC_KEY || "jyvaogjf"; //<Public-key>
const PRIVATE_KEY =
  process.env.ATLAS_PRIVATE_KEY || "5d2cc776-f862-4b9b-b3b3-a389553352b2"; //<Private-key>
const PROJECT_ID = process.env.ATLAS_PROJECT_ID || "65afa10de7cfa50a87ebf807"; //<Project-ID>
const HOST =
  process.env.ATLAS_HOST || "atlas-h2icea-shard-00-00.n2msm.mongodb.net"; // <Cluster-hostname>

// Menu of supported log types -> filenames expected by Atlas
const LOG_TYPES = {
  mongodb: "mongodb.gz",
  mongos: "mongos.gz",
  "mongodb-audit-log": "mongodb-audit-log.gz",
  "mongos-audit-log": "mongos-audit-log.gz",
};

// Optional: accept CLI arg to skip prompt: node download-atlas-log.mjs mongodb
const argType = (process.argv[2] || "").trim();

async function chooseType() {
  if (LOG_TYPES[argType]) return argType;

  const rl = readline.createInterface({ input, output });
  try {
    console.log("Select log type:");
    const keys = Object.keys(LOG_TYPES);
    keys.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));

    const answer = await rl.question("Enter number (1-4) or type name: ");
    const num = Number(answer);
    if (Number.isInteger(num) && num >= 1 && num <= keys.length)
      return keys[num - 1];

    const typed = answer.trim();
    if (LOG_TYPES[typed]) return typed;

    throw new Error("Invalid selection.");
  } finally {
    rl.close();
  }
}

async function main() {
  const type = await chooseType();
  const fileName = LOG_TYPES[type];

  // Build the Atlas Logs API URL for the chosen file
  const url = `https://cloud.mongodb.com/api/atlas/v2/groups/${PROJECT_ID}/clusters/${HOST}/logs/${fileName}`;

  const client = new DigestFetch(PUBLIC_KEY, PRIVATE_KEY);

  const res = await client.fetch(url, {
    method: "GET",
    headers: {
      // Important: use versioned +gzip accept; don't send X-MongoDB-API-Version header here
      Accept: "application/vnd.atlas.2023-01-01+gzip",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}\n${text}`);
  }

  // Name output file with type + timestamp
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = `${type}-${ts}.gz`;

  await streamPipeline(res.body, createWriteStream(outFile));
  console.log(`✅ Downloaded ${type} logs → ${outFile}`);
}

main().catch((err) => {
  console.error("❌ Download failed:", err.message);
  process.exit(1);
});
