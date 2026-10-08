# LUNA-07 status — nx CS moved to GPIO3

วันที่บันทึก: 17 กันยายน 2026

## งานที่ทำในรอบนี้

- ย้าย CS ของหน้า `nx` จาก GPIO13 เป็น GPIO3 ให้ตรงกันใน firmware, `config/board.json`, `config/faces.json`, wiring table และ pin sheet
- ปิดการกำหนดปุ่ม Analyze จริงด้วย `kButtonAnalyze = -1`; ใช้ numpad แทน
- คง GPIO1/2 เป็นขาที่จองให้ AS5600 และไม่เปลี่ยนความเร็ว SPI, คำสั่งเปิดจอ หรือ inversion
- บันทึกผลทดสอบว่า GPIO13 ไม่ออกสัญญาณและห้ามใช้ จนกว่าจะทราบว่าเสียที่ขา GPIO หรือจุดบัดกรี

## ผลตรวจ

| รายการ | ผล |
|---|---|
| ผัง CS ปัจจุบัน | px=8, nx=3, py=4, ny=5, pz=6, nz=7 |
| ปุ่ม Analyze | ไม่กำหนดขา (`-1`), ใช้ numpad |
| GPIO1/2 | จองให้ AS5600 ไม่แตะต้อง |
| เทส Python | ผ่าน 124 tests; fail เดิม 1 ตัวคือ `test_only_enabled_faces_are_initialized` |
| build `esp32-s3-zero` | SUCCESS; RAM 5.9% (19,384 B), Flash 24.1% (315,365 B) |
| แฟลช COM6 | SUCCESS; hash verified; ไม่หลุดกลางแฟลช |
| serial verification | SUCCESS; re-init ผ่าน `hold_pin 3` → `resume_sweep` |
| log ที่พบ | `sweep initialized face nx on CS3` และครบ px/nx/py/ny/pz/nz |

## หมายเหตุการแฟลช

ยืนยันแล้วว่า Creality Print ปิดก่อนแฟลช เพราะโปรแกรมนี้ทำให้บอร์ดรีเซ็ตและพอร์ตหลุดได้ การแฟลชครั้งนี้ผ่านโดย COM6 ไม่หลุดกลางงาน และ hash ของ firmware ผ่านการตรวจสอบ

หลักฐาน: `output/luna-07-build-nx3.log`, `output/luna-07-upload.log`, `output/luna-07-monitor.log`
