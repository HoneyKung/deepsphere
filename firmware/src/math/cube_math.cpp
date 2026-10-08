#include "cube_math.h"

#include <math.h>

namespace CubeMath {

static constexpr float kPi = 3.14159265358979323846f;

Vec3 normalize(Vec3 value) {
  const float length = sqrtf(value.x * value.x + value.y * value.y + value.z * value.z);
  if (length <= 0.0f) return {0, 0, 0};
  return {value.x / length, value.y / length, value.z / length};
}

float dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
Vec3 scale(Vec3 value, float amount) { return {value.x * amount, value.y * amount, value.z * amount}; }
Vec3 add(Vec3 a, Vec3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }

Vec3 rotateZ(Vec3 value, float radians) {
  const float c = cosf(radians), s = sinf(radians);
  return {c * value.x - s * value.y, s * value.x + c * value.y, value.z};
}

Vec3 matrixMultiply(const float matrix[3][3], Vec3 value) {
  return {matrix[0][0] * value.x + matrix[0][1] * value.y + matrix[0][2] * value.z,
          matrix[1][0] * value.x + matrix[1][1] * value.y + matrix[1][2] * value.z,
          matrix[2][0] * value.x + matrix[2][1] * value.y + matrix[2][2] * value.z};
}

Vec3 matrixTransposeMultiply(const float matrix[3][3], Vec3 value) {
  return {matrix[0][0] * value.x + matrix[1][0] * value.y + matrix[2][0] * value.z,
          matrix[0][1] * value.x + matrix[1][1] * value.y + matrix[2][1] * value.z,
          matrix[0][2] * value.x + matrix[1][2] * value.y + matrix[2][2] * value.z};
}

float clamp01(float value) { return value < 0 ? 0 : (value > 1 ? 1 : value); }
float wrap01(float value) { value = fmodf(value, 1.0f); return value < 0 ? value + 1.0f : value; }

float depthCenter(float depthNorm, const SceneParams& scene) {
  return scene.depthMinCenter + clamp01(depthNorm) * (scene.depthMaxCenter - scene.depthMinCenter);
}

Uv backgroundUv(Vec3 direction, float depthNorm, const SceneParams& scene) {
  direction = normalize(direction);
  const float u = wrap01(atan2f(direction.y, direction.x) / (2.0f * kPi) + scene.uOffset);
  const float pitchNorm = asinf(direction.z < -1 ? -1 : (direction.z > 1 ? 1 : direction.z)) / kPi + 0.5f;
  const float v = clamp01(depthCenter(depthNorm, scene) + (0.5f - pitchNorm) * scene.verticalScale);
  return {u, v};
}

Vec3 faceDirection(const FaceBasis& face, float localU, float localV, const float mount[3][3]) {
  const Vec3 point = add(scale(face.normal, 0.5f),
                         add(scale(face.right, localU - 0.5f), scale(face.down, localV - 0.5f)));
  return normalize(matrixMultiply(mount, point));
}

Vec3 aimDirection(float yawDeg, Vec3 aimWorld) {
  float yaw = fmodf(yawDeg, 360.0f);
  if (yaw < 0) yaw += 360.0f;
  return normalize(rotateZ(aimWorld, -yaw * kPi / 180.0f));
}

const FaceBasis* cubeFaceForDirection(Vec3 direction, const FaceBasis* faces, size_t count, Vec3& point) {
  direction = normalize(direction);
  float best = -1.0f;
  const FaceBasis* selected = nullptr;
  for (size_t i = 0; i < count; ++i) {
    const float candidate = dot(direction, faces[i].normal);
    if (candidate > best) { best = candidate; selected = &faces[i]; }
  }
  if (!selected || best <= 0) return nullptr;
  point = scale(direction, 0.5f / best);
  return selected;
}

bool insideActiveImage(float localU, float localV, const ActiveImage& active) {
  return localU >= active.left && localU <= active.right && localV >= active.top && localV <= active.bottom;
}

Projection reticleProjection(float yawDeg, Vec3 aimWorld, const float mount[3][3], const FaceBasis* faces,
                             size_t count, const ActiveImage* physicalByFace, const ActiveImage& pixelMask,
                             float depthNorm, const SceneParams& scene) {
  const Vec3 aimRay = aimDirection(yawDeg, aimWorld);
  const Vec3 bodyAim = matrixTransposeMultiply(mount, aimRay);
  Vec3 point{};
  const FaceBasis* face = cubeFaceForDirection(bodyAim, faces, count, point);
  if (!face) return {nullptr, {}, 0, 0, 0, 0, {}, false};
  const float localU = dot(point, face->right) + 0.5f;
  const float localV = dot(point, face->down) + 0.5f;
  const size_t faceIndex = static_cast<size_t>(face - faces);
  const ActiveImage& physical = physicalByFace[faceIndex];
  const float physicalWidth = physical.right - physical.left;
  const float physicalHeight = physical.bottom - physical.top;
  const float pixelU = physicalWidth > 0 ? (localU - physical.left) / physicalWidth : -1.0f;
  const float pixelV = physicalHeight > 0 ? (localV - physical.top) / physicalHeight : -1.0f;
  return {face, point, localU, localV, pixelU, pixelV, backgroundUv(aimRay, depthNorm, scene),
          insideActiveImage(localU, localV, physical) && insideActiveImage(pixelU, pixelV, pixelMask)};
}

Projection reticleProjection(float yawDeg, Vec3 aimWorld, const float mount[3][3], const FaceBasis* faces,
                             size_t count, const ActiveImage& active, float depthNorm, const SceneParams& scene) {
  static const ActiveImage kPixelFull = {0, 0, 1, 1};
  const ActiveImage physicalByFace[6] = {active, active, active, active, active, active};
  return reticleProjection(yawDeg, aimWorld, mount, faces, count, physicalByFace, kPixelFull, depthNorm, scene);
}

static float circularDistance(float a, float b) {
  float value = fmodf(a - b + 0.5f, 1.0f);
  if (value < 0) value += 1.0f;
  return fabsf(value - 0.5f);
}

bool targetContains(Uv uv, const Target& target) {
  return circularDistance(uv.u, target.u) <= target.w * 0.5f && fabsf(uv.v - target.v) <= target.h * 0.5f;
}

const Target* findTarget(Uv uv, const Target* targets, size_t count, bool visible) {
  if (!visible) return nullptr;
  for (size_t i = 0; i < count; ++i) if (targetContains(uv, targets[i])) return &targets[i];
  return nullptr;
}

uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return static_cast<uint16_t>(((static_cast<uint16_t>(r) * 31 + 127) / 255 << 11) |
                               ((static_cast<uint16_t>(g) * 63 + 127) / 255 << 5) |
                               ((static_cast<uint16_t>(b) * 31 + 127) / 255));
}

}
