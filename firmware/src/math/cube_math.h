#pragma once

#include <stddef.h>
#include <stdint.h>

namespace CubeMath {

struct Vec3 { float x; float y; float z; };
struct Uv { float u; float v; };
struct FaceBasis { const char* id; Vec3 normal; Vec3 right; Vec3 down; };

// Scene constants shared with tools/atlas_math.py through the generated test vectors.
struct SceneParams { float uOffset; float verticalScale; float depthMinCenter; float depthMaxCenter; };

// The glass covers only part of each cube face; outside it there is no pixel to draw on.
struct ActiveImage { float left; float top; float right; float bottom; };

struct Projection { const FaceBasis* face; Vec3 point; float localU; float localV; float pixelU; float pixelV; Uv atlas; bool visible; };
struct Target { const char* id; float u; float v; float w; float h; };

Vec3 normalize(Vec3 value);
float dot(Vec3 a, Vec3 b);
Vec3 scale(Vec3 value, float amount);
Vec3 add(Vec3 a, Vec3 b);
Vec3 rotateZ(Vec3 value, float radians);
Vec3 matrixTransposeMultiply(const float matrix[3][3], Vec3 value);
Vec3 matrixMultiply(const float matrix[3][3], Vec3 value);
float clamp01(float value);
float wrap01(float value);
float depthCenter(float depthNorm, const SceneParams& scene);

// Background mapping deliberately has no yaw input.
Uv backgroundUv(Vec3 direction, float depthNorm, const SceneParams& scene);
Vec3 faceDirection(const FaceBasis& face, float localU, float localV, const float mount[3][3]);

// World-space direction the reticle points along once the cube has turned by yaw.
Vec3 aimDirection(float yawDeg, Vec3 aimWorld);
const FaceBasis* cubeFaceForDirection(Vec3 direction, const FaceBasis* faces, size_t count, Vec3& point);
bool insideActiveImage(float localU, float localV, const ActiveImage& active);

// Projection.atlas is the same value backgroundUv() gives for the face pixel under the
// reticle, so scanning and collecting read the image the player is actually looking at.
Projection reticleProjection(float yawDeg, Vec3 aimWorld, const float mount[3][3], const FaceBasis* faces,
                             size_t count, const ActiveImage& active, float depthNorm, const SceneParams& scene);
Projection reticleProjection(float yawDeg, Vec3 aimWorld, const float mount[3][3], const FaceBasis* faces,
                             size_t count, const ActiveImage* physicalByFace, const ActiveImage& pixelMask,
                             float depthNorm, const SceneParams& scene);

bool targetContains(Uv uv, const Target& target);
const Target* findTarget(Uv uv, const Target* targets, size_t count, bool visible);
uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b);

}
