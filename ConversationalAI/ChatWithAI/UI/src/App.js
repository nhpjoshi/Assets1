import React from "react";
import "./App.css";
import { BrowserRouter as Router, Route, Routes, Link } from "react-router-dom";
import PromptInput from "./component/PromptInput";
import ConversationTable from "./component/ConversationTable";
function App() {
  return (
    <Router>
      <div>
        <Routes>
          <Route path="/" element={<PromptInput />} />
          <Route path="/conversations" element={<ConversationTable />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
