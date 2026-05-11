import React from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";

const data = [
{ time: 1, altitude: 90 },
{ time: 10, altitude: 100 },
{ time: 20, altitude: 110 },
{ time: 30, altitude: 115 },
{ time: 40, altitude: 105 },
{ time: 50, altitude: 95 },
];

const ChartCard = () => {
return ( <div className="card"> <h3>Altitude Profile</h3> <LineChart width={500} height={250} data={data}> <XAxis dataKey="time" /> <YAxis /> <Tooltip /> <Line type="monotone" dataKey="altitude" /> </LineChart> </div>
);
};

export default ChartCard;
