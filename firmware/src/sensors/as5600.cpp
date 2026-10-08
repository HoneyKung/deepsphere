#include "as5600.h"

#include <cmath>

namespace As5600 {

namespace {

constexpr uint8_t kAddress = 0x36;
constexpr uint8_t kStatusRegister = 0x0B;
constexpr uint8_t kRawAngleRegister = 0x0C;
constexpr uint8_t kAgcRegister = 0x1A;
constexpr uint8_t kMagnitudeRegister = 0x1B;
constexpr uint8_t kMagnetDetectedBit = 5;
constexpr uint8_t kMagnetWeakBit = 4;
constexpr uint8_t kMagnetStrongBit = 3;
constexpr float kRawSteps = 4096.0f;
constexpr float kFullTurnDegrees = 360.0f;
constexpr float kDeadbandDegrees = 0.15f;

}

Sensor::Sensor(bool yawReverse) : yawReverse_(yawReverse) {}

bool Sensor::begin(TwoWire& wire, int sda, int scl) {
  wire_ = &wire;
  sdaPin_ = sda;
  sclPin_ = scl;
  // Bus recovery before the driver starts. A reset that lands in the middle of a read leaves the
  // sensor holding SDA low, and Wire cannot start while it is held: every later read then fails
  // until the sensor loses power. Clocking SCL until SDA is released, then issuing a stop, frees
  // it. Costs under a millisecond when the bus is already idle. Added 2026-09-18 by Claude after
  // the bridge's connect-time reset left the bus stuck.
  pinMode(sda, INPUT_PULLUP);
  pinMode(scl, INPUT_PULLUP);
  delayMicroseconds(10);
  for (int i = 0; i < 9 && digitalRead(sda) == LOW; ++i) {
    pinMode(scl, OUTPUT);
    digitalWrite(scl, LOW);
    delayMicroseconds(10);
    pinMode(scl, INPUT_PULLUP);
    delayMicroseconds(10);
  }
  if (digitalRead(sda) == LOW || digitalRead(scl) == LOW) {
    // Stop condition: SDA rises while SCL is high.
    pinMode(sda, OUTPUT);
    digitalWrite(sda, LOW);
    delayMicroseconds(10);
    pinMode(scl, INPUT_PULLUP);
    delayMicroseconds(10);
    pinMode(sda, INPUT_PULLUP);
    delayMicroseconds(10);
  }
  wire_->begin(sda, scl);
  // 100 kHz, not 400 kHz. The pull-ups on the module are about 10k and the sensor sits on plug
  // wires, which is well outside what 400 kHz tolerates.
  wire_->setClock(100000);
  wire_->setTimeOut(5);
  preferencesReady_ = preferences_.begin("as5600", false);
  if (preferencesReady_) zeroDegrees_ = normalizeDegrees(preferences_.getFloat("zero_deg", 0.0f));
  return true;
}

float Sensor::normalizeDegrees(float degrees) {
  float result = std::fmod(degrees, kFullTurnDegrees);
  if (result < 0.0f) result += kFullTurnDegrees;
  return result;
}

float Sensor::shortestDeltaDegrees(float previous, float current) {
  return std::fmod(current - previous + 540.0f, kFullTurnDegrees) - 180.0f;
}

float Sensor::transformedDegrees(uint16_t raw) const {
  const float physical = static_cast<float>(raw & 0x0FFFu) * kFullTurnDegrees / kRawSteps;
  const float directed = yawReverse_ ? -physical : physical;
  return normalizeDegrees(directed - zeroDegrees_);
}

bool Sensor::readRegisters(uint8_t start, uint8_t* destination, size_t count) {
  if (wire_ == nullptr || count == 0) return false;
  wire_->beginTransmission(kAddress);
  wire_->write(start);
  // Stop after the register pointer instead of a repeated start. The AS5600 accepts both, but a
  // repeated start is what fails first on plug wiring, and on this build every read failed that
  // way while the address itself still answered. Changed 2026-09-18 by Claude.
  if (wire_->endTransmission(true) != 0) return false;
  const size_t received = wire_->requestFrom(kAddress, count, true);
  if (received != count) {
    while (wire_->available()) static_cast<void>(wire_->read());
    return false;
  }
  for (size_t i = 0; i < count; ++i) destination[i] = static_cast<uint8_t>(wire_->read());
  return true;
}

void Sensor::setFailure(const char* magnet) {
  reading_.ok = false;
  reading_.magnet = magnet;
  ++reading_.i2cErrors;
}

// A reset that lands mid-read leaves the sensor holding SDA low, and every later read then fails
// for good. After a short run of failures, clock the bus free and restart the driver so the demo
// recovers by itself instead of needing the sensor's power pulled.
void Sensor::recoverBus() {
  if (wire_ == nullptr) return;
  wire_->end();
  pinMode(sdaPin_, INPUT_PULLUP);
  pinMode(sclPin_, INPUT_PULLUP);
  delayMicroseconds(10);
  for (int i = 0; i < 9 && digitalRead(sdaPin_) == LOW; ++i) {
    pinMode(sclPin_, OUTPUT);
    digitalWrite(sclPin_, LOW);
    delayMicroseconds(10);
    pinMode(sclPin_, INPUT_PULLUP);
    delayMicroseconds(10);
  }
  pinMode(sdaPin_, OUTPUT);
  digitalWrite(sdaPin_, LOW);
  delayMicroseconds(10);
  pinMode(sdaPin_, INPUT_PULLUP);
  delayMicroseconds(10);
  wire_->begin(sdaPin_, sclPin_);
  wire_->setClock(100000);
  wire_->setTimeOut(5);
}

bool Sensor::update() {
  uint8_t angleAndStatus[3] = {0, 0, 0};
  uint8_t agcAndMagnitude[3] = {0, 0, 0};
  if (!readRegisters(kStatusRegister, angleAndStatus, sizeof(angleAndStatus)) ||
      !readRegisters(kAgcRegister, agcAndMagnitude, sizeof(agcAndMagnitude))) {
    setFailure("missing");
    if (++failureRun_ >= 20) {  // about 0.2 s of failed reads
      failureRun_ = 0;
      recoverBus();
    }
    return false;
  }
  failureRun_ = 0;

  reading_.status = angleAndStatus[0];
  reading_.raw = (static_cast<uint16_t>(angleAndStatus[1]) << 8 | angleAndStatus[2]) & 0x0FFFu;
  reading_.agc = agcAndMagnitude[0];
  reading_.magnitude = (static_cast<uint16_t>(agcAndMagnitude[1]) << 8 | agcAndMagnitude[2]) & 0x0FFFu;
  reading_.hasSample = true;
  reading_.ok = false;

  if ((reading_.status & (1u << kMagnetStrongBit)) != 0) {
    reading_.magnet = "strong";
  } else if ((reading_.status & (1u << kMagnetWeakBit)) != 0) {
    reading_.magnet = "weak";
  } else if ((reading_.status & (1u << kMagnetDetectedBit)) == 0) {
    reading_.magnet = "missing";
  } else {
    reading_.magnet = "ok";
    reading_.ok = true;
  }

  if (reading_.ok) {
    const float candidate = transformedDegrees(reading_.raw);
    if (!haveGoodSample_ || std::fabs(shortestDeltaDegrees(reading_.deg, candidate)) > kDeadbandDegrees) {
      reading_.deg = candidate;
    }
    haveGoodSample_ = true;
  }
  return reading_.ok;
}

bool Sensor::zero() {
  if (!reading_.ok || !haveGoodSample_) return false;
  const float directed = yawReverse_
      ? -static_cast<float>(reading_.raw & 0x0FFFu) * kFullTurnDegrees / kRawSteps
      : static_cast<float>(reading_.raw & 0x0FFFu) * kFullTurnDegrees / kRawSteps;
  zeroDegrees_ = normalizeDegrees(directed);
  if (preferencesReady_) preferences_.putFloat("zero_deg", zeroDegrees_);
  reading_.deg = 0.0f;
  return true;
}

}
