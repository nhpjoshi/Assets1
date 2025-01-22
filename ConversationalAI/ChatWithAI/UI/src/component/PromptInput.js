import React, { useState, useEffect } from "react";
import TextInput from "./TextInput";
import TextArea from "./TextArea";
import Button from "./Button";
import { Link } from "react-router-dom"; // Import Link for navigation
import "./PromptInput.css"; // Import the CSS file for animations
import { generateSessionId } from "../utils/session";
function PromptInput() {
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState(""); // Start with an empty string
  const [ws, setWs] = useState(null);
  const [saveResponse, setSaveResponse] = useState("");
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [aiResponse, setAiResponse] = useState("");
  const [showGotIt, setShowGotIt] = useState(false);
  const [transactionHash, setTransactionHash] = useState(""); // New state for transaction hash
  const [pollingIntervalId, setPollingIntervalId] = useState(null); // To manage polling
  const [attempts, setAttempts] = useState(0); // New state to track polling attempts

  useEffect(() => {
    const id = generateSessionId();
    setSessionId(id);
    localStorage.setItem("sessionId", id);
  }, []);

  useEffect(() => {
    const socket = new WebSocket("ws://localhost:4000");
    setWs(socket);

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.response) {
        setShowGotIt(true);
        setTimeout(() => setShowGotIt(false), 1000);
        displayResponseLetterByLetter(data.response);
      } else {
        console.error("Unexpected response format:", data);
      }
    };

    return () => {
      socket.close();
    };
  }, []);

  const handleInputChange = (e) => {
    setQuestion(e.target.value);
  };

  const handleCopy = (code) => {
    navigator.clipboard.writeText(code).then(() => {
      alert("Code copied to clipboard!");
    });
  };
  const formatText = (text) => {
    const segments = text.split(/(```[\s\S]*?```)/g); // Split into regular text and code blocks
    return segments.map((segment, index) => {
      if (segment.startsWith("```") && segment.endsWith("```")) {
        const code = segment.slice(3, -3).trim();
        return (
          <div className="code-container" key={index}>
            <button className="copy-button" onClick={() => handleCopy(code)}>
              Copy
            </button>
            <pre className="code-block">
              <code>{code}</code>
            </pre>
          </div>
        );
      }
      return <p key={index}>{segment}</p>;
    });
  };

  const handleButtonClick = async () => {
    if (!question.trim()) return;

    setMessages((prevMessages) => [
      ...prevMessages,
      { type: "user", text: question },
    ]);
    setQuestion("");

    try {
      const response = await fetch("http://localhost:3009/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId, question }),
      });
      const data = await response.json();

      setMessages((prevMessages) => [
        ...prevMessages,
        { type: "AI", text: data.response },
      ]);
    } catch (error) {
      console.error("Error calling API:", error);
      setMessages((prevMessages) => [
        ...prevMessages,
        {
          type: "AI",
          text: "An error occurred while generating the response.",
        },
      ]);
    } finally {
      const chatHistory = document.querySelector(".chat-history");
      chatHistory.scrollTop = chatHistory.scrollHeight;
    }
  };
  const handleSaveConversation = async () => {
    // Prepare payload with conversation history
    const payload = {
      input: conversation, // Use conversation directly as input
      flag: true,
      sessionId,
    };

    console.log(payload);
    try {
      const response = await fetch("http://localhost:3011/api/save-input", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      setSaveResponse(data.message || "Conversation saved successfully!");
      startPollingForTransactionHash();
    } catch (error) {
      console.error("Error saving conversation to MongoDB:", error);
      setSaveResponse("An error occurred while saving the conversation.");
    }
  };

  const fetchTransactionHash = async () => {
    try {
      const response = await fetch(
        `http://localhost:3011/api/get-transaction-hash/${sessionId}`
      );
      const data = await response.json();

      if (data.transactionHash) {
        setTransactionHash(data.transactionHash); // Set the transaction hash
        clearInterval(pollingIntervalId); // Stop polling once hash is found
      } else {
        setAttempts((prevAttempts) => prevAttempts + 1); // Increment attempt count
        if (attempts >= 2) {
          // Stop after 3 attempts
          clearInterval(pollingIntervalId);
          setSaveResponse(
            "Failed to retrieve transaction hash after 3 attempts."
          );
        }
      }
    } catch (error) {
      console.error("Error fetching transaction hash:", error);
      setAttempts((prevAttempts) => prevAttempts + 1);
      if (attempts >= 2) {
        clearInterval(pollingIntervalId);
        setSaveResponse(
          "Failed to retrieve transaction hash after 3 attempts."
        );
      }
    }
  };
  const startPollingForTransactionHash = () => {
    setAttempts(0); // Reset attempts
    if (!pollingIntervalId) {
      const intervalId = setInterval(fetchTransactionHash, 5000);
      setPollingIntervalId(intervalId);
    }
  };

  const handleSendMessage = () => {
    if (question.trim() === "" || !ws) return;

    // Check if the user entered "clear" command
    if (question.toLowerCase() === "clear") {
      setConversation(""); // Clear the conversation
      setQuestion(""); // Reset the input field
      return; // Exit early
    }

    // Adding a partition (separator) before adding the new user input
    setConversation((prev) =>
      prev
        ? `${prev}\n------------------\nYou: ${question}`
        : `You: ${question}`
    );
    setAiResponse("");
    setIsThinking(true);

    const message = {
      model: "llama3:8b",
      prompt: conversation + `\nYou: ${question}`,
      stream: false,
    };

    ws.send(JSON.stringify(message));
    setQuestion("");
  };

  const displayResponseLetterByLetter = (response) => {
    setIsThinking(false);
    setIsTyping(true);

    let currentText = "";
    const delay = 10;

    response.split("").forEach((char, index) => {
      setTimeout(() => {
        currentText += char;
        setAiResponse(currentText);

        if (index === response.length - 1) {
          setIsTyping(false);
          // Adding a partition (separator) after the AI response
          setConversation((prev) => `${prev}\nAI: ${currentText}`);
          setAiResponse("");
        }
      }, index * delay);
    });
  };

  return (
    <div
      style={{ textAlign: "center", marginTop: "20px", position: "relative" }}
    >
      <h1>AI-Unlimited</h1>

      {/* Link to Conversation History */}
      {/* <Link
        to="/conversations"
        style={{ position: "absolute", top: "10px", right: "20px" }}
      >
        <button className="btn btn-primary">View Conversation History</button>
      </Link> */}

      <TextArea
        value={`${conversation}${isTyping ? `\nAI: ${aiResponse}` : ""}`}
        formatText={formatText}
        placeholder="The AI response will appear here."
      />

      {showGotIt && (
        <div style={{ color: "green", marginTop: "10px" }}>Got it!</div>
      )}
      {isThinking && !showGotIt && (
        <div className="thinking-animation">
          Thinking<span className="dot"></span>
          <span className="dot"></span>
          <span className="dot"></span>
        </div>
      )}
      {isTyping && (
        <div className="typing-animation">
          Typing<span className="dot"></span>
          <span className="dot"></span>
          <span className="dot"></span>
        </div>
      )}
      <TextInput
        value={question}
        onChange={handleInputChange}
        onEnter={handleSendMessage}
      />
      {/* <button
        className="btn btn-secondary mt-3"
        onClick={handleSaveConversation}
      >
        Own Your Creation
      </button> */}
    </div>
  );
}

export default PromptInput;
