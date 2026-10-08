"""Watch the board's USB link and record what actually happens to it.

This is the single-owner diagnostic logger the USB stability work order asks for. It opens the
port once and holds it, so it can be told apart from a program that reopens the port and blames
the board for the result. It never flashes, never resets and never sends a command unless asked.

Three things are separated on purpose, because the sound Windows makes cannot tell them apart:

  the board rebooted      a new session id, and uptime starts again from near zero
  the link went away      the port disappears, but the session that comes back is the same one
                          and its uptime has kept pace with the wall clock
  the host let go         an open or close this tool recorded itself

Round A of the work order needs the port watched while nothing holds it open. Pass
--presence-only for that: it lists devices and never opens anything.

    python tools/usb_watch.py --port COM7 --seconds 300
    python tools/usb_watch.py --port COM7 --presence-only --seconds 300

Output goes to output/usb-stability/: one .jsonl of events and one .log of raw lines.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time

try:
    import serial
    from serial.tools import list_ports
except ImportError:  # pragma: no cover - the tool cannot run, but importing it must not explode
    serial = None
    list_ports = None

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "output/usb-stability"
# Matches the dashboard. Both must agree or a comparison measures the setting, not the board.
DTR_ON_OPEN = True
RTS_ON_OPEN = False
BAUD = 115200
READ_TIMEOUT_S = 0.1
PRESENCE_POLL_S = 0.5
# The firmware heartbeats once a second; three missed in a row is a gap worth recording.
QUIET_GAP_S = 3.5


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class Recorder:
    def __init__(self, port: str, label: str):
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        self.port = port
        self.events_path = OUT_DIR / f"usb-watch-{label}-{stamp}.jsonl"
        self.raw_path = OUT_DIR / f"usb-watch-{label}-{stamp}.log"
        self.counts: dict[str, int] = {}

    def event(self, name: str, **fields) -> None:
        entry = {"at": now(), "event": name, "port": self.port, **fields}
        self.counts[name] = self.counts.get(name, 0) + 1
        with self.events_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        detail = " ".join(f"{key}={value}" for key, value in fields.items())
        print(f"[{entry['at']}] {name} {detail}".rstrip(), flush=True)

    def raw(self, line: str) -> None:
        with self.raw_path.open("a", encoding="utf-8") as handle:
            handle.write(f"{now()}\t{line}\n")


def port_present(port: str) -> bool:
    if list_ports is None:
        return False
    return any(item.device.upper() == port.upper() for item in list_ports.comports())


def watch_presence(port: str, seconds: float) -> int:
    """Round A: is the device there, without anything opening it.

    Opening a port is itself an event that can change what the board does, so the question
    "does it drop when nothing touches it" can only be answered without opening it.
    """
    recorder = Recorder(port, "presence")
    recorder.event("watch_start", mode="presence-only", seconds=seconds,
                   note="no program opens the port in this mode")
    present = port_present(port)
    recorder.event("initial_state", present=present)
    deadline = time.monotonic() + seconds
    try:
        while time.monotonic() < deadline:
            time.sleep(PRESENCE_POLL_S)
            current = port_present(port)
            if current != present:
                present = current
                recorder.event("device_appeared" if current else "device_vanished")
    except KeyboardInterrupt:
        recorder.event("watch_interrupted", reason="keyboard")
    recorder.event("watch_end", **recorder.counts)
    print(f"\nevents: {recorder.events_path}")
    return 0


def _looks_truncated(candidate: str, known: str) -> bool:
    """True when candidate is what known becomes after losing a contiguous run of bytes.

    A dropped chunk leaves the head and the tail intact, so the damaged value is the known id
    with a hole in it. Two real session ids never resemble each other that way: the board mixes
    hardware randomness into every one.
    """
    if len(candidate) >= len(known):
        return False
    for split in range(len(candidate) + 1):
        head, tail = candidate[:split], candidate[split:]
        if known.startswith(head) and known.endswith(tail):
            return True
    return False


def describe_message(message: dict) -> dict:
    """Pull out only the fields that answer the reboot-or-drop question."""
    keep = ("session", "type", "uptime_ms", "heartbeat", "reset_reason", "reset_reason_name",
            "stage", "firmware_env", "firmware_build")
    return {key: message[key] for key in keep if key in message}


def watch_link(port: str, seconds: float, reconnect: bool) -> int:
    if serial is None:
        print("pyserial is not installed; run pip install -r laptop/requirements.txt", file=sys.stderr)
        return 2

    recorder = Recorder(port, "link")
    recorder.event("watch_start", mode="link", seconds=seconds, dtr=DTR_ON_OPEN, rts=RTS_ON_OPEN,
                   reconnect=reconnect)
    deadline = time.monotonic() + seconds
    session = None
    last_uptime = None
    last_line_at = None
    boots = 0
    truncated = 0
    board_truncated = 0

    try:
        while time.monotonic() < deadline:
            recorder.event("open_attempt")
            try:
                connection = serial.Serial()
                connection.port = port
                connection.baudrate = BAUD
                connection.timeout = READ_TIMEOUT_S
                connection.write_timeout = 1.0
                connection.dtr = DTR_ON_OPEN
                connection.rts = RTS_ON_OPEN
                connection.open()
            except Exception as exc:
                recorder.event("open_error", reason=str(exc))
                if not reconnect:
                    break
                time.sleep(1.0)
                continue
            recorder.event("open_success")
            last_line_at = time.monotonic()
            buffer = bytearray()
            reason = "window elapsed"
            try:
                while time.monotonic() < deadline:
                    chunk = connection.read(max(1, connection.in_waiting))
                    if not chunk:
                        quiet = time.monotonic() - last_line_at
                        if quiet > QUIET_GAP_S:
                            recorder.event("quiet_gap", seconds=round(quiet, 2),
                                           note="no line for longer than the heartbeat interval")
                            last_line_at = time.monotonic()
                        continue
                    buffer.extend(chunk)
                    while True:
                        cut = buffer.find(b"\n")
                        if cut < 0:
                            break
                        raw = bytes(buffer[:cut]).strip()
                        del buffer[:cut + 1]
                        if not raw:
                            continue
                        last_line_at = time.monotonic()
                        text = raw.decode("utf-8", errors="replace")
                        recorder.raw(text)
                        try:
                            message = json.loads(text)
                        except json.JSONDecodeError:
                            continue  # the diag environment prints plain text; keep it in the raw log
                        if not isinstance(message, dict):
                            continue
                        seen = message.get("session")
                        if seen and seen != session:
                            # A line that lost bytes in the middle can still be valid JSON with a
                            # shortened session id. Counting that as a reboot invents restarts
                            # that never happened. However, _looks_truncated() is only a heuristic:
                            # if uptime has genuinely restarted from near zero, count it as a reboot.
                            # Otherwise record it as suspect/corrupt with raw text preserved.
                            uptime_val = message.get("uptime_ms")
                            is_real_reboot = (
                                isinstance(uptime_val, (int, float))
                                and last_uptime is not None
                                and uptime_val < 5000
                                and last_uptime > 10000
                            )
                            if session and _looks_truncated(seen, session) and not is_real_reboot:
                                truncated += 1
                                recorder.event("suspect_corrupt_line", claimed_session=seen,
                                               known_session=session, raw=text,
                                               **describe_message(message))
                            else:
                                boots += 1
                                recorder.event("board_session_changed", previous=session,
                                               **describe_message(message))
                                session = seen
                                last_uptime = uptime_val if isinstance(uptime_val, (int, float)) else None
                            continue
                        uptime = message.get("uptime_ms")
                        if isinstance(uptime, (int, float)):
                            if last_uptime is not None and uptime < last_uptime:
                                recorder.event("uptime_went_backwards", previous_ms=last_uptime,
                                               **describe_message(message))
                            last_uptime = uptime
                        reported = message.get("truncated_lines")
                        if isinstance(reported, int) and reported > board_truncated:
                            recorder.event("board_dropped_line_bytes", total=reported,
                                           note="the board could not fit a whole line in the USB FIFO")
                            board_truncated = reported
            except Exception as exc:
                reason = str(exc) or exc.__class__.__name__
                recorder.event("read_error", reason=reason)
            finally:
                try:
                    connection.close()
                except Exception:
                    pass
                recorder.event("close", reason=reason)
            if not reconnect or time.monotonic() >= deadline:
                break
            recorder.event("reopen_wait", seconds=1.0)
            time.sleep(1.0)
    except KeyboardInterrupt:
        recorder.event("watch_interrupted", reason="keyboard")

    recorder.event("watch_end", boots_observed=boots, damaged_lines=truncated,
                   board_reported_truncations=board_truncated, last_session=session or "none",
                   **recorder.counts)
    print(f"\nevents: {recorder.events_path}")
    print(f"raw:    {recorder.raw_path}")
    if boots > 1:
        print(f"\n{boots} board sessions were seen: the board restarted during this window.")
    elif boots == 1:
        print("\nOne board session throughout: no evidence of a restart in this window.")
    else:
        print("\nNo session id was seen at all; the board sent nothing this tool could parse.")
    if truncated or board_truncated:
        print(f"{truncated} line(s) arrived damaged; the board reported {board_truncated} "
              "line(s) it could not send whole. Those are lost bytes, not restarts.")
    return 0


def read_identity(port: str, recorder: "Recorder", budget_s: float) -> dict | None:
    """Open once, return the first message that carries a session and an uptime, then close."""
    recorder.event("open_attempt")
    try:
        connection = serial.Serial()
        connection.port = port
        connection.baudrate = BAUD
        connection.timeout = READ_TIMEOUT_S
        connection.write_timeout = 1.0
        connection.dtr = DTR_ON_OPEN
        connection.rts = RTS_ON_OPEN
        connection.open()
    except Exception as exc:
        recorder.event("open_error", reason=str(exc))
        return None
    recorder.event("open_success")
    deadline = time.monotonic() + budget_s
    buffer = bytearray()
    found = None
    reason = "identity read"
    try:
        while time.monotonic() < deadline and found is None:
            chunk = connection.read(max(1, connection.in_waiting))
            if not chunk:
                continue
            buffer.extend(chunk)
            while True:
                cut = buffer.find(b"\n")
                if cut < 0:
                    break
                raw = bytes(buffer[:cut]).strip()
                del buffer[:cut + 1]
                if not raw:
                    continue
                recorder.raw(raw.decode("utf-8", errors="replace"))
                try:
                    message = json.loads(raw.decode("utf-8"))
                except json.JSONDecodeError:
                    continue
                if isinstance(message, dict) and message.get("session") and "uptime_ms" in message:
                    found = message
                    break
    except Exception as exc:
        reason = str(exc) or exc.__class__.__name__
        recorder.event("read_error", reason=reason)
    finally:
        try:
            connection.close()
        except Exception:
            pass
        recorder.event("close", reason=reason)
    return found


def watch_cycles(port: str, cycles: int, gap_s: float) -> int:
    """Round D: does closing and reopening the port change the board session."""
    if serial is None:
        print("pyserial is not installed; run pip install -r laptop/requirements.txt", file=sys.stderr)
        return 2

    recorder = Recorder(port, "cycles")
    recorder.event("watch_start", mode="cycles", cycles=cycles, gap_seconds=gap_s,
                   dtr=DTR_ON_OPEN, rts=RTS_ON_OPEN)
    observations = []
    for index in range(cycles):
        if index:
            recorder.event("gap_start", seconds=gap_s, note="nothing holds the port during the gap")
            time.sleep(gap_s)
        wall = time.monotonic()
        # A heartbeat is a second apart, so give a few of them room to arrive.
        message = read_identity(port, recorder, budget_s=8.0)
        if message is None:
            recorder.event("cycle_result", cycle=index + 1, outcome="no identity read")
            observations.append(None)
            continue
        recorder.event("cycle_result", cycle=index + 1, outcome="identity read",
                       **describe_message(message))
        observations.append((wall, message))

    seen = [item for item in observations if item]
    verdict = "not determined"
    if len(seen) >= 2:
        sessions = {item[1]["session"] for item in seen}
        if len(sessions) == 1:
            first_wall, first = seen[0]
            last_wall, last = seen[-1]
            elapsed_ms = (last_wall - first_wall) * 1000.0
            grew_ms = float(last["uptime_ms"]) - float(first["uptime_ms"])
            # Allow generous slack: the read budget and the gap are both approximate.
            kept_pace = abs(grew_ms - elapsed_ms) < max(5000.0, elapsed_ms * 0.5)
            verdict = ("same session and uptime kept pace: the board ran through the gaps"
                       if kept_pace else
                       "same session but uptime did not keep pace: needs another look")
            recorder.event("verdict", text=verdict, session=last["session"],
                           wall_elapsed_ms=round(elapsed_ms), uptime_grew_ms=round(grew_ms))
        else:
            verdict = f"{len(sessions)} different sessions: the board restarted between cycles"
            recorder.event("verdict", text=verdict, sessions=sorted(sessions))
    else:
        recorder.event("verdict", text="too few successful reads to compare")

    recorder.event("watch_end", **recorder.counts)
    print(f"\nevents: {recorder.events_path}")
    print(f"raw:    {recorder.raw_path}")
    print(f"\n{verdict}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", required=True, help="the board's COM port, for example COM7")
    parser.add_argument("--seconds", type=float, default=300.0, help="how long to watch")
    parser.add_argument("--presence-only", action="store_true",
                        help="round A: watch the device list without opening the port")
    parser.add_argument("--no-reconnect", action="store_true",
                        help="stop at the first drop instead of reopening")
    parser.add_argument("--cycles", type=int, default=0,
                        help="round D: open and close this many times and compare the session")
    parser.add_argument("--gap", type=float, default=10.0,
                        help="round D: seconds to leave the port alone between cycles")
    args = parser.parse_args(argv)

    if args.presence_only:
        return watch_presence(args.port, args.seconds)
    if args.cycles:
        return watch_cycles(args.port, args.cycles, args.gap)
    return watch_link(args.port, args.seconds, reconnect=not args.no_reconnect)


if __name__ == "__main__":
    raise SystemExit(main())
