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

# Which LLM backend DroneAssistant talks to. "ollama" (default, local, free,
# no internet needed) or "anthropic" (hosted Claude API - needs
# ANTHROPIC_API_KEY, costs per request, but doesn't need a machine capable
# of running a local model - handy for underpowered hardware like a NAS).
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "ollama").strip().lower()
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")
ANTHROPIC_MAX_TOKENS = int(os.environ.get("ANTHROPIC_MAX_TOKENS", "1024"))

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
and the pilot's questions. Every message includes the current telemetry \
snapshot for context, but that doesn't mean every reply should be a status \
report - see the rule on greetings/small talk below.

Rules:
- If the pilot's message is a greeting, small talk, or otherwise not about \
  flight status (e.g. "hi", "thanks", "you there?"), respond naturally and \
  briefly like a person would - do NOT recite the telemetry snapshot. \
  Only report status when actually asked, or if something in the current \
  data is urgent enough that a pilot would want to know immediately \
  regardless of what they said (e.g. critical battery, lost GPS fix).
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
- If everything looks nominal and the pilot asked about status, say so \
  briefly instead of manufacturing concerns.
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

TRACKED_TYPES = {"GPS_RAW_INT", "ATTITUDE", "SYS_STATUS", "GLOBAL_POSITION_INT", "COMMAND_ACK"}

MESSAGE_IDS = {
    "SYS_STATUS": 1,
    "GPS_RAW_INT": 24,
    "ATTITUDE": 30,
    "GLOBAL_POSITION_INT": 33,
}


def request_telemetry_streams(master, rate_hz=4):
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
        pass


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
# Flight control
# ---------------------------------------------------------------------------

ACTIONS = {
    "rtl": "Return to Launch",
    "loiter": "Loiter (hold position)",
    "alt_hold": "Altitude Hold",
}

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
        return False, None

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
        if not self.enabled:
            return (
                "Flight actions are disabled. Restart with actions enabled "
                "to allow sending commands to the aircraft."
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
# Ollama-backed conversational assistant
# ---------------------------------------------------------------------------

class DroneAssistant:
    def __init__(self, buffer: TelemetryBuffer):
        self.buffer = buffer
        self.history = []
        if LLM_PROVIDER == "anthropic":
            self._check_anthropic_configured()
        elif LLM_PROVIDER == "ollama":
            if requests is None:
                raise RuntimeError("Install the requests package: pip install requests")
            self._check_ollama_reachable()
        else:
            raise RuntimeError(
                f"Unknown LLM_PROVIDER '{LLM_PROVIDER}'. Use 'ollama' or 'anthropic'."
            )

    def _check_ollama_reachable(self):
        try:
            requests.get(f"{OLLAMA_HOST}/api/tags", timeout=5)
        except requests.exceptions.RequestException as e:
            raise RuntimeError(
                f"Can't reach Ollama at {OLLAMA_HOST} ({e}). "
                f"Start it with 'ollama serve' and make sure '{MODEL}' is pulled "
                f"('ollama pull {MODEL}')."
            )

    def _check_anthropic_configured(self):
        try:
            import anthropic  # noqa: F401
        except ImportError:
            raise RuntimeError("Install the anthropic package: pip install anthropic")
        if not ANTHROPIC_API_KEY:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set. Export it, or add it to the "
                "container's environment (see docker-compose.yml)."
            )

    def _chat(self, messages, max_retries=1):
        if LLM_PROVIDER == "anthropic":
            return self._chat_anthropic(messages)
        return self._chat_ollama(messages)

    def _chat_ollama(self, messages):
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

    def _chat_anthropic(self, messages):
        import anthropic

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        try:
            response = client.messages.create(
                model=ANTHROPIC_MODEL,
                max_tokens=ANTHROPIC_MAX_TOKENS,
                system=SYSTEM_PROMPT,
                # `messages` is already [{"role": "user"/"assistant", "content": ...}, ...] -
                # the same shape self.history already builds for Ollama, minus a
                # system-role entry (Claude takes that as a separate top-level
                # `system` param instead of inline in the message list).
                messages=messages,
            )
        except anthropic.APIError as e:
            raise RuntimeError(f"Claude API request failed: {e}")

        text = "".join(block.text for block in response.content if getattr(block, "type", None) == "text")
        if not text:
            raise RuntimeError(f"Claude API returned no text content: {response}")
        return text

    def ask(self, question: str) -> str:
        telemetry_context = self.buffer.summarize_for_llm()
        user_message = (
            f"<telemetry_snapshot>\n{telemetry_context}\n</telemetry_snapshot>\n\n"
            f"{question}"
        )

        self.history.append({"role": "user", "content": user_message})
        self.history = self.history[-10:]

        answer = self._chat(self.history)
        self.history.append({"role": "assistant", "content": answer})
        return answer

    def full_log_analysis(self, records) -> str:
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
