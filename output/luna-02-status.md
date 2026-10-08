# Luna 02 status

บันทึก: 10 กันยายน 2026

## A — เตรียมทดสอบจอ

- A1: ยืนยันจาก pinout/schematic ของ Waveshare ว่า `IO6/GPIO6` ถูก breakout และใช้เป็น input ได้ เพิ่ม `pin_capability.gpio6_input.confirmed_by_vendor_pinout=true`; KY-040 SW ใช้ GPIO6 active-low พร้อม debounce และกดสลับ depth/heading คง Analyze GPIO3 เป็นผังเดิม เพิ่ม GPIO7 เป็นทางเลือกเท่านั้นและระบุ caveat ของ GPIO3
- A2: เพิ่มผังไฟ MP1584 `OUT+` ไป VCC จอหกใบหลังวัด 3.3V, `OUT-/GND` เป็น common ground, ESP32 3V3 เป็น logic rail แยก; เพิ่ม BL/BLK ทุกโมดูลเป็นสถานะต้องตรวจ silk/schematic และไม่ขับจาก GPIO
- A3: เพิ่ม `physical_face_uv` แยกจาก display pixel UV, inverse mapping ของ reticle เป็น `pixelU/pixelV`, renderer map ทุก pixel ผ่าน rectangle โดยไม่วาด black border แทน bezel และเพิ่ม Python/native test coverage สำหรับ offset, non-square, round-trip, bezel gap และ hit space
- A4: เพิ่ม non-identity body-diagonal upright fixture สำหรับ Python/native math tests และ single-display pattern path (`kSingleDisplayTest`, `kSingleDisplayIndex`) ที่แสดง face id, UP arrow และ RGB bars; default ยัง full-scene และ hardware output ยังปิด

## B — ปรับแผงคอม

- ใช้ Tkinter/ttk/Pillow และ `after` เดิม แต่จัด layout เป็น top bar, depth instrument ซ้าย, selected sample กลาง, analysis ขวา, thumbnail collection ล่าง และ diagnostics ใน Settings
- ใช้สีกรมท่า/เขียวอมฟ้าตาม brief, ให้ภาพ snapshot เป็นจุดเด่น, แสดง LEVEL เป็นเปอร์เซ็นต์, แสดง heading ว่า WHEEL และป้าย `SIMULATED / NO BOARD` หรือ hardware-disabled ชัดเจน
- มี empty state, distinct asset/error/disconnected feedback, thumbnail selection, feedback motion จำกัด และ cleanup ของ `after` callbacks เมื่อปิดหน้าต่าง

## คำสั่งและผลที่ตรวจได้ในรอบก่อน

- ตรวจ JSON ทุกไฟล์ config/board ด้วย PowerShell `ConvertFrom-Json`: ผ่าน
- ตรวจว่า source code ไม่มี AS5600, `Wire`, หรือ I2C runtime references: ผ่านตามข้อกำหนดรอบนี้ (คำอธิบายใน comment/doc ไม่ใช่ runtime)
- ตรวจไฟล์ A/B และ reference เดิมด้วย `rg --files`: ผ่าน
- เปิดดู screenshot baseline `output/dashboard-simulated.png`: เป็น Tkinter form สีอ่อน ข้อมูลกระจาย ภาพเล็ก/ชิดขวา; ใช้เป็น before reference
- หลังแก้: Python test suite ผ่าน 51 tests โดยใช้ Unity Python 3.7 runtime; 12 tests ถูก skip เพราะไม่มี Pillow/pygame-ce. `tools/make_vectors.py` สร้าง shared vectors ใหม่ผ่าน
- native C++ vectors และ PlatformIO build/buildfs ยังไม่ได้รันใน runtime เดิม เพราะไม่มี `ziglang`/`platformio`
- `generate_atlas.py` และ `preview.py` รอบเดิมยังรันไม่ได้เพราะ runtime ไม่มี Pillow; ไม่รัน `build_cues.py`
- ตรวจ catalog/audio ด้วย stdlib: 8 cue และ WAV ทั้ง 8 ไฟล์มีอยู่จริง เป็น PCM 44.1 kHz 16-bit stereo; integration test pygame จริงถูก skip ใน runtime เดิม
- เปิดดู screenshot baseline `output/dashboard-simulated.png`: เป็น Tkinter form สีอ่อน ข้อมูลกระจาย ภาพเล็ก/ชิดขวา; ใช้เป็น before reference

## รอผู้ใช้ / ห้ามอ้างว่าผ่านแล้ว

- `hardware_confirmed=false` และ `user_wiring_confirmed=false` ต้องคงไว้
- Analyze คง GPIO3 เป็นผังเดิมของผู้ใช้; GPIO7 เป็นทางเลือกเท่านั้น ยังไม่เปลี่ยน pin mapping
- ต้องวัด physical-face rectangles, screen rotation/inversion, BL/BLK circuit, MP1584 output/load และไฟครบหกจอ
- ยังไม่มีการทดสอบบอร์ด/จอ/ไฟ/ปุ่มจริง และ `hardware_confirmed=false`, `user_wiring_confirmed=false` ต้องคงไว้

## R2 — ตรวจรับด้วย environment เฉพาะงาน

- สร้าง `.venv-validation` จาก Python 3.12.14 และติดตั้ง Pillow 12.3.0, pygame-ce 2.5.8, pyserial 3.5, pytest, ziglang และ PlatformIO โดยไม่แก้ global runtime
- Python suite ผ่าน `55 tests`, `0 failures`; รวม keyboard action/depth bounds, simulator host commands, ACK และ duplicate request coverage
- Native shared vectors ผ่าน `1385 checks, 0 failures` หลังแก้ legacy active-rectangle compatibility bug
- Firmware `platformio run -e esp32-s3-zero` ผ่านหลังเพิ่ม USB command/ACK path; RAM 5.8%, Flash 25.5%
- Filesystem `platformio run -e esp32-s3-zero --target buildfs` ผ่าน; image มี `README.md` และ `sea_atlas_rgb565_be.bin`
- เพิ่ม keyboard-first control: `1` Scan, `2` Collect, `3` Analyze, `Up/Down` depth; action key ไม่รัวจาก key repeat, depth clamp 0..1, text-entry focus ไม่ยิง action
- Hardware command path ใช้ `type=command` และ `type=depth_delta` ผ่าน USB; board ส่ง `ack` และเป็นเจ้าของ state/hit test, simulator ใช้ protocol เดียวกัน
- เปิด GUI simulated จริงด้วย Tk/Pillow/pygame ใน process ที่มี Tcl/Tk resource; flow empty/collected/error ผ่านและไม่มี callback exception
- ตรวจภาพหลังจริงด้วย Tk/Pillow `ImageGrab` ใน desktop session และดูครบแล้ว: [empty 1280x800](dashboard-after-empty-1280x800.png), [collected 1280x800](dashboard-after-collected-1280x800.png), [error 1280x800](dashboard-after-error-1280x800.png), [collected 1024x720](dashboard-after-collected-1024x720.png)
- การฟังเสียงจริงโดยมนุษย์ยังไม่ถูกแทนด้วย automated test; mixer โหลดครบ 8 cue และตรวจ gain/crossfade path แล้ว
