# Single-display test — 10 September 2026

- Firmware configured for index 0 only: SCK=12, MOSI=11, RST=10, DC=9, CS=8. Physical controls disabled.
- Config agreement tests: 12 passed. Firmware build succeeded.
- PlatformIO upload attempt could not download tool-mkspiffs (HTTPClientError); no flash write occurred in that attempt.
- Uploaded the built bootloader, partition table, boot_app0 and firmware using the existing esptool 4.5.1 to ESP32-S3 on COM6. All four writes reported hash verification success; the tool issued a hard reset.
- User then reported that the display image appeared. This confirms basic output to this replacement panel, not six-panel operation, color accuracy, physical orientation, power margins or the condition of the earlier damaged-smelling panel.
- Post-flash serial diagnostic was stopped and its process exited. No application-state response was captured, so keyboard/USB application commands remain unverified on hardware.
- Current build shows the single-display color-bar/UP diagnostic, not the sea atlas. Full-assembly confirmation flags in JSON remain false.
