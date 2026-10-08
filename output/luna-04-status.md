# Luna 04 — ocean artwork and asset pack status

บันทึก: 11 กันยายน 2026

## ภาพต้นฉบับและ source ที่ใช้จริง

| ไฟล์ | ขนาด | บทบาท |
|---|---|---|
| `assets/source/sea_atlas_luna04_master.png` | 2,242,543 bytes | ภาพวาดต้นฉบับ raster ที่สร้างขึ้นใหม่สำหรับ LUNA-04 เป็น authoritative art input |
| `assets/source/sea_atlas_luna04_composition.json` | schema 1 | ตำแหน่ง/ขนาด subject, `horizontal_shift_px: 900`, `horizontal_wrap: true`, `vertical_wrap: false` |
| `assets/source/targets.json` | schema 2 | targets ที่ config อ้างถึง (`scene.targets_file`) |
| `assets/generated/sea_atlas.png` | 475,021 bytes | 1024×512 quantize เป็น RGB565 แล้ว จึงเป็นพิกเซลชุดเดียวกับที่บอร์ดวาด |
| `assets/generated/sea_atlas_rgb565_be.bin` | 1,048,576 bytes | RGB565 big-endian ตรงตามงบ flash/PSRAM เดิม |
| `assets/generated/targets.json` | schema 2 | สำเนา generated ของไฟล์เดียวกัน generator เขียนทั้งสองที่จากข้อความชุดเดียว |
| `assets/generated/pack.json` | schema 2 | manifest ระบุ source art, composition และขั้นตอนแปลง |
| `firmware/data/sea_atlas_rgb565_be.bin` | 1,048,576 bytes | staged ตาม build workflow แฮชตรงกับ generated |

`sha256` ของ RGB565 ทั้งฝั่ง generated และ firmware/data คือ `28918fdcc785c327…` ตรงกัน

`sea_atlas.svg` เดิมยังอยู่ในโฟลเดอร์ source แต่**ไม่ถูกใช้เป็น input ของ pipeline อีกแล้ว**

## Pack ID

`luna-04-ocean-atlas` ปรากฏตรงกันทุกฝั่ง: `assets/generated/pack.json`, `config/scene.json`, `laptop/core.py`,
`firmware/include/deep_sphere_config.h`, `firmware/include/targets_generated.h`, `tests/native/vectors_generated.h`,
`tests/vectors/cube_math_vectors.json` เฟิร์มแวร์ test-art เก่าจึงเก็บจาก atlas ใหม่ไม่ได้เงียบ ๆ

## Pipeline ที่แก้

- `tools/generate_atlas.py` เดิมวาดฉากทดสอบของตัวเองแล้วรายงานว่า source เป็น SVG ตอนนี้อ่าน master raster จริง
  แล้ว resize เป็น 1024×512 ด้วย Lanczos ก่อน quantize RGB888 → RGB565 **ครั้งเดียว** PNG และ .bin จึงมาจาก
  บัฟเฟอร์เดียวกัน
- `targets.json` ถูกคำนวณจากตำแหน่ง subject ใน composition หลัง shift ไม่ใช่ค่าที่พิมพ์มือ
- subject ที่คร่อมรอยต่อซ้าย/ขวามี `wraps_horizontal: true` และ bounds ที่ติดลบได้ (`left: -22.0`)
  เพื่อให้ hit region ต่อเนื่องข้าม seam

## Subject ที่เก็บได้ หกตัว สองตัวต่อระดับ

| target_id | label | band |
|---|---|---|
| `luna04_surface_fish_seam` | striped reef fish at horizontal seam | surface |
| `luna04_orange_reef_fish` | orange reef fish | surface |
| `luna04_manta_ray` | manta ray silhouette | middle |
| `luna04_jellyfish` | jellyfish | middle |
| `luna04_lantern_fish` | lantern fish | deep |
| `luna04_seahorse_shape` | seahorse-like silhouette | deep |

ชื่อทั้งหมดเป็นคำบรรยายทั่วไป ไม่ใช่ชื่อสปีชีส์ ไม่อ้างความลึกจริง และไม่อ้างว่าเป็นภาพถ่าย

## Preview สำหรับรีวิว

สามระดับ `surface` / `mid` / `deep` แต่ละระดับมีครบชุด:

- `preview-six-face-net-<ระดับ>.png`, `preview-six-face-assembled-<ระดับ>.png`,
  `preview-six-face-corner-upright-<ระดับ>.png`, `preview-six-face-calibration-<ระดับ>.png`,
  `preview-six-face-metadata-<ระดับ>.json`
- face crop ขนาดจริง 240×240 ไม่สเกล 18 ไฟล์: `preview-face-{px,nx,py,ny,pz,nz}-<ระดับ>-240.png`

`tools/preview_cube.py --depth-label` เป็นตัวกำหนด suffix ไฟล์ชุดไม่มี suffix ที่ค้างจากรอบก่อนถูกลบทิ้ง
เพราะซ้ำกับชุด `-mid` แบบไบต์ต่อไบต์ ลิงก์ใน `luna-03-status.md` ถูกชี้ไปชุด `-mid` แทน

ภาพ preview มี overlay สำหรับรีวิวเท่านั้น artwork ที่ลงบอร์ดไม่มี grid, reticle, ป้ายหรือกรอบเป้าอบอยู่ในภาพ

## อินพุตมุมหันบนแผงคอม

เพิ่ม `Left`/`Right` เดินมุมหันครั้งละ 5 องศา กดค้างเดินต่อเนื่องได้ ค่าอยู่ใน
`config/controls.json → laptop_demo_input`

**ลูกศรหมุนเฉพาะตัวจำลองบนคอม** ไม่ได้อ่านการหมุนของตัวลูก และไม่เปลี่ยนมุมหันของบอร์ด
บอร์ดยังเป็น `yaw.source = none` (`YawSource::kNone`) ตามเดิม เมื่อมุมหันมาจากลูกศร state จะรายงาน
`yaw_source: "keyboard"` และแผงแสดง `KEYBOARD HEADING` แทน `FIXED HEADING` เพื่อไม่ให้ถูกอ่านสลับกับค่าจากเซนเซอร์

## การทดสอบที่รันจริงหลัง asset และโค้ดนิ่งแล้ว

| ชุด | ผล |
|---|---|
| `pytest tests` | 71 passed |
| `tests/native/run_native_test.py` | PASS 1413 checks, 0 failures |
| `platformio run -e esp32-s3-zero` | SUCCESS — RAM 5.9%, Flash 26.7% (349,465 จาก 1,310,720 bytes) |
| `platformio run -t buildfs` | SUCCESS — `littlefs.bin` 1,441,792 bytes จาก `firmware/data` |
| `tools/capture_dashboard_validation.py` | เก็บภาพครบ 4 สถานะ และ `gui_interaction_checks` เป็น true ทั้ง 7 ข้อ |

ไม่มีการ upload, uploadfs หรือ flash ใด ๆ

หลักฐาน Scan → Collect → Analyze: [dashboard-after-collected-1280x800.png](dashboard-after-collected-1280x800.png)
ป้าย `SIMULATED / NO BOARD` อยู่ในภาพ snapshot เป็นภาพ striped reef fish จริง และ analysis panel แสดง
`Subject: striped reef fish at horizontal seam` กับ pack `luna-04-ocean-atlas`

ตัวอย่างเก่าใน `output/samples/` ยังอยู่ครบ 23 ชุด ไม่มีการลบหรือตีความ snapshot เก่าด้วยภาพใหม่

## สิ่งที่ยังไม่ได้ตรวจ และตรวจด้วยวิธีนี้ไม่ได้

- **ความอ่านออกบนจอจริง 30 มม.** ตัดสินจาก screenshot ไม่ได้ ต้องดูด้วยตาบนแผงจริง
  face crop 240×240 ที่แนบมาใช้ประเมินคร่าว ๆ ได้เท่านั้น
- **จอห้าใบ** คอนฟิกถูกตั้งเป็น five_panel_no_bottom แล้ว (11 ก.ย. 2026) — หน้าล่าง `nz` ไม่มีจอเพราะเสียไปหนึ่งใบ
  `kSingleDisplayTest=false`, `kDisplayEnabled[5]=false`, และ `kHardwarePinsConfirmed=false`
  จนกว่าผู้ใช้จะเดินสายห้าใบเสร็จและตรวจแล้ว เฟิร์มแวร์จึงยังไม่ขับจอ และยังไม่มีการ flash
- `mount_orientation` ยังเป็น identity ท่าตั้งจริงของลูกบาศก์ยังไม่ได้วัด
- **เสียง** ยังเป็นแคตตาล็อกแปดคิวเดิม ไม่มีการ rebuild/ดาวน์โหลด และไม่มีการฟังจริงในรอบนี้

## ผลตรวจการเข้าถึง subject บน fixed-heading fixture

ใบงานข้อ 6 ให้ตรวจว่า subject ที่จะใช้เดโมไปถึงได้จริงด้วยการกวาดความลึกบน fixture ที่มุมหันคงที่
ผลคือ **ไปไม่ถึง** และตัวเลขอยู่ใน `output/heading-reachability.json`

กวาด yaw ทุก 0.5 องศาครบ 720 ค่า แต่ละค่ากวาดความลึก 401 ขั้น เปิดหน้าจอครบหกหน้าเชิงเรขาคณิต
และ `mount_orientation` เป็น identity:

- ไม่มีมุมหันคงที่ค่าใดเลยที่เข้าถึง subject ได้เกิน **2 จาก 6** ตัว
- 319 จาก 720 มุม เข้าถึงไม่ได้สักตัว, 315 มุมเข้าถึงได้ 1 ตัว, 86 มุมเข้าถึงได้ 2 ตัว
- ที่ `yaw = 0` ซึ่งเป็นค่าที่บอร์ดคอมไพล์อยู่ตอนนี้ เข้าถึงได้ตัวเดียวคือ `luna04_orange_reef_fish`
- ถ้านับเฉพาะ single-display diagnostic ปัจจุบัน (เปิดแค่หน้า `px`) ที่ `yaw = 0` **เข้าถึงไม่ได้สักตัว**

ช่วงมุมหันที่การกวาดความลึกเข้าถึงแต่ละตัวได้:

| target_id | ช่วง yaw (องศา) |
|---|---|
| `luna04_surface_fish_seam` | 239.5–277.5 |
| `luna04_orange_reef_fish` | −11.5–24.0 |
| `luna04_manta_ray` | 97.5–120.5 และ 149.5–202.5 |
| `luna04_jellyfish` | 59.5–93.5 |
| `luna04_lantern_fish` | 173.0–210.5 |
| `luna04_seahorse_shape` | 11.5–30.5 |

**ข้อสรุป:** เดโมที่แสดง subject ครบทั้งหกตัวต้องมีอินพุตมุมหัน จะเป็นลูกศรบนแผงคอม ล้อ KY-040
หรือการหมุนตัวลูกจริงก็ได้ แต่ fixture มุมหันคงที่อย่างเดียวทำไม่ได้ และไม่ควรแก้ด้วยการแอบหมุน yaw
ให้ผู้ชมโดยไม่บอก ลูกศรซ้าย/ขวาที่เพิ่มในรอบนี้จึงเป็นอินพุตที่จำเป็น ไม่ใช่ของแถม

ทางเลือกถ้าต้องการเดโมมุมหันคงที่จริง ๆ ต้องย้ายตำแหน่ง subject ใน composition ให้กระจุกอยู่ในช่วง u
ที่หน้าหน้าเดียวมองเห็น ซึ่งเป็นการเปลี่ยน art direction ต้องให้ผู้ใช้ตัดสิน

## แฟลชลงบอร์ดจริง 11 กันยายน 2026

ผู้ใช้ยืนยันว่าเดินสายจอห้าใบเสร็จแล้ว จึงเปิด `kHardwarePinsConfirmed = true` และอัปโหลดจริงผ่าน COM6

- `uploadfs` สำเร็จ 1,441,792 bytes hash ตรง
- `upload` สำเร็จ 351,200 bytes hash ตรง
- บอร์ดบูตแล้วส่ง state ต่อเนื่อง `zone: mid`, `aim_visible: true`, `inputs: keyboard`, `yaw_source: none`

แก้สองอย่างที่ทำให้ลิงก์หลุด ทั้งคู่ยืนยันกับฮาร์ดแวร์จริงแล้ว:

1. **อัปโหลดไม่ผ่าน** — บอร์ดแฟลชผ่าน USB Serial/JTAG ในตัวชิป ซึ่งไม่ตอบทั้งการกระโดดไป 460800
   และ stub loader ปัก `upload_speed = 115200` กับ `upload_flags = --no-stub` ใน `platformio.ini`
2. **แผงคอมรีเซ็ตบอร์ดตอนต่อ** — `SerialWorker` เปิดพอร์ตแบบปล่อย pyserial ยก DTR/RTS ขึ้นเอง
   ซึ่ง USB stack ของชิปอ่านว่าเป็นคำสั่งรีเซ็ต แก้ให้กด DTR/RTS ลงก่อนเปิด และให้ worker
   ต่อกลับเองเมื่อพอร์ตหาย แทนที่จะตายทั้ง thread

   > **แก้ไข 14 ก.ย. 2026:** ส่วนที่ขีดเส้นใต้ว่า "กด DTR/RTS ลงก่อนเปิด" **ผิด และถูกยกเลิกแล้ว**
   > ตั้ง `dtr=False` ทำให้บอร์ดไม่ส่งอะไรออกมาเลย เพราะ USB CDC ของ ESP32-S3 ส่งข้อมูลเมื่อ host ยก DTR เท่านั้น
   > ค่าที่ใช้จริงตอนนี้คือ `dtr=True, rts=False` และการทดสอบเปิดพอร์ตซ้ำยืนยันว่า session ไม่เปลี่ยน
   > จึงไม่มีหลักฐานว่าการเปิดพอร์ตรีเซ็ตชิปตัวนี้ ส่วนที่ยังจริงคือการต่อกลับเองเมื่อพอร์ตหาย
   > ดู `output/claude-usb-stability-status.md`

พิสูจน์: เปิดแล้วปิดแล้วเปิดพอร์ตใหม่สองรอบ ได้ session เดียวกัน `s3-af6e27ac-344-2bc76f2e`
และ seq เดินต่อจาก 31 ไป 59 แปลว่าบอร์ดไม่รีบูตตอนเชื่อมต่ออีกแล้ว

**บั๊ก session id ที่เจอและแก้:** `gSession` เดิมเป็น MAC + `millis()` ซึ่งตอนบูตค่าเกือบเท่าเดิมทุกครั้ง
จึงซ้ำข้ามการรีบูต และ `EventDeduper` ฝั่งคอมทิ้ง event ของ session ใหม่ว่าเป็นของซ้ำ
เติม `esp_random()` เข้าไปแล้ว

Python 75 passed
