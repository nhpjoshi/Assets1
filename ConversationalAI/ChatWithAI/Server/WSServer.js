/**
 * server.js
 * TRUE streaming WebSocket server for Ollama
 */

const WebSocket = require("ws");
const axios = require("axios");

const PORT = 4000;
const OLLAMA_URL = "http://localhost:11434/api/chat";
const MODEL = "llama3";

const wss = new WebSocket.Server({ port: PORT });

console.log(`🧠 Streaming WS server on ws://localhost:${PORT}`);

wss.on("connection", (ws) => {
  console.log("🔌 Client connected");

  ws.on("message", async (raw) => {
    const { messages } = JSON.parse(raw.toString());

    try {
      const response = await axios.post(
        OLLAMA_URL,
        {
          model: MODEL,
          messages,
          stream: true,
        },
        { responseType: "stream" }
      );

      response.data.on("data", (chunk) => {
        const lines = chunk
          .toString()
          .split("\n")
          .filter(Boolean);

        for (const line of lines) {
          const data = JSON.parse(line);

          if (data.message?.content) {
            ws.send(
              JSON.stringify({
                type: "token",
                content: data.message.content,
              })
            );
          }

          if (data.done) {
            ws.send(JSON.stringify({ type: "done" }));
          }
        }
      });

    } catch (err) {
      console.error("❌ Ollama streaming error:", err.message);
      ws.send(JSON.stringify({ type: "error" }));
    }
  });

  ws.on("close", () => console.log("❌ Client disconnected"));
});
