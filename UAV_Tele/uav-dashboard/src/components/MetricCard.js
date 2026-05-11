import React from "react";

const MetricCard = ({ title, value, unit }) => {
return ( <div className="card"> <p>{title}</p> <h2>{value}</h2> <span>{unit}</span> </div>
);
};

export default MetricCard;
