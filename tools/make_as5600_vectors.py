"""Generate the C++ AS5600 vector header from the JSON source of truth."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tests/vectors/as5600_math_vectors.json"
DESTINATION = ROOT / "tests/native/as5600_vectors_generated.h"


def f(value: float) -> str:
    text = f"{float(value):.12g}"
    if "." not in text and "e" not in text.lower():
        text += ".0"
    return text + "f"


def generate() -> None:
    vectors = json.loads(SOURCE.read_text(encoding="utf-8"))
    lines = ["#pragma once", "", "#include <cstdint>", "#include <cstddef>", "", "namespace As5600Vectors {", ""]
    lines.extend([
        "struct RawVector { unsigned raw; float degrees; };",
        "constexpr RawVector kRaw[] = {",
        *[f"  {{{item['raw']}u, {f(item['degrees'])}}}," for item in vectors["raw_to_degrees"]],
        "};", "",
        "struct DeadbandVector { float previous; float current; float deadband; float expected; };",
        "constexpr DeadbandVector kDeadband[] = {",
        *[f"  {{{f(item['previous'])}, {f(item['current'])}, {f(item['deadband'])}, {f(item['expected'])}}}," for item in vectors["deadband"]],
        "};", "",
        "struct CalibrationVector { unsigned rawMin; unsigned rawMax; int direction; float spanRaw; float offsetRaw; float offsetDeg; };",
        "constexpr CalibrationVector kCalibration[] = {",
        *[f"  {{{item['raw_min']}u, {item['raw_max']}u, {item['direction']}, {f(item['span_raw'])}, {f(item['offset_raw'])}, {f(item['offset_deg'])}}}," for item in vectors["calibration"]],
        "};", "",
        "struct MappingVector { unsigned raw; float offsetDeg; float expected; };",
        "constexpr MappingVector kMapping[] = {",
        *[f"  {{{item['raw']}u, {f(item['offset_deg'])}, {f(item['expected'])}}}," for item in vectors["wrap_mapping"]],
        "};", "",
        "struct ZeroVector { float angle; float zero; float expected; };",
        "constexpr ZeroVector kZero[] = {",
        *[f"  {{{f(item['angle'])}, {f(item['zero'])}, {f(item['expected'])}}}," for item in vectors["zero"]],
        "};", "",
        "struct CalibrationSequenceVector { const uint16_t* samples; std::size_t count; uint16_t rawMin; uint16_t rawMax; int direction; float spanRaw; };",
        *[f"constexpr uint16_t kCalibrationSamples{index}[] = {{{', '.join(str(value) + 'u' for value in item['samples'])}}};" for index, item in enumerate(vectors["calibration_sequences"])],
        "constexpr CalibrationSequenceVector kCalibrationSequences[] = {",
        *[f"  {{kCalibrationSamples{index}, sizeof(kCalibrationSamples{index}) / sizeof(uint16_t), {item['raw_min']}u, {item['raw_max']}u, {item['direction']}, {f(item['span_raw'])}}}," for index, item in enumerate(vectors["calibration_sequences"])],
        "};", "",
        "}", "",
    ])
    DESTINATION.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    generate()
