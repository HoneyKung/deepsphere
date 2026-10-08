#include <Arduino.h>
#include <Wire.h>

#include "sensors/as5600.h"

namespace {

constexpr int kSdaPin = 1;
constexpr int kSclPin = 2;
// Set only from the user's clockwise rotation test. The default is the raw DIR=GND
// polarity and is deliberately not presented as a completed physical-direction calibration.
constexpr bool kYawReverse = false;
constexpr uint32_t kReadIntervalMs = 10;
constexpr uint32_t kSendIntervalMs = 40;

As5600::Sensor gSensor(kYawReverse);
String gCommandLine;
uint32_t gLastReadMs = 0;
uint32_t gLastSendMs = 0;

void sendYaw() {
  const As5600::Reading& reading = gSensor.reading();
  Serial.print("{\"v\":1,\"type\":\"yaw\",\"deg\":");
  Serial.print(reading.deg, 1);
  Serial.print(",\"raw\":");
  Serial.print(reading.raw);
  Serial.print(",\"ok\":");
  Serial.print(reading.ok ? "true" : "false");
  Serial.print(",\"magnet\":\"");
  Serial.print(reading.magnet);
  Serial.println("\"}");
}

void sendAck(bool ok) {
  Serial.print("{\"v\":1,\"type\":\"ack\",\"command\":\"as5600_zero\",\"ok\":");
  Serial.print(ok ? "true" : "false");
  Serial.println("}");
}

void handleCommand(const String& line) {
  const String trimmed = line;
  if (trimmed == "as5600_zero" || trimmed.indexOf("\"action\":\"as5600_zero\"") >= 0) {
    sendAck(gSensor.zero());
  }
}

void readCommands() {
  while (Serial.available()) {
    const char character = static_cast<char>(Serial.read());
    if (character == '\n' || character == '\r') {
      if (gCommandLine.length() > 0) {
        handleCommand(gCommandLine);
        gCommandLine = "";
      }
    } else if (gCommandLine.length() < 256) {
      gCommandLine += character;
    } else {
      gCommandLine = "";
    }
  }
}

}

void setup() {
  Serial.begin(115200);
  gSensor.begin(Wire, kSdaPin, kSclPin);
  const uint32_t now = millis();
  gLastReadMs = now - kReadIntervalMs;
  gLastSendMs = now - kSendIntervalMs;
}

void loop() {
  const uint32_t now = millis();
  readCommands();
  if (static_cast<int32_t>(now - gLastReadMs) >= static_cast<int32_t>(kReadIntervalMs)) {
    gLastReadMs = now;
    gSensor.update();
  }
  if (static_cast<int32_t>(now - gLastSendMs) >= static_cast<int32_t>(kSendIntervalMs)) {
    gLastSendMs = now;
    sendYaw();
  }
  delay(1);
}
