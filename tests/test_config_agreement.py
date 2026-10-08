"""The firmware reads compile-time constants; the tools read config/*.json.

Nothing forces the two to agree at build time, and a silent disagreement means the preview
and the board draw different scenes. This is the thing that notices.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEADER = (ROOT / "firmware/include/deep_sphere_config.h").read_text(encoding="utf-8")


def constant(name: str) -> str:
    match = re.search(rf"constexpr\s+\S+\s+{name}(?:\[\d*\])*\s*=\s*([^;]+);", HEADER)
    if match is None:
        raise AssertionError(f"{name} is missing from deep_sphere_config.h")
    return match.group(1).strip()


def number(name: str) -> float:
    return float(constant(name).rstrip("f"))


def float_list(name: str) -> list[float]:
    inner = constant(name)
    return [float(value.rstrip("f")) for value in re.findall(r"-?\d+\.?\d*f?", inner)]


class ConfigAgreementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scene = json.loads((ROOT / "config/scene.json").read_text(encoding="utf-8"))
        cls.faces = json.loads((ROOT / "config/faces.json").read_text(encoding="utf-8"))
        cls.board = json.loads((ROOT / "config/board.json").read_text(encoding="utf-8"))
        cls.controls = json.loads((ROOT / "config/controls.json").read_text(encoding="utf-8"))

    def test_scene_constants_match(self):
        self.assertEqual(number("kAtlasWidth"), self.scene["atlas"]["width"])
        self.assertEqual(number("kAtlasHeight"), self.scene["atlas"]["height"])
        u_offset, vertical, low, high = float_list("kScene")
        self.assertEqual(u_offset, self.scene["u_offset"])
        self.assertEqual(vertical, self.scene["vertical_scale"])
        self.assertEqual(low, self.scene["depth_window"]["min_center"])
        self.assertEqual(high, self.scene["depth_window"]["max_center"])
        self.assertEqual(float_list("kAimWorld"), self.scene["aim_world"])
        self.assertIn(self.scene["asset_pack_id"], constant("kAssetPackId"))

    def test_active_image_matches(self):
        left, top, right, bottom = float_list("kActiveImage")
        active = self.faces["active_image"]
        self.assertEqual([left, top, right, bottom],
                         [active["left"], active["top"], active["right"], active["bottom"]])

    def test_physical_face_rectangles_match_confirmed_50mm_face_and_30mm_opening(self):
        self.assertEqual(self.faces["physical_face_uv_status"], "dimensions_confirmed_mount_unmeasured")
        self.assertEqual(self.faces["physical_face_dimensions_mm"],
                         {"face_edge": 50.0, "active_opening": 30.0, "frame_each_side": 10.0})
        self.assertEqual(len(self.faces["faces"]), 6)
        for face in self.faces["faces"]:
            rect = face["physical_face_uv"]
            self.assertEqual(rect, {"left": 0.2, "top": 0.2, "right": 0.8, "bottom": 0.8})

    def test_the_wheel_has_no_pins_because_display_cs_took_them(self):
        """GPIO4/5/6 now drive py/ny/pz. The wheel cannot be enabled until three pins come back."""
        pins = self.board["pins"]
        for name in ("encoder_a_gpio", "encoder_b_gpio", "encoder_switch_gpio"):
            self.assertIsNone(pins[name], f"{name} must be null while its pin carries display CS")
        self.assertEqual(self.controls["yaw"]["source"], "none")
        self.assertEqual({pins["display_cs"]["py"], pins["display_cs"]["ny"], pins["display_cs"]["pz"]}, {4, 5, 6})
        self.assertIsNone(self.board["pins"]["button_analyze_gpio"])
        self.assertIsNone(self.board["pins"]["button_analyze_gpio_recommended"])
        self.assertIsNone(self.controls["buttons"]["analyze_recommended_alternative"])
        self.assertEqual(number("kButtonAnalyze"), -1)
        self.assertEqual(number("kButtonAnalyzeRecommended"), -1)
        self.assertEqual(number("kSparePin"), -1)

    def test_display_and_spi_match(self):
        self.assertEqual(number("kDisplayCount"), self.board["spi"]["display_count"])
        self.assertEqual(number("kSpiClockHz"), self.board["spi"]["clock_hz"])
        self.assertEqual(number("kSck"), self.board["spi"]["sck_gpio"])
        self.assertEqual(number("kMosi"), self.board["spi"]["mosi_gpio"])
        self.assertEqual(number("kDc"), self.board["pins"]["dc_gpio"])
        self.assertEqual(number("kRst"), self.board["pins"]["rst_gpio"])
        self.assertEqual(float_list("kCs"), [float(self.board["pins"]["display_cs"][face["id"]])
                                             for face in self.faces["faces"]])
        self.assertEqual(self.board["pins"]["display_cs"],
                         {face["id"]: face["cs_gpio"] for face in self.faces["faces"]})

    def test_face_bases_match_config_and_are_consistent(self):
        """kFaceBasis drifted away from config/faces.json unnoticed once already.

        Nothing compared the two, so a corrected faces.json left the firmware and the native
        test compiling happily against the old axes. This checks the numbers themselves, and
        then checks the two properties the cube relies on: every side panel's screen-down is
        world -Z, the axis the heading turns about, and (right, down, -normal) is right-handed
        on every face so no panel reads mirrored when viewed from outside the cube.
        """
        table = HEADER[HEADER.index("kFaceBasis[6]"):]
        table = table[table.index("{"):table.index("};") + 1]
        rows = re.findall(r'\{"(\w+)", \{([-\d, ]+)\}, \{([-\d, ]+)\}, \{([-\d, ]+)\}\}', table)
        self.assertEqual(len(rows), 6, "kFaceBasis must list all six faces")

        def triple(text):
            return [int(part) for part in text.split(",")]

        def cross(a, b):
            return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

        for row, face in zip(rows, self.faces["faces"]):
            name, normal, right, down = row[0], triple(row[1]), triple(row[2]), triple(row[3])
            self.assertEqual(name, face["id"])
            self.assertEqual(normal, face["normal"], f"{name} normal differs from faces.json")
            self.assertEqual(right, face["right"], f"{name} right differs from faces.json")
            self.assertEqual(down, face["down"], f"{name} down differs from faces.json")
            self.assertEqual(cross(right, down), [-c for c in normal],
                             f"{name} reads mirrored from outside the cube")
            if normal[2] == 0:
                self.assertEqual(down, [0, 0, -1],
                                 f"{name} is a side panel, so its screen-down must be world -Z")

    def test_control_pins_and_steps_match(self):
        pins = self.board["pins"]
        for constant_name, key in (("kEncoderA", "encoder_a_gpio"), ("kEncoderB", "encoder_b_gpio"),
                                   ("kEncoderSwitch", "encoder_switch_gpio")):
            wanted = pins[key]
            if wanted is None:
                self.assertEqual(number(constant_name), -1.0, f"{constant_name} must be -1 when unassigned")
            else:
                self.assertEqual(number(constant_name), wanted)
        self.assertEqual(number("kButtonScan"), pins["button_scan_gpio"])
        self.assertEqual(number("kButtonCollect"), pins["button_collect_gpio"])
        if pins["button_analyze_gpio"] is None:
            self.assertEqual(number("kButtonAnalyze"), -1.0)
        else:
            self.assertEqual(number("kButtonAnalyze"), pins["button_analyze_gpio"])
        wheel = self.controls["wheel"]
        self.assertEqual(number("kEncoderStepsPerDetent"), wheel["encoder_steps_per_detent"])
        self.assertEqual(number("kDepthStepPerDetent"), wheel["depth_step_norm"])
        self.assertEqual(number("kYawDegreesPerDetent"), self.controls["yaw"]["degrees_per_detent"])
        self.assertEqual(number("kYawZeroOffsetDeg"), self.controls["yaw"]["zero_offset_deg"])

    def test_yaw_source_matches(self):
        wanted = {"none": "YawSource::kNone",
                  "encoder": "YawSource::kEncoder"}[self.controls["yaw"]["source"]]
        self.assertEqual(constant("kYawSource"), wanted)
        self.assertEqual(self.controls["yaw"]["source"], self.board["yaw_source"])
        self.assertEqual(sorted(self.controls["yaw"]["source_options"]), ["encoder", "none"])

    def test_display_mask_matches_the_five_panels_that_exist(self):
        """One display failed, so the downward face nz has no panel and must not be an output."""
        self.assertEqual(self.faces["enabled_outputs"]["mode"], "five_panel_no_bottom")
        self.assertEqual(self.faces["enabled_outputs"]["faces"], ["px", "nx", "py", "ny", "pz"])
        self.assertIn("kDisplayEnabled[6] = {true, true, true, true, true, false}", HEADER)
        self.assertEqual(constant("kSingleDisplayTest"), "false")
        order = [face["id"] for face in self.faces["faces"]]
        self.assertEqual(order[5], "nz", "the disabled mask entry is index 5, so nz must stay last")

    def test_display_confirmation_flag_agrees_with_the_board_config(self):
        """The firmware constant and board.json must never disagree about checked wiring."""
        header_says = constant("kHardwarePinsConfirmed") == "true"
        self.assertEqual(header_says, bool(self.board["power"]["user_wiring_confirmed"]))
        self.assertEqual(header_says, bool(self.board["spi"]["hardware_confirmed"]))

    def test_confirmed_display_wiring_does_not_imply_confirmed_controls(self):
        """Panels being wired says nothing about buttons or the wheel, which stay off."""
        self.assertEqual(constant("kPhysicalControlsEnabled"), "false")
        self.assertFalse(self.controls["hardware_confirmed"])
        self.assertFalse(self.board["input_source_hardware_confirmed"])

    def test_no_code_reaches_for_a_rotation_sensor_that_is_not_fitted(self):
        """No AS5600 and no magnet ever arrived. Prose may explain that; code may not act on it."""
        self.assertEqual(self.controls["yaw"]["rotation_sensing"], "absent")
        firmware = (ROOT / "firmware/src/main.cpp").read_text(encoding="utf-8")
        for source, text in (("deep_sphere_config.h", HEADER), ("main.cpp", firmware)):
            code = re.sub(r"//.*", "", text)
            for identifier in ("kAs5600", "kI2c", "Wire.", "Wire.h", "kAs5600Address"):
                self.assertNotIn(identifier, code, f"{identifier} still referenced in {source}")
        for name in ("i2c_sda_gpio", "i2c_scl_gpio", "as5600_address"):
            self.assertNotIn(name, self.board["pins"])
        self.assertNotIn("as5600", json.dumps(self.controls["yaw"]).lower().replace(
            self.controls["yaw"]["source_note"].lower(), ""))

    def test_no_control_pin_is_used_twice(self):
        used = [pin for pin in float_list("kCs") + [number(name) for name in
                                                    ("kSck", "kMosi", "kDc", "kRst", "kEncoderA", "kEncoderB",
                                                     "kButtonScan", "kButtonCollect", "kButtonAnalyze",
                                                     "kEncoderSwitch")]
                if pin >= 0]
        self.assertEqual(len(used), len(set(used)), f"a GPIO is assigned twice: {sorted(used)}")

    def test_reserved_pins_are_not_assigned(self):
        reserved = {float(value) for key, value in self.board["reserved"].items()
                    if isinstance(value, (int, float))}
        used = {pin for pin in set(float_list("kCs")) | {number(name) for name in
                                                         ("kSck", "kMosi", "kDc", "kRst", "kEncoderA", "kEncoderB",
                                                          "kButtonScan", "kButtonCollect", "kButtonAnalyze",
                                                          "kEncoderSwitch")}
                if pin >= 0}
        self.assertEqual(used & reserved, set())

    def test_zone_thresholds_match_the_audio_protocol(self):
        low, high = float_list("kZoneBounds")
        protocol = (ROOT / "docs/audio-protocol.md").read_text(encoding="utf-8")
        self.assertIn(f"surface < {low}", protocol)
        self.assertIn(f"mid < {high}", protocol)
        self.assertGreater(number("kZoneHysteresis"), 0.0)

    def test_stripe_buffer_stays_within_the_documented_ceiling(self):
        stripe_bytes = number("kDisplayWidth") * number("kStripeRows") * 2
        atlas_bytes = number("kAtlasWidth") * number("kAtlasHeight") * 2
        self.assertEqual(stripe_bytes, 7680)
        self.assertEqual(atlas_bytes, 1048576)
        self.assertLess(atlas_bytes + stripe_bytes, self.board["psram_bytes"])


if __name__ == "__main__":
    unittest.main()
