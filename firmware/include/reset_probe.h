#pragma once

#include <Arduino.h>
#include <esp_attr.h>
#include <esp_system.h>
#include <esp32s3/rom/rtc.h>
#include <cstdio>

namespace ResetProbe {

constexpr uint32_t kMagic = 0x52535450;
constexpr size_t kHistorySize = 8;

struct State {
  uint32_t magic;
  uint32_t bootsSincePowerOn;
  uint8_t history[kHistorySize];
  uint8_t historyCount;
  uint8_t historyNext;
  uint8_t core0;
  uint8_t core1;
  int espReason;
};

static RTC_NOINIT_ATTR State state;
static uint32_t nextReportAt = 0;

inline const char* resetName(uint8_t reason) {
  switch (reason) {
    case 0x01: return "POWER_ON";
    case 0x03: return "SW";
    case 0x05: return "DEEP_SLEEP";
    case 0x07: return "MWDT0";
    case 0x08: return "MWDT1";
    case 0x09: return "RTC_WDT";
    case 0x0B: return "MWDT0";
    case 0x0C: return "SW";
    case 0x0D: return "RTC_WDT";
    case 0x0F: return "BROWN_OUT";
    case 0x10: return "RTC_WDT";
    case 0x11: return "MWDT1";
    case 0x12: return "SUPER_WDT";
    case 0x13: return "CLK_GLITCH";
    case 0x14: return "EFUSE_CRC";
    case 0x15: return "USB_UART";
    case 0x16: return "USB_JTAG";
    case 0x17: return "PWR_GLITCH";
    default: return "UNKNOWN";
  }
}

inline String resetProbeLine() {
  char line[384];
  int used = snprintf(line, sizeof(line),
                      "{\"v\":1,\"type\":\"boot\",\"core0\":\"0x%02X\",\"core1\":\"0x%02X\",\"esp\":%d,\"name\":\"%s\",\"boots_since_power_on\":%lu,\"history\":[",
                      state.core0, state.core1, state.espReason, resetName(state.core0),
                      static_cast<unsigned long>(state.bootsSincePowerOn));
  const uint8_t oldest = static_cast<uint8_t>((state.historyNext + kHistorySize - state.historyCount) % kHistorySize);
  for (uint8_t i = 0; i < state.historyCount && used > 0 && used < static_cast<int>(sizeof(line)); ++i) {
    const uint8_t code = state.history[(oldest + i) % kHistorySize];
    used += snprintf(line + used, sizeof(line) - used, "%s\"0x%02X\"", i ? "," : "", code);
  }
  if (used > 0 && used < static_cast<int>(sizeof(line))) {
    snprintf(line + used, sizeof(line) - used, "],\"uptime_ms\":%lu}",
             static_cast<unsigned long>(millis()));
  }
  return String(line);
}

inline void resetProbePrint() {
  Serial.println(resetProbeLine());
}

inline void resetProbeRequest() {
  resetProbePrint();
}

inline void resetProbeTick() {
  const uint32_t now = millis();
  if (now < 10000 && static_cast<int32_t>(now - nextReportAt) >= 0) {
    resetProbePrint();
    nextReportAt += 2000;
  }
}

inline void resetProbeBoot() {
  const uint8_t core0 = static_cast<uint8_t>(rtc_get_reset_reason(0));
  const uint8_t core1 = static_cast<uint8_t>(rtc_get_reset_reason(1));
  const int espReason = static_cast<int>(esp_reset_reason());
  if (state.magic != kMagic || core0 == 0x01) {
    state.bootsSincePowerOn = 0;
    state.historyCount = 0;
    state.historyNext = 0;
  }
  state.magic = kMagic;
  if (state.bootsSincePowerOn != UINT32_MAX) ++state.bootsSincePowerOn;
  state.history[state.historyNext] = core0;
  state.historyNext = static_cast<uint8_t>((state.historyNext + 1) % kHistorySize);
  if (state.historyCount < kHistorySize) ++state.historyCount;
  state.core0 = core0;
  state.core1 = core1;
  state.espReason = espReason;
  nextReportAt = millis() + 2000;
  resetProbePrint();
}

}  // namespace ResetProbe

inline String resetProbeLine() { return ResetProbe::resetProbeLine(); }
inline void resetProbeBoot() { ResetProbe::resetProbeBoot(); }
inline void resetProbeTick() { ResetProbe::resetProbeTick(); }
inline void resetProbeRequest() { ResetProbe::resetProbeRequest(); }
