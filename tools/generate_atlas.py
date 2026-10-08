"""Compose the authoritative LUNA-04 ocean art into the device asset pack."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops

from atlas_math import quantize_rgb565, rgb565_bytes


ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 1024, 512


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_composition() -> tuple[dict, dict]:
    scene = read_json(ROOT / "config/scene.json")
    composition_path = ROOT / scene["composition_file"]
    composition = read_json(composition_path)
    if tuple(composition["output_size"]) != (WIDTH, HEIGHT):
        raise ValueError("LUNA-04 composition output_size must remain 1024x512")
    return scene, composition


def compose_atlas(composition: dict) -> tuple[Image.Image, Path]:
    source_path = ROOT / composition["source_art"]
    source = Image.open(source_path).convert("RGB")
    image = source.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    shift = int(composition.get("horizontal_shift_px", 0)) % WIDTH
    if shift:
        image = ImageChops.offset(image, shift, 0)
    return image, source_path


def build_targets(composition: dict) -> dict:
    targets = []
    for subject in composition["subjects"]:
        cx, cy = (float(value) for value in subject["center_px"])
        cx = (cx + int(composition.get("horizontal_shift_px", 0))) % WIDTH
        width, height = (float(value) for value in subject["size_px"])
        left, right = cx - width / 2.0, cx + width / 2.0
        top, bottom = cy - height / 2.0, cy + height / 2.0
        if not 0.0 <= cy <= HEIGHT or width <= 0.0 or height <= 0.0:
            raise ValueError(f"invalid subject bounds: {subject['target_id']}")
        targets.append({
            "target_id": subject["target_id"],
            "u": (cx % WIDTH) / WIDTH,
            "v": cy / HEIGHT,
            "w": width / WIDTH,
            "h": height / HEIGHT,
            "label": subject["label"],
            "band": subject["band"],
            "source_bounds_px": {"left": left, "top": top, "right": right, "bottom": bottom},
            "wraps_horizontal": left < 0.0 or right > WIDTH,
        })
    return {"schema_version": 2, "data_status": "illustrated_luna04_subject_metadata", "targets": targets}


def build_pack(output_dir: Path, debug: bool = False) -> dict:
    del debug
    output_dir.mkdir(parents=True, exist_ok=True)
    scene, composition = load_composition()
    image, source_path = compose_atlas(composition)
    targets = build_targets(composition)
    scene_config = read_json(ROOT / "config/scene.json")
    if scene_config["atlas"]["width"] != WIDTH or scene_config["atlas"]["height"] != HEIGHT:
        raise ValueError("scene.json atlas dimensions do not match generator dimensions")

    # Quantize once. Both laptop PNG and board bytes are derived from these same pixels.
    pixels = image.load()
    for y in range(HEIGHT):
        for x in range(WIDTH):
            pixels[x, y] = quantize_rgb565(pixels[x, y])
    rgb_bytes = b"".join(rgb565_bytes(image.getpixel((x, y))) for y in range(HEIGHT) for x in range(WIDTH))
    canonical_targets = json.dumps(targets, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    digest = hashlib.sha256(rgb_bytes + canonical_targets).hexdigest()
    pack_id = scene["asset_pack_id"]
    image_path = output_dir / "sea_atlas.png"
    rgb_path = output_dir / "sea_atlas_rgb565_be.bin"
    image.save(image_path, "PNG", optimize=False)
    rgb_path.write_bytes(rgb_bytes)
    targets_text = json.dumps(targets, ensure_ascii=False, indent=2) + "\n"
    (ROOT / "assets/source/targets.json").write_text(targets_text, encoding="utf-8")
    (output_dir / "targets.json").write_text(targets_text, encoding="utf-8")

    target_lines = ["#pragma once", "", '#include "math/cube_math.h"', "", "namespace GeneratedAssets {", "", "// Generated from assets/source/sea_atlas_luna04_composition.json.", "constexpr CubeMath::Target kTargets[] = {"]
    for target in targets["targets"]:
        target_lines.append(f'  {{"{target["target_id"]}", {target["u"]}f, {target["v"]}f, {target["w"]}f, {target["h"]}f}},')
    target_lines.extend(["};", "constexpr size_t kTargetCount = sizeof(kTargets) / sizeof(kTargets[0]);", "", "}", ""])
    (ROOT / "firmware/include/targets_generated.h").write_text("\n".join(target_lines), encoding="utf-8")

    composition_path = ROOT / scene["composition_file"]
    manifest = {
        "schema_version": 2,
        "asset_pack": pack_id,
        "content": "LUNA-04 original illustrated ocean panorama",
        "width": WIDTH,
        "height": HEIGHT,
        "pixel_format": "RGB565",
        "byte_order": "big_endian",
        "rgb565_bytes": len(rgb_bytes),
        "package_sha256": digest,
        "sha256_rgb565": hashlib.sha256(rgb_bytes).hexdigest(),
        "targets_sha256": hashlib.sha256(canonical_targets).hexdigest(),
        "source_art": str(source_path.relative_to(ROOT)).replace("\\", "/"),
        "source_composition": str(composition_path.relative_to(ROOT)).replace("\\", "/"),
        "conversion": composition["conversion"],
        "metadata_status": "illustrated_subject_metadata",
        "subject_count": len(targets["targets"]),
    }
    (output_dir / "pack.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "assets/generated")
    parser.add_argument("--debug", action="store_true", help="retained for CLI compatibility; shipping art has no overlays")
    args = parser.parse_args()
    print(json.dumps(build_pack(args.output, args.debug), indent=2))


if __name__ == "__main__":
    main()
