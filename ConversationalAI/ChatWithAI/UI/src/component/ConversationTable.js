import React, { useEffect, useState } from "react";

const ConversationTable = () => {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const response = await fetch(
          "http://localhost:4011/api/get-conversations"
        );
        const data = await response.json();
        setConversations(data.conversations || []);
      } catch (error) {
        console.error("Error fetching conversations:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchConversations();
  }, []);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const handleDownload = async (sessionId) => {
    try {
      const response = await fetch(
        `http://localhost:4012/api/download-conversation/${sessionId}`
      );

      if (!response.ok) {
        throw new Error("Failed to download the conversation.");
      }

      const blob = await response.blob(); // Get the file blob from the response
      const link = document.createElement("a"); // Create a temporary link element
      link.href = URL.createObjectURL(blob); // Create an object URL for the blob
      link.download = `conversation_${sessionId}.txt`; // Set the file name
      link.click(); // Programmatically click the link to trigger the download
    } catch (error) {
      console.error("Error downloading conversation:", error);
    }
  };

  return (
    <div
      style={{
        marginTop: "20px",
        textAlign: "center",
        width: "98%",
        maxWidth: "1600px",
        margin: "auto",
      }}
    >
      <h2>Conversation History</h2>
      {loading ? (
        <p>Loading conversations...</p>
      ) : (
        <table
          style={{
            width: "100%",
            margin: "auto",
            borderCollapse: "collapse",
            fontSize: "1.1em",
          }}
        >
          <thead>
            <tr>
              <th style={tableHeaderStyle}>Session ID</th>
              <th style={tableHeaderStyle}>Conversation</th>
              <th style={tableHeaderStyle}>Ethereum Hash</th>
              <th style={tableHeaderStyle}>Creation Date</th>
            </tr>
          </thead>
          <tbody>
            {conversations.length > 0 ? (
              conversations.map((conversation, index) => (
                <tr key={index}>
                  <td style={tableCellStyle}>{conversation.sessionId}</td>
                  <td style={tableCellStyle}>
                    <button
                      onClick={() => handleDownload(conversation.sessionId)}
                    >
                      Download Conversation
                    </button>
                  </td>
                  <td style={tableCellStyle}>
                    {conversation.apiResponse?.transactionHash ||
                      "No hash available"}
                  </td>
                  <td style={tableCellStyle}>
                    {conversation.createdAt
                      ? formatDate(conversation.createdAt)
                      : "N/A"}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="4" style={tableCellStyle}>
                  No conversations available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
};

const tableHeaderStyle = {
  padding: "15px",
  borderBottom: "1px solid #ddd",
  backgroundColor: "#f2f2f2",
  textAlign: "left",
};

const tableCellStyle = {
  padding: "15px",
  borderBottom: "1px solid #ddd",
  wordWrap: "break-word",
  maxWidth: "400px",
};

export default ConversationTable;
