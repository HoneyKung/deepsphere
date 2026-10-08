"""Compile and run the host-side C++ AS5600 math check with ziglang."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
BINARY = HERE / ("as5600_math_test.exe" if sys.platform == "win32" else "as5600_math_test")


def main() -> int:
    environment = os.environ.copy()
    environment["ZIG_GLOBAL_CACHE_DIR"] = str(ROOT / ".zig-global-cache")
    environment["ZIG_LOCAL_CACHE_DIR"] = str(ROOT / ".zig-local-cache")
    generate = [sys.executable, str(ROOT / "tools/make_as5600_vectors.py")]
    print("generate:", " ".join(generate))
    generated = subprocess.run(generate)
    if generated.returncode != 0:
        return generated.returncode
    sources = [HERE / "test_as5600_math.cpp", ROOT / "output/as5600/draft/as5600_math.cpp"]
    command = [sys.executable, "-m", "ziglang", "c++", "-std=c++17", "-O1", "-w",
               *map(str, sources), "-I", str(ROOT / "output/as5600/draft"), "-o", str(BINARY)]
    print("build:", " ".join(command))
    result = subprocess.run(command, env=environment)
    if result.returncode != 0:
        return result.returncode
    print("run:", BINARY)
    return subprocess.run([str(BINARY)]).returncode


if __name__ == "__main__":
    raise SystemExit(main())
