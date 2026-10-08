import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from atlas_math import (aim_projection, background_uv, direction_for_face_pixel, face_uv_from_pixel,
                        faces_from_config, hit_target, pixel_uv_from_face, quaternion_matrix,
                        rgb565_bytes, wrap01)


ROOT = Path(__file__).resolve().parents[1]
FACE_IDS = ("px", "nx", "py", "ny", "pz", "nz")


class AtlasMathTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.faces_cfg = json.loads((ROOT / "config/faces.json").read_text(encoding="utf-8"))
        cls.scene = json.loads((ROOT / "config/scene.json").read_text(encoding="utf-8"))
        cls.faces = faces_from_config(cls.faces_cfg)
        cls.mount = quaternion_matrix(cls.faces_cfg["mount_orientation"]["quaternion_wxyz"])
        cls.active = cls.faces_cfg["active_image"]
        cls.aim = tuple(cls.scene["aim_world"])
        cls.targets = json.loads((ROOT / "assets/source/targets.json").read_text(encoding="utf-8"))["targets"]

    def project(self, yaw, depth=0.35, active=None):
        return aim_projection(yaw, self.aim, self.mount, self.faces, active or self.active, depth, self.scene)

    def test_yaw_wrap_has_same_reticle(self):
        a, b = self.project(0.0), self.project(360.0)
        self.assertEqual(a["face_id"], b["face_id"])
        self.assertEqual(a["local"], b["local"])
        self.assertEqual(a["atlas_uv"], b["atlas_uv"])

    def test_yaw_seam_is_continuous(self):
        a, b = self.project(359.9), self.project(0.1)
        self.assertEqual(a["face_id"], b["face_id"])
        self.assertLess(abs((a["atlas_uv"][0] - b["atlas_uv"][0] + 0.5) % 1.0 - 0.5), 0.002)
        self.assertLess(abs(a["local"][0] - b["local"][0]), 0.01)

    def test_reticle_reads_the_pixel_the_renderer_drew(self):
        for yaw in range(0, 360, 7):
            for depth in (0.0, 0.35, 0.62, 1.0):
                projection = self.project(yaw, depth)
                drawn = background_uv(
                    direction_for_face_pixel(self.faces[projection["face_id"]], *projection["local"], self.mount),
                    depth, self.scene)
                self.assertAlmostEqual((projection["atlas_uv"][0] - drawn[0] + 0.5) % 1.0 - 0.5, 0.0, places=5)
                self.assertAlmostEqual(projection["atlas_uv"][1], drawn[1], places=5)

    def test_background_does_not_move_with_yaw_but_the_reticle_does(self):
        pixels = [(face_id, 0.1 + 0.2 * step, 0.9 - 0.2 * step) for face_id in FACE_IDS for step in range(4)]
        at_rest = [background_uv(direction_for_face_pixel(self.faces[face_id], u, v, self.mount), 0.35, self.scene)
                   for face_id, u, v in pixels]
        for yaw in (0.0, 37.0, 180.0, 359.5):
            self.project(yaw)
            again = [background_uv(direction_for_face_pixel(self.faces[face_id], u, v, self.mount), 0.35, self.scene)
                     for face_id, u, v in pixels]
            self.assertEqual(at_rest, again)
        start = self.project(0.0)["atlas_uv"]
        quarter = self.project(90.0)["atlas_uv"]
        self.assertAlmostEqual(quarter[0], wrap01(start[0] - 0.25), places=5)
        self.assertAlmostEqual(quarter[1], start[1], places=6)

    def test_depth_moves_the_window_not_the_heading(self):
        shallow, deep = self.project(30.0, 0.1), self.project(30.0, 0.9)
        self.assertAlmostEqual(shallow["atlas_uv"][0], deep["atlas_uv"][0], places=6)
        self.assertGreater(deep["atlas_uv"][1], shallow["atlas_uv"][1])
        self.assertEqual(shallow["face_id"], deep["face_id"])

    def test_wrap_and_clamp_rules(self):
        self.assertAlmostEqual(wrap01(-0.01), 0.99)
        self.assertAlmostEqual(background_uv((1, 0, 0), -1, self.scene)[1], 0.1)
        self.assertAlmostEqual(background_uv((0, 0, -1), 2, self.scene)[1], 1.0)

    def test_rgb565_is_big_endian_and_stable(self):
        self.assertEqual(rgb565_bytes((255, 0, 0)), bytes((0xF8, 0x00)))
        self.assertEqual(rgb565_bytes((0, 255, 0)), bytes((0x07, 0xE0)))
        self.assertEqual(rgb565_bytes((0, 0, 255)), bytes((0x00, 0x1F)))

    def test_every_target_is_reachable_including_the_one_on_the_seam(self):
        window = self.scene["depth_window"]
        aimed = {target["target_id"]: (((0.75 + self.scene.get("u_offset", 0.0) - target["u"]) % 1.0) * 360.0,
                                         (target["v"] - window["min_center"]) / (window["max_center"] - window["min_center"]))
                 for target in self.targets}
        for target_id, (yaw, depth) in aimed.items():
            projection = self.project(yaw, depth)
            self.assertTrue(projection["visible"], target_id)
            hit = hit_target(projection, self.targets)
            self.assertIsNotNone(hit, target_id)
            self.assertEqual(hit["target_id"], target_id)

    def test_disabled_geometric_face_hides_reticle_and_hit(self):
        projection = aim_projection(0.0, self.aim, self.mount, self.faces, self.active, 0.35, self.scene,
                                    physical_rects={item["id"]: item["physical_face_uv"] for item in self.faces_cfg["faces"]},
                                    enabled_faces={"px"})
        self.assertEqual(projection["face_id"], "ny")
        self.assertFalse(projection["surface_available"])
        self.assertFalse(projection["visible"])
        self.assertIsNone(hit_target(projection, self.targets))

    def test_seam_target_is_hit_from_both_sides_of_u_zero(self):
        seam = next(target for target in self.targets if target["wraps_horizontal"])
        depth = (seam["v"] - self.scene["depth_window"]["min_center"]) / (self.scene["depth_window"]["max_center"] - self.scene["depth_window"]["min_center"])
        before_seam = self.project(275.0, depth)
        after_seam = self.project(268.0, depth)
        self.assertEqual(hit_target(before_seam, self.targets)["target_id"], seam["target_id"])
        self.assertEqual(hit_target(after_seam, self.targets)["target_id"], seam["target_id"])
        self.assertGreater(before_seam["atlas_uv"][0], 0.95)
        self.assertLess(after_seam["atlas_uv"][0], 0.05)

    def test_wrong_depth_window_misses_the_target_under_the_same_heading(self):
        seam = next(target for target in self.targets if target["wraps_horizontal"])
        yaw = ((0.75 - seam["u"]) % 1.0) * 360.0
        self.assertIsNone(hit_target(self.project(yaw, 0.6), self.targets))

    def test_invisible_reticle_cannot_hit(self):
        projection = {"visible": False, "atlas_uv": (0.315, 0.585)}
        self.assertIsNone(hit_target(projection, self.targets))

    def test_bezel_gap_hides_the_reticle_at_every_cube_edge(self):
        for yaw in (45.0, 135.0, 225.0, 315.0):
            self.assertFalse(self.project(yaw)["visible"], yaw)

    def test_boundary_is_not_inside_active_image(self):
        tight = {"left": 0.6, "top": 0.6, "right": 0.8, "bottom": 0.8}
        self.assertFalse(self.project(90.0, active=tight)["visible"])

    def test_reticle_local_coordinates_stay_on_the_screen(self):
        for yaw in range(0, 720, 3):
            projection = self.project(yaw)
            self.assertGreaterEqual(min(projection["local"]), -1e-6)
            self.assertLessEqual(max(projection["local"]), 1.0 + 1e-6)


class SharedVectorTests(unittest.TestCase):
    """The firmware is checked against this same file by tests/native/run_native_test.py."""

    @classmethod
    def setUpClass(cls):
        path = ROOT / "tests/vectors/cube_math_vectors.json"
        if not path.exists():
            raise unittest.SkipTest("run tools/make_vectors.py first")
        cls.vectors = json.loads(path.read_text(encoding="utf-8"))
        cls.faces_cfg = json.loads((ROOT / "config/faces.json").read_text(encoding="utf-8"))
        cls.scene = json.loads((ROOT / "config/scene.json").read_text(encoding="utf-8"))
        cls.faces = faces_from_config(cls.faces_cfg)
        cls.mount = quaternion_matrix(cls.faces_cfg["mount_orientation"]["quaternion_wxyz"])
        cls.targets = json.loads((ROOT / "assets/source/targets.json").read_text(encoding="utf-8"))["targets"]

    def test_vectors_match_the_current_config(self):
        scene = self.vectors["scene"]
        self.assertEqual(scene["u_offset"], self.scene["u_offset"])
        self.assertEqual(scene["vertical_scale"], self.scene["vertical_scale"])
        self.assertEqual(scene["depth_min_center"], self.scene["depth_window"]["min_center"])
        self.assertEqual(scene["depth_max_center"], self.scene["depth_window"]["max_center"])
        self.assertEqual(self.vectors["active_image"], self.faces_cfg["active_image"])
        self.assertEqual(self.vectors["aim_world"], self.scene["aim_world"])

    def test_background_vectors_reproduce(self):
        for item in self.vectors["background"]:
            direction = direction_for_face_pixel(self.faces[item["face"]], item["local_u"], item["local_v"], self.mount)
            u, v = background_uv(direction, item["depth_norm"], self.scene)
            self.assertAlmostEqual(u, item["u"], places=9)
            self.assertAlmostEqual(v, item["v"], places=9)

    def test_reticle_vectors_reproduce(self):
        active = self.vectors["active_image"]
        aim = tuple(self.vectors["aim_world"])
        for item in self.vectors["reticle"]:
            projection = aim_projection(item["yaw_deg"], aim, self.mount, self.faces, active,
                                        item["depth_norm"], self.scene)
            self.assertEqual(projection["face_id"], item["face"], item)
            self.assertAlmostEqual(projection["local"][0], item["local_u"], places=9)
            self.assertAlmostEqual(projection["local"][1], item["local_v"], places=9)
            self.assertAlmostEqual(projection["atlas_uv"][0], item["u"], places=9)
            self.assertAlmostEqual(projection["atlas_uv"][1], item["v"], places=9)
            self.assertEqual(projection["visible"], item["visible"], item)
            hit = hit_target(projection, self.targets)
            self.assertEqual(hit["target_id"] if hit else None, item["target_id"], item)


class PhysicalFaceMappingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.faces_cfg = json.loads((ROOT / "config/faces.json").read_text(encoding="utf-8"))
        cls.scene = json.loads((ROOT / "config/scene.json").read_text(encoding="utf-8"))
        cls.faces = faces_from_config(cls.faces_cfg)
        cls.mount = quaternion_matrix(cls.faces_cfg["mount_orientation"]["quaternion_wxyz"])
        cls.physical = {item["id"]: item["physical_face_uv"] for item in cls.faces_cfg["faces"]}
        cls.pixel_mask = cls.faces_cfg["display_pixel_mask"]

    def project(self, yaw, depth=0.35):
        return aim_projection(yaw, tuple(self.scene["aim_world"]), self.mount, self.faces,
                              self.pixel_mask, depth, self.scene,
                              physical_rects=self.physical, pixel_mask=self.pixel_mask)

    def test_pixel_to_physical_round_trip_with_offset_and_non_square_rect(self):
        rect = {"left": 0.22, "top": 0.16, "right": 0.78, "bottom": 0.84}
        pixel = (0.13, 0.87)
        face = face_uv_from_pixel(pixel, rect)
        self.assertAlmostEqual(pixel_uv_from_face(face, rect)[0], pixel[0])
        self.assertAlmostEqual(pixel_uv_from_face(face, rect)[1], pixel[1])
        self.assertNotEqual(rect["right"] - rect["left"], rect["bottom"] - rect["top"])

    def test_renderer_uses_physical_rectangle_and_reticle_inverse(self):
        projection = self.project(0.0)
        rect = self.physical[projection["face_id"]]
        expected = pixel_uv_from_face(projection["local"], rect)
        self.assertAlmostEqual(projection["pixel_uv"][0], expected[0])
        self.assertAlmostEqual(projection["pixel_uv"][1], expected[1])
        self.assertGreaterEqual(projection["pixel_uv"][0], 0.0)
        self.assertLessEqual(projection["pixel_uv"][0], 1.0)

    def test_bezel_gap_is_hidden_without_black_border_on_display(self):
        self.assertFalse(self.project(45.0)["visible"])
        center = face_uv_from_pixel((0.5, 0.5), self.physical["px"])
        self.assertEqual(center, (0.5, 0.5))

    def test_non_identity_cube_body_diagonal_fixture_changes_mapping(self):
        diagonal = quaternion_matrix(self.faces_cfg["mount_orientation"]["test_fixtures"]["cube_body_diagonal_upright_quaternion_wxyz"])
        identity = quaternion_matrix((1.0, 0.0, 0.0, 0.0))
        direction_a = direction_for_face_pixel(self.faces["px"], 0.35, 0.65, identity)
        direction_b = direction_for_face_pixel(self.faces["px"], 0.35, 0.65, diagonal)
        self.assertGreater(sum(abs(a - b) for a, b in zip(direction_a, direction_b)), 0.1)
        pose = aim_projection(23.0, tuple(self.scene["aim_world"]), diagonal, self.faces,
                              self.pixel_mask, 0.35, self.scene,
                              physical_rects=self.physical, pixel_mask=self.pixel_mask)
        self.assertIn(pose["face_id"], self.faces)


if __name__ == "__main__":
    unittest.main()
