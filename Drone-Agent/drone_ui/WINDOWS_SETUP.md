# Windows setup — forwarding radio telemetry to LabAtHome Ground Control

This is the Windows-side runbook: everything needed to get telemetry from
a radio plugged into a Windows laptop flowing to the dashboard running on
the NAS. Run these in **PowerShell**, in order.

The backend/dashboard itself runs on the NAS (see the main `README.md`
for that side) — this machine's only job is relaying the serial radio
over the network to it.

---

## 1. Find the radio's COM port

Plug the radio's USB adapter in, then run:

```powershell
Get-PnpDevice -Class Ports -PresentOnly | Select-Object Status, FriendlyName
```

Look for a line like `USB Serial Port (COM15)` — that `COMx` is what
you'll use in every command below. If nothing shows up here, see
**Troubleshooting** at the bottom before continuing.

## 2. Install Python dependencies

```powershell
pip install pymavlink pyserial
```

If `pip` isn't recognized, use the Python launcher instead:

```powershell
py -m pip install pymavlink pyserial
```

## 3. (Optional but recommended) Sanity-check the hardware with Mission Planner

Before relying on any of our own code, confirm the flight controller
itself is actually alive and talking. Download Mission Planner from
https://ardupilot.org/planner/, open it, set the **COM port** (from step 1)
and **baud rate** (`57600`, or whatever your radio is configured for) in
the top-right dropdowns, and click **Connect**. You should see live
telemetry populate within a few seconds.

**Close Mission Planner before moving on** — only one program can hold
the COM port at a time, and the next step needs it.

## 4. Run the forwarder

Save `tools/forward.py` (from this repo) somewhere on this machine, then:

```powershell
python forward.py --master COM15 --baud 57600 --out homecloudnitish:14550
```

Replace `COM15` with your actual port from step 1, and
`homecloudnitish` with your NAS's actual Tailscale hostname or IP.

You should see:
```
Opening COM15 @ 57600 baud...
Waiting for a MAVLink heartbeat from the flight controller...
Heartbeat received (system X, component Y).
Opening UDP forward to homecloudnitish:14550...
Forwarding both directions - leave this running. Ctrl+C to stop.
Waiting for the first packet to go out before listening for replies...
```

**Leave this window open and running** for the entire time you're using
the dashboard — it's the live bridge between the radio and the NAS. If
you close it, telemetry stops.

## 5. Connect from the dashboard

Open `http://<nas-tailscale-name>:8765` (e.g. `http://homecloudnitish:8765`)
in a browser — on this machine or any other device on the same tailnet.

In the connect form at the top:
- **Port field:** `udpin:0.0.0.0:14550` — **not** `COM15`. `COM15` only
  exists on this Windows machine; the dashboard's backend runs on the
  NAS and has no such device. `udpin:0.0.0.0:14550` tells the NAS-side
  backend to listen for the stream `forward.py` is sending it.
- **Baud field:** ignored for network connections, leave as-is.
- **Arm actions:** check this only if you actually want RTL/LOITER/ALT_HOLD
  to reach the real aircraft.

Click **Connect**. If `forward.py` is still running and has a heartbeat,
telemetry should start populating within a couple of seconds.

---

## Troubleshooting

**Nothing shows up in step 1 (`Get-PnpDevice`).**
Check Device Manager (right-click Start → Device Manager → "Ports (COM &
LPT)"). If it's under "Other devices" with a yellow warning icon instead,
Windows sees the hardware but has no driver — find the chip name (often
printed on the adapter: CP210x, FTDI FT232, CH340/CH341) and install that
vendor's driver. If it's not listed anywhere at all, try a different USB
cable (many are power-only, no data lines) and a different port.

**`ModuleNotFoundError` when running `forward.py`.**
Missing dependency — `pip install <missing module name>` and retry. This
script only needs `pymavlink` and `pyserial`, so this shouldn't happen
unless step 2 was skipped.

**`Failed to connect to COMx : [Errno 2] ...`.**
Something else has the port open — close Mission Planner or any other
serial tool first. Only one program can hold a COM port at a time.

**Dashboard says `Could not open 'COM15'` or similar.**
This means `COM15` (or a serial path) was typed into the dashboard's
connect form. That's wrong — the dashboard runs on the NAS, which has no
COM ports at all. Use `udpin:0.0.0.0:14550` there instead (see step 5).

**Dashboard still shows no data after connecting with `udpin:0.0.0.0:14550`.**
Confirm `forward.py` is still running and hasn't crashed, and that its
`--out` hostname actually matches the NAS you're pointed at. Also check
the small freshness dot next to each instrument card in the dashboard —
red means no recent data for that message type specifically, which helps
narrow down whether it's a total connection failure or just one message
type (e.g. GPS has no fix indoors, which is normal).
