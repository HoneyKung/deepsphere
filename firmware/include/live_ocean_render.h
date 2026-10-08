#pragma once

// Pixel, hit, dirty-rectangle and crop rules for the live ocean. Pure functions with no Arduino
// dependency, so tests/native runs the exact code the board runs. Mirrors tools/live_ocean.py
// line for line; tests/native/test_live_ocean.cpp checks the two against shared vectors.

#include <math.h>
#include <stdint.h>

#include "live_ocean_generated.h"
#include "live_ocean_motion.h"
#include "math/cube_math.h"

namespace LiveOcean {

constexpr int16_t kDirtyMarginPx = 2;
constexpr int16_t kCropPadPx = 3;
constexpr float kWaveFrequency = 31.4159265f;
constexpr float kGrainCells = 240.0f;

struct Rect {
  int16_t x0;
  int16_t y0;
  int16_t x1;  // exclusive
  int16_t y1;  // exclusive
  bool valid;
};

struct Crop {
  int16_t x;
  int16_t y;
  int16_t side;
};

inline Pose initialPose(uint8_t index) {
  const SubjectSpec& spec = kSubjects[index];
  Pose pose;
  pose.face = spec.face;
  pose.u = spec.u;
  pose.v = spec.v;
  pose.du = spec.du;
  pose.dv = spec.dv;
  return pose;
}

// 0 = +u, 1 = +v, 2 = -u, 3 = -v. Motion is always cardinal, so float dust never flips an axis.
inline uint8_t cardinalHeading(float du, float dv) {
  if (fabsf(du) >= fabsf(dv)) return du >= 0.0f ? 0 : 2;
  return dv >= 0.0f ? 1 : 3;
}

// Inverse of the quarter-turn heading: face offset to sprite frame, exactly, with no trig.
inline void toSpriteFrame(uint8_t heading, float dx, float dy, float& x, float& y) {
  switch (heading) {
    case 0: x = dx; y = dy; break;
    case 1: x = dy; y = -dx; break;
    case 2: x = -dx; y = -dy; break;
    default: x = -dy; y = dx; break;
  }
}

// Face-unit width and height the sprite covers on its face; a quarter turn swaps them.
inline void rotatedExtent(uint8_t index, const Pose& pose, float& width, float& height) {
  const SubjectSpec& spec = kSubjects[index];
  if (cardinalHeading(pose.du, pose.dv) & 1U) {
    width = spec.h;
    height = spec.w;
  } else {
    width = spec.w;
    height = spec.h;
  }
}

inline bool spriteOpaque(uint8_t index, const Pose& pose, float u, float v) {
  const SubjectSpec& spec = kSubjects[index];
  float x = 0.0f;
  float y = 0.0f;
  toSpriteFrame(cardinalHeading(pose.du, pose.dv), u - pose.u, v - pose.v, x, y);
  // floorf, not a cast: a cast truncates negative coordinates towards zero and shifts a column.
  const int col = static_cast<int>(floorf((x / spec.w + 0.5f) * 8.0f));
  const int row = static_cast<int>(floorf((y / spec.h + 0.5f) * 8.0f));
  if (col < 0 || col > 7 || row < 0 || row > 7) return false;
  return (kSpriteMasks[spec.kind][row] & (1U << (7 - col))) != 0;
}

// Index of the subject drawn at a face point, or -1. The lowest index is on top on both hosts,
// and the same answer decides the pixel colour and the scan hit.
inline int subjectAt(const Pose* poses, uint8_t face, float u, float v) {
  for (uint8_t i = 0; i < kSubjectCount; ++i) {
    if (poses[i].face == face && spriteOpaque(i, poses[i], u, v)) return i;
  }
  return -1;
}

inline float clampUnit(float value) { return value < 0.0f ? 0.0f : (value > 1.0f ? 1.0f : value); }

inline float hash01(uint32_t x, uint32_t y) {
  uint32_t value = x * 374761393u + y * 668265263u + kSeed;
  value ^= value >> 13;
  value *= 1274126177u;
  return static_cast<float>((value ^ (value >> 16)) & 0xFFFFu) / 65535.0f;
}

// Top and bottom colours for a depth, linear between the configured keyframes.
inline void gradientEnds(float depth, float top[3], float bottom[3]) {
  depth = clampUnit(depth);
  for (uint8_t k = 0; k + 1 < kBackgroundKeyCount; ++k) {
    const BackgroundKey& lower = kBackgroundKeys[k];
    const BackgroundKey& upper = kBackgroundKeys[k + 1];
    if (depth <= upper.depth) {
      const float span = upper.depth - lower.depth;
      const float t = span <= 0.0f ? 0.0f : (depth - lower.depth) / span;
      for (uint8_t c = 0; c < 3; ++c) {
        top[c] = lower.top[c] + static_cast<float>(upper.top[c] - lower.top[c]) * t;
        bottom[c] = lower.bottom[c] + static_cast<float>(upper.bottom[c] - lower.bottom[c]) * t;
      }
      return;
    }
  }
  const BackgroundKey& last = kBackgroundKeys[kBackgroundKeyCount - 1];
  for (uint8_t c = 0; c < 3; ++c) {
    top[c] = last.top[c];
    bottom[c] = last.bottom[c];
  }
}

// Where a face point sits in the water gradient. It has no depth or time input, so the board can
// compute it once per panel pixel and keep it.
inline float backgroundMix(float u, float v) {
  u = clampUnit(u);
  v = clampUnit(v);
  const float wave = 0.5f + 0.5f * sinf(u * kWaveFrequency + sinf(v * 9.0f));
  const float grain = hash01(static_cast<uint32_t>(u * kGrainCells), static_cast<uint32_t>(v * kGrainCells)) * 0.14f;
  return clampUnit(v * 0.78f + wave * 0.18f + grain);
}

// Channels round half up, as in tools/live_ocean.py.
inline void mixRgb(const float top[3], const float bottom[3], float mix, uint8_t rgb[3]) {
  for (uint8_t c = 0; c < 3; ++c) {
    rgb[c] = static_cast<uint8_t>(floorf(top[c] * (1.0f - mix) + bottom[c] * mix + 0.5f));
  }
}

// Procedural water. No time input: at a fixed depth it never changes between ticks, which is what
// lets the board restore only dirty rectangles.
inline void backgroundRgb(float u, float v, float depth, uint8_t rgb[3]) {
  float top[3];
  float bottom[3];
  gradientEnds(depth, top, bottom);
  mixRgb(top, bottom, backgroundMix(u, v), rgb);
}

// Face-local coordinate at the centre of panel pixel x (or y); both hosts sample here.
inline float pixelCenter(float low, float high, int16_t pixel, int16_t panel) {
  return low + (static_cast<float>(pixel) + 0.5f) / static_cast<float>(panel) * (high - low);
}

// Panel pixel under a reticle coordinate in 0..1, clamped onto the panel.
inline int16_t reticleAxis(float pixelUnit, int16_t panel) {
  int value = static_cast<int>(pixelUnit * static_cast<float>(panel));
  if (value < 0) value = 0;
  if (value > panel - 1) value = panel - 1;
  return static_cast<int16_t>(value);
}

// Panel pixels a subject can touch: rotated bounds plus a float margin, clipped to the panel.
inline Rect subjectScreenRect(uint8_t index, const Pose& pose, const CubeMath::ActiveImage& opening,
                              int16_t panel, int16_t margin) {
  Rect rect{0, 0, 0, 0, false};
  const float sx = static_cast<float>(panel) / (opening.right - opening.left);
  const float sy = static_cast<float>(panel) / (opening.bottom - opening.top);
  const float cx = (pose.u - opening.left) * sx;
  const float cy = (pose.v - opening.top) * sy;
  float width = 0.0f;
  float height = 0.0f;
  rotatedExtent(index, pose, width, height);
  int x0 = static_cast<int>(floorf(cx - width * sx / 2.0f)) - margin;
  int y0 = static_cast<int>(floorf(cy - height * sy / 2.0f)) - margin;
  int x1 = static_cast<int>(ceilf(cx + width * sx / 2.0f)) + margin;
  int y1 = static_cast<int>(ceilf(cy + height * sy / 2.0f)) + margin;
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 > panel) x1 = panel;
  if (y1 > panel) y1 = panel;
  if (x0 >= x1 || y0 >= y1) return rect;
  rect.x0 = static_cast<int16_t>(x0);
  rect.y0 = static_cast<int16_t>(y0);
  rect.x1 = static_cast<int16_t>(x1);
  rect.y1 = static_cast<int16_t>(y1);
  rect.valid = true;
  return rect;
}

// A square of panel pixels centred on the subject that covers its rotated footprint.
inline Crop collectCrop(uint8_t index, const Pose& pose, const CubeMath::ActiveImage& opening, int16_t panel) {
  const float scalePx = static_cast<float>(panel) / (opening.right - opening.left);
  const float cx = (pose.u - opening.left) * scalePx;
  const float cy = (pose.v - opening.top) * scalePx;
  float width = 0.0f;
  float height = 0.0f;
  rotatedExtent(index, pose, width, height);
  const float largest = width > height ? width : height;
  const int16_t side = static_cast<int16_t>(ceilf(largest * scalePx)) + 2 * kCropPadPx;
  Crop crop;
  crop.x = static_cast<int16_t>(floorf(cx - side / 2.0f));
  crop.y = static_cast<int16_t>(floorf(cy - side / 2.0f));
  crop.side = side;
  return crop;
}

}
