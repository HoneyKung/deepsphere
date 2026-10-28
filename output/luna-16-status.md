# LUNA-16 — สถานะตรวจจอทีละใบ

วันที่: 2026-10-27

## สถานะงาน

- เขียนแล้ว: `firmware/src/diag/panel_one.cpp` และเพิ่ม env `panel-one` ใน `platformio.ini`
- build แล้ว: ผ่านด้วย `platformio run -e panel-one` (PlatformIO รายงาน SUCCESS); RAM 18,808 / 327,680 bytes (5.7%), Flash 279,081 / 1,310,720 bytes (21.3%)
- แฟลชแล้ว: **ยังไม่ได้แฟลช** — PlatformIO หา upload port ไม่พบและแจ้ง `Please specify upload_port`; PySerial พบ 0 serial ports และ `pnputil` รายงาน No devices were found.
- ยังไม่ได้ดูด้วยตา: Luna ไม่มีภาพจากจอจริง จึงยังยืนยันผลบนจอไม่ได้

ไฟล์ firmware ที่ build: `.pio/build/panel-one/firmware.bin`  
MD5: `A64311759DFFA4C7EE572BF87BEEA52A`

## รอบแก้ 1 (FIX FIRST)

- `firmware/src/diag/panel_one.cpp:57-65` เพิ่ม `resetAllPanels()` ยก CS ทั้งหกเป็น HIGH แล้ว pulse RST ร่วมก่อนเริ่มทดสอบจอเดี่ยว
- `firmware/src/diag/panel_one.cpp:85-103` ให้ `initPanel()` เรียก `init()` ก่อนตั้ง SPI 4 MHz และส่งซ้ำ 0x01 (150 ms), 0x11 (120 ms), 0x3A=0x55 (10 ms), 0x13 (10 ms), 0x29 (10 ms) แล้วจึงตั้ง rotation/inversion
- `firmware/src/diag/panel_one.cpp:105-108` ให้ทุกการเริ่มเฟส A รวมถึงคำสั่งล็อก `1`–`6` reset จอทั้งหมดก่อน init/วาดเฉพาะจอเป้าหมาย
- `firmware/src/diag/panel_one.cpp:118-125` เฟส B เรียก init sequence เดียวกันแยกทีละจอ
- build ใหม่ผ่าน: RAM 18,808 / 327,680 bytes (5.7%), Flash 279,081 / 1,310,720 bytes (21.3%)
- MD5 ใหม่: `A64311759DFFA4C7EE572BF87BEEA52A`
- ลองอัปโหลดแล้วแต่ยังไม่พบ upload port; PySerial พบ 0 serial ports จึงยังไม่ได้แฟลช ดู `output/luna-16/upload.log`

## ไฟล์

เปลี่ยนในงานนี้:

- `firmware/src/diag/panel_one.cpp` — เฟส A วนทีละจอ 8 วินาที และเฟส B เปิดครบ 6 จอ 20 วินาที; รับคำสั่ง `1`–`6`, `b`, `a` ผ่าน Serial โดยไม่ต้องพึ่ง Serial เพื่อเริ่มทำงาน
- `platformio.ini` — เพิ่มเฉพาะ `[env:panel-one]` โดยยึด platform/board/lib_deps/upload จาก `diag` และเลือก build เฉพาะไฟล์ใหม่
- `output/luna-16/build.log` — ผล build ที่ผ่าน
- `output/luna-16/upload.log` — ผลลองอัปโหลดและข้อความว่าไม่พบพอร์ต
- `output/luna-16-status.md` — รายงานนี้

ไม่ได้แก้ไฟล์ที่ถูกห้ามแตะ ได้แก่ `twin/`, `laptop/`, `config/`, `firmware/include/deep_sphere_config.h`, `firmware/src/main.cpp`, `firmware/src/demo_live_yaw.cpp`, `firmware/src/diag/panel_check.cpp` และ env เดิมใน `platformio.ini`

Git ก่อนเริ่มไม่สะอาด: branch `main` มี `.gitignore` ที่แก้ไขค้างอยู่ และใบงาน `work-orders/LUNA-16-PANEL-ONE-BY-ONE.md`, `work-orders/LUNA-17-BASE-BOARD-BUTTONS-WHEEL.md` ที่ยังไม่ tracked; ไม่ได้แก้หรือ commit รายการเหล่านี้

## แฟลชเมื่อ Windows แสดง COM port

เปิด PowerShell ที่โฟลเดอร์โปรเจกต์ เปลี่ยน `COMx` เป็นพอร์ตของบอร์ด:

```powershell
$env:PLATFORMIO_CORE_DIR = "$PWD\.platformio-core"
.\.venv-validation\Scripts\python.exe -m platformio run -e panel-one -t upload --upload-port COMx
```

หลังแฟลช เฟิร์มแวร์เริ่มทดสอบเองได้โดยไม่ต้องเปิด Serial Monitor หากต่อ Serial ที่ 115200 baud จะใช้ `1`–`6` เพื่อล็อกจอ, `b` เพื่อล็อกเฟส B และ `a` เพื่อกลับโหมดอัตโนมัติ

## ตารางผลวัดสำหรับเจ้าของกรอก

| ใบที่ | หน้า | CS | เฟส A ติดไหม | เฟส B ติดไหม | VCC–GND เฟส A (V) | VCC–GND เฟส B (V) |
|---:|:---:|---:|:---:|:---:|---:|---:|
| 1 | px | GPIO8 |  |  |  |  |
| 2 | nx | GPIO3 |  |  |  |  |
| 3 | py | GPIO4 |  |  |  |  |
| 4 | ny | GPIO5 |  |  |  |  |
| 5 | pz | GPIO6 |  |  |  |  |
| 6 | nz | GPIO7 |  |  |  |  |

## วิธีอ่านผล (เกณฑ์ล่วงหน้า ยังไม่ใช่ข้อสรุป)

- ติดทีละใบได้ แต่พร้อมกันแล้วดับ หรือวัดแรงดันได้ต่ำกว่า 3.1 V → พิจารณากรณีไฟไม่พอ
- ใบเดิมไม่ติดแม้ทดสอบทีละใบ → พิจารณาสาย CS หรือจอใบนั้น
- ติดเฉพาะใบใกล้บอร์ดที่สุด ใบที่ไกลกว่าไม่ติด → พิจารณาสายร่วม SCK/MOSI/DC/RST ขาดช่วงหลังใบแรก

ยังไม่มีผลจากการดูจอหรือวัดแรงดันของเจ้าของ จึงยังไม่สรุปสาเหตุ
