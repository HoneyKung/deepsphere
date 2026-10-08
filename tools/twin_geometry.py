"""LUNA-09 strip-map reference geometry. Units are millimetres and seconds."""
import json
import math
from pathlib import Path

from atlas_math import faces_from_config, face_local_from_point, mat_vec, point_on_cube_face, transpose

ROOT = Path(__file__).resolve().parents[1]


class TwinGeometry:
    def __init__(self):
        self.config = json.loads((ROOT / "config/twin.json").read_text())
        self.face_config = json.loads((ROOT / "config/faces.json").read_text())
        self.scene = json.loads((ROOT / "config/scene.json").read_text())
        self.faces = faces_from_config(self.face_config)
        self.mount = self.config["mount_orientation"]["matrix"]
        self.inverse = transpose(self.mount)
        self.edge = self.face_config["physical_face_dimensions_mm"]["face_edge"]
        strip_config = self.config.get("strip_map", {})
        self.step_mm = strip_config.get("face_step_mm", self.edge / math.sqrt(2.0))
        self.strip_length_mm = strip_config.get("length_mm", self.step_mm * 6.0)
        self.aim_y_mm = strip_config.get("aim_y_mm", self.step_mm / 2.0)
        self.aim_phase_deg = 90.0
        self.rects = {f["id"]: f["physical_face_uv"] for f in self.face_config["faces"]}
        self.strip_frames = {}
        for face in self.faces:
            center_y = self.point_mm(face, 0.5, 0.5)[2] * math.sqrt(1.5)
            best = None
            for rotation in range(4):
                error = 0.0
                for u, v in ((0, 0), (1, 0), (0, 1), (1, 1)):
                    U, V = self._rotate_uv(u, v, rotation)
                    expected = center_y + self.step_mm * (U - V)
                    actual = self.point_mm(face, u, v)[2] * math.sqrt(1.5)
                    error = max(error, abs(actual - expected))
                if best is None or error < best["error"]:
                    best = {"rotation": rotation, "center_y": center_y, "error": error}
            self.strip_frames[face] = best

    @staticmethod
    def _rotate_uv(u, v, rotation):
        return ((u, v), (v, 1 - u), (1 - u, 1 - v), (1 - v, u))[rotation]

    @staticmethod
    def _unrotate_uv(U, V, rotation):
        return ((U, V), (1 - V, U), (1 - U, 1 - V), (V, 1 - U))[rotation]

    def point_mm(self, face, u, v):
        return tuple(x * self.edge for x in mat_vec(self.mount, point_on_cube_face(self.faces[face], u, v)))

    def strip_point(self, face, u, v):
        index = self.config["azimuth_order"].index(face)
        center_x = index * self.step_mm
        frame = self.strip_frames[face]
        U, V = self._rotate_uv(u, v, frame["rotation"])
        return (center_x + self.step_mm * (U - 0.5) + self.step_mm * (V - 0.5),
                frame["center_y"] + self.step_mm * (U - 0.5) - self.step_mm * (V - 0.5))

    def wrap_distance(self, x, center):
        distance = x - center
        while distance > self.strip_length_mm / 2.0:
            distance -= self.strip_length_mm
        while distance < -self.strip_length_mm / 2.0:
            distance += self.strip_length_mm
        return distance

    def strip_local(self, face, x, y):
        index = self.config["azimuth_order"].index(face)
        center_x = index * self.step_mm
        frame = self.strip_frames[face]
        dx, dy = self.wrap_distance(x, center_x), y - frame["center_y"]
        U, V = 0.5 + (dx + dy) / (2.0 * self.step_mm), 0.5 + (dx - dy) / (2.0 * self.step_mm)
        return self._unrotate_uv(U, V, frame["rotation"])

    def face_for_strip(self, x, y):
        wrapped_x = x % self.strip_length_mm
        candidates = []
        def snap(value):
            if abs(value) < 1e-9:
                return 0.0
            if abs(value - 1.0) < 1e-9:
                return 1.0
            return value
        for index, face in enumerate(self.config["azimuth_order"]):
            local = tuple(snap(value) for value in self.strip_local(face, wrapped_x, y))
            outside = max(0.0, 0.2 - local[0], local[0] - 0.8, 0.2 - local[1], local[1] - 0.8)
            face_outside = max(0.0, -local[0], local[0] - 1.0, -local[1], local[1] - 1.0)
            candidates.append((face_outside, outside, index, face, local))
        return min(candidates)

    def pixel(self, face, x, y, depth=0.0):
        rect = self.rects[face]
        width, height = self.face_config["display_size"]
        u = rect["left"] + (x + 0.5) / width * (rect["right"] - rect["left"])
        v = rect["top"] + (y + 0.5) / height * (rect["bottom"] - rect["top"])
        return {"local": [u, v], "point_mm": self.point_mm(face, u, v),
                "strip_mm": self.strip_point(face, u, v), "atlas_uv": self.strip_point(face, u, v)}

    def atlas(self, face, u, v, depth=0.0):
        return self.strip_point(face, u, v)

    def atlas_face(self, x, y, depth=0.0):
        face_outside, _, index, face, local = self.face_for_strip(x, y)
        return {"face": index, "face_id": face, "local": local, "valid": face_outside <= 1e-9}

    def aim(self, yaw, depth=0.0):
        x = (yaw / 360.0 * self.strip_length_mm) % self.strip_length_mm
        _, _, index, face, local = self.face_for_strip(x, self.aim_y_mm)
        rect = self.rects[face]
        raw_pixel_uv = ((local[0] - rect["left"]) / (rect["right"] - rect["left"]),
                        (local[1] - rect["top"]) / (rect["bottom"] - rect["top"]))
        pixel_uv = tuple(max(0.0, min(1.0, value)) for value in raw_pixel_uv)
        panel_margin = 0.125
        return {"face": list(self.faces).index(face), "face_id": face, "point_mm": self.point_mm(face, local[0], local[1]),
                "local": local, "pixel_uv": pixel_uv, "strip_mm": [x, self.aim_y_mm],
                "atlas_uv": [x, self.aim_y_mm], "surface_available": face in self.config["enabled_faces"],
                "visible": face in self.config["enabled_faces"] and all(-panel_margin <= value <= 1.0 + panel_margin for value in raw_pixel_uv)}

    def strip_scroll_mm(self, depth):
        return (max(0.0, min(1.0, depth)) - 0.1) * self.step_mm * 2.0

    def background_scroll_mm(self, depth):
        look = self.config.get("depth_darkening", {}).get("background_scroll", {})
        d = max(0.0, min(1.0, depth))
        surface_fade = look.get("surface_fade_depth_norm", 0.1)
        surface_scroll = look.get("surface_scroll_mm", 55.0)
        deep_travel = look.get("deep_travel_mm", 35.0)
        if d <= surface_fade:
            return surface_scroll * (1.0 - d / surface_fade)
        return -deep_travel * (d - surface_fade) / (1.0 - surface_fade)

    def poses(self, seconds):
        return [[(subject["x_mm"] + subject["speed_mm_s"] * seconds) % self.strip_length_mm, subject["y_mm"]]
                for subject in self.config["subjects"]]

    def subject_at(self, x, y, depth, seconds=0.0):
        scroll = self.strip_scroll_mm(depth)
        shown = self.poses(seconds)
        for index, subject in enumerate(self.config["subjects"]):
            dx = self.wrap_distance(x, shown[index][0])
            dy = y - (shown[index][1] - scroll)
            half_w, half_h = subject["w_mm"] / 2.0, subject["h_mm"] / 2.0
            if abs(dx) > half_w or abs(dy) > half_h:
                continue
            col = math.floor((dx / half_w * 0.5 + 0.5) * 8)
            row = math.floor((dy / half_h * 0.5 + 0.5) * 8)
            if 0 <= col < 8 and 0 <= row < 8 and self.config["sprite_masks"][subject["kind"]][row] & (1 << (7 - col)):
                return index
        return -1
