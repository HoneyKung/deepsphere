import json
from pathlib import Path
import unittest

from tools.as5600_watch import load_csv, parse_telemetry, summarize


ROOT = Path(__file__).resolve().parents[1]


class As5600WatchTests(unittest.TestCase):
    def test_nested_telemetry_is_normalized(self):
        sample = parse_telemetry({
            "type": "telemetry",
            "as5600": {"raw": 4097, "deg": 1.25, "status": {"md": 1, "ml": 0, "mh": 0},
                        "agc": 42, "magnitude": 300, "i2c_errors": 0, "sample_hz": 52.0},
        }, host_monotonic=12.0)
        self.assertIsNotNone(sample)
        self.assertEqual(sample.raw, 1)
        self.assertTrue(sample.md)
        self.assertFalse(sample.ml)
        self.assertTrue(sample.ok)
        self.assertEqual(sample.host_monotonic, 12.0)

    def test_unrelated_message_is_ignored(self):
        self.assertIsNone(parse_telemetry({"type": "heartbeat", "uptime_ms": 100}))

    def test_replay_summary(self):
        samples = load_csv(ROOT / "tests/vectors/as5600_watch_replay.csv")
        result = summarize(samples)
        self.assertEqual(result["samples"], 5)
        self.assertEqual(result["angle_min"], 10.0)
        self.assertEqual(result["angle_max"], 30.0)
        self.assertEqual(result["largest_jump_deg"], 10.0)
        self.assertAlmostEqual(result["stationary_jitter_pp_deg"], 0.1)
        self.assertEqual(result["agc_min"], 20.0)
        self.assertEqual(result["agc_max"], 40.0)
        self.assertEqual(result["magnitude_min"], 400.0)
        self.assertEqual(result["magnitude_max"], 420.0)
        self.assertTrue(result["ml_seen"])
        self.assertFalse(result["mh_seen"])
        self.assertEqual(result["i2c_errors"], 2)


if __name__ == "__main__":
    unittest.main()
