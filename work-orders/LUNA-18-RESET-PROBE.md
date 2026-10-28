# ใบ 18 — ตัวพิมพ์รหัสรีเซ็ตดิบ + ตัวนับรีบูต + คำสั่งแฟลชแบบไม่ hard_reset (ผู้เขียน Luna / ผู้ตรวจ Opus อิสระ / 2026-10-28)

คุณคือ Luna ลงมือทำงานโดยตรง ห้ามเรียก codex exec ซ้อน
ไฟล์ที่เขียนได้: `firmware/include/reset_probe.h` (ใหม่), `firmware/src/diag/panel_one.cpp` (เพิ่มการเรียกใน `setup()` เท่านั้น), `firmware/src/demo_live_yaw.cpp` (เพิ่มการเรียกใน `setup()` เท่านั้น), `platformio.ini` (เพิ่ม env ใหม่เท่านั้น), `output/luna-18-status.md`, `output/luna-18/`
ห้ามแตะ: env เดิมทุกตัวใน `platformio.ini`, `laptop/`, `twin/`, `config/`, `deep_sphere_config.h`, `main.cpp`, `panel_check.cpp`, ตรรกะเดิมของจอ/AS5600
สำรองก่อนแก้: git `main` — จดผล `git -c safe.directory=C:/Users/Acer/Downloads/oceanX/prototype-v1 status` ก่อนเริ่ม ห้าม commit ห้าม push
อ่านก่อน (บังคับ):
- `docs/board-reset-research.md` — เหตุผลของใบนี้ และความหมายของรหัสรีเซ็ต
- `.platformio-core/packages/framework-arduinoespressif32/tools/sdk/esp32s3/include/soc/esp32s3/include/soc/reset_reasons.h` — ตารางรหัสดิบ
- `firmware/src/demo_live_yaw.cpp` — รูปแบบ JSON ต่อบรรทัด (`{"v":1,"type":...}`) และ `setup()`
- `laptop/twin_bridge.py` `_process_line` — ต้องมั่นใจว่าบรรทัดชนิดใหม่ไม่ทำให้ bridge ตัดการเชื่อมต่อหรือแจ้งผิด (อ่านอย่างเดียว ห้ามแก้)
กฎ: UTF-8 ไม่มี BOM ในไฟล์ใหม่, grep เครื่องหมายคำถามสี่ตัวติดกันต้องได้ 0, ห้ามเพิ่ม delay ที่ทำให้จอเริ่มช้าลงเกิน 50 ms

## เหตุและหลักฐาน
- บอร์ดรายงาน reset_reason = unknown (2026-09-17) แต่ framework ของเรา (Arduino 2.0.16 / IDF 4.4) แปลงรีเซ็ตจาก USB (0x15, 0x16) และไฟกระตุก (0x17) เป็น unknown หมด — `docs/board-reset-research.md`
- ตอนไม่มีโปรแกรมเปิดพอร์ต เราอ่านอะไรจากบอร์ดไม่ได้เลย จึงไม่รู้ว่ารีเซ็ตจริงกี่ครั้ง → ต้องมีตัวนับที่รอดข้ามการรีเซ็ต แล้วอ่านทีหลังตอนเปิดพอร์ต
- esptool ในเครื่อง (`tool-esptoolpy` 1.40501.0 = 4.5.1) ไม่มี `--after watchdog_reset` (ตัวเลือกมีแค่ hard_reset/soft_reset/no_reset/no_reset_stub — `esptool/__init__.py:135`) · PlatformIO อ่าน `--after` จาก `board_upload.after_reset` (`platforms/espressif32*/builder/main.py:454`) · เอกสาร esptool: หลังแฟลชผ่าน USB-Serial/JTAG แบบ hard_reset ชิปอาจค้างโหมดดาวน์โหลด ทางแก้คือ watchdog_reset หรือถอด-เสียบไฟ

## ต้องทำ
1. `firmware/include/reset_probe.h` (header-only):
   - ตัวนับใน `RTC_NOINIT_ATTR` (มีค่า magic ตรวจว่าข้อมูลถูกต้อง): นับจำนวนบูตตั้งแต่เปิดไฟครั้งล่าสุด ถ้ารหัสดิบเป็น power-on (0x01) ให้เริ่มนับใหม่ · เก็บรหัสดิบของ 8 บูตล่าสุดไว้เป็นวงแหวน
   - ฟังก์ชัน `resetProbeBoot()` เรียกต้น `setup()`: อ่าน `rtc_get_reset_reason(0)`, `rtc_get_reset_reason(1)`, `esp_reset_reason()` แล้วอัปเดตตัวนับ
   - ฟังก์ชัน `resetProbeLine()` คืนบรรทัด JSON: `{"v":1,"type":"boot","core0":"0x15","core1":"0x15","esp":3,"name":"USB_UART","boots_since_power_on":N,"history":["0x01","0x15",...],"uptime_ms":...}` (ชื่อจากตาราง reset_reasons.h)
   - พิมพ์บรรทัดนี้ตอนบูต และพิมพ์ซ้ำทุก 2 วิ ใน 10 วิแรก (คอมอาจเปิดพอร์ตช้า) และเมื่อได้รับตัวอักษร `r` ทาง Serial ห้ามบล็อกถ้าไม่มีใครเปิดพอร์ต
2. เรียกใช้ใน `panel_one.cpp` และ `demo_live_yaw.cpp` โดยไม่เปลี่ยนพฤติกรรมเดิม (คีย์ `1`–`6`/`b`/`a` ของ panel-one ต้องยังทำงาน, `r` ต้องไม่ชนคีย์เดิม — ตรวจใน live-yaw ด้วย)
3. env ใหม่ 2 ตัว: `panel-one-noreset` และ `live-yaw-noreset` ใช้ `extends` จาก env เดิม + `board_upload.after_reset = no_reset` (ใช้ทางนี้แทน watchdog_reset เพราะ esptool ในเครื่องไม่รองรับ ห้ามดาวน์โหลด esptool ใหม่)
4. Build ทั้ง 4 env (`panel-one`, `live-yaw`, และ 2 ตัวใหม่) ให้ผ่าน จด MD5 ของแต่ละตัว ยืนยันว่า 2 env ใหม่ส่ง `--after no_reset` จริง (ดูจาก `pio run -e <env> -t upload -v` แบบ dry หรือจากคำสั่งที่ PlatformIO สร้าง ถ้าไม่มีบอร์ดก็อ่านจาก builder ประกอบ)
5. ตรวจว่า `twin_bridge.py` รับบรรทัด `type=boot` แล้วไม่หลุดหรือแจ้งผิด (เขียนทดสอบจำลองใน `output/luna-18/` ได้ ห้ามแก้ bridge) ถ้าพบว่ามีปัญหา ให้รายงาน ไม่ต้องแก้
6. ไม่ต้องแฟลช (เจ้าของยังไม่จับฮาร์ดแวร์) ถ้าบอร์ดเสียบอยู่ก็ห้ามแฟลช

## ห้ามทำ
- ห้ามผ่อนเกณฑ์ที่มีอยู่ ห้ามแก้ env เดิม
- ห้ามดาวน์โหลด/ติดตั้งแพ็กเกจใหม่
- ห้ามสรุปสาเหตุการรีเซ็ต — ใบนี้แค่เตรียมเครื่องมือ
- ห้ามทำให้ภาษา/encoding เสีย

## ส่งมอบ (`output/luna-18-status.md`)
- ไฟล์ที่เปลี่ยน (ไฟล์:บรรทัด) และไฟล์ที่ไม่ได้เปลี่ยน, MD5 ทั้ง 4 env, ระบุชัด "build แล้ว ยังไม่ได้แฟลช ยังไม่ได้รันบนบอร์ด"
- **ขั้นตอนทดสอบสำหรับเจ้าของ** เขียนแบบคัดลอกไปรันได้ (PowerShell, `COMx` ให้แทนเอง):
  1. แฟลช `panel-one-noreset` (หรือ `live-yaw-noreset`) แล้ว **ถอดสาย USB เสียบใหม่ 1 ครั้ง** (= เปิดไฟใหม่ ตัวนับเริ่ม 0)
  2. ปล่อยไว้ 66 วินาที **ห้ามเปิดโปรแกรมใดที่ใช้พอร์ต** (ปิด serial monitor, bridge, Arduino IDE)
  3. เปิด monitor แล้วกด `r` ส่งบรรทัด `boot` กลับมาให้หัวงาน
- ตารางอ่านผล (เกณฑ์ล่วงหน้า): `boots_since_power_on` = 1 → ไม่ได้รีเซ็ตเลยในช่วงที่ไม่มีคนเปิดพอร์ต · >1 และ history เป็น 0x15/0x16 → รีเซ็ตจาก USB · 0x17 → ไฟกระตุก · 0x0F → ไฟตก
