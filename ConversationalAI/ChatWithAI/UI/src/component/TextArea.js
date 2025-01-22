import React, { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import "bootstrap/dist/css/bootstrap.min.css";
import "./TextArea.css";

const TextArea = ({ value, readOnly, rows, placeholder }) => {
  const textAreaRef = useRef(null);

  useEffect(() => {
    if (textAreaRef.current) {
      textAreaRef.current.scrollTop = textAreaRef.current.scrollHeight;
    }
  }, [value]);

  const copyToClipboard = (code) => {
    navigator.clipboard.writeText(code).then(
      () => {
        // alert("Code copied to clipboard!");
      },
      (err) => {
        console.error("Could not copy text: ", err);
      }
    );
  };
  const renderContent = () => {
    // Split text into lines and detect code blocks
    const lines = value.split("\n");
    const elements = [];
    let inCodeBlock = false;
    let codeBlock = [];

    const formatInlineText = (text) => {
      // Match text enclosed in backticks (`` ` ``) or double asterisks (**)
      const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
      return parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          // Format text enclosed in backticks
          return (
            <strong key={`code-${index}`} className="inline-code">
              {part.slice(1, -1)}
            </strong>
          );
        } else if (part.startsWith("**") && part.endsWith("**")) {
          // Format text enclosed in double asterisks
          return (
            <strong key={`bold-${index}`} className="inline-bold">
              {part.slice(2, -2)}
            </strong>
          );
        } else {
          // Render plain text
          return <span key={`text-${index}`}>{part}</span>;
        }
      });
    };

    const copyToClipboard = (text) => {
      navigator.clipboard.writeText(text).then(() => {
        // alert("Code copied to clipboard!");
      });
    };

    lines.forEach((line, index) => {
      if (line.startsWith("```")) {
        if (inCodeBlock) {
          // End of code block
          const codeContent = codeBlock.join("\n");
          elements.push(
            <pre className="code-container" key={`code-${index}`}>
              <code className="code-block">{codeContent}</code>
              <button
                className="copy-button"
                onClick={() => copyToClipboard(codeContent)}
              >
                Copy
              </button>
            </pre>
          );
          codeBlock = [];
        }
        inCodeBlock = !inCodeBlock; // Toggle code block
      } else if (inCodeBlock) {
        codeBlock.push(line);
      } else {
        // Regular text
        elements.push(
          <p className="formatted-text" key={`text-${index}`}>
            {formatInlineText(line)}
          </p>
        );
      }
    });

    return elements;
  };

  return (
    <div className="form-group mt-3">
      <div
        ref={textAreaRef}
        className="formatted-text-container"
        style={{ overflowY: "auto", height: rows * 24 }}
        readOnly={readOnly}
      >
        {renderContent()}
      </div>
    </div>
  );
};

TextArea.propTypes = {
  value: PropTypes.string.isRequired,
  readOnly: PropTypes.bool,
  rows: PropTypes.number,
  placeholder: PropTypes.string,
};

TextArea.defaultProps = {
  readOnly: true,
  rows: 35,
  placeholder: "The AI response will appear here.",
};

export default TextArea;
