"""Generate tests/native/live_vectors_generated.h from tools/live_ocean.py.

tests/native/test_live_ocean.cpp runs firmware/include/live_ocean_motion.h and live_ocean_render.h
against these values, so the board and the laptop are checked to move, draw, hit and crop the one
scene. Poses are compared as 3D surface points, which stay continuous across a hinge even when a
float and a double disagree about which face a point exactly on an edge belongs to.
"""

from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

import live_ocean  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "tests" / "native" / "live_vectors_generated.h"
POSE_TICKS = (0, 1, 7, 29, 61, 120, 245, 400, 777, 1000)
HEADING_STEPS = ((1.0, 0.0), (0.0, 1.0), (-1.0, 0.0), (0.0, -1.0))
BACKGROUND_DEPTHS = (0.0, 0.2, 0.35, 0.45, 0.62, 0.8, 1.0)
BACKGROUND_PIXELS = (0, 17, 59, 101, 150, 199, 239)
NEAR_EDGE = 1e-3
FOOTPRINT_SEARCH_PX = 24


def _f(value: float) -> str:
    text = f"{float(value):.9g}"
    if not any(ch in text for ch in ".en"):
        text += ".0"
    return text + "f"


def _sprite_offset(heading: int, x: float, y: float) -> tuple[float, float]:
    """Sprite-frame point to face offset: the forward quarter turn."""
    if heading == 0:
        return x, y
    if heading == 1:
        return -y, x
    if heading == 2:
        return -x, -y
    return y, -x


def footprint(target) -> tuple[int, int, int, int] | None:
    """Exact bounds of the opaque panel pixels, searched well past the dirty rectangle."""
    face_id = target["face_id"]
    if face_id not in live_ocean.ENABLED_FACES:
        return None
    rect = live_ocean.subject_screen_rect(target, margin=FOOTPRINT_SEARCH_PX)
    if rect is None:
        return None
    _face, x0, y0, x1, y1 = rect
    xs, ys = [], []
    for y in range(y0, y1):
        for x in range(x0, x1):
            u, v = live_ocean.pixel_center(face_id, x, y)
            if live_ocean.sprite_opaque(target, u, v):
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def build() -> str:
    face_index = {face_id: index for index, face_id in enumerate(live_ocean.FACE_ORDER)}
    poses, rects = [], []
    for tick in POSE_TICKS:
        for index, target in enumerate(live_ocean.targets_at_tick(tick)):
            point = live_ocean.surface_point(target)
            tangent = live_ocean.surface_tangent(target)
            near = min(target["u"], 1.0 - target["u"], target["v"], 1.0 - target["v"]) < NEAR_EDGE
            poses.append(f"    {{{index}, {tick}u, {face_index[target['face_id']]}, {_f(target['u'])}, {_f(target['v'])}, "
                         f"{_f(point[0])}, {_f(point[1])}, {_f(point[2])}, "
                         f"{_f(tangent[0])}, {_f(tangent[1])}, {_f(tangent[2])}, {'true' if near else 'false'}}},")
            rect = live_ocean.subject_screen_rect(target)
            if rect is None:
                continue
            found = footprint(target)
            crop = live_ocean.collect_crop(target)
            fx0, fy0, fx1, fy1 = found if found else (0, 0, 0, 0)
            rects.append(f"    {{{index}, {face_index[target['face_id']]}, {_f(target['u'])}, {_f(target['v'])}, "
                         f"{_f(target['du'])}, {_f(target['dv'])}, {rect[1]}, {rect[2]}, {rect[3]}, {rect[4]}, "
                         f"{'true' if found else 'false'}, {fx0}, {fy0}, {fx1}, {fy1}, "
                         f"{crop['x']}, {crop['y']}, {crop['s']}}},")

    sprites = []
    for index, subject in enumerate(live_ocean.SUBJECTS):
        mask = live_ocean.SPRITE_MASKS[subject["kind"]]
        for heading, (step_u, step_v) in enumerate(HEADING_STEPS):
            pose = {**subject, "face_id": "py", "u": 0.5, "v": 0.5, "du": step_u * 0.02, "dv": step_v * 0.02}
            samples = [((col + 0.5) / 8.0 - 0.5, (row + 0.5) / 8.0 - 0.5, bool(mask[row] & (1 << (7 - col))))
                       for row in range(8) for col in range(8)]
            samples += [(0.62, 0.0, False), (-0.62, 0.0, False), (0.0, 0.62, False), (0.0, -0.62, False)]
            for fraction_x, fraction_y, expected in samples:
                dx, dy = _sprite_offset(heading, fraction_x * subject["w"], fraction_y * subject["h"])
                u, v = 0.5 + dx, 0.5 + dy
                if live_ocean.sprite_opaque(pose, u, v) != expected:
                    raise AssertionError(f"reference sprite rule disagrees with its own mask: {subject['target_id']}")
                sprites.append(f"    {{{index}, {_f(pose['du'])}, {_f(pose['dv'])}, {_f(u)}, {_f(v)}, "
                               f"{'true' if expected else 'false'}}},")

    backgrounds = []
    for depth in BACKGROUND_DEPTHS:
        for y in BACKGROUND_PIXELS:
            for x in BACKGROUND_PIXELS:
                u, v = live_ocean.pixel_center("px", x, y)
                red, green, blue = live_ocean.background_rgb(u, v, depth)
                backgrounds.append(f"    {{{_f(u)}, {_f(v)}, {_f(depth)}, {{{red}, {green}, {blue}}}}},")

    return "\n".join([
        "#pragma once",
        "",
        "// Generated by tools/make_live_vectors.py from tools/live_ocean.py. Do not edit.",
        "",
        "#include <stdint.h>",
        "",
        "namespace LiveVectors {",
        "",
        "struct PoseVector { uint8_t subject; uint32_t tick; uint8_t face; float u; float v;",
        "                    float px; float py; float pz; float tx; float ty; float tz; bool nearEdge; };",
        "struct RectVector { uint8_t subject; uint8_t face; float u; float v; float du; float dv;",
        "                    int16_t x0; int16_t y0; int16_t x1; int16_t y1; bool hasFootprint;",
        "                    int16_t fx0; int16_t fy0; int16_t fx1; int16_t fy1;",
        "                    int16_t cropX; int16_t cropY; int16_t cropSide; };",
        "struct SpriteVector { uint8_t subject; float du; float dv; float u; float v; bool opaque; };",
        "struct BackgroundVector { float u; float v; float depth; uint8_t rgb[3]; };",
        "",
        "constexpr PoseVector kPoses[] = {", *poses, "};",
        "constexpr RectVector kRects[] = {", *rects, "};",
        "constexpr SpriteVector kSprites[] = {", *sprites, "};",
        "constexpr BackgroundVector kBackgrounds[] = {", *backgrounds, "};",
        "",
        "constexpr unsigned kPoseCount = sizeof(kPoses) / sizeof(kPoses[0]);",
        "constexpr unsigned kRectCount = sizeof(kRects) / sizeof(kRects[0]);",
        "constexpr unsigned kSpriteCount = sizeof(kSprites) / sizeof(kSprites[0]);",
        "constexpr unsigned kBackgroundCount = sizeof(kBackgrounds) / sizeof(kBackgrounds[0]);",
        "",
        "}",
        "",
    ])


def main() -> int:
    OUTPUT.write_text(build(), encoding="utf-8")
    print(f"wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
