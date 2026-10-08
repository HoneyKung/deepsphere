import json
from pathlib import Path
import sys
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from atlas_math import rgb565_bytes  # noqa: E402


class Luna04AssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scene = json.loads((ROOT / "config/scene.json").read_text(encoding="utf-8"))
        cls.manifest = json.loads((ROOT / "assets/generated/pack.json").read_text(encoding="utf-8"))
        cls.targets = json.loads((ROOT / "assets/generated/targets.json").read_text(encoding="utf-8"))["targets"]

    def test_new_pack_uses_real_source_and_six_subjects(self):
        self.assertEqual(self.scene["asset_pack_id"], "luna-04-ocean-atlas")
        self.assertEqual(self.manifest["asset_pack"], self.scene["asset_pack_id"])
        self.assertEqual(self.manifest["source_art"], "assets/source/sea_atlas_luna04_master.png")
        self.assertEqual(self.manifest["source_composition"], "assets/source/sea_atlas_luna04_composition.json")
        self.assertEqual(self.manifest["subject_count"], 6)
        self.assertEqual(len(self.targets), 6)
        self.assertEqual({target["band"] for target in self.targets}, {"surface", "middle", "deep"})
        self.assertEqual(sum(target["band"] == "surface" for target in self.targets), 2)
        self.assertEqual(sum(target["band"] == "middle" for target in self.targets), 2)
        self.assertEqual(sum(target["band"] == "deep" for target in self.targets), 2)
        self.assertTrue(any(target["wraps_horizontal"] for target in self.targets))

    def test_png_and_rgb565_binary_are_the_same_quantized_pixels(self):
        image = Image.open(ROOT / "assets/generated/sea_atlas.png").convert("RGB")
        packed = (ROOT / "assets/generated/sea_atlas_rgb565_be.bin").read_bytes()
        self.assertEqual(image.size, (1024, 512))
        self.assertEqual(len(packed), 1024 * 512 * 2)
        expected = bytearray()
        for pixel in image.getdata():
            expected.extend(rgb565_bytes(pixel))
        self.assertEqual(bytes(expected), packed)

    def test_target_bounds_are_real_composed_crops(self):
        image = Image.open(ROOT / "assets/generated/sea_atlas.png").convert("RGB")
        for target in self.targets:
            bounds = target["source_bounds_px"]
            self.assertGreater(bounds["right"], bounds["left"])
            self.assertGreater(bounds["bottom"], bounds["top"])
            center_x = round(target["u"] * image.width) % image.width
            center_y = max(0, min(image.height - 1, round(target["v"] * image.height)))
            self.assertNotEqual(image.getpixel((center_x, center_y)), (0, 0, 0), target["target_id"])


if __name__ == "__main__":
    unittest.main()
