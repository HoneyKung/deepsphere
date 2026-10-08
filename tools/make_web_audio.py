"""Make compressed copies of the sounds the twin plays, for the hosted web page.

    python tools/make_web_audio.py

The originals in assets/audio are never touched. Each file the manifest refers to gets an MP3 copy under
assets/audio/web/ (same relative path), and the manifest gains a "web" map that the twin tries first. MP3 is used
because every phone browser decodes it and the originals together are far too large to load over mobile data.
Very short sounds stay as they are: MP3 padding would smear a click.
"""
import json
import os

import numpy as np
import soundfile as sf

AUDIO = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "assets", "audio"))
WEB = "web"
MIN_SECONDS = 1.0
QUALITY = 0.35  # libsndfile MP3 compression level: 0 = largest/best, 1 = smallest


def referenced(manifest):
    paths = []
    for record in manifest["sfx"].values():
        paths += record["files"]
    for piece in manifest["music"].values():
        paths += [piece["files"][layer] for layer in ("pad", "lead", "motion", "sparkle") if piece["files"].get(layer)]
    paths += list(manifest.get("bridges", {}).values())
    for group in ("voice", "voice_names"):
        for entry in manifest.get(group, {}).values():
            paths += [entry] if isinstance(entry, str) else [v for v in entry.values() if v]
    seen, unique = set(), []
    for path in paths:
        if path not in seen:
            seen.add(path)
            unique.append(path)
    return unique


def main():
    manifest_path = os.path.join(AUDIO, "sound-manifest.json")
    with open(manifest_path, encoding="utf-8") as handle:
        manifest = json.load(handle)
    files, before, after, kept = {}, 0, 0, 0
    for path in referenced(manifest):
        source = os.path.join(AUDIO, path)
        if not os.path.exists(source):
            print("missing:", path)
            continue
        info = sf.info(source)
        size = os.path.getsize(source)
        if info.duration < MIN_SECONDS:
            kept += size
            continue
        copy = os.path.splitext(path)[0] + ".mp3"
        target = os.path.join(AUDIO, WEB, copy)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        data, rate = sf.read(source, dtype="float32", always_2d=True)
        peak = float(np.abs(data).max()) if len(data) else 0.0
        if peak > 0.98:
            data = data * (0.98 / peak)  # leave headroom so the encoder does not clip
        with sf.SoundFile(target, "w", rate, data.shape[1], format="MP3", subtype="MPEG_LAYER_III",
                          compression_level=QUALITY) as out:
            for start in range(0, len(data), rate):  # one second at a time; long single writes crash the encoder
                out.write(data[start:start + rate])
        files[path] = copy
        before += size
        after += os.path.getsize(target)
    manifest["web"] = {"dir": WEB + "/", "files": files,
                       "note": "Compressed copies of the same recordings for the hosted page; made by tools/make_web_audio.py"}
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=1)
    print("copies: %d  originals %.1f MB -> web %.1f MB  (+ %.2f MB of short sounds left as they are)"
          % (len(files), before / 1e6, after / 1e6, kept / 1e6))


if __name__ == "__main__":
    main()
