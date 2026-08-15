import React, { useEffect, useState, useRef, useMemo } from "react";
import axios from "axios";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Tooltip
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Legend
} from "chart.js";

ChartJS.register(LineElement, CategoryScale, LinearScale, PointElement, Legend);

// ─────────────────────────────────────────────────────────────────
// Haversine formula — returns meters between two GPS coordinates
// ─────────────────────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─────────────────────────────────────────────────────────────────
// Build cumulative distance array from path
// cumulativeDist[i] = total metres flown from point 0 → point i
// O(n) — computed once when flight loads, then index lookups are O(1)
// ─────────────────────────────────────────────────────────────────
function buildCumulativeDistance(path) {
  const cum = new Array(path.length).fill(0);
  for (let i = 1; i < path.length; i++) {
    const step = haversine(
      path[i - 1].lat, path[i - 1].lng,
      path[i].lat,     path[i].lng
    );
    cum[i] = cum[i - 1] + step;
  }
  return cum;
}

// Max displacement = farthest straight-line distance from launch pad (point[0])
// to any point in the path — O(n), computed once on flight load
function buildMaxDisplacement(path) {
  if (path.length === 0) return 0;
  const launch = path[0];
  let max = 0;
  for (let i = 1; i < path.length; i++) {
    const d = haversine(launch.lat, launch.lng, path[i].lat, path[i].lng);
    if (d > max) max = d;
  }
  return max;
}

function App() {
  const [data, setData]       = useState([]);
  const [path, setPath]       = useState([]);
  const [index, setIndex]     = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed]     = useState(1);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime]     = useState("");
  const [shouldZoom, setShouldZoom] = useState(false);

  // ── Distance state ──────────────────────────────────────────────
  // cumulativeDist[i] = metres flown from start to point i (precomputed)
  const [cumulativeDist, setCumulativeDist] = useState([]);
  const [totalDistance, setTotalDistance]   = useState(null);
  const [maxDisplacement, setMaxDisplacement] = useState(null);

  const mapRef = useRef();

  // ── Realtime distance: lookup from precomputed array ────────────
  // Falls back to 0 safely if array not yet populated
  const realtimeDistance = cumulativeDist.length > index
    ? cumulativeDist[index]
    : 0;

  const distanceProgress =
    totalDistance && totalDistance > 0
      ? Math.min((realtimeDistance / totalDistance) * 100, 100).toFixed(1)
      : 0;

  // ── Live displacement from launch pad at current playback point ──
  // Straight-line distance from path[0] → path[index], O(1) per frame
  const liveDisplacement =
    path.length > 0 && path[index]
      ? haversine(path[0].lat, path[0].lng, path[index].lat, path[index].lng)
      : 0;

  const flightComplete = path.length > 0 && index >= path.length - 1;

  const droneIcon = L.divIcon({
    html: `<div style="width:16px;height:16px;background:cyan;border-radius:50%;border:2px solid white;box-shadow:0 0 10px cyan;"></div>`,
    className: ""
  });
  const takeoffIcon = L.divIcon({
    html: `<div style="font-size:24px;">🚀</div>`,
    className: ""
  });
  const landingIcon = L.divIcon({
    html: `<div style="font-size:24px;">🛬</div>`,
    className: ""
  });

  function computePointsPerSecond(records) {
    const bucket = {};
    records.forEach((p) => {
      const key = Math.floor(new Date(p.timestamp).getTime() / 1000);
      bucket[key] = (bucket[key] || 0) + 1;
    });
    return { labels: Object.keys(bucket), values: Object.values(bucket) };
  }

  const fetchData = async () => {
    try {
      const res = await axios.get("http://localhost:3000/path", {
        params: { start: startTime, end: endTime }
      });

      const d = res.data;
      if (!d.length) { alert("No telemetry found"); return; }

      const coords = d.map((p) => ({
        lat: p.lat,
        lng: p.lon,
        alt: p.alt || 0,
        voltage: p.voltage || 0,
        timestamp: p.timestamp
      }));

      // ✅ Compute ALL distance metrics client-side — pure JS, O(n), no API calls
      const cumDist   = buildCumulativeDistance(coords);
      const totalDist = cumDist[cumDist.length - 1] ?? 0;
      const maxDisp   = buildMaxDisplacement(coords);
      console.log(`📐 cumDist: ${cumDist.length} pts, total=${totalDist.toFixed(1)}m, maxDisp=${maxDisp.toFixed(1)}m`);

      // Set all state together so React batches them in one render
      setCumulativeDist(cumDist);
      setTotalDistance(totalDist);
      setMaxDisplacement(maxDisp);
      setData(d);
      setPath(coords);
      setIndex(0);
      setShouldZoom(true);
      setPlaying(false);
    } catch (err) {
      console.error(err);
      alert("Failed to load telemetry");
    }
  };

  useEffect(() => {
    if (!shouldZoom || !mapRef.current || path.length === 0) return;
    const bounds = L.latLngBounds(path.map((p) => [p.lat, p.lng]));
    mapRef.current.fitBounds(bounds, { padding: [50, 50] });
    setShouldZoom(false);
  }, [shouldZoom, path]);

  useEffect(() => {
    if (!playing || index >= data.length - 1) return;
    const curr = new Date(data[index].timestamp);
    const next = new Date(data[index + 1].timestamp);
    const delay = Math.max(50, Math.min(next - curr, 1000)) / speed;
    const timer = setTimeout(() => setIndex((prev) => prev + 1), delay);
    return () => clearTimeout(timer);
  }, [playing, data, index, speed]);

  useEffect(() => {
    if (!mapRef.current || !path[index]) return;
    mapRef.current.flyTo([path[index].lat, path[index].lng], 18, { duration: 0.5 });
  }, [index, path]);

  const pps = useMemo(() => computePointsPerSecond(data.slice(0, index)), [data, index]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: "white" } } },
    scales: {
      x: { ticks: { color: "white" } },
      y: { ticks: { color: "white" } }
    }
  };

  const altitudeChart = {
    labels: path.slice(0, index).map((_, i) => i),
    datasets: [
      { label: "Altitude", data: path.slice(0, index).map((p) => p.alt),     borderColor: "cyan",   tension: 0.3 },
      { label: "Battery",  data: path.slice(0, index).map((p) => p.voltage), borderColor: "yellow", tension: 0.3 }
    ]
  };

  const ppsChart = {
    labels: pps.labels,
    datasets: [{ label: "Points / Second", data: pps.values, borderColor: "lime", tension: 0.3 }]
  };

  const maxAltitude = data.length > 0 ? Math.max(...data.map((x) => x.alt || 0)) : 0;
  const minVoltage  = data.length > 0 ? Math.min(...data.map((x) => x.voltage || 999)) : 0;
  const duration    = data.length > 1
    ? ((new Date(data[data.length - 1].timestamp) - new Date(data[0].timestamp)) / 1000).toFixed(0)
    : 0;

  const fmt = (metres) =>
    metres >= 1000
      ? `${(metres / 1000).toFixed(3)} km`
      : `${metres.toFixed(1)} m`;

  return (
    <div style={{ background: "#000", color: "#fff", minHeight: "100vh", padding: "10px" }}>
      <h2>🚁 Drone Flight Dashboard</h2>

      {/* Date range picker */}
      <div style={{ marginBottom: 10 }}>
        Start:
        <input type="datetime-local" onChange={(e) => setStartTime(new Date(e.target.value).toISOString())} />
        End:
        <input type="datetime-local" onChange={(e) => setEndTime(new Date(e.target.value).toISOString())} />
        <button onClick={fetchData}>Load Flight</button>
      </div>

      {/* Playback controls */}
      <div style={{ marginBottom: 10 }}>
        <button onClick={() => setPlaying(true)}>▶ Play</button>
        <button onClick={() => setPlaying(false)}>⏸ Pause</button>
        <button onClick={() => setSpeed(1)}>1x</button>
        <button onClick={() => setSpeed(2)}>2x</button>
        <button onClick={() => setSpeed(5)}>5x</button>
        <button onClick={() => setSpeed(10)}>10x</button>
      </div>

      {/* Live telemetry bar */}
      <div style={{ display: "flex", gap: "25px", background: "#111", padding: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
        <div>Alt:<br />{path[index]?.alt?.toFixed(2)}m</div>
        <div>Battery:<br />{path[index]?.voltage?.toFixed(2)}V</div>
        <div>Pitch:<br />{data[index]?.pitch?.toFixed(2)}</div>
        <div>Roll:<br />{data[index]?.roll?.toFixed(2)}</div>
        <div>Yaw:<br />{data[index]?.yaw?.toFixed(2)}</div>
        <div>Point:<br />{index}/{data.length}</div>

        {/* ── Live Distance Widget ─────────────────────────────── */}
        {path.length > 0 && (
          <div style={{
            background: "#0a0a0a",
            border: "1px solid #00ffff44",
            borderRadius: "8px",
            padding: "8px 14px",
            minWidth: "180px"
          }}>
            <div style={{ fontSize: "11px", color: "#aaa", marginBottom: "4px" }}>
              📍 Distance Covered
            </div>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: "cyan" }}>
              {fmt(realtimeDistance)}
            </div>
            {totalDistance !== null && (
              <>
                <div style={{ fontSize: "11px", color: "#888", marginTop: "2px" }}>
                  of {fmt(totalDistance)} total
                </div>
                <div style={{ marginTop: "6px", background: "#222", borderRadius: "4px", height: "6px", overflow: "hidden" }}>
                  <div style={{
                    width: `${distanceProgress}%`,
                    height: "100%",
                    background: "cyan",
                    transition: "width 0.1s linear"
                  }} />
                </div>
                <div style={{ fontSize: "10px", color: "#555", marginTop: "2px" }}>{distanceProgress}%</div>
              </>
            )}
          </div>
        )}

        {/* ── Displacement Widget ──────────────────────────────── */}
        {path.length > 0 && (
          <div style={{
            background: "#0a0a0a",
            border: `1px solid ${flightComplete ? "#ff2222aa" : "#ff6b0044"}`,
            borderRadius: "8px",
            padding: "8px 14px",
            minWidth: "160px",
            transition: "border-color 0.4s ease"
          }}>
            <div style={{ fontSize: "11px", color: "#aaa", marginBottom: "4px" }}>
              📡 Displacement
            </div>

            {/* Live value — straight-line from launch to current position */}
            <div style={{ fontSize: "20px", fontWeight: "bold", color: "#ff6b00" }}>
              {fmt(liveDisplacement)}
            </div>
            <div style={{ fontSize: "10px", color: "#666", marginTop: "1px" }}>
              from launch pad (live)
            </div>

            {/* Final displacement — only shown after flight completes */}
            {flightComplete && maxDisplacement !== null && (
              <div style={{
                marginTop: "8px",
                paddingTop: "7px",
                borderTop: "1px solid #ff222244",
              }}>
                <div style={{ fontSize: "10px", color: "#aaa", marginBottom: "2px" }}>
                  🏁 Final displacement
                </div>
                <div style={{ fontSize: "16px", fontWeight: "bold", color: "#ff2222" }}>
                  {fmt(maxDisplacement)}
                </div>
                <div style={{ fontSize: "10px", color: "#666" }}>
                  launch → landing
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Map */}
      <MapContainer
        center={[12.97, 77.59]}
        zoom={13}
        style={{ height: "60vh" }}
        whenCreated={(map) => (mapRef.current = map)}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Polyline positions={path.map((p) => [p.lat, p.lng])} color="gray" weight={2} />
        <Polyline positions={path.slice(0, index).map((p) => [p.lat, p.lng])} color="cyan" weight={4} />

        {path.length > 0 && (
          <Marker position={[path[0].lat, path[0].lng]} icon={takeoffIcon}>
            <Tooltip>Takeoff</Tooltip>
          </Marker>
        )}
        {path.length > 0 && (
          <Marker position={[path[path.length - 1].lat, path[path.length - 1].lng]} icon={landingIcon}>
            <Tooltip>Landing</Tooltip>
          </Marker>
        )}
        {path[index] && (
          <Marker position={[path[index].lat, path[index].lng]} icon={droneIcon}>
            <Tooltip>
              Alt: {path[index].alt}m<br />
              Battery: {path[index].voltage}V<br />
              Distance: {fmt(realtimeDistance)}
            </Tooltip>
          </Marker>
        )}

        {/* ── Displacement line: launch → landing, shown only at end of flight ── */}
        {path.length > 0 && index >= path.length - 1 && (
          <>
            {/* Red dashed line from launch pad to landing point */}
            <Polyline
              positions={[
                [path[0].lat, path[0].lng],
                [path[path.length - 1].lat, path[path.length - 1].lng]
              ]}
              pathOptions={{
                color: "#ff2222",
                weight: 2.5,
                dashArray: "8 6",
                opacity: 0.9,
              }}
            />

            {/* Midpoint label marker showing displacement distance */}
            {maxDisplacement !== null && (() => {
              const midLat = (path[0].lat + path[path.length - 1].lat) / 2;
              const midLng = (path[0].lng + path[path.length - 1].lng) / 2;
              const dispIcon = L.divIcon({
                html: `<div style="
                  background: rgba(20,0,0,0.82);
                  border: 1.5px solid #ff2222;
                  border-radius: 6px;
                  padding: 3px 8px;
                  color: #ff4444;
                  font-size: 11px;
                  font-weight: bold;
                  white-space: nowrap;
                  box-shadow: 0 0 8px #ff222255;
                ">📏 ${fmt(maxDisplacement)}</div>`,
                className: "",
                iconAnchor: [40, 12],
              });
              return (
                <Marker position={[midLat, midLng]} icon={dispIcon}>
                  <Tooltip direction="top">
                    Displacement: {fmt(maxDisplacement)}<br />
                    Launch → Landing (straight line)
                  </Tooltip>
                </Marker>
              );
            })()}
          </>
        )}
      </MapContainer>

      {/* Charts */}
      <div style={{ height: "250px", background: "#111", marginTop: "10px" }}>
        <Line data={altitudeChart} options={chartOptions} />
      </div>
      <div style={{ height: "250px", background: "#111", marginTop: "10px" }}>
        <Line data={ppsChart} options={chartOptions} />
      </div>

      {/* Flight Summary */}
      <div style={{ background: "#111", padding: "15px", marginTop: "10px" }}>
        <h3>Flight Summary</h3>
        <div>Max Altitude: {maxAltitude.toFixed(2)} m</div>
        <div>Lowest Battery: {minVoltage.toFixed(2)} V</div>
        <div>Duration: {duration}s</div>
        <div>Total Points: {data.length}</div>
        {totalDistance !== null && (
          <>
            <div style={{ marginTop: "8px", color: "cyan" }}>
              Total Path Length: {fmt(totalDistance)}
            </div>
            <div style={{ color: "#ff6b00" }}>
              Max Displacement from Launch: {fmt(maxDisplacement)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;