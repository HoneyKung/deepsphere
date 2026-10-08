# GEMINI-01: แฟลชโค้ดเทสจอ 6 ใบลงบอร์ด

ผู้สั่งงาน: Claude · ผู้ทำ: **Gemini** · คนเช็คจอจริง: **ผู้ใช้** · วันที่: 17 กันยายน 2026
โฟลเดอร์งาน: `C:\Users\Acer\Downloads\oceanX\prototype-v1\` — รันทุกคำสั่งจากที่นี่

## หน้าที่

**Gemini:** ทำโค้ดให้พร้อม แฟลชลงบอร์ด เช็คจาก log ว่าบอร์ดเริ่มจอครบ 6 ใบ แล้วจบงาน
**ผู้ใช้:** เสียบจอ ดูจอ และหาสายหักเอง — Gemini ไม่ต้องคุมขั้นตอนนี้

## สถานะ (Claude ตรวจแล้ว)

โค้ดโหมดทาสีจอ (sweep) **เขียนเสร็จแล้ว ห้ามเขียนใหม่**:
- `firmware/include/deep_sphere_config.h`: `kPanelSweepTest = true`, `kCs = {8, 13, 4, 5, 6, 7}`
- `firmware/src/main.cpp`: เริ่มจอทุกใบที่ 4 MHz, ส่งคำสั่งเปิดจอซ้ำ, inversion เปิด, มีคำสั่ง serial `hold_pin` / `scan_shorts` / `resume_sweep`
- build `esp32-s3-zero` สำเร็จแล้ว · ผังขา: `output/pin-sheet-6-panels.md`

## งาน

1. **แก้เทสล้าสมัย:** `tests/test_luna06_display_reset.py` → `test_current_map_and_supply_status_are_explicit` ยังคาด `"nz": 17` แก้เป็น `"nz": 7` (ผู้ใช้ยืนยันแล้ว)
   รัน `python -m unittest discover -s tests -t tests` → ต้องเหลือ fail ตัวเดียว `test_only_enabled_faces_are_initialized` (ของเดิม ห้ามแก้) ถ้ามีตัวอื่น หยุดแล้วรายงาน
2. **build + แฟลช** ด้วย PlatformIO แบบที่เครื่องนี้ใช้ได้ (เช่น `python -m platformio`)
   ```text
   python -m platformio run -e esp32-s3-zero
   python -m platformio run -e esp32-s3-zero -t upload --upload-port COMx
   ```
   ปิดโปรแกรมที่ถือพอร์ตก่อน · พอร์ตล่าสุด COM6 (เช็คใหม่) · หลังแฟลชพอร์ตหายแล้วกลับมาเป็นเรื่องปกติ
3. **เช็ค log** (baud 115200, DTR=1, RTS=0): ต้องเห็น `sweep initialized face <id> on CS<n>` ครบ 6 บรรทัด และ `nz` เป็น `CS7` · **ปิด monitor เมื่อเสร็จ** ให้พอร์ตว่าง
4. **ทำสคริปต์เล็ก ๆ ให้ผู้ใช้วัดสายเองได้** `tools/pin_probe.py`
   - `python tools/pin_probe.py --port COMx 11` → ส่ง `hold_pin` ขา 11 (ยกไฟขาเดียว หยุดวาดจอ)
   - `python tools/pin_probe.py --port COMx resume` → ส่ง `resume_sweep`
   - `python tools/pin_probe.py --port COMx shorts` → ส่ง `scan_shorts` แล้วพิมพ์ผล
   - ใช้รูปแบบคำสั่งตาม `handleCommand` ใน `main.cpp` · เปิดพอร์ต DTR=1 RTS=0 · พิมพ์ ACK ที่ได้ แล้วปิดพอร์ต · ไม่เพิ่มไลบรารี (ใช้ `pyserial` ที่มีอยู่)
   - ทดลองรันจริงกับบอร์ด 1 ครั้งแต่ละคำสั่ง
5. **รายงานสั้น** `output/gemini-01-status.md`: ผลเทส, ผล build/แฟลช + path log, 6 บรรทัดจาก log, ผลลองสคริปต์, ไฟล์ที่แก้

## ห้าม

- เขียนโค้ดวาดจอใหม่ / แก้ `platformio.ini` / แก้ค่าขา
- เปลี่ยนความเร็ว SPI, ลบคำสั่งเปิดจอซ้ำ, ปิด inversion
- ขับ GPIO1 หรือ GPIO2 (จองให้ AS5600)
- แตะงานเว็บ (`twin/`) หรือ AS5600
- เพิ่มไลบรารีใหม่
