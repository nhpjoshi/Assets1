// Runtime config for the dashboard - loaded before app.js.
//
// Default: same-origin. This is correct when the backend serves the
// frontend itself (the single-container NAS deployment) - no editing
// needed, just leave apiBase/wsUrl unset and it'll talk to whatever
// host:port served this page.
//
// Only set these if the frontend is hosted SEPARATELY from the backend
// (e.g. frontend on Vercel, backend reached over a tunnel):
//
// window.GC_CONFIG = {
//   apiBase: "https://your-tunnel-url.example.com",
//   wsUrl: "wss://your-tunnel-url.example.com/ws/telemetry",
// };
window.GC_CONFIG = {};
