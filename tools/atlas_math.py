"""Shared, dependency-free atlas and cube math used by preview and firmware tests."""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Iterable, Mapping, Sequence, Tuple

Vec3 = Tuple[float, float, float]
Mat3 = Tuple[Vec3, Vec3, Vec3]


@dataclass(frozen=True)
class Face:
    face_id: str
    normal: Vec3
    right: Vec3
    down: Vec3


FACE_ORDER = ("px", "nx", "py", "ny", "pz", "nz")


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def clamp01(value: float) -> float:
    return clamp(value, 0.0, 1.0)


def wrap01(value: float) -> float:
    return value % 1.0


def add(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def scale(a: Vec3, amount: float) -> Vec3:
    return (a[0] * amount, a[1] * amount, a[2] * amount)


def dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Vec3, b: Vec3) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def length(a: Vec3) -> float:
    return math.sqrt(dot(a, a))


def normalize(a: Vec3) -> Vec3:
    size = length(a)
    if size == 0.0:
        raise ValueError("cannot normalize zero vector")
    return scale(a, 1.0 / size)


def mat_vec(matrix: Mat3, value: Vec3) -> Vec3:
    return tuple(dot(row, value) for row in matrix)  # type: ignore[return-value]


def transpose(matrix: Mat3) -> Mat3:
    return tuple(tuple(matrix[row][col] for row in range(3)) for col in range(3))  # type: ignore[return-value]


def quaternion_matrix(wxyz: Sequence[float]) -> Mat3:
    w, x, y, z = wxyz
    return (
        (1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
        (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
        (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)),
    )


def rotate_z(vector: Vec3, radians: float) -> Vec3:
    c, s = math.cos(radians), math.sin(radians)
    return (c * vector[0] - s * vector[1], s * vector[0] + c * vector[1], vector[2])


def faces_from_config(config: Mapping) -> dict[str, Face]:
    return {
        item["id"]: Face(item["id"], tuple(item["normal"]), tuple(item["right"]), tuple(item["down"]))
        for item in config["faces"]
    }


def point_on_cube_face(face: Face, local_u: float, local_v: float) -> Vec3:
    return add(scale(face.normal, 0.5), add(scale(face.right, local_u - 0.5), scale(face.down, local_v - 0.5)))


def face_local_from_point(face: Face, point: Vec3) -> tuple[float, float]:
    return (dot(point, face.right) + 0.5, dot(point, face.down) + 0.5)


def inside_active_image(face_local: tuple[float, float], active: Mapping[str, float]) -> bool:
    """The glass covers only part of the cube face; outside it there is no pixel to draw on."""
    return (active["left"] <= face_local[0] <= active["right"]
            and active["top"] <= face_local[1] <= active["bottom"])


def face_uv_from_pixel(pixel_uv: tuple[float, float], physical: Mapping[str, float]) -> tuple[float, float]:
    return (physical["left"] + pixel_uv[0] * (physical["right"] - physical["left"]),
            physical["top"] + pixel_uv[1] * (physical["bottom"] - physical["top"]))


def pixel_uv_from_face(face_uv: tuple[float, float], physical: Mapping[str, float]) -> tuple[float, float]:
    width = physical["right"] - physical["left"]
    height = physical["bottom"] - physical["top"]
    return ((face_uv[0] - physical["left"]) / width if width else -1.0,
            (face_uv[1] - physical["top"]) / height if height else -1.0)


def direction_for_face_pixel(face: Face, local_u: float, local_v: float, mount: Mat3) -> Vec3:
    return normalize(mat_vec(mount, point_on_cube_face(face, local_u, local_v)))


def depth_center(depth_norm: float, scene: Mapping) -> float:
    window = scene["depth_window"]
    return window["min_center"] + clamp01(depth_norm) * (window["max_center"] - window["min_center"])


def background_uv(direction: Vec3, depth_norm: float, scene: Mapping) -> tuple[float, float]:
    """Background mapping deliberately has no yaw input."""
    direction = normalize(direction)
    u = wrap01(math.atan2(direction[1], direction[0]) / (2.0 * math.pi) + scene.get("u_offset", 0.0))
    pitch_norm = math.asin(clamp(direction[2], -1.0, 1.0)) / math.pi + 0.5
    v = depth_center(depth_norm, scene) + (0.5 - pitch_norm) * scene["vertical_scale"]
    return u, clamp01(v)


def ray_cube_intersection(direction: Vec3, tie_epsilon: float = 0.0) -> tuple[str, Vec3]:
    direction = normalize(direction)
    candidates = [(abs(direction[0]), "px" if direction[0] >= 0 else "nx"),
                  (abs(direction[1]), "py" if direction[1] >= 0 else "ny"),
                  (abs(direction[2]), "pz" if direction[2] >= 0 else "nz")]
    largest = max(item[0] for item in candidates)
    # Mounted edges need a portable tie rule across Python/JS/C++ trig libraries.
    # Zero preserves the legacy board vectors until that firmware is ported.
    magnitude, face_id = min((item for item in candidates if largest-item[0] <= tie_epsilon),
                             key=lambda item: FACE_ORDER.index(item[1]))
    if magnitude <= 0.0:
        raise ValueError("zero ray")
    point = scale(direction, 0.5 / magnitude)
    return face_id, point


def aim_direction(yaw_deg: float, aim_world: Vec3) -> Vec3:
    """World-space direction the reticle points along once the cube has turned by yaw."""
    return normalize(rotate_z(aim_world, -math.radians(yaw_deg % 360.0)))


def aim_projection(yaw_deg: float, aim_world: Vec3, mount: Mat3, faces: Mapping[str, Face],
                   active: Mapping[str, float], depth_norm: float, scene: Mapping,
                   physical_rects: Mapping[str, Mapping[str, float]] | None = None,
                   pixel_mask: Mapping[str, float] | None = None,
                   enabled_faces: Iterable[str] | None = None,
                   tie_epsilon: float = 0.0) -> dict:
    """Where the fixed reticle lands on the cube, and which atlas pixel the renderer drew there.

    atlas_uv is the same value background_uv() produces for the face pixel under the reticle,
    so scanning and collecting read the image the player is actually looking at.
    """
    aim_ray = aim_direction(yaw_deg, aim_world)
    aim_body = mat_vec(transpose(mount), aim_ray)
    face_id, point = ray_cube_intersection(aim_body, tie_epsilon=tie_epsilon)
    local = face_local_from_point(faces[face_id], point)
    physical = physical_rects.get(face_id, active) if physical_rects else active
    pixel = pixel_uv_from_face(local, physical)
    mask = pixel_mask or {"left": 0.0, "top": 0.0, "right": 1.0, "bottom": 1.0}
    surface_available = enabled_faces is None or face_id in set(enabled_faces)
    return {
        "face_id": face_id,
        "point": point,
        "local": local,
        "pixel_uv": pixel,
        "atlas_uv": background_uv(aim_ray, depth_norm, scene),
        "surface_available": surface_available,
        "visible": surface_available and inside_active_image(local, physical) and inside_active_image(pixel, mask),
    }


def circular_distance(a: float, b: float) -> float:
    return abs((a - b + 0.5) % 1.0 - 0.5)


def target_contains(uv: tuple[float, float], target: Mapping[str, float]) -> bool:
    return circular_distance(uv[0], target["u"]) <= target["w"] / 2.0 and abs(uv[1] - target["v"]) <= target["h"] / 2.0


def hit_target(projection: Mapping, targets: Iterable[Mapping]) -> Mapping | None:
    if not projection["visible"]:
        return None
    for target in targets:
        if target_contains(projection["atlas_uv"], target):
            return target
    return None


def rgb565(value: Sequence[int]) -> int:
    r, g, b = (clamp(int(channel), 0, 255) for channel in value)
    return ((r * 31 + 127) // 255 << 11) | ((g * 63 + 127) // 255 << 5) | ((b * 31 + 127) // 255)


def rgb565_to_rgb888(packed: int) -> tuple[int, int, int]:
    """Expand a packed RGB565 value back to the colour a display actually shows."""
    r, g, b = (packed >> 11) & 0x1F, (packed >> 5) & 0x3F, packed & 0x1F
    return ((r * 255 + 15) // 31, (g * 255 + 31) // 63, (b * 255 + 15) // 31)


def quantize_rgb565(value: Sequence[int]) -> tuple[int, int, int]:
    return rgb565_to_rgb888(rgb565(value))


def rgb565_bytes(value: Sequence[int]) -> bytes:
    packed = rgb565(value)
    return bytes((packed >> 8, packed & 0xFF))


def sample_pillow(image, uv: tuple[float, float]):
    x = int(wrap01(uv[0]) * image.width) % image.width
    y = int(clamp01(uv[1]) * (image.height - 1))
    return image.getpixel((x, y))
