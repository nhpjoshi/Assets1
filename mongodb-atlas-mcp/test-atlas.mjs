/**
 * test-atlas.mjs
 * MongoDB Atlas MCP Server
 * - Schema-safe
 * - Inspector-safe
 * - Claude-safe
 * - Now with cluster creation
 */

import DigestClient from "digest-fetch";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

/* =====================================================
   PROCESS SAFETY GUARDS (REQUIRED FOR MCP)
===================================================== */

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
});

// Prevent Node process exit (MCP requires long-lived process)
setInterval(() => {}, 60_000);

/* =====================================================
   ATLAS CONFIGURATION
===================================================== */

// ⚠️ Move to env vars for real use
const ATLAS_PUBLIC_KEY = "jpbyrldz";
const ATLAS_PRIVATE_KEY = "cf03afce-f8be-4e95-b5b0-368d635e9b21";
const GROUP_ID = "65afa10de7cfa50a87ebf807";

// Stable, widely supported Atlas API version
const ATLAS_ACCEPT = "application/vnd.atlas.2023-02-01+json";

const client = new DigestClient(
  ATLAS_PUBLIC_KEY,
  ATLAS_PRIVATE_KEY
);

/* =====================================================
   SAFE UTILITIES
===================================================== */

// MCP requires content.text to ALWAYS be a string
function safeText(value) {
  try {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return `Serialization error: ${err.message}`;
  }
}

async function fetchJson(url, options = {}) {
  const res = await client.fetch(url, {
    headers: { 
      Accept: ATLAS_ACCEPT,
      "Content-Type": "application/json",
      ...options.headers
    },
    ...options,
  });

  const body = await res.text().catch(() => "");

  console.error("[DEBUG] Atlas response:", res.status, res.statusText);

  if (!res.ok) {
    return {
      error: true,
      status: res.status,
      body,
    };
  }

  try {
    return JSON.parse(body);
  } catch {
    return {
      error: true,
      body,
    };
  }
}

/* =====================================================
   ATLAS DATA FUNCTIONS
===================================================== */

async function getProcesses() {
  console.error("[INFO] Fetching Atlas processes");

  const url = `https://cloud.mongodb.com/api/atlas/v2/groups/${GROUP_ID}/processes`;
  const data = await fetchJson(url);

  if (data.error) {
    return { error: "Failed to fetch processes", details: data };
  }

  return data.results ?? [];
}

async function getMeasurements(processName, granularity, period) {
  console.error(`[INFO] Fetching metrics for ${processName}`);

  const encoded = encodeURIComponent(processName);
  const url =
    `https://cloud.mongodb.com/api/atlas/v2/groups/${GROUP_ID}/processes/${encoded}/measurements` +
    `?granularity=${granularity}&period=${period}`;

  const data = await fetchJson(url);

  if (data.error) {
    return { error: "Failed to fetch measurements", details: data };
  }

  return data.measurements ?? [];
}

async function createCluster(clusterConfig) {
  console.error("[INFO] Creating new Atlas cluster");

  const url = `https://cloud.mongodb.com/api/atlas/v2/groups/${GROUP_ID}/clusters`;
  
  const data = await fetchJson(url, {
    method: "POST",
    body: JSON.stringify(clusterConfig),
  });

  if (data.error) {
    return { error: "Failed to create cluster", details: data };
  }

  return data;
}

/* =====================================================
   METRIC UTILIZATION SUMMARY (KEY RECOMMENDATION)
===================================================== */

function summarizeUtilization(measurements) {
  const summary = {};

  for (const metric of measurements || []) {
    const points = (metric.dataPoints || []).filter(
      (p) => p.value !== null && p.value !== undefined
    );

    if (points.length === 0) continue;

    summary[metric.name] = {
      unit: metric.units,
      latest: points[points.length - 1].value,
    };
  }

  return summary;
}

/* =====================================================
   MCP SERVER
===================================================== */

const server = new Server(
  {
    name: "mongodb-atlas-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/* =====================================================
   tools/list
===================================================== */

server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error("[INFO] Agent connected (tools/list)");

  return {
    tools: [
      {
        name: "list_atlas_processes",
        description: "List MongoDB Atlas processes in the project",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_process_utilization",
        description:
          "Get CPU, memory, and connection utilization summary for a MongoDB Atlas process",
        inputSchema: {
          type: "object",
          properties: {
            processName: { type: "string" },
            granularity: { type: "string", default: "PT1H" },
            period: { type: "string", default: "PT1H" },
          },
          required: ["processName"],
        },
      },
      {
        name: "create_cluster",
        description:
          "Create a new MongoDB Atlas cluster. Requires cluster configuration including name, provider, region, and instance size.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the cluster (must be unique in project)",
            },
            clusterType: {
              type: "string",
              description: "Type of cluster (REPLICASET, SHARDED, GEOSHARDED)",
              default: "REPLICASET",
            },
            providerName: {
              type: "string",
              description: "Cloud provider (AWS, GCP, AZURE, TENANT)",
              default: "AWS",
            },
            regionName: {
              type: "string",
              description: "Cloud provider region (e.g., US_EAST_1, EU_WEST_1)",
              default: "US_EAST_1",
            },
            instanceSizeName: {
              type: "string",
              description: "Instance size (e.g., M10, M20, M30, M40)",
              default: "M10",
            },
            mongoDBMajorVersion: {
              type: "string",
              description: "MongoDB version (e.g., 7.0, 6.0)",
              default: "7.0",
            },
            diskSizeGB: {
              type: "number",
              description: "Disk size in GB (minimum varies by instance size)",
            },
            backupEnabled: {
              type: "boolean",
              description: "Enable automated backups",
              default: true,
            },
            autoScalingDiskGBEnabled: {
              type: "boolean",
              description: "Enable disk auto-scaling",
              default: true,
            },
            autoScalingComputeEnabled: {
              type: "boolean",
              description: "Enable compute auto-scaling",
              default: false,
            },
          },
          required: ["name"],
        },
      },
    ],
  };
});

/* =====================================================
   tools/call (100% MCP-SAFE)
===================================================== */

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request?.params?.name;
  const args = request?.params?.arguments ?? {};

  console.error("[INFO] Tool called:", name);

  try {
    if (name === "list_atlas_processes") {
      const processes = await getProcesses();

      return {
        content: [
          {
            type: "text",
            text: safeText(
              processes.map((p) => ({
                hostname: p.hostname,
                port: p.port,
                type: p.typeName,
                replicaSet: p.replicaSetName,
              }))
            ),
          },
        ],
      };
    }

    if (name === "get_process_utilization") {
      const processName = args.processName;

      if (!processName) {
        return {
          content: [
            {
              type: "text",
              text: "Error: processName is required",
            },
          ],
        };
      }

      const measurements = await getMeasurements(
        processName,
        args.granularity ?? "PT1H",
        args.period ?? "PT1H"
      );

      const utilization = summarizeUtilization(measurements);

      return {
        content: [
          {
            type: "text",
            text: safeText(utilization),
          },
        ],
      };
    }

    if (name === "create_cluster") {
      if (!args.name) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Cluster name is required",
            },
          ],
        };
      }

      // Build cluster configuration
      const clusterConfig = {
        name: args.name,
        clusterType: args.clusterType ?? "REPLICASET",
        providerSettings: {
          providerName: args.providerName ?? "AWS",
          regionName: args.regionName ?? "US_EAST_1",
          instanceSizeName: args.instanceSizeName ?? "M10",
        },
        mongoDBMajorVersion: args.mongoDBMajorVersion ?? "7.0",
        backupEnabled: args.backupEnabled ?? true,
        autoScaling: {
          diskGBEnabled: args.autoScalingDiskGBEnabled ?? true,
          compute: {
            enabled: args.autoScalingComputeEnabled ?? false,
          },
        },
      };

      // Add optional disk size if specified
      if (args.diskSizeGB) {
        clusterConfig.diskSizeGB = args.diskSizeGB;
      }

      const result = await createCluster(clusterConfig);

      if (result.error) {
        return {
          content: [
            {
              type: "text",
              text: safeText({
                error: "Failed to create cluster",
                details: result,
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: safeText({
              success: true,
              cluster: {
                name: result.name,
                id: result.id,
                state: result.stateName,
                mongoDBVersion: result.mongoDBVersion,
                provider: result.providerSettings?.providerName,
                region: result.providerSettings?.regionName,
                instanceSize: result.providerSettings?.instanceSizeName,
                connectionStrings: result.connectionStrings,
              },
            }),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Unknown tool requested: ${name}`,
        },
      ],
    };
  } catch (err) {
    console.error("[ERROR] Tool execution failed:", err);

    return {
      content: [
        {
          type: "text",
          text: `Tool execution error: ${err.message}`,
        },
      ],
    };
  }
});

/* =====================================================
   START MCP
===================================================== */

console.error("[BOOT] Starting MongoDB Atlas MCP server");
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[BOOT] MCP server connected and waiting");