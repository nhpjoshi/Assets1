import React from "react";
import Header from "../components/Header";
import MetricCard from "../components/MetricCard";
import ChartCard from "../components/ChartCard";
import "../styles/dashboard.css";

const Dashboard = () => {
return ( <div className="container"> <Header />


  <div className="metrics">
    <MetricCard title="ALT" value="99.4" unit="meters" />
    <MetricCard title="GS" value="31.6" unit="km/h" />
    <MetricCard title="BAT" value="84%" unit="" />
    <MetricCard title="SIG" value="79%" unit="" />
    <MetricCard title="GPS" value="8" unit="satellites" />
  </div>

  <div className="main">
    <ChartCard />
    <div className="side">
      <div className="card">Heading: 132°</div>
      <div className="card">Orientation</div>
      <div className="card">Environment</div>
    </div>
  </div>
</div>


);
};

export default Dashboard;
