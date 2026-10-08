# LUNA-13 — Voice, Twin Look, Board Bridge

วันที่: 2026-10-02

## สรุป

ทำ implementation สำหรับข้อ A/B/C ใน source ของ `prototype-v1/` และสร้าง backup ของ `twin/` ก่อนแก้ที่ `twin_backup_20261002/` ไม่แก้เฟิร์มแวร์, `config/scene.json`, geometry/renderer หรือภาพ artwork บนจอทั้งหก และไม่แฟลชบอร์ด

## A — เสียงพากย์

- `vo_welcome` เล่นหลัง `dive_start` จบ พร้อมระยะหน่วงราว 0.75 วินาที; ตรวจจาก audio debug ว่าใช้ไฟล์ English จริง
- เพิ่ม volume เสียงพากย์ 0–100% ที่ HUD และ audio debug; sync กันและบันทึก localStorage ได้ ทดสอบ 60% หลังรีโหลด แล้วคืนค่า 100%
- `BUS_DEFAULTS.voice=1.0`; ปรับจาก 0.9 เป็นประมาณ +0.9 dB โดยมี music duck ที่ 0.58 ขณะอ่านพากย์
- Analyze อ่าน `vo_analyze` ตามด้วยชื่อสัตว์ทั้งหกตามลำดับถาด เว้น 150 ms และใช้ music duck รอบเดียว; ตรวจใน browser ได้ลำดับ shoal → reef → manta → jelly → lantern → seahorse
- ภาษาเริ่มต้น English; ปิด Thai เมื่อไม่มีไฟล์ Thai และแสดงคำอธิบาย; caption แสดงบรรทัด English/Thai

## B — Twin look

- ปรับ `twin/index.html` และ `twin/deepcore.css` เป็น Sound Map พร้อมสี surface/mid/deep, depth chip, readouts, tray `n / 6`, ป้าย 760/1976 m, ปุ่มคีย์ลัด, caption สองภาษา และ voice slider ข้าง M
- ลดความเด่นของ engineering controls แต่ยังคงใช้งานได้; geometry, renderer, panel artwork และ scene config คงเดิม
- ตรวจด้วย browser ที่ 1366×768 และ 1920×1080; deep zone แสดงส้ม `#FF9F43`; HUD text ที่วัดครอบคลุมมีขนาดอย่างน้อย 12 px และ contrast บน hull อยู่ที่ 8.25:1–10.08:1
- แก้ตำแหน่ง keyboard help ที่ 1366×768 หลังตรวจพบว่าทับป้าย depth; ภาพหลังแก้ไม่ทับกัน

## C — Board bridge

- `laptop/twin_bridge.py` auto-detect USB `VID:PID 303A:1001` เมื่อไม่ระบุ `--port`; discover/reconnect ทุกประมาณหนึ่งวินาที
- `/yaw` ส่ง reason เมื่อเชื่อมต่อไม่ได้, ไม่มีข้อมูล/firmware ไม่ตรง, diagnostic firmware หรือ AS5600 ไม่ตอบ; banner ใน twin แสดงสถานะและเหตุผล
- ใช้ DTR high / RTS low, ปิด handle ตอน worker หยุด และเขียน `output/twin-bridge.log` แบบ JSONL หมุนไฟล์เมื่อเกิน 1 MB
- Mock tests ครอบคลุม reconnect, เหตุผล, DTR/RTS, rotation และ simulate; ทดสอบ server ด้วย `--simulate` แล้ว `/yaw` คืน `{ok:true, simulated:true, deg:...}` และหน้าแสดง `SIMULATED — NO BOARD`
- ไม่เปิด serial port จริง เนื่องจากมีโปรเซสเดิมที่อาจใช้งานพอร์ตอยู่; ไม่แตะ/แฟลชบอร์ด

## การตรวจ

- Browser acceptance: 14/14 ผ่าน รวม geometry checks, action checks, manifest/ไฟล์เสียง และลำดับ voice sequence
- `tests/test_luna13_bridge.py`: 8 passed
- `python -m py_compile laptop/twin_bridge.py`, `node --check twin/twin.js` และ `node --check tests/twin_browser_checks.js`: ผ่าน
- Full `pytest -q`: 133 passed, 1 failed, 1 warning, 22 subtests passed. Failure อยู่นอกขอบเขตงาน: `tests/test_luna06_display_reset.py::Luna06DisplayResetTests::test_only_enabled_faces_are_initialized` คาด `new Adafruit_ST7789` หนึ่งจุดในเฟิร์มแวร์ แต่พบสองจุด; ไม่แก้เพราะใบงานห้ามแก้เฟิร์มแวร์

## สถานะภาพหลักฐาน

ตรวจและจับภาพ baseline จาก `twin_backup_20261002/` และภาพหน้าใหม่/intro/caption/deep-orange ที่ 1366×768 และ 1920×1080 ผ่าน CUA screenshot preview แล้ว แต่ CUA ที่ใช้ได้ส่งภาพเป็น preview และไม่มี API บันทึกภาพ preview ลง filesystem; จึงยังไม่มีไฟล์ภาพใน `output/luna-13/` แม้โฟลเดอร์เป้าหมายมีอยู่ นี่เป็นรายการเดียวที่ยังไม่สามารถส่งเป็นไฟล์ตามใบงานได้



