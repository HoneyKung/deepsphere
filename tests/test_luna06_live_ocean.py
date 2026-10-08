"""LUNA-06B behaviour checks for the live ocean.

Motion on the real cube, one sprite rule for drawing and hitting, dirty rectangles that leave no
trails, a background that holds still at a fixed depth, a capture that matches the panel, and
animals that actually pass under the board's fixed reticle. The C++ side of the same rules is
checked against Python vectors by tests/native/test_live_ocean.cpp.
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "laptop"))

import core  # noqa: E402

LIVE = core.live_ocean
BOARD_YAW = 0.0  # the board has no heading input, so its reticle rests here


def simulator(messages=None):
    return core.BoardSimulator(ROOT, (messages.append if messages is not None else lambda message: None))


def forward(heading: int, x: float, y: float) -> tuple[float, float]:
    """Sprite-frame point to face offset: the quarter turn the renderer inverts."""
    return ((x, y), (-y, x), (-x, -y), (y, -x))[heading]


def parked(index: int, **pose) -> tuple[dict, ...]:
    """The scene with one subject placed by hand and every other one parked on the absent face."""
    targets = [{**subject, "face_id": "nz", "u": 0.5, "v": 0.5} for subject in LIVE.SUBJECTS]
    targets[index] = {**LIVE.SUBJECTS[index], **pose}
    return tuple(targets)


class Luna06LiveOceanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = json.loads((ROOT / "config/live_ocean.json").read_text(encoding="utf-8"))
        cls.board_projection = simulator().projection_at(BOARD_YAW)
        cls.board_hits = LIVE.hittable_ticks(cls.board_projection, range(0, 1600))

    def test_live_scene_is_versioned_seeded_and_bounded(self):
        self.assertEqual(LIVE.SCHEMA_VERSION, self.config["schema_version"])
        self.assertEqual(LIVE.SEED, self.config["seed"])
        self.assertEqual(LIVE.TICK_MS, self.config["tick_ms"])
        self.assertEqual(len(LIVE.SUBJECTS), 6)

    def test_firmware_header_is_generated_from_the_current_config(self):
        result = subprocess.run([sys.executable, str(ROOT / "tools/make_live_ocean_header.py"), "--check"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_subject_positions_are_deterministic_but_move_between_ticks(self):
        first, repeat, later = LIVE.targets_at_tick(0), LIVE.targets_at_tick(0), LIVE.targets_at_tick(10)
        self.assertEqual(first, repeat)
        for before, after in zip(first, later):
            self.assertNotEqual(LIVE.surface_point(before), LIVE.surface_point(after))

    def test_rotated_half_extents_stay_behind_the_ten_millimetre_frame(self):
        for index, subject in enumerate(LIVE.SUBJECTS):
            for du, dv in ((0.02, 0.0), (0.0, 0.02), (-0.02, 0.0), (0.0, -0.02)):
                width, height = LIVE.rotated_extent({**subject, "du": du, "dv": dv})
                self.assertLess(width / 2.0, 0.2)
                self.assertLess(height / 2.0, 0.2)
            # Centred on a hinge, an animal has no pixel on either panel: the frames hide it.
            on_hinge = parked(index, face_id="py", u=1.0, v=0.5, du=0.02, dv=0.0)[index]
            self.assertIsNone(LIVE.subject_screen_rect(on_hinge, margin=0))

    def test_motion_crosses_real_hinges_and_turns_the_heading_about_them(self):
        crossings, enabled_pairs = 0, set()
        previous = LIVE.targets_at_tick(0)
        for tick in range(1, 400):
            current = LIVE.targets_at_tick(tick)
            for old, new in zip(previous, current):
                if old["face_id"] == new["face_id"]:
                    continue
                crossings += 1
                if old["face_id"] in LIVE.ENABLED_FACES and new["face_id"] in LIVE.ENABLED_FACES:
                    enabled_pairs.add((old["face_id"], new["face_id"]))
                # After the quarter turn the animal heads straight away from the face it left.
                speed = math.hypot(old["du"], old["dv"])
                normal = LIVE.FACES[old["face_id"]].normal
                tangent = LIVE.surface_tangent(new)
                for axis in range(3):
                    self.assertAlmostEqual(tangent[axis], -normal[axis] * speed, places=9)
            previous = current
        self.assertGreater(crossings, 10)
        self.assertGreaterEqual(len(enabled_pairs), 4, "animals must cross between screens that exist")

    def test_one_rule_decides_pixel_and_hit_including_transparent_cells(self):
        subject = LIVE.SUBJECTS[0]
        mask = LIVE.SPRITE_MASKS[subject["kind"]]
        fish_rgb = LIVE.quantize_rgb565(subject["rgb"])
        for heading, (du, dv) in enumerate(((0.021, 0.0), (0.0, 0.021), (-0.021, 0.0), (0.0, -0.021))):
            targets = parked(0, face_id="py", u=0.5, v=0.5, du=du, dv=dv)
            for row in range(8):
                for col in range(8):
                    dx, dy = forward(heading, ((col + 0.5) / 8 - 0.5) * subject["w"], ((row + 0.5) / 8 - 0.5) * subject["h"])
                    opaque = bool(mask[row] & (1 << (7 - col)))
                    self.assertEqual(LIVE.subject_at(targets, "py", 0.5 + dx, 0.5 + dy) == 0, opaque)
                    self.assertEqual(LIVE.pixel_rgb(targets, "py", 0.5 + dx, 0.5 + dy, 0.35) == fish_rgb, opaque)
        # The eye is a real hole: a scan through it misses the fish.
        self.assertFalse(mask[3] & (1 << (7 - 5)))

    def test_lower_index_is_on_top_for_both_drawing_and_hitting(self):
        targets = list(parked(0, face_id="py", u=0.5, v=0.5, du=0.021, dv=0.0))
        targets[2] = {**LIVE.SUBJECTS[2], "face_id": "py", "u": 0.5, "v": 0.5, "du": 0.0, "dv": -0.017}
        self.assertTrue(LIVE.sprite_opaque(targets[0], 0.5, 0.5) and LIVE.sprite_opaque(targets[2], 0.5, 0.5))
        self.assertEqual(LIVE.subject_at(targets, "py", 0.5, 0.5), 0)
        self.assertEqual(LIVE.pixel_rgb(targets, "py", 0.5, 0.5, 0.35), LIVE.quantize_rgb565(targets[0]["rgb"]))

    def _transition_ticks(self):
        """A plain move, a move while two animals overlap, and a plain move a little later.

        A hinge crossing is not on the list on purpose: the frames hide every animal at a hinge,
        so a crossing repaints nothing visible.
        """
        plain = overlap = None
        for tick in range(0, 600):
            rects = [LIVE.subject_screen_rect(target) for target in LIVE.targets_at_tick(tick + 1)]
            if plain is None and any(rects):
                plain = tick
            if overlap is None and any(
                    ra and rb and ra[0] == rb[0] and ra[1] < rb[3] and rb[1] < ra[3] and ra[2] < rb[4] and rb[2] < ra[4]
                    for a, ra in enumerate(rects) for rb in rects[a + 1:]):
                overlap = tick
            if plain is not None and overlap is not None:
                break
        self.assertIsNotNone(overlap, "the scene should bring two animals over each other on a panel")
        return sorted({plain, overlap, plain + 13})

    def test_dirty_rectangles_leave_no_trails_and_restore_overlaps(self):
        ticks = self._transition_ticks()
        self.assertGreaterEqual(len(ticks), 2)
        for tick in ticks:
            before, after = LIVE.targets_at_tick(tick), LIVE.targets_at_tick(tick + 1)
            rects = LIVE.dirty_rects(before, after)
            for face_id in sorted({rect[0] for rect in rects}):
                shown = LIVE.render_panel(face_id, 0.35, tick, before)
                expected = LIVE.render_panel(face_id, 0.35, tick + 1, after)
                for _face, x0, y0, x1, y1 in (rect for rect in rects if rect[0] == face_id):
                    shown.paste(expected.crop((x0, y0, x1, y1)), (x0, y0))
                self.assertEqual(shown.tobytes(), expected.tobytes(), f"trail left on {face_id} at tick {tick}")

    def test_reticle_erase_restores_the_animal_under_it(self):
        tick = min(ticks[0] for ticks in self.board_hits.values() if ticks)
        face_id = self.board_projection["face_id"]
        clean = LIVE.render_panel(face_id, 0.35, tick)
        rx, ry = LIVE.reticle_pixel(self.board_projection)
        targets = LIVE.targets_at_tick(tick)
        low, high = -(LIVE.RETICLE_ARM_PX + LIVE.RETICLE_MARGIN_PX), LIVE.RETICLE_ARM_PX + LIVE.RETICLE_MARGIN_PX
        crossed = clean.copy()
        for step in range(-LIVE.RETICLE_ARM_PX, LIVE.RETICLE_ARM_PX + 1):
            crossed.putpixel((rx + step, ry), (255, 0, 0))
            crossed.putpixel((rx, ry + step), (255, 0, 0))
        composite, water_only = crossed.copy(), crossed.copy()
        for y in range(ry + low, ry + high + 1):
            for x in range(rx + low, rx + high + 1):
                u, v = LIVE.pixel_center(face_id, x, y)
                composite.putpixel((x, y), LIVE.pixel_rgb(targets, face_id, u, v, 0.35))
                water_only.putpixel((x, y), LIVE.quantize_rgb565(LIVE.background_rgb(u, v, 0.35)))
        self.assertEqual(composite.tobytes(), clean.tobytes())
        # The old bug restored water only and punched a hole in the fish; this check would catch it.
        self.assertNotEqual(water_only.tobytes(), clean.tobytes())

    def test_background_holds_still_at_a_fixed_depth_and_follows_depth(self):
        first, later = 5, 45
        a, b = LIVE.render_panel("ny", 0.35, first), LIVE.render_panel("ny", 0.35, later)
        busy = [LIVE.subject_screen_rect(target) for tick in (first, later) for target in LIVE.targets_at_tick(tick)]
        busy = [rect for rect in busy if rect and rect[0] == "ny"]
        for y in range(0, LIVE.PANEL_PX, 3):
            for x in range(0, LIVE.PANEL_PX, 3):
                if any(x0 <= x < x1 and y0 <= y < y1 for _face, x0, y0, x1, y1 in busy):
                    continue
                self.assertEqual(a.getpixel((x, y)), b.getpixel((x, y)))
        changed = sum(LIVE.background_rgb(u / 20, v / 20, 0.30) != LIVE.background_rgb(u / 20, v / 20, 0.34)
                      for u in range(20) for v in range(20))
        self.assertGreater(changed, 300, "one Up/Down step should visibly change the water")

    def test_every_animal_swims_under_the_board_reticle(self):
        for index, ticks in self.board_hits.items():
            self.assertTrue(ticks, f"{LIVE.SUBJECTS[index]['target_id']} never passes the board reticle")
        all_ticks = sorted(tick for ticks in self.board_hits.values() for tick in ticks)
        self.assertLessEqual(all_ticks[0] * LIVE.TICK_MS, 10_000, "the first animal arrives within 10 s of boot")
        longest_wait = max(b - a for a, b in zip(all_ticks, all_ticks[1:])) * LIVE.TICK_MS
        self.assertLessEqual(longest_wait, 40_000, "never more than 40 s without an animal under the reticle")

    def test_simulated_collect_freezes_the_shown_tick_in_a_square_panel_crop(self):
        tick = self.board_hits[0][0]
        messages = []
        board = simulator(messages)
        board.frozen_tick = tick
        board.set_yaw(BOARD_YAW)
        board.collect()
        event = next(message for message in messages if message.get("name") == "collect")
        self.assertEqual(event["result"], "candidate")
        self.assertEqual(event["target_id"], LIVE.SUBJECTS[0]["target_id"])
        self.assertEqual(event["snapshot"]["renderer"], LIVE.RENDERER)
        self.assertEqual(event["snapshot"]["scene_version"], LIVE.SCHEMA_VERSION)
        self.assertEqual(event["snapshot"]["scene_tick"], tick)
        crop = event["crop"]
        self.assertEqual(set(crop), {"face_id", "x", "y", "s"})
        target = LIVE.targets_at_tick(tick)[0]
        width, height = LIVE.rotated_extent(target)
        self.assertGreaterEqual(crop["s"], math.ceil(max(width, height) * 400))

    def test_collect_event_fits_the_protocol_line_budget(self):
        """Worst case of the line firmware collect() formats; the board also refuses longer ones."""
        session = "s3-ffffffff-4294967295-ffffffff"
        longest_id = max((subject["target_id"] for subject in LIVE.SUBJECTS), key=len)
        line = ('{"v":1,"type":"event","session":"%s","seq":4294967295,"t_ms":4294967295,"name":"collect",'
                '"result":"candidate","sample_id":"%s-4294967295","target_id":"%s","asset_pack":"%s",'
                '"depth_norm":1.0000,"crop":{"face_id":"px","x":-32768,"y":-32768,"s":-32768},'
                '"snapshot":{"renderer":"%s","scene_version":255,"scene_tick":4294967295,'
                '"depth_norm":1.0000,"yaw_deg":359.99}}') % (
            session, session, longest_id, "luna-04-ocean-atlas", LIVE.RENDERER)
        self.assertLessEqual(len(line.encode("utf-8")), 511)

    def test_simulator_diagnostic_rejects_disabled_face_without_accepting_it(self):
        messages = []
        board = simulator(messages)
        board.receive_from_host({"type": "command", "action": "display_diagnostic",
                                 "face": "nz", "request_id": "diag-nz"})
        acks = [message for message in messages if message.get("type") == "ack"]
        self.assertEqual(len(acks), 1)
        self.assertEqual(acks[0]["status"], "rejected_disabled_face")


if __name__ == "__main__":
    unittest.main()
