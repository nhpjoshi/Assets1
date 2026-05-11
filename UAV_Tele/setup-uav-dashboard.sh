#!/bin/bash

# Exit on error

set -e

APP_NAME="uav-dashboard"

echo "🚀 Creating React app..."
npx create-react-app $APP_NAME

cd $APP_NAME

echo "📦 Installing dependencies..."
npm install recharts

echo "📁 Creating folder structure..."
mkdir -p src/components
mkdir -p src/pages
mkdir -p src/styles

echo "🧱 Creating components..."

# Header

cat > src/components/Header.js << 'EOF'
import React from "react";

const Header = () => {
return ( <div className="header"> <h2>UAV Telemetry System</h2> <div className="status"> <span>ARMED</span> <span>AUTO</span> <span>CONNECTED</span> </div> </div>
);
};

export default Header;
EOF

# MetricCard

cat > src/components/MetricCard.js << 'EOF'
import React from "react";

const MetricCard = ({ title, value, unit }) => {
return ( <div className="card"> <p>{title}</p> <h2>{value}</h2> <span>{unit}</span> </div>
);
};

export default MetricCard;
EOF

# ChartCard

cat > src/components/ChartCard.js << 'EOF'
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
EOF

# Dashboard Page

cat > src/pages/Dashboard.js << 'EOF'
import React from "react";
import Header from "../components/Header";
import MetricCard from "../components/MetricCard";
import ChartCard from "../components/ChartCard";
import "../styles/dashboard.css";

const Dashboard = () => {
return ( <div className="container"> <Header />

```
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
```

);
};

export default Dashboard;
EOF

# CSS

cat > src/styles/dashboard.css << 'EOF'
.container {
padding: 20px;
font-family: Arial;
background: #f5f6f8;
}

.header {
display: flex;
justify-content: space-between;
margin-bottom: 20px;
}

.metrics {
display: flex;
gap: 15px;
}

.card {
background: white;
padding: 15px;
border-radius: 12px;
}

.main {
display: flex;
margin-top: 20px;
}

.side {
margin-left: 20px;
display: flex;
flex-direction: column;
gap: 15px;
}
EOF

# Update App.js

cat > src/App.js << 'EOF'
import React from "react";
import Dashboard from "./pages/Dashboard";

function App() {
return <Dashboard />;
}

export default App;
EOF

echo "✅ Setup complete!"

echo "👉 Run the app:"
echo "cd $APP_NAME && npm start"
