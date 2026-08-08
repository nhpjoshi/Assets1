#!/usr/bin/env python3
"""
drone_assistant.py

A conversational AI layer on top of pymavlink telemetry.

- Connects to a MAVLink telemetry radio, exactly like the original script.
- Runs telemetry reading in a background thread, so the terminal stays free
  for you to chat.
- Buffers recent readings (GPS, attitude, battery, altitude) and appends
  every message to a JSONL log file on disk.
- Runs cheap, local, rule-based safety checks continuously (no API calls)
  and prints an immediate warning the instant something looks wrong.
- Lets you ask free-form questions in the terminal ("how's the battery
  trending?", "is the GPS fix good enough to fly?", "should I RTL?") -
  each question is sent to a local Ollama model together with a compact,
  real summary of the recent telemetry, so answers are grounded in actual
  data.
- Can also analyze a previously saved log file after the flight
  (`--analyze-log path.jsonl`), producing a written post-flight summary.

Uses a local Ollama server for the AI chat - no API key, no internet
required. Everything stays on the machine running this script.

Setup:
    pip install pymavlink pyserial requests
    ollama pull llama3:8b
    ollama serve          # if not already running

Run (live):
    python drone_assistant.py --port /dev/tty.usbserial-AK0SM39C --baud 57600

Run (offline analysis of a saved log):
    python drone_assistant.py --analyze-log telemetry_log.jsonl
"""

import argparse
import json
import os
import statistics
import sys
import threading
import time
from collections import deque
from datetime import datetime, timezone

try:
    from pymavlink import mavutil
except ImportError:
    mavutil = None  # only required for live mode; offline analysis doesn't need it

try:
    import requests
except ImportError:
    requests = None  # only required for AI chat; monitor/log-only mode doesn't need it


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
MODEL = os.environ.get("OLLAMA_MODEL", "llama3:8b")
OLLAMA_TIMEOUT_SECONDS = 60
LOG_PATH_DEFAULT = "telemetry_log.jsonl"
BUFFER_WINDOW_SECONDS = 120       # how much recent history to keep in memory
MONITOR_INTERVAL_SECONDS = 10     # how often the rule-based checker runs
ALERT_COOLDOWN_SECONDS = 60       # don't repeat the same alert more than once a minute

# Rule-based thresholds (cheap, instant, no API call needed)
THRESHOLDS = {
    "battery_pct_warn": 30,
    "battery_pct_critical": 15,
    "voltage_warn": 10.5,       # adjust to your battery chemistry/cell count
    "gps_fix_min_ok": 3,        # 3D fix or better
    "gps_sats_min_ok": 6,
    "roll_pitch_warn_deg": 45,  # aggressive attitude excursion
}

SYSTEM_PROMPT = """You are an experienced UAV flight-operations analyst embedded in a \
live ground-control terminal. You receive real MAVLink telemetry summaries \
(GPS fix/satellites/position, attitude, battery voltage/percentage, altitude) \
and the pilot's questions.

Rules:
- Base every claim strictly on the telemetry data given to you. Never invent \
  numbers, positions, or trends that aren't in the provided summary.
- If the data given is insufficient to answer confidently, say so plainly \
  rather than guessing.
- When something looks unsafe (low battery, poor GPS fix, extreme attitude, \
  falling voltage trend), state it clearly and give a concrete, actionable \
  recommendation (e.g. "return to launch now", "land immediately", \
  "hold position and reacquire GPS fix" ) rather than vague caution.
- Keep answers concise and operational - this is read in a terminal during \
  or right after a flight, not a report to be studied later.
- If everything looks nominal, say so briefly instead of manufacturing concerns.
"""


# ---------------------------------------------------------------------------
# Telemetry buffer: thread-safe rolling history + latest snapshot
# ---------------------------------------------------------------------------

class TelemetryBuffer:
    def __init__(self, window_seconds=BUFFER_WINDOW_SECONDS):
        self.window_seconds = window_seconds
        self.lock = threading.Lock()
        self.latest = {}                      # msg_type -> most recent fields dict
        self.history = deque(maxlen=5000)     # list of (ts, msg_type, fields)

    def add(self, msg_type, fields):
        ts = time.time()
        entry = {"ts": ts, **fields}
        with self.lock:
            self.latest[msg_type] = entry
            self.history.append((ts, msg_type, entry))
            self._trim_locked()

    def _trim_locked(self):
        cutoff = time.time() - self.window_seconds
        while self.history and self.history[0][0] < cutoff:
            self.history.popleft()

    def snapshot(self):
        with self.lock:
            return dict(self.latest)

    def recent(self, msg_type, seconds=None):
        seconds = seconds or self.window_seconds
        cutoff = time.time() - seconds
        with self.lock:
            return [f for (ts, t, f) in self.history if t == msg_type and ts >= cutoff]

    def summarize_for_llm(self):
        """Compact, human-readable summary of recent telemetry - kept small
        on purpose so every chat turn stays cheap and fast."""
        lines = []
        latest = self.snapshot()

        gps = latest.get("GPS_RAW_INT")
        if gps:
            lines.append(
                f"GPS (latest): fix_type={gps.get('fix_type')} "
                f"satellites={gps.get('satellites_visible')} "
                f"lat={gps.get('lat', 0) / 1e7:.7f} lon={gps.get('lon', 0) / 1e7:.7f}"
            )
            recent_gps = self.recent("GPS_RAW_INT", seconds=60)
            if recent_gps:
                sats = [g.get("satellites_visible", 0) for g in recent_gps]
                fixes = [g.get("fix_type", 0) for g in recent_gps]
                lines.append(
                    f"GPS (last 60s): satellites min/avg/max = "
                    f"{min(sats)}/{statistics.mean(sats):.1f}/{max(sats)}, "
                    f"min fix_type={min(fixes)}"
                )

        att = latest.get("ATTITUDE")
        if att:
            lines.append(
                f"Attitude (latest): roll={att.get('roll', 0):.2f} "
                f"pitch={att.get('pitch', 0):.2f} yaw={att.get('yaw', 0):.2f} (radians)"
            )

        sys_status = latest.get("SYS_STATUS")
        if sys_status:
            v = sys_status.get("voltage_battery", 0) / 1000
            pct = sys_status.get("battery_remaining")
            lines.append(f"Battery (latest): voltage={v:.2f}V remaining={pct}%")
            recent_batt = self.recent("SYS_STATUS", seconds=90)
            if len(recent_batt) >= 2:
                volts = [b.get("voltage_battery", 0) / 1000 for b in recent_batt]
                trend = volts[-1] - volts[0]
                lines.append(
                    f"Battery voltage trend (last 90s): {trend:+.2f}V "
                    f"({'declining' if trend < -0.05 else 'stable/rising'})"
                )

        pos = latest.get("GLOBAL_POSITION_INT")
        if pos:
            lines.append(f"Altitude (latest, relative): {pos.get('relative_alt', 0) / 1000:.2f} m")
        else:
            lines.append("Altitude: no GLOBAL_POSITION_INT received yet.")

        if not gps:
            lines.append(
                "GPS: no GPS_RAW_INT received yet - either the stream hasn't started, "
                "or this vehicle has no GPS module attached."
            )
        if not att:
            lines.append("Attitude: no ATTITUDE messages received yet.")
        if not sys_status:
            lines.append("Battery: no SYS_STATUS messages received yet.")

        if not lines:
            lines.append("No telemetry received yet.")

        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Rule-based, no-API-call safety monitor
# ---------------------------------------------------------------------------

class SafetyMonitor:
    """Cheap threshold checks that run continuously without hitting the API.
    Keeps a cooldown per alert key so the terminal isn't spammed."""

    def __init__(self, buffer: TelemetryBuffer, on_alert):
        self.buffer = buffer
        self.on_alert = on_alert
        self._last_fired = {}

    def _should_fire(self, key):
        last = self._last_fired.get(key, 0)
        if time.time() - last >= ALERT_COOLDOWN_SECONDS:
            self._last_fired[key] = time.time()
            return True
        return False

    def check_once(self):
        latest = self.buffer.snapshot()

        sys_status = latest.get("SYS_STATUS")
        if sys_status:
            pct = sys_status.get("battery_remaining")
            v = sys_status.get("voltage_battery", 0) / 1000
            if pct is not None and pct >= 0:
                if pct <= THRESHOLDS["battery_pct_critical"] and self._should_fire("batt_crit"):
                    self.on_alert(f"CRITICAL: battery at {pct}% ({v:.2f}V)")
                elif pct <= THRESHOLDS["battery_pct_warn"] and self._should_fire("batt_warn"):
                    self.on_alert(f"WARNING: battery at {pct}% ({v:.2f}V)")
            if v and v <= THRESHOLDS["voltage_warn"] and self._should_fire("volt_warn"):
                self.on_alert(f"WARNING: battery voltage low at {v:.2f}V")

        gps = latest.get("GPS_RAW_INT")
        if gps:
            fix = gps.get("fix_type", 0)
            sats = gps.get("satellites_visible", 0)
            if fix < THRESHOLDS["gps_fix_min_ok"] and self._should_fire("gps_fix"):
                self.on_alert(f"WARNING: weak GPS fix (fix_type={fix}, satellites={sats})")
            elif sats < THRESHOLDS["gps_sats_min_ok"] and self._should_fire("gps_sats"):
                self.on_alert(f"WARNING: low satellite count ({sats})")

        att = latest.get("ATTITUDE")
        if att:
            import math
            roll_deg = math.degrees(att.get("roll", 0))
            pitch_deg = math.degrees(att.get("pitch", 0))
            limit = THRESHOLDS["roll_pitch_warn_deg"]
            if abs(roll_deg) > limit and self._should_fire("roll"):
                self.on_alert(f"WARNING: extreme roll angle ({roll_deg:.1f} deg)")
            if abs(pitch_deg) > limit and self._should_fire("pitch"):
                self.on_alert(f"WARNING: extreme pitch angle ({pitch_deg:.1f} deg)")


# ---------------------------------------------------------------------------
# MAVLink reader thread
# ---------------------------------------------------------------------------

# Message types we care about; keeps the log file and buffer focused.
# COMMAND_ACK is included so the FlightController below can confirm whether
# a sent command was accepted, without a second thread competing for
# recv_match() on the same connection.
TRACKED_TYPES = {"GPS_RAW_INT", "ATTITUDE", "SYS_STATUS", "GLOBAL_POSITION_INT", "COMMAND_ACK"}

# Standard MAVLink common-dialect message IDs for the types we track.
# Needed because many autopilots (PX4 especially, and some ArduPilot setups)
# do NOT push these automatically just because a GCS connected - they only
# start streaming once explicitly asked via SET_MESSAGE_INTERVAL or the
# older REQUEST_DATA_STREAM. QGroundControl/Mission Planner do this for you
# silently; a bare pymavlink connection does not, unless you ask.
MESSAGE_IDS = {
    "SYS_STATUS": 1,
    "GPS_RAW_INT": 24,
    "ATTITUDE": 30,
    "GLOBAL_POSITION_INT": 33,
}


def request_telemetry_streams(master, rate_hz=4):
    """Explicitly ask the autopilot to stream the message types we track.
    Uses both the modern per-message approach (works on PX4 and recent
    ArduPilot) and the legacy request-data-stream approach (older
    ArduPilot), since it's cheap to send both and we'd rather be sure."""
    interval_us = int(1e6 / rate_hz)

    for name, msg_id in MESSAGE_IDS.items():
        master.mav.command_long_send(
            master.target_system, master.target_component,
            mavutil.mavlink.MAV_CMD_SET_MESSAGE_INTERVAL, 0,
            msg_id, interval_us, 0, 0, 0, 0, 0,
        )
        time.sleep(0.05)

    try:
        master.mav.request_data_stream_send(
            master.target_system, master.target_component,
            mavutil.mavlink.MAV_DATA_STREAM_ALL, rate_hz, 1,
        )
    except Exception:
        pass  # legacy call isn't supported by every dialect/firmware - fine if it's a no-op


def telemetry_reader_thread(master, buffer: TelemetryBuffer, log_file, stop_event):
    while not stop_event.is_set():
        msg = master.recv_match(blocking=True, timeout=1)
        if msg is None:
            continue

        mtype = msg.get_type()
        if mtype not in TRACKED_TYPES:
            continue

        fields = msg.to_dict()
        fields.pop("mavpackettype", None)
        buffer.add(mtype, fields)

        if log_file:
            record = {
                "ts": datetime.now(timezone.utc).isoformat(),
                "type": mtype,
                "fields": fields,
            }
            log_file.write(json.dumps(record) + "\n")
            log_file.flush()


# ---------------------------------------------------------------------------
# Flight control: sends real MAVLink commands to the aircraft.
#
# All sends go through here, serialized by a lock. Acknowledgements are read
# from the TelemetryBuffer (populated by the single reader thread) rather
# than calling recv_match() a second time from here - two threads both
# blocking on recv_match() for the same connection would race for messages.
# ---------------------------------------------------------------------------

ACTIONS = {
    "rtl": "Return to Launch",
    "loiter": "Loiter (hold position)",
    "alt_hold": "Altitude Hold",
}

# Free-text phrases that map to each action, used to detect intent in chat.
# Longer/more specific phrases are checked before shorter ones to avoid
# "hold" in "alt hold" being mistaken for "hold position" (loiter).
ACTION_ALIASES = [
    ("alt_hold", "alt hold"),
    ("alt_hold", "altitude hold"),
    ("alt_hold", "hold altitude"),
    ("alt_hold", "hold your altitude"),
    ("alt_hold", "hold my altitude"),
    ("rtl", "rtl"),
    ("rtl", "return to launch"),
    ("rtl", "return to home"),
    ("rtl", "return home"),
    ("rtl", "come home"),
    ("rtl", "come back"),
    ("rtl", "go home"),
    ("rtl", "bring it home"),
    ("rtl", "bring it to home"),
    ("rtl", "bring it back"),
    ("loiter", "loiter"),
    ("loiter", "hold position"),
    ("loiter", "hold your position"),
    ("loiter", "hold my position"),
    ("loiter", "circle here"),
    ("loiter", "stay there"),
    ("loiter", "stay here"),
    ("loiter", "hover there"),
    ("loiter", "hover here"),
]


def parse_action_intent(text):
    """Best-effort detection of an action request in free text. Returns an
    action key from ACTIONS, or None if nothing matched."""
    t = text.lower().strip()
    for action_key, alias in ACTION_ALIASES:
        if alias in t:
            return action_key
    return None


class FlightController:
    def __init__(self, master, buffer: TelemetryBuffer, enabled: bool):
        self.master = master
        self.buffer = buffer
        self.enabled = enabled
        self.send_lock = threading.Lock()

    def _send_command_long(self, command, params):
        with self.send_lock:
            self.master.mav.command_long_send(
                self.master.target_system,
                self.master.target_component,
                command,
                0,
                *params,
            )

    def _wait_ack(self, command, sent_after_ts, timeout=5):
        deadline = time.time() + timeout
        while time.time() < deadline:
            for ack in self.buffer.recent("COMMAND_ACK", seconds=timeout + 1):
                if ack.get("command") == command and ack.get("ts", 0) >= sent_after_ts:
                    result = ack.get("result")
                    accepted = result == mavutil.mavlink.MAV_RESULT_ACCEPTED
                    return accepted, result
            time.sleep(0.2)
        return False, None  # timed out - no ack seen (command may or may not have landed)

    def return_to_launch(self, timeout=5):
        sent_ts = time.time()
        self._send_command_long(mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH, [0] * 7)
        return self._wait_ack(mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH, sent_ts, timeout)

    def set_mode(self, mode_name, timeout=5):
        mapping = self.master.mode_mapping()
        if not mapping or mode_name not in mapping:
            available = sorted((mapping or {}).keys())
            raise ValueError(
                f"Mode '{mode_name}' isn't available on this vehicle/firmware. "
                f"Available modes: {available}"
            )
        mode_id = mapping[mode_name]
        sent_ts = time.time()
        self._send_command_long(
            mavutil.mavlink.MAV_CMD_DO_SET_MODE,
            [mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, mode_id, 0, 0, 0, 0, 0],
        )
        return self._wait_ack(mavutil.mavlink.MAV_CMD_DO_SET_MODE, sent_ts, timeout)

    def loiter(self, timeout=5):
        return self.set_mode("LOITER", timeout=timeout)

    def alt_hold(self, timeout=5):
        return self.set_mode("ALT_HOLD", timeout=timeout)

    def execute(self, action_key, timeout=5):
        """Runs the named action (from ACTIONS) and returns a human-readable
        result string. Raises ValueError for an unknown action key."""
        if not self.enabled:
            return (
                "Flight actions are disabled. Restart the script with "
                "--enable-actions to allow sending commands to the aircraft."
            )
        try:
            if action_key == "rtl":
                accepted, result = self.return_to_launch(timeout=timeout)
            elif action_key == "loiter":
                accepted, result = self.loiter(timeout=timeout)
            elif action_key == "alt_hold":
                accepted, result = self.alt_hold(timeout=timeout)
            else:
                raise ValueError(f"Unknown action: {action_key}")
        except Exception as e:
            return f"Failed to send {ACTIONS[action_key]}: {e}"

        if accepted:
            return f"{ACTIONS[action_key]} command ACCEPTED by the vehicle."
        elif result is None:
            return (
                f"{ACTIONS[action_key]} command sent, but no acknowledgement was "
                f"received within {timeout}s. Verify the vehicle's actual mode/state manually."
            )
        else:
            return f"{ACTIONS[action_key]} command REJECTED by the vehicle (result code {result})."


# ---------------------------------------------------------------------------
# Ollama-backed conversational assistant (local, no API key, no internet)
# ---------------------------------------------------------------------------

class DroneAssistant:
    def __init__(self, buffer: TelemetryBuffer):
        if requests is None:
            raise RuntimeError("Install the requests package: pip install requests")
        self._check_ollama_reachable()
        self.buffer = buffer
        self.history = []  # list of {"role": ..., "content": ...}, kept short

    def _check_ollama_reachable(self):
        try:
            requests.get(f"{OLLAMA_HOST}/api/tags", timeout=5)
        except requests.exceptions.RequestException as e:
            raise RuntimeError(
                f"Can't reach Ollama at {OLLAMA_HOST} ({e}). "
                f"Start it with 'ollama serve' and make sure '{MODEL}' is pulled "
                f"('ollama pull {MODEL}')."
            )

    def _chat(self, messages, max_retries=1):
        """POST to Ollama's /api/chat and return the assistant's reply text."""
        payload = {
            "model": MODEL,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
            "stream": False,
        }
        try:
            resp = requests.post(
                f"{OLLAMA_HOST}/api/chat",
                json=payload,
                timeout=OLLAMA_TIMEOUT_SECONDS,
            )
            resp.raise_for_status()
        except requests.exceptions.RequestException as e:
            raise RuntimeError(f"Ollama request failed: {e}")

        data = resp.json()
        message = data.get("message", {})
        content = message.get("content", "")
        if not content:
            raise RuntimeError(f"Ollama returned an empty response: {data}")
        return content

    def ask(self, question: str) -> str:
        telemetry_context = self.buffer.summarize_for_llm()
        user_message = (
            f"<telemetry_snapshot>\n{telemetry_context}\n</telemetry_snapshot>\n\n"
            f"{question}"
        )

        self.history.append({"role": "user", "content": user_message})
        self.history = self.history[-10:]  # keep context small/cheap - matters more
                                             # for local models with smaller context windows

        answer = self._chat(self.history)
        self.history.append({"role": "assistant", "content": answer})
        return answer

    def full_log_analysis(self, records) -> str:
        """One-shot post-flight analysis over an entire saved log."""
        summary = summarize_full_log(records)
        prompt = (
            "This is a complete post-flight telemetry log summary (not just recent data). "
            "Give a written post-flight report: overall flight health, any safety events "
            "that occurred (battery, GPS, attitude), and concrete recommendations for the "
            "next flight or maintenance.\n\n"
            f"<full_flight_summary>\n{summary}\n</full_flight_summary>"
        )
        return self._chat([{"role": "user", "content": prompt}])


def summarize_full_log(records):
    """Aggregate stats across an entire log file for offline analysis."""
    by_type = {}
    for r in records:
        by_type.setdefault(r["type"], []).append(r)

    lines = [f"Total records: {len(records)}"]
    if records:
        lines.append(f"Time range: {records[0]['ts']} to {records[-1]['ts']}")

    if "SYS_STATUS" in by_type:
        volts = [r["fields"].get("voltage_battery", 0) / 1000 for r in by_type["SYS_STATUS"]]
        pcts = [r["fields"].get("battery_remaining") for r in by_type["SYS_STATUS"] if r["fields"].get("battery_remaining", -1) >= 0]
        if volts:
            lines.append(f"Battery voltage: min={min(volts):.2f}V max={max(volts):.2f}V start={volts[0]:.2f}V end={volts[-1]:.2f}V")
        if pcts:
            lines.append(f"Battery %: min={min(pcts)} max={max(pcts)} start={pcts[0]} end={pcts[-1]}")

    if "GPS_RAW_INT" in by_type:
        fixes = [r["fields"].get("fix_type", 0) for r in by_type["GPS_RAW_INT"]]
        sats = [r["fields"].get("satellites_visible", 0) for r in by_type["GPS_RAW_INT"]]
        weak_fix_count = sum(1 for f in fixes if f < THRESHOLDS["gps_fix_min_ok"])
        lines.append(
            f"GPS: fix_type min={min(fixes)} max={max(fixes)}, "
            f"satellites min={min(sats)} max={max(sats)} avg={statistics.mean(sats):.1f}, "
            f"readings below fix_type {THRESHOLDS['gps_fix_min_ok']}: {weak_fix_count}/{len(fixes)}"
        )

    if "ATTITUDE" in by_type:
        import math
        rolls = [abs(math.degrees(r["fields"].get("roll", 0))) for r in by_type["ATTITUDE"]]
        pitches = [abs(math.degrees(r["fields"].get("pitch", 0))) for r in by_type["ATTITUDE"]]
        lines.append(f"Attitude: max |roll|={max(rolls):.1f} deg, max |pitch|={max(pitches):.1f} deg")

    if "GLOBAL_POSITION_INT" in by_type:
        alts = [r["fields"].get("relative_alt", 0) / 1000 for r in by_type["GLOBAL_POSITION_INT"]]
        lines.append(f"Altitude: min={min(alts):.1f}m max={max(alts):.1f}m end={alts[-1]:.1f}m")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

def run_live(args):
    if mavutil is None:
        sys.exit("pymavlink is required for live mode: pip install pymavlink pyserial")

    print("Connecting...")
    master = mavutil.mavlink_connection(args.port, baud=args.baud)
    print("Waiting for heartbeat...")
    master.wait_heartbeat()
    print("Connected!")
    print(f"System ID : {master.target_system}")
    print(f"Component : {master.target_component}")
    print("------------------------------------")

    print(f"Requesting telemetry streams at {args.stream_rate} Hz...")
    request_telemetry_streams(master, rate_hz=args.stream_rate)

    buffer = TelemetryBuffer()
    stop_event = threading.Event()
    log_file = open(args.log, "a")

    reader = threading.Thread(
        target=telemetry_reader_thread,
        args=(master, buffer, log_file, stop_event),
        daemon=True,
    )
    reader.start()

    def print_alert(msg):
        print(f"\n[ALERT] {msg}")
        print("You> ", end="", flush=True)

    monitor = SafetyMonitor(buffer, on_alert=print_alert)

    def monitor_loop():
        while not stop_event.is_set():
            monitor.check_once()
            time.sleep(MONITOR_INTERVAL_SECONDS)

    threading.Thread(target=monitor_loop, daemon=True).start()

    fc = FlightController(master, buffer, enabled=args.enable_actions)
    if args.enable_actions:
        print("[flight control] ENABLED - RTL/LOITER/ALT_HOLD commands can be sent to the aircraft after /confirm")
    else:
        print("[flight control] disabled (read-only) - restart with --enable-actions to allow sending commands")

    assistant = None
    if not args.no_ai:
        try:
            assistant = DroneAssistant(buffer)
        except RuntimeError as e:
            print(f"[warn] AI chat disabled: {e}")

    print("\nLogging telemetry to:", args.log)
    print("Commands: /status  /analyze  /rtl  /loiter  /alt_hold  /confirm  /cancel  /help  /quit")
    print("(you can also just type e.g. 'return to launch' or 'loiter' - it will ask you to /confirm)\n")

    pending_action = {"key": None, "expires": 0}
    CONFIRM_WINDOW_SECONDS = 30
    # Exact whitelist only - no fuzzy/typo matching on anything that can
    # move the aircraft. If it's not one of these, it does NOT confirm.
    CONFIRM_WORDS = {"/confirm", "confirm", "yes", "y", "do it", "go ahead", "execute", "send it"}
    CANCEL_WORDS = {"/cancel", "cancel", "no", "n", "stop", "abort"}

    try:
        while True:
            try:
                user_input = input("You> ").strip()
            except EOFError:
                break

            if not user_input:
                continue

            user_input_lower = user_input.lower()

            if user_input in ("/quit", "/exit"):
                break

            if user_input == "/help":
                print("/status   - print latest raw telemetry snapshot")
                print("/analyze  - ask the AI for a full status analysis + recommendations")
                print("/rtl /loiter /alt_hold - request a flight action (requires confirmation to actually send)")
                print("/confirm (or 'yes'/'confirm'/'go ahead') - execute the pending action requested above")
                print("/cancel  (or 'no'/'cancel'/'stop')       - cancel the pending action")
                print("/quit     - exit")
                print("(anything else is sent to the AI as a question, with live telemetry attached;")
                print(" phrases like 'RTL' or 'hold position' are also detected as action requests)")
                continue

            if user_input == "/status":
                snap = buffer.snapshot()
                if not snap:
                    print("No telemetry received yet.")
                else:
                    for mtype, fields in snap.items():
                        print(f"{mtype}: {fields}")
                continue

            has_pending = pending_action["key"] and time.time() < pending_action["expires"]

            if user_input_lower in CANCEL_WORDS:
                if has_pending:
                    print(f"Cancelled pending {ACTIONS[pending_action['key']]}.")
                else:
                    print("No pending action.")
                pending_action = {"key": None, "expires": 0}
                continue

            if user_input_lower in CONFIRM_WORDS:
                if has_pending:
                    action_key = pending_action["key"]
                    pending_action = {"key": None, "expires": 0}
                    print(f"Sending {ACTIONS[action_key]}...")
                    print(fc.execute(action_key))
                else:
                    print("No pending action to confirm (or it expired - just ask again).")
                continue

            # explicit slash commands or free-text phrases both request an action,
            # but neither one executes it directly - both just arm the confirmation
            action_key = {"/rtl": "rtl", "/loiter": "loiter", "/alt_hold": "alt_hold"}.get(user_input)
            if action_key is None:
                action_key = parse_action_intent(user_input)

            if action_key:
                pending_action = {"key": action_key, "expires": time.time() + CONFIRM_WINDOW_SECONDS}
                print(
                    f"Ready to send: {ACTIONS[action_key]}. "
                    f"Type /confirm (or 'yes') within {CONFIRM_WINDOW_SECONDS}s to actually send it, "
                    f"or /cancel (or 'no')."
                )
                continue

            # nothing matched as a command/action - if there was still a live pending
            # action, say so explicitly rather than silently treating this as unrelated
            # chat and letting the pending action quietly sit there or expire unnoticed
            if has_pending:
                remaining = int(pending_action["expires"] - time.time())
                print(
                    f"[Note: {ACTIONS[pending_action['key']]} is still pending confirmation "
                    f"({remaining}s left) - type /confirm or /cancel]"
                )

            if assistant is None:
                print("[AI chat unavailable - make sure 'ollama serve' is running "
                      f"and '{MODEL}' is pulled, then remove --no-ai]")
                continue

            question = (
                "Give me a full analysis of current flight status and any recommendations."
                if user_input == "/analyze"
                else user_input
            )
            print("Assistant> ", end="", flush=True)
            try:
                answer = assistant.ask(question)
            except Exception as e:
                answer = f"[error contacting Ollama: {e}]"
            print(answer)

    finally:
        stop_event.set()
        log_file.close()
        print("\nStopped. Log saved to", args.log)


def run_analyze_log(args):
    if requests is None:
        sys.exit("requests package is required: pip install requests")

    if not os.path.exists(args.analyze_log):
        sys.exit(f"Log file not found: {args.analyze_log}")

    records = []
    with open(args.analyze_log) as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))

    if not records:
        sys.exit("Log file is empty.")

    print(f"Loaded {len(records)} telemetry records from {args.analyze_log}")
    print(f"Summarizing and sending to Ollama ({MODEL}) for post-flight analysis...\n")

    buffer = TelemetryBuffer()  # unused for context, kept for constructor compatibility
    try:
        assistant = DroneAssistant(buffer)
    except RuntimeError as e:
        sys.exit(str(e))
    report = assistant.full_log_analysis(records)

    print("=" * 60)
    print("POST-FLIGHT ANALYSIS")
    print("=" * 60)
    print(report)


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Conversational drone telemetry assistant")
    parser.add_argument("--port", default="/dev/tty.usbserial-AK0SM39C", help="Telemetry radio serial port")
    parser.add_argument("--baud", type=int, default=57600, help="Baud rate")
    parser.add_argument(
        "--stream-rate", type=float, default=4.0,
        help="Hz to request GPS/attitude/battery/altitude telemetry at (default 4)",
    )
    parser.add_argument("--log", default=LOG_PATH_DEFAULT, help="Path to append telemetry JSONL log")
    parser.add_argument("--no-ai", action="store_true", help="Run without AI chat (monitor + log only)")
    parser.add_argument(
        "--enable-actions",
        action="store_true",
        help="Allow sending real flight commands (RTL/LOITER/ALT_HOLD) to the aircraft. "
             "Without this flag, actions are detected and confirmed but never actually sent.",
    )
    parser.add_argument("--analyze-log", help="Skip live connection; analyze a saved JSONL log file instead")
    args = parser.parse_args()

    if args.analyze_log:
        run_analyze_log(args)
    else:
        run_live(args)


if __name__ == "__main__":
    main()
