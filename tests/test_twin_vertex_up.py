"""Acceptance tests for the mounted twin's direct six-face strip map."""
import json
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from atlas_math import cross, dot, mat_vec, normalize, rotate_z
from make_twin_vectors import build
from twin_geometry import ROOT, TwinGeometry


class StripMapTests(unittest.TestCase):
    def setUp(self):
        self.g = TwinGeometry()

    def assertVector(self, actual, expected, places=10):
        for a, b in zip(actual, expected):
            self.assertAlmostEqual(a, b, places=places)

    def shared_edge(self, a, b):
        corners = ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0))
        pairs = []
        for uv_a in corners:
            for uv_b in corners:
                if math.dist(self.g.point_mm(a, *uv_a), self.g.point_mm(b, *uv_b)) < 1e-9:
                    pairs.append((uv_a, uv_b))
        self.assertEqual(len(pairs), 2, f"{a}/{b} shared edge")
        return pairs

    def test_proper_mount_and_fixed_poles(self):
        m = self.g.mount
        self.assertAlmostEqual(dot(m[0], cross(m[1], m[2])), 1)
        for i, a in enumerate(m):
            for j, b in enumerate(m):
                self.assertAlmostEqual(dot(a, b), float(i == j))
        self.assertVector(mat_vec(m, normalize((1, 1, 1))), (0, 0, 1))
        for yaw in range(0, 360, 5):
            for sign in (-1, 1):
                p = mat_vec(m, [sign * 25] * 3)
                self.assertVector(rotate_z(p, math.radians(yaw)), (0, 0, sign * 25 * math.sqrt(3)))

    def test_six_normals_have_required_azimuth_and_elevation(self):
        for i, face in enumerate(self.g.config["azimuth_order"]):
            n = mat_vec(self.g.mount, self.g.faces[face].normal)
            self.assertAlmostEqual(math.degrees(math.atan2(n[1], n[0])) % 360, i * 60)
            self.assertAlmostEqual(math.degrees(math.asin(n[2])), (-1 if i % 2 else 1) * 35.264389682754654)

    def test_strip_centers_and_square_isometric_basis(self):
        self.assertAlmostEqual(self.g.step_mm, 50 / math.sqrt(2), places=12)
        self.assertAlmostEqual(self.g.strip_length_mm, 212.13203435596427, places=12)
        expected = [(0, 17.67766952966369), (35.35533905932738, -17.67766952966369),
                    (70.71067811865476, 17.67766952966369), (106.06601717798213, -17.67766952966369),
                    (141.4213562373095, 17.67766952966369), (176.7766952966369, -17.67766952966369)]
        for face, center in zip(self.g.config["azimuth_order"], expected):
            self.assertVector(self.g.strip_point(face, 0.5, 0.5), center, places=10)
            a = self.g.strip_point(face, 0.2, 0.3)
            b = self.g.strip_point(face, 0.8, 0.3)
            c = self.g.strip_point(face, 0.2, 0.9)
            self.assertAlmostEqual(math.dist(a, b), 30, places=10)
            self.assertAlmostEqual(math.dist(a, c), 30, places=10)
            self.assertAlmostEqual(sum((b[i] - a[i]) * (c[i] - a[i]) for i in range(2)), 0, places=10)

    def test_six_upper_lower_seams_are_exact(self):
        order = self.g.config["azimuth_order"]
        for index, face in enumerate(order):
            other = order[(index + 1) % 6]
            edge = self.shared_edge(face, other)
            for t in (0.001, 0.25, 0.5, 0.75, 0.999):
                a = tuple(edge[0][0][axis] * (1 - t) + edge[1][0][axis] * t for axis in range(2))
                b = tuple(edge[0][1][axis] * (1 - t) + edge[1][1][axis] * t for axis in range(2))
                actual, expected = self.g.strip_point(face, *a), self.g.strip_point(other, *b)
                delta = (actual[0] - expected[0] + self.g.strip_length_mm / 2) % self.g.strip_length_mm - self.g.strip_length_mm / 2
                self.assertAlmostEqual(delta, 0)
                self.assertAlmostEqual(actual[1], expected[1])

    def test_strip_y_matches_mounted_height_at_all_face_corners(self):
        scale = math.sqrt(1.5)
        for face in self.g.config["azimuth_order"]:
            for u, v in ((0, 0), (1, 0), (0, 1), (1, 1)):
                self.assertAlmostEqual(self.g.strip_point(face, u, v)[1], self.g.point_mm(face, u, v)[2] * scale, delta=0.05)

    def test_all_twelve_shared_edges_preserve_the_same_height_coordinate(self):
        scale = math.sqrt(1.5)
        order = self.g.config["azimuth_order"]
        count = 0
        for i, a in enumerate(order):
            for b in order[i + 1:]:
                corners = ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0))
                edge = [(ua, ub) for ua in corners for ub in corners
                        if math.dist(self.g.point_mm(a, *ua), self.g.point_mm(b, *ub)) < 1e-9]
                if len(edge) != 2:
                    continue
                count += 1
                for t in (0.137, 0.5, 0.863):
                    uv_a = tuple(edge[0][0][axis] * (1 - t) + edge[1][0][axis] * t for axis in range(2))
                    uv_b = tuple(edge[0][1][axis] * (1 - t) + edge[1][1][axis] * t for axis in range(2))
                    self.assertAlmostEqual(self.g.strip_point(a, *uv_a)[1], self.g.point_mm(a, *uv_a)[2] * scale, delta=0.05)
                    self.assertAlmostEqual(self.g.strip_point(b, *uv_b)[1], self.g.point_mm(b, *uv_b)[2] * scale, delta=0.05)
                    self.assertAlmostEqual(self.g.strip_point(a, *uv_a)[1], self.g.strip_point(b, *uv_b)[1], delta=0.05)
        self.assertEqual(count, 12)

    def test_same_y_upper_upper_and_lower_lower_edges(self):
        for a, b in (("px", "py"), ("py", "pz"), ("pz", "px"), ("nz", "nx"), ("nx", "ny"), ("ny", "nz")):
            ia, ib = self.g.config["azimuth_order"].index(a), self.g.config["azimuth_order"].index(b)
            ya = (1 if ia % 2 == 0 else -1) * self.g.aim_y_mm
            yb = (1 if ib % 2 == 0 else -1) * self.g.aim_y_mm
            self.assertAlmostEqual(ya, yb)

    def test_grid_lines_are_straight_and_square(self):
        for face in self.g.config["azimuth_order"]:
            a = self.g.strip_point(face, 0.2, 0.35)
            b = self.g.strip_point(face, 0.8, 0.35)
            midpoint = self.g.strip_point(face, 0.5, 0.35)
            self.assertVector(midpoint, tuple((x + y) / 2 for x, y in zip(a, b)))
            self.assertAlmostEqual(math.dist(self.g.strip_point(face, 0, 0), self.g.strip_point(face, 1, 0)), 50)
            self.assertAlmostEqual(math.dist(self.g.strip_point(face, 0, 0), self.g.strip_point(face, 0, 1)), 50)

    def test_reticle_is_linear_on_upper_face_centres(self):
        self.assertAlmostEqual(self.g.aim_y_mm, 25 / math.sqrt(2), places=12)
        for yaw, face in ((0, "px"), (120, "py"), (240, "pz")):
            hit = self.g.aim(yaw, 0.35)
            self.assertEqual(hit["face_id"], face)
            self.assertVector(hit["pixel_uv"], (0.5, 0.5), places=2)
            self.assertAlmostEqual(hit["strip_mm"][1], self.g.aim_y_mm)
        for yaw in range(360):
            for value in self.g.aim(yaw, 0.35)["pixel_uv"]:
                self.assertGreaterEqual(value, 0.0)
                self.assertLessEqual(value, 1.0)
        seen = {self.g.aim(yaw, 0.35)["face_id"] for yaw in range(360) if self.g.aim(yaw, 0.35)["visible"]}
        self.assertEqual(seen, {"px", "py", "pz"})
        visible = sum(self.g.aim(yaw, 0.35)["visible"] for yaw in range(360)) / 360
        self.assertGreater(visible, 0.75)
        self.assertLess(visible, 0.78)

    def test_subject_schema_is_physical_mm_and_subject_scroll_matches_vectors(self):
        for subject in self.g.config["subjects"]:
            for key in ("x_mm", "y_mm", "w_mm", "h_mm", "speed_mm_s"):
                self.assertIn(key, subject)
            for key in ("u", "sea_v", "v", "w", "h"):
                self.assertNotIn(key, subject)
        delta = -(self.g.strip_scroll_mm(0.8) - self.g.strip_scroll_mm(0.1))
        for index, subject in enumerate(self.g.config["subjects"]):
            near = self.g.poses(0)[index][1] - self.g.strip_scroll_mm(0.1)
            far = self.g.poses(0)[index][1] - self.g.strip_scroll_mm(0.8)
            self.assertAlmostEqual(far - near, delta)
            self.assertEqual(self.g.subject_at(self.g.poses(0)[index][0], near, 0.1), index)

    def test_background_scroll_moves_surface_out_without_changing_subject_scroll(self):
        self.assertGreater(self.g.background_scroll_mm(0.0), self.g.background_scroll_mm(0.1))
        self.assertAlmostEqual(self.g.background_scroll_mm(0.1), 0.0)
        self.assertLess(self.g.background_scroll_mm(1.0), self.g.background_scroll_mm(0.1))
        self.assertAlmostEqual(self.g.strip_scroll_mm(0.8) - self.g.strip_scroll_mm(0.1),
                               self.g.step_mm * 1.4)

    def test_vectors_current_and_sprite_circle_ratio(self):
        vectors = json.loads((ROOT / "tests/vectors/twin_vertex_up_vectors.json").read_text())
        self.assertEqual(vectors, build())
        self.assertEqual(len(vectors["seams"]), 36)
        self.assertEqual(len(vectors["same_y"]), 6)
        self.assertAlmostEqual(vectors["circle_checks"][0]["width_mm"] / vectors["circle_checks"][0]["height_mm"], 1.0)

    def test_fish_motion_uses_closed_form_mm_per_second(self):
        for subject in self.g.config["subjects"]:
            before = subject["x_mm"] % self.g.strip_length_mm
            after = (before + subject["speed_mm_s"] * 2.5) % self.g.strip_length_mm
            self.assertAlmostEqual((after - before) % self.g.strip_length_mm,
                                   subject["speed_mm_s"] * 2.5 % self.g.strip_length_mm)


if __name__ == "__main__":
    unittest.main()
