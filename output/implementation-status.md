# Implementation status

วันที่บันทึก: 10 กันยายน 2026

เครื่องที่ใช้: Windows 11, Python 3.14.3, PlatformIO Core 6.2.0, ziglang 0.16.0

## 1. เปลี่ยนขอบเขตตามคำสั่งผู้ใช้: ไม่มีเซนเซอร์วัดการหมุน

ผู้ใช้แจ้งว่าชุดที่ได้มา**ไม่มีทั้งตัว AS5600 และแม่เหล็ก** ไม่ใช่แค่แม่เหล็กที่ส่งไม่ทัน ให้ตัดและยอมรับสภาพ

การวัดการหมุนตัวลูกจึงไม่มีอยู่ในต้นแบบนี้ และเฟิร์มแวร์ไม่มีโค้ด I2C หรือ AS5600 เหลืออยู่ `yaw.source` เหลือสองค่า

| ค่า | ที่มาของมุมหัน | สถานะ |
|---|---|---|
| `none` | ไม่มี มุมหันคงที่ | มีให้เลือก |
| `encoder` | ล้อ KY-040 กดล้อสลับ depth/heading | **ค่าเริ่มต้นตอนนี้** |

สิ่งที่ยังเหมือนเดิม: เรขาคณิต การแมพภาพ การซ่อนเป้าในกรอบ การสแกน การเก็บภาพ และเสียง ทั้งหมดใช้ตัวแปร yaw ตัวเดียวกัน เปลี่ยนแค่ว่าใครป้อนค่า

สิ่งที่หายไป: หมุนตัวลูกจริงแล้วเป้าอยู่กับที่ ไม่อยู่ในขอบเขตแล้ว ต้องรายงานว่าไม่ได้ทดสอบ ไม่ใช่ว่าผ่าน

ผลพลอยได้: yaw จาก encoder เป็นขั้นคงที่ ไม่มีสัญญาณสั่น จึงไม่ต้องใส่ hysteresis กันเป้าสลับหน้า

การเดินสาย: GPIO6 ที่เคยกันไว้ให้ I2C SDA เป็นสวิตช์ของล้อ GPIO7 ปล่อยว่าง ดู `config/wiring-table.md` ซึ่งมีรายการสิ่งที่ต้องทำถ้าวันหนึ่งซื้อเซนเซอร์กับแม่เหล็กมา

## 2. บั๊กที่พบและแก้ในรอบนี้

ทั้งสามข้อแรกทำให้ Scan/Collect ชี้คนละที่กับภาพที่เห็น

1. **UV ของเป้าเล็งคำนวณผิดชนิดพิกัด** เดิมแปลง local screen coordinate ผ่าน active-image bounds แล้วเรียกผลลัพธ์ว่า atlas UV ซึ่งไม่ใช่พิกัดใน atlas เลย ทำให้ hit test เทียบคนละปริภูมิกับ target metadata แก้เป็น `atlas_uv = background_uv(rotate_z(aim_world, -yaw), depth)` ซึ่งเท่ากับพิกเซลที่ renderer วาดใต้เป้าพอดี
2. **เลือกหน้าลูกบาศก์ด้วยค่าสัมบูรณ์ของ dot** ทำให้ทิศที่ชี้ไป -X ถูกจับเป็นหน้า px แล้วคิดพิกัดด้วยแกนของหน้าที่ผิดข้าง แก้เป็นใช้ dot ที่มีเครื่องหมาย
3. **crop ส่งจุดกึ่งกลางของ target ในช่องที่โปรโตคอลกำหนดว่าเป็นมุมซ้ายบน** ทำให้ภาพที่คอมตัดเลื่อนไปครึ่งกรอบ แก้เป็นส่ง `u - w/2`, `v - h/2`
4. **`board_build.psram_type = opi`** ผิดสำหรับ ESP32-S3FH4R2 ซึ่งเป็น quad PSRAM 2MB แก้เป็น `qspi` และ `memory_type = qio_qspi`
5. **`laptop/requirements.txt` ติดตั้งไม่ผ่าน** `pygame==2.6.1` ไม่มี wheel สำหรับ Python 3.14 และ build จาก source ไม่ได้ เปลี่ยนเป็น `pygame-ce` ซึ่ง import ชื่อ `pygame` เหมือนกัน
6. **PNG กับ .bin เป็นคนละพิกเซล** เดิม PNG เก็บสีเต็ม ส่วน .bin quantize เป็น RGB565 ภาพตัวอย่างบนคอมจึงไม่ใช่สีที่จอแสดง แก้โดย quantize ครั้งเดียวแล้วออกทั้งสองไฟล์จากภาพเดียวกัน
7. **`data_dir` ไม่ได้ชี้ไป `firmware/data`** ทำให้ `uploadfs` สร้าง image ไม่ได้เลย
8. **วาดภาพด้วย `drawPixel` ทีละพิกเซล และอ่าน atlas ด้วย `seek`+`read` ทีละพิกเซลจาก LittleFS** ช้าจนใช้งานไม่ได้ (57,600 SPI transaction ต่อหนึ่งหน้า) แก้เป็นโหลด atlas เข้า PSRAM ครั้งเดียวแล้ววาดทีละแถบ 16 แถวด้วย `writePixels` และการหมุนวาดซ้ำเฉพาะกรอบเล็กรอบเป้าเก่า ไม่วาดทั้งหน้าใหม่

เพิ่ม zone hysteresis 0.03 ในเฟิร์มแวร์ตามที่ `docs/audio-protocol.md` กำหนดไว้แต่ยังไม่ได้ทำ และเพิ่ม `Serial.setTxTimeoutMs(0)` เพื่อไม่ให้ USB CDC ค้างรอโฮสต์ที่ไม่มีอยู่

## 3. ผ่านด้วยการรันจริงบนเครื่องนี้

| การตรวจ | คำสั่ง | ผล |
|---|---|---|
| ชุดทดสอบ Python | `python -m unittest discover -s tests` | 42 tests OK |
| คณิตศาสตร์ C++ เทียบ vector ชุดเดียวกับ Python | `python tests\native\run_native_test.py` | PASS: 1382 checks, 0 failures |
| build เฟิร์มแวร์ | `python -m platformio run -e esp32-s3-zero` | SUCCESS, RAM 5.8% (19,120 B), Flash 25.3% (331,477 B) |
| build ในโหมด `kHardwarePinsConfirmed = true` | เปลี่ยนค่าชั่วคราวแล้ว build | SUCCESS เส้นทางที่ขับจอและอ่านอินพุตคอมไพล์ผ่าน |
| สร้าง LittleFS image ที่มี atlas 1 MB | `python -m platformio run -t buildfs` | SUCCESS, littlefs.bin 1,441,792 B |
| สร้าง asset pack | `python tools\generate_atlas.py` | PNG, .bin 1,048,576 B, pack.json, targets_generated.h |
| preview หกหน้า | `python tools\preview.py --grid --yaw 272.9 --depth 0.4125` | `output/preview-yaw273-target01.png` เป้าอยู่บน target_01 |
| ชุดเฟรมตรวจรอบตัว | `python tools\preview.py --sweep 8` | `output/preview-sweep/` แปดเฟรม พื้นหลังเหมือนกันทุกเฟรม เป้าเดินข้ามหน้าและหายในกรอบที่ 45/135/225/315 |
| ติดตั้งซ้ำจาก venv เปล่า | `python -m venv` + `pip install -r laptop\requirements.txt` แล้วรันเทสต์ | 42 tests OK |
| แผงคอมครบวง Scan → Collect → Analyze | `laptop/app.py --simulate` ขับด้วยสคริปต์ แล้วจับภาพหน้าต่าง | `output/dashboard-simulated.png` |

หลักฐาน build เต็มอยู่ที่ `output/build-log.txt`

### สิ่งที่ชุดทดสอบครอบคลุม

- `yaw=0` กับ `yaw=360` ได้หน้า พิกัดบนจอ และ atlas UV เท่ากันทุกตัว
- 359.9 → 0.1 ไม่กระโดดผิดหน้า และ atlas U ต่างกันน้อยกว่า 0.002
- UV ของเป้าเท่ากับ UV ที่ renderer วาดใต้เป้า ตรวจทุก 7 องศาที่สี่ระดับความลึก
- เปลี่ยน yaw แล้ว UV พื้นหลังของทุกพิกเซลบนหกหน้าเท่าเดิมทุกค่า ขณะที่เป้าเลื่อนไปหนึ่งในสี่รอบพอดีเมื่อหมุน 90 องศา
- เปลี่ยนความลึกแล้ว U ของเป้าไม่ขยับ V ขยับ
- เป้าที่ตกบนขอบลูกบาศก์ทั้งสี่มุม (45/135/225/315) ถูกซ่อนและ hit ไม่ได้
- target_01 ที่คร่อมรอยต่อ U=0 ถูกยิงโดนจากทั้งสองฝั่งของรอยต่อ (U=0.98 และ U=0.008)
- มุมเดิมแต่หน้าต่างความลึกคนละที่ ต้องไม่โดนเป้า
- U วนขอบ V clamp RGB565 เป็น big-endian และค่าคงที่
- แผงคอม: เก็บภาพแล้วเปลี่ยน depth/yaw ภาพไม่เปลี่ยน, เปิดแผงใหม่ยังเห็นภาพเดิม, event ซ้ำไม่เพิ่ม sample, asset mismatch ไม่บันทึกรูป, collect ในกรอบและไม่มีเป้าให้เหตุผลไม่ใช่ crash, Analyze ตอนไม่มีตัวอย่างไม่ crash, สีกลางภาพที่ตัดตรงกับสี target ที่ quantize แล้ว
- เสียง: ไฟล์หายแล้วไม่ crash และรายงานชื่อ cue ที่หาย, state โซนเดิมซ้ำไม่ restart loop
- config: ค่าใน `firmware/include/deep_sphere_config.h` ตรงกับ `config/*.json` ทุกตัวที่ใช้ร่วมกัน, ไม่มี GPIO ซ้ำ, ไม่แตะขาที่จองไว้, ไม่มีโค้ดไหนเรียกหาเซนเซอร์วัดการหมุนที่ไม่มีอยู่ และ atlas+stripe ยังเล็กกว่า PSRAM ที่มี

## 4. ยังไม่ได้ทดสอบ ต้องมีบอร์ดจริง

- ยังไม่ได้แฟลช ยังไม่ได้อ่านชนิด Flash/PSRAM จากบอร์ดจริง ตัวเลข 4MB/2MB มาจากเอกสารผู้ผลิต ไม่ใช่การวัด
- ยังไม่ได้ต่อ ST7789 ใบเดียวหรือหกใบ ยังไม่ทราบสีจริง rotation inversion offset ความเร็ว SPI ที่ใช้ได้ และเฟรมเรตจริง ตัวเลข 24 MHz เป็นค่าตั้งต้นที่ยังไม่ได้วัด
- ยังไม่ได้ทดสอบ KY-040 ปุ่มสามปุ่ม และสวิตช์ของล้อบนขาจริง `kEncoderStepsPerDetent = 4` เป็นค่าปกติของ KY-040 ที่มี detent ยังไม่ได้ยืนยันกับโมดูลที่ผู้ใช้มี และยังไม่ได้ยืนยันว่า GPIO6 ใช้เป็นอินพุตได้บนบอร์ดที่มี
- ยังไม่ได้วัดโหลด 3V3 ของจอหกใบ และยังไม่ได้ทดสอบทางไฟผ่าน USB โน้ตบุ๊ก
- ยังไม่ได้ฟังเสียงด้วยหูมนุษย์ ดู `output/audio-status.md`
- ยังไม่มีวิดีโอชุดจริง

## 5. ต้องรอผู้ใช้ยืนยันก่อนเปิด hardware mode

- SKU จริงและชื่อ pad จริงของบอร์ด
- ตาราง GPIO/CS และหมายเลขจอ `px/nx/py/ny/pz/nz`
- ยืนยันว่า GPIO6 แตกขาออกมาและใช้เป็นสวิตช์ของล้อได้ในผังที่ต่อไว้แล้ว
- active-image bounds, rotation, inversion จากชิ้น 3D จริง
- `mount_orientation` ยังเป็น identity ต้องวัดท่าตั้งบนมุมของลูกบาศก์แล้วใส่ quaternion จริง มิฉะนั้นหน้าบน/ล่างจะแมพไม่ตรงกับที่ตั้งใจ
- การจ่ายไฟจอทั้งหกโดยไม่ขนาน VBUS โน้ตบุ๊ก

## 6. R3 review validation — 10 กันยายน 2026

รอบนี้แก้ตามรีวิวโดยคงประวัติด้านบนไว้: depth instrument ใช้ความสูง canvas จริงและแสดง 0 ที่ผิวน้ำ/100 ที่ลึกสุด, action buttons ทั้งสามอยู่ใน client area, preview ขยาย test asset แบบรักษา aspect ratio และติดป้าย `TEST ASSET`, Analyze บนโน้ตบุ๊กเรียก local `model.analyze()` ได้แม้ไม่มี USB ส่วน Analyze event จากบอร์ดยังรองรับผ่าน protocol เดิม

- Audio mute/unmute ใช้ mixer channels จริง: หยุด ambience/cue ทันที, คืน zone เดิมเมื่อเปิดเสียง, ไม่เปิดกลับเมื่อ `--no-audio` หรือ mixer init ไม่ผ่าน และ close หยุด channel แม้ muted
- Held `Up/Down` ถูกล้างเมื่อ FocusOut, เปิด Settings, disconnect หรือ close; action keys ยัง one-shot จน release
- ค่า default เป็น `keyboard_first`, `yaw_source: none`, fixed heading; firmware แยก `kPhysicalControlsEnabled` จาก `kHardwarePinsConfirmed` จึงไม่ poll KY-040/ปุ่มเมื่อ input ยังไม่ยืนยัน แต่ยังรองรับ staged display diagnostic
- GUI capture ใช้ Win32 client rectangle จริงและบันทึก DPI/ขนาดไว้ที่ `output/dashboard-capture-metadata.json`; รอบนี้ได้ client 1024×640 @120 DPI สำหรับภาพ output 1280×800 และ client 819×576 @120 DPI สำหรับภาพ output 1024×720 โดยไม่มี desktop background ปน
- Python suite: `56 passed`; native shared math: `1385 checks, 0 failures`; PlatformIO firmware build: `SUCCESS`, RAM 5.8%, Flash 25.4%; filesystem build: `SUCCESS`

หลักฐานภาพ: [empty 1280×800](dashboard-after-empty-1280x800.png), [collected 1280×800](dashboard-after-collected-1280x800.png), [error 1280×800](dashboard-after-error-1280x800.png), [collected 1024×720](dashboard-after-collected-1024x720.png), [capture metadata](dashboard-capture-metadata.json)

ยังไม่อ้างว่าผ่านบน hardware จริง: `hardware_confirmed=false`, `user_wiring_confirmed=false`, ยังต้องตรวจ module pin/schematic และไฟก่อน single-display test, วัด physical-face UV/rotation/inversion, วัดโหลด MP1584/BL และฟังเสียงจากลำโพงจริง
