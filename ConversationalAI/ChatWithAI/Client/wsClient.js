// Import the WebSocket and readline modules
const WebSocket = require("ws");
const readline = require("readline");

// Set up readline interface for terminal input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Initialize conversation history
let conversationHistory = "";

// Connect to the WebSocket server
const ws = new WebSocket("ws://192.168.65.254:4000");

ws.onopen = () => {
  console.log("Connected to WebSocket server");

  // Function to prompt user for input and send message to the server
  const promptUser = () => {
    rl.question(
      "Enter the prompt for Llama (or type 'exit' to quit): ",
      (inputPrompt) => {
        if (inputPrompt.toLowerCase() === "exit") {
          console.log("Closing connection...");
          ws.close();
          rl.close();
          return;
        }

        // Update conversation history with the latest user prompt
        conversationHistory += `User: ${inputPrompt}\n`;

        // Prepare the message with model, the entire conversation history, and stream option
        const message = {
          model: "llama3:8b", // model name
          prompt: conversationHistory, // send the whole conversation history as the prompt
          stream: false, // stream option
        };

        // Send the message to the WebSocket server
        ws.send(JSON.stringify(message));
        console.log("Message sent to Llama");
      }
    );
  };

  // Start the initial prompt
  promptUser();

  // Handle incoming messages from the server
  ws.onmessage = (event) => {
    try {
      // Parse the received data
      const data = JSON.parse(event.data);

      // Display only the response field if it exists and update conversation history
      if (data.response) {
        console.log("Response from Llama:", data.response);

        // Append Llama's response to the conversation history
        conversationHistory += `Llama: ${data.response}\n`;
      } else {
        console.log("Unexpected response format:", data);
      }
    } catch (error) {
      console.error("Error parsing response:", error);
    }

    // Prompt user again after receiving the response
    promptUser();
  };
};

// Handle WebSocket connection close
ws.onclose = () => {
  console.log("Disconnected from WebSocket server");
};

// Handle WebSocket errors
ws.onerror = (error) => {
  console.error("WebSocket error:", error);
};
