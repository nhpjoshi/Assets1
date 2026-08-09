const API_BASE = window.GC_CONFIG?.apiBase || window.location.origin;
const WS_URL = window.GC_CONFIG?.wsUrl || API_BASE.replace(/^http/, "ws") + "/ws/telemetry";

const el = (id) => document.getElementById(id);

// ---------------------------------------------------------------- connect

el("connect-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = el("connect-btn");
  btn.disabled = true;
  btn.textContent = "Connecting...";
  try {
    const res = await fetch(`${API_BASE}/api/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        port: el("port").value,
        baud: Number(el("baud").value),
        enable_actions: el("enable-actions").checked,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "connection failed");
    resetMapState();
    resetInstrumentsUI();
    setConnected(true);
    addChatMessage("system", `Connected. System ${data.system_id}/${data.component_id}. AI: ${data.ai_available ? "online" : "unavailable"}.`);
  } catch (err) {
    addChatMessage("error", `Connect failed: ${err.message}`);
    setConnected(false);
  } finally {
    btn.textContent = "Connect";
  }
});

el("disconnect-btn").addEventListener("click", async () => {
  const btn = el("disconnect-btn");
  btn.disabled = true;
  btn.textContent = "Disconnecting...";
  try {
    await fetch(`${API_BASE}/api/disconnect`, { method: "POST" });
  } catch (err) {
    // Backend may already be unreachable - proceed to reset the UI anyway,
    // since the goal (stop treating this session as connected) still holds.
  }
  setConnected(false);
  resetMapState();
  resetInstrumentsUI();
  renderPending(null);
  addChatMessage("system", "Disconnected.");
  btn.textContent = "Disconnect";
});

function setConnected(isConnected) {
  el("conn-dot").classList.toggle("connected", isConnected);
  el("conn-label").textContent = isConnected ? "CONNECTED" : "DISCONNECTED";
  el("connect-btn").disabled = isConnected;
  el("disconnect-btn").disabled = !isConnected;
}

// Clears stale telemetry text/coloring back to placeholders - used on both
// disconnect (so old readings don't linger looking "live") and on a fresh
// connect (so a previous session's numbers don't flash before new data
// arrives).
function resetInstrumentsUI() {
  el("gps-fix").textContent = "--";
  el("gps-sub").textContent = "no data";
  document.querySelector('[data-card="gps"]').className = "card";

  el("batt-pct").textContent = "--%";
  el("batt-sub").textContent = "no data";
  document.querySelector('[data-card="battery"]').className = "card";

  el("alt-val").textContent = "-- m";
  el("dist-val").textContent = "-- m";

  el("att-status").textContent = "no data";
  el("att-sub").textContent = "waiting for ATTITUDE messages";
  el("roll-val").textContent = "ROLL --";
  el("pitch-val").textContent = "PITCH --";

  const tilt = el("horizon-tilt");
  if (tilt) tilt.removeAttribute("transform");

  Object.keys(lastSeen).forEach((k) => { lastSeen[k] = 0; });
}

// -------------------------------------------------------------- websocket

let ws;
function connectWS() {
  ws = new WebSocket(WS_URL);
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === "snapshot") {
      setConnected(true);
      // eslint-disable-next-line no-console
      console.debug("[telemetry snapshot]", msg.data);
      renderSnapshot(msg.data);
      renderPending(msg.pending_action);
    } else if (msg.type === "alert") {
      renderAlert(msg);
    } else if (msg.type === "disconnected") {
      setConnected(false);
    }
  };
  ws.onclose = () => setTimeout(connectWS, 1500);
  ws.onerror = () => ws.close();
}
connectWS();

// -------------------------------------------------------------- telemetry
//
// `lastSeen` tracks, per MAVLink message type, the timestamp on the
// *message itself* (`ts` from the backend, set when the message was
// actually received from the vehicle) — not when the browser happened to
// poll. That's what the freshness dots below are based on, so if a dot
// goes stale you know the vehicle stopped sending that message type,
// not that the UI stopped listening.

const lastSeen = { GPS_RAW_INT: 0, SYS_STATUS: 0, GLOBAL_POSITION_INT: 0, ATTITUDE: 0 };

function renderSnapshot(snap) {
  const gps = snap.GPS_RAW_INT;
  const gpsCard = document.querySelector('[data-card="gps"]');
  if (gps) {
    lastSeen.GPS_RAW_INT = gps.ts;
    el("gps-fix").textContent = `fix ${gps.fix_type ?? "-"}`;
    el("gps-sub").textContent = `${gps.satellites_visible ?? 0} sats`;
    gpsCard.className = "card " + (gps.fix_type < 3 ? "critical" : gps.satellites_visible < 6 ? "warn" : "ok");
    updateMap(gps);
  }

  const batt = snap.SYS_STATUS;
  const battCard = document.querySelector('[data-card="battery"]');
  if (batt) {
    lastSeen.SYS_STATUS = batt.ts;
    const pct = batt.battery_remaining;
    const v = (batt.voltage_battery ?? 0) / 1000;
    el("batt-pct").textContent = `${pct ?? "--"}%`;
    el("batt-sub").textContent = `${v.toFixed(2)} V`;
    battCard.className = "card " + (pct <= 15 ? "critical" : pct <= 30 ? "warn" : "ok");
  }

  const pos = snap.GLOBAL_POSITION_INT;
  if (pos) {
    lastSeen.GLOBAL_POSITION_INT = pos.ts;
    el("alt-val").textContent = `${(pos.relative_alt / 1000).toFixed(1)} m`;
  }

  const att = snap.ATTITUDE;
  if (att) {
    lastSeen.ATTITUDE = att.ts;
    const rollDeg = (att.roll * 180) / Math.PI;
    const pitchDeg = (att.pitch * 180) / Math.PI;
    el("roll-val").textContent = `ROLL ${rollDeg.toFixed(1)}°`;
    el("pitch-val").textContent = `PITCH ${pitchDeg.toFixed(1)}°`;
    el("att-status").textContent = "receiving";
    el("att-sub").textContent = `roll ${rollDeg.toFixed(1)}° / pitch ${pitchDeg.toFixed(1)}°`;
    const tilt = el("horizon-tilt");
    const pitchPx = Math.max(-60, Math.min(60, pitchDeg * 1.2));
    tilt.setAttribute("transform", `rotate(${-rollDeg} 100 100) translate(0 ${pitchPx})`);
  }
}

// Freshness dots: green if a message of that type arrived in the last 2s,
// amber up to 10s, red beyond that (or if none has ever arrived). This is
// the fastest way to tell "vehicle isn't sending ATTITUDE" apart from
// "browser stopped rendering it".
const FRESH_MAP = [
  ["gps-fresh", "GPS_RAW_INT"],
  ["batt-fresh", "SYS_STATUS"],
  ["alt-fresh", "GLOBAL_POSITION_INT"],
  ["dist-fresh", "GPS_RAW_INT"],
  ["att-fresh", "ATTITUDE"],
];

function tickFreshness() {
  const now = Date.now() / 1000;
  for (const [domId, key] of FRESH_MAP) {
    const dot = el(domId);
    if (!dot) continue;
    const ts = lastSeen[key];
    dot.classList.remove("live", "aging", "stale");
    if (!ts) {
      dot.classList.add("stale");
      continue;
    }
    const age = now - ts;
    if (age < 2) dot.classList.add("live");
    else if (age < 10) dot.classList.add("aging");
    else dot.classList.add("stale");
  }
}
setInterval(tickFreshness, 500);

// -------------------------------------------------------------------- map
//
// Plain Leaflet + OpenStreetMap tiles - no API key required. Only draws a
// fix once GPS_RAW_INT reports a usable 2D/3D fix, so a weak/no-fix vehicle
// doesn't plot garbage coordinates at (0, 0).

const droneIcon = L.divIcon({ className: "drone-marker", iconSize: [14, 14] });

const map = L.map("map", { zoomControl: true, attributionControl: true }).setView([20, 0], 2);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const track = L.polyline([], { color: "#4fd8e0", weight: 2, opacity: 0.8 }).addTo(map);
let marker = null;
let autoFollow = true;
const trackPoints = [];
const MAX_TRACK_POINTS = 1000;

// --------------------------------------------------------- distance covered
//
// Cumulative great-circle distance between consecutive GPS fixes
// (Haversine). Resets whenever a fresh connection is made so it reflects
// this flight, not whatever was flown last in the same browser tab.

let totalDistanceM = 0;
let lastDistLatLng = null;

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function renderDistance() {
  const el2 = el("dist-val");
  if (totalDistanceM >= 1000) {
    el2.textContent = `${(totalDistanceM / 1000).toFixed(2)} km`;
  } else {
    el2.textContent = `${totalDistanceM.toFixed(1)} m`;
  }
}

function resetMapState() {
  totalDistanceM = 0;
  lastDistLatLng = null;
  trackPoints.length = 0;
  track.setLatLngs([]);
  if (marker) {
    marker.remove();
    marker = null;
  }
  renderDistance();
  el("map-placeholder").style.display = "flex";
}

el("map-follow").addEventListener("change", (e) => {
  autoFollow = e.target.checked;
});

el("map-recenter").addEventListener("click", () => {
  if (marker) {
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 16));
    autoFollow = true;
    el("map-follow").checked = true;
  }
});

// A manual drag means the operator wants to look elsewhere - stop
// recentering under them until they opt back in.
map.on("dragstart", () => {
  autoFollow = false;
  el("map-follow").checked = false;
});

window.addEventListener("resize", () => map.invalidateSize());

// ------------------------------------------------------- map expand/collapse
//
// Reparents the *same* #map-wrap element (with its live Leaflet instance)
// between the docked panel and the fullscreen popup, rather than creating
// a second map - keeps marker/track/zoom state in sync automatically.

const mapDock = el("map-dock");
const mapWrap = el("map-wrap");
const mapModal = el("map-modal");
const mapModalBody = el("map-modal-body");

function expandMap() {
  mapModalBody.appendChild(mapWrap);
  mapModal.hidden = false;
  requestAnimationFrame(() => map.invalidateSize());
}

function collapseMap() {
  mapDock.appendChild(mapWrap);
  mapModal.hidden = true;
  requestAnimationFrame(() => map.invalidateSize());
}

el("map-expand").addEventListener("click", expandMap);
el("map-collapse").addEventListener("click", collapseMap);
mapModal.addEventListener("click", (e) => {
  if (e.target === mapModal) collapseMap();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !mapModal.hidden) collapseMap();
});

function updateMap(gps) {
  const fix = gps.fix_type ?? 0;
  const lat = gps.lat / 1e7;
  const lon = gps.lon / 1e7;
  const hasFix = fix >= 2 && (lat !== 0 || lon !== 0) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

  el("map-lat").textContent = `LAT ${hasFix ? lat.toFixed(6) : "--"}`;
  el("map-lon").textContent = `LON ${hasFix ? lon.toFixed(6) : "--"}`;
  el("map-sats").textContent = `SATS ${gps.satellites_visible ?? "--"}`;

  if (!hasFix) return;

  el("map-placeholder").style.display = "none";
  const latlng = [lat, lon];

  if (!marker) {
    marker = L.marker(latlng, { icon: droneIcon }).addTo(map);
    map.setView(latlng, 17);
  } else {
    marker.setLatLng(latlng);
    if (autoFollow) map.panTo(latlng, { animate: true });
  }

  trackPoints.push(latlng);
  if (trackPoints.length > MAX_TRACK_POINTS) trackPoints.shift();
  track.setLatLngs(trackPoints);

  if (lastDistLatLng) {
    totalDistanceM += haversineMeters(lastDistLatLng, latlng);
  }
  lastDistLatLng = latlng;
  renderDistance();
}

function renderAlert(alert) {
  const list = el("alert-list");
  const empty = list.querySelector(".alert-empty");
  if (empty) empty.remove();

  const li = document.createElement("li");
  const level = alert.message.startsWith("CRITICAL") ? "critical" : alert.message.startsWith("WARNING") ? "warning" : "info";
  li.className = level;
  const time = new Date(alert.ts * 1000).toLocaleTimeString();
  li.textContent = `[${time}] ${alert.message}`;
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;

  if (el("alerts-modal").hidden) bumpBellBadge();
}

// ------------------------------------------------------------------- bell

let unreadAlerts = 0;

function bumpBellBadge() {
  unreadAlerts += 1;
  const badge = el("bell-badge");
  badge.hidden = false;
  badge.textContent = unreadAlerts > 99 ? "99+" : String(unreadAlerts);
}

function clearBellBadge() {
  unreadAlerts = 0;
  el("bell-badge").hidden = true;
}

function openAlerts() {
  el("alerts-modal").hidden = false;
  el("alerts-bell").setAttribute("aria-expanded", "true");
  clearBellBadge();
}

function closeAlerts() {
  el("alerts-modal").hidden = true;
  el("alerts-bell").setAttribute("aria-expanded", "false");
}

el("alerts-bell").addEventListener("click", openAlerts);
el("alerts-close").addEventListener("click", closeAlerts);
el("alerts-modal").addEventListener("click", (e) => {
  if (e.target === el("alerts-modal")) closeAlerts();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el("alerts-modal").hidden) closeAlerts();
});

// ----------------------------------------------------------------- chat

el("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = el("chat-input");
  const sendBtn = e.target.querySelector("button");
  const text = input.value.trim();
  if (!text) return;
  addChatMessage("user", text);
  input.value = "";
  input.disabled = true;
  sendBtn.disabled = true;

  const thinkingEl = addThinkingIndicator();

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    thinkingEl.remove();
    if (data.error) addChatMessage("error", data.error);
    if (data.answer) addChatMessage("assistant", data.answer);
    renderPending(data.pending_action);
  } catch (err) {
    thinkingEl.remove();
    addChatMessage("error", err.message);
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
});

function addChatMessage(role, text) {
  const log = el("chat-log");
  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function addThinkingIndicator() {
  const log = el("chat-log");
  const div = document.createElement("div");
  div.className = "chat-msg thinking";
  div.innerHTML = '<span class="dot-flash"></span><span class="dot-flash"></span><span class="dot-flash"></span>';
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

// -------------------------------------------------------------- actions

document.querySelectorAll(".action-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const res = await fetch(`${API_BASE}/api/actions/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: btn.dataset.action }),
    });
    const data = await res.json();
    renderPending(data.pending_action);
  });
});

el("confirm-btn").addEventListener("click", async () => {
  const res = await fetch(`${API_BASE}/api/actions/confirm`, { method: "POST" });
  const data = await res.json();
  renderPending(null);
  addChatMessage("system", data.result || "Action sent.");
});

el("cancel-btn").addEventListener("click", async () => {
  await fetch(`${API_BASE}/api/actions/cancel`, { method: "POST" });
  renderPending(null);
});

function renderPending(pending) {
  const bar = el("pending-bar");
  if (!pending) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  el("pending-label").textContent = `${pending.label} — confirm within ${Math.max(0, Math.round(pending.expires_in))}s`;
}

// --------------------------------------------------------- log analysis

el("analyze-btn").addEventListener("click", async () => {
  const fileInput = el("log-file");
  if (!fileInput.files.length) return;
  const form = new FormData();
  form.append("file", fileInput.files[0]);

  const report = el("log-report");
  report.textContent = "Analyzing...";
  try {
    const res = await fetch(`${API_BASE}/api/log/analyze`, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "analysis failed");
    report.textContent = `${data.record_count} records\n\n${data.report}`;
  } catch (err) {
    report.textContent = `Error: ${err.message}`;
  }
});
