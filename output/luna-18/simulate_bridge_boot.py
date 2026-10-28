from __future__ import annotations

import contextlib
import importlib.util
import io
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
module_spec = importlib.util.spec_from_file_location("twin_bridge_under_test", root / "laptop" / "twin_bridge.py")
bridge = importlib.util.module_from_spec(module_spec)
assert module_spec.loader is not None
module_spec.loader.exec_module(bridge)
event_path = Path(__file__).with_name("bridge-simulation-events.jsonl")
log = bridge.BridgeEventLog(event_path)
worker = bridge.TwinSerialWorker(bridge.YawState(), serial_backend=object(), event_log=log)
boot_line = (b'{"v":1,"type":"boot","core0":"0x15","core1":"0x15",'
             b'"esp":3,"name":"USB_UART","boots_since_power_on":2,'
             b'"history":["0x01","0x15"],"uptime_ms":4000}')
stdout = io.StringIO()
with contextlib.redirect_stdout(stdout):
    boot_result = worker._process_line(boot_line, "COMx")
    errors_after_boot = worker.parse_errors
    yaw_result = worker._process_line(
        b'{"v":1,"type":"yaw","deg":12.5,"raw":100,"ok":true,"magnet":"ok"}', "COMx")
    yaw_snapshot = worker.state.snapshot()
log.close()
result = {
    "boot_result": boot_result,
    "parse_errors_after_boot": errors_after_boot,
    "stdout_after_boot": "",
    "yaw_result_after_boot": yaw_result,
    "yaw_state_updated": yaw_snapshot.get("ok") is True and yaw_snapshot.get("deg") == 12.5,
    "bridge_events": log.entries,
}
assert boot_result == (False, False)
assert errors_after_boot == 0
assert stdout.getvalue() == ""
assert yaw_result == (True, False)
assert result["yaw_state_updated"]
Path(__file__).with_name("bridge-simulation-result.json").write_text(
    json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, indent=2))
