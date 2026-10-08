"""Helper tool to send pin probe commands to Deep Sphere ESP32-S3 firmware.

Supported targets:
  <pin>   - Send hold_pin <pin> (holds that single pin HIGH 3.3V, every other signal LOW, stops display sweep)
  resume  - Send resume_sweep (restores panel setup and resumes display sweep)
  shorts  - Send scan_shorts (scans display signal pins for potential shorts and prints result)

Examples:
  python tools/pin_probe.py --port COM6 11
  python tools/pin_probe.py --port COM6 resume
  python tools/pin_probe.py --port COM6 shorts
"""

from __future__ import annotations

import argparse
import json
import sys
import time

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    serial = None
    list_ports = None


def find_default_port() -> str | None:
    if list_ports is None:
        return None
    ports = list(list_ports.comports())
    for p in ports:
        # Check for ESP32-S3 USB CDC (VID: 0x303A)
        if getattr(p, "vid", None) == 0x303A:
            return p.device
    if len(ports) == 1:
        return ports[0].device
    return None


def main() -> int:
    if serial is None:
        print("Error: pyserial is not installed. Please install pyserial.", file=sys.stderr)
        return 1

    parser = argparse.ArgumentParser(
        description="Probe pins or control test modes on Deep Sphere board via serial commands."
    )
    parser.add_argument(
        "--port",
        default=None,
        help="Serial port (e.g. COM6). If omitted, attempts auto-detection.",
    )
    parser.add_argument(
        "--baud",
        type=int,
        default=115200,
        help="Baud rate (default: 115200)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=3.5,
        help="Timeout in seconds for waiting on response (default: 3.5)",
    )
    parser.add_argument(
        "target",
        help="Target action: a pin number (e.g. 11), 'resume', or 'shorts'",
    )

    args = parser.parse_args()
    port = args.port or find_default_port()
    if not port:
        print("Error: No serial port specified and auto-detection found no candidate.", file=sys.stderr)
        print("Please provide --port (e.g. --port COM6)", file=sys.stderr)
        return 1

    target = args.target.strip().lower()
    req_id = f"cmd-{int(time.time() * 1000) % 1000000}"

    if target == "resume":
        payload = {"type": "command", "request_id": req_id, "action": "resume_sweep"}
        action_desc = "Resuming display sweep"
    elif target == "shorts":
        payload = {"type": "command", "request_id": req_id, "action": "scan_shorts"}
        action_desc = "Scanning signal pins for shorts"
    else:
        try:
            pin = int(target)
        except ValueError:
            print(f"Error: Unknown target '{args.target}'. Expected pin number (e.g. 11), 'resume', or 'shorts'.",
                  file=sys.stderr)
            return 1
        payload = {"type": "command", "request_id": req_id, "action": "hold_pin", "pin": pin}
        action_desc = f"Holding GPIO{pin} HIGH (all other signal pins LOW)"

    print(f"Connecting to {port} at {args.baud} baud (DTR=1, RTS=0)...")
    try:
        ser = serial.Serial(port, args.baud, timeout=0.2, write_timeout=2.0)
        ser.dtr = True
        ser.rts = False
    except Exception as exc:
        print(f"Error opening port {port}: {exc}", file=sys.stderr)
        return 1

    try:
        # Give serial CDC buffer a short settling time and drain pending bytes
        time.sleep(0.3)
        try:
            while ser.in_waiting:
                ser.read(ser.in_waiting)
        except Exception:
            pass

        line_out = json.dumps(payload, separators=(',', ':')) + "\n"
        print(f"Sending: {line_out.strip()} ({action_desc})")
        ser.write(line_out.encode("utf-8"))
        ser.flush()

        # Listen for ACK and relevant output lines
        deadline = time.time() + args.timeout
        ack_received = False
        ack_status = None
        logs_received = []

        while time.time() < deadline:
            raw = ser.readline()
            if not raw:
                continue
            text = raw.decode("utf-8", errors="replace").strip()
            if not text:
                continue

            try:
                msg = json.loads(text)
            except Exception:
                # Non-JSON or debug line
                print(f"[RAW] {text}")
                continue

            msg_type = msg.get("type")
            if msg_type == "ack" and msg.get("request_id") == req_id:
                ack_received = True
                ack_status = msg.get("status")
                print(f"[ACK] status: {ack_status}")
                if ack_status != "accepted":
                    break
            elif msg_type == "log":
                log_msg = msg.get("message", "")
                logs_received.append(log_msg)
                print(f"[LOG] {log_msg}")
                # For scan_shorts, once short scan result is printed, we can finish
                if target == "shorts" and "short scan:" in log_msg:
                    break
                # For hold_pin, once holding GPIO message is printed, we can finish
                if target.isdigit() and "holding GPIO" in log_msg:
                    break
                # For resume, after sweep resumed is printed, we can finish
                if target == "resume" and "sweep resumed" in log_msg:
                    break
            else:
                # Other messages (hello, heartbeat, event)
                pass

        if not ack_received:
            print(f"Warning: No ACK received within {args.timeout}s timeout.", file=sys.stderr)
            return 1

        if ack_status != "accepted":
            print(f"Command was rejected with status: {ack_status}", file=sys.stderr)
            return 1

        return 0

    finally:
        ser.close()
        print("Closed port.")


if __name__ == "__main__":
    sys.exit(main())
