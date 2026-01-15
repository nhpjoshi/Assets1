/**
 * WSServer.js
 * MCP-aware WebSocket Agent
 */

import { WebSocketServer } from "ws";
import axios from "axios";
import { MCPClient } from "./mcpClient.js";

/* ================= CONFIG ================= */

const PORT = 4000;
const OLLAMA_URL = "http://localhost:11434/api/chat";
const MODEL = "llama3";

const MCP_SERVER_PATH =
  "/Users/nitish.joshi/Documents/GitHub/Assets1/mongodb-atlas-mcp/test-atlas.mjs";

/* ================= TOOL PROMPT ================= */

function toolSelectionPrompt(userInput, tools) {
  return `
You are an AI agent with access to deterministic tools.

Available tools:
${JSON.stringify(tools, null, 2)}

Rules:
- If a tool is required, respond ONLY in JSON:
  { "tool": "<tool_name>", "arguments": { ... } }
- If no tool is required, respond normally.

User question:
"${userInput}"
`;
}

/* ================= STREAM OLLAMA ================= */

async function streamOllama(ws, messages) {
  const response = await axios.post(
    OLLAMA_URL,
    { model: MODEL, messages, stream: true },
    { responseType: "stream" }
  );

  response.data.on("data", (chunk) => {
    const lines = chunk.toString().split("\n").filter(Boolean);

    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      if (parsed.message?.content) {
        ws.send(JSON.stringify({
          type: "token",
          content: parsed.message.content,
        }));
      }

      if (parsed.done === true) {
        ws.send(JSON.stringify({ type: "done" }));
      }
    }
  });
}

/* ================= WS SERVER ================= */

function startWebSocketServer(mcp, toolRegistry) {
  const wss = new WebSocketServer({ port: PORT });

  console.log(`🧠 WS Agent running on ws://localhost:${PORT}`);

  wss.on("connection", (ws) => {
    console.log("🔌 Client connected");

    ws.on("message", async (raw) => {
      try {
        const { messages } = JSON.parse(raw.toString());
        const userInput = messages.at(-1)?.content;

        console.log("[AGENT] User input:", userInput);

        /* 1️⃣ Ask LLM if tool needed */
        const decisionResponse = await axios.post(
          OLLAMA_URL,
          {
            model: MODEL,
            messages: [{
              role: "user",
              content: toolSelectionPrompt(
                userInput,
                toolRegistry.tools
              ),
            }],
            stream: false,
          }
        );

        const decisionText =
          decisionResponse.data.message?.content ??
          decisionResponse.data.response ??
          "";

        let parsed;
        try {
          parsed = JSON.parse(decisionText);
        } catch {
          await streamOllama(ws, messages);
          return;
        }

        /* 2️⃣ Tool execution */
        if (parsed.tool) {
          console.log("[AGENT] Tool selected:", parsed.tool);

          const toolResult = await mcp.callTool(
            parsed.tool,
            parsed.arguments || {}
          );

          const finalMessages = [{
            role: "user",
            content: `
Tool result:
${JSON.stringify(toolResult, null, 2)}

Explain clearly and give recommendations.
`,
          }];

          await streamOllama(ws, finalMessages);
        }
      } catch (err) {
        console.error("[ERROR] Agent failure:", err);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
        ws.send(JSON.stringify({ type: "done" }));
      }
    });

    ws.on("close", () => console.log("❌ Client disconnected"));
  });
}

/* ================= BOOTSTRAP ================= */

async function main() {
  console.log("[BOOT] Starting MCP client...");

  const mcp = new MCPClient("node", [MCP_SERVER_PATH]);
  const toolRegistry = await mcp.listTools();

  console.log(
    "[BOOT] MCP tools loaded:",
    toolRegistry.tools.map(t => t.name)
  );

  startWebSocketServer(mcp, toolRegistry);
}

main().catch(err => {
  console.error("[FATAL] Startup failed:", err);
  process.exit(1);
});
