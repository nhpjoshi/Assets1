/**
 * agent.mjs
 * MCP-native Agent using LLaMA (Ollama)
 * - Strict planner contract
 * - Deterministic tool calling
 * - MCP-safe
 */

import readline from "readline";
import "dotenv/config";
import { MCPClient } from "./mcp-client.mjs";
import { plan } from "./planner.mjs";
import { callLLM } from "./llm.mjs";

/* =====================================================
   VALIDATE REQUIRED ENV VARS
===================================================== */

const REQUIRED_ENVS = [
  "ATLAS_PUBLIC_KEY",
  "ATLAS_PRIVATE_KEY",
  "ATLAS_PROJECT_ID",
];

for (const env of REQUIRED_ENVS) {
  if (!process.env[env]) {
    console.error(`[FATAL] Missing environment variable: ${env}`);
    process.exit(1);
  }
}

/* =====================================================
   START MCP CLIENT (spawns MCP server)
===================================================== */

console.log("[BOOT] Starting MCP-native agent…");

const mcp = new MCPClient("node", [
  "/Users/nitish.joshi/Documents/GitHub/mongodb-atlas-mcp/test-atlas.mjs",
]);

/* =====================================================
   DISCOVER TOOLS
===================================================== */

let tools = [];

try {
  const toolList = await mcp.listTools();
  tools = toolList?.tools ?? [];

  if (tools.length === 0) {
    throw new Error("No tools discovered from MCP server");
  }

  console.log(
    `[BOOT] Discovered ${tools.length} MCP tools:`,
    tools.map((t) => t.name).join(", ")
  );
} catch (err) {
  console.error("[FATAL] Failed to list MCP tools:", err);
  process.exit(1);
}

/* =====================================================
   CLI SETUP
===================================================== */

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log("\n🧠 MCP Native Agent (LLaMA)");
console.log("Ask a question (Ctrl+C to exit)\n");

/* =====================================================
   MAIN AGENT LOOP (STRICT + SAFE)
===================================================== */

rl.on("line", async (input) => {
  if (!input.trim()) return;

  console.log(`\n[USER] ${input}`);

  try {
    /* -----------------------------------------------
       1️⃣ Planner decision (STRICT)
    ------------------------------------------------ */

    const decision = await plan(input, tools);

    /* -----------------------------------------------
       2️⃣ NO TOOL PATH
    ------------------------------------------------ */

    if (decision === "NO_TOOL") {
      console.log("[AGENT] Planner decided: NO_TOOL");

      const directAnswer = callLLM(`
User question:
"${input}"

Answer directly.
Be concise, clear, and helpful.
`);

      console.log("\n", directAnswer, "\n");
      return;
    }

    /* -----------------------------------------------
       3️⃣ TOOL CALL PATH
    ------------------------------------------------ */

    let parsed;
    try {
      parsed = JSON.parse(decision);
    } catch (err) {
      console.error("[ERROR] Planner returned invalid JSON:", decision);
      return;
    }

    if (!parsed.tool || typeof parsed.tool !== "string") {
      console.error("[ERROR] Planner JSON missing tool name:", parsed);
      return;
    }

    console.log(
      `[AGENT] Calling tool '${parsed.tool}' with args:`,
      JSON.stringify(parsed.arguments ?? {})
    );

    /* -----------------------------------------------
       4️⃣ CALL MCP TOOL
    ------------------------------------------------ */

    const result = await mcp.callTool(
      parsed.tool,
      parsed.arguments ?? {}
    );

    const toolText =
      result?.content?.[0]?.text ??
      "Tool returned no usable output";

    /* -----------------------------------------------
       5️⃣ EXPLAIN TOOL RESULT
    ------------------------------------------------ */

    const finalAnswer = callLLM(`
User question:
"${input}"

Tool used:
${parsed.tool}

Tool result:
${toolText}

Explain the result clearly.
Highlight key insights.
Give recommendations if applicable.
`);

    console.log("\n", finalAnswer, "\n");
  } catch (err) {
    console.error("[ERROR] Agent loop failed:", err);
    console.log("\nSomething went wrong. Please try again.\n");
  }
});
