"""Build geometry-grounded net, assembled-cube, and module calibration previews."""

from __future__ import annotations

import argparse
import itertools
import json
import math
from pathlib import Path
import sys

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from atlas_math import Face, dot, mat_vec, point_on_cube_face, quaternion_matrix  # noqa: E402
from preview import load_pack, render_face  # noqa: E402

FACE_ORDER = ("px", "nx", "py", "ny", "pz", "nz")
# Four side faces form a strip; the remaining two faces attach above and below pz.
# In-plane turns are solved from the configured 3D face bases, not guessed by name.
FACE_NET_GRID = {"nx": (0, 1), "pz": (1, 1), "px": (2, 1), "nz": (3, 1), "py": (1, 0), "ny": (1, 2)}
SIDES = {
    "left": ((0.0, 0.0), (0.0, 1.0)),
    "right": ((1.0, 0.0), (1.0, 1.0)),
    "top": ((0.0, 0.0), (1.0, 0.0)),
    "bottom": ((0.0, 1.0), (1.0, 1.0)),
}
VIEW_WORLD = (1.0, 1.0, 1.0)


def tile_to_face_uv(u: float, v: float, quarter_turns: int) -> tuple[float, float]:
    """Map net-tile coordinates to configured face coordinates."""
    quarter_turns %= 4
    if quarter_turns == 0:
        return u, v
    if quarter_turns == 1:
        return v, 1.0 - u
    if quarter_turns == 2:
        return 1.0 - u, 1.0 - v
    return 1.0 - v, u


def _edge_points(face: Face, side: str, quarter_turns: int):
    return tuple(point_on_cube_face(face, *tile_to_face_uv(u, v, quarter_turns)) for u, v in SIDES[side])


def _same_edge(first, second, tolerance: float = 1e-9) -> bool:
    return all(math.dist(a, b) <= tolerance for a, b in zip(sorted(first), sorted(second)))


def net_adjacencies(net_grid):
    by_position = {position: face_id for face_id, position in net_grid.items()}
    result = []
    for face_id, (x, y) in net_grid.items():
        for dx, dy, side, other_side in ((1, 0, "right", "left"), (0, 1, "bottom", "top")):
            other = by_position.get((x + dx, y + dy))
            if other is not None:
                result.append((face_id, side, other, other_side))
    return tuple(result)


def solve_net_turns(faces: dict[str, Face], net_grid=FACE_NET_GRID) -> dict[str, int]:
    """Find in-plane rotations whose net edges are the same 3D cube edges."""
    face_ids = tuple(net_grid)
    adjacencies = net_adjacencies(net_grid)
    anchor = "pz" if "pz" in faces else face_ids[0]
    remaining = tuple(face_id for face_id in face_ids if face_id != anchor)
    for turns in itertools.product(range(4), repeat=len(remaining)):
        candidate = {anchor: 0, **dict(zip(remaining, turns))}
        if all(_same_edge(_edge_points(faces[a], side_a, candidate[a]),
                          _edge_points(faces[b], side_b, candidate[b]))
               for a, side_a, b, side_b in adjacencies):
            return candidate
    raise ValueError("configured faces cannot be folded from the requested net")


def validate_net_foldability(faces: dict[str, Face], net_grid=FACE_NET_GRID, turns=None) -> dict:
    turns = turns or solve_net_turns(faces, net_grid)
    checks = []
    for face_a, side_a, face_b, side_b in net_adjacencies(net_grid):
        matches = _same_edge(_edge_points(faces[face_a], side_a, turns[face_a]),
                             _edge_points(faces[face_b], side_b, turns[face_b]))
        checks.append({"faces": [face_a, face_b], "sides": [side_a, side_b], "shared_edge_matches": matches})
        if not matches:
            raise ValueError(f"net edge mismatch: {face_a}.{side_a} / {face_b}.{side_b}")
    return {"foldable": True, "turns_quarter_clockwise": turns, "shared_edges": checks}


def physical_geometry(faces_cfg):
    dimensions = faces_cfg["physical_face_dimensions_mm"]
    edge_mm = float(dimensions["face_edge"])
    opening_mm = float(dimensions["active_opening"])
    frame_mm = float(dimensions["frame_each_side"])
    rects = {item["id"]: item["physical_face_uv"] for item in faces_cfg["faces"]}
    for face_id, rect in rects.items():
        width = float(rect["right"]) - float(rect["left"])
        height = float(rect["bottom"]) - float(rect["top"])
        expected = opening_mm / edge_mm
        if not math.isclose(width, expected, abs_tol=1e-9) or not math.isclose(height, expected, abs_tol=1e-9):
            raise ValueError(f"{face_id} physical rectangle does not match configured dimensions")
    return edge_mm, opening_mm, frame_mm, rects


def opening_pixels(tile_size: int, rect):
    return (round(tile_size * rect["left"]), round(tile_size * rect["top"]),
            round(tile_size * rect["right"]), round(tile_size * rect["bottom"]))


def project(point: tuple[float, float, float], mount, origin=(470, 380), scale=390.0) -> tuple[float, float]:
    point = mat_vec(mount, point)
    x, y, z = point
    return (origin[0] + scale * (0.78 * x - 0.56 * y),
            origin[1] + scale * (0.48 * x + 0.48 * y - 0.82 * z))


def face_corners(face: Face, left=0.0, top=0.0, right=1.0, bottom=1.0):
    return [point_on_cube_face(face, left, top), point_on_cube_face(face, right, top),
            point_on_cube_face(face, right, bottom), point_on_cube_face(face, left, bottom)]


def _fit_projection(mount, canvas_size=(900, 720), viewport=(30, 92, 870, 640)):
    points = [mat_vec(mount, (x, y, z)) for x in (-0.5, 0.5) for y in (-0.5, 0.5) for z in (-0.5, 0.5)]
    raw = [(0.78 * x - 0.56 * y, 0.48 * x + 0.48 * y - 0.82 * z) for x, y, z in points]
    min_x, max_x = min(p[0] for p in raw), max(p[0] for p in raw)
    min_y, max_y = min(p[1] for p in raw), max(p[1] for p in raw)
    vx0, vy0, vx1, vy1 = viewport
    scale = min((vx1 - vx0 - 36) / (max_x - min_x), (vy1 - vy0 - 36) / (max_y - min_y))
    origin = ((vx0 + vx1) / 2.0 - scale * (min_x + max_x) / 2.0,
              (vy0 + vy1) / 2.0 - scale * (min_y + max_y) / 2.0)
    return origin, scale


def _solve_linear(matrix, values):
    matrix = [list(row) + [value] for row, value in zip(matrix, values)]
    for col in range(len(values)):
        pivot = max(range(col, len(values)), key=lambda row: abs(matrix[row][col]))
        if abs(matrix[pivot][col]) < 1e-12:
            raise ValueError("singular perspective transform")
        matrix[col], matrix[pivot] = matrix[pivot], matrix[col]
        divisor = matrix[col][col]
        matrix[col] = [value / divisor for value in matrix[col]]
        for row in range(len(values)):
            if row == col:
                continue
            factor = matrix[row][col]
            matrix[row] = [a - factor * b for a, b in zip(matrix[row], matrix[col])]
    return [row[-1] for row in matrix]


def perspective_coefficients(destination_quad, source_quad):
    """Return Pillow's destination-pixel to source-pixel perspective coefficients."""
    rows, values = [], []
    for (x, y), (u, v) in zip(destination_quad, source_quad):
        rows.append([x, y, 1.0, 0.0, 0.0, 0.0, -u * x, -u * y])
        values.append(u)
        rows.append([0.0, 0.0, 0.0, x, y, 1.0, -v * x, -v * y])
        values.append(v)
    return tuple(_solve_linear(rows, values))


def warp_texture_to_quad(source: Image.Image, canvas_size, destination_quad):
    source_quad = ((0.0, 0.0), (source.width - 1.0, 0.0),
                   (source.width - 1.0, source.height - 1.0), (0.0, source.height - 1.0))
    coefficients = perspective_coefficients(destination_quad, source_quad)
    warped = source.transform(canvas_size, Image.Transform.PERSPECTIVE, coefficients, Image.Resampling.BICUBIC)
    mask = Image.new("L", canvas_size, 0)
    ImageDraw.Draw(mask).polygon(destination_quad, fill=255)
    return warped, mask


def _interpolate(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def face_uv_to_tile_uv(u: float, v: float, quarter_turns: int) -> tuple[float, float]:
    quarter_turns %= 4
    if quarter_turns == 0:
        return u, v
    if quarter_turns == 1:
        return 1.0 - v, u
    if quarter_turns == 2:
        return 1.0 - u, 1.0 - v
    return v, 1.0 - u


def draw_up_marker(draw, start, end, label_position=None, color=(240, 245, 245)):
    draw.line((start[0], start[1], end[0], end[1]), fill=color, width=2)
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = math.hypot(dx, dy) or 1.0
    ux, uy = dx / length, dy / length
    px, py = -uy, ux
    tip = end
    left = (tip[0] - ux * 10 + px * 5, tip[1] - uy * 10 + py * 5)
    right = (tip[0] - ux * 10 - px * 5, tip[1] - uy * 10 - py * 5)
    draw.polygon((tip, left, right), fill=color)
    if label_position is not None:
        draw.text(label_position, "UP", fill=color)


def draw_net_up_marker(draw, x, y, tile, quarter_turns):
    start_uv = face_uv_to_tile_uv(0.5, 0.5, quarter_turns)
    end_uv = face_uv_to_tile_uv(0.5, 0.30, quarter_turns)
    start = (x + start_uv[0] * tile, y + start_uv[1] * tile)
    end = (x + end_uv[0] * tile, y + end_uv[1] * tile)
    draw_up_marker(draw, start, end, (x + 12, y + 28), color=(240, 245, 245))


def draw_quad_grid(draw, quad, color=(92, 132, 142)):
    top_left, top_right, bottom_right, bottom_left = quad
    for index in range(1, 6):
        t = index / 6.0
        draw.line([_interpolate(top_left, top_right, t), _interpolate(bottom_left, bottom_right, t)], fill=color, width=1)
        draw.line([_interpolate(top_left, bottom_left, t), _interpolate(top_right, bottom_right, t)], fill=color, width=1)


def make_net(atlas, faces, scene, mount, depth: float, grid: bool, output: Path, faces_cfg) -> dict:
    edge_mm, opening_mm, frame_mm, physical_rects = physical_geometry(faces_cfg)
    enabled = set(faces_cfg.get("enabled_outputs", {}).get("faces", []))
    wiring = {item["id"]: (item.get("cs_gpio"), item.get("screen")) for item in faces_cfg["faces"]}
    turns = solve_net_turns(faces)
    fold = validate_net_foldability(faces, turns=turns)
    tile = 220
    gap = 14
    ox, oy = 40, 48
    image = Image.new("RGB", (4 * tile + 3 * gap + 80, 3 * tile + 2 * gap + 110), (5, 12, 25))
    draw = ImageDraw.Draw(image)
    for face_id, (gx, gy) in FACE_NET_GRID.items():
        x, y = ox + gx * (tile + gap), oy + gy * (tile + gap)
        rendered = render_face(atlas, faces[face_id], scene, mount, depth, physical_rects[face_id], grid)
        left, top, right, bottom = opening_pixels(tile, physical_rects[face_id])
        opening = rendered.resize((right - left, bottom - top), Image.Resampling.NEAREST)
        opening = opening.rotate(-90 * turns[face_id], expand=False)
        tile_image = Image.new("RGB", (tile, tile), (19, 46, 56))
        tile_image.paste(opening, (left, top))
        image.paste(tile_image, (x, y))
        draw.rectangle((x, y, x + tile - 1, y + tile - 1), outline=(150, 180, 186), width=2)
        draw.rectangle((x + left, y + top, x + right - 1, y + bottom - 1), outline=(240, 210, 120), width=2)
        draw.text((x + 8, y + 8), f"{face_id.upper()}  rot={turns[face_id] * 90}", fill=(240, 250, 250))
        draw_net_up_marker(draw, x, y, tile, turns[face_id])
        cs_gpio, screen = wiring.get(face_id, (None, None))
        if cs_gpio is not None:
            wired = enabled and face_id in enabled
            draw.text((x + 8, y + tile - 37),
                      f"CS GPIO{cs_gpio}" + (f"  /  panel {screen}" if wired else "  /  no panel"),
                      fill=(240, 210, 120) if wired else (196, 108, 96))
        draw.text((x + 8, y + tile - 21), f"{edge_mm:g} mm face / {opening_mm:g} mm opening", fill=(170, 205, 210))
        if enabled and face_id not in enabled:
            veil = Image.new("RGB", (right - left, bottom - top), (7, 16, 30))
            image.paste(Image.blend(image.crop((x + left, y + top, x + right, y + bottom)), veil, 0.74),
                        (x + left, y + top))
            draw.rectangle((x + left, y + top, x + right - 1, y + bottom - 1), outline=(196, 108, 96), width=2)
            draw.line((x + left, y + top, x + right - 1, y + bottom - 1), fill=(196, 108, 96), width=2)
            draw.line((x + left, y + bottom - 1, x + right - 1, y + top), fill=(196, 108, 96), width=2)
            draw.text((x + left + 8, y + top + 8), "NO PANEL", fill=(236, 158, 146))
            draw.text((x + left + 8, y + top + 24), "not an output", fill=(196, 108, 96))
    missing = [face_id for face_id in FACE_NET_GRID if enabled and face_id not in enabled]
    heading = "SIX-FACE SEA ATLAS NET / shared cube coordinates / CS wiring"
    if missing:
        heading += f"  /  {len(FACE_NET_GRID) - len(missing)} of {len(FACE_NET_GRID)} faces are outputs"
    draw.text((40, 16), heading, fill=(230, 245, 245))
    draw.text((40, image.height - 42), f"{frame_mm:g} mm frame each side  |  depth={depth:.2f}  |  shared 3D edge checks={len(fold['shared_edges'])}", fill=(200, 225, 228))
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output)
    return {"output": str(output), "layout": FACE_NET_GRID, "turns_quarter_clockwise": turns,
            "foldability": fold, "face_edge_mm": edge_mm, "opening_mm": opening_mm, "frame_mm": frame_mm,
            "opening_ratio": opening_mm / edge_mm,
            "enabled_faces": sorted(enabled), "faces_without_a_panel": sorted(missing),
            "cs_gpio_by_face": {face_id: wiring[face_id][0] for face_id in FACE_NET_GRID}}


def make_assembled(atlas, faces, scene, mount, depth: float, grid: bool, output: Path, faces_cfg, label: str) -> dict:
    edge_mm, opening_mm, frame_mm, physical_rects = physical_geometry(faces_cfg)
    image = Image.new("RGB", (900, 720), (5, 12, 25))
    draw = ImageDraw.Draw(image)
    origin, scale = _fit_projection(mount)
    project_point = lambda point: project(point, mount, origin, scale)
    visible = []
    draw_order = []
    for face_id in FACE_ORDER:
        face = faces[face_id]
        world_normal = mat_vec(mount, face.normal)
        if dot(world_normal, VIEW_WORLD) <= 0.0:
            continue
        world_center = mat_vec(mount, tuple(value * 0.5 for value in face.normal))
        draw_order.append((dot(world_center, VIEW_WORLD), face_id))
    for _depth_order, face_id in sorted(draw_order):
        face = faces[face_id]
        corners = [project_point(p) for p in face_corners(face)]
        opening = [project_point(p) for p in face_corners(face, **physical_rects[face_id])]
        draw.polygon(corners, fill=(19, 46, 56), outline=(130, 172, 180))
        rendered = render_face(atlas, face, scene, mount, depth, physical_rects[face_id], False)
        warped, mask = warp_texture_to_quad(rendered, image.size, opening)
        image.paste(warped, (0, 0), mask)
        if grid:
            draw_quad_grid(draw, opening)
        draw.line(opening + [opening[0]], fill=(240, 210, 120), width=2)
        up_start = project_point(point_on_cube_face(face, 0.5, 0.5))
        up_end = project_point(point_on_cube_face(face, 0.5, 0.30))
        draw_up_marker(draw, up_start, up_end, None, color=(240, 245, 245))
        cx = sum(p[0] for p in corners) / 4
        cy = sum(p[1] for p in corners) / 4
        draw.text((cx - 14, cy - 8), face_id.upper(), fill=(245, 250, 250))
        visible.append(face_id)
    draw.text((30, 24), "ASSEMBLED CUBE / six geometric faces", fill=(230, 245, 245))
    draw.text((30, 52), f"{edge_mm:g} mm edges, centered {opening_mm:g} mm openings, {frame_mm:g} mm frame; full 240x240 display texture warped into each opening", fill=(190, 220, 225))
    draw.text((30, 672), f"{label} / world mount unresolved; culling uses mounted normals and depth order", fill=(230, 190, 120))
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output)
    return {"output": str(output), "visible_faces_in_projection": visible, "face_edge_mm": edge_mm,
            "opening_mm": opening_mm, "frame_mm": frame_mm, "opening_ratio": opening_mm / edge_mm,
            "texture_source_uv": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
            "mount_label": label}


def make_calibration(output: Path, faces_cfg) -> dict:
    edge_mm, opening_mm, frame_mm, physical_rects = physical_geometry(faces_cfg)
    tile = 180
    image = Image.new("RGB", (3 * tile + 80, 2 * tile + 185), (5, 12, 25))
    draw = ImageDraw.Draw(image)
    for index, face_id in enumerate(FACE_ORDER):
        x, y = 30 + (index % 3) * tile, 48 + (index // 3) * tile
        rect = opening_pixels(tile - 4, physical_rects[face_id])
        draw.rectangle((x, y, x + tile - 4, y + tile - 4), fill=(19, 46, 56), outline=(130, 172, 180), width=2)
        draw.rectangle((x + rect[0], y + rect[1], x + rect[2], y + rect[3]), outline=(240, 210, 120), width=2)
        mid_y = y + (rect[1] + rect[3]) // 2
        draw.line((x + 18, mid_y, x + rect[0] + 12, mid_y), fill=(240, 245, 245), width=3)
        draw.polygon((x + 18, mid_y, x + 29, mid_y - 6, x + 29, mid_y + 6), fill=(240, 245, 245))
        draw.line((x + tile - 28, y + 20, x + tile - 28, y + tile - 20), fill=(230, 150, 110), width=5)
        draw.text((x + tile - 52, y + 8), "HDR", fill=(230, 150, 110))
        draw.text((x + 8, y + 8), f"{face_id.upper()} SLOT TEMPLATE", fill=(245, 250, 250))
    footer_y = 2 * tile + 66
    draw.text((30, 16), "MODULE CALIBRATION TEMPLATE / one tested diagnostic module", fill=(230, 245, 245))
    draw.text((30, footer_y), "OBSERVED UNIT: UP points left; connector is opposite/right edge", fill=(190, 220, 225))
    draw.text((30, footer_y + 25), "Holder template: local UP is top; header is right; GND is the top pin.", fill=(190, 220, 225))
    draw.text((30, footer_y + 50), "One-module evidence only; it does not confirm all six connectors.", fill=(190, 220, 225))
    draw.text((30, footer_y + 75), "FINAL MOUNT: ____________________    PER-UNIT ORIENTATION: UNKNOWN", fill=(240, 210, 120))
    draw.text((30, footer_y + 103), f"{edge_mm:g} mm face / {opening_mm:g} mm opening / {frame_mm:g} mm frame", fill=(170, 205, 210))
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output)
    return {"output": str(output), "module_fact": "diagnostic UP points left, opposite connector edge",
            "holder_template": "local UP top; header right; GND top pin, then VCC/SCL/SDA/RST/DC/CS/BL",
            "world_orientation": "unresolved", "final_mount_field": "UNKNOWN",
            "scope": "one tested diagnostic module template; not six-unit confirmation"}


def make_face_samples(atlas, faces, scene, mount, depth: float, output_dir: Path, faces_cfg, suffix: str) -> list[str]:
    _edge_mm, _opening_mm, _frame_mm, physical_rects = physical_geometry(faces_cfg)
    outputs = []
    for face_id in FACE_ORDER:
        image = render_face(atlas, faces[face_id], scene, mount, depth, physical_rects[face_id], False)
        output = output_dir / f"preview-face-{face_id}-{suffix}-240.png"
        image.save(output)
        outputs.append(str(output))
    return outputs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--depth", type=float, default=0.35)
    parser.add_argument("--depth-label", help="suffix for review artifacts, such as surface, mid, or deep")
    parser.add_argument("--grid", action="store_true")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "output")
    args = parser.parse_args()
    atlas, faces_cfg, scene, _targets = load_pack(ROOT / "assets/generated")
    faces = {face_id: Face(face_id, tuple(item["normal"]), tuple(item["right"]), tuple(item["down"]))
             for face_id, item in ((item["id"], item) for item in faces_cfg["faces"])}
    identity_mount = quaternion_matrix((1.0, 0.0, 0.0, 0.0))
    diagonal_mount = quaternion_matrix(faces_cfg["mount_orientation"]["test_fixtures"]["cube_body_diagonal_upright_quaternion_wxyz"])
    suffix = args.depth_label or "default"
    if args.depth_label:
        net_path = args.output_dir / f"preview-six-face-net-{suffix}.png"
        assembled_path = args.output_dir / f"preview-six-face-assembled-{suffix}.png"
        corner_path = args.output_dir / f"preview-six-face-corner-upright-{suffix}.png"
        calibration_path = args.output_dir / f"preview-six-face-calibration-{suffix}.png"
        metadata_path = args.output_dir / f"preview-six-face-metadata-{suffix}.json"
    else:
        net_path = args.output_dir / "preview-six-face-net.png"
        assembled_path = args.output_dir / "preview-six-face-assembled.png"
        corner_path = args.output_dir / "preview-six-face-corner-upright.png"
        calibration_path = args.output_dir / "preview-six-face-calibration.png"
        metadata_path = args.output_dir / "preview-six-face-metadata.json"
    results = {
        "net": make_net(atlas, faces, scene, identity_mount, args.depth, args.grid,
                         net_path, faces_cfg),
        "assembled": make_assembled(atlas, faces, scene, identity_mount, args.depth, args.grid,
                                     assembled_path, faces_cfg,
                                     "identity test fixture"),
        "corner_upright": make_assembled(atlas, faces, scene, diagonal_mount, args.depth, args.grid,
                                          corner_path, faces_cfg,
                                          "corner-upright concept fixture (not confirmed mount)"),
        "calibration": make_calibration(calibration_path, faces_cfg),
    }
    results["face_samples_240"] = make_face_samples(atlas, faces, scene, identity_mount, args.depth,
                                                     args.output_dir, faces_cfg, suffix)
    results["depth_norm"] = args.depth
    results["depth_label"] = suffix
    metadata_path.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
