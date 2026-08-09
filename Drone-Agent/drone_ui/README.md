# LabAtHome Ground Control — dashboard skeleton for drone_assistant.py

A browser dashboard wired to your existing telemetry/chat/action logic.
The original script's classes (`TelemetryBuffer`, `SafetyMonitor`,
`FlightController`, `DroneAssistant`) are unchanged — `backend/server.py`
just wires them up to HTTP + a WebSocket instead of a terminal loop.

```
drone_ui/
  backend/
    drone_assistant.py   # your original logic, unchanged (CLI parts removed —
                          # this module is now imported, not run directly)
    server.py             # FastAPI app: connect, chat, actions, log analysis, WS push
    requirements.txt
  frontend/
    index.html             # dashboard layout
    style.css               # instrument-panel dark theme
    app.js                  # talks to the backend over REST + WebSocket
```

## Run it locally

**Easiest: double-click launcher.** `start_mac.command` (macOS) or
`start_windows.bat` (Windows) at the repo root set up the Python
environment on first run, start the backend, and open the dashboard in
your browser automatically. Nothing to type. Closing the window stops
the server.

On macOS, if double-clicking `start_mac.command` does nothing or shows a
security warning the first time: right-click it → **Open** → confirm.
That one-time step satisfies Gatekeeper for files not downloaded via the
App Store; after that, plain double-clicking works.

**Manual alternative**, if you'd rather run it from a terminal yourself:

```bash
cd backend
pip install -r requirements.txt
# make sure `ollama serve` is running if you want the chat panel to work
uvicorn server:app --reload --port 8765
```

Open `http://localhost:8765` — the backend now serves the dashboard
itself (mounted as static files), so there's no separate frontend server
to run. Enter your serial port / baud, tick "arm actions" only if you
actually want RTL/LOITER/ALT_HOLD to reach the aircraft, and hit Connect.

## Deploying to a NAS (recommended path)

This is the setup that pairs with Tailscale: one Docker container on the
NAS runs the backend, which also serves the dashboard on the same port -
so from any device on your tailnet you just open
`http://<nas-tailscale-name>:8765` and you're done. No public exposure,
no split frontend/backend deployment to keep in sync.

**1. Check in the code**

```bash
git init
git add .
git commit -m "LabAtHome Ground Control skeleton"
git remote add origin <your-repo-url>
git push -u origin main
```

**2. Get the code onto the NAS**

Either `git clone` the repo directly on the NAS over SSH, or use your
NAS's Docker/Container app to build from a Git URL - both Synology
Container Manager and QNAP Container Station support this.

**3. Build and run the container**

A `Dockerfile` and `docker-compose.yml` are included at the repo root.

```bash
docker compose up -d --build
```

Key things in `docker-compose.yml` worth knowing before you run it:

- **`network_mode: host`** - required so the container can (a) receive
  the UDP MAVLink stream forwarded from your laptop's `mavlink-router`,
  and (b) be reachable over Tailscale without fighting Docker's NAT.
  This only works on Linux-based NAS OSes (Synology DSM, QNAP QTS/QuTS,
  TrueNAS SCALE, etc. all qualify) - host networking isn't available on
  Docker Desktop for Mac/Windows if you're testing there instead.
- **`ALLOWED_ORIGINS`** - since everything now shares one origin
  (`http://<nas>:8765`), the default `*` is fine for this deployment
  shape. Only tighten it if you later split frontend/backend again.
- **`OLLAMA_HOST`** - most NAS hardware is too underpowered to run an
  LLM well. Point this at wherever Ollama actually runs (your laptop, a
  desktop, etc.) reachable over the same tailnet, e.g.
  `http://laptop-hostname:11434`.
- A `./logs` volume is mounted so telemetry JSONL logs survive container
  restarts/rebuilds.

**4. Connect the radio → NAS pipeline**

The NAS backend can't reach a serial port on your laptop directly - it
needs the MAVLink stream forwarded over the network. Once that's
forwarding to the NAS's Tailscale IP on UDP 14550, use
`udpin:0.0.0.0:14550` in the dashboard's connect form instead of a serial
path - no other code changes needed, since `pymavlink` treats network and
serial connections the same way.

On Linux, [`mavlink-router`](https://github.com/mavlink-router/mavlink-router)
is the standard tool for this. On **Windows or macOS**, use
`tools/forward.py` instead (included in this repo) - a small
dependency-free script that does the same job without needing a compiled
Linux binary. **See `WINDOWS_SETUP.md` for the full step-by-step runbook**
if the laptop holding the radio is running Windows.

### Synology-specific notes

- **Check Container support first.** Only certain Synology models ship
  "Container Manager" in Package Center (mainly `+`/Plus-series and some
  Value-series). Many budget `j`-series models (DS220j, DS420j, etc.)
  don't support Docker at all - if Container Manager isn't in Package
  Center, this NAS can't run the deployment described here.
- **No `git` by default.** Zip the repo, upload via File Station into a
  shared folder (e.g. `/volume1/docker/ground-control`), then SSH in and
  `cd` there to run compose. (Enable SSH first: Control Panel → Terminal
  & SNMP → Enable SSH service.)
- **Verify host networking actually applied.** Some DSM/Container Manager
  versions silently fall back to bridge networking even when the compose
  file says `network_mode: host`, especially when imported through the
  GUI's Project feature. After `docker compose up -d`, check:
  ```bash
  docker inspect labathome-ground-control --format '{{.HostConfig.NetworkMode}}'
  ```
  If that prints `bridge` instead of `host`, switch to the bridge-mode
  fallback service commented in `docker-compose.yml` (publishes
  `8765/tcp` and `14550/udp` explicitly instead of relying on host mode).

## Alternative: frontend on Vercel, backend elsewhere

If you'd rather not run everything on the NAS - e.g. hosting the
dashboard publicly while keeping the backend private - the frontend can
still be deployed separately. This is more moving parts than the NAS
path above, so only worth it if you have a specific reason to split them.

- Import the repo in Vercel, set **Root Directory** to `frontend`,
  framework preset **Other** (static, no build step).
- Edit `frontend/config.js` before deploying to point at the backend:
  ```js
  window.GC_CONFIG = {
    apiBase: "https://your-tunnel-url.example.com",
    wsUrl: "wss://your-tunnel-url.example.com/ws/telemetry",
  };
  ```
- Set `ALLOWED_ORIGINS` on the backend to your Vercel URL instead of `*`.
- This skeleton still has **no authentication** - `ALLOWED_ORIGINS`
  restricts which *sites* can call the API, not who can hit it directly.
  Don't arm actions on a backend reachable from the public internet
  without adding real auth (a shared-secret header, at minimum) first.

## What's wired up already

- **Connect form** → `POST /api/connect` starts the mavlink connection,
  telemetry reader thread, safety monitor, and (if Ollama is reachable)
  the assistant — mirrors `run_live()` from the original script.
- **WebSocket (`/ws/telemetry`)** → pushes a telemetry snapshot twice a
  second and any new safety alerts, driving the instrument cards, the
  attitude horizon, and the alert feed.
- **Chat panel** → `POST /api/chat`. Free text is also checked with
  `parse_action_intent()`, so typing "return to launch" arms a pending
  action exactly like it does in the CLI.
- **Flight actions** → two-step `POST /api/actions/request` then
  `/api/actions/confirm` (or `/cancel`), matching the CLI's confirm
  window. Nothing is sent to the vehicle unless "arm actions" was
  checked at connect time — same safety default as `--enable-actions`.
- **Post-flight log analysis** → upload a saved `.jsonl` log and
  `POST /api/log/analyze` runs `DroneAssistant.full_log_analysis()` on it.

## Using Claude instead of Ollama

`DroneAssistant` supports two LLM backends, switched with one env var -
same chat/log-analysis behavior either way, since both paths build the
same `messages` list and just differ in how it's sent.

| | `LLM_PROVIDER=ollama` (default) | `LLM_PROVIDER=anthropic` |
|---|---|---|
| Cost | Free | Pay per request (Anthropic API pricing) |
| Needs internet | No | Yes |
| Needs local compute | Yes (a machine to run the model) | No |
| Setup | `ollama serve` + `ollama pull <model>` | An Anthropic API key |

**To switch:**

1. `cp .env.example .env`, then put your real key in `.env` (already
   gitignored - never commit it).
2. In `docker-compose.yml`, change `LLM_PROVIDER=ollama` to
   `LLM_PROVIDER=anthropic`.
3. `docker-compose up -d --build`.

`ANTHROPIC_MODEL` defaults to `claude-sonnet-5` - override it in
`docker-compose.yml` if you want a different model. This applies to both
the live chat panel (`ask()`) and the post-flight log analysis
(`full_log_analysis()`) - both already route through the same `_chat()`
method, so nothing else needed changing.

## Known skeleton gaps (deliberately left for you to fill in)

- **Single session only.** `server.py` holds one global `Session` — fine
  for one operator on one machine, not for multiple simultaneous users.
  If you need that, key `Session` by a client id (e.g. a WS-issued token).
- **No auth.** CORS is wide open and there's no login — this is meant to
  run on localhost or a trusted LAN, not the public internet.
- **No reconnect/retry logic** if the mavlink link drops mid-flight; the
  WebSocket to the browser reconnects, but the backend↔vehicle link does
  not currently detect and recover from a dropped serial connection.
- **Log upload is synchronous** and blocks on the Ollama call — fine for
  a skeleton, but move it to a background task if logs get large.
- **Styling is a single flat dashboard** — no auth screen, no multi-vehicle
  switcher, no historical charting (only the live 120s buffer the
  original script already keeps in memory).
