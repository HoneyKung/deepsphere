#pragma once

#include <cstdint>
#include <cstddef>

namespace As5600Math {

constexpr float kRawSteps = 4096.0f;
constexpr float kFullTurnDeg = 360.0f;

struct CalibrationResult {
  bool valid;
  uint16_t rawMin;
  uint16_t rawMax;
  int8_t direction;
  float spanRaw;
};

float normalizeDegrees(float degrees);
float rawToDegrees(uint16_t raw);
float shortestDeltaDegrees(float previous, float current);
float shortestDeltaRaw(uint16_t previous, uint16_t current);
float applyDeadband(float previous, float current, float deadbandDeg = 0.15f);
float calibrationSpanRaw(uint16_t rawMin, uint16_t rawMax, int direction = 1);
float wrapOffsetRaw(uint16_t rawMin, uint16_t rawMax, int direction = 1);
float wrapOffsetDegrees(uint16_t rawMin, uint16_t rawMax, int direction = 1);
float applyWrapOffset(uint16_t raw, float offsetDeg);
float signedDegrees(float degrees);
float applyZero(float angleDeg, float zeroDeg);
CalibrationResult calibrateRawSamples(const uint16_t* samples, std::size_t count);

}
