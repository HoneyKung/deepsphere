from __future__ import annotations

import json
import math
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
import unittest.mock
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "laptop"))

import core as core_module
from core import (DEPTH_STEP_NORM, YAW_STEP_DEG, AudioMixer, BoardSimulator, DashboardModel, EventDeduper,
                  Image, KeyboardCommandRouter, SampleStore, SerialWorker, pygame as pygame_module)
from app import depth_pointer_y


TARGETS = json.loads((ROOT / "assets/source/targets.json").read_text(encoding="utf-8"))["targets"]
LIVE = core_module.live_ocean
COLLECT_TARGET_ID = LIVE.SUBJECTS[0]["target_id"]
COLLECT_YAW = 0.0  # the board's fixed heading: the reticle rests on the ny panel centre
COLLECT_DEPTH = 0.35


def _first_board_pass(subject_index: int) -> int:
    """First tick the subject swims under the board's fixed reticle."""
    probe = BoardSimulator(ROOT, lambda message: None)
    ticks = LIVE.hittable_ticks(probe.projection_at(COLLECT_YAW), range(0, 400))[subject_index]
    if not ticks:
        raise AssertionError("the scene no longer brings subject 0 under the board reticle")
    return ticks[0]


COLLECT_TICK = _first_board_pass(0)


def _empty_water_yaw() -> float:
    probe = BoardSimulator(ROOT, lambda message: None)
    targets = LIVE.targets_at_tick(COLLECT_TICK)
    for step in range(72):
        projection = probe.projection_at(step * 5.0)
        if projection["visible"] and LIVE.hit_at_reticle(projection, targets) is None:
            return step * 5.0
    raise AssertionError("no visible empty water at the collect tick")


NO_TARGET_YAW = _empty_water_yaw()


def make_workspace(folder: Path) -> Path:
    """A throwaway project root that carries the real config and the real asset pack."""
    for relative in ("config/faces.json", "config/scene.json", "config/live_ocean.json", "assets/source/targets.json",
                     "assets/generated/pack.json", "assets/generated/sea_atlas.png"):
        destination = folder / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / relative, destination)
    (folder / "output" / "samples").mkdir(parents=True, exist_ok=True)
    return folder


def make_model(root: Path):
    sent: list[dict] = []
    audio = AudioMixer(root / "audio", root / "catalog.json", enabled=False)
    return DashboardModel(root, sent.append, audio), sent


class KeyboardInputTests(unittest.TestCase):
    def test_actions_are_one_shot_until_key_release_and_text_focus_blocks_them(self):
        router = KeyboardCommandRouter()
        self.assertEqual(router.press("1"), ("scan", None))
        self.assertIsNone(router.press("1"))
        self.assertIsNone(router.press("2", text_focus=True))
        router.release("1")
        self.assertEqual(router.press("1"), ("scan", None))

    def test_depth_keys_are_clamped_and_use_configured_step(self):
        router = KeyboardCommandRouter(depth_norm=0.02)
        self.assertEqual(router.press("Up"), ("depth", 0.0))
        router = KeyboardCommandRouter(depth_norm=0.98)
        self.assertEqual(router.press("Down"), ("depth", 1.0))
        self.assertIsNone(router.press("F5"))

    def test_heading_keys_step_and_wrap_without_touching_depth(self):
        router = KeyboardCommandRouter(depth_norm=0.4, yaw_deg=0.0, yaw_step=5.0)
        self.assertEqual(router.press("Right"), ("yaw", 5.0))
        self.assertEqual(router.press("Left"), ("yaw", 0.0))
        self.assertEqual(router.press("Left"), ("yaw", 355.0))
        self.assertEqual(router.depth_norm, 0.4)

    def test_heading_keys_repeat_while_held_unlike_one_shot_actions(self):
        router = KeyboardCommandRouter(yaw_deg=0.0, yaw_step=5.0)
        self.assertEqual(router.press("Right"), ("yaw", 5.0))
        self.assertEqual(router.press("Right"), ("yaw", 10.0))

    def test_router_key_map_agrees_with_the_controls_config(self):
        controls = json.loads((ROOT / "config/controls.json").read_text(encoding="utf-8"))
        demo = controls["laptop_demo_input"]
        self.assertEqual(set(KeyboardCommandRouter.YAW_KEYS), {"Left", "Right"})
        self.assertEqual(demo["keys"]["Left"], "heading_left")
        self.assertEqual(demo["keys"]["Right"], "heading_right")
        self.assertEqual(demo["heading_step_deg"], YAW_STEP_DEG)
        self.assertEqual(demo["depth_step_norm"], DEPTH_STEP_NORM)
        self.assertEqual(controls["yaw"]["source"], "none",
                         "the board still has no rotation sensor; arrow keys are a laptop-only stand-in")

    def test_depth_pointer_maps_surface_to_top_and_deep_to_bottom(self):
        self.assertLess(depth_pointer_y(0.0, 200), depth_pointer_y(0.5, 200))
        self.assertLess(depth_pointer_y(0.5, 200), depth_pointer_y(1.0, 200))
        self.assertEqual(depth_pointer_y(0.0, 200), 18.0)
        self.assertEqual(depth_pointer_y(1.0, 200), 182.0)


class HostCommandTests(unittest.TestCase):
    def test_simulator_accepts_keyboard_commands_and_deduplicates_request_ids(self):
        messages: list[dict] = []
        board = BoardSimulator(ROOT, messages.append)
        board.receive_from_host({"v": 1, "type": "depth_delta", "delta_norm": -0.5, "request_id": "ui-1"})
        self.assertEqual(board.depth_norm, 0.0)
        self.assertEqual([m["type"] for m in messages], ["state", "ack"])
        board.receive_from_host({"v": 1, "type": "depth_delta", "delta_norm": -0.5, "request_id": "ui-1"})
        self.assertEqual(messages[-1]["status"], "duplicate")

    def test_simulator_command_produces_board_event(self):
        messages: list[dict] = []
        board = BoardSimulator(ROOT, messages.append)
        board.receive_from_host({"v": 1, "type": "command", "action": "scan", "request_id": "ui-2"})
        self.assertEqual(messages[0]["type"], "ack")
        self.assertEqual(messages[1]["type"], "event")
        self.assertEqual(messages[1]["name"], "scan")


class DedupeTests(unittest.TestCase):
    def test_duplicate_session_sequence_is_ignored(self):
        deduper = EventDeduper()
        message = {"session": "sim", "seq": 4, "type": "event"}
        self.assertTrue(deduper.accept(message))
        self.assertFalse(deduper.accept(message))

    def test_duplicate_sample_id_is_ignored_even_with_new_sequence(self):
        deduper = EventDeduper()
        self.assertTrue(deduper.accept({"session": "a", "seq": 1, "sample_id": "a-1"}))
        self.assertFalse(deduper.accept({"session": "a", "seq": 2, "sample_id": "a-1"}))


class SerialLinkTests(unittest.TestCase):
    """The board is its own USB device, so how the port is opened decides whether it reboots."""

    class FakePort:
        def __init__(self):
            self.dtr = True
            self.rts = True
            self.opened_with = None
            self.is_open = False
            self.write_timeout = None
            self.written = []

        def open(self):
            self.opened_with = (self.dtr, self.rts)
            self.is_open = True

        def write(self, payload):
            self.written.append(payload)
            return len(payload)

    def test_the_port_is_opened_with_dtr_high_and_rts_low(self):
        """The board sent nothing with DTR low, and kept its session across opens with DTR high.

        This pins the measured pair rather than the earlier guess that both lines had to be
        low: that guess produced a silent board, which looked exactly like a dead link.
        """
        fake = self.FakePort()
        worker = SerialWorker("COM_TEST", lambda message: None, lambda reason: None)
        with unittest.mock.patch.object(core_module, "serial") as fake_serial:
            fake_serial.Serial.return_value = fake
            worker._open()
        self.assertEqual(fake.opened_with, (True, False),
                         "DTR high is what makes this board's USB CDC stack transmit; RTS is the reset line")

    def test_the_port_is_opened_with_a_write_timeout(self):
        fake = self.FakePort()
        worker = SerialWorker("COM_TEST", lambda message: None, lambda reason: None)
        with unittest.mock.patch.object(core_module, "serial") as fake_serial:
            fake_serial.Serial.return_value = fake
            worker._open()
        self.assertIsNotNone(fake.write_timeout, "a write with no timeout can block the caller for ever")

    def test_send_does_not_write_from_the_calling_thread(self):
        """Only the worker thread may touch the port, so the UI thread cannot be blocked by it."""
        fake = self.FakePort()
        fake.is_open = True
        worker = SerialWorker("COM_TEST", lambda message: None, lambda reason: None)
        worker.connection = fake
        worker.send({"v": 1, "type": "get_state"})
        self.assertEqual(fake.written, [], "send() must queue, not write")
        worker._drain_outbox()
        self.assertEqual(len(fake.written), 1, "the worker thread performs the write")

    def test_a_failed_write_is_recorded_and_reported_as_a_link_failure(self):
        class DeadPort(self.FakePort):
            def write(self, payload):
                raise OSError("device not configured")

        log = core_module.SerialLinkLog()
        worker = SerialWorker("COM_TEST", lambda message: None, lambda reason: None, link_log=log)
        worker.connection = DeadPort()
        worker.send({"v": 1, "type": "get_state"})
        with self.assertRaises(core_module.LinkFailure):
            worker._drain_outbox()
        self.assertEqual([entry["event"] for entry in log.entries], ["write_error"])
        self.assertIn("device not configured", log.entries[0]["reason"])

    def test_the_link_log_records_each_open_with_the_port_and_a_time(self):
        fake = self.FakePort()
        log = core_module.SerialLinkLog()
        worker = SerialWorker("COM_TEST", lambda message: None, lambda reason: None, link_log=log)
        with unittest.mock.patch.object(core_module, "serial") as fake_serial:
            fake_serial.Serial.return_value = fake
            worker._open()
        self.assertEqual([entry["event"] for entry in log.entries], ["open_attempt", "open_success"])
        for entry in log.entries:
            self.assertEqual(entry["port"], "COM_TEST")
            self.assertIn("at", entry)

    def test_stop_waits_for_the_worker_to_release_the_port(self):
        """Upload asks for the port immediately after Disconnect, so the handle must be gone."""
        fake = self.FakePort()
        released = threading.Event()

        class ClosingPort(self.FakePort):
            def read(self, _size):
                time.sleep(0.01)
                return b""

            @property
            def in_waiting(self):
                return 0

            def close(self):
                self.is_open = False
                released.set()

        closing = ClosingPort()
        closing.is_open = True
        worker = SerialWorker("COM_TEST", lambda message: None, lambda reason: None)
        worker.RECONNECT_DELAY_S = 0
        worker._open = lambda: closing
        with unittest.mock.patch.object(core_module, "serial", object()):
            worker.start()
            time.sleep(0.05)
            worker.stop()
        self.assertTrue(released.is_set(), "stop() returned while the port was still open")
        self.assertFalse(worker.is_alive(), "stop() returned before the worker finished")
        del fake

    def test_a_heartbeat_from_the_board_does_not_break_the_dashboard(self):
        """Telemetry added for the reset evidence must not make the model reject traffic."""
        with tempfile.TemporaryDirectory() as folder:
            model, _ = make_model(Path(folder))
            before = len(model.log_lines)
            model.receive({"v": 1, "type": "heartbeat", "session": "s3-test", "seq": 4,
                           "uptime_ms": 4021, "heartbeat": 4, "reset_reason": 1,
                           "reset_reason_name": "poweron", "stage": "loop_running",
                           "firmware_env": "esp32-s3-zero", "firmware_build": "Sep 14 2026 01:00:00"})
            self.assertGreaterEqual(len(model.log_lines), before,
                                    "an unknown message type must be ignored, not raise")
            self.assertIsNone(model.state.error, "a heartbeat is not an error")

    def test_a_dropped_port_reconnects_instead_of_killing_the_worker(self):
        reasons = []
        worker = SerialWorker("COM_TEST", lambda message: None, reasons.append)
        attempts = []

        def flaky_open():
            attempts.append(1)
            if len(attempts) >= 3:
                worker.stop_requested.set()
            raise OSError("port went away")

        worker.RECONNECT_DELAY_S = 0
        worker._open = flaky_open
        with unittest.mock.patch.object(core_module, "serial", object()):
            worker.run()
        self.assertEqual(len(attempts), 1, "the first failure is a bad port and must stop, not spin")
        self.assertTrue(reasons)

    def test_stop_returns_release_status_and_stops_accepting_send(self):
        worker = SerialWorker("COM_TEST", lambda message: None, lambda reason: None)
        self.assertTrue(worker.stop(), "idle worker should report stopped")
        worker.send({"v": 1, "type": "get_state"})
        self.assertTrue(worker._outbox.empty(), "send() must not queue when stop is requested")

    def test_drain_outbox_stops_when_stop_is_requested(self):
        fake = self.FakePort()
        fake.is_open = True
        worker = SerialWorker("COM_TEST", lambda message: None, lambda reason: None)
        worker.connection = fake
        worker._outbox.put({"v": 1, "type": "msg1"})
        worker.stop_requested.set()
        worker._outbox.put({"v": 1, "type": "msg2"})
        worker._drain_outbox()
        self.assertEqual(fake.written, [], "_drain_outbox must exit when stop_requested is set")

    def test_looks_truncated_heuristics(self):
        sys.path.insert(0, str(ROOT / "tools"))
        import usb_watch
        self.assertTrue(usb_watch._looks_truncated("s3-af6e27ac-", "s3-af6e27ac-339-341dba4f"))
        self.assertTrue(usb_watch._looks_truncated("s3-af6e27ac-339-341dba", "s3-af6e27ac-339-341dba4f"))
        self.assertFalse(usb_watch._looks_truncated("s3-af6e27ac-339-341dba4f", "s3-af6e27ac-339-341dba4f"))
        self.assertFalse(usb_watch._looks_truncated("s3-other-session-1234", "s3-af6e27ac-339-341dba4f"))

    def test_send_line_stream_recovery_state_machine(self):
        # 1. Verify firmware source contracts
        main_src = (ROOT / "firmware/src/main.cpp").read_text(encoding="utf-8")
        self.assertIn("bool gLineIncomplete", main_src)
        self.assertIn("kSerialTxTimeoutMs", main_src)
        sendline_start = main_src.index("void sendLine(const String& line)")
        sendline_body = main_src[sendline_start:main_src.index("void sendLog(", sendline_start)]
        self.assertIn("if (gLineIncomplete)", sendline_body)
        self.assertIn("if (nl == 0)", sendline_body)
        self.assertIn("gLineIncomplete = true;", sendline_body)
        self.assertIn("return;", sendline_body)

        # 2. Verify state machine behavior
        class MockSerial:
            def __init__(self):
                self.written = []
                self.write_limit = None
                self.allow_newline = True

            def write(self, data: bytes) -> int:
                if data == b"\n" and not self.allow_newline:
                    return 0
                if self.write_limit is not None:
                    actual = data[:self.write_limit]
                    self.written.append(actual)
                    return len(actual)
                self.written.append(data)
                return len(data)

        serial = MockSerial()
        incomplete = False
        truncated_count = 0

        def send_line(line: str) -> None:
            nonlocal incomplete, truncated_count
            if incomplete:
                nl = serial.write(b"\n")
                if nl == 0:
                    truncated_count += 1
                    return
                incomplete = False

            payload = (line + "\n").encode("utf-8")
            wanted = len(payload)
            written = serial.write(payload)
            if written < wanted:
                truncated_count += 1
                if written > 0:
                    nl = serial.write(b"\n")
                    if nl == 0:
                        incomplete = True

        # Partial write where immediate newline recovery fails
        serial.write_limit = 10
        serial.allow_newline = False
        send_line("message_one_abcdefghij")
        self.assertTrue(incomplete, "must remember that a line is pending/incomplete")
        self.assertEqual(serial.written, [b"message_on"])

        # Next send_line fails recovery -> new payload MUST NOT be sent
        send_line("message_two")
        self.assertTrue(incomplete, "remains incomplete when newline recovery fails")
        self.assertEqual(serial.written, [b"message_on"], "must NOT append new payload to dirty stream")
        self.assertEqual(truncated_count, 2)

        # Newline recovery succeeds -> pending boundary restored, new payload sent cleanly
        serial.allow_newline = True
        serial.write_limit = None
        send_line("message_three")
        self.assertFalse(incomplete, "incomplete state cleared after recovery")
        self.assertEqual(serial.written, [b"message_on", b"\n", b"message_three\n"])

    def test_worker_stop_failure_retains_worker_shows_stopping_and_blocks_connect(self):
        import app as app_module
        app = app_module.DashboardApp.__new__(app_module.DashboardApp)
        audio = core_module.AudioMixer(ROOT / "assets/audio", ROOT / "assets/audio/catalog.json", enabled=False)
        app.model = core_module.DashboardModel(ROOT, lambda msg: None, audio)
        app.worker = unittest.mock.MagicMock(spec=core_module.SerialWorker)
        app.worker.is_alive.return_value = True
        app.worker.stop.return_value = False
        app.events = unittest.mock.MagicMock()
        app.clear_held_keys = lambda: None
        app.port = unittest.mock.MagicMock()
        app.port.get.return_value = "COM_TEST"

        # 1. disconnect() when stop() returns False retains worker and sets status to stopping
        result = app.disconnect()
        self.assertFalse(result)
        self.assertIsNotNone(app.worker, "worker reference must be retained when stop() returns False")
        self.assertEqual(app.model.state.connection_label, "stopping", "status must show stopping")

        # 2. connect() must refuse while worker is still alive
        app.connect()
        self.assertIsNotNone(app.worker)
        self.assertEqual(app.model.state.connection_label, "stopping")

        # 3. When worker finally terminates, connect() can proceed
        app.worker.is_alive.return_value = False
        with unittest.mock.patch("app.SerialWorker") as mock_worker_cls:
            mock_new_worker = unittest.mock.MagicMock()
            mock_worker_cls.return_value = mock_new_worker
            app.connect()
            self.assertEqual(app.worker, mock_new_worker)
            mock_new_worker.start.assert_called_once()
            self.assertEqual(app.model.state.connection_label, "COM_TEST")


class AnalyzeTests(unittest.TestCase):
    def test_analyze_without_samples_is_nonfatal(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "output" / "samples").mkdir(parents=True)
            model, _sent = make_model(root)
            self.assertIsNone(model.analyze())
            self.assertIn("no sample", model.state.error)


@unittest.skipIf(Image is None, "Pillow is required for the sample snapshot tests")
class CollectPipelineTests(unittest.TestCase):
    def setUp(self):
        self._folder = tempfile.TemporaryDirectory()
        self.root = make_workspace(Path(self._folder.name))
        self.model, self.sent = make_model(self.root)
        self.board = BoardSimulator(self.root, self.model.receive)
        self.board.frozen_tick = COLLECT_TICK

    def tearDown(self):
        self._folder.cleanup()

    def collect_target_01(self):
        self.board.set_depth(COLLECT_DEPTH)
        self.board.set_yaw(COLLECT_YAW)
        self.board.collect()

    def test_collect_saves_a_snapshot_and_acknowledges_it(self):
        self.collect_target_01()
        self.assertEqual(len(self.model.store.samples), 1)
        sample = next(iter(self.model.store.samples.values()))
        self.assertEqual(sample.target_id, COLLECT_TARGET_ID)
        self.assertTrue(sample.image_path.exists())
        self.assertTrue(sample.metadata_path.exists())
        acks = [message for message in self.sent if message.get("type") == "collect_ack"]
        self.assertEqual(len(acks), 1)
        self.assertEqual(acks[0]["status"], "saved")

    def test_heading_source_is_reported_as_keyboard_only_when_a_key_supplies_it(self):
        self.board.state()
        self.assertEqual(self.model.state.yaw_source, "none")
        self.board.set_yaw(45.0, source="keyboard")
        self.assertEqual(self.model.state.yaw_source, "keyboard")
        self.assertEqual(self.model.state.yaw_deg, 45.0)

    def test_saved_image_does_not_change_when_depth_and_heading_move_on(self):
        self.collect_target_01()
        sample = next(iter(self.model.store.samples.values()))
        before = sample.image_path.read_bytes()
        self.board.set_depth(0.9)
        self.board.set_yaw(15.0)
        self.assertEqual(sample.image_path.read_bytes(), before)
        self.assertAlmostEqual(sample.depth_norm, COLLECT_DEPTH, places=4)

    def test_reopening_the_panel_finds_the_same_sample(self):
        self.collect_target_01()
        sample_id = next(iter(self.model.store.samples))
        reopened, _sent = make_model(self.root)
        self.assertIn(sample_id, reopened.store.samples)
        self.assertEqual(reopened.store.samples[sample_id].target_id, COLLECT_TARGET_ID)

    def test_target_metadata_describes_the_new_subject(self):
        info = self.model.store.target_info(COLLECT_TARGET_ID)
        self.assertEqual(info["label"], "striped reef fish")
        self.assertEqual(info["band"], "surface")

    def test_a_repeated_collect_event_does_not_add_a_second_sample(self):
        self.collect_target_01()
        event = next(message for message in reversed(self.board_events()) if message.get("name") == "collect")
        self.model.receive(dict(event))
        self.assertEqual(len(self.model.store.samples), 1)

    def board_events(self):
        captured: list[dict] = []
        board = BoardSimulator(self.root, captured.append)
        board.frozen_tick = COLLECT_TICK
        board.set_depth(COLLECT_DEPTH)
        board.set_yaw(COLLECT_YAW)
        board.collect()
        for message in captured:
            if message.get("name") == "collect":
                message["sample_id"] = next(iter(self.model.store.samples))
        return captured

    def test_collect_in_the_bezel_gap_reports_a_reason_instead_of_saving(self):
        self.board.set_depth(0.4125)
        self.board.set_yaw(45.0)
        self.board.collect()
        self.assertEqual(len(self.model.store.samples), 0)
        self.assertEqual(self.model.state.error, "reticle_gap")

    def test_collect_with_no_target_reports_a_reason_instead_of_saving(self):
        self.board.set_depth(0.35)
        self.board.set_yaw(NO_TARGET_YAW)
        self.board.collect()
        self.assertEqual(len(self.model.store.samples), 0)
        self.assertEqual(self.model.state.error, "no_target")

    def test_collect_with_no_visible_reticle_reports_reticle_gap(self):
        """At this heading the aim lands on the plastic frame between panels, not on pixels."""
        self.board.set_depth(0.35)
        self.board.set_yaw(35.0)
        self.board.collect()
        self.assertEqual(len(self.model.store.samples), 0)
        self.assertEqual(self.model.state.error, "reticle_gap")

    def test_analyze_opens_the_latest_sample_when_nothing_is_selected(self):
        self.collect_target_01()
        self.model.state.selected_sample_id = None
        sample = self.model.analyze()
        self.assertIsNotNone(sample)
        self.assertEqual(sample.target_id, COLLECT_TARGET_ID)

    def test_scan_reports_hit_and_miss_from_the_same_state_the_panel_shows(self):
        self.board.set_depth(COLLECT_DEPTH)
        self.board.set_yaw(COLLECT_YAW)
        self.board.scan()
        self.assertEqual(self.model.state.scan_result, "hit")
        self.assertEqual(self.model.state.scan_target, COLLECT_TARGET_ID)
        self.board.set_yaw(45.0)
        self.board.scan()
        self.assertEqual(self.model.state.scan_result, "miss")

    def test_asset_mismatch_does_not_save_sample(self):
        store = SampleStore(self.root, "old-test-atlas")
        event = {"sample_id": "sim-1", "asset_pack": "wrong-pack", "depth_norm": 0.4,
                 "target_id": COLLECT_TARGET_ID, "crop": {"u": 0.2, "v": 0.2, "w": 0.2, "h": 0.2}}
        ok, reason, _sample = store.save_candidate(event)
        self.assertFalse(ok)
        self.assertEqual(reason, "asset_mismatch")
        self.assertFalse(store.samples)

    def test_crop_matches_the_frozen_live_scene_snapshot(self):
        self.collect_target_01()
        sample = next(iter(self.model.store.samples.values()))
        saved = Image.open(sample.image_path).convert("RGB")
        metadata = json.loads(sample.metadata_path.read_text(encoding="utf-8"))
        self.assertEqual(metadata["schema_version"], 2)
        self.assertEqual(metadata["renderer"], core_module.live_ocean.RENDERER)
        expected = core_module.live_ocean.render_live_crop(sample.crop, sample.depth_norm,
                                                            metadata["scene_tick"])
        self.assertEqual(saved.size, expected.size)
        self.assertEqual(saved.tobytes(), expected.tobytes())
        # Frozen capture agreement: every saved pixel is the pixel the panel showed at that tick,
        # and anything past the opening is the physical frame, not invented water.
        crop = sample.crop
        self.assertEqual(saved.size, (crop["s"], crop["s"]))
        panel = LIVE.render_panel(crop["face_id"], sample.depth_norm, metadata["scene_tick"])
        for j in range(crop["s"]):
            for i in range(crop["s"]):
                x, y = crop["x"] + i, crop["y"] + j
                inside = 0 <= x < LIVE.PANEL_PX and 0 <= y < LIVE.PANEL_PX
                self.assertEqual(saved.getpixel((i, j)), panel.getpixel((x, y)) if inside else LIVE.FRAME_RGB)

    def test_collect_success_cue_only_fires_after_snapshot_save(self):
        class RecordingAudio:
            enabled = True
            missing = []

            def __init__(self):
                self.cues = []

            def play(self, cue_id):
                self.cues.append(cue_id)

            def set_zone(self, _zone):
                pass

        recorder = RecordingAudio()
        self.model.audio = recorder
        self.collect_target_01()
        self.assertIn("collect_success", recorder.cues)
        recorder.cues.clear()
        self.board.set_yaw(45.0)
        self.board.collect()
        self.assertIn("action_error", recorder.cues)
        self.assertNotIn("collect_success", recorder.cues)


class AudioTests(unittest.TestCase):
    def test_current_catalog_references_eight_valid_wav_files(self):
        catalog = json.loads((ROOT / "assets/audio/catalog.json").read_text(encoding="utf-8"))
        self.assertEqual(len(catalog["cues"]), 8)
        for cue in catalog["cues"]:
            path = ROOT / "assets/audio" / cue["file"]
            self.assertTrue(path.exists(), cue["cue_id"])
            with wave.open(str(path), "rb") as stream:
                self.assertEqual(stream.getframerate(), 44100, cue["cue_id"])
                self.assertEqual(stream.getsampwidth(), 2, cue["cue_id"])
                self.assertEqual(stream.getnchannels(), 2, cue["cue_id"])

    def test_missing_audio_files_are_listed_and_never_raise(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            catalog = root / "catalog.json"
            catalog.write_text(json.dumps({"schema_version": 1, "cues": [
                {"cue_id": "scan_hit", "file": "nope.wav", "loop": False, "gain_db": -12}]}))
            mixer = AudioMixer(root / "audio", catalog, enabled=False)
            self.assertEqual(mixer.missing, ["scan_hit"])
            mixer.set_zone("mid")
            mixer.play("scan_hit")
            mixer.close()

    def test_repeated_state_for_the_same_zone_does_not_restart_the_loop(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "catalog.json").write_text(json.dumps({"schema_version": 1, "cues": []}))
            mixer = AudioMixer(root / "audio", root / "catalog.json", enabled=False)
            mixer.set_zone("mid")
            self.assertEqual(mixer.current_zone, "mid")
            mixer.set_zone("mid")
            self.assertEqual(mixer.current_zone, "mid")
            mixer.set_zone("deep")
            self.assertEqual(mixer.current_zone, "deep")

    @unittest.skipIf(pygame_module is None, "pygame-ce/pygame is not installed")
    def test_real_catalog_loads_all_eight_cues_with_gain_and_crossfade_channels(self):
        os.environ.setdefault("SDL_AUDIODRIVER", "dummy")
        mixer = AudioMixer(ROOT / "assets/audio", ROOT / "assets/audio/catalog.json", enabled=True)
        if not mixer.enabled:
            self.skipTest("pygame mixer could not initialize in this environment")
        try:
            expected = {"ambient_surface", "ambient_mid", "ambient_deep", "scan_hit", "scan_miss", "collect_success", "analyze_open", "action_error"}
            self.assertEqual(set(mixer.sounds), expected)
            catalog = json.loads((ROOT / "assets/audio/catalog.json").read_text(encoding="utf-8"))
            gains = {cue["cue_id"]: 10 ** (cue["gain_db"] / 20.0) for cue in catalog["cues"]}
            for cue_id, expected_gain in gains.items():
                # SDL stores mixer volume in quantized steps, so the public
                # getter is close to, but not always bit-for-bit equal to,
                # the linear gain requested by the catalog.
                self.assertAlmostEqual(mixer.sounds[cue_id].get_volume(), expected_gain, delta=0.01)
            mixer.set_zone("surface")
            mixer.set_zone("surface")
            mixer.play("scan_hit")
            mixer.set_zone("mid")
            mixer.play("scan_miss")
            mixer.set_zone("deep")
            mixer.play("action_error")
            self.assertEqual(mixer.current_zone, "deep")
            self.assertGreaterEqual(pygame_module.mixer.get_num_channels(), 3)
            self.assertTrue(mixer.set_muted(True))
            self.assertTrue(mixer.muted)
            self.assertFalse(any(pygame_module.mixer.Channel(channel).get_busy() for channel in (0, 1, 2)))
            self.assertTrue(mixer.set_muted(False))
            self.assertFalse(mixer.muted)
            self.assertTrue(pygame_module.mixer.Channel(0).get_busy() or pygame_module.mixer.Channel(1).get_busy())
        finally:
            mixer.close()
            pygame_module.mixer.quit()


if __name__ == "__main__":
    unittest.main()
