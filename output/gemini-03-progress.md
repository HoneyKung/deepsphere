## GEMINI-03 progress

- ช่วงที่ 1 ข้อ 1: เขียนคำตอบก่อนบัดกรีลง `output/luna-10-status.md` แล้ว; ผู้ใช้ยืนยัน bridge และ pull-up ด้วยมิเตอร์ จึงปิดข้อก่อนบัดกรี
- ช่วงที่ 1 ข้อ 2: เพิ่มคณิตศาสตร์ Python/C++ draft, JSON vectors ที่ generate เป็น C++ header เดียวกัน และ tests; Python 9/9 และ native 32/32 ผ่าน
- ช่วงที่ 1 ข้อ 3: เพิ่ม `tools/as5600_watch.py` พร้อม replay summary ผ่านและ user checklist; ยังไม่ได้เชื่อมต่อบอร์ดหรือวัดค่ามุมจริง
- แก้ข้อมูลติดตั้งตามคำยืนยันล่าสุด: ESP32/AS5600 อยู่บนถาดหมุน, ชิปคว่ำลง, แม่เหล็กอยู่ฐานนิ่งตรงแกนเดียวกัน; ไม่กระทบโค้ดอ่านเซนเซอร์
- ปรับ user checklist ให้ตรวจ AGC ตามมุม และกำหนด `kYawReverse` จากผลเทสจริง ห้ามเดา
- ผู้ใช้ยืนยันผลวัดโมดูล: VDD5V–VDD3V3 บริดจ์แล้ว และ SDA/SCL มี pull-up 9.8 kΩ ไป VCC=3V3; ปิดข้อ “ก่อนบัดกรี” แล้ว
- ยืนยัน pinout 5 จุดตาม datasheet/ใบงาน; ยังไม่เริ่มช่วง firmware จนกว่าจะมีข้อความ `GEMINI-01 แฟลชเสร็จแล้ว`
- แก้ตามผลตรวจ Claude: `apply_zero` ใช้ช่วง signed [-180, 180) และเพิ่ม calibration แบบสะสม shortest delta ไม่ใช้ numeric min/max ของ raw
- เพิ่ม vectors/test กรณี 3800→...→2870 คร่อม 4095→0 และทิศย้อนกลับ; Python 9/9 และ native 30/30 ผ่าน โดยไม่แตะ `firmware/`
- เดโมใหม่ `DEMO-LIVE-YAW` ฝั่งบอร์ดเสร็จ: เพิ่ม environment `live-yaw` และไดรเวอร์ AS5600 แยกจาก ST7789; build ผ่านและแฟลช COM6 สำเร็จ
- แฟลช `live-yaw` กลับลง COM6 ซ้ำสำเร็จ และตรวจ telemetry จริงแบบชั่วคราว: บรรทัด `type=yaw`, `ok=true`, `magnet=ok` ห่างประมาณ 40 ms หรือ 25 Hz; ปิดตัวอ่านแล้วปล่อย COM6 ให้ bridge; ยังไม่ยืนยันทิศ `kYawReverse` จากการหมุนจริง
