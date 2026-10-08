"""Minimal bridge for the magnet demo: serial yaw in, /yaw and the twin page out.

Written 2026-09-18 by Claude as a dependable fallback for laptop/twin_bridge.py, which stops
reading if the port is busy at the moment it starts. This one keeps retrying the port for as long
as it runs, so unplugging the board or flashing it does not end the demo: it reconnects by itself.

    python tools/simple_yaw_bridge.py --port COM6
    http://127.0.0.1:8765/twin/index.html?live=1
"""

from __future__ import annotations

import argparse
import json
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import serial  # pyserial, already used by the other tools

ROOT = Path(__file__).resolve().parents[1]

state = {"deg": 0.0, "ok": False, "magnet": "missing", "stamp": 0.0, "reason": "starting"}
lock = threading.Lock()


def reader(port: str) -> None:
    """Own the serial port forever: read yaw lines, reopen whenever the link drops."""
    while True:
        link = None
        try:
            link = serial.Serial()
            link.port = port
            link.baudrate = 115200
            link.timeout = 0.2
            link.dtr = True   # this board stays silent with DTR low
            link.rts = False  # RTS is the reset line; keep it down
            link.open()
            with lock:
                state["reason"] = ""
            buffer = b""
            while True:
                chunk = link.read(256)
                if chunk:
                    buffer += chunk
                    while b"\n" in buffer:
                        line, buffer = buffer.split(b"\n", 1)
                        try:
                            message = json.loads(line.decode("utf-8", "ignore").strip())
                        except ValueError:
                            continue
                        if message.get("type") != "yaw":
                            continue
                        with lock:
                            state["ok"] = bool(message.get("ok"))
                            state["magnet"] = str(message.get("magnet") or "missing")
                            state["reason"] = "" if state["ok"] else "sensor unavailable"
                            state["stamp"] = time.monotonic()
                            if state["ok"]:
                                try:
                                    state["deg"] = float(message.get("deg", 0.0)) % 360.0
                                except (TypeError, ValueError):
                                    state["ok"] = False
                                    state["reason"] = "invalid yaw"
                if len(buffer) > 4096:
                    buffer = buffer[-512:]
        except Exception as error:  # port busy, unplugged, or mid-flash
            with lock:
                state["ok"] = False
                state["reason"] = "no board: " + str(error)[:60]
            time.sleep(1.0)
        finally:
            try:
                if link is not None and link.is_open:
                    link.close()
            except Exception:
                pass


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - http.server API
        if self.path.split("?")[0] == "/yaw":
            with lock:
                fresh = state["ok"] and (time.monotonic() - state["stamp"]) < 2.0
                body = {
                    "ok": fresh,
                    "deg": round(state["deg"], 2),
                    "magnet": state["magnet"],
                    "age_ms": int((time.monotonic() - state["stamp"]) * 1000) if state["stamp"] else -1,
                    "simulated": False,
                }
                if not fresh:
                    body["reason"] = state["reason"] or "stale"
            payload = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()

    def log_message(self, *_args):  # keep the console readable
        return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", default="COM6")
    parser.add_argument("--http-port", type=int, default=8765)
    args = parser.parse_args()

    threading.Thread(target=reader, args=(args.port,), daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", args.http_port), partial(Handler, directory=str(ROOT)))
    print(f"open http://127.0.0.1:{args.http_port}/twin/index.html?live=1   (serial {args.port})")
    server.serve_forever()


if __name__ == "__main__":
    main()
