#pragma once

#include <Arduino.h>
#include <Preferences.h>
#include <Wire.h>

namespace As5600 {

struct Reading {
  uint16_t raw = 0;
  uint8_t status = 0;
  uint8_t agc = 0;
  uint16_t magnitude = 0;
  float deg = 0.0f;
  uint32_t i2cErrors = 0;
  bool ok = false;
  bool hasSample = false;
  const char* magnet = "missing";
};

class Sensor {
 public:
  explicit Sensor(bool yawReverse = false);

  bool begin(TwoWire& wire, int sda = 1, int scl = 2);
  bool update();
  bool zero();

  const Reading& reading() const { return reading_; }
  bool available() const { return reading_.hasSample; }

 private:
  bool readRegisters(uint8_t start, uint8_t* destination, size_t count);
  float transformedDegrees(uint16_t raw) const;
  static float normalizeDegrees(float degrees);
  static float shortestDeltaDegrees(float previous, float current);
  void setFailure(const char* magnet);
  // Free a bus the sensor is still holding after a reset, then restart the driver.
  void recoverBus();

  TwoWire* wire_ = nullptr;
  int sdaPin_ = 1;
  int sclPin_ = 2;
  uint16_t failureRun_ = 0;
  Preferences preferences_;
  bool preferencesReady_ = false;
  bool yawReverse_ = false;
  bool haveGoodSample_ = false;
  float zeroDegrees_ = 0.0f;
  Reading reading_;
};

}
