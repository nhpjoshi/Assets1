// Basecode.mjs
import DigestClient from "digest-fetch";

const publicKey = "jyvaogjf";
const privateKey = "5d2cc776-f862-4b9b-b3b3-a389553352b2";
const groupId = "65afa10de7cfa50a87ebf807";
const ATLAS_ACCEPT = "application/vnd.atlas.2025-03-12+json"; // required API version

const client = new DigestClient(publicKey, privateKey);

async function okJson(res) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status} ${res.statusText}${text ? ` – ${text}` : ""}`
    );
  }
  return res.json();
}

async function getProcesses() {
  const url = `https://cloud.mongodb.com/api/atlas/v2/groups/${groupId}/processes`;
  const res = await client.fetch(url, { headers: { Accept: ATLAS_ACCEPT } });
  const data = await okJson(res);
  return data.results ?? [];
}

async function getMeasurements(
  processName,
  { granularity = "PT1H", period = "PT1H" } = {}
) {
  const encoded = encodeURIComponent(processName);
  const url =
    `https://cloud.mongodb.com/api/atlas/v2/groups/${groupId}/processes/${encoded}/measurements` +
    `?granularity=${granularity}&period=${period}`;
  const res = await client.fetch(url, { headers: { Accept: ATLAS_ACCEPT } });
  return okJson(res);
}

(async () => {
  try {
    const processes = await getProcesses();
    console.log(`Found ${processes.length} processes`);

    const target = "atlas-h2icea-shard-00-00.n2msm.mongodb.net:27017";
    const measurements = await getMeasurements(target);

    for (const m of measurements.measurements ?? []) {
      const nonEmpty = (m.dataPoints || []).filter((dp) => dp.value != null);
      if (nonEmpty.length > 0) {
        const last = nonEmpty[nonEmpty.length - 1];
        console.log(
          `${m.name} (${m.units}) -> ${last.value} @ ${last.timestamp}`
        );
      }
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
})();
