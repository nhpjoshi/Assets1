/**
 * test-atlas.mjs
 * MongoDB Atlas MCP Server
 * - Schema-safe
 * - Inspector-safe
 * - Claude-safe
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

async function fetchJson(url) {
  const res = await client.fetch(url, {
    headers: { Accept: ATLAS_ACCEPT },
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
