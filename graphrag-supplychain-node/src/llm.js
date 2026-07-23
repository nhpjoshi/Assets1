/**
 * Generates the final answer from retrieved GraphRAG context.
 *
 * Provider priority:
 *   1. OLLAMA_MODEL set    -> calls a local Llama model via Ollama's REST API
 *   2. ANTHROPIC_API_KEY set -> calls Claude
 *   3. neither set           -> returns the structured context directly
 *      (extractive fallback, so the demo is fully runnable with no LLM at all)
 */

import * as config from "./config.js";

const SYSTEM_PROMPT =
  "You are a supply chain risk analyst. Answer the user's question using ONLY " +
  "the entities and relationships provided in the context below. Cite specific " +
  "entity names and explain the relationship chain that supports your answer " +
  "(e.g. 'Supplier X supplies Component Y, which is used in Product Z'). If the " +
  "context doesn't contain enough information to answer, say so explicitly.";

export async function generateAnswer(result) {
  if (config.OLLAMA_MODEL) {
    return generateWithOllama(result);
  }
  if (config.ANTHROPIC_API_KEY) {
    return generateWithAnthropic(result);
  }
  return extractiveFallback(result);
}

async function generateWithOllama(result) {
  const userContent = `CONTEXT:\n${result.contextText}\n\nQUESTION: ${result.question}`;

  let response;
  try {
    response = await fetch(`${config.OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.OLLAMA_MODEL,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });
  } catch (err) {
    throw new Error(
      `Could not reach Ollama at ${config.OLLAMA_BASE_URL} (${err.message}). ` +
        "Make sure Ollama is running (`ollama serve`)."
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Ollama request to ${config.OLLAMA_BASE_URL} failed (${response.status}): ${body}\n` +
        "Make sure Ollama is running (`ollama serve`) and the model is pulled " +
        `(\`ollama pull ${config.OLLAMA_MODEL}\`).`
    );
  }

  const data = await response.json();
  return data.message?.content ?? "";
}

async function generateWithAnthropic(result) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `CONTEXT:\n${result.contextText}\n\nQUESTION: ${result.question}`,
      },
    ],
  });

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function extractiveFallback(result) {
  const header =
    "[No LLM configured - showing the retrieved graph context directly. " +
    "Set OLLAMA_MODEL (for a local Llama model) or ANTHROPIC_API_KEY in .env " +
    "to have an LLM synthesize a natural-language answer from this context.]\n";
  return header + "\n" + result.contextText;
}
