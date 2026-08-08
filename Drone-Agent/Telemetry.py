from pymavlink import mavutil
import time

# Change this to your telemetry radio port
SERIAL_PORT = "/dev/tty.usbserial-AK0SM39C"

# Most telemetry radios use 57600
BAUD_RATE = 57600

print("Connecting...")

master = mavutil.mavlink_connection(
    SERIAL_PORT,
    baud=BAUD_RATE
)

print("Waiting for heartbeat...")

master.wait_heartbeat()

print("Connected!")
print(f"System ID : {master.target_system}")
print(f"Component : {master.target_component}")

print("------------------------------------")

while True:

    msg = master.recv_match(blocking=True)

    if msg is None:
        continue

    mtype = msg.get_type()

    # GPS
    if mtype == "GPS_RAW_INT":
        print(
            f"GPS Fix:{msg.fix_type} "
            f"Sat:{msg.satellites_visible} "
            f"Lat:{msg.lat/1e7:.7f} "
            f"Lon:{msg.lon/1e7:.7f}"
        )

    # Attitude
    elif mtype == "ATTITUDE":
        print(
            f"Roll:{msg.roll:.2f} "
            f"Pitch:{msg.pitch:.2f} "
            f"Yaw:{msg.yaw:.2f}"
        )

    # Battery
    elif mtype == "SYS_STATUS":
        print(
            f"Voltage:{msg.voltage_battery/1000:.2f}V "
            f"Battery:{msg.battery_remaining}%"
        )

    # Altitude
    elif mtype == "GLOBAL_POSITION_INT":
        print(
            f"Altitude:{msg.relative_alt/1000:.2f} m"
        )