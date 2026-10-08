from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAIN = (ROOT / "firmware/src/main.cpp").read_text(encoding="utf-8")
HEADER = (ROOT / "firmware/include/deep_sphere_config.h").read_text(encoding="utf-8")


class Luna06DisplayResetTests(unittest.TestCase):
    def test_current_map_and_supply_status_are_explicit(self):
        board = json.loads((ROOT / "config/board.json").read_text(encoding="utf-8"))
        faces = json.loads((ROOT / "config/faces.json").read_text(encoding="utf-8"))
        self.assertEqual(board["pins"]["display_cs"],
                         {"px": 8, "nx": 3, "py": 4, "ny": 5, "pz": 6, "nz": 7})
        self.assertEqual(faces["enabled_outputs"]["faces"], ["px", "nx", "py", "ny", "pz"])
        self.assertTrue("10 A range" in board["power"]["display_supply_note"] or
                        "10 A-range" in board["power"]["display_supply_note"])

    def test_shared_reset_precedes_per_panel_init_and_library_rst_is_disabled(self):
        prepare = MAIN.index("void prepareDisplayChipSelects()")
        reset = MAIN.index("void sharedDisplayReset()")
        setup = MAIN.index("void setupDisplays()")
        init = MAIN.index("gDisplays[i]->init")
        self.assertLess(prepare, reset)
        self.assertLess(reset, setup)
        self.assertLess(setup, init)
        self.assertIn("digitalWrite(kCs[i], HIGH)", MAIN)
        self.assertIn("sharedDisplayReset();", MAIN)
        self.assertIn("new Adafruit_ST7789(kCs[i], kDc, -1)", MAIN)
        self.assertNotIn("new Adafruit_ST7789(kCs[i], kDc, kRst)", MAIN)

    def test_diagnostic_protocol_has_bounded_rejections_and_all_enabled_path(self):
        self.assertIn('action == "display_diagnostic"', MAIN)
        self.assertIn('action == "display_diagnostic_all"', MAIN)
        for status in ("rejected_unknown_face", "rejected_disabled_face", "rejected_uninitialized_face",
                       "rejected_no_enabled_panels"):
            self.assertIn(status, MAIN)
        self.assertIn("drawDisplayDiagnosticAll();", MAIN)
        self.assertIn("drawDisplayDiagnostic(static_cast<uint8_t>(index));", MAIN)

    def test_only_enabled_faces_are_initialized(self):
        setup_start = MAIN.index("void setupDisplays()")
        setup_body = MAIN[setup_start:MAIN.index("void drawDisplayDiagnostic(uint8_t", setup_start)]
        self.assertIn("if (!outputEnabledAt(i)) continue;", setup_body)
        self.assertEqual(len(re.findall(r"new Adafruit_ST7789", setup_body)), 1)


if __name__ == "__main__":
    unittest.main()
