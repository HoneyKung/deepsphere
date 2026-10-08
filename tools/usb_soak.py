"""Hold one dashboard SerialWorker open for a long run and count what happens to it.

Round C of the USB stability work order asks for the dashboard connected and used for ten
minutes. The button presses and the look of the UI need a person, but the part that decides
whether the link survives is the worker: one connection, commands queued through it rather than
opening the port again, and a reconnect only when something actually failed.

This drives exactly that class - the same SerialWorker the dashboard runs - with no Tk window,
so the connection half of round C can be measured without someone sitting at the screen.

    python tools/usb_soak.py --port COM6 --seconds 600

It sends a get_state every 30 seconds, the way pressing "Request state" would, and reports the
number of opens, reconnects, board sessions and messages at the end.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "laptop"))

from core import SerialLinkLog, SerialWorker  # noqa: E402  (path set above)

OUT_DIR = ROOT / "output/usb-stability"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", required=True)
    parser.add_argument("--seconds", type=float, default=600.0)
    parser.add_argument("--command-interval", type=float, default=30.0)
    args = parser.parse_args(argv)

    seen: Counter[str] = Counter()
    sessions: set[str] = set()
    uptimes: list[tuple[float, float]] = []
    drops: list[str] = []
    lock = threading.Lock()

    def incoming(message: dict) -> None:
        with lock:
            seen[str(message.get("type", "?"))] += 1
            if message.get("session"):
                sessions.add(str(message["session"]))
            if isinstance(message.get("uptime_ms"), (int, float)):
                uptimes.append((time.monotonic(), float(message["uptime_ms"])))

    def disconnected(reason: str) -> None:
        with lock:
            drops.append(reason)

    link_log = SerialLinkLog(OUT_DIR)
    worker = SerialWorker(args.port, incoming, disconnected, link_log=link_log)
    started = time.monotonic()
    worker.start()

    commands = 0
    next_command = started + args.command_interval
    try:
        while time.monotonic() - started < args.seconds:
            time.sleep(0.5)
            if time.monotonic() >= next_command:
                worker.send({"v": 1, "type": "get_state", "request_id": f"soak-{commands}"})
                commands += 1
                next_command = time.monotonic() + args.command_interval
    except KeyboardInterrupt:
        pass
    finally:
        worker.stop()

    elapsed = time.monotonic() - started
    print(f"\nran {elapsed:.0f}s on {args.port}")
    print(f"opens                {worker.opens}")
    print(f"reconnects           {worker.reconnects}")
    print(f"disconnect callbacks {len(drops)}")
    print(f"commands sent        {commands}")
    print(f"messages by type     {dict(seen)}")
    print(f"board sessions       {len(sessions)} {sorted(sessions)}")
    if len(uptimes) >= 2:
        wall = (uptimes[-1][0] - uptimes[0][0]) * 1000.0
        grew = uptimes[-1][1] - uptimes[0][1]
        print(f"uptime grew          {grew:.0f} ms while {wall:.0f} ms of wall clock passed")
    for reason in drops:
        print(f"  drop: {reason}")
    print(f"\nevents: {link_log.path}")

    # One open, no reconnects and one session is the shape round C is looking for.
    return 0 if worker.reconnects == 0 and len(sessions) <= 1 else 1


if __name__ == "__main__":
    raise SystemExit(main())
