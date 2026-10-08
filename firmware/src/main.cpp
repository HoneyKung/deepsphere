#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <Arduino.h>
#include <SPI.h>
#include <esp_heap_caps.h>
#include <esp_random.h>
#include <esp_system.h>
#include <string.h>

#include "deep_sphere_config.h"
#include "live_ocean_render.h"
#include "math/cube_math.h"

using namespace DeepSphereConfig;
using namespace CubeMath;

namespace {

// docs/audio-protocol.md: one JSON object per line, at most 512 bytes including the newline.
constexpr size_t kMaxLineBytes = 511;

// Which binary is actually running. Reading the source tells you what was compiled last, not
// what is on the chip, so every boot says its own build stamp and environment and the host
// records that rather than inferring it. DEEP_SPHERE_ENV comes from platformio.ini.
#ifndef DEEP_SPHERE_ENV
#define DEEP_SPHERE_ENV "unknown-env"
#endif
constexpr char kFirmwareEnv[] = DEEP_SPHERE_ENV;
constexpr char kFirmwareBuild[] = __DATE__ " " __TIME__;

// A host is rarely attached in time to read the boot log, and USB can drop and come back at
// any point, so the facts needed to tell a reboot from a dropped link are repeated on a timer
// instead of being sent once at startup.
constexpr uint32_t kHeartbeatIntervalMs = 1000;

// Long enough for the USB FIFO to drain a line, short enough that a host which stops reading
// costs the render loop a few milliseconds rather than stalling it. Zero was worse than it
// looks: it does not block, it silently drops whatever does not fit.
constexpr uint32_t kSerialTxTimeoutMs = 20;
// How long a display diagnostic stays on the panels before the live scene is repainted.
constexpr uint32_t kDiagnosticHoldMs = 4000;

Adafruit_ST7789* gDisplays[6] = {nullptr, nullptr, nullptr, nullptr, nullptr, nullptr};

// One stripe of screen pixels, in DMA-capable internal RAM.
uint16_t* gStripe = nullptr;
// Water gradient position for every panel pixel, shared by all panels (see buildMixTable).
float* gMixTable = nullptr;

bool gSceneUpdating = false;
bool gProjectionValid = false;
bool gFullRedrawPending = true;
bool gReticleRedrawPending = false;
bool gLiveRedrawPending = false;
Projection gLastProjection{};

// gPoses is the simulation at gComputedTick. gShownPoses and gShownTick are what the panels
// actually show; drawing, Scan, Collect and state read only the shown copy, so a scan never
// answers from a newer tick than the one on the glass.
uint32_t gSceneTick = 0;
uint32_t gComputedTick = 0;
uint32_t gShownTick = 0;
LiveOcean::Pose gPoses[LiveOcean::kSubjectCount];
LiveOcean::Pose gShownPoses[LiveOcean::kSubjectCount];

uint32_t gDiagnosticHoldUntilMs = 0;
uint32_t gLastFullRedrawMs = 0;
uint32_t gLiveRenderMaxMs = 0;

float gYawDeg = kYawZeroOffsetDeg;
float gDepthNorm = 0.35f;
float gDisplayedDepth = 0.35f;
WheelRole gWheelRole = kWheelRoleAtBoot;

uint32_t gSeq = 0;
uint32_t gLastStateMs = 0;
uint32_t gPendingSinceMs = 0;
String gSession;
String gPendingSample;
String gLastHostRequestId;

bool outputEnabledAt(uint8_t index);
int displayIndexForId(const String& faceId);
void drawDisplayDiagnostic(uint8_t index);
void drawDisplayDiagnosticAll();
void holdSinglePin(int pin);
void scanShorts();
bool isTestSignalPin(int pin);
void resumePinOutput();
void pauseSweep();
bool gSweepPaused = false;

String jsonEscape(const char* value) {
  String out(value);
  out.replace("\\", "\\\\");
  out.replace("\"", "\\\"");
  return out;
}

String jsonStringField(const String& line, const char* key) {
  const String marker = String("\"") + key + "\":\"";
  const int start = line.indexOf(marker);
  if (start < 0) return "";
  const int valueStart = start + marker.length();
  const int valueEnd = line.indexOf('\"', valueStart);
  return valueEnd < 0 ? "" : line.substring(valueStart, valueEnd);
}

float jsonNumberField(const String& line, const char* key, float fallback) {
  const String marker = String("\"") + key + "\":";
  const int start = line.indexOf(marker);
  if (start < 0) return fallback;
  return line.substring(start + marker.length()).toFloat();
}

String header(const char* type) {
  return String("{\"v\":1,\"type\":\"") + type + "\",\"session\":\"" + gSession + "\",\"seq\":" + (++gSeq);
}

// Count of lines the USB FIFO could not take whole. Reported in every heartbeat, so a host
// can tell a quiet link from a link that is losing pieces of messages.
uint32_t gTruncatedLines = 0;
// Remembers if a line was left incomplete because newline boundary recovery failed.
bool gLineIncomplete = false;

void sendLine(const String& line) {
  if (gLineIncomplete) {
    // A previous line was interrupted and could not be terminated with a newline.
    // Try to recover the boundary now. Never wait indefinitely (bounded by tx timeout).
    const size_t nl = Serial.write(reinterpret_cast<const uint8_t*>("\n"), 1);
    if (nl == 0) {
      // Recovery failed; drop this new payload rather than concatenating it onto an open line.
      ++gTruncatedLines;
      return;
    }
    gLineIncomplete = false;
  }

  const String payload = line + "\n";
  const size_t wanted = payload.length();
  const size_t written = Serial.write(reinterpret_cast<const uint8_t*>(payload.c_str()), wanted);
  if (written < wanted) {
    ++gTruncatedLines;
    if (written > 0) {
      // A partial line was written without its newline. Try to send a newline so the
      // line delimiter is restored and the next message does not concatenate onto this one.
      const size_t nl = Serial.write(reinterpret_cast<const uint8_t*>("\n"), 1);
      if (nl == 0) {
        gLineIncomplete = true;
      }
    }
  }
}

void sendLog(const char* message) {
  sendLine(header("log") + ",\"message\":\"" + jsonEscape(message) + "\"}");
}

void sendAck(const String& requestId, const char* status) {
  sendLine(header("ack") + ",\"request_id\":\"" + jsonEscape(requestId.c_str()) +
           "\",\"status\":\"" + status + "\"}");
}

// How far through start-up this boot has reached. Each value means the code passed that point
// and nothing more: panels_initialized says the init calls returned, not that any glass lit.
const char* gStage = "booting";
uint32_t gHeartbeats = 0;
uint32_t gLastHeartbeatMs = 0;

// The SDK's own enumerators, spelled out. Anything this build's SDK does not define is
// reported as "unknown" with its raw number kept, rather than guessed at from a number that
// may mean something different in another IDF release.
const char* resetReasonName(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_UNKNOWN: return "unknown";
    case ESP_RST_POWERON: return "poweron";
    case ESP_RST_EXT: return "ext";
    case ESP_RST_SW: return "sw";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "int_wdt";
    case ESP_RST_TASK_WDT: return "task_wdt";
    case ESP_RST_WDT: return "wdt";
    case ESP_RST_DEEPSLEEP: return "deepsleep";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_SDIO: return "sdio";
    default: return "unrecognised";
  }
}

// The fields that distinguish "the board rebooted" from "the USB link went away while the
// board kept running". Shared by hello and heartbeat so both answer the question.
String bootFields() {
  const esp_reset_reason_t reason = esp_reset_reason();
  return String(",\"firmware_env\":\"") + kFirmwareEnv + "\",\"firmware_build\":\"" + kFirmwareBuild +
         "\",\"reset_reason\":" + String(static_cast<int>(reason)) +
         ",\"reset_reason_name\":\"" + resetReasonName(reason) +
         "\",\"uptime_ms\":" + String(millis()) +
         ",\"truncated_lines\":" + String(gTruncatedLines) +
         ",\"stage\":\"" + gStage + "\"";
}

void sendHeartbeat() {
  sendLine(header("heartbeat") + bootFields() + ",\"heartbeat\":" + String(++gHeartbeats) + "}");
}

uint8_t gZoneIndex = 1;

void updateZone(float depth) {
  if (depth >= kZoneBounds[1] + kZoneHysteresis) gZoneIndex = 2;
  else if (depth < kZoneBounds[1] - kZoneHysteresis && depth >= kZoneBounds[0] + kZoneHysteresis) gZoneIndex = 1;
  else if (depth < kZoneBounds[0] - kZoneHysteresis) gZoneIndex = 0;
}

const char* zoneName() {
  static const char* kNames[3] = {"surface", "mid", "deep"};
  return kNames[gZoneIndex];
}

const char* wheelRoleName() {
  if (kYawSource == YawSource::kNone) return "none";
  return gWheelRole == WheelRole::kYaw ? "yaw" : "depth";
}

void resetLiveScene() {
  for (uint8_t i = 0; i < LiveOcean::kSubjectCount; ++i) {
    gPoses[i] = LiveOcean::initialPose(i);
    gShownPoses[i] = gPoses[i];
  }
  gComputedTick = 0;
  gShownTick = 0;
}

void advanceLiveScene() {
  while (gComputedTick < gSceneTick) {
    for (uint8_t i = 0; i < LiveOcean::kSubjectCount; ++i) {
      LiveOcean::advanceOne(gPoses[i], kFaceBasis, kDisplayCount);
    }
    ++gComputedTick;
  }
}

void presentLiveScene() {
  for (uint8_t i = 0; i < LiveOcean::kSubjectCount; ++i) gShownPoses[i] = gPoses[i];
  gShownTick = gComputedTick;
}

Projection currentProjection() {
  return reticleProjection(gYawDeg, kAimWorld, kMount, kFaceBasis, kDisplayCount,
                           kPhysicalFaceImage, kDisplayPixelMask, gDisplayedDepth, kScene);
}

bool outputEnabledFor(const Projection& projection) {
  if (!projection.face) return false;
  const int faceIndex = static_cast<int>(projection.face - kFaceBasis);
  return kSingleDisplayTest ? faceIndex == kSingleDisplayIndex
                             : (faceIndex >= 0 && faceIndex < kDisplayCount && kDisplayEnabled[faceIndex]);
}

// The subject on the panel pixel under the reticle centre, sampled at that pixel's centre: the
// same point and the same rule that coloured it, so a scan hits what the player sees.
int subjectUnderReticle(const Projection& projection) {
  if (!outputEnabledFor(projection) || !projection.visible || gSceneUpdating || !projection.face) return -1;
  const uint8_t face = static_cast<uint8_t>(projection.face - kFaceBasis);
  const ActiveImage& opening = kPhysicalFaceImage[face];
  const int16_t x = LiveOcean::reticleAxis(projection.pixelU, kDisplayWidth);
  const int16_t y = LiveOcean::reticleAxis(projection.pixelV, kDisplayHeight);
  const float u = LiveOcean::pixelCenter(opening.left, opening.right, x, kDisplayWidth);
  const float v = LiveOcean::pixelCenter(opening.top, opening.bottom, y, kDisplayHeight);
  return LiveOcean::subjectAt(gShownPoses, face, u, v);
}

String initializedPanels() {
  String out;
  for (uint8_t i = 0; i < kDisplayCount; ++i) {
    if (!gDisplays[i]) continue;
    if (out.length() > 0) out += ",";
    out += kFaces[i].id;
  }
  return out;
}

void sendState() {
  const Projection projection = currentProjection();
  const int subject = subjectUnderReticle(projection);
  sendLine(header("state") + ",\"depth_norm\":" + String(gDisplayedDepth, 4) +
           ",\"zone\":\"" + zoneName() +
           "\",\"yaw_deg\":" + String(gYawDeg, 2) +
           ",\"aim_visible\":" + ((projection.visible && outputEnabledFor(projection)) ? "true" : "false") +
           ",\"target_id\":" + (subject >= 0 ? String("\"") + LiveOcean::kSubjects[subject].id + "\"" : "null") +
           ",\"inputs\":\"" + (kPhysicalControlsEnabled ? "hardware" : "keyboard") +
           "\",\"yaw_source\":\"" + yawSourceName() +
           "\",\"wheel_role\":\"" + wheelRoleName() +
           "\",\"renderer\":\"" + LiveOcean::kRenderer + "\",\"scene_version\":" + String(LiveOcean::kSceneVersion) +
           ",\"scene_tick\":" + String(gShownTick) +
           ",\"live_ms\":" + String(gLiveRenderMaxMs) + ",\"full_ms\":" + String(gLastFullRedrawMs) + "}");
  gLiveRenderMaxMs = 0;
}

// Sent when the host asks for state, after the panels exist, because a USB host is rarely
// attached early enough to read the boot log itself.
void sendHello() {
  sendLine(header("hello") + ",\"device\":\"deep-sphere-v1\",\"inputs\":\"" +
           (kPhysicalControlsEnabled ? "hardware" : "keyboard") + "\",\"yaw_source\":\"" + yawSourceName() +
           "\",\"asset_pack\":\"" + kAssetPackId + "\",\"renderer\":\"" + LiveOcean::kRenderer +
           "\",\"scene_version\":" + String(LiveOcean::kSceneVersion) +
           ",\"panels\":\"" + initializedPanels() + "\"" + bootFields() + "}");
}

// Repaint a clipped rectangle of one face, stripe by stripe: water and every overlapping animal
// are composited in RAM and sent as one SPI window per stripe, never one transaction per pixel.
void drawRegion(uint8_t index, int16_t x0, int16_t y0, int16_t width, int16_t height) {
  if (index >= kDisplayCount || !gDisplays[index] || !gStripe) return;
  if (x0 < 0) { width += x0; x0 = 0; }
  if (y0 < 0) { height += y0; y0 = 0; }
  if (x0 + width > kDisplayWidth) width = kDisplayWidth - x0;
  if (y0 + height > kDisplayHeight) height = kDisplayHeight - y0;
  if (width <= 0 || height <= 0) return;

  Adafruit_ST7789& display = *gDisplays[index];
  const ActiveImage& opening = kPhysicalFaceImage[index];
  // Water colours for the shown depth, once per call rather than once per pixel.
  float waterTop[3];
  float waterBottom[3];
  LiveOcean::gradientEnds(gDisplayedDepth, waterTop, waterBottom);
  // Only animals whose bounds meet this region can colour it. Their order is kept, so the lowest
  // index still wins, exactly as LiveOcean::subjectAt decides it for a scan.
  uint8_t candidates[LiveOcean::kSubjectCount];
  LiveOcean::Rect bounds[LiveOcean::kSubjectCount];
  uint16_t colours[LiveOcean::kSubjectCount];
  uint8_t candidateCount = 0;
  for (uint8_t i = 0; i < LiveOcean::kSubjectCount; ++i) {
    if (gShownPoses[i].face != index) continue;
    const LiveOcean::Rect rect = LiveOcean::subjectScreenRect(i, gShownPoses[i], opening, kDisplayWidth,
                                                              LiveOcean::kDirtyMarginPx);
    if (!rect.valid || rect.x1 <= x0 || rect.x0 >= x0 + width || rect.y1 <= y0 || rect.y0 >= y0 + height) continue;
    const uint8_t* rgb = LiveOcean::kSubjects[i].rgb;
    candidates[candidateCount] = i;
    bounds[candidateCount] = rect;
    colours[candidateCount] = rgb565(rgb[0], rgb[1], rgb[2]);
    ++candidateCount;
  }
  for (int16_t top = y0; top < y0 + height; top += kStripeRows) {
    const int16_t remaining = y0 + height - top;
    const int16_t rows = remaining < kStripeRows ? remaining : static_cast<int16_t>(kStripeRows);
    uint16_t* cursor = gStripe;
    for (int16_t y = top; y < top + rows; ++y) {
      const float v = LiveOcean::pixelCenter(opening.top, opening.bottom, y, kDisplayHeight);
      for (int16_t x = x0; x < x0 + width; ++x) {
        int hit = -1;
        float u = -1.0f;
        for (uint8_t k = 0; k < candidateCount; ++k) {
          const LiveOcean::Rect& rect = bounds[k];
          if (x < rect.x0 || x >= rect.x1 || y < rect.y0 || y >= rect.y1) continue;
          if (u < 0.0f) u = LiveOcean::pixelCenter(opening.left, opening.right, x, kDisplayWidth);
          if (LiveOcean::spriteOpaque(candidates[k], gShownPoses[candidates[k]], u, v)) {
            hit = k;
            break;
          }
        }
        if (hit >= 0) {
          *cursor++ = colours[hit];
          continue;
        }
        if (u < 0.0f) u = LiveOcean::pixelCenter(opening.left, opening.right, x, kDisplayWidth);
        const float mix = gMixTable ? gMixTable[y * kDisplayWidth + x] : LiveOcean::backgroundMix(u, v);
        uint8_t water[3];
        LiveOcean::mixRgb(waterTop, waterBottom, mix, water);
        *cursor++ = rgb565(water[0], water[1], water[2]);
      }
    }
    display.startWrite();
    display.setAddrWindow(x0, top, width, rows);
    display.writePixels(gStripe, static_cast<uint32_t>(width) * rows);
    display.endWrite();
  }
}

void drawFace(uint8_t index) { drawRegion(index, 0, 0, kDisplayWidth, kDisplayHeight); }

void repaintRect(uint8_t face, const LiveOcean::Rect& rect) {
  drawRegion(face, rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
}

// The rotated bounds of a subject on a panel that exists, or false if it is on no panel.
bool subjectRect(uint8_t index, const LiveOcean::Pose& pose, LiveOcean::Rect& rect) {
  if (pose.face >= kDisplayCount || !outputEnabledAt(pose.face) || !gDisplays[pose.face]) return false;
  rect = LiveOcean::subjectScreenRect(index, pose, kPhysicalFaceImage[pose.face], kDisplayWidth,
                                      LiveOcean::kDirtyMarginPx);
  return rect.valid;
}

void reticlePixel(const Projection& projection, int16_t& x, int16_t& y) {
  x = LiveOcean::reticleAxis(projection.pixelU, kDisplayWidth);
  y = LiveOcean::reticleAxis(projection.pixelV, kDisplayHeight);
}

// Restores water and any animal under the old cross; drawRegion composites every layer.
void eraseReticle(const Projection& projection) {
  if (!projection.face || !projection.visible) return;
  const int index = static_cast<int>(projection.face - kFaceBasis);
  int16_t x = 0, y = 0;
  reticlePixel(projection, x, y);
  const int16_t span = 2 * (kReticleArm + kReticleMargin) + 1;
  drawRegion(static_cast<uint8_t>(index), x - kReticleArm - kReticleMargin,
             y - kReticleArm - kReticleMargin, span, span);
}

void drawReticle(const Projection& projection, uint16_t color) {
  if (!projection.face || !projection.visible) return;
  const int index = static_cast<int>(projection.face - kFaceBasis);
  if (index < 0 || index >= kDisplayCount || !gDisplays[index]) return;
  int16_t x = 0, y = 0;
  reticlePixel(projection, x, y);
  Adafruit_ST7789& display = *gDisplays[index];
  display.drawFastHLine(x - kReticleArm, y, 2 * kReticleArm + 1, color);
  display.drawFastVLine(x, y - kReticleArm, 2 * kReticleArm + 1, color);
}

// A depth change repaints every face as one batch; only when it finishes does the new
// depth become the state that scanning and collecting are allowed to read.
void renderScene() {
  const uint32_t started = millis();
  gSceneUpdating = true;
  gDisplayedDepth = gDepthNorm;
  updateZone(gDisplayedDepth);
  presentLiveScene();
  for (uint8_t i = 0; i < kDisplayCount; ++i) drawFace(i);
  gSceneUpdating = false;
  const Projection next = currentProjection();
  drawReticle(next, ST77XX_RED);
  gLastProjection = next;
  gProjectionValid = true;
  gLastFullRedrawMs = millis() - started;
}

// One tick of motion: repaint each animal's old and new rotated bounds (one rectangle while it
// stays on a face), then put the reticle back on top.
void renderLiveTick() {
  const uint32_t started = millis();
  LiveOcean::Rect before[LiveOcean::kSubjectCount];
  bool hadBefore[LiveOcean::kSubjectCount];
  uint8_t faceBefore[LiveOcean::kSubjectCount];
  for (uint8_t i = 0; i < LiveOcean::kSubjectCount; ++i) {
    hadBefore[i] = subjectRect(i, gShownPoses[i], before[i]);
    faceBefore[i] = gShownPoses[i].face;
  }
  presentLiveScene();
  for (uint8_t i = 0; i < LiveOcean::kSubjectCount; ++i) {
    LiveOcean::Rect after{};
    const bool hasAfter = subjectRect(i, gShownPoses[i], after);
    if (hadBefore[i] && hasAfter && faceBefore[i] == gShownPoses[i].face) {
      LiveOcean::Rect merged = before[i];
      if (after.x0 < merged.x0) merged.x0 = after.x0;
      if (after.y0 < merged.y0) merged.y0 = after.y0;
      if (after.x1 > merged.x1) merged.x1 = after.x1;
      if (after.y1 > merged.y1) merged.y1 = after.y1;
      repaintRect(gShownPoses[i].face, merged);
    } else {
      if (hadBefore[i]) repaintRect(faceBefore[i], before[i]);
      if (hasAfter) repaintRect(gShownPoses[i].face, after);
    }
  }
  if (gProjectionValid) eraseReticle(gLastProjection);
  const Projection current = currentProjection();
  drawReticle(current, ST77XX_RED);
  gLastProjection = current;
  gProjectionValid = true;
  const uint32_t elapsed = millis() - started;
  if (elapsed > gLiveRenderMaxMs) gLiveRenderMaxMs = elapsed;
}

void renderReticleMove() {
  const Projection next = currentProjection();
  if (gProjectionValid) eraseReticle(gLastProjection);
  drawReticle(next, ST77XX_RED);
  gLastProjection = next;
  gProjectionValid = true;
}

void sendEvent(const char* name, const char* result, int subject) {
  String line = header("event") + ",\"t_ms\":" + millis() + ",\"name\":\"" + name + "\",\"result\":\"" + result + "\"";
  line += subject >= 0 ? String(",\"target_id\":\"") + LiveOcean::kSubjects[subject].id + "\""
                       : String(",\"target_id\":null");
  if (strcmp(name, "scan") == 0) line += String(",\"depth_norm\":") + String(gDisplayedDepth, 4);
  line += String(",\"renderer\":\"") + LiveOcean::kRenderer + "\",\"scene_version\":" +
          String(LiveOcean::kSceneVersion) + ",\"scene_tick\":" + String(gShownTick);
  sendLine(line + "}");
}

void scan() {
  const int subject = subjectUnderReticle(currentProjection());
  sendEvent("scan", subject >= 0 ? "hit" : "miss", subject);
}

void collectMiss(const char* reason) {
  sendLine(header("event") + ",\"t_ms\":" + millis() +
           ",\"name\":\"collect\",\"result\":\"miss\",\"reason\":\"" + reason + "\"}");
}

// Freeze exactly what is on the glass: the shown tick and depth, and a square of panel pixels
// around the animal. The laptop rebuilds those pixels from the same scene rules.
void collect() {
  if (gSceneUpdating) { collectMiss("scene_updating"); return; }
  const Projection projection = currentProjection();
  if (!projection.visible || !outputEnabledFor(projection)) { collectMiss("reticle_gap"); return; }
  const int subject = subjectUnderReticle(projection);
  if (subject < 0) { collectMiss("no_target"); return; }
  const LiveOcean::Pose& pose = gShownPoses[subject];
  const LiveOcean::Crop crop = LiveOcean::collectCrop(static_cast<uint8_t>(subject), pose,
                                                      kPhysicalFaceImage[pose.face], kDisplayWidth);
  const String sampleId = gSession + "-" + String(gSeq + 1);
  const String line = header("event") + ",\"t_ms\":" + millis() +
      ",\"name\":\"collect\",\"result\":\"candidate\",\"sample_id\":\"" + sampleId +
      "\",\"target_id\":\"" + LiveOcean::kSubjects[subject].id + "\",\"asset_pack\":\"" + kAssetPackId +
      "\",\"depth_norm\":" + String(gDisplayedDepth, 4) +
      ",\"crop\":{\"face_id\":\"" + kFaces[pose.face].id + "\",\"x\":" + String(static_cast<int>(crop.x)) +
      ",\"y\":" + String(static_cast<int>(crop.y)) + ",\"s\":" + String(static_cast<int>(crop.side)) +
      "},\"snapshot\":{\"renderer\":\"" + LiveOcean::kRenderer + "\",\"scene_version\":" +
      String(LiveOcean::kSceneVersion) + ",\"scene_tick\":" + String(gShownTick) +
      ",\"depth_norm\":" + String(gDisplayedDepth, 4) + ",\"yaw_deg\":" + String(gYawDeg, 2) + "}}";
  // Never let a truncated line reach the host as a half-parsed sample.
  if (line.length() > kMaxLineBytes) { collectMiss("event_too_long"); return; }
  gPendingSample = sampleId;
  gPendingSinceMs = millis();
  sendLine(line);
}

void analyze() { sendEvent("analyze", "requested", -1); }

void applyYaw(float degrees) {
  degrees = fmodf(degrees, 360.0f);
  if (degrees < 0) degrees += 360.0f;
  if (fabsf(degrees - gYawDeg) < 1e-4f) return;
  gYawDeg = degrees;
  gReticleRedrawPending = true;
}

// Depth is kept at the four decimals the board reports, so the laptop rebuilds a Collect with
// the exact depth the water was drawn at.
void applyDepth(float depth) {
  depth = roundf(clamp01(depth) * 10000.0f) / 10000.0f;
  if (fabsf(depth - gDepthNorm) < 1e-6f) return;
  gDepthNorm = depth;
  gFullRedrawPending = true;
}

// A diagnostic pattern stays up for kDiagnosticHoldMs, then the live scene is repainted in full.
// Scan and Collect answer scene_updating meanwhile, because the animals are not on the glass.
void holdDiagnostic() {
  gDiagnosticHoldUntilMs = millis() + kDiagnosticHoldMs;
  if (gDiagnosticHoldUntilMs == 0) gDiagnosticHoldUntilMs = 1;
  gSceneUpdating = true;
  gProjectionValid = false;
}

void handleHostLine(const String& line) {
  if (line.indexOf("\"type\":\"get_state\"") >= 0) { sendHello(); sendState(); return; }
  if (line.indexOf("\"type\":\"command\"") >= 0) {
    const String requestId = jsonStringField(line, "request_id");
    if (requestId.length() > 0 && requestId == gLastHostRequestId) {
      sendAck(requestId, "duplicate");
      return;
    }
    if (requestId.length() > 0) gLastHostRequestId = requestId;
    const String action = jsonStringField(line, "action");
    if (action == "hold_pin" || action == "scan_shorts" || action == "resume_sweep") {
      if (!kPanelSweepTest && !kPinTestMode) {
        sendAck(requestId, "rejected_not_pin_or_sweep_mode");
        return;
      }
    }
    if (action == "scan_shorts") {
      sendAck(requestId, "accepted");
      scanShorts();
      return;
    }
    if (action == "hold_pin") {
      const float requestedPin = jsonNumberField(line, "pin", -1.0f);
      if (!isfinite(requestedPin) || requestedPin < -1 || requestedPin > 48 ||
          requestedPin != floorf(requestedPin)) {
        sendAck(requestId, "rejected_invalid_pin");
        return;
      }
      const int pin = static_cast<int>(requestedPin);
      if (pin == -1) {
        sendAck(requestId, "accepted");
        resumePinOutput();
        return;
      }
      if (!isTestSignalPin(pin)) {
        sendAck(requestId, "rejected_invalid_pin");
        return;
      }
      holdSinglePin(pin);
      sendAck(requestId, "accepted");
      sendLine(header("log") + ",\"message\":\"holding GPIO" + String(pin) + " high, every other signal low\"}");
      return;
    }
    if (action == "resume_sweep") {
      sendAck(requestId, "accepted");
      resumePinOutput();
      return;
    }
    if (kPanelSweepTest || kPinTestMode) {
      sendAck(requestId, "rejected_bringup_mode");
      return;
    }
    if (action == "display_diagnostic" || action == "display_diagnostic_all") {
      if (action == "display_diagnostic_all") {
        bool anyReady = false;
        for (uint8_t i = 0; i < kDisplayCount; ++i) {
          if (outputEnabledAt(i) && gDisplays[i]) { anyReady = true; break; }
        }
        if (!anyReady) { sendAck(requestId, "rejected_no_enabled_panels"); return; }
        sendAck(requestId, "accepted");
        drawDisplayDiagnosticAll();
        holdDiagnostic();
        return;
      }
      const String faceId = jsonStringField(line, "face");
      const int index = displayIndexForId(faceId);
      if (index < 0) { sendAck(requestId, "rejected_unknown_face"); return; }
      if (!outputEnabledAt(static_cast<uint8_t>(index))) {
        sendAck(requestId, "rejected_disabled_face");
        return;
      }
      if (!gDisplays[index]) { sendAck(requestId, "rejected_uninitialized_face"); return; }
      sendAck(requestId, "accepted");
      drawDisplayDiagnostic(static_cast<uint8_t>(index));
      holdDiagnostic();
      return;
    }
    sendAck(requestId, "accepted");
    if (action == "scan") scan();
    else if (action == "collect") collect();
    else if (action == "analyze") analyze();
    else sendLog("unknown host command");
    return;
  }
  if (line.indexOf("\"type\":\"depth_delta\"") >= 0) {
    const String requestId = jsonStringField(line, "request_id");
    if (requestId.length() > 0 && requestId == gLastHostRequestId) {
      sendAck(requestId, "duplicate");
      return;
    }
    if (requestId.length() > 0) gLastHostRequestId = requestId;
    applyDepth(gDepthNorm + jsonNumberField(line, "delta_norm", 0.0f));
    sendAck(requestId, "accepted");
    return;
  }
  if (line.indexOf("\"type\":\"simulate\"") >= 0) {
    const int yawAt = line.indexOf("\"yaw\":");
    const int depthAt = line.indexOf("\"depth_norm\":");
    if (yawAt >= 0) applyYaw(line.substring(yawAt + 6).toFloat());
    if (depthAt >= 0) applyDepth(line.substring(depthAt + 13).toFloat());
    if (line.indexOf("\"scan\":true") >= 0) scan();
    if (line.indexOf("\"collect\":true") >= 0) collect();
    if (line.indexOf("\"analyze\":true") >= 0) analyze();
  }
  if (line.indexOf("\"type\":\"collect_ack\"") >= 0 && gPendingSample.length() > 0 &&
      line.indexOf(gPendingSample) >= 0) {
    sendLog(line.indexOf("\"status\":\"saved\"") >= 0 ? "collect acknowledged by laptop"
                                                     : "laptop rejected collect acknowledgement");
    gPendingSample = "";
    gPendingSinceMs = 0;
  }
}

void handleSerial() {
  static String line;
  while (Serial.available()) {
    const char ch = static_cast<char>(Serial.read());
    if (ch == '\n') { handleHostLine(line); line = ""; }
    else if (ch != '\r' && line.length() < kMaxLineBytes) line += ch;
  }
}

class DebouncedButton {
 public:
  explicit DebouncedButton(int8_t pin) : pin_(pin) {}
  void begin() {
    pinMode(pin_, INPUT_PULLUP);
    raw_ = stable_ = digitalRead(pin_);
  }
  bool pressed(uint32_t now) {
    const int raw = digitalRead(pin_);
    if (raw != raw_) { raw_ = raw; changedAt_ = now; }
    if (raw_ != stable_ && now - changedAt_ >= kButtonDebounceMs) {
      stable_ = raw_;
      if (stable_ == LOW && now - lastPress_ >= kButtonCooldownMs) { lastPress_ = now; return true; }
    }
    return false;
  }

 private:
  int8_t pin_;
  int raw_ = HIGH;
  int stable_ = HIGH;
  uint32_t changedAt_ = 0;
  uint32_t lastPress_ = 0;
};

DebouncedButton gScanButton(kButtonScan);
DebouncedButton gCollectButton(kButtonCollect);
DebouncedButton gAnalyzeButton(kButtonAnalyze);
DebouncedButton gWheelSwitch(kEncoderSwitch);

// Standard quadrature table indexed by (previous state << 2) | current state.
constexpr int8_t kQuadrature[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
uint8_t gEncoderState = 0;
int8_t gEncoderAccumulator = 0;

void setupInputs() {
  if (!kPhysicalControlsEnabled) return;
  gScanButton.begin();
  gCollectButton.begin();
  gAnalyzeButton.begin();
  pinMode(kEncoderA, INPUT_PULLUP);
  pinMode(kEncoderB, INPUT_PULLUP);
  gEncoderState = static_cast<uint8_t>((digitalRead(kEncoderA) << 1) | digitalRead(kEncoderB));
  if (kYawSource == YawSource::kEncoder) gWheelSwitch.begin();
}

void handleWheelDetent(int8_t direction) {
  if (kYawSource == YawSource::kEncoder && gWheelRole == WheelRole::kYaw) {
    applyYaw(gYawDeg + direction * kYawDegreesPerDetent * (kYawReverse ? -1.0f : 1.0f));
  } else {
    applyDepth(gDepthNorm + direction * kDepthStepPerDetent * (kDepthReverse ? -1.0f : 1.0f));
  }
}

void handleInputs() {
  if (!kPhysicalControlsEnabled) return;
  const uint32_t now = millis();

  const uint8_t state = static_cast<uint8_t>((digitalRead(kEncoderA) << 1) | digitalRead(kEncoderB));
  if (state != gEncoderState) {
    gEncoderAccumulator += kQuadrature[(gEncoderState << 2) | state];
    gEncoderState = state;
    while (gEncoderAccumulator >= kEncoderStepsPerDetent) {
      gEncoderAccumulator -= kEncoderStepsPerDetent;
      handleWheelDetent(1);
    }
    while (gEncoderAccumulator <= -kEncoderStepsPerDetent) {
      gEncoderAccumulator += kEncoderStepsPerDetent;
      handleWheelDetent(-1);
    }
  }

  if (kYawSource == YawSource::kEncoder && gWheelSwitch.pressed(now)) {
    gWheelRole = gWheelRole == WheelRole::kDepth ? WheelRole::kYaw : WheelRole::kDepth;
    sendLog(gWheelRole == WheelRole::kYaw ? "wheel now turns the cube heading"
                                          : "wheel now changes depth");
    sendState();
  }

  if (gScanButton.pressed(now)) scan();
  if (gCollectButton.pressed(now)) collect();
  if (gAnalyzeButton.pressed(now)) analyze();
}

bool outputEnabledAt(uint8_t index) {
  if (index >= kDisplayCount) return false;
  return kSingleDisplayTest ? index == kSingleDisplayIndex : kDisplayEnabled[index];
}

int displayIndexForId(const String& faceId) {
  for (uint8_t i = 0; i < kDisplayCount; ++i) {
    if (faceId == kFaces[i].id) return static_cast<int>(i);
  }
  return -1;
}

void prepareDisplayChipSelects() {
  for (uint8_t i = 0; i < kDisplayCount; ++i) {
    pinMode(kCs[i], OUTPUT);
    digitalWrite(kCs[i], HIGH);
  }
  pinMode(kDc, OUTPUT);
  digitalWrite(kDc, HIGH);
  sendLog("display CS lines prepared inactive before shared reset");
}

void sharedDisplayReset() {
  pinMode(kRst, OUTPUT);
  digitalWrite(kRst, HIGH);
  delay(5);
  digitalWrite(kRst, LOW);
  delay(20);
  digitalWrite(kRst, HIGH);
  delay(120);
  sendLog("shared display reset pulsed once");
}

void setupDisplays() {
  if (!kHardwarePinsConfirmed) {
    sendLog("hardware pins are unconfirmed; display output is disabled");
    return;
  }
  SPI.begin(kSck, -1, kMosi, -1);
  gStage = "spi_ready";
  if (kSingleDisplayTest) {
    // Reproduce exactly the arrangement that lit the very first panel: one CS line, the library
    // owning the reset pin and its own clock, and none of the shared-reset rework.
    const uint8_t only = kSingleDisplayIndex;
    gDisplays[only] = new Adafruit_ST7789(kCs[only], kDc, kRst);
    gDisplays[only]->init(kDisplayWidth, kDisplayHeight);
    gDisplays[only]->setSPISpeed(kLegacySpiClockHz);
    gDisplays[only]->setRotation(kFaces[only].rotation);
    gDisplays[only]->invertDisplay(kFaces[only].inversion);
    sendLog("single panel initialized the original way: library owns RST and clock");
    return;
  }
  prepareDisplayChipSelects();
  sharedDisplayReset();
  for (uint8_t i = 0; i < kDisplayCount; ++i) {
    if (!outputEnabledAt(i)) continue;
    // RST is shared and has already been pulsed once. Passing -1 prevents the
    // library from resetting every other panel during per-CS initialization.
    gDisplays[i] = new Adafruit_ST7789(kCs[i], kDc, -1);
    gDisplays[i]->init(kDisplayWidth, kDisplayHeight);
    // init() talks at the library's own default clock, which is much faster than kSpiClockHz. On
    // long hand-soldered wiring those start-up commands arrive corrupted and the panel never leaves
    // sleep, so the backlight glows over a blank screen. Send the essential start-up sequence again
    // at the slow clock we actually trust.
    gDisplays[i]->setSPISpeed(kSpiClockHz);
    gDisplays[i]->sendCommand(0x01);  // software reset
    delay(150);
    gDisplays[i]->sendCommand(0x11);  // sleep out
    delay(120);
    uint8_t pixelFormat = 0x55;       // 16-bit colour
    gDisplays[i]->sendCommand(0x3A, &pixelFormat, 1);
    delay(10);
    gDisplays[i]->sendCommand(0x13);  // normal display mode
    delay(10);
    gDisplays[i]->sendCommand(0x29);  // display on
    delay(10);
    gDisplays[i]->setRotation(kFaces[i].rotation);
    gDisplays[i]->invertDisplay(kFaces[i].inversion);
    sendLog((String("display initialized face ") + kFaces[i].id).c_str());
  }
}

void drawDisplayDiagnostic(uint8_t index) {
  if (index >= kDisplayCount || !outputEnabledAt(index) || !gDisplays[index]) return;
  static const uint16_t kColors[6] = {
      ST77XX_RED, ST77XX_GREEN, ST77XX_BLUE, ST77XX_YELLOW, ST77XX_CYAN, ST77XX_MAGENTA};
  Adafruit_ST7789& display = *gDisplays[index];
  display.fillScreen(kColors[index]);
  display.fillRect(0, 46, kDisplayWidth, 28, ST77XX_BLACK);
  display.fillRect(0, 74, kDisplayWidth, 28, ST77XX_WHITE);
  display.fillRect(0, 102, kDisplayWidth, 28, ST77XX_BLACK);
  display.drawTriangle(120, 12, 108, 32, 132, 32, ST77XX_WHITE);
  display.setCursor(16, 154);
  display.setTextColor(ST77XX_WHITE);
  display.setTextSize(2);
  display.print("FACE ");
  display.print(kFaces[index].id);
  display.setCursor(16, 182);
  display.print("UP");
}

void drawDisplayDiagnosticAll() {
  for (uint8_t i = 0; i < kDisplayCount; ++i) {
    if (outputEnabledAt(i) && gDisplays[i]) drawDisplayDiagnostic(i);
  }
  sendLog("display diagnostic painted all enabled faces");
}

void drawSingleDisplayPattern() {
  if (!kSingleDisplayTest || kSingleDisplayIndex >= kDisplayCount || !gDisplays[kSingleDisplayIndex]) return;
  Adafruit_ST7789& display = *gDisplays[kSingleDisplayIndex];
  display.fillScreen(ST77XX_BLACK);
  const int16_t barHeight = 28;
  display.fillRect(0, 46, kDisplayWidth, barHeight, ST77XX_RED);
  display.fillRect(0, 46 + barHeight, kDisplayWidth, barHeight, ST77XX_GREEN);
  display.fillRect(0, 46 + barHeight * 2, kDisplayWidth, barHeight, ST77XX_BLUE);
  display.drawTriangle(120, 12, 108, 32, 132, 32, ST77XX_WHITE);
  display.setCursor(16, 154);
  display.setTextColor(ST77XX_WHITE);
  display.setTextSize(2);
  display.print("FACE ");
  display.print(kFaces[kSingleDisplayIndex].id);
  display.setCursor(16, 182);
  display.print("UP");
}

// The water's gradient position depends only on where a pixel sits in its opening. Every panel
// has the same 0.2..0.8 opening, so the positions are computed once and kept in PSRAM; drawing is
// then two lerps per channel instead of two sines and a hash per pixel, with identical results.
void buildMixTable() {
  const ActiveImage& opening = kPhysicalFaceImage[0];
  for (uint8_t i = 1; i < kDisplayCount; ++i) {
    const ActiveImage& other = kPhysicalFaceImage[i];
    if (other.left != opening.left || other.top != opening.top || other.right != opening.right ||
        other.bottom != opening.bottom) {
      sendLog("panel openings differ; water is computed per pixel");
      return;
    }
  }
  gMixTable = static_cast<float*>(heap_caps_malloc(sizeof(float) * kDisplayWidth * kDisplayHeight, MALLOC_CAP_SPIRAM));
  if (!gMixTable) {
    sendLog("no PSRAM for the water table; water is computed per pixel");
    return;
  }
  for (int16_t y = 0; y < kDisplayHeight; ++y) {
    const float v = LiveOcean::pixelCenter(opening.top, opening.bottom, y, kDisplayHeight);
    for (int16_t x = 0; x < kDisplayWidth; ++x) {
      gMixTable[y * kDisplayWidth + x] =
          LiveOcean::backgroundMix(LiveOcean::pixelCenter(opening.left, opening.right, x, kDisplayWidth), v);
    }
  }
  // Read every value back. PSRAM that returns anything else would paint black water, so fall
  // back to computing each pixel rather than trust it.
  for (int16_t y = 0; y < kDisplayHeight; ++y) {
    const float v = LiveOcean::pixelCenter(opening.top, opening.bottom, y, kDisplayHeight);
    for (int16_t x = 0; x < kDisplayWidth; ++x) {
      const float want =
          LiveOcean::backgroundMix(LiveOcean::pixelCenter(opening.left, opening.right, x, kDisplayWidth), v);
      if (gMixTable[y * kDisplayWidth + x] != want) {
        heap_caps_free(gMixTable);
        gMixTable = nullptr;
        sendLog("PSRAM water table did not read back; water is computed per pixel");
        return;
      }
    }
  }
  sendLog("water table built in PSRAM and verified");
}

// --- Pin test ---------------------------------------------------------------------------------
// Swing display signals slowly enough for a multimeter. GPIO7 is nz CS, not a spare.
bool gPinTestLevel = false;
uint32_t gPinTestChangedMs = 0;
// -1 keeps the alternating swing; anything else holds that one pin high and every other low, so a
// wire can be traced to the pad it really lands on.
int gHeldPin = -1;
constexpr int8_t kTestSignalPins[] = {
    kSck, kMosi, kDc, kRst, kCs[0], kCs[1], kCs[2], kCs[3], kCs[4], kCs[5], kSparePin};

bool isTestSignalPin(int pin) {
  if (pin < 0) return false;
  for (int8_t candidate : kTestSignalPins) {
    if (pin == candidate) return true;
  }
  return false;
}

void pauseSweep() {
  if (!kPanelSweepTest || gSweepPaused) return;
  gSweepPaused = true;
  // Release the peripheral routing before driving SCK/MOSI as static GPIO outputs.
  SPI.end();
}

void holdSinglePin(int pin) {
  pauseSweep();
  for (int8_t candidate : kTestSignalPins) {
    if (candidate < 0) continue;
    pinMode(candidate, OUTPUT);
    digitalWrite(candidate, LOW);
  }
  gHeldPin = pin;
  if (pin >= 0) {
    pinMode(static_cast<uint8_t>(pin), OUTPUT);
    digitalWrite(static_cast<uint8_t>(pin), HIGH);
  }
}

void setupPinTest() {
  for (int8_t pin : kTestSignalPins) {
    if (pin < 0) continue;
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
  }
  if (kSparePin >= 0) digitalWrite(kSparePin, HIGH);
  sendLog("pin test running: every display signal swings every 5 s; GPIO7 is nz CS; no spare assigned");
}

void stepPinTest() {
  gPinTestLevel = !gPinTestLevel;
  for (int8_t pin : kTestSignalPins) {
    if (pin < 0) continue;
    digitalWrite(pin, gPinTestLevel ? HIGH : LOW);
  }
  if (kSparePin >= 0) digitalWrite(kSparePin, gPinTestLevel ? LOW : HIGH);
  sendLine(header("log") + ",\"message\":\"pin test signals " + (gPinTestLevel ? "HIGH 3.3V" : "LOW 0V") +
           ", GPIO7 is nz CS\"}");
}

// Drive one signal pin high while every other floats with a pull-down, then read them back. A pin
// that reads high is a candidate for inspection, not proof of a short: module pull-ups,
// especially on RST, can also make a signal read high.
void scanShorts() {
  const bool wasPaused = gSweepPaused;
  const int heldPin = gHeldPin;
  pauseSweep();
  const auto& pins = kTestSignalPins;
  const uint8_t count = sizeof(kTestSignalPins) / sizeof(kTestSignalPins[0]);
  String report;
  for (uint8_t i = 0; i < count; ++i) {
    if (pins[i] < 0) continue;
    for (uint8_t j = 0; j < count; ++j) {
      if (pins[j] >= 0) pinMode(pins[j], INPUT_PULLDOWN);
    }
    pinMode(pins[i], OUTPUT);
    digitalWrite(pins[i], HIGH);
    delay(4);
    for (uint8_t j = 0; j < count; ++j) {
      if (pins[j] < 0 || j == i) continue;
      if (digitalRead(pins[j]) == HIGH) {
        if (report.length() > 0) report += " ";
        report += String("GPIO") + pins[i] + "+GPIO" + pins[j];
      }
    }
    pinMode(pins[i], INPUT_PULLDOWN);
  }
  sendLine(header("log") + ",\"message\":\"short scan: " +
           (report.length() > 0 ? report : String("no high pairs detected")) +
           "; module pull-ups can read high without a short\"}");
  if (heldPin >= 0 || wasPaused) holdSinglePin(heldPin);
  else resumePinOutput();
}

// --- Panel bring-up sweep --------------------------------------------------------------------
// Forget the cube: initialize all six CS lines, including temporarily unplugged panels, and paint each with
// a solid colour, its face name and its CS number. A panel that lights up has a working CS, SCK,
// MOSI, DC, RST and supply; a dark one has a wiring or power fault. No laptop is involved.
uint8_t gSweepPhase = 0;
uint32_t gSweepPaintedMs = 0;

void setupSweepDisplays() {
  SPI.begin(kSck, -1, kMosi, -1);
  prepareDisplayChipSelects();
  sharedDisplayReset();
  for (uint8_t i = 0; i < kDisplayCount; ++i) {
    if (!gDisplays[i]) gDisplays[i] = new Adafruit_ST7789(kCs[i], kDc, -1);
    gDisplays[i]->init(kDisplayWidth, kDisplayHeight);
    // init() runs at the library's own fast clock. Repeat the start-up sequence at the slow clock
    // so a panel whose first start-up arrived corrupted still wakes up.
    gDisplays[i]->setSPISpeed(kSweepSpiClockHz);
    gDisplays[i]->sendCommand(0x01);
    delay(150);
    gDisplays[i]->sendCommand(0x11);
    delay(120);
    uint8_t pixelFormat = 0x55;
    gDisplays[i]->sendCommand(0x3A, &pixelFormat, 1);
    delay(10);
    gDisplays[i]->sendCommand(0x13);
    delay(10);
    gDisplays[i]->sendCommand(0x29);
    delay(10);
    gDisplays[i]->setRotation(0);
    gDisplays[i]->invertDisplay(kFaces[i].inversion);
    sendLog((String("sweep initialized face ") + kFaces[i].id + " on CS" + kCs[i]).c_str());
  }
}

void paintSweep() {
  if (gSweepPaused) return;
  static const uint16_t kSweepColors[6] = {ST77XX_RED, ST77XX_GREEN, ST77XX_BLUE,
                                           ST77XX_YELLOW, ST77XX_CYAN, ST77XX_MAGENTA};
  String painted;
  for (uint8_t i = 0; i < kDisplayCount; ++i) {
    if (!gDisplays[i]) continue;
    Adafruit_ST7789& display = *gDisplays[i];
    // Wake the panel every cycle. One corrupted byte on a long wire can land on sleep-in or
    // display-off, and then the panel stays black for good; re-sending these makes that recoverable
    // and turns a permanent blackout into a visible flicker we can measure.
    display.sendCommand(0x11);  // sleep out
    delay(6);
    display.sendCommand(0x29);  // display on
    display.fillScreen(kSweepColors[(i + gSweepPhase) % 6]);
    // A band that jumps between paints, so a frozen panel is obvious.
    display.fillRect(0, (gSweepPhase % 2) ? 168 : 24, kDisplayWidth, 40, ST77XX_BLACK);
    display.setTextColor(ST77XX_WHITE);
    display.setTextSize(4);
    display.setCursor(20, 72);
    display.print(kFaces[i].id);
    display.setTextSize(3);
    display.setCursor(20, 122);
    display.print("CS");
    display.print(kCs[i]);
    if (painted.length() > 0) painted += ",";
    painted += kFaces[i].id;
  }
  ++gSweepPhase;
  sendLine(header("log") + ",\"message\":\"sweep painted " + painted + "\",\"phase\":" + gSweepPhase + "}");
}

void resumePinOutput() {
  gHeldPin = -1;
  if (kPanelSweepTest) {
    if (gSweepPaused) {
      // Pin measurements can hold RST low; restore the entire panel setup before drawing.
      setupSweepDisplays();
      gSweepPaused = false;
    }
    paintSweep();
    gSweepPaintedMs = millis();
    sendLog("sweep resumed");
  } else if (kPinTestMode) {
    setupPinTest();
    gPinTestChangedMs = millis();
  }
}

// The LUNA-04 atlas may still sit in the filesystem partition from an earlier upload. The live
// renderer never mounts or samples it: every pixel is computed from live_ocean_render.h.

}

void setup() {
  // A full five-panel repaint takes a while; a larger receive buffer keeps held-key depth
  // commands from being dropped while it runs.
  Serial.setRxBufferSize(2048);
  Serial.begin(115200);
  // Bounded, not zero. Zero never blocks, but it drops whatever does not fit the FIFO, which
  // cut telemetry lines in half; see sendLine. A few milliseconds is a cost the loop can pay.
  Serial.setTxTimeoutMs(kSerialTxTimeoutMs);
  gStage = "serial_ready";
  // millis() is nearly the same on every boot, so a MAC+millis id repeated across resets and
  // the laptop deduper threw away the new session's events as replays of the old one. Mix in
  // hardware randomness so each boot is a session the dashboard has never seen.
  gSession = String("s3-") + String(static_cast<uint32_t>(ESP.getEfuseMac()), HEX) + "-" +
             String(millis()) + "-" + String(esp_random(), HEX);
  updateZone(gDisplayedDepth);

  if (kYawSource == YawSource::kNone) {
    sendLog("no heading input is configured; the cube renders one fixed heading");
  } else if (kYawSource == YawSource::kEncoder) {
    sendLog("heading comes from the wheel; there is no rotation sensor. press the wheel to swap depth and heading");
  }

  gStripe = static_cast<uint16_t*>(heap_caps_malloc(static_cast<size_t>(kDisplayWidth) * kStripeRows * 2,
                                                    MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL));
  if (!gStripe) sendLog("stripe buffer allocation failed; nothing will be drawn");

  if (kPinTestMode) {
    setupPinTest();
    sendHello();
    return;
  }

  if (kPanelSweepTest) {
    setupSweepDisplays();
    paintSweep();
    sendHello();
    return;
  }

  buildMixTable();

  setupDisplays();
  gStage = "panels_initialized";
  setupInputs();
  resetLiveScene();
  if (kHardwarePinsConfirmed) {
    if (kSingleDisplayTest) {
      drawSingleDisplayPattern();
    } else {
      // Power-on self test: colour bars and the face name on every panel for a moment, drawn by the
      // display library alone. A panel that shows these but not the ocean points at the renderer;
      // a panel that shows neither points at its wiring or supply.
      drawDisplayDiagnosticAll();
      delay(2500);
      renderScene();
    }
  }
  gFullRedrawPending = false;
  sendHello();
  sendState();
}

void loop() {
  gStage = "loop_running";
  if (millis() - gLastHeartbeatMs > kHeartbeatIntervalMs) {
    gLastHeartbeatMs = millis();
    sendHeartbeat();
  }

  if (kPinTestMode) {
    const uint32_t pinNow = millis();
    if (gHeldPin < 0 && pinNow - gPinTestChangedMs > kPinTestHalfPeriodMs) {
      gPinTestChangedMs = pinNow;
      stepPinTest();
    }
    handleSerial();
    return;
  }

  if (kPanelSweepTest) {
    const uint32_t sweepNow = millis();
    if (!gSweepPaused && sweepNow - gSweepPaintedMs > 2000) {
      gSweepPaintedMs = sweepNow;
      paintSweep();
    }
    handleSerial();
    return;
  }

  const uint32_t now = millis();
  const bool holding = gDiagnosticHoldUntilMs != 0 && static_cast<int32_t>(now - gDiagnosticHoldUntilMs) < 0;
  if (gDiagnosticHoldUntilMs != 0 && !holding) {
    gDiagnosticHoldUntilMs = 0;
    gFullRedrawPending = true;
  }

  if (kHardwarePinsConfirmed && !kSingleDisplayTest) {
    const uint32_t tick = now / LiveOcean::kTickMs;
    if (tick != gSceneTick) {
      gSceneTick = tick;
      advanceLiveScene();
      gLiveRedrawPending = true;
    }
  }

  if (!holding) {
    if (gFullRedrawPending) {
      gFullRedrawPending = false;
      gReticleRedrawPending = false;
      gLiveRedrawPending = false;
      if (kHardwarePinsConfirmed) {
        if (kSingleDisplayTest) drawSingleDisplayPattern();
        else renderScene();
      } else {
        gDisplayedDepth = gDepthNorm;
        updateZone(gDisplayedDepth);
      }
      sendState();
    } else if (gLiveRedrawPending) {
      gLiveRedrawPending = false;
      if (kHardwarePinsConfirmed && !kSingleDisplayTest) renderLiveTick();
    } else if (gReticleRedrawPending) {
      gReticleRedrawPending = false;
      if (kHardwarePinsConfirmed && !kSingleDisplayTest) renderReticleMove();
    }
  }

  // Render first, then consume host/input actions. A collect command therefore
  // snapshots the scene tick that is actually on the panels.
  handleSerial();
  handleInputs();

  if (gPendingSample.length() > 0 && millis() - gPendingSinceMs > kCollectAckTimeoutMs) {
    sendLog("collect acknowledgement timeout; the sample is not confirmed saved");
    gPendingSample = "";
    gPendingSinceMs = 0;
  }

  if (millis() - gLastStateMs > kStateIntervalMs) {
    gLastStateMs = millis();
    sendState();
  }
}
