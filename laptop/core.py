"""Non-UI dashboard logic: protocol safety, sample snapshots, and audio routing."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import queue
import sys
import threading
import time
from typing import Callable

try:
    import serial
except ImportError:  # pragma: no cover - optional until requirements are installed
    serial = None

try:
    from PIL import Image
except ImportError:  # pragma: no cover - optional until requirements are installed
    Image = None

try:
    import pygame
except ImportError:  # pragma: no cover - optional until requirements are installed
    pygame = None


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import live_ocean

LOGGER = logging.getLogger("deep_sphere")
CUES = {"scan_hit", "scan_miss", "collect_success", "analyze_open", "action_error"}
AMBIENCE = {"surface": "ambient_surface", "mid": "ambient_mid", "deep": "ambient_deep"}
DEPTH_STEP_NORM = 0.02
YAW_STEP_DEG = 5.0


class KeyboardCommandRouter:
    """Translate laptop demo keys into one-shot actions, depth deltas and heading steps.

    Heading here is a laptop demo input, not a reading of the cube turning. The
    build has no rotation sensor, so the arrow keys stand in for the heading the
    KY-040 wheel would supply on a later physical-controls enablement.
    """

    ACTION_KEYS = {"1": "scan", "2": "collect", "3": "analyze"}
    YAW_KEYS = {"Left": -1.0, "Right": 1.0}

    def __init__(self, depth_norm: float = 0.35, step: float = DEPTH_STEP_NORM,
                 yaw_deg: float = 0.0, yaw_step: float = YAW_STEP_DEG):
        self.depth_norm = max(0.0, min(1.0, float(depth_norm)))
        self.step = float(step)
        self.yaw_deg = float(yaw_deg) % 360.0
        self.yaw_step = float(yaw_step)
        self._held_actions: set[str] = set()

    def press(self, key: str, text_focus: bool = False) -> tuple[str, float | None] | None:
        if text_focus:
            return None
        if key in self.ACTION_KEYS:
            if key in self._held_actions:
                return None
            self._held_actions.add(key)
            return self.ACTION_KEYS[key], None
        if key in {"Up", "Down"}:
            direction = -1.0 if key == "Up" else 1.0
            self.depth_norm = max(0.0, min(1.0, self.depth_norm + direction * self.step))
            return "depth", self.depth_norm
        if key in self.YAW_KEYS:
            self.yaw_deg = (self.yaw_deg + self.YAW_KEYS[key] * self.yaw_step) % 360.0
            return "yaw", self.yaw_deg
        return None

    def release(self, key: str) -> None:
        self._held_actions.discard(key)

    def clear(self) -> None:
        self._held_actions.clear()


class EventDeduper:
    def __init__(self, limit: int = 2048):
        self._keys = set()
        self._queue = deque(maxlen=limit)
        self._sample_ids = set()

    def accept(self, message: dict) -> bool:
        session, seq = message.get("session"), message.get("seq")
        key = (session, seq)
        if session is not None and seq is not None and key in self._keys:
            return False
        sample_id = message.get("sample_id")
        if sample_id and sample_id in self._sample_ids:
            return False
        if session is not None and seq is not None:
            self._keys.add(key)
            self._queue.append(key)
            if len(self._keys) > self._queue.maxlen:
                self._keys = set(self._queue)
        if sample_id:
            self._sample_ids.add(sample_id)
        return True


@dataclass
class Sample:
    sample_id: str
    target_id: str
    depth_norm: float
    asset_pack: str
    crop: dict
    image_path: Path
    metadata_path: Path
    received_at: str


class SampleStore:
    def __init__(self, root: Path, pack_id: str):
        self.root = root
        self.pack_id = pack_id
        self.samples_dir = root / "output" / "samples"
        self.atlas_path = root / "assets" / "generated" / "sea_atlas.png"
        self.pack_path = root / "assets" / "generated" / "pack.json"
        self.samples: dict[str, Sample] = {}
        self.load()

    def load(self) -> None:
        self.samples_dir.mkdir(parents=True, exist_ok=True)
        found: list[Sample] = []
        for meta_path in sorted(self.samples_dir.glob("*.json")):
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                image_path = self.samples_dir / meta["image_file"]
                if image_path.exists():
                    found.append(Sample(meta["sample_id"], meta.get("target_id", ""), float(meta["depth_norm"]), meta["asset_pack"], meta["crop"], image_path, meta_path, meta["received_at"]))
            except (OSError, KeyError, TypeError, ValueError) as exc:
                LOGGER.warning("Skipping invalid sample metadata %s: %s", meta_path, exc)
        for sample in sorted(found, key=lambda item: item.received_at):
            self.samples[sample.sample_id] = sample

    def target_info(self, target_id: str) -> dict:
        live = live_ocean.subject_info(target_id)
        if live:
            return live
        for path in (self.root / "assets" / "generated" / "targets.json",
                     self.root / "assets" / "source" / "targets.json"):
            try:
                targets = json.loads(path.read_text(encoding="utf-8")).get("targets", [])
            except (OSError, json.JSONDecodeError):
                continue
            for target in targets:
                if target.get("target_id") == target_id:
                    return target
        return {}

    def pack_status(self, event_pack: str | None = None) -> tuple[bool, str]:
        if not event_pack:
            return False, "missing_asset_pack"
        if not self.pack_path.exists() or not self.atlas_path.exists():
            return False, "asset pack is missing; run tools/generate_atlas.py"
        try:
            manifest = json.loads(self.pack_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            return False, f"asset pack manifest unreadable: {exc}"
        if manifest.get("asset_pack") != self.pack_id or (event_pack and event_pack != manifest.get("asset_pack")):
            return False, "asset_mismatch"
        return True, "ok"

    def _crop_wrap(self, crop: dict):
        if Image is None:
            raise RuntimeError("Pillow is required to save samples")
        atlas = Image.open(self.atlas_path).convert("RGB")
        width = max(1, round(float(crop["w"]) * atlas.width))
        height = max(1, round(float(crop["h"]) * atlas.height))
        start_x = round(float(crop["u"]) * atlas.width)
        start_y = round(float(crop["v"]) * atlas.height)
        output = Image.new("RGB", (width, height), (0, 0, 0))
        source = atlas.load()
        target = output.load()
        for y in range(height):
            source_y = max(0, min(atlas.height - 1, start_y + y))
            for x in range(width):
                source_x = (start_x + x) % atlas.width
                target[x, y] = source[source_x, source_y]
        return output

    def _render_snapshot_crop(self, event: dict):
        snapshot = event["snapshot"]
        if snapshot.get("renderer") != live_ocean.RENDERER or int(snapshot.get("scene_version", -1)) != live_ocean.SCHEMA_VERSION:
            raise ValueError("unsupported live scene snapshot")
        return live_ocean.render_live_crop(event["crop"], float(snapshot["depth_norm"]), int(snapshot["scene_tick"]))

    def save_candidate(self, event: dict) -> tuple[bool, str, Sample | None]:
        sample_id = event.get("sample_id")
        if not sample_id:
            return False, "missing_sample_id", None
        if sample_id in self.samples:
            return True, "duplicate_already_saved", self.samples[sample_id]
        valid, reason = self.pack_status(event.get("asset_pack"))
        if not valid:
            return False, reason, None
        try:
            crop = event["crop"]
            image = self._render_snapshot_crop(event) if event.get("snapshot") else self._crop_wrap(crop)
            safe_id = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in sample_id)
            image_name = f"{safe_id}.png"
            meta_name = f"{safe_id}.json"
            image_path = self.samples_dir / image_name
            meta_path = self.samples_dir / meta_name
            received_at = datetime.now(timezone.utc).isoformat()
            metadata = {"schema_version": 2 if event.get("snapshot") else 1,
                        "sample_id": sample_id, "target_id": event.get("target_id", ""),
                        "depth_norm": event["depth_norm"], "asset_pack": event["asset_pack"],
                        "crop": crop, "received_at": received_at, "image_file": image_name}
            if event.get("snapshot"):
                metadata["renderer"] = event["snapshot"].get("renderer")
                metadata["scene_version"] = event["snapshot"].get("scene_version")
                metadata["scene_tick"] = event["snapshot"].get("scene_tick")
            image.save(image_path, "PNG", optimize=False)
            meta_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            sample = Sample(sample_id, metadata["target_id"], float(metadata["depth_norm"]), metadata["asset_pack"], crop, image_path, meta_path, received_at)
            self.samples[sample_id] = sample
            return True, "saved", sample
        except (KeyError, TypeError, ValueError, OSError, RuntimeError) as exc:
            LOGGER.exception("Could not save sample %s", sample_id)
            return False, f"save_error:{exc}", None


def configured_asset_pack_id(root: Path) -> str:
    """Read the current pack id from project config instead of baking test-art into the host."""
    for path, key in ((root / "config" / "scene.json", "asset_pack_id"),
                      (root / "assets" / "generated" / "pack.json", "asset_pack")):
        try:
            value = json.loads(path.read_text(encoding="utf-8")).get(key)
        except (OSError, json.JSONDecodeError):
            continue
        if value:
            return str(value)
    return ""


CROSSFADE_MS = 900
# Two channels for ambience so a zone change can fade across instead of cutting; the third
# carries one-shots, which must never interrupt the loop.
AMBIENCE_CHANNELS = (0, 1)
CUE_CHANNEL = 2


class AudioMixer:
    def __init__(self, audio_root: Path, catalog_path: Path, enabled: bool = True):
        self.audio_root = audio_root
        self.enabled = enabled and pygame is not None
        self.sounds: dict[str, object] = {}
        self.missing: list[str] = []
        self.current_zone: str | None = None
        self.muted = False
        self._closed = False
        self.logger = LOGGER
        self._ambience_slot = 0
        if not enabled:
            self.logger.info("audio disabled by command line")
        elif pygame is None:
            self.logger.warning("pygame missing; audio cues will be skipped")
        if self.enabled:
            try:
                pygame.mixer.init()
                pygame.mixer.set_num_channels(max(AMBIENCE_CHANNELS) + 2)
            except pygame.error as exc:
                self.enabled = False
                self.logger.warning("audio mixer unavailable: %s", exc)
        try:
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            for cue in catalog.get("cues", []):
                cue_id = cue.get("cue_id", "unnamed")
                path = audio_root / cue["file"]
                if not path.exists():
                    self.missing.append(cue_id)
                    self.logger.warning("audio file missing for cue %s: %s", cue_id, path)
                    continue
                if not self.enabled:
                    continue
                try:
                    sound = pygame.mixer.Sound(str(path))
                    sound.set_volume(_gain_to_volume(cue.get("gain_db", 0.0)))
                    self.sounds[cue_id] = sound
                except pygame.error as exc:
                    self.missing.append(cue_id)
                    self.logger.warning("audio cue %s could not be loaded: %s", cue_id, exc)
        except (OSError, json.JSONDecodeError) as exc:
            self.logger.warning("audio catalog unavailable: %s", exc)

    def set_zone(self, zone: str | None) -> None:
        """Repeated state messages for the same zone must not restart the loop."""
        if not zone or zone == self.current_zone:
            return
        self.current_zone = zone
        sound = self.sounds.get(AMBIENCE.get(zone, ""))
        if not self.enabled or self.muted or not sound:
            return
        self._play_ambience(sound)

    def _play_ambience(self, sound) -> None:
        outgoing = pygame.mixer.Channel(AMBIENCE_CHANNELS[self._ambience_slot])
        self._ambience_slot = 1 - self._ambience_slot
        incoming = pygame.mixer.Channel(AMBIENCE_CHANNELS[self._ambience_slot])
        outgoing.fadeout(CROSSFADE_MS)
        incoming.play(sound, loops=-1, fade_ms=CROSSFADE_MS)

    def set_muted(self, muted: bool) -> bool:
        """Mute immediately and restore the current zone without changing gains."""
        if not self.enabled:
            return False
        muted = bool(muted)
        if muted == self.muted:
            return True
        self.muted = muted
        if muted:
            for channel_id in (*AMBIENCE_CHANNELS, CUE_CHANNEL):
                pygame.mixer.Channel(channel_id).stop()
        elif self.current_zone:
            sound = self.sounds.get(AMBIENCE.get(self.current_zone, ""))
            if sound:
                self._play_ambience(sound)
        return True

    def play(self, cue_id: str) -> None:
        sound = self.sounds.get(cue_id)
        if self.enabled and not self.muted and sound:
            pygame.mixer.Channel(CUE_CHANNEL).play(sound)

    def close(self) -> None:
        if self.enabled:
            for channel_id in (*AMBIENCE_CHANNELS, CUE_CHANNEL):
                pygame.mixer.Channel(channel_id).stop()
            self._closed = True


def _gain_to_volume(gain_db: float) -> float:
    try:
        return max(0.0, min(1.0, 10.0 ** (float(gain_db) / 20.0)))
    except (TypeError, ValueError):
        return 1.0


@dataclass
class DashboardState:
    connected: bool = False
    connection_label: str = "disconnected"
    asset_status: str = "not checked"
    depth_norm: float | None = None
    zone: str | None = None
    yaw_deg: float | None = None
    yaw_source: str | None = None
    inputs: str | None = None
    wheel_role: str | None = None
    aim_visible: bool = False
    target_id: str | None = None
    scan_result: str = "no scan yet"
    scan_target: str | None = None
    selected_sample_id: str | None = None
    error: str | None = None


class DashboardModel:
    def __init__(self, root: Path, send: Callable[[dict], None], audio: AudioMixer):
        self.store = SampleStore(root, configured_asset_pack_id(root))
        self.send = send
        self.audio = audio
        self.state = DashboardState()
        self.deduper = EventDeduper()
        self.log_lines: deque[str] = deque(maxlen=100)
        self.on_change: Callable[[], None] | None = None

    def log(self, message: str) -> None:
        LOGGER.info(message)
        self.log_lines.append(message)
        if self.on_change:
            self.on_change()

    def connected_to(self, label: str) -> None:
        self.state.connected = True
        self.state.connection_label = label
        self.send({"v": 1, "type": "get_state"})
        self.log(f"connected: {label}; requested current state")

    def disconnected(self, reason: str = "closed") -> None:
        self.state.connected = False
        self.state.connection_label = f"disconnected: {reason}"
        self.log(self.state.connection_label)

    def stopping(self) -> None:
        self.state.connected = False
        self.state.connection_label = "stopping"
        self.log(self.state.connection_label)
        if self.on_change:
            self.on_change()

    def receive(self, message: dict) -> None:
        message_type = message.get("type")
        if message_type in {"event", "state", "hello"} and not self.deduper.accept(message):
            self.log("ignored duplicate message")
            return
        if message_type == "hello":
            self.state.asset_status = "asset pack OK" if message.get("asset_pack") == self.store.pack_id else "asset_mismatch"
            self.log(f"hello from {message.get('device', 'unknown')} ({message.get('inputs', 'unknown')})")
        elif message_type == "state":
            self.state.depth_norm = message.get("depth_norm")
            self.state.zone = message.get("zone")
            self.state.yaw_deg = message.get("yaw_deg")
            self.state.yaw_source = message.get("yaw_source")
            self.state.inputs = message.get("inputs")
            self.state.wheel_role = message.get("wheel_role")
            self.state.aim_visible = bool(message.get("aim_visible"))
            self.state.target_id = message.get("target_id")
            self.audio.set_zone(self.state.zone)
        elif message_type == "event":
            self._event(message)
        elif message_type == "log":
            self.log(message.get("message", "board log"))
        if self.on_change:
            self.on_change()

    def _event(self, event: dict) -> None:
        name, result = event.get("name"), event.get("result")
        if name == "scan":
            self.state.scan_result = result or "unknown"
            self.state.scan_target = event.get("target_id")
            self.audio.play("scan_hit" if result == "hit" else "scan_miss")
        elif name == "collect" and result == "candidate":
            ok, reason, sample = self.store.save_candidate(event)
            if ok and sample:
                self.state.error = None
                self.state.selected_sample_id = sample.sample_id
                self.audio.play("collect_success")
                self.send({"v": 1, "type": "collect_ack", "session": event.get("session"), "sample_id": sample.sample_id, "status": "saved"})
                self.log(f"saved sample snapshot: {sample.sample_id}")
            else:
                self.state.error = reason
                self.audio.play("action_error")
                self.send({"v": 1, "type": "collect_ack", "session": event.get("session"), "sample_id": event.get("sample_id"), "status": "error", "reason": reason})
                self.log(f"collect rejected: {reason}")
        elif name == "collect":
            self.state.error = event.get("reason", "collect miss")
            self.audio.play("action_error")
        elif name == "analyze":
            self.analyze()

    def analyze(self) -> Sample | None:
        sample = self.store.samples.get(self.state.selected_sample_id) if self.state.selected_sample_id else None
        if sample is None and self.store.samples:
            sample = self.store.samples[next(reversed(self.store.samples))]
            self.state.selected_sample_id = sample.sample_id
        if sample is None:
            self.state.error = "no sample; collect a sample first"
            self.audio.play("action_error")
            self.log(self.state.error)
        else:
            self.state.error = None
            self.audio.play("analyze_open")
            self.log(f"analysis opened: {sample.sample_id}")
        if self.on_change:
            self.on_change()
        return sample


class SerialLinkLog:
    """Timestamped record of what happened to the serial port, as JSON lines.

    A drop has to be attributable afterwards, not from memory, so every open, close, read
    failure, write failure and reconnect gets a time, a port and a reason. Reads that return
    no bytes are the normal idle case and are never recorded: logging those buries the events
    that matter under thousands of lines.
    """

    EVENTS = ("open_attempt", "open_success", "open_error", "close", "read_error", "write_error", "reconnect")

    def __init__(self, directory: Path | None = None, sink: Callable[[dict], None] | None = None):
        self.sink = sink
        self.path: Path | None = None
        self.entries: list[dict] = []
        if directory is not None:
            directory.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            self.path = directory / f"serial-events-{stamp}.jsonl"

    def record(self, event: str, port: str, reason: str = "", **fields) -> dict:
        entry = {"at": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
                 "event": event, "port": port}
        if reason:
            entry["reason"] = reason
        entry.update(fields)
        self.entries.append(entry)
        LOGGER.info("serial %s on %s%s", event, port, f": {reason}" if reason else "")
        if self.path is not None:
            try:
                with self.path.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
            except OSError as exc:  # a full or read-only disk must not take the link down
                LOGGER.warning("could not write serial event log: %s", exc)
        if self.sink:
            self.sink(entry)
        return entry


class LinkFailure(Exception):
    """A link error whose event has already been recorded, so it is not logged twice."""


class SerialWorker(threading.Thread):
    """Sole owner of the board's serial port.

    One thread opens it, reads it and writes it. Callers hand messages to an outbox instead
    of touching the port, because two threads writing the same handle can interleave halves
    of two JSON lines, and because a write on a stalled port would otherwise block whichever
    thread called send() - in the dashboard, the UI thread.
    """

    RECONNECT_DELAY_S = 1.0
    MAX_LINE_BYTES = 8192
    # A write that cannot drain has to fail rather than wait for ever.
    WRITE_TIMEOUT_S = 1.0
    # How long stop() waits for the port handle to actually be released.
    STOP_JOIN_S = 2.0

    def __init__(self, port: str, incoming: Callable[[dict], None], disconnected: Callable[[str], None],
                 link_log: "SerialLinkLog | None" = None):
        super().__init__(daemon=True)
        self.port = port
        self.incoming = incoming
        self.disconnected = disconnected
        self.stop_requested = threading.Event()
        self.connection = None
        self.link_log = link_log or SerialLinkLog()
        self.opens = 0
        self.reconnects = 0
        self._outbox: queue.Queue[dict] = queue.Queue()

    def _open(self):
        """Open the port with the modem lines this board was measured to need.

        Measured here, not assumed from the chip family: with DTR low the ESP32-S3 USB CDC
        stack sent nothing and the dashboard saw a silent board, and with DTR high and RTS
        low the board kept the same session across two consecutive opens, so opening the
        port does not by itself reset this chip. RTS stays low because that is the line
        esptool drives to force a reset.

        This says what these settings did on this machine. It is not a promise about every
        OS and driver: pyserial documents that some of them still pulse the control lines
        while a port is being opened, which no assignment made here can prevent.
        """
        self.link_log.record("open_attempt", self.port)
        connection = serial.Serial()
        connection.port = self.port
        connection.baudrate = 115200
        connection.timeout = 0.1
        connection.write_timeout = self.WRITE_TIMEOUT_S
        connection.dtr = True
        connection.rts = False
        connection.open()
        self.opens += 1
        self.link_log.record("open_success", self.port, dtr=True, rts=False, opens=self.opens)
        return connection

    def _drain_outbox(self) -> None:
        """Write every queued message. The only place this class writes to the port."""
        while not self.stop_requested.is_set():
            try:
                message = self._outbox.get_nowait()
            except queue.Empty:
                return
            payload = (json.dumps(message, separators=(",", ":")) + "\n").encode("utf-8")
            try:
                self.connection.write(payload)
            except Exception as exc:
                reason = str(exc) or exc.__class__.__name__
                self.link_log.record("write_error", self.port, reason=reason,
                                     message_type=str(message.get("type", "")))
                raise LinkFailure(reason) from exc

    def _pump(self) -> None:
        """Read whole lines, not whatever happened to arrive before the timeout.

        readline() on a timed-out port hands back a partial line, so a state message could
        be split across two reads and both halves failed to parse. Buffer the bytes and cut
        them on newlines instead.
        """
        buffer = bytearray()
        while not self.stop_requested.is_set():
            self._drain_outbox()
            chunk = self.connection.read(max(1, self.connection.in_waiting))
            if not chunk:
                # An idle port is the normal case, not evidence of a drop. Say nothing.
                continue
            buffer.extend(chunk)
            if len(buffer) > self.MAX_LINE_BYTES:
                # A line this long is line noise, not a message. Drop it and resynchronise.
                LOGGER.warning("serial line exceeded %d bytes; resynchronising", self.MAX_LINE_BYTES)
                del buffer[:-1]
            while True:
                cut = buffer.find(b"\n")
                if cut < 0:
                    break
                raw = bytes(buffer[:cut]).strip()
                del buffer[:cut + 1]
                if not raw:
                    continue
                try:
                    self.incoming(json.loads(raw.decode("utf-8")))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    # Garbled bytes are a parse problem, not a dead link: keep reading.
                    LOGGER.warning("serial parse error: %s", exc)

    def run(self) -> None:
        if serial is None:
            self.disconnected("pyserial is not installed")
            return
        opened_once = False
        while not self.stop_requested.is_set():
            try:
                self.connection = self._open()
                opened_once = True
            except Exception as exc:  # serial.SerialException is optional in type-only environments
                reason = str(exc) or exc.__class__.__name__
                self.link_log.record("open_error", self.port, reason=reason)
                self.disconnected("board port went away; reconnecting" if opened_once else reason)
                if not opened_once or self.stop_requested.wait(self.RECONNECT_DELAY_S):
                    return
                continue
            reason = "stopped by request"
            try:
                self._pump()
            except LinkFailure as exc:
                # _drain_outbox already recorded the write_error that caused this.
                reason = str(exc)
                self.disconnected("board port went away; reconnecting")
            except Exception as exc:
                # The port disappears whenever the board resets, because the USB device is
                # the board itself. Keep the worker alive and pick the link back up.
                reason = str(exc) or exc.__class__.__name__
                self.link_log.record("read_error", self.port, reason=reason)
                self.disconnected("board port went away; reconnecting")
                LOGGER.warning("serial link dropped, reconnecting: %s", exc)
            finally:
                self.link_log.record("close", self.port, reason=reason)
                try:
                    if self.connection:
                        self.connection.close()
                except Exception:
                    pass
                self.connection = None
            if self.stop_requested.is_set():
                return
            self.reconnects += 1
            self.link_log.record("reconnect", self.port, reason=reason, attempt=self.reconnects)
            if self.stop_requested.wait(self.RECONNECT_DELAY_S):
                return

    def send(self, message: dict) -> None:
        """Queue a message for the worker thread. The caller never touches the port."""
        if not self.stop_requested.is_set():
            self._outbox.put(message)

    def stop(self, wait: bool = True) -> bool:
        """Stop the worker and, by default, wait until the port handle is released.

        Upload needs the port free at the moment esptool asks for it, so returning while
        this thread still holds the handle hands esptool a port the dashboard owns.
        Returns True if the worker thread stopped and released the handle, False otherwise.
        """
        self.stop_requested.set()
        if wait and self.is_alive() and threading.current_thread() is not self:
            self.join(self.STOP_JOIN_S)
            if self.is_alive():
                LOGGER.warning("serial worker did not release %s within %.1fs", self.port, self.STOP_JOIN_S)
                return False
        return not self.is_alive()


class BoardSimulator:
    """Stands in for the board, using the same math module the firmware is checked against.

    It is not a claim that the hardware works. Everything it emits is labelled
    inputs=keyboard, exactly as the board does in the keyboard-first default.
    """

    def __init__(self, root: Path, emit: Callable[[dict], None]):
        from atlas_math import aim_projection, faces_from_config, hit_target, quaternion_matrix

        self._aim_projection = aim_projection
        self._hit_target = hit_target
        faces_cfg = json.loads((root / "config/faces.json").read_text(encoding="utf-8"))
        self.scene = json.loads((root / "config/scene.json").read_text(encoding="utf-8"))
        self.targets = json.loads((root / "assets/source/targets.json").read_text(encoding="utf-8"))["targets"]
        self.faces = faces_from_config(faces_cfg)
        self.enabled_faces = set(faces_cfg.get("enabled_outputs", {}).get("faces", []))
        self.physical_rects = {item["id"]: item["physical_face_uv"] for item in faces_cfg["faces"]}
        self.mount = quaternion_matrix(faces_cfg["mount_orientation"]["quaternion_wxyz"])
        self.active = faces_cfg["active_image"]
        self.aim_world = tuple(self.scene["aim_world"])
        self.emit = emit
        self.session = "sim-" + datetime.now(timezone.utc).strftime("%H%M%S")
        self.seq = 0
        self.yaw_deg = 0.0
        self.yaw_source = "none"
        self.depth_norm = 0.35
        self.pending_ack: str | None = None
        self.last_host_request_id: str | None = None
        self.scene_epoch_ms = int(time.monotonic() * 1000)
        self.scene_tick = 0
        # Tests and the capture tool pin the scene to one tick; None follows the wall clock.
        self.frozen_tick: int | None = None

    def refresh_scene_tick(self) -> None:
        if self.frozen_tick is not None:
            self.scene_tick = int(self.frozen_tick)
            return
        elapsed = int(time.monotonic() * 1000) - self.scene_epoch_ms
        self.scene_tick = live_ocean.tick_from_ms(elapsed)

    def _next(self, message_type: str) -> dict:
        self.seq += 1
        return {"v": 1, "type": message_type, "session": self.session, "seq": self.seq}

    def projection(self) -> dict:
        return self.projection_at(self.yaw_deg)

    def projection_at(self, yaw_deg: float) -> dict:
        return self._aim_projection(yaw_deg, self.aim_world, self.mount, self.faces,
                                    self.active, self.depth_norm, self.scene,
                                    physical_rects=self.physical_rects,
                                    enabled_faces=self.enabled_faces)

    def target(self):
        """The subject on the pixel under the reticle, by the same rule the board uses."""
        self.refresh_scene_tick()
        return live_ocean.hit_at_reticle(self.projection(), live_ocean.targets_at_tick(self.scene_tick))

    def zone(self) -> str:
        if self.depth_norm < 0.25:
            return "surface"
        return "mid" if self.depth_norm < 0.65 else "deep"

    def hello(self) -> None:
        message = self._next("hello")
        message.update(device="deep-sphere-v1", inputs="keyboard", yaw_source=self.yaw_source,
                       asset_pack=self.scene["asset_pack_id"])
        self.emit(message)

    def state(self) -> None:
        self.refresh_scene_tick()
        projection = self.projection()
        target = self.target()
        message = self._next("state")
        message.update(depth_norm=round(self.depth_norm, 4), zone=self.zone(),
                       yaw_deg=round(self.yaw_deg, 2), aim_visible=projection["visible"],
                       target_id=target["target_id"] if target else None,
                       inputs="keyboard", yaw_source=self.yaw_source, wheel_role="none",
                       renderer=live_ocean.RENDERER, scene_version=live_ocean.SCHEMA_VERSION,
                       scene_tick=self.scene_tick)
        self.emit(message)

    def set_yaw(self, degrees: float, source: str | None = None) -> None:
        """Set the simulated heading. `source` records who supplied it, never a sensor."""
        self.yaw_deg = degrees % 360.0
        if source is not None:
            self.yaw_source = source
        self.state()

    def set_depth(self, depth: float) -> None:
        # Four decimals, like the board, so a saved sample is rebuilt at the depth it was drawn at.
        self.depth_norm = round(max(0.0, min(1.0, depth)), 4)
        self.state()

    def scan(self) -> None:
        self.refresh_scene_tick()
        target = self.target()
        message = self._next("event")
        message.update(name="scan", result="hit" if target else "miss",
                       target_id=target["target_id"] if target else None,
                       depth_norm=round(self.depth_norm, 4), renderer=live_ocean.RENDERER,
                       scene_version=live_ocean.SCHEMA_VERSION, scene_tick=self.scene_tick)
        self.emit(message)

    def collect(self) -> None:
        self.refresh_scene_tick()
        projection = self.projection()
        target = self.target()
        message = self._next("event")
        if not projection["visible"]:
            message.update(name="collect", result="miss", reason="reticle_gap")
        elif target is None:
            message.update(name="collect", result="miss", reason="no_target")
        else:
            self.pending_ack = f"{self.session}-{self.seq}"
            snapshot = {"renderer": live_ocean.RENDERER, "scene_version": live_ocean.SCHEMA_VERSION,
                        "scene_tick": self.scene_tick, "depth_norm": round(self.depth_norm, 4),
                        "yaw_deg": round(self.yaw_deg, 2)}
            message.update(name="collect", result="candidate", sample_id=self.pending_ack,
                           target_id=target["target_id"], asset_pack=self.scene["asset_pack_id"],
                           depth_norm=round(self.depth_norm, 4), crop=live_ocean.collect_crop(target),
                           snapshot=snapshot)
        self.emit(message)

    def analyze(self) -> None:
        message = self._next("event")
        message.update(name="analyze", result="requested", target_id=None)
        self.emit(message)

    def ack(self, request_id: str, status: str) -> None:
        message = self._next("ack")
        message.update(request_id=request_id, status=status)
        self.emit(message)

    def receive_from_host(self, message: dict) -> None:
        if message.get("type") == "get_state":
            self.hello()
            self.state()
        elif message.get("type") == "command":
            request_id = message.get("request_id", "")
            if request_id and request_id == self.last_host_request_id:
                self.ack(request_id, "duplicate")
                return
            if request_id:
                self.last_host_request_id = request_id
            action = message.get("action")
            if action == "display_diagnostic_all":
                if not self.enabled_faces:
                    self.ack(request_id, "rejected_no_enabled_panels")
                    return
                self.ack(request_id, "accepted")
                self.emit({**self._next("log"), "message": "simulated display diagnostic painted all enabled faces"})
            elif action == "display_diagnostic":
                face = message.get("face", "")
                if face not in self.enabled_faces:
                    self.ack(request_id, "rejected_disabled_face" if face in self.physical_rects else "rejected_unknown_face")
                else:
                    self.ack(request_id, "accepted")
                    self.emit({**self._next("log"), "message": f"simulated display diagnostic painted face {face}"})
            else:
                self.ack(request_id, "accepted")
                if action == "scan": self.scan()
                elif action == "collect": self.collect()
                elif action == "analyze": self.analyze()
        elif message.get("type") == "depth_delta":
            request_id = message.get("request_id", "")
            if request_id and request_id == self.last_host_request_id:
                self.ack(request_id, "duplicate")
                return
            if request_id:
                self.last_host_request_id = request_id
            self.set_depth(self.depth_norm + float(message.get("delta_norm", 0.0)))
            self.ack(request_id, "accepted")
        elif message.get("type") == "collect_ack" and message.get("sample_id") == self.pending_ack:
            self.pending_ack = None
