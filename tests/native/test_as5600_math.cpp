#include <cmath>
#include <cstdio>

#include "as5600_math.h"
#include "as5600_vectors_generated.h"

using namespace As5600Math;

namespace {

int failures = 0;
int checks = 0;
constexpr float tolerance = 0.0002f;

void expectNear(const char* label, float actual, float expected) {
  ++checks;
  if (std::fabs(actual - expected) > tolerance) {
    std::printf("FAIL %s: got %.7f want %.7f\n", label, actual, expected);
    ++failures;
  }
}

void runVectors() {
  for (const auto& vector : As5600Vectors::kRaw) expectNear("raw", rawToDegrees(vector.raw), vector.degrees);
  for (const auto& vector : As5600Vectors::kDeadband) {
    expectNear("deadband", applyDeadband(vector.previous, vector.current, vector.deadband), vector.expected);
  }
  for (const auto& vector : As5600Vectors::kCalibration) {
    expectNear("span", calibrationSpanRaw(vector.rawMin, vector.rawMax, vector.direction), vector.spanRaw);
    expectNear("offset_raw", wrapOffsetRaw(vector.rawMin, vector.rawMax, vector.direction), vector.offsetRaw);
    expectNear("offset_deg", wrapOffsetDegrees(vector.rawMin, vector.rawMax, vector.direction), vector.offsetDeg);
  }
  for (const auto& vector : As5600Vectors::kMapping) {
    expectNear("mapping", applyWrapOffset(vector.raw, vector.offsetDeg), vector.expected);
  }
  for (const auto& vector : As5600Vectors::kZero) {
    expectNear("zero", applyZero(vector.angle, vector.zero), vector.expected);
  }
  for (const auto& vector : As5600Vectors::kCalibrationSequences) {
    const CalibrationResult result = calibrateRawSamples(vector.samples, vector.count);
    ++checks;
    if (!result.valid || result.rawMin != vector.rawMin || result.rawMax != vector.rawMax ||
        result.direction != vector.direction) {
      std::printf("FAIL calibration endpoints: got %u,%u,%d want %u,%u,%d\n",
                  result.rawMin, result.rawMax, result.direction,
                  vector.rawMin, vector.rawMax, vector.direction);
      ++failures;
    }
    expectNear("calibration span", result.spanRaw, vector.spanRaw);
    expectNear("calibration arc", calibrationSpanRaw(result.rawMin, result.rawMax, result.direction), vector.spanRaw);
  }
}

}

int main() {
  runVectors();
  std::printf("%s: %d checks, %d failures\n", failures == 0 ? "PASS" : "FAIL", checks, failures);
  return failures == 0 ? 0 : 1;
}
