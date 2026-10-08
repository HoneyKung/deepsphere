"""Render a six-face preview from the same math used by firmware tests."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

from atlas_math import (Face, aim_projection, background_uv, direction_for_face_pixel,
                        face_uv_from_pixel, faces_from_config, hit_target, quaternion_matrix, sample_pillow)

ROOT = Path(__file__).resolve().parents[1]


def load_pack(pack_dir: Path):
    image = Image.open(pack_dir / "sea_atlas.png").convert("RGB")
    faces_cfg = json.loads((ROOT / "config/faces.json").read_text(encoding="utf-8"))
    scene = json.loads((ROOT / "config/scene.json").read_text(encoding="utf-8"))
    targets = json.loads((ROOT / "assets/source/targets.json").read_text(encoding="utf-8"))["targets"]
    return image, faces_cfg, scene, targets


def render_face(atlas, face: Face, scene, mount, depth: float, physical, debug: bool) -> Image.Image:
    out = Image.new("RGB", (240, 240), (3, 11, 24))
    for y in range(240):
        local_v = y / 240.0
        for x in range(240):
            local_u = x / 240.0
            face_u, face_v = face_uv_from_pixel((local_u, local_v), physical)
            if 0.0 <= face_u <= 1.0 and 0.0 <= face_v <= 1.0:
                uv = background_uv(direction_for_face_pixel(face, face_u, face_v, mount), depth, scene)
                out.putpixel((x, y), sample_pillow(atlas, uv))
    if debug:
        draw = ImageDraw.Draw(out)
        for x in range(0, 240, 40):
            draw.line((x, 0, x, 239), fill=(220, 250, 250), width=1)
        for y in range(0, 240, 40):
            draw.line((0, y, 239, y), fill=(220, 250, 250), width=1)
    return out


def sweep(args) -> None:
    """A set of check frames across a whole turn, for spotting a reticle that jumps."""
    folder = args.output.parent / "preview-sweep"
    folder.mkdir(parents=True, exist_ok=True)
    for index in range(args.sweep):
        args.yaw = index * 360.0 / args.sweep
        args.output = folder / f"yaw-{args.yaw:06.2f}.png"
        render(args)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pack", type=Path, default=ROOT / "assets/generated")
    parser.add_argument("--yaw", type=float, default=0.0)
    parser.add_argument("--depth", type=float, default=0.35)
    parser.add_argument("--grid", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "output/preview-six-faces.png")
    parser.add_argument("--sweep", type=int, default=0,
                        help="write this many frames of a full turn into --output's folder")
    args = parser.parse_args()
    if args.sweep:
        sweep(args)
        return
    render(args)


def render(args) -> None:
    atlas, faces_cfg, scene, targets = load_pack(args.pack)
    faces = faces_from_config(faces_cfg)
    mount = quaternion_matrix(faces_cfg["mount_orientation"]["quaternion_wxyz"])
    active = faces_cfg.get("active_image", {"left": 0.0, "top": 0.0, "right": 1.0, "bottom": 1.0})
    physical_rects = {item["id"]: item["physical_face_uv"] for item in faces_cfg["faces"]}
    enabled_faces = set(faces_cfg.get("enabled_outputs", {}).get("faces", []))
    canvas = Image.new("RGB", (720, 600), (5, 12, 25))
    draw = ImageDraw.Draw(canvas)
    for index, face_id in enumerate(("px", "nx", "py", "ny", "pz", "nz")):
        x, y = (index % 3) * 240, (index // 3) * 290
        canvas.paste(render_face(atlas, faces[face_id], scene, mount, args.depth, physical_rects[face_id], args.grid), (x, y))
        draw.text((x + 8, y + 244), f"{face_id}  yaw={args.yaw:.1f} depth={args.depth:.2f}", fill=(224, 245, 245))
    projection = aim_projection(args.yaw, tuple(scene["aim_world"]), mount, faces, active, args.depth, scene,
                                physical_rects=physical_rects, pixel_mask=faces_cfg.get("display_pixel_mask"),
                                enabled_faces=enabled_faces)
    target = hit_target(projection, targets)
    if projection["visible"]:
        face_index = ("px", "nx", "py", "ny", "pz", "nz").index(projection["face_id"])
        x, y = (face_index % 3) * 240, (face_index // 3) * 290
        rx, ry = projection["pixel_uv"][0] * 240, projection["pixel_uv"][1] * 240
        draw.line((x + rx - 7, y + ry, x + rx + 7, y + ry), fill=(255, 80, 100), width=2)
        draw.line((x + rx, y + ry - 7, x + rx, y + ry + 7), fill=(255, 80, 100), width=2)
    draw.text((8, 578), f"reticle: {'hidden in bezel gap' if not projection['visible'] else projection['face_id']}"
                       f"   atlas_uv=({projection['atlas_uv'][0]:.4f}, {projection['atlas_uv'][1]:.4f})"
                       f"   target={target['target_id'] if target else 'none'}", fill=(224, 245, 245))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.output)
    print(json.dumps({"output": str(args.output), "reticle": projection,
                      "target_id": target["target_id"] if target else None}, indent=2))


if __name__ == "__main__":
    main()
