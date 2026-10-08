import json
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from atlas_math import Face, mat_vec, quaternion_matrix  # noqa: E402
from preview_cube import (FACE_NET_GRID, _fit_projection, face_corners, physical_geometry,
                          perspective_coefficients, project, solve_net_turns,
                          validate_net_foldability)


ROOT = Path(__file__).resolve().parents[1]


class PreviewCubeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.faces_cfg = json.loads((ROOT / "config/faces.json").read_text(encoding="utf-8"))
        cls.faces = {
            item["id"]: Face(item["id"], tuple(item["normal"]), tuple(item["right"]), tuple(item["down"]))
            for item in cls.faces_cfg["faces"]
        }

    def test_net_foldability_uses_shared_3d_edge_endpoints(self):
        turns = solve_net_turns(self.faces)
        result = validate_net_foldability(self.faces, turns=turns)
        self.assertTrue(result["foldable"])
        self.assertEqual(len(result["shared_edges"]), 5)
        self.assertTrue(all(edge["shared_edge_matches"] for edge in result["shared_edges"]))
        self.assertEqual(set(FACE_NET_GRID), set(self.faces))

    def test_opening_ratio_and_frame_come_from_configured_dimensions(self):
        edge, opening, frame, rects = physical_geometry(self.faces_cfg)
        self.assertEqual((edge, opening, frame), (50.0, 30.0, 10.0))
        self.assertAlmostEqual(opening / edge, 0.6)
        for rect in rects.values():
            self.assertAlmostEqual(rect["right"] - rect["left"], opening / edge)
            self.assertAlmostEqual(rect["bottom"] - rect["top"], opening / edge)

    def test_perspective_texture_corners_use_full_display_uv(self):
        destination = ((100.0, 120.0), (340.0, 90.0), (370.0, 330.0), (80.0, 350.0))
        source = ((0.0, 0.0), (239.0, 0.0), (239.0, 239.0), (0.0, 239.0))
        coefficients = perspective_coefficients(destination, source)
        for (x, y), (expected_u, expected_v) in zip(destination, source):
            denominator = coefficients[6] * x + coefficients[7] * y + 1.0
            actual_u = (coefficients[0] * x + coefficients[1] * y + coefficients[2]) / denominator
            actual_v = (coefficients[3] * x + coefficients[4] * y + coefficients[5]) / denominator
            self.assertAlmostEqual(actual_u, expected_u, places=5)
            self.assertAlmostEqual(actual_v, expected_v, places=5)

    def test_corner_upright_fixture_culls_after_mount_and_fits_viewport(self):
        mount = quaternion_matrix(self.faces_cfg["mount_orientation"]["test_fixtures"]["cube_body_diagonal_upright_quaternion_wxyz"])
        origin, scale = _fit_projection(mount)
        visible = []
        for face_id, face in self.faces.items():
            world_normal = mat_vec(mount, face.normal)
            if sum(a * b for a, b in zip(world_normal, (1.0, 1.0, 1.0))) > 0.0:
                visible.append(face_id)
                for point in face_corners(face):
                    x, y = project(point, mount, origin, scale)
                    self.assertGreaterEqual(x, 0.0)
                    self.assertLessEqual(x, 900.0)
                    self.assertGreaterEqual(y, 0.0)
                    self.assertLessEqual(y, 720.0)
        self.assertEqual(set(visible), {"nz", "px", "py"})
        self.assertTrue(math.isfinite(scale))


if __name__ == "__main__":
    unittest.main()
