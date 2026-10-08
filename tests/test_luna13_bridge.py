from __future__ import annotations

import json
from pathlib import Path
import tempfile
import threading
import time

from laptop.twin_bridge import (
    BridgeEventLog,
    TwinSerialWorker,
    YawState,
    find_esp32s3_ports,
    format_serial_error,
    parse_args,
)


class PortInfo:
    def __init__(self, device: str, vid: int | None, pid: int | None):
        self.device = device
        self.vid = vid
        self.pid = pid


class PortProvider:
    def __init__(self, ports):
        self.ports = ports

    def comports(self):
        return self.ports


class MemoryEventLog:
    def __init__(self):
        self.entries = []

    def record(self, event, port=None, reason="", **fields):
        entry = {"event": event, "port": port or ""}
        if reason:
            entry["reason"] = reason
        entry.update(fields)
        self.entries.append(entry)
        return entry


class FakeConnection:
    def __init__(self, mode, opens):
        self.mode = mode
        self.opens = opens
        self.port = ""
        self.baudrate = 0
        self.timeout = 0
        self.write_timeout = 0
        self.dtr = None
        self.rts = None
        self.in_waiting = 0
        self.sent = False
        self.closed = False

    def open(self):
        self.opens.append({"port": self.port, "dtr": self.dtr, "rts": self.rts})

    def read(self, _size):
        if self.mode == "drop":
            raise OSError("USB device disconnected")
        if self.mode == "live":
            if not self.sent:
                self.sent = True
                return (json.dumps({"type": "yaw", "ok": True, "magnet": "ok", "deg": 123.5}) + "\n").encode()
            return b""
        if self.mode == "sensor":
            if not self.sent:
                self.sent = True
                return b'{"type":"yaw","ok":false,"magnet":"missing"}\n'
            return b""
        if self.mode == "diagnostic":
            if not self.sent:
                self.sent = True
                return b"panel_check: diagnostic firmware\n"
            return b""
        return b""

    def close(self):
        self.closed = True


class FakeSerialModule:
    def __init__(self, modes, opens):
        self.modes = list(modes)
        self.opens = opens

    def Serial(self):
        mode = self.modes.pop(0) if len(self.modes) > 1 else self.modes[0]
        return FakeConnection(mode, self.opens)


def wait_for(predicate, timeout=2.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return predicate()


def stop_worker(worker):
    worker.stop(wait=True)
    if worker.is_alive():
        worker.join(1.0)


def test_port_detection_selects_first_matching_esp32s3():
    provider = PortProvider([
        PortInfo("COM2", 0x2341, 0x0043),
        PortInfo("COM7", 0x303A, 0x1001),
        PortInfo("COM8", 0x303A, 0x1001),
    ])
    assert find_esp32s3_ports(provider) == ["COM7", "COM8"]
    assert parse_args([]).port is None
    assert parse_args(["--port", "COM6"]).port == "COM6"


def test_open_error_reasons_are_operator_readable():
    assert format_serial_error(PermissionError("Access is denied"), "COM6") == \
        "access denied (another program holds COM6)"
    assert format_serial_error(FileNotFoundError("The system cannot find the file specified"), "COM6") == \
        "port not found"


def test_disconnected_board_reconnects_on_new_port_without_changing_dtr_rts():
    opens = []
    ports = iter([["COM4"], ["COM5"], ["COM5"]])
    provider = lambda: next(ports, ["COM5"])
    log = MemoryEventLog()
    state = YawState()
    worker = TwinSerialWorker(state, serial_backend=FakeSerialModule(["drop", "live"], opens),
                              port_provider=provider, event_log=log,
                              reconnect_delay=0.01, no_data_timeout=0.2)
    worker.start()
    try:
        assert wait_for(lambda: state.snapshot().get("ok") is True)
        assert state.snapshot()["deg"] == 123.5
        assert [item["port"] for item in opens[:2]] == ["COM4", "COM5"]
        assert all(item["dtr"] is True and item["rts"] is False for item in opens)
        assert any(entry["event"] == "reconnect" for entry in log.entries)
    finally:
        stop_worker(worker)


def test_diagnostic_firmware_is_named_and_not_counted_as_parse_noise():
    opens = []
    log = MemoryEventLog()
    state = YawState()
    worker = TwinSerialWorker(state, serial_backend=FakeSerialModule(["diagnostic"], opens),
                              port_provider=lambda: ["COM7"], event_log=log,
                              reconnect_delay=0.01, no_data_timeout=0.2)
    worker.start()
    try:
        expected = "board is running diagnostic firmware, flash live-yaw"
        assert wait_for(lambda: state.snapshot().get("reason") == expected)
        assert worker.parse_errors == 0
        assert any(entry["event"] == "diagnostic_firmware" for entry in log.entries)
    finally:
        stop_worker(worker)


def test_missing_as5600_reason_is_returned_by_yaw_state():
    opens = []
    state = YawState()
    worker = TwinSerialWorker(state, serial_backend=FakeSerialModule(["sensor"], opens),
                              port_provider=lambda: ["COM7"], event_log=MemoryEventLog(),
                              reconnect_delay=0.01, no_data_timeout=0.2)
    worker.start()
    try:
        expected = "sensor unavailable (AS5600 not responding)"
        assert wait_for(lambda: state.snapshot().get("reason") == expected)
        assert state.snapshot()["magnet"] == "missing"
    finally:
        stop_worker(worker)


def test_no_detected_port_is_reported_and_logged():
    log = MemoryEventLog()
    state = YawState()
    worker = TwinSerialWorker(state, serial_backend=FakeSerialModule(["live"], []),
                              port_provider=lambda: [], event_log=log, reconnect_delay=0.01)
    worker.start()
    try:
        assert wait_for(lambda: state.snapshot().get("reason") == "port not found")
        assert any(entry["event"] == "port_not_found" for entry in log.entries)
    finally:
        stop_worker(worker)


def test_bridge_event_log_rotates_near_one_megabyte_limit():
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "twin-bridge.log"
        log = BridgeEventLog(path, max_bytes=180)
        for index in range(12):
            log.record("parse_error", "COM7", parse_errors=index, sample="x" * 48)
        log.close()
        assert path.exists()
        assert Path(str(path) + ".1").exists()
        assert "\"event\":\"parse_error\"" in path.read_text(encoding="utf-8")


def test_simulated_state_returns_live_yaw_without_serial_hardware():
    state = YawState(simulated=True)
    snapshot = state.snapshot()
    assert snapshot["ok"] is True
    assert snapshot["simulated"] is True
    assert 0 <= snapshot["deg"] < 360
