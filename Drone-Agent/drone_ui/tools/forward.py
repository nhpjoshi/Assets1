#!/usr/bin/env python3
"""
forward.py

Minimal bidirectional MAVLink forwarder: relays every message between a
serial radio and a UDP endpoint. This is a lightweight stand-in for
MAVProxy when all you need is the forwarding - MAVProxy's interactive
console drags in wx/prompt_toolkit/readline for its GUI/CLI menu, which
this doesn't need at all since it never presents a console.

Works identically on Windows and macOS - just pass the right port name.

Usage:
    # Windows
    python forward.py --master COM15 --baud 57600 --out homecloudnitish:14550

    # macOS
    python3 forward.py --master /dev/tty.usbserial-AK0SM39C --baud 57600 --out homecloudnitish:14550

Requires: pip install pymavlink pyserial
"""

import argparse
import threading

from pymavlink import mavutil


def pump(src, dst, ready_event=None):
    """Continuously relay messages from src to dst, forever. If given, sets
    ready_event after the first successful forward - used so the reverse
    direction doesn't start listening until this socket has sent at least
    one packet (Windows raises WinError 10022 if you call recvfrom() on a
    UDP socket that's never sent anything yet; macOS/Linux don't care)."""
    while True:
        msg = src.recv_match(blocking=True, timeout=1)
        if msg is None:
            continue
        dst.write(msg.get_msgbuf())
        if ready_event is not None and not ready_event.is_set():
            ready_event.set()


def main():
    parser = argparse.ArgumentParser(description="Minimal bidirectional MAVLink serial<->UDP forwarder")
    parser.add_argument("--master", required=True, help="Serial port, e.g. COM15 or /dev/tty.usbserial-...")
    parser.add_argument("--baud", type=int, default=57600)
    parser.add_argument("--out", required=True, help="host:port to forward to, e.g. homecloudnitish:14550")
    args = parser.parse_args()

    print(f"Opening {args.master} @ {args.baud} baud...")
    serial_conn = mavutil.mavlink_connection(args.master, baud=args.baud)

    print("Waiting for a MAVLink heartbeat from the flight controller...")
    serial_conn.wait_heartbeat(timeout=15)
    print(f"Heartbeat received (system {serial_conn.target_system}, component {serial_conn.target_component}).")

    print(f"Opening UDP forward to {args.out}...")
    udp_conn = mavutil.mavlink_connection(f"udpout:{args.out}")

    print("Forwarding both directions - leave this running. Ctrl+C to stop.")

    # Radio -> NAS (telemetry)
    forward_ready = threading.Event()
    threading.Thread(target=pump, args=(serial_conn, udp_conn, forward_ready), daemon=True).start()

    # Wait for the first packet to actually go out before listening for
    # replies on the same socket - see the note in pump() above.
    print("Waiting for the first packet to go out before listening for replies...")
    forward_ready.wait()

    # NAS -> radio (flight action commands sent back from the dashboard)
    pump(udp_conn, serial_conn)


if __name__ == "__main__":
    main()
