#pragma once

#include <stdint.h>

#include "math/cube_math.h"

namespace DeepSphereConfig {

// Nothing here drives a pin until the user has checked config/wiring-table.md against the
// cube they actually soldered. Flip this and the values below together, never separately.
// The user confirmed six panels on CS 8/3/4/5/6/7 on 17 September 2026, so display output is
// enabled. This confirms the six display CS lines and the shared SCK/MOSI/DC/RST/3V3/GND nets
// only. It does not confirm any physical
// control wiring, which stays off through kPhysicalControlsEnabled, and BL is unconnected
// on every panel because the backlight is fed from VCC on the module.
constexpr bool kHardwarePinsConfirmed = true;
// Physical input polling is independent from display-pin confirmation.
constexpr bool kPhysicalControlsEnabled = false;

// Where the cube heading comes from. Keep this in step with config/controls.json.
//   kNone    - no heading input at all; the cube renders one fixed heading.
//   kEncoder - the KY-040 drives the heading; its push switch swaps the wheel between
//              depth and heading.
// Rotation sensing is not enabled. GPIO1/2 are reserved for the next AS5600 phase;
// see config/wiring-table.md. Physical controls remain disabled.
enum class YawSource : uint8_t { kNone, kEncoder };
constexpr YawSource kYawSource = YawSource::kNone;

enum class WheelRole : uint8_t { kDepth, kYaw };
constexpr WheelRole kWheelRoleAtBoot = WheelRole::kDepth;

// True whenever no sensor is being read, so the board can say so instead of implying it
// measured something.
constexpr bool kUseSimulatedInputs = !kPhysicalControlsEnabled;

constexpr uint8_t kDisplayCount = 6;
// Pin test. True drives every display signal pin high for five seconds, then low for five, over
// and over. There is no spare reference pin: GPIO7 now carries nz CS. Nothing is drawn. Measure
// a wire at the panel end: a good line follows the swing, a dead line sits still.
constexpr int8_t kSparePin = -1;  // no spare pin assigned
constexpr bool kPinTestMode = false;
constexpr uint32_t kPinTestHalfPeriodMs = 5000;

// Panel bring-up sweep. True forgets the cube completely: every CS line in kCs is initialized and
// painted with a solid colour, its face name and its CS number, over and over, at a slower SPI
// clock. It needs no laptop, so the board can run it from a charger. Set false for the ocean.
constexpr bool kPanelSweepTest = true;
constexpr uint32_t kSweepSpiClockHz = 4000000;

// Set true only for the staged one-panel pattern check. It initializes no other CS line.
// Off now that the build targets five panels rather than one.
constexpr bool kSingleDisplayTest = false;
constexpr uint8_t kSingleDisplayIndex = 0;
// The clock the very first working single-panel test used, before any of this rework.
constexpr uint32_t kLegacySpiClockHz = 24000000;
// 24 MHz was a datasheet guess that was never measured on this cube. Five panels share one
// hand-wired clock line, and an over-fast clock initializes a panel but paints noise or
// nothing at all, so bring-up runs at 10 MHz. Raise it only after the panels are proven.
// Five panels on long hand-soldered SCK/MOSI runs showed corrupted pixels at 10 MHz, so the bus
// runs slow until the wiring is proven. Raise it in steps once the picture is clean.
constexpr uint32_t kSpiClockHz = 4000000;
constexpr uint16_t kDisplayWidth = 240;
constexpr uint16_t kDisplayHeight = 240;

// One stripe of pixels is built in RAM and pushed in a single SPI window.
constexpr uint16_t kStripeRows = 16;

constexpr uint16_t kAtlasWidth = 1024;
constexpr uint16_t kAtlasHeight = 512;
constexpr char kAtlasPath[] = "/sea_atlas_rgb565_be.bin";
constexpr char kAssetPackId[] = "luna-04-ocean-atlas";
// Live-ocean renderer, version, seed and tick come from live_ocean_generated.h, which
// tools/make_live_ocean_header.py writes from config/live_ocean.json.

// Display-pixel UV is the complete 240x240 panel. It is not a fake bezel mask.
constexpr CubeMath::ActiveImage kDisplayPixelMask = {0.0f, 0.0f, 1.0f, 1.0f};
// Retained only for the legacy shared-vector fixture; the renderer does not use it as a
// black border. Physical-face rectangles below decide whether a ray is in the real opening.
constexpr CubeMath::ActiveImage kActiveImage = {0.03f, 0.03f, 0.97f, 0.97f};
// Confirmed physical dimensions: 50 mm face, centered 30 mm opening, 10 mm frame on each side.
// Global mount and per-panel rotation/inversion remain calibration fixtures.
constexpr CubeMath::ActiveImage kPhysicalFaceImage[6] = {
    {0.20f, 0.20f, 0.80f, 0.80f}, {0.20f, 0.20f, 0.80f, 0.80f},
    {0.20f, 0.20f, 0.80f, 0.80f}, {0.20f, 0.20f, 0.80f, 0.80f},
    {0.20f, 0.20f, 0.80f, 0.80f}, {0.20f, 0.20f, 0.80f, 0.80f}
  };
// All six panels are available; nz now uses GPIO7. The ocean mask stays five-wide until
// six-panel bring-up passes. Sweep initializes all six regardless of this mask.
// A disabled ocean face draws no reticle and fails the hit test.
constexpr bool kDisplayEnabled[6] = {true, true, true, true, true, false};
constexpr CubeMath::SceneParams kScene = {0.0f, 0.28f, 0.10f, 0.90f};
constexpr CubeMath::Vec3 kAimWorld = {0.0f, -1.0f, 0.0f};

// Half-width of the reticle cross, and the margin repainted around its old position.
constexpr int16_t kReticleArm = 7;
constexpr int16_t kReticleMargin = 3;

// Zone boundaries for the ambience the laptop plays, with a margin so a depth resting on
// a boundary does not flap between two loops.
constexpr float kZoneBounds[2] = {0.25f, 0.65f};
constexpr float kZoneHysteresis = 0.03f;

constexpr float kDepthStepPerDetent = 0.02f;
constexpr float kYawDegreesPerDetent = 7.5f;
// Heading the cube starts at, so the reticle can be made to rest on a chosen face.
constexpr float kYawZeroOffsetDeg = 0.0f;
constexpr bool kYawReverse = false;
constexpr bool kDepthReverse = false;

// Quadrature edges per mechanical detent on the KY-040.
constexpr uint8_t kEncoderStepsPerDetent = 4;

constexpr uint32_t kButtonDebounceMs = 35;
constexpr uint32_t kButtonCooldownMs = 350;
constexpr uint32_t kStateIntervalMs = 200;
constexpr uint32_t kCollectAckTimeoutMs = 2000;

constexpr int8_t kSck = 12;
constexpr int8_t kMosi = 11;
constexpr int8_t kDc = 9;
constexpr int8_t kRst = 10;
// py/ny/pz moved off GPIO14/15/16 to GPIO4/5/6, which the user can actually solder to.
// Index 5 is the sixth panel, nz, assigned GPIO7 on 17 September 2026.
constexpr int8_t kCs[6] = {8, 3, 4, 5, 6, 7};

// The KY-040 is not wired at all: every control is on the laptop keyboard, so GPIO4/5/6 were
// given to display CS instead. -1 means the pin is unassigned; the wheel needs three free
// GPIOs back before kYawSource can be set to kEncoder.
constexpr int8_t kEncoderSwitch = -1;
constexpr int8_t kEncoderA = -1;
constexpr int8_t kEncoderB = -1;
constexpr int8_t kButtonScan = 1;
constexpr int8_t kButtonCollect = 2;
// Analyze has no physical button; GPIO3 is nx CS. Laptop numpad input is used instead.
constexpr int8_t kButtonAnalyze = -1;
// No alternative is assigned: GPIO7 is nz CS. Legacy button constants stay disabled.
constexpr int8_t kButtonAnalyzeRecommended = -1;

struct FaceConfig {
  const char* id;
  int8_t screen;
  int8_t cs;
  uint8_t rotation;
  bool inversion;
};

constexpr FaceConfig kFaces[6] = {
    {"px", 1, 8, 0, true},
    {"nx", 2, 3, 0, true},
    {"py", 3, 4, 0, true},
    {"ny", 4, 5, 0, true},
    {"pz", 5, 6, 0, true},
    {"nz", 6, 7, 0, true}
  };

// Face geometry. Kept in the same order as kFaces and config/faces.json.
// Screen-down is world -Z on all four side faces and (right, down, -normal) is right-handed on
// every face, so no panel reads mirrored or a quarter turned against its neighbours. Corrected
// on 11 September 2026; see docs/digital-twin.md section 6.
constexpr CubeMath::FaceBasis kFaceBasis[6] = {
    {"px", {1, 0, 0}, {0, 1, 0}, {0, 0, -1}},
    {"nx", {-1, 0, 0}, {0, -1, 0}, {0, 0, -1}},
    {"py", {0, 1, 0}, {-1, 0, 0}, {0, 0, -1}},
    {"ny", {0, -1, 0}, {1, 0, 0}, {0, 0, -1}},
    {"pz", {0, 0, 1}, {1, 0, 0}, {0, -1, 0}},
    {"nz", {0, 0, -1}, {-1, 0, 0}, {0, -1, 0}}
  };

// Cube resting pose. Identity until the physical orientation is measured.
constexpr float kMount[3][3] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};

constexpr const char* yawSourceName() {
  return kYawSource == YawSource::kEncoder ? "encoder" : "none";
}

}
