"""Render an early animated preview of the same deterministic live-ocean scene."""

from __future__ import annotations

from pathlib import Path
import sys

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import live_ocean


def main() -> None:
    output = ROOT / "output"
    output.mkdir(parents=True, exist_ok=True)
    frames = []
    snapshots = {}
    ticks = (0, 20, 40, 70, 100, 120, 126, 140)
    for tick in ticks:
        frame = Image.new("RGB", (720, 480), (3, 16, 28))
        for index, face_id in enumerate(("px", "nx", "py", "ny", "pz", "nz")):
            face = live_ocean.render_live_crop({"face_id": face_id, "u": 0.2, "v": 0.2, "w": 0.6, "h": 0.6},
                                                0.35, tick, width=240, height=240)
            x, y = (index % 3) * 240, (index // 3) * 240
            frame.paste(face, (x, y))
            label = "nz ABSENT" if face_id == "nz" else face_id
            ImageDraw.Draw(frame).text((x + 8, y + 8), label, fill=(235, 245, 245))
        draw = ImageDraw.Draw(frame)
        draw.rectangle((12, 12, 285, 36), fill=(3, 16, 28))
        draw.text((20, 18), f"CUBE SURFACE  tick={tick:03d}  opening=.2..8", fill=(230, 245, 245))
        frames.append(frame)
        if tick in (0, 40, 70, 140):
            snapshots[tick] = frame.copy()
    frames[0].save(output / "preview-live-ocean.gif", save_all=True, append_images=frames[1:],
                   duration=180, loop=0, optimize=False)
    montage = Image.new("RGB", (720, 1920), (3, 16, 28))
    for row, tick in enumerate((0, 40, 70, 140)):
        montage.paste(snapshots[tick], (0, row * 480))
        ImageDraw.Draw(montage).text((500, row * 480 + 18),
                                     {0: "BEFORE", 40: "AT EDGE", 70: "NZ ABSENT", 140: "REAPPEAR"}[tick],
                                     fill=(235, 245, 245))
    montage.save(output / "preview-live-ocean-crossing.png")
    print(f"wrote {output / 'preview-live-ocean.gif'} and crossing montage ({len(frames)} frames)")


if __name__ == "__main__":
    main()
