"""Deterministic procedural ocean shared by the laptop simulator, previews and saved samples.

The firmware draws the same scene from firmware/include/live_ocean_generated.h, which
tools/make_live_ocean_header.py writes from config/live_ocean.json. The motion, pixel, hit and
dirty-rectangle rules below are mirrored one for one in firmware/include/live_ocean_render.h and
checked against vectors from this module by tests/native.

Coordinates are face-local cube units: a face is 0..1 on each axis and 50 mm wide. A panel shows
only the physical opening (0.2..0.8), so one face unit is 400 panel pixels.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
import threading
from typing import Callable, Iterable, Mapping, Sequence

from atlas_math import (add, clamp01, cross, dot, face_local_from_point, faces_from_config, normalize,
                        point_on_cube_face, quantize_rgb565, scale)

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "live_ocean.json"
CONFIG = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
SCHEMA_VERSION = int(CONFIG["schema_version"])
RENDERER = str(CONFIG["renderer"])
SEED = int(CONFIG["seed"])
TICK_MS = int(CONFIG["tick_ms"])
FRAME_RGB = tuple(int(channel) for channel in CONFIG["frame_rgb"])
SPRITE_KINDS = tuple(CONFIG["sprite_masks_8x8"])
SPRITE_MASKS = {kind: tuple(int(row) for row in rows) for kind, rows in CONFIG["sprite_masks_8x8"].items()}
BACKGROUND_KEYS = tuple(CONFIG["background_keyframes"])
HEADING_VECTORS = {"+u": (1.0, 0.0), "+v": (0.0, 1.0), "-u": (-1.0, 0.0), "-v": (0.0, -1.0)}

# Shared with live_ocean_render.h. EDGE_EPSILON is the float tolerance of one hinge step.
EDGE_EPSILON = 1e-6
DIRTY_MARGIN_PX = 2
CROP_PAD_PX = 3
RETICLE_ARM_PX = 7
RETICLE_MARGIN_PX = 3
WAVE_FREQUENCY = 31.4159265
GRAIN_CELLS = 240.0

_FACES_CONFIG = json.loads((ROOT / "config" / "faces.json").read_text(encoding="utf-8"))
FACES = faces_from_config(_FACES_CONFIG)
FACE_ORDER = tuple(face["id"] for face in _FACES_CONFIG["faces"])
OPENINGS = {face["id"]: face["physical_face_uv"] for face in _FACES_CONFIG["faces"]}
ENABLED_FACES = tuple(_FACES_CONFIG["enabled_outputs"]["faces"])
PANEL_PX = int(_FACES_CONFIG["display_size"][0])

for _face_id, _opening in OPENINGS.items():
    if abs((_opening["right"] - _opening["left"]) - (_opening["bottom"] - _opening["top"])) > 1e-9:
        raise ValueError(f"{_face_id}: live crops assume a square opening, so panel pixels are square")
if BACKGROUND_KEYS[0]["depth"] != 0.0 or BACKGROUND_KEYS[-1]["depth"] != 1.0:
    raise ValueError("background keyframes must start at depth 0 and end at depth 1")


def _subject(spec: Mapping) -> dict:
    step_u, step_v = HEADING_VECTORS[spec["heading"]]
    speed = float(spec["speed"])
    return {"target_id": spec["target_id"], "label": spec["label"], "band": spec["band"],
            "kind": spec["kind"], "rgb": tuple(int(channel) for channel in spec["rgb"]),
            "w": float(spec["w"]), "h": float(spec["h"]), "face_id": spec["face_id"],
            "u": float(spec["u"]), "v": float(spec["v"]), "du": step_u * speed, "dv": step_v * speed}


SUBJECTS = tuple(_subject(spec) for spec in CONFIG["subjects"])
SUBJECT_INDEX = {subject["target_id"]: index for index, subject in enumerate(SUBJECTS)}


def tick_from_ms(milliseconds: int) -> int:
    return max(0, int(milliseconds)) // TICK_MS


def subject_info(target_id: str) -> dict:
    """Descriptive label and nominal band for a live subject; not a species or depth claim."""
    index = SUBJECT_INDEX.get(target_id)
    if index is None:
        return {}
    subject = SUBJECTS[index]
    return {"target_id": target_id, "label": subject["label"], "band": subject["band"]}


# ---------------------------------------------------------------- motion on the cube surface

def _rotate_quarter(vector, axis, sign: float):
    """Rotate a tangent across a cube hinge by the signed right angle."""
    along = scale(axis, dot(vector, axis))
    return add(along, scale(cross(axis, add(vector, scale(along, -1.0))), sign))


def _neighbor(outward) -> str | None:
    for face_id in FACE_ORDER:
        if dot(FACES[face_id].normal, outward) > 0.9:
            return face_id
    return None


def advance_pose(face_id: str, u: float, v: float, du: float, dv: float) -> tuple[str, float, float, float, float]:
    """One fixed tick along the real cube surface. Mirrors LiveOcean::advanceOne.

    Distance to the first edge is consumed, then the tangent is turned about the shared hinge and
    the rest of the step continues on the neighbouring face. Nothing is projected through a sphere.
    """
    remaining = 1.0
    for _hop in range(4):
        if remaining <= EDGE_EPSILON:
            break
        face = FACES[face_id]
        edge_time, edge = remaining, None
        if du > 0.0 and (1.0 - u) / du < edge_time:
            edge_time, edge = (1.0 - u) / du, 1
        if du < 0.0 and (0.0 - u) / du < edge_time:
            edge_time, edge = (0.0 - u) / du, 0
        if dv > 0.0 and (1.0 - v) / dv < edge_time:
            edge_time, edge = (1.0 - v) / dv, 3
        if dv < 0.0 and (0.0 - v) / dv < edge_time:
            edge_time, edge = (0.0 - v) / dv, 2
        if edge is None or edge_time >= remaining - EDGE_EPSILON:
            u, v = u + du * remaining, v + dv * remaining
            break
        u, v = u + du * edge_time, v + dv * edge_time
        outward = (scale(face.right, -1.0), face.right, scale(face.down, -1.0), face.down)[edge]
        neighbor_id = _neighbor(outward)
        if neighbor_id is None:
            break
        edge_point = point_on_cube_face(face, u, v)
        neighbor = FACES[neighbor_id]
        axis = normalize(cross(face.normal, neighbor.normal))
        sign = 1.0 if dot(_rotate_quarter(face.normal, axis, 1.0), neighbor.normal) > 0.9 else -1.0
        turned = _rotate_quarter(add(scale(face.right, du), scale(face.down, dv)), axis, sign)
        face_id = neighbor_id
        u, v = face_local_from_point(neighbor, edge_point)
        du, dv = dot(turned, neighbor.right), dot(turned, neighbor.down)
        remaining -= edge_time
    return face_id, u, v, du, dv


_lock = threading.Lock()
_cached_tick = 0
_cached_poses = [dict(subject) for subject in SUBJECTS]


def targets_at_tick(tick: int) -> tuple[dict, ...]:
    """Every subject's pose at a scene tick, advanced incrementally from the last request."""
    global _cached_tick, _cached_poses
    tick = max(0, int(tick))
    with _lock:
        if tick < _cached_tick:
            _cached_tick, _cached_poses = 0, [dict(subject) for subject in SUBJECTS]
        while _cached_tick < tick:
            for pose in _cached_poses:
                pose["face_id"], pose["u"], pose["v"], pose["du"], pose["dv"] = advance_pose(
                    pose["face_id"], pose["u"], pose["v"], pose["du"], pose["dv"])
            _cached_tick += 1
        return tuple({**pose, "scene_tick": tick} for pose in _cached_poses)


def surface_point(target: Mapping):
    """3D point on the unit cube, continuous across hinges; used to compare hosts."""
    return point_on_cube_face(FACES[target["face_id"]], target["u"], target["v"])


def surface_tangent(target: Mapping):
    face = FACES[target["face_id"]]
    return add(scale(face.right, target["du"]), scale(face.down, target["dv"]))


# ---------------------------------------------------------------- one sprite rule for both hosts

def cardinal_heading(du: float, dv: float) -> int:
    """0 = +u, 1 = +v, 2 = -u, 3 = -v. Motion is always cardinal; float dust never flips an axis."""
    if abs(du) >= abs(dv):
        return 0 if du >= 0.0 else 2
    return 1 if dv >= 0.0 else 3


def to_sprite_frame(heading: int, dx: float, dy: float) -> tuple[float, float]:
    """Inverse of the quarter-turn heading: face offset -> sprite frame, exactly, with no trig."""
    if heading == 0:
        return dx, dy
    if heading == 1:
        return dy, -dx
    if heading == 2:
        return -dx, -dy
    return -dy, dx


def rotated_extent(target: Mapping) -> tuple[float, float]:
    """Face-unit width and height the sprite covers; a quarter turn swaps them."""
    width, height = float(target["w"]), float(target["h"])
    return (height, width) if cardinal_heading(target["du"], target["dv"]) % 2 else (width, height)


def sprite_opaque(target: Mapping, u: float, v: float) -> bool:
    x, y = to_sprite_frame(cardinal_heading(target["du"], target["dv"]), u - target["u"], v - target["v"])
    col = math.floor((x / float(target["w"]) + 0.5) * 8.0)
    row = math.floor((y / float(target["h"]) + 0.5) * 8.0)
    if not (0 <= col < 8 and 0 <= row < 8):
        return False
    return bool(SPRITE_MASKS[target["kind"]][row] & (1 << (7 - col)))


def subject_at(targets: Sequence[Mapping], face_id: str, u: float, v: float) -> int | None:
    """Index of the subject drawn at a face point. The lowest index is on top, on both hosts."""
    for index, target in enumerate(targets):
        if target["face_id"] == face_id and sprite_opaque(target, u, v):
            return index
    return None


# ---------------------------------------------------------------- background

def _hash01(x: int, y: int) -> float:
    value = (x * 374761393 + y * 668265263 + SEED) & 0xFFFFFFFF
    value ^= value >> 13
    value = (value * 1274126177) & 0xFFFFFFFF
    return ((value ^ (value >> 16)) & 0xFFFF) / 65535.0


def gradient_ends(depth_norm: float) -> tuple[list[float], list[float]]:
    """Top and bottom colours for a depth, linear between the configured keyframes."""
    depth = clamp01(float(depth_norm))
    for lower, upper in zip(BACKGROUND_KEYS, BACKGROUND_KEYS[1:]):
        if depth <= upper["depth"]:
            span = upper["depth"] - lower["depth"]
            t = 0.0 if span <= 0.0 else (depth - lower["depth"]) / span
            top = [lower["top"][i] + (upper["top"][i] - lower["top"][i]) * t for i in range(3)]
            bottom = [lower["bottom"][i] + (upper["bottom"][i] - lower["bottom"][i]) * t for i in range(3)]
            return top, bottom
    last = BACKGROUND_KEYS[-1]
    return [float(c) for c in last["top"]], [float(c) for c in last["bottom"]]


def background_rgb(u: float, v: float, depth_norm: float) -> tuple[int, int, int]:
    """Procedural water. It has no time input, so a fixed depth never changes between ticks and
    the board can restore only dirty rectangles. Channels round half up, as in firmware."""
    top, bottom = gradient_ends(depth_norm)
    u, v = clamp01(u), clamp01(v)
    wave = 0.5 + 0.5 * math.sin(u * WAVE_FREQUENCY + math.sin(v * 9.0))
    grain = _hash01(int(u * GRAIN_CELLS), int(v * GRAIN_CELLS)) * 0.14
    mix = clamp01(v * 0.78 + wave * 0.18 + grain)
    return tuple(int(math.floor(top[i] * (1.0 - mix) + bottom[i] * mix + 0.5)) for i in range(3))


# ---------------------------------------------------------------- panel pixels

def pixel_center(face_id: str, x: int, y: int) -> tuple[float, float]:
    """Face-local point at the centre of panel pixel (x, y); both hosts sample here."""
    opening = OPENINGS[face_id]
    return (opening["left"] + (x + 0.5) / PANEL_PX * (opening["right"] - opening["left"]),
            opening["top"] + (y + 0.5) / PANEL_PX * (opening["bottom"] - opening["top"]))


def pixel_rgb(targets: Sequence[Mapping], face_id: str, u: float, v: float, depth_norm: float) -> tuple[int, int, int]:
    """The colour the panel shows at a face point, after RGB565 quantization."""
    index = subject_at(targets, face_id, u, v)
    rgb = targets[index]["rgb"] if index is not None else background_rgb(u, v, depth_norm)
    return quantize_rgb565(rgb)


def subject_screen_rect(target: Mapping, margin: int = DIRTY_MARGIN_PX):
    """Panel pixels a subject can touch: rotated bounds plus a float margin, clipped to the panel.

    Returns (face_id, x0, y0, x1, y1) with exclusive x1/y1, or None when nothing is on a panel.
    """
    face_id = target["face_id"]
    if face_id not in ENABLED_FACES:
        return None
    opening = OPENINGS[face_id]
    sx = PANEL_PX / (opening["right"] - opening["left"])
    sy = PANEL_PX / (opening["bottom"] - opening["top"])
    cx, cy = (target["u"] - opening["left"]) * sx, (target["v"] - opening["top"]) * sy
    width, height = rotated_extent(target)
    x0 = max(0, math.floor(cx - width * sx / 2.0) - margin)
    y0 = max(0, math.floor(cy - height * sy / 2.0) - margin)
    x1 = min(PANEL_PX, math.ceil(cx + width * sx / 2.0) + margin)
    y1 = min(PANEL_PX, math.ceil(cy + height * sy / 2.0) + margin)
    if x0 >= x1 or y0 >= y1:
        return None
    return face_id, x0, y0, x1, y1


def dirty_rects(before: Sequence[Mapping], after: Sequence[Mapping]) -> list[tuple]:
    """What the board repaints between two displayed ticks: each subject's old and new bounds,
    merged into one rectangle while it stays on the same face."""
    rects = []
    for old, new in zip(before, after):
        first, second = subject_screen_rect(old), subject_screen_rect(new)
        if first and second and first[0] == second[0]:
            rects.append((first[0], min(first[1], second[1]), min(first[2], second[2]),
                          max(first[3], second[3]), max(first[4], second[4])))
        else:
            rects.extend(rect for rect in (first, second) if rect)
    return rects


def render_panel(face_id: str, depth_norm: float, tick: int, targets: Sequence[Mapping] | None = None):
    """The complete 240x240 image one enabled panel shows at a tick."""
    from PIL import Image

    if face_id not in ENABLED_FACES:
        raise ValueError(f"{face_id} has no panel")
    targets = targets_at_tick(tick) if targets is None else targets
    rects = [(index, subject_screen_rect(target)) for index, target in enumerate(targets)
             if target["face_id"] == face_id]
    rects = [(index, rect) for index, rect in rects if rect]
    image = Image.new("RGB", (PANEL_PX, PANEL_PX))
    pixels = image.load()
    for y in range(PANEL_PX):
        for x in range(PANEL_PX):
            u, v = pixel_center(face_id, x, y)
            rgb = None
            for index, (_face, x0, y0, x1, y1) in rects:
                if x0 <= x < x1 and y0 <= y < y1 and sprite_opaque(targets[index], u, v):
                    rgb = targets[index]["rgb"]
                    break
            pixels[x, y] = quantize_rgb565(rgb if rgb is not None else background_rgb(u, v, depth_norm))
    return image


# ---------------------------------------------------------------- reticle, scan and collect

def reticle_pixel(projection: Mapping) -> tuple[int, int] | None:
    if not projection.get("visible"):
        return None
    pixel_u, pixel_v = projection["pixel_uv"]
    return (min(PANEL_PX - 1, max(0, int(pixel_u * PANEL_PX))),
            min(PANEL_PX - 1, max(0, int(pixel_v * PANEL_PX))))


def hit_at_reticle(projection: Mapping, targets: Sequence[Mapping]) -> dict | None:
    """The subject shown on the pixel under the reticle centre, sampled at that pixel's centre.

    A scan hits exactly what the player sees under the cross, including the transparent eye and
    tail notch of a fish, and the animal drawn on top when two overlap.
    """
    pixel = reticle_pixel(projection)
    if pixel is None:
        return None
    face_id = projection["face_id"]
    u, v = pixel_center(face_id, *pixel)
    index = subject_at(targets, face_id, u, v)
    return None if index is None else {**targets[index], "index": index}


def collect_crop(target: Mapping) -> dict:
    """A square of panel pixels centred on the subject that covers its rotated footprint."""
    face_id = target["face_id"]
    opening = OPENINGS[face_id]
    scale_px = PANEL_PX / (opening["right"] - opening["left"])
    cx, cy = (target["u"] - opening["left"]) * scale_px, (target["v"] - opening["top"]) * scale_px
    width, height = rotated_extent(target)
    side = int(math.ceil(max(width, height) * scale_px)) + 2 * CROP_PAD_PX
    return {"face_id": face_id, "x": int(math.floor(cx - side / 2.0)),
            "y": int(math.floor(cy - side / 2.0)), "s": side}


def render_live_crop(crop: Mapping, depth_norm: float, tick: int):
    """Rebuild the frozen panel pixels a Collect captured. Pixels past the opening were behind the
    physical frame when it was taken, so they are drawn in the frame colour rather than invented."""
    from PIL import Image

    if "s" not in crop:
        raise ValueError("live crops are squares of panel pixels")
    targets = targets_at_tick(tick)
    face_id, side = str(crop["face_id"]), int(crop["s"])
    x0, y0 = int(crop["x"]), int(crop["y"])
    image = Image.new("RGB", (side, side), FRAME_RGB)
    pixels = image.load()
    for j in range(side):
        y = y0 + j
        if not 0 <= y < PANEL_PX:
            continue
        for i in range(side):
            x = x0 + i
            if 0 <= x < PANEL_PX:
                u, v = pixel_center(face_id, x, y)
                pixels[i, j] = pixel_rgb(targets, face_id, u, v, depth_norm)
    return image


def aim_for_subject(index: int, tick: int, projector: Callable[[float], Mapping]) -> float | None:
    """A heading whose reticle pixel shows this subject at this tick, or None if none does."""
    targets = targets_at_tick(tick)
    for step in range(1440):
        yaw = step * 0.25
        hit = hit_at_reticle(projector(yaw), targets)
        if hit is not None and hit["index"] == index:
            return yaw
    return None


def hittable_ticks(projection: Mapping, ticks: Iterable[int]) -> dict[int, list[int]]:
    """For one fixed reticle, the ticks at which each subject is under it."""
    found: dict[int, list[int]] = {index: [] for index in range(len(SUBJECTS))}
    for tick in ticks:
        hit = hit_at_reticle(projection, targets_at_tick(tick))
        if hit is not None:
            found[hit["index"]].append(int(tick))
    return found
