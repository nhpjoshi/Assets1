import React, { useEffect, useRef, useState } from "react";
import TextInput from "./TextInput";
import TextArea from "./TextArea";
import "./PromptInput.css";

function PromptInput() {
  const wsRef = useRef(null);
  const streamTextRef = useRef(""); // 🔥 source of truth

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);

  const [streamBuffer, setStreamBuffer] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const streamedTextRef = useRef("");


  /* =====================================================
     1️⃣ CONNECT TO WEBSOCKET (ONCE ONLY)
  ===================================================== */

useEffect(() => {
  console.log("🟡 [UI] Initializing WebSocket…");

  const ws = new WebSocket("ws://localhost:4000");
  wsRef.current = ws;

  ws.onopen = () => {
    console.log("🟢 [UI] WebSocket connected");
  };

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log("[UI] Parsed WS message:", data);

  if (data.type === "token") {
  setIsStreaming(true);

  streamedTextRef.current += data.content;

  setStreamingText(streamedTextRef.current);
  return;
}


  if (data.type === "done") {
  setIsStreaming(false);

  const finalText = streamedTextRef.current;

  setMessages((prev) => [
    ...prev,
    { role: "assistant", content: finalText },
  ]);

  // reset AFTER persisting
  streamedTextRef.current = "";
  setStreamingText("");

  return;
}

};



  ws.onerror = (err) => {
    console.error("❌ [UI] WebSocket error:", err);
  };

  ws.onclose = () => {
    console.log("🔴 [UI] WebSocket closed");
  };

  return () => {
    console.log("⚪ [UI] Cleaning up WebSocket");
    ws.close();
  };
}, []);


  /* =====================================================
     2️⃣ WORD-BY-WORD STREAM RENDERER
  ===================================================== */

useEffect(() => {
  if (!streamBuffer) return;

  console.log("✏️ [UI] Rendering streamBuffer:", streamBuffer);

  const words = streamBuffer.split(/\s+/);
  if (words.length <= 1) return;

  const interval = setInterval(() => {
    const nextWord = words[0];

    console.log("➡️ [UI] Rendering word:", nextWord);

    streamTextRef.current += nextWord + " ";
    setStreamingText(streamTextRef.current);

    setStreamBuffer(words.slice(1).join(" "));
  }, 80);

  return () => clearInterval(interval);
}, [streamBuffer]);


  /* =====================================================
     SEND MESSAGE
  ===================================================== */

const sendMessage = () => {
  console.log("🟡 [UI] Send button pressed");

  if (!input.trim()) {
    console.warn("⚠️ [UI] Empty input");
    return;
  }

  if (!wsRef.current) {
    console.error("❌ [UI] WebSocket NOT initialized");
    return;
  }

  const updatedMessages = [
    ...messages,
    { role: "user", content: input },
  ];

  console.log("📤 [UI] Sending to server:", updatedMessages);

  setMessages(updatedMessages);

  wsRef.current.send(
    JSON.stringify({
      model: "llama3",
      messages: updatedMessages,
    })
  );

  setInput("");
};


  /* =====================================================
     RENDER
  ===================================================== */

  return (
    <div className="chat-page">
      <div className="chat-container">
        <h1>AI Chat (LLaMA)</h1>

     <TextArea
  value={[
    ...messages.map((m) =>
      m.role === "user"
        ? `You: ${m.content}`
        : `AI: ${m.content}`
    ),
    ...(isStreaming ? [`AI: ${streamingText}`] : []),
  ].join("\n\n")}
/>


        {isStreaming && (
          <div className="thinking">AI is typing…</div>
        )}

        <div className="input-wrapper">
          <TextInput
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onEnter={sendMessage}
            placeholder="Type a message and press Enter"
          />
        </div>
      </div>
    </div>
  );
}

export default PromptInput;
