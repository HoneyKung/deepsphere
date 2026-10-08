# Deep Sphere — ต้นแบบใหม่ V1

วันที่เริ่ม: 10 กันยายน 2026

สถานะ: เฟิร์มแวร์ เครื่องมือ atlas คณิตศาสตร์ แผงควบคุม เสียง และชุดทดสอบครบแล้ว คณิตศาสตร์และแผงคอมรันจริงผ่านแล้วบนเครื่องนี้ **ยังไม่ได้ทดสอบบนบอร์ดจริง** ดูรายละเอียดที่ [output/implementation-status.md](output/implementation-status.md)

## เล่นบนเว็บ (ไม่ต้องมีกล่องจริง)

เปิด `index.html` ที่รากโปรเจกต์ผ่านเว็บเซิร์ฟเวอร์ (หรือลิงก์ GitHub Pages ของ repo นี้) แล้วกด BEGIN EXPLORATION

- ลากนิ้วหรือเมาส์เพื่อหมุนกล่อง · กดค้าง ▼ / ▲ (หรือลูกศรขึ้นลง) เพื่อดำลงและขึ้น · Scan → Collect → Analyze
- เพลงเข้าเมื่อผู้เล่นขยับ และค่อย ๆ จางเมื่อหยุด ไม่มีเสียงไหนเปิดวน — ที่มาและกติกาอยู่ใน [docs/plan-sky-sound-ecosystem-web.md](docs/plan-sky-sound-ecosystem-web.md)
- `twin/index.html?dev=1` เปิดมุมมองวิศวกรรมเดิม (Unfold, Seam fixture, จอแบนหกใบ) · `?live=1` ใช้กับบอร์ดจริงผ่าน `laptop/twin_bridge.py`
- เสียงบนเว็บใช้สำเนา MP3 ใน `assets/audio/web/` (สร้างด้วย `python tools/make_web_audio.py`) ต้นฉบับอยู่ที่ `assets/audio/` ไม่ถูกแก้
- ที่มาของเสียง: [assets/audio/ATTRIBUTION.md](assets/audio/ATTRIBUTION.md) — เสียงชุดที่เพื่อนรวบรวมมายังไม่ทราบที่มาและสัญญาอนุญาต

## เป้าหมาย

สร้างภาพชั้นทะเลแบบคลี่เป็นแผ่น แล้วแมพลงจอ ST7789 240×240 หกใบของลูกบาศก์ ภาพทะเลและปลาอยู่กับตัวลูกบาศก์เมื่อมุมหันเปลี่ยน มีเป้าเล็งคงทิศด้านหน้าฐาน ล้อเลื่อนระดับทะเล และปุ่ม Scan / Collect / Analyze ตามที่ผู้ใช้ยืนยัน จอคอมเป็นแผงควบคุมเรือดำน้ำ แสดงสถานะ ผลสแกน ภาพตัวอย่างที่เก็บ และผลวิเคราะห์ พร้อมเล่นเสียงใหม่

งานนี้เริ่มใหม่ทั้งหมด ไม่อ่าน คัดลอก import หรือดึงภาพ เสียง โค้ด และ dependency จาก `../demo/` หรือเดโมเก่าอื่น ห้ามใช้เดโมเก่าเป็นฐานในการสร้างงานใหม่

คำชี้แจงล่าสุดของผู้ใช้มีลำดับเหนือเอกสารเดิม: เป็นต้นแบบเล็ก งบซื้อเพิ่มรวม V1 และต้นแบบสมบูรณ์ไม่เกิน 5,000 บาท มีเครื่องพิมพ์และเส้นแล้ว ไม่ต้องซื้ออุปกรณ์เสียงหรือ slip ring

## เปลี่ยนแปลงสำคัญ: ไม่มีเซนเซอร์วัดการหมุนในต้นแบบนี้

แผนเดิมจะใช้ AS5600 อ่านมุมหมุนของตัวลูก แต่ชุดที่ได้มา**ไม่มีทั้งตัว AS5600 และแม่เหล็ก** จึงไม่มีการวัดการหมุนตัวลูกเลย ตามที่ผู้ใช้สั่งให้ตัด เฟิร์มแวร์ไม่มีโค้ดของเซนเซอร์นี้เหลืออยู่

แทนที่ด้วย `yaw.source = encoder`: ล้อ KY-040 หมุนมุมหัน และ **กดล้อเพื่อสลับหน้าที่ล้อระหว่างความลึกกับมุมหัน** เรขาคณิต การสแกน การเก็บภาพ และเสียงเหมือนเดิมทุกอย่าง เปลี่ยนแค่ว่าใครป้อนค่า yaw สิ่งที่หายไปคือการหมุนตัวลูกจริงแล้วเป้าอยู่กับที่

GPIO6 ที่เคยกันไว้ให้ I2C ตอนนี้เป็นสวิตช์ของล้อ GPIO7 ปล่อยว่าง ถ้าวันหนึ่งซื้อทั้งเซนเซอร์และแม่เหล็กมา สิ่งที่ต้องทำอยู่ท้าย [config/wiring-table.md](config/wiring-table.md)

## อ่านและส่งงานตามลำดับ

1. [แผนระบบ](docs/system-plan.md) — ขอบเขต วิธีแมพภาพ และข้อตกลงระหว่างส่วนต่าง ๆ
2. [ลำดับงานและการตรวจรับ](docs/delivery-plan.md) — ทำให้รันได้จากจอหนึ่งใบไปหกใบ
3. [สัญญาสื่อสารแผงควบคุมและเสียง](docs/audio-protocol.md) — ESP32 และโปรแกรมโน้ตบุ๊กใช้ร่วมกัน
4. [ใบสั่งงาน 5.6 Luna](work-orders/LUNA-IMPLEMENTATION.md) — ผู้ใช้ส่งให้ผู้เขียนโค้ด
5. [ใบสั่งงาน Claude Code](work-orders/CLAUDE-AUDIO.md) — ผู้ใช้ส่งให้ผู้หาเสียงและช่วยตรวจ

## โครงสร้าง

| โฟลเดอร์ | หน้าที่ |
|---|---|
| `firmware/` | C++ บน ESP32-S3-Zero |
| `laptop/` | แผงควบคุมเรือดำน้ำ คลังภาพที่เก็บ ผลวิเคราะห์ และเสียง |
| `tools/` | เครื่องมือสร้าง/แปลงภาพทะเลใหม่ preview และ test vectors |
| `config/` | ผังขา ทิศจอ ขอบเขตภาพจริง และตัวเลือกการเล่น |
| `assets/source/` | ภาพต้นฉบับใหม่และข้อมูลตำแหน่งสิ่งมีชีวิต |
| `assets/generated/` | ภาพ RGB565 และข้อมูลที่แปลงสำหรับบอร์ด |
| `assets/audio/` | เสียงใหม่พร้อมที่มาและสิทธิ์ใช้งาน |
| `tests/` | ตรวจคณิตศาสตร์แมพภาพ เป้าเล็ง โปรโตคอล และภาพที่เก็บ |
| `output/` | หลักฐาน build ภาพ preview และบันทึกทดสอบ |

## ติดตั้งจากเครื่องเปล่า

ต้องใช้ Python 3.11 ขึ้นไป รันทุกคำสั่งจาก `prototype-v1/`

```text
py -3 -m venv .venv
.venv\Scripts\python -m pip install -r laptop\requirements.txt
.venv\Scripts\python -m pip install platformio ziglang
```

`platformio` ใช้ build เฟิร์มแวร์ `ziglang` ใช้ compile ตัวตรวจคณิตศาสตร์ฝั่ง C++ บนเครื่อง เพราะ Windows เครื่องนี้ไม่มี compiler ของระบบ

## สร้าง asset และตรวจก่อนแตะฮาร์ดแวร์

```text
.venv\Scripts\python tools\generate_atlas.py
.venv\Scripts\python tools\make_vectors.py
.venv\Scripts\python -m unittest discover -s tests -v
.venv\Scripts\python tests\native\run_native_test.py
.venv\Scripts\python tools\preview.py --grid --yaw 272.9 --depth 0.4125
.venv\Scripts\python tools\preview.py --sweep 8
```

- `generate_atlas.py` สร้าง `assets/generated/sea_atlas.png`, `sea_atlas_rgb565_be.bin`, `targets.json`, `pack.json` และ `firmware/include/targets_generated.h` จากภาพชุดเดียว ภาพ PNG ถูก quantize เป็น RGB565 แล้ว จึงเป็นพิกเซลชุดเดียวกับที่บอร์ดแสดง
- `make_vectors.py` เขียน `tests/vectors/cube_math_vectors.json` และเฮดเดอร์คู่กัน ทั้ง Python และ C++ ถูกบังคับให้ได้ค่าเดียวกันจากไฟล์นี้ รันใหม่ทุกครั้งที่แก้ `config/scene.json` หรือ `config/faces.json`
- `run_native_test.py` compile `firmware/src/math/cube_math.cpp` บนเครื่องแล้วเทียบกับ vector ชุดเดียวกัน
- `preview.py` วาดหกหน้าแยกกันพร้อมเป้าเล็ง และบอกว่า UV ใต้เป้าตรงกับ target ไหน `--sweep N` เขียนชุดเฟรมตรวจรอบตัวลงใน `output/preview-sweep/` ใช้ดูว่าเป้าเดินข้ามหน้าเรียบและพื้นหลังไม่ขยับตาม yaw

## แผงควบคุมบนโน้ตบุ๊ก

```text
.venv\Scripts\python laptop\app.py --simulate --no-audio
```

โหมด `--simulate` ใช้ `BoardSimulator` ซึ่งคำนวณด้วยโมดูลคณิตศาสตร์ตัวเดียวกับที่ตรวจเฟิร์มแวร์ จึงลองครบวง Scan → Collect → Analyze ได้โดยไม่ต่อบอร์ด ป้าย `SIMULATED INPUTS — NO BOARD` อยู่บนหน้าต่างตลอดเวลา ไม่ใช่หลักฐานว่าฮาร์ดแวร์ผ่าน

ปุ่มเล็งเป้าถูกสร้างจาก `assets/source/targets.json` โดยตรง ชุดปัจจุบันคือ `luna04_surface_fish_seam`, `luna04_orange_reef_fish`, `luna04_manta_ray`, `luna04_jellyfish`, `luna04_lantern_fish`, `luna04_seahorse_shape` แต่ละปุ่มตั้งมุมหันและความลึกไปที่เป้านั้น ปุ่ม `empty water` เล็งไปที่น้ำเปล่าเพื่อดู miss

แป้นพิมพ์: `1` Scan, `2` Collect, `3` Analyze, `Up`/`Down` เปลี่ยนความลึก, `Left`/`Right` เดินมุมหันครั้งละ 5 องศา ทั้ง Up/Down และ Left/Right กดค้างแล้วเดินต่อเนื่องได้ **ลูกศรซ้าย/ขวาหมุนเฉพาะตัวจำลองบนคอม** ไม่ได้อ่านการหมุนของตัวลูกและไม่เปลี่ยนมุมหันของบอร์ดซึ่งยังตั้ง `yaw.source = none` ตอนหมุนด้วยลูกศร แผงจะแสดง `KEYBOARD HEADING` แทน `FIXED HEADING` และ state รายงาน `yaw_source: "keyboard"`

ใช้งานจริงให้เลือก COM แล้วกด Connect แผงจะส่ง `get_state` เอง ปิดแผงก่อนแฟลชหรือเปิด serial monitor เพราะพอร์ตเดียวเปิดได้โปรแกรมเดียว

## Build และแฟลช

```text
.venv\Scripts\python -m platformio run -e esp32-s3-zero
```

ก่อนแฟลชให้ผู้ใช้ยืนยัน `config/wiring-table.md` แล้วจึงเปลี่ยน `kHardwarePinsConfirmed` ใน `firmware/include/deep_sphere_config.h` จากนั้น

```text
copy assets\generated\sea_atlas_rgb565_be.bin firmware\data\sea_atlas_rgb565_be.bin
.venv\Scripts\python -m platformio run -t uploadfs --upload-port COMx
.venv\Scripts\python -m platformio run -t upload --upload-port COMx
```

บอร์ดแฟลชผ่าน USB Serial/JTAG ในตัวชิป ซึ่ง esptool คุยด้วยไม่ได้ถ้ากระโดดไป 460800 หรือใช้ stub loader
อาการคือค้างแล้วขึ้น `No serial data received` `platformio.ini` จึงปักไว้แล้วทั้ง `upload_speed = 115200`
และ `upload_flags = --no-stub` อย่าถอดออก และหลังบอร์ดรีเซ็ต พอร์ต COM จะหายไปครู่หนึ่งก่อนกลับมา เป็นพฤติกรรมปกติของ USB ในตัวชิป

เริ่มตรวจจอเดียวโดยตั้ง `kDisplayCount = 1` และต่อเฉพาะ `px`; หลัง pattern จอเดียวผ่านจึงเปลี่ยนเป็น 6 และตรวจเลข `px/nx/py/ny/pz/nz` ตาม wiring table โหมดเริ่มต้นยังไม่ขับ GPIO ที่ยังไม่ยืนยัน

เฟิร์มแวร์โหลด atlas ทั้งแผ่นเข้า PSRAM ครั้งเดียวตอนบูต (1 MB จาก 2 MB) แล้ววาดทีละแถบ 16 แถวผ่าน `writePixels` ถ้าไม่พบ PSRAM จะ log และวาดแถบสีวินิจฉัยแทน ไม่แกล้งวาดทะเลปลอม

## ข้อกำหนดและข้อมูลที่ยังต้องยืนยันหน้างาน

- ผู้ใช้ยืนยันแล้ว: ปุ่ม Scan / Collect / Analyze; ล้อเลื่อนความลึก และเมื่อไม่มีเซนเซอร์วัดการหมุน ล้อรับหน้าที่มุมหันด้วยโดยกดล้อสลับ
- ผัง GPIO และตำแหน่งจริงของจอทั้งหกต้องยืนยันกับผู้ประกอบก่อนแฟลชใช้งานจริง รวมถึงยืนยันว่า GPIO6 ใช้เป็นสวิตช์ของล้อได้
- `mount_orientation` ยังเป็น identity ต้องวัดท่าตั้งจริงของลูกบาศก์แล้วใส่ quaternion ก่อนคาดหวังว่าหน้าบน/ล่างจะแมพถูก

การเปลี่ยนภาพทั้งฉากให้ชดเชยการหมุน เปลี่ยนไปใช้เป้าเล็งพลาสติก หรือตัดจอเหลือจำนวนอื่น เป็นการเปลี่ยนขอบเขต ต้องแจ้งเหตุผลให้ผู้ใช้ตัดสินใจ
