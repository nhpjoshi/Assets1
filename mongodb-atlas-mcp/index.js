import DigestClient from "digest-fetch";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

/* ============================
   Atlas configuration
============================ */
const publicKey = "jpbyrldz";
const privateKey = "cf03afce-f8be-4e95-b5b0-368d635e9b21";
const groupId = "65afa10de7cfa50a87ebf807";
const ATLAS_ACCEPT = "application/vnd.atlas.2023-02-01+json";


const client = new DigestClient(publicKey, privateKey);

/* ============================
   Helpers
============================ */
async function okJson(res) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      `[ERROR] Atlas API failed: ${res.status} ${res.statusText}`
    );
    throw new Error(
      `HTTP ${res.status} ${res.statusText}${text ? ` – ${text}` : ""}`
    );
  }
  return res.json();
}

async function getProcesses() {
  console.error("[INFO] Fetching Atlas processes");
  const url = `https://cloud.mongodb.com/api/atlas/v2/groups/${groupId}/processes`;
  console.error("[DEBUG] Calling Atlas processes API");
  const res = await client.fetch(url, { headers: { Accept: ATLAS_ACCEPT } });
  const data = await okJson(res);
  return data.results ?? [];
  

}

async function getMeasurements(
  processName,
  { granularity = "PT1H", period = "PT1H" } = {}
) {
  console.error(
    `[INFO] Fetching measurements for process=${processName}, granularity=${granularity}, period=${period}`
  );

  const encoded = encodeURIComponent(processName);
  const url =
    `https://cloud.mongodb.com/api/atlas/v2/groups/${groupId}/processes/${encoded}/measurements` +
    `?granularity=${granularity}&period=${period}`;

  const res = await client.fetch(url, { headers: { Accept: ATLAS_ACCEPT } });
  return okJson(res);
}

/* ============================
   MCP Server
============================ */
const server = new Server(
  {
    name: "mongodb-atlas-metrics-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/* ============================
   tools/list
============================ */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error("[INFO] Agent connected – tools/list requested");

  return {
    tools: [
      {
        name: "list_atlas_processes",
        description: "List MongoDB Atlas processes for a project",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_process_measurements",
        description:
          "Get metrics for a MongoDB Atlas process (CPU, memory, connections, etc.)",
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

/* ============================
   tools/call
============================ */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  console.error(`[INFO] Tool called: ${name}`);
  console.error(`[DEBUG] Arguments: ${JSON.stringify(args)}`);

  try {
    if (name === "list_atlas_processes") {
      const processes = await getProcesses();

      return {
        content: [
          {
            type: "json",
            json: processes.map((p) => ({
              hostname: p.hostname,
              port: p.port,
              typeName: p.typeName,
              replicaSetName: p.replicaSetName,
            })),
          },
        ],
      };
    }

    if (name === "get_process_measurements") {
      const {
        processName,
        granularity = "PT1H",
        period = "PT1H",
      } = args;

      const measurements = await getMeasurements(processName, {
        granularity,
        period,
      });

      return {
        content: [
          {
            type: "json",
            json: measurements.measurements ?? [],
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    console.error(`[ERROR] Tool execution failed: ${err.message}`);
    throw err;
  }
});

/* ============================
   Start MCP
============================ */
const transport = new StdioServerTransport();
console.error("[INFO] Starting MongoDB Atlas MCP server...");
await server.connect(transport);
console.error("[INFO] MCP server started and waiting for agent...");
