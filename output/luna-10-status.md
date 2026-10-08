# LUNA-10 / GEMINI-03 สถานะ AS5600

วันที่ 17 กันยายน 2026 · ทำถึงช่วงที่ 1 เท่านั้น

## ก่อนบัดกรี

### สิ่งที่ datasheet ยืนยัน

อ้างอิง [ams AS5600 datasheet, v1-06, 2018-06-20](https://look.ams-osram.com/m/7059eac7531a86fd/original/AS5600-DS000365.pdf)

1. **ไฟ 3.3V และ VDD5V/VDD3V3** — หัวข้อ `IC Power Management`, หน้า 9, Figure 13 ระบุว่าโหมด 3.3V ใช้ไฟเข้า 3.0–3.6V และต้องผูก VDD5V กับ VDD3V3 ภายนอกเข้าด้วยกัน ส่วนตัวเก็บประจุ 10 µF ที่วาดเส้นประระบุว่าใช้สำหรับ OTP programming เท่านั้นในรูปนี้ จึงห้ามจ่าย 5V กับชุดนี้

   ผู้ใช้วัดโมดูล 6 รูแล้วพบว่า VCC ปี๊ปถึงขา 2 ของชิป (`VDD3V3`) จึงยืนยันว่าโมดูลบริดจ์ VDD5V–VDD3V3 มาแล้ว ไม่ต้องแก้แผ่น

2. **pull-up ของ I²C** — ตาราง `Pin Description`, หน้า 3 ระบุ SDA เป็น I²C data และ SCL เป็น I²C clock พร้อมคำแนะนำให้พิจารณา external pull-up แต่ไม่ได้ยืนยันว่าทุกโมดูล breakout มีตัวต้านทาน pull-up บนบอร์ด ดังนั้นต้องดูรูป/อ่านข้อความบนโมดูลก่อน

   ผู้ใช้ยืนยันด้วยมิเตอร์ว่า SDA และ SCL ถึง VCC ได้ 9.8 kΩ ทั้งคู่ จึงมี pull-up บนโมดูลไป VCC ซึ่งเป็น **3V3** ในงานนี้ และไม่ต้องเพิ่ม pull-up

3. **DIR/OUT/PGO (หรือ GPO)** — ตาราง `Pin Description`, หน้า 3 ระบุว่า DIR เป็น direction polarity; ต่อ GND แล้วค่ามุมเพิ่มตามเข็มนาฬิกาเมื่อมองตามทิศอ้างอิงของชิป จึงตรงกับใบงานที่ให้ต่อ DIR→GND ถ้า OUT ไม่ใช้ให้ไม่ต่อ และ PGO ซึ่งบางโมดูลพิมพ์เป็น GPO ไม่ใช้กับการอ่าน I²C ปกติให้ไม่ต่อ

4. **I²C และ register** — หัวข้อ `I²C Interface`, หน้า 10 ระบุ 7-bit slave address เป็น **0x36** (ไม่ใช่ 0x6C/0x6D แบบ address byte ที่รวม R/W) ตาราง `Register Description`, หน้า 18 ระบุ:

   | รายการ | register | บิต/ความหมาย |
   |---|---:|---|
   | RAW ANGLE | 0x0C high, 0x0D low | ค่าดิบ 12 บิต 0–4095 |
   | STATUS | 0x0B | MD=bit 5 แม่เหล็กถูกตรวจพบ, ML=bit 4 สนามอ่อนเกิน, MH=bit 3 สนามแรงเกิน |
   | AGC | 0x1A | ค่า AGC 8 บิต |
   | MAGNITUDE | 0x1B high, 0x1C low | ขนาดสนาม 12 บิต |

   โค้ดงานนี้จะอ่านค่าเหล่านี้เท่านั้น และจะไม่เขียน register `BURN` หรือ OTP ใด ๆ

### วิธีเช็คว่าแม่เหล็กเป็น diametric

วางแม่เหล็กเม็ดแบนให้นอนราบ แล้วถือเข็มทิศหรือเปิดแอปเข็มทิศไว้ห่างพอที่จะไม่ให้เซนเซอร์เข็มทิศอิ่มตัว หมุนแม่เหล็กรอบแกนที่ตั้งฉากกับหน้าแบนช้า ๆ: ถ้าเป็น diametric ขั้ว N/S อยู่คนละซีกของหน้าแบน ทิศสนามในระนาบจะหมุนตามแม่เหล็ก ทำให้ทิศที่เข็มทิศชี้เปลี่ยนตามอย่างต่อเนื่อง อย่าใช้ผลจากเข็มทิศเป็นหลักฐานเดียวถ้ามีโลหะ/อุปกรณ์แม่เหล็กอยู่ใกล้ ๆ และอย่าวางแม่เหล็กติดโทรศัพท์

## ผลวัดโมดูลจริงก่อนบัดกรี

ผู้ใช้วัดโมดูลแล้วและปิดข้อสงสัยด้านแผ่นวงจรได้ดังนี้:

- VCC ปี๊ปถึงขา 2 ของชิป ซึ่งเป็น `VDD3V3` ตามตาราง `Pin Description` หน้า 3 และยืนยันว่า VDD5V–VDD3V3 บริดจ์ถึงกันแล้ว ตรงกับโหมด 3.3V ในหัวข้อ `IC Power Management`, หน้า 9 จึงใช้ 3V3 ได้เลยและไม่ต้องแก้แผ่น
- SDA และ SCL วัดถึง VCC ได้ 9.8 kΩ ทั้งคู่ แปลว่ามี pull-up บนโมดูลขึ้น VCC; ในการติดตั้งนี้ VCC คือ 3V3 จึงไม่ต้องเพิ่ม pull-up
- จุดต่อ 5 จุดได้รับการยืนยัน: VCC→3V3, GND→GND, SDA→GPIO1, SCL→GPIO2, DIR→GND; OUT/GPO ไม่ต่อ

**ข้อ “ก่อนบัดกรี” ปิดแล้ว** จากผลวัดจริงของผู้ใช้ ประกอบกับ pinout ใน datasheet: VDD5V/VDD3V3 เป็นไฟเลี้ยง, GND เป็นกราวด์, SDA/SCL เป็น I²C, DIR เป็นขั้วทิศทาง, OUT เป็นเอาต์พุต และ PGO/GPO เป็นขาโปรแกรมที่ไม่ใช้ในงานนี้

## คำตอบสั้นสำหรับผู้ใช้ก่อนบัดกรี

วัดยืนยันแล้วว่าโมดูลบริดจ์ VDD5V–VDD3V3 มาให้พร้อมใช้ 3.3V และมี pull-up SDA/SCL 9.8 kΩ ไป VCC=3V3 จึงไม่ต้องแก้แผ่นหรือเพิ่มตัวต้านทานครับ ผัง 5 จุดตรงตาม datasheet และใบงาน: VCC→3V3, GND→GND, SDA→GPIO1, SCL→GPIO2, DIR→GND; OUT/GPO ไม่ต่อ

## ไฟล์ที่แก้ในช่วงที่ 1

- `tools/as5600_math.py`
- `tools/as5600_watch.py`
- `tests/vectors/as5600_math_vectors.json`
- `tests/test_as5600_math.py`
- `tests/test_as5600_watch.py`
- `tests/vectors/as5600_watch_replay.csv`
- `tools/make_as5600_vectors.py`
- `tests/native/as5600_vectors_generated.h` (สร้างจาก JSON vectors)
- `tests/native/test_as5600_math.cpp`
- `tests/native/run_as5600_test.py`
- `output/as5600/draft/as5600_math.h`
- `output/as5600/draft/as5600_math.cpp`
- `output/as5600/user-checklist.md`
- `output/gemini-03-progress.md`
- รายงานนี้

ไม่ได้แก้ `firmware/`, `twin/*`, `config/twin.json`, `tools/twin_geometry.py` หรือ `tools/atlas_math.py` และไม่ได้แฟลชบอร์ด

## เครื่องมือและคำสั่ง

```text
python tools/as5600_watch.py --port COMx --seconds 60
python tools/as5600_watch.py cal-start --port COMx
python tools/as5600_watch.py cal-stop --port COMx
python tools/as5600_watch.py zero --port COMx
python tools/as5600_watch.py summary --replay output/as5600/<file>.csv
python -m unittest tests.test_as5600_math -v
python tests/native/run_as5600_test.py
```

`as5600_watch.py` ใช้ `laptop/core.py:SerialWorker` เป็นเจ้าของ COM port คนเดียว โดยใช้ DTR=1, RTS=0, 115200 baud, ไม่เพิ่ม dependency และเขียน CSV ลง `output/as5600/` เครื่องมือมี replay mode ที่ไม่ต้องใช้บอร์ด

## ผลตรวจและการทดสอบ

### ตรวจจริงจาก workspace

- พบใบงานและ LUNA-10 ตามที่อ้างอิงแล้ว
- ตรวจพบว่า `SerialWorker` เดิมตั้ง DTR=True และ RTS=False แล้ว
- เพิ่มและรัน unit test คณิตศาสตร์/ตัวอ่าน replay รวม 9 เทสต์ สำเร็จ
- native C++ test สร้าง header จาก `tests/vectors/as5600_math_vectors.json` แล้วผ่าน 30 checks
- replay summary ทำงานสำเร็จจาก CSV โดยไม่ใช้บอร์ด
- `apply_zero` คืนค่า signed angle ในช่วง [-180, 180) และ calibration unwrap ด้วย shortest delta สะสมทีละตัวอย่าง รองรับช่วงคร่อม raw 4095→0
- regression suite เดิมทั้งโปรเจกต์รัน 121 เทสต์ พบ 2 failures ที่มีอยู่ในงานจอ LUNA-06/GEMINI-01 (`test_current_map_and_supply_status_are_explicit`, `test_only_enabled_faces_are_initialized`); ไม่ได้แก้ตามกติกางานนี้
- ไม่ได้เปิด COM, ไม่ได้จ่ายไฟ, ไม่ได้บัดกรี, ไม่ได้อ่านค่ามุม AS5600 จริง และไม่ได้แฟลช

### ผู้ใช้บอก/กำหนดในใบงาน

- VCC→3V3, GND→GND, SDA→GPIO1, SCL→GPIO2, DIR→GND, OUT/GPO ไม่ต่อ
- โมดูลมี 6 รูและยังไม่บัดกรี; ผู้ใช้ยืนยัน bridge VDD5V–VDD3V3 และ pull-up 9.8 kΩ ไป VCC=3V3 จากการวัดจริง
- บอร์ด ESP32 และ AS5600 อยู่บนถาดหมุนใต้ลูกบาศก์และหมุนไปพร้อมจอ; AS5600 คว่ำชิปลงตรงกลางแกน
- แม่เหล็ก diametric ติดนอนหงายหน้าแบนขึ้นในหลุมกลางปลายเสาฐานที่นิ่ง ห่างชิป 1–2 มม.; ชิปกับแม่เหล็กอยู่บนแกนเดียวกัน
- การหมุนจริงราว 270 องศา ไม่มี slip ring และสายที่บิดมีเพียง USB เส้นเดียว
- ทิศมุมกลับด้านจากกรณีชิปอยู่ฐาน ต้องตั้ง `kYawReverse` จากผลเทสจริงเท่านั้น

### ยังไม่ได้ตรวจ

- ค่าจากการอ่าน I²C จริงเพื่อยืนยัน address 0x36 และข้อมูล register ทุกตัว
- ชนิดแม่เหล็กกับของจริง/ระยะ 1–2 มม./การเยื้องศูนย์
- MD/ML/MH, AGC, MAGNITUDE, jitter, sample rate และ i2c_errors จากการอ่านจริง
- ช่วง min/max, ทิศการหมุน, offset และผลรีบูต
- Phase 2 firmware, test/build ของเฟิร์มแวร์ และการเทสขณะจอ sweep

## เงื่อนไขไปช่วงที่ 2

รอผู้ใช้ยืนยันข้อความ **“GEMINI-01 แฟลชเสร็จแล้ว”** และรอการบัดกรีโมดูลตามผลวัดที่ยืนยันแล้วก่อน จึงค่อยแก้ `firmware/` ตามใบงานและขออนุญาตแยกต่างหากก่อนแฟลช
