"""Local HTTP and serial bridge for the live yaw digital-twin demo."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import logging
from logging.handlers import RotatingFileHandler
import math
from pathlib import Path
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

try:
    import serial
    from serial.tools import list_ports as serial_list_ports
except ImportError:  # Keep --simulate and unit tests usable without pyserial.
    serial = None
    serial_list_ports = None


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HTTP_PORT = 8765
SERIAL_BAUD = 115200
RECONNECT_DELAY_S = 1.0
NO_DATA_TIMEOUT_S = 3.0
LOG_PATH = ROOT / "output" / "twin-bridge.log"
LOG_MAX_BYTES = 1_000_000
ESP32S3_VID = 0x303A
ESP32S3_PID = 0x1001


class BridgeEventLog:
    """Rotating JSON-lines log for bridge and serial-link events."""

    def __init__(self, path: Path = LOG_PATH, max_bytes: int = LOG_MAX_BYTES):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.entries: list[dict] = []
        self.logger = logging.getLogger(f"twin_bridge.{self.path.resolve()}")
        self.logger.setLevel(logging.INFO)
        self.logger.propagate = False
        for handler in list(self.logger.handlers):
            self.logger.removeHandler(handler)
            handler.close()
        handler = RotatingFileHandler(self.path, maxBytes=max_bytes, backupCount=3, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(message)s"))
        self.logger.addHandler(handler)

    def record(self, event: str, port: str | None = None, reason: str = "", **fields) -> dict:
        entry = {"at": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
                 "event": event, "port": port or ""}
        if reason:
            entry["reason"] = reason
        entry.update(fields)
        self.entries.append(entry)
        self.logger.info(json.dumps(entry, ensure_ascii=False, separators=(",", ":")))
        return entry

    def close(self) -> None:
        for handler in list(self.logger.handlers):
            self.logger.removeHandler(handler)
            handler.close()


def find_esp32s3_ports(port_list_module=None) -> list[str]:
    """Return detected ESP32-S3 USB CDC ports in operating-system order."""
    provider = serial_list_ports if port_list_module is None else port_list_module
    if provider is None:
        return []
    try:
        ports = provider.comports()
    except Exception:
        return []
    return [item.device for item in ports
            if getattr(item, "vid", None) == ESP32S3_VID and getattr(item, "pid", None) == ESP32S3_PID]


def format_serial_error(error: Exception, port: str) -> str:
    """Map common Windows/USB open failures to short operator-facing reasons."""
    message = str(error).strip()
    lowered = message.lower()
    if (isinstance(error, PermissionError) or "permissionerror" in lowered or
            "access is denied" in lowered or "permission denied" in lowered):
        return f"access denied (another program holds {port})"
    if any(part in lowered for part in ("no such file", "cannot find", "not found", "does not exist",
                                       "device disconnected", "device not configured", "i/o error")):
        return "port not found"
    return f"serial connection error on {port}: {message or error.__class__.__name__}"


class YawState:
    def __init__(self, simulated: bool = False):
        self.simulated = simulated
        self.lock = threading.Lock()
        self.deg = 0.0
        self.ok = False
        self.magnet = "missing"
        self.reason = "port not found"
        self.port = ""
        self.received_at = 0.0
        self.seen_message = False
        self.started_at = time.monotonic()

    def update(self, message: dict) -> None:
        if message.get("type") != "yaw":
            return
        ok = bool(message.get("ok"))
        magnet = str(message.get("magnet") or ("ok" if ok else "missing"))
        with self.lock:
            self.seen_message = True
            self.ok = ok
            self.magnet = magnet
            if not ok:
                self.reason = ("sensor unavailable (AS5600 not responding)"
                               if magnet.lower() in {"missing", "absent", "not_found"}
                               else str(message.get("reason") or "sensor unavailable (AS5600 not responding)"))
                return
            try:
                value = float(message["deg"])
            except (KeyError, TypeError, ValueError):
                self.ok = False
                self.reason = "invalid yaw"
                return
            if not math.isfinite(value):
                self.ok = False
                self.reason = "invalid yaw"
                return
            self.deg = value % 360.0
            self.received_at = time.monotonic()
            self.reason = ""

    def disconnected(self, reason: str) -> None:
        with self.lock:
            self.seen_message = False
            self.ok = False
            self.magnet = "missing"
            self.reason = reason or "port not found"

    def snapshot(self) -> dict:
        if self.simulated:
            elapsed = time.monotonic() - self.started_at
            return {"deg": (elapsed * 12.0) % 360.0, "ok": True, "magnet": "ok",
                    "age_ms": 0, "simulated": True}
        with self.lock:
            if not self.ok:
                return {"ok": False, "reason": self.reason or "no data (wrong firmware?)",
                        "magnet": self.magnet, "port": self.port}
            return {"deg": round(self.deg, 2), "ok": True, "magnet": self.magnet,
                    "age_ms": max(0, round((time.monotonic() - self.received_at) * 1000)),
                    "simulated": False, "port": self.port}


class TwinSerialWorker(threading.Thread):
    """Own the serial handle, discover changed ports, and publish live yaw snapshots."""

    def __init__(self, state: YawState, port_override: str | None = None,
                 serial_backend=None, port_provider=None, event_log: BridgeEventLog | None = None,
                 reconnect_delay: float = RECONNECT_DELAY_S,
                 no_data_timeout: float = NO_DATA_TIMEOUT_S):
        super().__init__(daemon=True, name="TwinSerialWorker")
        self.state = state
        self.port_override = port_override
        self.serial_backend = serial if serial_backend is None else serial_backend
        self.port_provider = port_provider or find_esp32s3_ports
        self.event_log = event_log or BridgeEventLog()
        self.reconnect_delay = reconnect_delay
        self.no_data_timeout = no_data_timeout
        self.stop_requested = threading.Event()
        self.connection = None
        self.parse_errors = 0
        self._last_reported_reason = None
        self._last_parse_log_at = 0.0
        self._last_parse_log_count = 0
        self._last_multiple_signature = None

    def _report_reason(self, reason: str, port: str | None = None, event: str | None = None,
                       **fields) -> None:
        self.state.disconnected(reason)
        if reason == self._last_reported_reason:
            return
        self._last_reported_reason = reason
        details = {"parse_errors": self.parse_errors}
        details.update(fields)
        self.event_log.record(event or "link_status", port, reason=reason, **details)
        print(reason, flush=True)

    def _select_port(self) -> str | None:
        if self.port_override:
            return self.port_override
        try:
            ports = list(self.port_provider())
        except Exception as error:
            self._report_reason("port not found", event="port_discovery_error", detail=str(error))
            return None
        if not ports:
            self._report_reason("port not found", event="port_not_found")
            return None
        signature = tuple(ports)
        if len(ports) > 1 and signature != self._last_multiple_signature:
            self._last_multiple_signature = signature
            print(f"Multiple ESP32-S3 ports found ({', '.join(ports)}); using {ports[0]}.", flush=True)
            self.event_log.record("multiple_ports", ports[0], candidates=ports, selected=ports[0])
        return ports[0]

    def _log_parse_error(self, port: str, sample: str) -> None:
        self.parse_errors += 1
        now = time.monotonic()
        if (self.parse_errors - self._last_parse_log_count >= 10 or
                now - self._last_parse_log_at >= 5.0):
            self._last_parse_log_at = now
            self._last_parse_log_count = self.parse_errors
            self.event_log.record("parse_error", port, reason="serial line is not JSON",
                                  parse_errors=self.parse_errors, sample=sample[:100])

    def _process_line(self, raw: bytes, port: str) -> tuple[bool, bool]:
        """Return (was_yaw_json, was_diagnostic_firmware)."""
        line = raw.decode("utf-8", errors="replace").strip()
        if not line:
            return False, False
        if line.lower().startswith("panel_check:"):
            reason = "board is running diagnostic firmware, flash live-yaw"
            self._report_reason(reason, port, "diagnostic_firmware")
            return False, True
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            self._log_parse_error(port, line)
            return False, False
        if not isinstance(message, dict) or message.get("type") != "yaw":
            return False, False
        self.state.update(message)
        snapshot = self.state.snapshot()
        if snapshot.get("ok"):
            self._last_reported_reason = None
        else:
            self._report_reason(snapshot.get("reason", "sensor unavailable (AS5600 not responding)"),
                                port, "sensor_unavailable", magnet=snapshot.get("magnet", "missing"))
        return True, False

    def _open(self, port: str):
        connection = self.serial_backend.Serial()
        connection.port = port
        connection.baudrate = SERIAL_BAUD
        connection.timeout = 0.1
        connection.write_timeout = 1.0
        connection.dtr = True
        connection.rts = False
        connection.open()
        return connection

    def _pump(self, connection, port: str) -> str:
        buffer = bytearray()
        self.parse_errors = 0
        last_yaw_at = time.monotonic()
        next_presence_check = last_yaw_at + 1.0
        diagnostic_firmware = False
        self._report_reason("no data (wrong firmware?)", port, "waiting_for_data")
        while not self.stop_requested.is_set():
            now = time.monotonic()
            if self.port_override is None and now >= next_presence_check:
                next_presence_check = now + 1.0
                if port not in self.port_provider():
                    return "port not found"
            chunk = connection.read(max(1, int(getattr(connection, "in_waiting", 0))))
            if chunk:
                buffer.extend(chunk)
                if len(buffer) > 8192:
                    del buffer[:-1]
                    self._log_parse_error(port, "serial line exceeded 8192 bytes")
                while True:
                    cut = buffer.find(b"\n")
                    if cut < 0:
                        break
                    raw = bytes(buffer[:cut]).strip()
                    del buffer[:cut + 1]
                    if not raw:
                        continue
                    was_yaw, is_diagnostic = self._process_line(raw, port)
                    diagnostic_firmware = is_diagnostic or (diagnostic_firmware and not was_yaw)
                    if was_yaw:
                        last_yaw_at = time.monotonic()
                        diagnostic_firmware = False
            else:
                if not diagnostic_firmware and time.monotonic() - last_yaw_at >= self.no_data_timeout:
                    self._report_reason("no data (wrong firmware?)", port, "no_data")
                    last_yaw_at = time.monotonic()
                self.stop_requested.wait(0.01)
        return "stopped by request"

    def run(self) -> None:
        if self.serial_backend is None:
            self._report_reason("pyserial is not installed", event="serial_unavailable")
            return
        while not self.stop_requested.is_set():
            port = self._select_port()
            if not port:
                if self.stop_requested.wait(self.reconnect_delay):
                    return
                continue
            self.state.port = port
            self.event_log.record("open_attempt", port)
            try:
                self.connection = self._open(port)
            except Exception as error:
                reason = format_serial_error(error, port)
                self.event_log.record("open_error", port, reason=reason, parse_errors=self.parse_errors)
                self._report_reason(reason, port)
                self.connection = None
                if self.stop_requested.wait(self.reconnect_delay):
                    return
                continue

            self._last_reported_reason = None
            self.event_log.record("open_success", port, dtr=True, rts=False)
            reason = "stopped by request"
            try:
                reason = self._pump(self.connection, port)
            except Exception as error:
                reason = format_serial_error(error, port)
                self.event_log.record("read_error", port, reason=reason,
                                      parse_errors=self.parse_errors)
                self._report_reason(reason, port)
            finally:
                self.event_log.record("close", port, reason=reason,
                                      parse_errors=self.parse_errors)
                try:
                    if self.connection:
                        self.connection.close()
                except Exception as error:
                    self.event_log.record("close_error", port, reason=str(error))
                self.connection = None
            if self.stop_requested.is_set():
                return
            self.event_log.record("reconnect", port, reason=reason,
                                  parse_errors=self.parse_errors)
            self.state.disconnected("port not found" if self.port_override is None else reason)
            if self.stop_requested.wait(self.reconnect_delay):
                return

    def stop(self, wait: bool = True) -> bool:
        self.stop_requested.set()
        if wait and self.is_alive() and threading.current_thread() is not self:
            self.join(2.0)
        return not self.is_alive()


class TwinRequestHandler(SimpleHTTPRequestHandler):
    state: YawState

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):  # noqa: N802 - required by BaseHTTPRequestHandler
        if urlsplit(self.path).path == "/yaw":
            payload = json.dumps(self.state.snapshot(), separators=(",", ":")).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()

    def log_message(self, format, *args):
        return


def parse_args(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(description="Serve the digital twin and bridge live yaw")
    parser.add_argument("--port", default=None, help="Force a serial port, for example COM6")
    parser.add_argument("--http-port", type=int, default=DEFAULT_HTTP_PORT, help="HTTP listen port")
    parser.add_argument("--simulate", action="store_true", help="emit a slow simulated yaw without a board")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    state = YawState(simulated=args.simulate)
    TwinRequestHandler.state = state
    event_log = BridgeEventLog()
    worker = None
    server = ThreadingHTTPServer(("127.0.0.1", args.http_port), TwinRequestHandler)
    event_log.record("bridge_start", reason="simulate" if args.simulate else "serial")
    if not args.simulate:
        worker = TwinSerialWorker(state, port_override=args.port, event_log=event_log)
        worker.start()
    print(f"Twin bridge serving {ROOT} at http://127.0.0.1:{args.http_port}/twin/index.html?live=1", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()
        if worker is not None:
            worker.stop(wait=True)
        event_log.record("bridge_stop")
        event_log.close()


if __name__ == "__main__":
    main()
