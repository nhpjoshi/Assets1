// Import required modules
const WebSocket = require("ws");
const axios = require("axios");

// Set up WebSocket server on port 3000
const wss = new WebSocket.Server({ port: 4000 });

wss.on("connection", (ws) => {
  console.log("Client connected");

  // Handle incoming WebSocket messages
  ws.on("message", async (message) => {
    try {
      // Parse the JSON message from the client
      const requestData = JSON.parse(message);
      const { model, prompt, stream } = requestData;

      // Send request to Llama's API with model, prompt, and stream
      const response = await axios.post(
        "http://host.docker.internal:11434/api/generate",
        {
          model: model || "llama3:8b", // default model if not specified
          prompt: prompt,
          stream: stream || false, // default stream to false if not specified
        }
      );

      // Send the Llama response back to the WebSocket client
      ws.send(JSON.stringify(response.data));
    } catch (error) {
      console.error("Error communicating with Llama:", error);
      ws.send(JSON.stringify({ error: "Error communicating with Llama" }));
    }
  });

  // Handle WebSocket disconnection
  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

console.log("WebSocket server is running on ws://localhost:4000");
