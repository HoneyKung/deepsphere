# DEMO-LIVE-YAW — ฝั่งบอร์ด

วันที่ 18 กันยายน 2026

## ขอบเขตที่ทำ

ทำเฉพาะฝั่งบอร์ดตาม `work-orders/DEMO-LIVE-YAW.md`:

- อ่าน AS5600 ผ่าน `Wire` ที่ SDA=GPIO1, SCL=GPIO2, I²C address 0x36
- อ่าน STATUS 0x0B และ RAW ANGLE 0x0C/0x0D พร้อม AGC/MAGNITUDE
- อ่านเซนเซอร์ทุก 10 ms โดยมี I²C timeout 5 ms
- ส่ง `{"v":1,"type":"yaw","deg":..,"raw":..,"ok":..,"magnet":".."}` ทุก 40 ms หรือประมาณ 25 Hz
- ใช้ deadband 0.15 องศา
- `ok=false`, `magnet=missing` และคงค่ามุมล่าสุดเมื่อ I²C อ่านไม่ได้
- สถานะแม่เหล็ก: `ok`, `weak`, `strong`, `missing`
- คำสั่ง `as5600_zero` รองรับทั้งบรรทัด plain text และ JSON command; เก็บ zero offset ใน NVS ผ่าน `Preferences`
- environment แยก `live-yaw` ไม่ compile `main.cpp` และไม่ compile/ใช้ ST7789

## ไฟล์ที่แก้

- `firmware/src/sensors/as5600.h`
- `firmware/src/sensors/as5600.cpp`
- `firmware/src/demo_live_yaw.cpp`
- `platformio.ini` เพิ่ม environment `live-yaw`

ไม่ได้แก้ bridge, `twin/`, `work-orders/` หรือโค้ด renderer เดิม

## การตรวจ

- PlatformIO build `live-yaw`: **ผ่าน**
- source objects ของ build มีเฉพาะ `demo_live_yaw.cpp` และ `sensors/as5600.cpp`; ไม่มี `main.cpp` หรือ ST7789
- Python AS5600 tests: **9/9 ผ่าน**
- native AS5600 tests: **32/32 ผ่าน**
- ตรวจ telemetry หลังแฟลชด้วยการเปิดอ่านแบบชั่วคราว แล้วปิดทันที; ไม่เหลือ serial monitor ถือพอร์ตค้าง

## การแฟลช

คำสั่งที่ใช้:

```text
.venv-validation\Scripts\python.exe -m platformio run -e live-yaw -t upload --upload-port COM6
```

ผล: **upload สำเร็จ**, chip ESP32-S3 ตรวจพบ, เขียน firmware 290,784 bytes, hash verified และ reset สำเร็จ

process upload จบแล้ว และ process ตรวจ telemetry ก็จบแล้วเช่นกัน; COM6 ถูกปล่อยให้ bridge ใช้งานต่อได้

## ผลตรวจ telemetry บนบอร์ด

- จับบรรทัดจริงจาก COM6 ได้ต่อเนื่อง โดย timestamp ห่างกันประมาณ 40 ms หรือประมาณ 25 Hz
- ทุกบรรทัดที่ตรวจเป็น `type=yaw`, `ok=true`, `magnet=ok`
- ตัวอย่าง: `{"v":1,"type":"yaw","deg":105.5,"raw":1200,"ok":true,"magnet":"ok"}`
- หลังตรวจส่ง Ctrl+C ปิดตัวอ่านแล้ว; ไม่มีโปรแกรมถือ COM6 ค้าง

## ข้อที่ยังต้องทดสอบกับของจริง

- ตรวจค่ามุม/สถานะแม่เหล็กจริงจาก AS5600 แล้ว; ขณะตรวจมุมคงที่จึงยังไม่ได้ยืนยันช่วงการหมุนเต็มทาง
- `kYawReverse` ตั้งค่าเริ่มต้นเป็น `false` ตาม raw DIR=GND และยังไม่ถือว่าเป็นผลทดสอบทิศจริง ต้องหมุนตามเข็มและบันทึกผลก่อนเปลี่ยนค่า ห้ามเดา
- ยังไม่ได้ทำ bridge/web เพราะอยู่นอก “ฝั่งบอร์ด” ของรอบนี้
