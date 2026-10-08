#pragma once

#include <stddef.h>
#include <stdint.h>

#include "math/cube_math.h"

namespace LiveOcean {

struct Pose {
  uint8_t face = 0;
  float u = 0.5f;
  float v = 0.5f;
  float du = 0.0f;
  float dv = 0.0f;
};

inline CubeMath::Vec3 cross(CubeMath::Vec3 a, CubeMath::Vec3 b) {
  return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}

inline CubeMath::Vec3 rotateQuarter(CubeMath::Vec3 vector, CubeMath::Vec3 axis, float sign) {
  using namespace CubeMath;
  const Vec3 along = scale(axis, dot(vector, axis));
  return add(along, scale(cross(axis, add(vector, scale(along, -1.0f))), sign));
}

inline uint8_t neighborForOutward(CubeMath::Vec3 outward, const CubeMath::FaceBasis* faces, size_t count) {
  using namespace CubeMath;
  for (size_t i = 0; i < count; ++i) if (dot(faces[i].normal, outward) > 0.9f) return static_cast<uint8_t>(i);
  return 255;
}

// Advance one fixed tick on the actual cube surface. Distance to the first
// edge is consumed before the tangent is rotated around the shared hinge.
inline void advanceOne(Pose& pose, const CubeMath::FaceBasis* faces, size_t count) {
  using namespace CubeMath;
  float remaining = 1.0f;
  for (uint8_t hop = 0; hop < 4 && remaining > 0.000001f; ++hop) {
    const FaceBasis& face = faces[pose.face];
    const Vec3 point = add(scale(face.normal, 0.5f),
                           add(scale(face.right, pose.u - 0.5f), scale(face.down, pose.v - 0.5f)));
    const Vec3 tangent = add(scale(face.right, pose.du), scale(face.down, pose.dv));
    float edgeTime = remaining;
    uint8_t edge = 255;
    if (pose.du > 0.0f && (1.0f - pose.u) / pose.du < edgeTime) { edgeTime = (1.0f - pose.u) / pose.du; edge = 1; }
    if (pose.du < 0.0f && (0.0f - pose.u) / pose.du < edgeTime) { edgeTime = (0.0f - pose.u) / pose.du; edge = 0; }
    if (pose.dv > 0.0f && (1.0f - pose.v) / pose.dv < edgeTime) { edgeTime = (1.0f - pose.v) / pose.dv; edge = 3; }
    if (pose.dv < 0.0f && (0.0f - pose.v) / pose.dv < edgeTime) { edgeTime = (0.0f - pose.v) / pose.dv; edge = 2; }
    if (edge == 255 || edgeTime >= remaining - 0.000001f) {
      pose.u += pose.du * remaining;
      pose.v += pose.dv * remaining;
      break;
    }
    pose.u += pose.du * edgeTime;
    pose.v += pose.dv * edgeTime;
    const Vec3 outward = edge == 0 ? scale(face.right, -1.0f) : edge == 1 ? face.right :
                         edge == 2 ? scale(face.down, -1.0f) : face.down;
    const uint8_t nextIndex = neighborForOutward(outward, faces, count);
    if (nextIndex >= count) break;
    const Vec3 edgePoint = add(scale(face.normal, 0.5f),
                               add(scale(face.right, pose.u - 0.5f), scale(face.down, pose.v - 0.5f)));
    const FaceBasis& nextFace = faces[nextIndex];
    const Vec3 axis = normalize(cross(face.normal, nextFace.normal));
    const float sign = dot(rotateQuarter(face.normal, axis, 1.0f), nextFace.normal) > 0.9f ? 1.0f : -1.0f;
    const Vec3 turned = rotateQuarter(tangent, axis, sign);
    pose.face = nextIndex;
    pose.u = dot(edgePoint, nextFace.right) + 0.5f;
    pose.v = dot(edgePoint, nextFace.down) + 0.5f;
    pose.du = dot(turned, nextFace.right);
    pose.dv = dot(turned, nextFace.down);
    remaining -= edgeTime;
  }
}

}
