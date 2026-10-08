#pragma once

#include <cstdint>
#include <cstddef>

namespace As5600Vectors {

struct RawVector { unsigned raw; float degrees; };
constexpr RawVector kRaw[] = {
  {0u, 0.0f},
  {1u, 0.087890625f},
  {2048u, 180.0f},
  {4095u, 359.912109375f},
  {8191u, 359.912109375f},
};

struct DeadbandVector { float previous; float current; float deadband; float expected; };
constexpr DeadbandVector kDeadband[] = {
  {10.0f, 10.1f, 0.15f, 10.0f},
  {359.9f, 0.1f, 0.25f, 359.9f},
  {359.9f, 0.5f, 0.25f, 0.5f},
  {180.0f, 179.7f, 0.15f, 179.7f},
};

struct CalibrationVector { unsigned rawMin; unsigned rawMax; int direction; float spanRaw; float offsetRaw; float offsetDeg; };
constexpr CalibrationVector kCalibration[] = {
  {512u, 3584u, 1, 3072.0f, 0.0f, 0.0f},
  {1024u, 4095u, 1, 3071.0f, 511.5f, 44.9560546875f},
  {3584u, 512u, -1, 3072.0f, 0.0f, 0.0f},
};

struct MappingVector { unsigned raw; float offsetDeg; float expected; };
constexpr MappingVector kMapping[] = {
  {512u, 0.0f, 45.0f},
  {4095u, 44.9560546875f, 314.956054688f},
  {0u, 44.9560546875f, 315.043945312f},
};

struct ZeroVector { float angle; float zero; float expected; };
constexpr ZeroVector kZero[] = {
  {12.5f, 12.5f, 0.0f},
  {2.0f, 359.0f, 3.0f},
  {359.0f, 1.0f, -2.0f},
  {180.0f, 0.0f, -180.0f},
  {-180.0f, 0.0f, -180.0f},
};

struct CalibrationSequenceVector { const uint16_t* samples; std::size_t count; uint16_t rawMin; uint16_t rawMax; int direction; float spanRaw; };
constexpr uint16_t kCalibrationSamples0[] = {3800u, 3900u, 4000u, 4090u, 50u, 200u, 500u, 900u, 1300u, 1700u, 2100u, 2500u, 2870u};
constexpr uint16_t kCalibrationSamples1[] = {300u, 200u, 100u, 0u, 4000u, 3500u, 3100u};
constexpr CalibrationSequenceVector kCalibrationSequences[] = {
  {kCalibrationSamples0, sizeof(kCalibrationSamples0) / sizeof(uint16_t), 3800u, 2870u, 1, 3166.0f},
  {kCalibrationSamples1, sizeof(kCalibrationSamples1) / sizeof(uint16_t), 300u, 3100u, -1, 1296.0f},
};

}
