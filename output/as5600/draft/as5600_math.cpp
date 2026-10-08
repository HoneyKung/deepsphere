#include "as5600_math.h"

#include <cmath>

namespace As5600Math {

float normalizeDegrees(float degrees) {
  float result = std::fmod(degrees, kFullTurnDeg);
  if (result < 0.0f) result += kFullTurnDeg;
  return result;
}

float rawToDegrees(uint16_t raw) {
  return (static_cast<float>(raw & 0x0FFFu) * kFullTurnDeg) / kRawSteps;
}

float shortestDeltaDegrees(float previous, float current) {
  float result = std::fmod(current - previous + 540.0f, kFullTurnDeg) - 180.0f;
  if (result < -180.0f) result += kFullTurnDeg;
  return result;
}

float shortestDeltaRaw(uint16_t previous, uint16_t current) {
  float result = std::fmod(static_cast<float>(current & 0x0FFFu) - static_cast<float>(previous & 0x0FFFu) + kRawSteps / 2.0f,
                           kRawSteps) - kRawSteps / 2.0f;
  if (result < -kRawSteps / 2.0f) result += kRawSteps;
  return result;
}

float applyDeadband(float previous, float current, float deadbandDeg) {
  const float oldValue = normalizeDegrees(previous);
  const float newValue = normalizeDegrees(current);
  return std::fabs(shortestDeltaDegrees(oldValue, newValue)) <= deadbandDeg ? oldValue : newValue;
}

float calibrationSpanRaw(uint16_t rawMin, uint16_t rawMax, int direction) {
  const float minValue = static_cast<float>(rawMin & 0x0FFFu);
  const float maxValue = static_cast<float>(rawMax & 0x0FFFu);
  const float delta = direction == 1 ? maxValue - minValue : minValue - maxValue;
  return std::fmod(delta + kRawSteps, kRawSteps);
}

float wrapOffsetRaw(uint16_t rawMin, uint16_t rawMax, int direction) {
  const float minValue = static_cast<float>(rawMin & 0x0FFFu);
  const float maxValue = static_cast<float>(rawMax & 0x0FFFu);
  const float gap = direction == 1 ? minValue - maxValue : maxValue - minValue;
  return std::fmod((direction == 1 ? maxValue : minValue) + std::fmod(gap + kRawSteps, kRawSteps) / 2.0f + kRawSteps,
                   kRawSteps);
}

float wrapOffsetDegrees(uint16_t rawMin, uint16_t rawMax, int direction) {
  return wrapOffsetRaw(rawMin, rawMax, direction) * kFullTurnDeg / kRawSteps;
}

float applyWrapOffset(uint16_t raw, float offsetDeg) {
  return normalizeDegrees(rawToDegrees(raw) - offsetDeg);
}

float signedDegrees(float degrees) {
  return normalizeDegrees(degrees + 180.0f) - 180.0f;
}

float applyZero(float angleDeg, float zeroDeg) {
  return signedDegrees(angleDeg - zeroDeg);
}

CalibrationResult calibrateRawSamples(const uint16_t* samples, std::size_t count) {
  if (samples == nullptr || count < 2) return {false, 0, 0, 0, 0.0f};
  const uint16_t first = samples[0] & 0x0FFFu;
  uint16_t previous = first;
  uint16_t minimumRaw = first;
  uint16_t maximumRaw = first;
  float position = 0.0f;
  float minimumPosition = 0.0f;
  float maximumPosition = 0.0f;
  for (std::size_t i = 1; i < count; ++i) {
    const uint16_t current = samples[i] & 0x0FFFu;
    position += shortestDeltaRaw(previous, current);
    if (position < minimumPosition) {
      minimumPosition = position;
      minimumRaw = current;
    }
    if (position > maximumPosition) {
      maximumPosition = position;
      maximumRaw = current;
    }
    previous = current;
  }
  const int8_t direction = position > 0.0f ? 1 : position < 0.0f ? -1 : 0;
  const float span = maximumPosition - minimumPosition;
  if (direction > 0) return {span > 0.0f, minimumRaw, maximumRaw, direction, span};
  if (direction < 0) return {span > 0.0f, maximumRaw, minimumRaw, direction, span};
  return {false, first, previous, direction, span};
}

}
