/**
 * client.js
 * CLI client that talks to server.js over WebSocket
 */

const WebSocket = require("ws");
const readline = require("readline");

const WS_URL = "ws://localhost:4000";
const MODEL = "llama3";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Conversation history as Ollama expects
const messages = [];

const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  console.log("🧠 Connected to LLaMA (via WebSocket)");
  console.log("Type your message (or 'exit' to quit)\n");
  promptUser();
});

ws.on("message", (raw) => {
  let data;

  try {
    data = JSON.parse(raw.toString());
  } catch (err) {
    console.error("Invalid response from server");
    promptUser();
    return;
  }

  if (data.error) {
    console.error("❌ Error:", data.error);
    promptUser();
    return;
  }

  console.log("\nLLaMA:", data.response, "\n");

  messages.push({
    role: "assistant",
    content: data.response,
  });

  promptUser();
});

ws.on("close", () => {
  console.log("🔌 Disconnected from server");
  rl.close();
});

ws.on("error", (err) => {
  console.error("WebSocket error:", err.message);
});

function promptUser() {
  rl.question("You: ", (input) => {
    if (input.toLowerCase() === "exit") {
      ws.close();
      return;
    }

    messages.push({
      role: "user",
      content: input,
    });

    ws.send(
      JSON.stringify({
        model: MODEL,
        messages,
      })
    );
  });
}
