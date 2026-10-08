// Host test: the live-ocean code the board runs must move, draw, hit and crop the same scene as
// tools/live_ocean.py. Vectors come from tools/make_live_vectors.py; run with run_native_test.py.

#include <cmath>
#include <cstdio>

#include "deep_sphere_config.h"
#include "live_ocean_render.h"
#include "live_vectors_generated.h"

using namespace LiveOcean;

namespace {

int gChecks = 0;
int gFailures = 0;

// Double-precision Python against single-precision firmware floats, over up to 1000 ticks.
constexpr float kPointTolerance = 2.0e-3f;
constexpr float kTangentTolerance = 1.0e-4f;

void check(bool ok, const char* what, unsigned index) {
  ++gChecks;
  if (!ok) {
    ++gFailures;
    if (gFailures <= 25) std::printf("FAIL %s at vector %u\n", what, index);
  }
}

CubeMath::Vec3 surfacePoint(const Pose& pose) {
  const CubeMath::FaceBasis& face = DeepSphereConfig::kFaceBasis[pose.face];
  return CubeMath::add(CubeMath::scale(face.normal, 0.5f),
                       CubeMath::add(CubeMath::scale(face.right, pose.u - 0.5f),
                                     CubeMath::scale(face.down, pose.v - 0.5f)));
}

CubeMath::Vec3 surfaceTangent(const Pose& pose) {
  const CubeMath::FaceBasis& face = DeepSphereConfig::kFaceBasis[pose.face];
  return CubeMath::add(CubeMath::scale(face.right, pose.du), CubeMath::scale(face.down, pose.dv));
}

// Advance the production motion routine through real cube edges and compare with Python.
void runPoses() {
  Pose poses[kSubjectCount];
  for (uint8_t i = 0; i < kSubjectCount; ++i) poses[i] = initialPose(i);
  uint32_t tick = 0;
  int faceChanges = 0;
  uint8_t lastFace[kSubjectCount];
  for (uint8_t i = 0; i < kSubjectCount; ++i) lastFace[i] = poses[i].face;
  for (unsigned n = 0; n < LiveVectors::kPoseCount; ++n) {
    const LiveVectors::PoseVector& want = LiveVectors::kPoses[n];
    while (tick < want.tick) {
      for (uint8_t i = 0; i < kSubjectCount; ++i) {
        advanceOne(poses[i], DeepSphereConfig::kFaceBasis, DeepSphereConfig::kDisplayCount);
        if (poses[i].face != lastFace[i]) {
          ++faceChanges;
          lastFace[i] = poses[i].face;
        }
      }
      ++tick;
    }
    const Pose& pose = poses[want.subject];
    const CubeMath::Vec3 point = surfacePoint(pose);
    const CubeMath::Vec3 tangent = surfaceTangent(pose);
    check(std::fabs(point.x - want.px) <= kPointTolerance && std::fabs(point.y - want.py) <= kPointTolerance &&
              std::fabs(point.z - want.pz) <= kPointTolerance,
          "pose surface point", n);
    check(std::fabs(tangent.x - want.tx) <= kTangentTolerance && std::fabs(tangent.y - want.ty) <= kTangentTolerance &&
              std::fabs(tangent.z - want.tz) <= kTangentTolerance,
          "pose heading after hinges", n);
    if (!want.nearEdge) check(pose.face == want.face, "pose face", n);
  }
  // The vectors are only a meaningful edge test if the scene really crossed hinges.
  check(faceChanges >= 12, "live motion crossed real cube edges", static_cast<unsigned>(faceChanges));
}

// Rotated masks: opaque cells hit, transparent cells (fish eye, tail notch) and outside points miss.
void runSprites() {
  for (unsigned n = 0; n < LiveVectors::kSpriteCount; ++n) {
    const LiveVectors::SpriteVector& want = LiveVectors::kSprites[n];
    Pose pose = initialPose(want.subject);
    pose.face = 2;  // py; the rule only depends on the offset from the centre
    pose.u = 0.5f;
    pose.v = 0.5f;
    pose.du = want.du;
    pose.dv = want.dv;
    check(spriteOpaque(want.subject, pose, want.u, want.v) == want.opaque, "rotated sprite mask", n);
  }
}

// The same water colours, within one 8-bit step for float against double rounding.
void runBackground() {
  int exact = 0;
  for (unsigned n = 0; n < LiveVectors::kBackgroundCount; ++n) {
    const LiveVectors::BackgroundVector& want = LiveVectors::kBackgrounds[n];
    uint8_t rgb[3];
    backgroundRgb(want.u, want.v, want.depth, rgb);
    bool close = true;
    bool same = true;
    for (int c = 0; c < 3; ++c) {
      const int difference = static_cast<int>(rgb[c]) - static_cast<int>(want.rgb[c]);
      if (difference < -1 || difference > 1) close = false;
      if (difference != 0) same = false;
    }
    if (same) ++exact;
    check(close, "procedural background colour", n);
  }
  std::printf("background: %d of %u samples bit-exact with Python\n", exact, LiveVectors::kBackgroundCount);
}

// Dirty rectangles and Collect crops must contain every opaque pixel, or the board leaves trails
// and the laptop saves a clipped animal.
void runRects() {
  for (unsigned n = 0; n < LiveVectors::kRectCount; ++n) {
    const LiveVectors::RectVector& want = LiveVectors::kRects[n];
    Pose pose = initialPose(want.subject);
    pose.face = want.face;
    pose.u = want.u;
    pose.v = want.v;
    pose.du = want.du;
    pose.dv = want.dv;
    const CubeMath::ActiveImage& opening = DeepSphereConfig::kPhysicalFaceImage[want.face];
    const int16_t panel = static_cast<int16_t>(DeepSphereConfig::kDisplayWidth);
    const Rect rect = subjectScreenRect(want.subject, pose, opening, panel, kDirtyMarginPx);
    const Crop crop = collectCrop(want.subject, pose, opening, panel);
    check(crop.side == want.cropSide && std::abs(crop.x - want.cropX) <= 1 && std::abs(crop.y - want.cropY) <= 1,
          "collect crop matches Python", n);
    // A sprite wholly behind the frame has no pixel to leave behind; there the margin-only
    // rectangle may round to empty on one host and to a 1-pixel sliver on the other.
    if (!want.hasFootprint) continue;
    check(rect.valid, "dirty rectangle exists for a visible animal", n);
    check(std::abs(rect.x0 - want.x0) <= 1 && std::abs(rect.y0 - want.y0) <= 1 &&
              std::abs(rect.x1 - want.x1) <= 1 && std::abs(rect.y1 - want.y1) <= 1,
          "dirty rectangle matches Python", n);
    check(rect.x0 <= want.fx0 && rect.y0 <= want.fy0 && rect.x1 >= want.fx1 && rect.y1 >= want.fy1,
          "dirty rectangle covers every opaque pixel", n);
    check(crop.x <= want.fx0 && crop.y <= want.fy0 && crop.x + crop.side >= want.fx1 &&
              crop.y + crop.side >= want.fy1,
          "collect crop covers every opaque pixel", n);
  }
}

}

int main() {
  runPoses();
  runSprites();
  runBackground();
  runRects();
  std::printf("%s live ocean: %d checks, %d failures\n", gFailures == 0 ? "PASS" : "FAIL", gChecks, gFailures);
  return gFailures == 0 ? 0 : 1;
}
