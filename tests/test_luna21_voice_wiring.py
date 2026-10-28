import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def test_manifest_paths_and_voice_line_coverage():
    manifest = json.loads((ROOT / "assets/audio/sound-manifest.json").read_text(encoding="utf-8"))
    for entry in manifest["voice"].values():
        paths = [entry] if isinstance(entry, str) else list(entry.values())
        for path in paths:
            assert (ROOT / "assets/audio" / path).is_file(), path
    for source_path, web_path in manifest["web"]["files"].items():
        assert (ROOT / "assets/audio" / source_path).is_file(), source_path
        assert (ROOT / "assets/audio/web" / web_path).is_file(), web_path
def test_gate_voice_runtime_behavior():
    result = subprocess.run(["node", str(ROOT / "tests/test_luna21_voice_behavior.cjs")],
                            cwd=ROOT, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stdout + result.stderr
