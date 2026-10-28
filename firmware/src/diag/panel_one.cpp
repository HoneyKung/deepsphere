#include "reset_probe.h"
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <Arduino.h>
#include <SPI.h>

namespace {

constexpr uint8_t kPanelCount = 6;
constexpr int8_t kSck = 12;
constexpr int8_t kMosi = 11;
constexpr int8_t kDc = 9;
constexpr int8_t kRst = 10;
constexpr int8_t kCs[kPanelCount] = {8, 3, 4, 5, 6, 7};
const char* const kFace[kPanelCount] = {"px", "nx", "py", "ny", "pz", "nz"};
constexpr uint32_t kSpiHz = 4000000;
constexpr uint16_t kWidth = 240;
constexpr uint16_t kHeight = 240;
constexpr uint32_t kPanelMs = 8000;
constexpr uint32_t kTogetherMs = 20000;
constexpr uint16_t kColor[kPanelCount] = {
    ST77XX_RED, ST77XX_GREEN, ST77XX_BLUE, ST77XX_YELLOW, ST77XX_MAGENTA, ST77XX_CYAN};

Adafruit_ST7789* gPanel[kPanelCount] = {};

enum class Mode : uint8_t { Automatic, OnePanel, Together };
Mode gMode = Mode::Automatic;
uint8_t gLockedPanel = 0;
uint8_t gNextPanel = 0;
bool gTogetherActive = false;
uint32_t gPhaseStarted = 0;

void reportPanel(uint8_t i) {
  Serial.printf("panel_one: phase=A idx=%u face=%s cs=%d\n", i + 1, kFace[i], kCs[i]);
}

void reportTogether() {
  Serial.println("panel_one: phase=B idx=all faces=px,nx,py,ny,pz,nz cs=8,3,4,5,6,7");
}

void prepareSharedBus() {
  SPI.begin(kSck, -1, kMosi, -1);
  for (uint8_t i = 0; i < kPanelCount; ++i) {
    pinMode(kCs[i], OUTPUT);
    digitalWrite(kCs[i], HIGH);
  }
  pinMode(kDc, OUTPUT);
  digitalWrite(kDc, HIGH);
  pinMode(kRst, OUTPUT);
  digitalWrite(kRst, HIGH);
  delay(10);
  digitalWrite(kRst, LOW);
  delay(50);
  digitalWrite(kRst, HIGH);
  delay(150);
}

void resetAllPanels() {
  for (uint8_t i = 0; i < kPanelCount; ++i) digitalWrite(kCs[i], HIGH);
  digitalWrite(kRst, HIGH);
  delay(10);
  digitalWrite(kRst, LOW);
  delay(50);
  digitalWrite(kRst, HIGH);
  delay(150);
}

void drawPanel(uint8_t i) {
  Adafruit_ST7789& display = *gPanel[i];
  display.fillScreen(kColor[i]);
  display.drawRect(0, 0, kWidth, kHeight, ST77XX_WHITE);
  display.drawRect(2, 2, kWidth - 4, kHeight - 4, ST77XX_WHITE);
  display.setTextColor(ST77XX_WHITE);
  display.setTextSize(10);
  display.setCursor(88, 42);
  display.print(i + 1);
  display.setTextSize(4);
  display.setCursor(48, 142);
  display.print(kFace[i]);
  display.setTextSize(2);
  display.setCursor(78, 194);
  display.print("CS GPIO");
  display.print(kCs[i]);
}

void initPanel(uint8_t i) {
  for (uint8_t j = 0; j < kPanelCount; ++j) digitalWrite(kCs[j], HIGH);
  if (gPanel[i] == nullptr) gPanel[i] = new Adafruit_ST7789(kCs[i], kDc, -1);
  gPanel[i]->init(kWidth, kHeight);
  gPanel[i]->setSPISpeed(kSpiHz);
  gPanel[i]->sendCommand(0x01);
  delay(150);
  gPanel[i]->sendCommand(0x11);
  delay(120);
  uint8_t pixelFormat = 0x55;
  gPanel[i]->sendCommand(0x3A, &pixelFormat, 1);
  delay(10);
  gPanel[i]->sendCommand(0x13);
  delay(10);
  gPanel[i]->sendCommand(0x29);
  delay(10);
  gPanel[i]->setRotation(0);
  gPanel[i]->invertDisplay(true);
}

void initAndDraw(uint8_t i) {
  resetAllPanels();
  initPanel(i);
  drawPanel(i);
}

void startPanel(uint8_t i) {
  gTogetherActive = false;
  initAndDraw(i);
  reportPanel(i);
  gPhaseStarted = millis();
}

void startTogether() {
  for (uint8_t i = 0; i < kPanelCount; ++i) {
    for (uint8_t j = 0; j < kPanelCount; ++j) digitalWrite(kCs[j], HIGH);
    initPanel(i);
  }
  for (uint8_t i = 0; i < kPanelCount; ++i) drawPanel(i);
  gTogetherActive = true;
  reportTogether();
  gPhaseStarted = millis();
}

void selectPanel(uint8_t i) {
  gMode = Mode::OnePanel;
  gLockedPanel = i;
  startPanel(i);
}

void handleSerial() {
  while (Serial.available() > 0) {
    const char command = static_cast<char>(Serial.read());
    if (command >= '1' && command <= '6') {
      selectPanel(static_cast<uint8_t>(command - '1'));
    } else if (command == 'b' || command == 'B') {
      gMode = Mode::Together;
      startTogether();
    } else if (command == 'r') {
      resetProbeRequest();
    } else if (command == 'a' || command == 'A') {
      gMode = Mode::Automatic;
      gNextPanel = 0;
      Serial.println("panel_one: automatic mode");
      startPanel(gNextPanel);
    }
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  resetProbeBoot();
  Serial.setTxTimeoutMs(50);
  prepareSharedBus();
  Serial.println("panel_one: ready; commands 1-6=lock panel, b=hold phase B, a=automatic");
  gMode = Mode::Automatic;
  gNextPanel = 0;
  startPanel(gNextPanel);
}

void loop() {
  handleSerial();
  resetProbeTick();
  const uint32_t elapsed = millis() - gPhaseStarted;
  if (gMode == Mode::Automatic) {
    if (!gTogetherActive && elapsed >= kPanelMs) {
      ++gNextPanel;
      if (gNextPanel < kPanelCount) {
        startPanel(gNextPanel);
      } else {
        startTogether();
      }
    } else if (gTogetherActive && elapsed >= kTogetherMs) {
      gNextPanel = 0;
      startPanel(gNextPanel);
    }
  }
  delay(5);
}
