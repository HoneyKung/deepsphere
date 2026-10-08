"""Compile and run the firmware math against the shared test vectors on this machine.

PlatformIO's native platform needs a system compiler, which this machine does not have, so
the tests are built with the pip-installable zig toolchain instead. Install it with
`pip install ziglang`; the exact commands used are printed before each build runs.

Two binaries: cube_math_test pins the cube geometry, and live_ocean_test runs the live-ocean
motion, sprite, background, dirty-rectangle and crop code the board uses.
"""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def build_and_run(name: str, sources: list[Path]) -> int:
    binary = HERE / (name + (".exe" if sys.platform == "win32" else ""))
    command = [sys.executable, "-m", "ziglang", "c++", "-std=c++17", "-O1", "-w", *map(str, sources),
               "-I", str(ROOT / "firmware/src"), "-I", str(ROOT / "firmware/include"), "-I", str(HERE),
               "-o", str(binary)]
    print("build:", " ".join(command))
    build = subprocess.run(command)
    if build.returncode != 0:
        return build.returncode
    print("run:", binary)
    return subprocess.run([str(binary)]).returncode


def main() -> int:
    math_source = ROOT / "firmware/src/math/cube_math.cpp"
    results = [build_and_run("cube_math_test", [HERE / "test_cube_math.cpp", math_source]),
               build_and_run("live_ocean_test", [HERE / "test_live_ocean.cpp", math_source])]
    return 0 if all(code == 0 for code in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
