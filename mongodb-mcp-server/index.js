import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Create MCP server
const server = new Server(
  {
    name: "mongodb-metrics-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * 1️⃣ tools/list — tell Claude what tools exist
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_cluster_metrics",
        description: "Fetch basic MongoDB cluster performance metrics",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string" },
            clusterName: { type: "string" },
          },
          required: ["projectId", "clusterName"],
        },
      },
    ],
  };
});

/**
 * 2️⃣ tools/call — execute the tool
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_cluster_metrics") {
    const { projectId, clusterName } = args;

    // Mock metrics (replace later with Atlas API)
    const metrics = {
      cpu: { avg: 72, p95: 91 },
      memory: { usedPercent: 68 },
      disk: { usedPercent: 83 },
      replicationLagMs: 420,
      connections: 1800,
    };

    return {
      content: [
        {
          type: "json",
          json: metrics,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
