"""Pure AS5600 angle math shared by host tools and firmware test vectors.

The sensor reports a 12-bit electrical angle.  Calibration treats the increasing
raw-angle arc from ``raw_min`` to ``raw_max`` as the usable arc; the midpoint of
the complementary gap becomes the new wrap point.  The direction argument is
explicit because two extrema alone cannot tell which circular arc was swept.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

RAW_STEPS = 4096
FULL_TURN_DEG = 360.0


def normalize_raw(raw: int | float) -> float:
    return float(raw) % RAW_STEPS


def normalize_degrees(degrees: float) -> float:
    return float(degrees) % FULL_TURN_DEG


def raw_to_degrees(raw: int | float) -> float:
    return normalize_raw(raw) * FULL_TURN_DEG / RAW_STEPS


def shortest_delta_degrees(previous: float, current: float) -> float:
    """Return current - previous in the half-open interval [-180, 180)."""
    return (float(current) - float(previous) + 180.0) % FULL_TURN_DEG - 180.0


def shortest_delta_raw(previous: int | float, current: int | float) -> float:
    """Return current - previous in raw counts, in [-2048, 2048)."""
    return (normalize_raw(current) - normalize_raw(previous) + RAW_STEPS / 2.0) % RAW_STEPS - RAW_STEPS / 2.0


def apply_deadband(previous: float, current: float, deadband_deg: float = 0.15) -> float:
    """Keep the previous value for small circular changes; never invent a value."""
    if deadband_deg < 0:
        raise ValueError("deadband_deg must be non-negative")
    previous = normalize_degrees(previous)
    current = normalize_degrees(current)
    return previous if abs(shortest_delta_degrees(previous, current)) <= deadband_deg else current


def calibration_span_raw(raw_min: int, raw_max: int, direction: int = 1) -> float:
    """Return the calibrated arc length in raw counts for the chosen sweep direction."""
    if direction not in (-1, 1):
        raise ValueError("direction must be 1 or -1")
    raw_min = normalize_raw(raw_min)
    raw_max = normalize_raw(raw_max)
    if direction == 1:
        return (raw_max - raw_min) % RAW_STEPS
    return (raw_min - raw_max) % RAW_STEPS


def wrap_offset_raw(raw_min: int, raw_max: int, direction: int = 1) -> float:
    """Return the raw-count position of the wrap point, placed in the unused gap."""
    if direction not in (-1, 1):
        raise ValueError("direction must be 1 or -1")
    raw_min = normalize_raw(raw_min)
    raw_max = normalize_raw(raw_max)
    if direction == 1:
        gap = (raw_min - raw_max) % RAW_STEPS
        midpoint = raw_max + gap / 2.0
    else:
        gap = (raw_max - raw_min) % RAW_STEPS
        midpoint = raw_min + gap / 2.0
    return normalize_raw(midpoint)


def wrap_offset_degrees(raw_min: int, raw_max: int, direction: int = 1) -> float:
    return raw_to_degrees(wrap_offset_raw(raw_min, raw_max, direction))


def apply_wrap_offset(raw: int | float, offset_deg: float) -> float:
    """Move the calibrated wrap point to 0 degrees and return an absolute angle."""
    return normalize_degrees(raw_to_degrees(raw) - float(offset_deg))


def signed_degrees(degrees: float) -> float:
    """Normalize an angle to the half-open interval [-180, 180)."""
    return (float(degrees) + 180.0) % FULL_TURN_DEG - 180.0


def apply_zero(angle_deg: float, zero_deg: float) -> float:
    return signed_degrees(float(angle_deg) - float(zero_deg))


@dataclass(frozen=True)
class CalibrationResult:
    valid: bool
    raw_min: int
    raw_max: int
    direction: int
    span_raw: float


def calibrate_raw_samples(samples: list[int | float]) -> CalibrationResult:
    """Unwrap a calibration sweep and return direction-aware endpoint registers.

    ``raw_min`` and ``raw_max`` are endpoint names for the selected direction,
    not numeric extrema.  For direction +1 they are the low/high unwrapped
    endpoints; for direction -1 they are ordered for the decreasing arc so the
    existing wrap-offset functions can consume them directly.
    """
    if len(samples) < 2:
        return CalibrationResult(False, 0, 0, 0, 0.0)
    first = int(normalize_raw(samples[0]))
    previous = first
    position = 0.0
    minimum_position = 0.0
    maximum_position = 0.0
    minimum_raw = first
    maximum_raw = first
    for value in samples[1:]:
        current = int(normalize_raw(value))
        position += shortest_delta_raw(previous, current)
        if position < minimum_position:
            minimum_position, minimum_raw = position, current
        if position > maximum_position:
            maximum_position, maximum_raw = position, current
        previous = current
    direction = 1 if position > 0.0 else -1 if position < 0.0 else 0
    span = maximum_position - minimum_position
    if direction == 1:
        raw_min, raw_max = minimum_raw, maximum_raw
    elif direction == -1:
        raw_min, raw_max = maximum_raw, minimum_raw
    else:
        raw_min, raw_max = first, previous
    return CalibrationResult(direction != 0 and span > 0.0, raw_min, raw_max, direction, span)


def population_sd(values: list[float]) -> float:
    if not values:
        return math.nan
    mean = sum(values) / len(values)
    return math.sqrt(sum((value - mean) ** 2 for value in values) / len(values))
