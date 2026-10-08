"""Watch AS5600 telemetry through the existing single-owner SerialWorker.

Examples, run from prototype-v1:
  python tools/as5600_watch.py --port COM7 --seconds 60
  python tools/as5600_watch.py cal-start --port COM7
  python tools/as5600_watch.py summary --replay output/as5600/session.csv

This tool never opens the serial port directly and never flashes or writes AS5600 OTP.
"""

from __future__ import annotations

import argparse
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
import csv
import json
import math
from pathlib import Path
import queue
import statistics
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "laptop"))

from core import SerialWorker


OUT_DIR = ROOT / "output" / "as5600"
CSV_FIELDS = ["timestamp_iso", "host_monotonic", "raw", "deg", "md", "ml", "mh",
              "agc", "magnitude", "i2c_errors", "sample_hz", "ok", "reason"]
COMMANDS = {"cal-start": "as5600_cal_start", "cal-stop": "as5600_cal_stop", "zero": "as5600_zero"}


@dataclass
class TelemetrySample:
    timestamp_iso: str
    host_monotonic: float
    raw: int | None = None
    deg: float | None = None
    md: bool | None = None
    ml: bool | None = None
    mh: bool | None = None
    agc: float | None = None
    magnitude: float | None = None
    i2c_errors: int | None = None
    sample_hz: float | None = None
    ok: bool | None = None
    reason: str = ""


def _number(value, integer: bool = False):
    if value is None or value == "":
        return None
    try:
        return int(float(value)) if integer else float(value)
    except (TypeError, ValueError):
        return None


def _boolean(value):
    if isinstance(value, bool):
        return value
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on", "ok"}:
        return True
    if text in {"0", "false", "no", "off", "fail", "bad"}:
        return False
    return None


def _status_fields(payload: dict) -> dict:
    fields = {key: payload.get(key) for key in ("md", "ml", "mh")}
    status = payload.get("status")
    if isinstance(status, dict):
        fields.update({key: status.get(key) for key in ("md", "ml", "mh") if key in status})
    elif isinstance(status, str):
        for part in status.replace(",", " ").split():
            if "=" not in part:
                continue
            key, value = part.split("=", 1)
            if key.lower() in {"md", "ml", "mh"}:
                fields[key.lower()] = value
    return fields


def parse_telemetry(message: dict, host_monotonic: float | None = None) -> TelemetrySample | None:
    """Accept the planned top-level telemetry and a nested ``as5600`` variant."""
    payload = message.get("as5600") if isinstance(message.get("as5600"), dict) else message
    if not isinstance(payload, dict):
        return None
    if not any(key in payload for key in ("raw", "deg", "yaw_deg", "magnitude", "agc")):
        return None
    status = _status_fields(payload)
    raw_value = _number(payload.get("raw"), integer=True)
    if raw_value is not None:
        raw_value &= 0x0FFF
    ok = _boolean(payload.get("ok"))
    if ok is None and any(status.get(key) is not None for key in ("md", "ml", "mh")):
        ok = bool(_boolean(status.get("md"))) and not bool(_boolean(status.get("ml"))) and not bool(_boolean(status.get("mh")))
    stamp = message.get("timestamp_iso") or datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    return TelemetrySample(
        timestamp_iso=str(stamp),
        host_monotonic=time.monotonic() if host_monotonic is None else host_monotonic,
        raw=raw_value,
        deg=_number(payload.get("deg", payload.get("yaw_deg"))),
        md=_boolean(status.get("md")),
        ml=_boolean(status.get("ml")),
        mh=_boolean(status.get("mh")),
        agc=_number(payload.get("agc")),
        magnitude=_number(payload.get("magnitude")),
        i2c_errors=_number(payload.get("i2c_errors"), integer=True),
        sample_hz=_number(payload.get("sample_hz")),
        ok=ok,
        reason=str(payload.get("reason", "")),
    )


def _csv_value(value):
    return "" if value is None else value


def write_sample(writer: csv.DictWriter, sample: TelemetrySample) -> None:
    writer.writerow({field: _csv_value(getattr(sample, field)) for field in CSV_FIELDS})


def sample_from_csv(row: dict) -> TelemetrySample:
    return TelemetrySample(
        timestamp_iso=row.get("timestamp_iso", ""),
        host_monotonic=_number(row.get("host_monotonic")) or 0.0,
        raw=_number(row.get("raw"), integer=True),
        deg=_number(row.get("deg")),
        md=_boolean(row.get("md")), ml=_boolean(row.get("ml")), mh=_boolean(row.get("mh")),
        agc=_number(row.get("agc")), magnitude=_number(row.get("magnitude")),
        i2c_errors=_number(row.get("i2c_errors"), integer=True), sample_hz=_number(row.get("sample_hz")),
        ok=_boolean(row.get("ok")), reason=row.get("reason", ""),
    )


def load_csv(path: Path) -> list[TelemetrySample]:
    with path.open(newline="", encoding="utf-8") as handle:
        return [sample_from_csv(row) for row in csv.DictReader(handle)]


def _circular_delta(a: float, b: float) -> float:
    return abs((b - a + 180.0) % 360.0 - 180.0)


def stationary_values(samples: list[TelemetrySample], threshold_deg: float = 0.25) -> list[float]:
    values: list[float] = []
    previous = None
    for sample in samples:
        if sample.deg is None:
            continue
        if previous is not None and _circular_delta(previous, sample.deg) <= threshold_deg:
            values.extend([previous, sample.deg])
        previous = sample.deg
    return values


def summarize(samples: list[TelemetrySample], stationary_threshold: float = 0.25) -> dict:
    angles = [sample.deg for sample in samples if sample.deg is not None]
    jumps = [_circular_delta(a, b) for a, b in zip(angles, angles[1:])]
    stationary = stationary_values(samples, stationary_threshold)
    agc = [sample.agc for sample in samples if sample.agc is not None]
    magnitude = [sample.magnitude for sample in samples if sample.magnitude is not None]
    errors = [sample.i2c_errors for sample in samples if sample.i2c_errors is not None]
    return {
        "samples": len(samples),
        "angle_min": min(angles) if angles else None,
        "angle_max": max(angles) if angles else None,
        "largest_jump_deg": max(jumps) if jumps else None,
        "stationary_samples": len(stationary),
        "stationary_jitter_pp_deg": (max(stationary) - min(stationary)) if stationary else None,
        "stationary_jitter_sd_deg": statistics.pstdev(stationary) if stationary else None,
        "agc_min": min(agc) if agc else None,
        "agc_max": max(agc) if agc else None,
        "magnitude_min": min(magnitude) if magnitude else None,
        "magnitude_max": max(magnitude) if magnitude else None,
        "ml_seen": any(sample.ml is True for sample in samples),
        "mh_seen": any(sample.mh is True for sample in samples),
        "i2c_errors": max(errors) if errors else None,
    }


def _fmt(value, suffix=""):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "n/a"
    return f"{value:.3f}{suffix}" if isinstance(value, float) else f"{value}{suffix}"


def print_summary(summary: dict) -> None:
    print(f"samples: {summary['samples']}")
    print(f"angle range: {_fmt(summary['angle_min'], ' deg')} .. {_fmt(summary['angle_max'], ' deg')}")
    print(f"stationary jitter: p-p {_fmt(summary['stationary_jitter_pp_deg'], ' deg')}, SD {_fmt(summary['stationary_jitter_sd_deg'], ' deg')}")
    print(f"largest jump: {_fmt(summary['largest_jump_deg'], ' deg')}")
    print(f"AGC: {_fmt(summary['agc_min'])} .. {_fmt(summary['agc_max'])}; magnitude: {_fmt(summary['magnitude_min'])} .. {_fmt(summary['magnitude_max'])}")
    print(f"ML seen: {summary['ml_seen']}; MH seen: {summary['mh_seen']}; i2c_errors: {_fmt(summary['i2c_errors'])}")


def _print_live(sample: TelemetrySample) -> None:
    status = "MAG OK" if sample.ok is True else "MAG FAIL" if sample.ok is False else "MAG ?"
    flags = "".join(flag for flag, value in ((" MD", sample.md), (" ML", sample.ml), (" MH", sample.mh)) if value)
    print(f"YAW {_fmt(sample.deg, ' deg')} {status}{flags} AGC {_fmt(sample.agc)} HZ {_fmt(sample.sample_hz)}", flush=True)


def _csv_path() -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return OUT_DIR / f"as5600-{stamp}.csv"


def run_replay(path: Path, show: bool = True) -> int:
    samples = load_csv(path)
    if show:
        for sample in samples:
            _print_live(sample)
    print_summary(summarize(samples))
    return 0


def run_live(port: str, seconds: float, output_path: Path | None = None) -> int:
    events: queue.Queue[dict] = queue.Queue()
    worker = SerialWorker(port, events.put, lambda reason: events.put({"_disconnect": reason}))
    output_path = output_path or _csv_path()
    samples: list[TelemetrySample] = []
    print(f"listening on {port}; CSV: {output_path}")
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        worker.start()
        deadline = time.monotonic() + seconds if seconds > 0 else None
        try:
            while deadline is None or time.monotonic() < deadline:
                try:
                    message = events.get(timeout=0.2)
                except queue.Empty:
                    continue
                if "_disconnect" in message:
                    print(f"serial: {message['_disconnect']}", file=sys.stderr)
                    continue
                sample = parse_telemetry(message)
                if sample is not None:
                    samples.append(sample)
                    write_sample(writer, sample)
                    handle.flush()
                    _print_live(sample)
        except KeyboardInterrupt:
            print("\ninterrupted")
        finally:
            worker.stop()
    print_summary(summarize(samples))
    return 0


def run_command(port: str, action: str, wait_seconds: float) -> int:
    events: queue.Queue[dict] = queue.Queue()
    worker = SerialWorker(port, events.put, lambda reason: events.put({"_disconnect": reason}))
    request_id = f"as5600-{uuid.uuid4().hex[:12]}"
    worker.start()
    worker.send({"v": 1, "type": "command", "action": action, "request_id": request_id})
    print(f"sent {action} (request_id={request_id})")
    deadline = time.monotonic() + wait_seconds
    try:
        while time.monotonic() < deadline:
            try:
                message = events.get(timeout=0.2)
            except queue.Empty:
                continue
            if message.get("type") in {"ack", "log", "as5600"}:
                print(json.dumps(message, ensure_ascii=False, sort_keys=True))
    except KeyboardInterrupt:
        pass
    finally:
        worker.stop()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="AS5600 telemetry watcher and command tool")
    parser.add_argument("command", choices=("watch", "cal-start", "cal-stop", "zero", "summary"), nargs="?", default="watch")
    parser.add_argument("--port", help="serial port, for example COM7")
    parser.add_argument("--seconds", type=float, default=60.0, help="watch/summary collection duration; 0 means until Ctrl+C")
    parser.add_argument("--replay", type=Path, help="read samples from a CSV without a board")
    parser.add_argument("--csv", type=Path, help="CSV destination for a live watch")
    parser.add_argument("--command-wait", type=float, default=1.5, help="seconds to wait for command acknowledgement")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "summary" and args.replay:
        return run_replay(args.replay, show=False)
    if args.replay:
        return run_replay(args.replay)
    if not args.port:
        print("--port is required unless --replay is used", file=sys.stderr)
        return 2
    if args.command in COMMANDS:
        return run_command(args.port, COMMANDS[args.command], args.command_wait)
    return run_live(args.port, args.seconds, args.csv)


if __name__ == "__main__":
    raise SystemExit(main())
