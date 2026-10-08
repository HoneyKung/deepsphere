// Panel bring-up check. Nothing here touches PSRAM, LittleFS, the atlas, the live-ocean
// renderer or any input pin. Its only job is to answer one question: do the panels light?
//
// Build and flash:
//   .venv\Scripts\python -m platformio run -e diag -t upload --upload-port COM6
//   .venv\Scripts\python -m platformio device monitor -e diag --port COM6
//
// What to watch on the glass:
//   Each panel is brought up one at a time, half a second apart, and filled with its own
//   colour plus its face name. If panel 1 lights and then goes dark as panel 3 comes up,
//   that is the 3V3 rail sagging, not the code. If a panel never lights at all while the
//   others do, that panel's CS, VCC, GND or the panel itself is the fault.

#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <Arduino.h>
#include <esp_random.h>
#include <SPI.h>
#include <esp_system.h>

namespace {

constexpr uint8_t kPanelCount = 5;
constexpr int8_t kSck = 12;
constexpr int8_t kMosi = 11;
constexpr int8_t kDc = 9;
constexpr int8_t kRst = 10;
// px, nx, py, ny, pz. nz has no panel and is left out entirely.
constexpr int8_t kCs[kPanelCount] = {8, 13, 4, 5, 6};
const char* kName[kPanelCount] = {"px", "nx", "py", "ny", "pz"};

// Deliberately slower than the 24 MHz the scene firmware asks for. Hand wiring that shares
// one clock across five panels is the usual reason a panel initializes but paints noise.
constexpr uint32_t kSpiHz = 8000000;

// The board's own WS2812 on GPIO21. USB CDC on this board has stayed silent through every
// capture attempt, so the LED is the only channel that reports progress without the host.
// Each stage sets a different colour, so a board that stops partway says where it stopped.
constexpr int8_t kOnboardLed = 21;

void stage(uint8_t r, uint8_t g, uint8_t b) {
  neopixelWrite(kOnboardLed, r, g, b);
}

constexpr uint16_t kW = 240;
constexpr uint16_t kH = 240;

Adafruit_ST7789* gPanel[kPanelCount] = {nullptr, nullptr, nullptr, nullptr, nullptr};

const uint16_t kColor[kPanelCount] = {ST77XX_RED, ST77XX_GREEN, ST77XX_BLUE, ST77XX_YELLOW,
                                      ST77XX_MAGENTA};

void paint(uint8_t i, uint16_t fill) {
  if (!gPanel[i]) return;
  Adafruit_ST7789& d = *gPanel[i];
  d.fillScreen(fill);
  // A white frame proves the panel's full addressable area, not just a lit backlight.
  d.drawRect(0, 0, kW, kH, ST77XX_WHITE);
  d.drawRect(1, 1, kW - 2, kH - 2, ST77XX_WHITE);
  d.setTextColor(ST77XX_WHITE);
  d.setTextSize(4);
  d.setCursor(70, 96);
  d.print(kName[i]);
  d.setTextSize(2);
  d.setCursor(70, 150);
  d.print("CS ");
  d.print(kCs[i]);
}

}  // namespace

char gBootId[20] = "diag-unset";

// Pin self-test (added 2026-09-18 by Claude). For every display signal pin: read it with the
// internal pull-down and pull-up (reveals an external pull or a short), then drive it high and low
// in input-output mode and read the pad back (reveals a pin that cannot reach the level it drives).
// Results are kept and reprinted every cycle so a reader that attaches late still sees them.
#include <driver/gpio.h>
String gSelfTest;

// AS5600 quick read (added 2026-09-18 by Claude, for the magnet demo check).
// I2C on SDA=GPIO1, SCL=GPIO2. Reports what answers on the bus, the magnet status bits and the
// raw angle, so a turn by hand can be seen without the panels.
#include <Wire.h>
constexpr uint8_t kAs5600Addr = 0x36;
bool gAs5600Found = false;

uint8_t as5600Read(uint8_t reg, bool* ok) {
  Wire.beginTransmission(kAs5600Addr);
  Wire.write(reg);
  if (Wire.endTransmission(true) != 0) { *ok = false; return 0; }
  if (Wire.requestFrom((int)kAs5600Addr, 1) != 1) { *ok = false; return 0; }
  *ok = true;
  return Wire.read();
}

void as5600Begin() {
  Wire.begin(1, 2, 100000);
  Serial.println("as5600: scanning I2C on SDA=GPIO1 SCL=GPIO2 ...");
  for (uint8_t a = 1; a < 127; ++a) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      Serial.printf("as5600: device answers at 0x%02X\n", a);
      if (a == kAs5600Addr) gAs5600Found = true;
    }
  }
  if (!gAs5600Found) Serial.println("as5600: NOT FOUND at 0x36 - check VCC/GND/SDA(GPIO1)/SCL(GPIO2)");
}

// Which phase of an I2C read fails, and at which bus speed. A joint with high resistance often
// passes a single ACK bit but not a whole byte, and often works again once the clock is slowed.
void as5600Probe() {
  const uint32_t speeds[] = {100000, 50000, 25000, 10000};
  for (uint32_t speed : speeds) {
    Wire.setClock(speed);
    delay(5);
    Wire.beginTransmission(kAs5600Addr);
    const uint8_t addrResult = Wire.endTransmission(true);
    Wire.beginTransmission(kAs5600Addr);
    Wire.write((uint8_t)0x0C);
    const uint8_t writeResult = Wire.endTransmission(true);
    const size_t got = Wire.requestFrom((int)kAs5600Addr, 2);
    uint8_t hi = 0, lo = 0;
    if (got == 2) { hi = Wire.read(); lo = Wire.read(); }
    Serial.printf("probe %6u Hz: addr=%u regwrite=%u bytes=%u raw=%u\n", (unsigned)speed,
                  (unsigned)addrResult, (unsigned)writeResult, (unsigned)got,
                  (unsigned)(((hi & 0x0F) << 8) | lo));
    Serial.flush();
  }
  Wire.setClock(100000);
}

void as5600Report() {
  if (!gAs5600Found) { Serial.println("as5600: not found"); return; }
  bool ok = true;
  const uint8_t status = as5600Read(0x0B, &ok);
  const uint8_t agc = as5600Read(0x1A, &ok);
  const uint8_t hi = as5600Read(0x0C, &ok);
  const uint8_t lo = as5600Read(0x0D, &ok);
  if (!ok) { Serial.println("as5600: read failed"); return; }
  const uint16_t raw = ((hi & 0x0F) << 8) | lo;
  const float deg = raw * 360.0f / 4096.0f;
  const bool md = status & 0x20, ml = status & 0x10, mh = status & 0x08;
  Serial.printf("as5600: raw=%u deg=%.1f magnet=%s agc=%u status=0x%02X\n", raw, deg,
                md ? (ml ? "weak" : (mh ? "strong" : "ok")) : "missing", agc, status);
}

void pinSelfTest() {
  const int8_t pins[] = {1, 2, 12, 11, 9, 10, 8, 13, 4, 5, 6, 7, 3};
  const char* names[] = {"SDA1", "SCL2", "SCK", "MOSI", "DC", "RST", "CS8", "CS13", "CS4", "CS5", "CS6", "CS7", "GPIO3"};
  for (size_t i = 0; i < sizeof(pins); ++i) {
    const gpio_num_t p = static_cast<gpio_num_t>(pins[i]);
    pinMode(pins[i], INPUT_PULLDOWN);
    delay(20);
    const int pd = digitalRead(pins[i]);
    pinMode(pins[i], INPUT_PULLUP);
    delay(20);
    const int pu = digitalRead(pins[i]);
    gpio_reset_pin(p);
    gpio_set_pull_mode(p, GPIO_FLOATING);
    gpio_set_direction(p, GPIO_MODE_INPUT_OUTPUT);
    gpio_set_level(p, 1);
    delay(20);
    const int hi = gpio_get_level(p);
    gpio_set_level(p, 0);
    delay(20);
    const int lo = gpio_get_level(p);
    gpio_set_direction(p, GPIO_MODE_INPUT);
    char line[120];
    snprintf(line, sizeof(line), "selftest %s gpio%d pulldown=%d pullup=%d drive1->%d drive0->%d %s\n",
             names[i], pins[i], pd, pu, hi, lo, (hi == 1 && lo == 0) ? "OK" : "STUCK");
    gSelfTest += line;
  }
}

void setup() {
  // Red the instant the sketch runs, before anything that could hang. If the LED never turns
  // red, the board is not running this firmware at all.
  pinMode(kOnboardLed, OUTPUT);
  stage(40, 0, 0);

  Serial.begin(115200);
  Serial.setTxTimeoutMs(50);
  delay(600);
  Serial.println();
  // A per-boot id, so a log that goes quiet and comes back says whether this is the same run.
  // millis() is nearly identical on every boot, so the randomness is what makes it distinct.
  snprintf(gBootId, sizeof(gBootId), "diag-%08x", (unsigned)esp_random());
  Serial.println("panel_check: five-panel bring-up, 8 MHz SPI, no PSRAM, no atlas");
  Serial.printf("panel_check: build %s %s, boot %s\n", __DATE__, __TIME__, gBootId);
  Serial.printf("panel_check: reset reason %d, free heap %u\n", (int)esp_reset_reason(),
                (unsigned)ESP.getFreeHeap());

  pinSelfTest();
  Serial.print(gSelfTest);
  as5600Begin();
  // Watch the address answer from the moment the bus starts: if the sensor answers and then stops,
  // the timestamp of the last answer says what it was doing when it went away.
  for (int i = 0; i < 24; ++i) {
    Wire.beginTransmission(kAs5600Addr);
    const uint8_t result = Wire.endTransmission(true);
    Serial.printf("watch %2d t=%lums addr=%u %s\n", i, (unsigned long)millis(), (unsigned)result,
                  result == 0 ? "ANSWERS" : "silent");
    Serial.flush();
    delay(250);
  }
  as5600Probe();

  // Yellow: past Serial, about to touch SPI.
  stage(40, 25, 0);
  SPI.begin(kSck, -1, kMosi, -1);

  // Every CS inactive before the shared reset, so one panel cannot latch another's traffic.
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
  Serial.println("panel_check: shared reset pulsed");
  // Cyan: the shared reset completed without a brownout.
  stage(0, 30, 30);

  for (uint8_t i = 0; i < kPanelCount; ++i) {
    Serial.printf("panel_check: bringing up %s on CS %d ...\n", kName[i], kCs[i]);
    Serial.flush();
    // RST is shared and already pulsed, so -1 keeps this init from resetting its neighbours.
    gPanel[i] = new Adafruit_ST7789(kCs[i], kDc, -1);
    gPanel[i]->init(kW, kH);
    gPanel[i]->setSPISpeed(kSpiHz);
    gPanel[i]->setRotation(0);
    gPanel[i]->invertDisplay(true);
    paint(i, kColor[i]);
    Serial.printf("panel_check: %s painted, free heap %u\n", kName[i],
                  (unsigned)ESP.getFreeHeap());
    Serial.flush();
    delay(500);
  }
  Serial.println("panel_check: all five brought up; now cycling colours forever");
}

void loop() {
  static uint8_t step = 0;
  static const uint16_t kCycle[4] = {ST77XX_RED, ST77XX_GREEN, ST77XX_BLUE, ST77XX_WHITE};
  for (uint8_t i = 0; i < kPanelCount; ++i) paint(i, kCycle[(step + i) % 4]);
  // Boot id and uptime on every line: a reader that attaches late, or after a gap, can tell a
  // reboot (new id, uptime restarted) from a link that dropped while this kept running.
  Serial.printf("panel_check: cycle %u, boot %s, uptime_ms %lu, free heap %u\n", (unsigned)step,
                gBootId, (unsigned long)millis(), (unsigned)ESP.getFreeHeap());
  as5600Report();
  if (step == 0) as5600Probe();
  step = (step + 1) % 4;
  delay(400);
}
