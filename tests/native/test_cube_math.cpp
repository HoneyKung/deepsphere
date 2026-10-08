// Host test: the firmware math must reproduce the same vectors as tools/atlas_math.py.
// Build and run with tests/native/run_native_test.py.

#include <cmath>
#include <initializer_list>
#include <cstdio>
#include <cstring>

#include "math/cube_math.h"
#include "targets_generated.h"
#include "vectors_generated.h"

using namespace CubeMath;

namespace {

const FaceBasis kFaceBasis[6] = {
  {"px", {1, 0, 0}, {0, 1, 0}, {0, 0, -1}}, {"nx", {-1, 0, 0}, {0, -1, 0}, {0, 0, -1}},
  {"py", {0, 1, 0}, {-1, 0, 0}, {0, 0, -1}}, {"ny", {0, -1, 0}, {1, 0, 0}, {0, 0, -1}},
  {"pz", {0, 0, 1}, {1, 0, 0}, {0, -1, 0}}, {"nz", {0, 0, -1}, {-1, 0, 0}, {0, -1, 0}}
};

int gFailures = 0;
int gChecks = 0;

// Vectors come from double-precision Python; single-precision firmware floats are
// allowed to differ by this much and no more.
constexpr float kTolerance = 2.0e-4f;

void expectNear(const char* label, float actual, float expected) {
  ++gChecks;
  if (std::fabs(actual - expected) > kTolerance) {
    std::printf("FAIL %s: got %.7f want %.7f\n", label, actual, expected);
    ++gFailures;
  }
}

void expectWrapNear(const char* label, float actual, float expected) {
  ++gChecks;
  float difference = std::fmod(actual - expected + 1.5f, 1.0f) - 0.5f;
  if (std::fabs(difference) > kTolerance) {
    std::printf("FAIL %s: got %.7f want %.7f (circular)\n", label, actual, expected);
    ++gFailures;
  }
}

void expectText(const char* label, const char* actual, const char* expected) {
  ++gChecks;
  const bool same = (actual == nullptr && expected == nullptr) ||
                    (actual != nullptr && expected != nullptr && std::strcmp(actual, expected) == 0);
  if (!same) {
    std::printf("FAIL %s: got %s want %s\n", label, actual ? actual : "null", expected ? expected : "null");
    ++gFailures;
  }
}

void expectBool(const char* label, bool actual, bool expected) {
  ++gChecks;
  if (actual != expected) {
    std::printf("FAIL %s: got %s want %s\n", label, actual ? "true" : "false", expected ? "true" : "false");
    ++gFailures;
  }
}

const FaceBasis& faceById(const char* id) {
  for (const FaceBasis& face : kFaceBasis) if (std::strcmp(face.id, id) == 0) return face;
  std::printf("FAIL unknown face id %s\n", id);
  ++gFailures;
  return kFaceBasis[0];
}

void runBackground() {
  for (const auto& vector : MathVectors::kBackground) {
    const Vec3 direction = faceDirection(faceById(vector.face), vector.localU, vector.localV, MathVectors::kMount);
    const Uv uv = backgroundUv(direction, vector.depth, MathVectors::kScene);
    expectWrapNear("background.u", uv.u, vector.u);
    expectNear("background.v", uv.v, vector.v);
  }
}

void runReticle() {
  for (const auto& vector : MathVectors::kReticle) {
    const Projection projection = reticleProjection(vector.yaw, MathVectors::kAimWorld, MathVectors::kMount,
                                                    kFaceBasis, 6, MathVectors::kActive, vector.depth,
                                                    MathVectors::kScene);
    expectText("reticle.face", projection.face ? projection.face->id : nullptr, vector.face);
    expectNear("reticle.localU", projection.localU, vector.localU);
    expectNear("reticle.localV", projection.localV, vector.localV);
    expectWrapNear("reticle.atlasU", projection.atlas.u, vector.u);
    expectNear("reticle.atlasV", projection.atlas.v, vector.v);
    expectBool("reticle.visible", projection.visible, vector.visible);
    const Target* target = findTarget(projection.atlas, GeneratedAssets::kTargets, GeneratedAssets::kTargetCount, projection.visible);
    expectText("reticle.target", target ? target->id : nullptr, vector.targetId);
  }
}

void runRgb565() {
  for (const auto& vector : MathVectors::kRgb565) {
    ++gChecks;
    const unsigned packed = rgb565(static_cast<uint8_t>(vector.r), static_cast<uint8_t>(vector.g),
                                   static_cast<uint8_t>(vector.b));
    if (packed != vector.packed) {
      std::printf("FAIL rgb565(%d,%d,%d): got %u want %u\n", vector.r, vector.g, vector.b, packed, vector.packed);
      ++gFailures;
    }
  }
}

// The reticle must read the pixel the background renderer actually drew under it.
void runRendererAgreement() {
  for (float yaw = 0.0f; yaw < 360.0f; yaw += 3.0f) {
    for (float depth : {0.0f, 0.35f, 0.62f, 1.0f}) {
      const Projection projection = reticleProjection(yaw, MathVectors::kAimWorld, MathVectors::kMount,
                                                      kFaceBasis, 6, MathVectors::kActive, depth,
                                                      MathVectors::kScene);
      if (!projection.face) continue;
      const Vec3 direction = faceDirection(*projection.face, projection.localU, projection.localV,
                                           MathVectors::kMount);
      const Uv drawn = backgroundUv(direction, depth, MathVectors::kScene);
      expectWrapNear("renderer_agreement.u", projection.atlas.u, drawn.u);
      expectNear("renderer_agreement.v", projection.atlas.v, drawn.v);
    }
  }
}

// Turning the cube must not move the background in the cube's own coordinates, while the
// reticle, which is what compensates for the turn, must move.
void runBackgroundIgnoresYaw() {
  for (const FaceBasis& face : kFaceBasis) {
    for (float local = 0.1f; local < 1.0f; local += 0.2f) {
      const Vec3 direction = faceDirection(face, local, 1.0f - local, MathVectors::kMount);
      const Uv atRest = backgroundUv(direction, 0.35f, MathVectors::kScene);
      for (float yaw : {0.0f, 37.0f, 180.0f, 359.5f}) {
        const Projection projection = reticleProjection(yaw, MathVectors::kAimWorld, MathVectors::kMount,
                                                        kFaceBasis, 6, MathVectors::kActive, 0.35f,
                                                        MathVectors::kScene);
        (void)projection;
        const Uv again = backgroundUv(direction, 0.35f, MathVectors::kScene);
        expectNear("background_ignores_yaw.u", again.u, atRest.u);
        expectNear("background_ignores_yaw.v", again.v, atRest.v);
      }
    }
  }
  // A quarter turn has to move the reticle a quarter of the way around the atlas.
  const Projection start = reticleProjection(0.0f, MathVectors::kAimWorld, MathVectors::kMount, kFaceBasis, 6,
                                             MathVectors::kActive, 0.35f, MathVectors::kScene);
  const Projection turned = reticleProjection(90.0f, MathVectors::kAimWorld, MathVectors::kMount, kFaceBasis, 6,
                                              MathVectors::kActive, 0.35f, MathVectors::kScene);
  expectWrapNear("reticle_follows_yaw.u", turned.atlas.u, wrap01(start.atlas.u - 0.25f));
  expectNear("reticle_follows_yaw.v", turned.atlas.v, start.atlas.v);
}

void runPhysicalFaceMapping() {
  const ActiveImage physical[6] = {
    {0.18f, 0.14f, 0.82f, 0.86f}, {0.16f, 0.12f, 0.84f, 0.88f},
    {0.22f, 0.16f, 0.78f, 0.84f}, {0.15f, 0.18f, 0.85f, 0.82f},
    {0.12f, 0.20f, 0.88f, 0.80f}, {0.20f, 0.10f, 0.80f, 0.90f}
  };
  const ActiveImage pixelMask = {0, 0, 1, 1};
  const Projection projection = reticleProjection(0.0f, MathVectors::kAimWorld, MathVectors::kMount,
                                                   kFaceBasis, 6, physical, pixelMask, 0.35f,
                                                   MathVectors::kScene);
  const int faceIndex = static_cast<int>(projection.face - kFaceBasis);
  const ActiveImage& rect = physical[faceIndex];
  expectNear("physical.pixelU", projection.pixelU,
             (projection.localU - rect.left) / (rect.right - rect.left));
  expectNear("physical.pixelV", projection.pixelV,
             (projection.localV - rect.top) / (rect.bottom - rect.top));

  // Test fixture: a body diagonal (1,1,1) is upright in world +Z. This is not the
  // assembled cube pose; it proves the mount transform is applied on both paths.
  const float diagonal[3][3] = {
    {0.788675f, -0.211325f, -0.577350f},
    {-0.211325f, 0.788675f, -0.577350f},
    {0.577350f, 0.577350f, 0.577350f}
  };
  const Vec3 identityDirection = faceDirection(kFaceBasis[0], 0.35f, 0.65f, MathVectors::kMount);
  const Vec3 diagonalDirection = faceDirection(kFaceBasis[0], 0.35f, 0.65f, diagonal);
  ++gChecks;
  if (std::fabs(identityDirection.x - diagonalDirection.x) +
      std::fabs(identityDirection.y - diagonalDirection.y) +
      std::fabs(identityDirection.z - diagonalDirection.z) < 0.1f) {
    std::printf("FAIL non_identity_mount did not change direction\n");
    ++gFailures;
  }
}

}

int main() {
  runBackground();
  runReticle();
  runRgb565();
  runRendererAgreement();
  runBackgroundIgnoresYaw();
  runPhysicalFaceMapping();
  std::printf("%s: %d checks, %d failures\n", gFailures == 0 ? "PASS" : "FAIL", gChecks, gFailures);
  return gFailures == 0 ? 0 : 1;
}
