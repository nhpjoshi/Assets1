// src/components/Button.js
import React from "react";
import PropTypes from "prop-types";

const Button = ({ onClick }) => {
  return (
    <button onClick={onClick} className="btn btn-primary mt-2">
      Claim Your Creation
    </button>
  );
};

Button.propTypes = {
  onClick: PropTypes.func.isRequired,
};

export default Button;
