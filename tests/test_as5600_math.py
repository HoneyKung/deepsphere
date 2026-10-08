import json
from pathlib import Path
import unittest

from tools import as5600_math


ROOT = Path(__file__).resolve().parents[1]
VECTORS = json.loads((ROOT / "tests/vectors/as5600_math_vectors.json").read_text(encoding="utf-8"))


class As5600MathTests(unittest.TestCase):
    def test_raw_to_degrees_vectors(self):
        for vector in VECTORS["raw_to_degrees"]:
            with self.subTest(vector=vector):
                self.assertAlmostEqual(as5600_math.raw_to_degrees(vector["raw"]), vector["degrees"], places=9)

    def test_deadband_vectors(self):
        for vector in VECTORS["deadband"]:
            with self.subTest(vector=vector):
                actual = as5600_math.apply_deadband(vector["previous"], vector["current"], vector["deadband"])
                self.assertAlmostEqual(actual, vector["expected"], places=6)

    def test_calibration_vectors(self):
        for vector in VECTORS["calibration"]:
            with self.subTest(vector=vector):
                direction = vector["direction"]
                self.assertAlmostEqual(as5600_math.calibration_span_raw(vector["raw_min"], vector["raw_max"], direction),
                                       vector["span_raw"], places=6)
                self.assertAlmostEqual(as5600_math.wrap_offset_raw(vector["raw_min"], vector["raw_max"], direction),
                                       vector["offset_raw"], places=6)
                self.assertAlmostEqual(as5600_math.wrap_offset_degrees(vector["raw_min"], vector["raw_max"], direction),
                                       vector["offset_deg"], places=6)

    def test_mapping_and_zero_vectors(self):
        for vector in VECTORS["wrap_mapping"]:
            with self.subTest(vector=vector):
                self.assertAlmostEqual(as5600_math.apply_wrap_offset(vector["raw"], vector["offset_deg"]),
                                       vector["expected"], places=6)
        for vector in VECTORS["zero"]:
            with self.subTest(vector=vector):
                self.assertAlmostEqual(as5600_math.apply_zero(vector["angle"], vector["zero"]),
                                       vector["expected"], places=6)

    def test_calibration_unwraps_raw_crossing(self):
        for vector in VECTORS["calibration_sequences"]:
            with self.subTest(vector=vector):
                result = as5600_math.calibrate_raw_samples(vector["samples"])
                self.assertTrue(result.valid)
                self.assertEqual(result.raw_min, vector["raw_min"])
                self.assertEqual(result.raw_max, vector["raw_max"])
                self.assertEqual(result.direction, vector["direction"])
                self.assertAlmostEqual(result.span_raw, vector["span_raw"], places=6)
                self.assertAlmostEqual(as5600_math.calibration_span_raw(result.raw_min, result.raw_max, result.direction),
                                       vector["span_raw"], places=6)

    def test_invalid_direction_is_rejected(self):
        with self.assertRaises(ValueError):
            as5600_math.wrap_offset_raw(1, 2, direction=0)


if __name__ == "__main__":
    unittest.main()
