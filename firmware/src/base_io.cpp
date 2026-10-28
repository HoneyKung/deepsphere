#include <Arduino.h>

namespace {

constexpr uint8_t kWheelClkPin = 32;
constexpr uint8_t kWheelDtPin = 33;
constexpr uint8_t kWheelSwitchPin = 25;
constexpr uint8_t kScanPin = 26;
constexpr uint8_t kCollectPin = 27;
constexpr uint8_t kAnalyzePin = 13;
constexpr uint32_t kButtonDebounceMs = 35;
constexpr uint32_t kWheelBatchMs = 20;
constexpr uint32_t kHelloIntervalMs = 5000;
constexpr size_t kUartLineLimit = 512;

struct Button {
  const char* name;
  uint8_t pin;
  bool stablePressed;
  bool candidatePressed;
  uint32_t candidateSince;
};

Button gButtons[] = {
    {"wheel", kWheelSwitchPin, false, false, 0},
    {"scan", kScanPin, false, false, 0},
    {"collect", kCollectPin, false, false, 0},
    {"analyze", kAnalyzePin, false, false, 0},
};
constexpr size_t kButtonCount = sizeof(gButtons) / sizeof(gButtons[0]);

const int8_t kQuadratureTable[16] = {
    0, 1, -1, 0,
    -1, 0, 0, 1,
    1, 0, 0, -1,
    0, -1, 1, 0,
};

uint8_t gPreviousWheelState = 0;
int8_t gWheelTransitionCount = 0;
int32_t gPendingWheelDelta = 0;
uint32_t gWheelBatchStartedAt = 0;
uint32_t gLastHelloAt = 0;
char gUartLine[kUartLineLimit];
size_t gUartLineLength = 0;

uint8_t readWheelState() {
  return static_cast<uint8_t>((digitalRead(kWheelClkPin) << 1) | digitalRead(kWheelDtPin));
}

void emitLine(const char* line) {
  Serial.println(line);
  Serial2.println(line);
}

void sendHello() {
  Serial.println("{\"v\":1,\"type\":\"hello\",\"board\":\"base-io\"}");
}

void emitWheelDelta(int32_t delta) {
  char line[80];
  snprintf(line, sizeof(line), "{\"v\":1,\"type\":\"wheel\",\"delta\":%ld}",
           static_cast<long>(delta));
  emitLine(line);
}

void emitButton(const char* name, bool pressed) {
  char line[112];
  snprintf(line, sizeof(line),
           "{\"v\":1,\"type\":\"button\",\"name\":\"%s\",\"state\":\"%s\"}",
           name, pressed ? "down" : "up");
  emitLine(line);
}

void pollButtons(uint32_t now) {
  for (size_t i = 0; i < kButtonCount; ++i) {
    Button& button = gButtons[i];
    const bool pressed = digitalRead(button.pin) == LOW;
    if (pressed != button.candidatePressed) {
      button.candidatePressed = pressed;
      button.candidateSince = now;
    }
    if (button.candidatePressed != button.stablePressed &&
        static_cast<uint32_t>(now - button.candidateSince) >= kButtonDebounceMs) {
      button.stablePressed = button.candidatePressed;
      emitButton(button.name, button.stablePressed);
    }
  }
}

void readRotary() {
  const uint8_t current = readWheelState();
  const uint8_t transition = static_cast<uint8_t>((gPreviousWheelState << 2) | current);
  const int8_t movement = kQuadratureTable[transition];
  gPreviousWheelState = current;
  if (movement != 0) {
    gWheelTransitionCount += movement;
  } else if (current != 0b11) {
    return;
  }
  // KY-040 detents rest at 0b11. Use that anchor to recover when one edge was missed.
  if (current == 0b11) {
    if (gWheelTransitionCount > 0) {
      if (gPendingWheelDelta == 0) gWheelBatchStartedAt = millis();
      ++gPendingWheelDelta;
    } else if (gWheelTransitionCount < 0) {
      if (gPendingWheelDelta == 0) gWheelBatchStartedAt = millis();
      --gPendingWheelDelta;
    }
    gWheelTransitionCount = 0;
  }
}

void flushWheelBatch(uint32_t now) {
  if (gPendingWheelDelta == 0 || static_cast<uint32_t>(now - gWheelBatchStartedAt) < kWheelBatchMs) return;
  emitWheelDelta(gPendingWheelDelta);
  gPendingWheelDelta = 0;
}

void forwardUartLines() {
  while (Serial2.available() > 0) {
    const char character = static_cast<char>(Serial2.read());
    if (character == '\n') {
      Serial.write(reinterpret_cast<const uint8_t*>(gUartLine), gUartLineLength);
      Serial.write('\n');
      gUartLineLength = 0;
    } else if (gUartLineLength < sizeof(gUartLine)) {
      gUartLine[gUartLineLength++] = character;
    } else {
      gUartLineLength = 0;
    }
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  Serial2.begin(115200, SERIAL_8N1, 16, 17);

  pinMode(kWheelClkPin, INPUT_PULLUP);
  pinMode(kWheelDtPin, INPUT_PULLUP);
  for (size_t i = 0; i < kButtonCount; ++i) {
    pinMode(gButtons[i].pin, INPUT_PULLUP);
  }
  gPreviousWheelState = readWheelState();
  const uint32_t now = millis();
  gWheelBatchStartedAt = now;
  for (size_t i = 0; i < kButtonCount; ++i) {
    gButtons[i].stablePressed = digitalRead(gButtons[i].pin) == LOW;
    gButtons[i].candidatePressed = gButtons[i].stablePressed;
    gButtons[i].candidateSince = now;
  }
  sendHello();
  gLastHelloAt = now;
}

void loop() {
  const uint32_t now = millis();
  readRotary();
  flushWheelBatch(now);
  pollButtons(now);
  forwardUartLines();
  if (static_cast<uint32_t>(now - gLastHelloAt) >= kHelloIntervalMs) {
    sendHello();
    gLastHelloAt = now;
  }
  delay(1);
}
