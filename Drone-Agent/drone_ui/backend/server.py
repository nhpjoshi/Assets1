"""
server.py

FastAPI layer around drone_assistant.py's core classes. This file owns no
flight logic itself - it only wires TelemetryBuffer / SafetyMonitor /
FlightController / DroneAssistant up to HTTP + WebSocket so a browser
dashboard can drive them.

Run:
    pip install -r requirements.txt
    uvicorn server:app --reload --port 8765
"""

import asyncio
import io
import json
import logging
import os
import threading
import time
from collections import deque
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import drone_assistant as da

logger = logging.getLogger("uvicorn.error")

app = FastAPI(title="LabAtHome Ground Control API")

# Skeleton is single-operator / same-machine by default. Once the backend
# is reachable from outside localhost (e.g. via a tunnel, for a Vercel-hosted
# frontend), set ALLOWED_ORIGINS to your actual frontend URL(s) instead of
# leaving this at "*" - with actions armed, wide-open CORS + no auth means
# anyone who finds the URL could send flight commands.
_allowed_origins = os.environ.get("ALLOWED_ORIGINS", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _allowed_origins == "*" else [o.strip() for o in _allowed_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Without this, any uncaught exception falls through to Starlette's
    # default plain-text "Internal Server Error" page - which breaks the
    # frontend's `await res.json()` calls with a confusing
    # "Unexpected token 'I' ... is not valid JSON" error that points
    # nowhere near the actual problem. Always return JSON instead, and log
    # the real traceback server-side so `docker logs` shows what happened.
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": f"Internal error: {exc}"})


# ---------------------------------------------------------------------------
# Session: one live connection at a time, held in memory.
# Swap this for a per-user session store if you need multiple operators.
# ---------------------------------------------------------------------------

class Session:
    def __init__(self):
        self.lock = threading.Lock()
        self.master = None
        self.buffer: Optional[da.TelemetryBuffer] = None
        self.controller: Optional[da.FlightController] = None
        self.assistant: Optional[da.DroneAssistant] = None
        self.stop_event: Optional[threading.Event] = None
        self.log_file = None
        self.log_path: Optional[str] = None
        self.connected = False
        self.actions_enabled = False
        self.ai_available = False
        self.alerts = deque(maxlen=200)          # (ts, message)
        self.pending_action = {"key": None, "expires": 0}

    def push_alert(self, message: str):
        with self.lock:
            self.alerts.append({"ts": time.time(), "message": message})

    def alerts_since(self, since_ts: float):
        with self.lock:
            return [a for a in self.alerts if a["ts"] > since_ts]


session = Session()


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------

class ConnectRequest(BaseModel):
    port: str = "/dev/tty.usbserial-AK0SM39C"
    baud: int = 57600
    stream_rate: float = 4.0
    log_path: str = "logs/telemetry_log.jsonl"
    enable_actions: bool = False


class ChatRequest(BaseModel):
    message: str


class ActionRequest(BaseModel):
    action: str  # one of da.ACTIONS keys


CONFIRM_WINDOW_SECONDS = 30


# ---------------------------------------------------------------------------
# Connection lifecycle
# ---------------------------------------------------------------------------

@app.post("/api/connect")
def connect(req: ConnectRequest):
    if da.mavutil is None:
        raise HTTPException(500, "pymavlink is not installed on the server (pip install pymavlink pyserial)")
    if session.connected:
        raise HTTPException(409, "Already connected. Call /api/disconnect first.")

    try:
        master = da.mavutil.mavlink_connection(req.port, baud=req.baud)
    except Exception as e:
        raise HTTPException(400, f"Could not open '{req.port}': {e}")

    try:
        master.wait_heartbeat(timeout=15)
    except Exception as e:
        master.close()
        raise HTTPException(
            504,
            f"Connected the transport but no MAVLink heartbeat arrived within 15s ({e}). "
            f"Check that '{req.port}' is actually receiving MAVLink data.",
        )

    try:
        da.request_telemetry_streams(master, rate_hz=req.stream_rate)
    except Exception as e:
        master.close()
        raise HTTPException(500, f"Connected but failed to request telemetry streams: {e}")

    buffer = da.TelemetryBuffer()
    stop_event = threading.Event()
    log_dir = os.path.dirname(req.log_path)
    if log_dir:
        if os.path.exists(log_dir) and not os.path.isdir(log_dir):
            # A file (not a folder) is sitting where the log directory
            # needs to go - os.makedirs(..., exist_ok=True) silently
            # fails in this exact case, which otherwise surfaces as a
            # confusing generic "Internal error: No such file or
            # directory" with no indication of what's actually wrong.
            raise HTTPException(
                400,
                f"'{log_dir}' already exists but is a file, not a folder - "
                f"delete or rename it (e.g. `rm {log_dir}`) so the log "
                f"directory can be created there.",
            )
        os.makedirs(log_dir, exist_ok=True)
    try:
        log_file = open(req.log_path, "a")
    except OSError as e:
        raise HTTPException(500, f"Could not open log file '{req.log_path}': {e}")

    reader = threading.Thread(
        target=da.telemetry_reader_thread,
        args=(master, buffer, log_file, stop_event),
        daemon=True,
    )
    reader.start()

    monitor = da.SafetyMonitor(buffer, on_alert=session.push_alert)

    def monitor_loop():
        while not stop_event.is_set():
            monitor.check_once()
            time.sleep(da.MONITOR_INTERVAL_SECONDS)

    threading.Thread(target=monitor_loop, daemon=True).start()

    controller = da.FlightController(master, buffer, enabled=req.enable_actions)

    assistant = None
    ai_available = False
    try:
        assistant = da.DroneAssistant(buffer)
        ai_available = True
    except RuntimeError as e:
        session.push_alert(f"AI chat unavailable: {e}")

    session.master = master
    session.buffer = buffer
    session.controller = controller
    session.assistant = assistant
    session.stop_event = stop_event
    session.log_file = log_file
    session.log_path = req.log_path
    session.connected = True
    session.actions_enabled = req.enable_actions
    session.ai_available = ai_available

    return {
        "connected": True,
        "system_id": master.target_system,
        "component_id": master.target_component,
        "actions_enabled": session.actions_enabled,
        "ai_available": session.ai_available,
        "log_path": session.log_path,
    }


@app.post("/api/disconnect")
def disconnect():
    if not session.connected:
        return {"connected": False}
    session.stop_event.set()
    if session.log_file:
        session.log_file.close()
    session.connected = False
    return {"connected": False}


@app.get("/api/status")
def status():
    if not session.connected:
        return {"connected": False}
    return {
        "connected": True,
        "actions_enabled": session.actions_enabled,
        "ai_available": session.ai_available,
        "log_path": session.log_path,
        "snapshot": session.buffer.snapshot(),
        "pending_action": _pending_action_public(),
    }


def _pending_action_public():
    key = session.pending_action["key"]
    expires = session.pending_action["expires"]
    if not key or time.time() >= expires:
        return None
    return {
        "action": key,
        "label": da.ACTIONS[key],
        "expires_in": round(expires - time.time(), 1),
    }


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

@app.post("/api/chat")
def chat(req: ChatRequest):
    if not session.connected:
        raise HTTPException(409, "Not connected.")

    # Free text can also express a flight-action intent - surface that to
    # the UI as a pending action instead of (or in addition to) chatting,
    # mirroring the CLI's behaviour.
    action_key = da.parse_action_intent(req.message)
    if action_key:
        _arm_action(action_key)

    if not session.ai_available or session.assistant is None:
        return {
            "answer": None,
            "pending_action": _pending_action_public(),
            "error": "AI chat unavailable (Ollama not reachable).",
        }

    try:
        answer = session.assistant.ask(req.message)
    except Exception as e:
        answer = None
        return {"answer": None, "pending_action": _pending_action_public(), "error": str(e)}

    return {"answer": answer, "pending_action": _pending_action_public(), "error": None}


@app.post("/api/chat/clear")
def clear_chat():
    """Resets the assistant's conversation memory - called when the user
    clears the chat panel, so a visually-cleared chat doesn't leave the
    model still quietly remembering everything said before the clear."""
    if session.assistant is not None:
        session.assistant.history = []
    return {"cleared": True}


# ---------------------------------------------------------------------------
# Flight actions - request -> confirm/cancel, same two-step pattern as the CLI
# ---------------------------------------------------------------------------

def _arm_action(action_key: str):
    session.pending_action = {
        "key": action_key,
        "expires": time.time() + CONFIRM_WINDOW_SECONDS,
    }


@app.post("/api/actions/request")
def request_action(req: ActionRequest):
    if not session.connected:
        raise HTTPException(409, "Not connected.")
    if req.action not in da.ACTIONS:
        raise HTTPException(400, f"Unknown action '{req.action}'. Valid: {list(da.ACTIONS)}")
    _arm_action(req.action)
    return {"pending_action": _pending_action_public(), "confirm_window_seconds": CONFIRM_WINDOW_SECONDS}


@app.post("/api/actions/confirm")
def confirm_action():
    pending = _pending_action_public()
    if not pending:
        raise HTTPException(409, "No pending action to confirm (it may have expired).")
    action_key = pending["action"]
    session.pending_action = {"key": None, "expires": 0}
    result = session.controller.execute(action_key)
    session.push_alert(result)
    return {"result": result}


@app.post("/api/actions/cancel")
def cancel_action():
    had_pending = bool(_pending_action_public())
    session.pending_action = {"key": None, "expires": 0}
    return {"cancelled": had_pending}


# ---------------------------------------------------------------------------
# Offline log analysis (upload a saved .jsonl, get a written report back)
# ---------------------------------------------------------------------------

@app.post("/api/log/analyze")
async def analyze_log(file: UploadFile = File(...)):
    raw = (await file.read()).decode("utf-8", errors="replace")
    records = []
    for line in raw.splitlines():
        line = line.strip()
        if line:
            records.append(json.loads(line))
    if not records:
        raise HTTPException(400, "Uploaded log is empty.")

    scratch_buffer = da.TelemetryBuffer()
    try:
        assistant = da.DroneAssistant(scratch_buffer)
    except RuntimeError as e:
        raise HTTPException(503, str(e))

    report = assistant.full_log_analysis(records)
    return {"record_count": len(records), "report": report}


# ---------------------------------------------------------------------------
# WebSocket: pushes telemetry snapshots + new alerts to the dashboard.
# Polls the thread-safe buffer/alert deque rather than trying to bridge the
# background reader threads into asyncio - simplest thing that works.
# ---------------------------------------------------------------------------

@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket):
    await ws.accept()
    last_alert_ts = time.time()
    try:
        while True:
            if session.connected:
                await ws.send_json({
                    "type": "snapshot",
                    "data": session.buffer.snapshot(),
                    "pending_action": _pending_action_public(),
                })
                new_alerts = session.alerts_since(last_alert_ts)
                if new_alerts:
                    last_alert_ts = new_alerts[-1]["ts"]
                    for a in new_alerts:
                        await ws.send_json({"type": "alert", **a})
            else:
                await ws.send_json({"type": "disconnected"})
            await asyncio.sleep(0.2)
    except WebSocketDisconnect:
        pass


# ---------------------------------------------------------------------------
# Serve the dashboard itself. Mounted at "/" and added LAST so it only
# catches requests that didn't match an /api/* or /ws/* route above -
# lets the whole app (API + UI) run as a single deployable unit on one
# port, which is what you want for a one-container NAS deployment.
# Set FRONTEND_DIR if you're not using the default repo layout
# (backend/ and frontend/ as sibling directories).
# ---------------------------------------------------------------------------

_frontend_dir = os.environ.get("FRONTEND_DIR") or str(Path(__file__).resolve().parent.parent / "frontend")
if os.path.isdir(_frontend_dir):
    app.mount("/", StaticFiles(directory=_frontend_dir, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
