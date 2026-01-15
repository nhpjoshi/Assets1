import { callLLM } from "./llm.mjs";

export async function plan(userInput, tools) {
  const toolDescriptions = tools
    .map(
      (t) =>
        `- ${t.name}: ${t.description}\n  schema: ${JSON.stringify(
          t.inputSchema
        )}`
    )
    .join("\n");

  const prompt = `
You are an MCP-native agent planner.

User input:
"${userInput}"

Available tools:
${toolDescriptions}

Rules (VERY IMPORTANT):
- If a tool is required, respond with ONLY valid JSON.
- The JSON MUST have this exact shape:
  {
    "tool": "<tool_name>",
    "arguments": { ... }
  }
- Do NOT explain.
- Do NOT add text.
- Do NOT ask questions.
- If no tool is needed, respond with EXACTLY:
  NO_TOOL
`;

  const output = callLLM(prompt).trim();

  // Hard guardrail
  if (output === "NO_TOOL") {
    return "NO_TOOL";
  }

  // Validate JSON early
  try {
    JSON.parse(output);
    return output;
  } catch {
    // Force fail-safe
    return "NO_TOOL";
  }
}
