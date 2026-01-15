// src/components/TextInput.js
import React from "react";
import PropTypes from "prop-types";
import "bootstrap/dist/css/bootstrap.min.css";

const TextInput = ({ value, onChange, onEnter, placeholder }) => {
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      onEnter();
    }
  };

  return (
    <input
      type="text"
      className="form-control"
      value={value}
      onChange={onChange}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      style={{
        width: "100%",
        boxSizing: "border-box",
      }}
    />
  );
};


TextInput.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  onEnter: PropTypes.func.isRequired, // Define onEnter prop
};

export default TextInput;
