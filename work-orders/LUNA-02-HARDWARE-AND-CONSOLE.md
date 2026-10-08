# ใบสั่งงาน Astra 02 — รับช่วงจาก Claude และปรับแผงควบคุม

ผู้รับ: 5.6 Luna · ผู้มอบหมาย: Astra ตามคำสั่งผู้ใช้

## เริ่มจากสถานะล่าสุดบนดิสก์

ทำงานใน `C:/Users/Acer/Downloads/oceanX/prototype-v1` อ่าน `output/implementation-status.md`, `config/wiring-table.md`, config, firmware และ laptop ปัจจุบันก่อนแก้ Claude แก้และรายงานผลทดสอบแล้ว อย่าใช้ความทรงจำจากรอบที่คุณหยุดเพราะลิมิตมาทับงานล่าสุด

ใบสั่งงานนี้มีลำดับเหนือ LUNA-IMPLEMENTATION.md เก่าในส่วนที่ขัดกัน ไม่เริ่มโครงการใหม่ ไม่อ่าน/import เดโมเก่า ไม่เพิ่ม AS5600 หรือไลบรารี Wire กลับ ไม่มีเซนเซอร์หมุนจริง ผู้ใช้ทำฮาร์ดแวร์เอง ห้ามใส่อีโมจิในโค้ด

ขอบเขตปัจจุบัน: หกจอ ภาพพื้นหลังยึดกับตัวลูก ล้อ KY-040 กดสลับ depth/heading ปุ่ม Scan/Collect/Analyze แผงคอมเก็บภาพและเล่นเสียง หมุนตัวลูกด้วยมือแล้วเป้าคงทิศอัตโนมัติยังทำไม่ได้ด้วยชุดนี้

ทำสองช่วงเรียงกัน: A แก้สี่จุดเพื่อเตรียมทดสอบจอ; B ปรับหน้าตาแผงคอมตาม design brief ด้านล่าง ส่งผังสายช่วง A ให้ผู้ใช้เห็นได้ทันทีที่เสร็จ แล้วทำ B ต่อ ไม่รอให้ UI สวยก่อนรายงานผังสาย

## A1 — GPIO6 และผังอินพุต

- ยืนยันจาก schematic/pinout ผู้ผลิตว่า S3-Zero รุ่นผู้ใช้มี GPIO6 เป็น input ได้ ไม่ทิ้งสถานะกำกวมว่าไม่ทราบว่าขานี้มีหรือไม่
- SW ของ KY-040 ไป GPIO6 อ่านแบบ active-low INPUT_PULLUP ร่วม GND และใช้แรงดัน logic 3.3V; ตรวจ debounce และสลับโหมดหนึ่งครั้งต่อการกด
- GPIO7 ว่าง Astra แนะนำเป็นตำแหน่ง Analyze แทน GPIO3 เพื่อลดการใช้ strapping pin: ใส่เป็นผังแนะนำในเอกสารและคอนฟิกทางเลือกที่ตรงกัน ถ้าสายจริงยังไม่ทราบ อย่าเปลี่ยนความหมายของผังที่ต่อไปแล้วเงียบ ๆ แจ้งผู้ใช้ชัดว่าขาใดเปลี่ยนก่อนเปิด hardware mode
- GPIO3 เป็นขา strapping เกี่ยวกับ JTAG ไม่อ้างว่าการใช้เป็นปุ่มทำให้บอร์ดบูตไม่ได้เสมอ
- แยก `pin capability confirmed` จาก `user wiring confirmed`: ขารองรับไม่ได้แปลว่าผู้ใช้ต่อครบแล้ว คง hardware output flag ตามสถานะจริง

แหล่งหลัก: https://files.waveshare.com/wiki/ESP32-S3-Zero/ESP32-S3-Zero-Sch.pdf และ ESP32-S3 datasheet ของ Espressif

## A2 — ไฟจอและ BL ให้ครบทุกขา

- แก้ wiring-table ให้ชัดว่า VCC จอหกใบมาจาก OUT+ ของ MP1584 ที่ตั้งและวัด 3.3V แล้ว OUT-/GND ใช้กราวด์ร่วมกับ ESP32
- อย่าใช้ข้อความกำกวม `Board 3V3 -> all displays` จนผู้ใช้เอาโหลดทุกจอผ่าน regulator บน ESP32 โดยไม่ตั้งใจ
- เพิ่มขา BL/BLK ที่หายจากตาราง ระบุไฟ/วงจรควบคุมที่เหมาะกับโมดูลจริง ถ้ายังไม่ทราบว่าเป็น LED supply หรือ control input ให้ระบุสิ่งที่ต้องดูบนโมดูล ห้ามเดากระแสหรือขับ LED รวมจาก GPIO
- แยกไฟจอ ไฟ logic อินพุต และขาสัญญาณให้เห็นชัด ไม่ต่อ OUT+ 3.3V ของ MP1584 ขนานกับ rail 3.3V ของบอร์ดโดยไม่มีการออกแบบรองรับ
- ทางไฟใช้แหล่งเดียวตามการประกอบจริง ไม่ขนานหัวชาร์จ 5V กับ VBUS คอมโดยตรง
- ผู้ใช้กำลังพิจารณาจุดรวมสายแบบเสียบถอดได้ภายในลูก รวม 7 net ร่วม + CS หกเส้น = 13 เส้นลงท่อในแบบที่ยังแยก BL จำนวนสายเปลี่ยนได้เฉพาะเมื่อผัง BL ที่ยืนยันทำให้รวม net เพิ่มได้จริง

## A3 — แยกพิกเซลจอออกจากพื้นที่จอจริงบนหน้าลูกบาศก์

พบใน main.cpp: localU=x/240, localV=y/240 ถูกส่งเข้า faceDirection โดยตรง แล้วใช้ active_image ทาขอบดำ สิ่งนี้ยังแทนว่าจอเกือบเต็มหน้าลูกบาศก์ ไม่ใช่พื้นที่ภาพเล็กที่ฝังอยู่กลางกรอบจริง

แก้ให้มีสอง coordinate spaces และชื่อ config ที่ไม่กำกวม:

1. Display pixel UV: 0–1 ครอบคลุมพิกเซลจริง 240×240
2. Physical face UV: 0–1 ครอบคลุมหน้าลูกบาศก์รวมพลาสติก จอแต่ละหน้าอยู่ใน rectangle ที่อาจเยื้องศูนย์

Renderer: `u_face = left + u_pixel*(right-left)` และเช่นเดียวกันกับ V แล้วค่อยคำนวณทิศ/atlas UV

Reticle: ray ตัดหน้าลูก -> ตรวจอยู่ใน rectangle จริง -> inverse mapping กลับเป็น pixel UV -> วาดเป้า ไม่ใช่เอา face UV คูณ 240 ตรง ๆ

ถ้าต้องมีหน้ากากพิกเซลที่ถูกกรอบบังจริง ให้แยกเป็นอีกค่า ไม่ใช้แทนตำแหน่งจอทั้งแผงบนลูก พื้นที่กรอบพลาสติกไม่มีพิกเซล ไม่สร้าง black border บนจอเพียงเพื่อจำลองพื้นที่นั้น

- จอแต่ละหน้ามี rectangle/rotation ของตนเองรองรับภาพเยื้องบน PCB
- ขนาดจริงรอผู้ใช้วัด แต่ implement ด้วย config และ fixture จำลองที่ติดป้ายได้ทันที อย่าใส่ตัวเลขที่แต่งขึ้นแล้ว confirmed=true
- เพิ่ม test ของจอเล็กกลางหน้า, จอเยื้องศูนย์, rectangle ไม่จัตุรัส, pixel/face round-trip, hit ตรง renderer, bezel miss และขอบ U=0
- รักษาบั๊กที่ Claude แก้แล้ว: signed face selection, crop top-left, UV hit space, RGB565 ตรง PNG/bin และ PSRAM stripe rendering

## A4 — ท่าตั้งบนมุมและการทดสอบจอหนึ่งใบ

- Identity เป็น fixture ได้ ไม่ใช่ท่าตั้งบนมุมจริง แยก fixture กับ configuration สำหรับประกอบ
- เพิ่ม fixture ของ cube body diagonal ตั้งตรงที่เป็น rotation matrix/quaternion ถูกต้อง และทดสอบทั้งพื้นหลังกับ reticle บนท่านี้ ไม่ตรวจเฉพาะ identity
- อธิบายวิธีผู้ใช้ระบุว่าหน้า px/nx/... ติดตรงไหนและด้านบนพิกเซลหันไหน เพื่อกำหนดท่าจริง ไม่บังคับให้ผู้ใช้วัด quaternion ด้วยมือ
- ทำหรือยืนยัน single-display test mode ที่ขับเฉพาะจอที่เลือก แสดงชื่อหน้า ลูกศรบน และ RGB bars ก่อน full scene ไม่อ้างว่ามีแล้วถ้ายังไม่ได้เปิดรัน
- ให้คู่มือ firmware upload + filesystem upload + ตรวจ PSRAM runtime สั้น ๆ คง flags hardware ตามการยืนยันจริง ไม่แฟลชอุปกรณ์โดยยังไม่รู้พอร์ต/ผัง

## B — Design brief: แผงควบคุมเรือดำน้ำ

ภาพปัจจุบันที่ต้องดู: `output/dashboard-simulated.png` ปัจจุบันข้อมูลครบแต่หน้าตาเป็นแบบฟอร์มทดสอบ ให้เปลี่ยนลำดับสายตาและองค์ประกอบจริง ไม่ใช่แค่เปลี่ยน background เป็นสีดำ

### แนวทาง

บรรยากาศเครื่องมือสำรวจทะเลลึก อ่านข้อมูลและดูตัวอย่างได้ชัด ภาพที่เก็บคือจุดเด่นหลัก ให้ดูเป็นเครื่องมือที่ใช้งานได้จริง มากกว่าหน้าฟอร์ม debug หรือฉากหนังที่เต็มไปด้วยตัวเลขสมมติ

ใช้ Tkinter/ttk/Canvas/Pillow ที่มีอยู่และ `after` สำหรับ motion ตอนนี้ไม่ต้องย้ายทั้งแอปไปเว็บหรือเพิ่ม Motion/React เพียงเพื่อทำ animation เก็บ DashboardModel, protocol, ACK, sample persistence, event dedup, mixer และ BoardSimulator ที่ผ่านการแก้แล้ว

### Layout เป้าหมาย 1280×800; ใช้งานได้ที่ 1024×720

```text
┌ DEEP SPHERE / SUBMERSIBLE CONSOLE ── mode ── connection ─ settings ┐
│ Depth + heading │                                                │
│ instrument      │  SELECTED SAMPLE / SCAN RESULT    │ ANALYSIS    │
│                 │  ภาพตัวอย่างใหญ่รักษาอัตราส่วน     │ รายละเอียด  │
│ depth scale     │  caption / เวลาเก็บ / ระดับที่เก็บ  │ เลือกแล้วอ่าน │
│ wheel mode      │                                   │            │
│                 ├─ SCAN ───── COLLECT ───── ANALYZE ┤            │
├ COLLECTION ─── thumbnails ที่คลิกเลือกได้ ────────────────────────┤
└ feedback ล่าสุด / mute-volume ─────────── diagnostics (ย่อไว้) ──┘
```

- Top bar สูงประมาณ 56 px; outer padding 20–24 px; gap 12–16 px
- ซ้ายประมาณ 200–220 px เป็น depth scale และข้อมูลที่อ่านได้จริง ไม่ใส่หลายการ์ดซ้ำข้อมูลเดียวกัน
- กลางขยายตามหน้าต่าง ให้ภาพอย่างน้อยประมาณ 360×280 px ที่ขนาดเป้าหมาย ไม่ยืดภาพผิดอัตราส่วน
- ขวาประมาณ 260–300 px แสดงชื่อ/รหัสตัวอย่าง depth ที่เก็บ และข้อมูล Analyze มี wrap/scroll เมื่อยาว
- คลังภาพด้านล่างสูงประมาณ 120–150 px ใช้ thumbnail พร้อมชื่อย่อและ selected state ไม่ใช้ listbox ยาวแสดง session id อย่างเดียว
- เมื่อหน้าต่างเล็ก จัดสัดส่วนใหม่หรือย่อแผงข้างให้ยังเข้าถึง action/ภาพได้ ห้ามตัดปุ่มออกนอกจอ

### สีและตัวอักษร

| Token | ค่า |
|---|---|
| background | #07141C |
| panel | #10232D |
| inset | #0B1C25 |
| border | #284550 |
| text primary | #E7F0F2 |
| text secondary | #9DB3BC |
| accent / selected | #48C7BE |
| warning / simulated | #E8B66A |
| error | #ED8D8D |

ใช้ Segoe UI/ฟอนต์ระบบที่รองรับภาษาไทย และ Consolas สำหรับค่าตัวเลข ป้ายหลักประมาณ 11–12 pt เนื้อหา 12–14 pt ตัวเลข depth 28–36 pt ขอบบาง มุมไม่ต้องโค้งทุกอย่าง ไม่มี gradient เรืองแสงทั่วจอ

ไม่ต้องเปลี่ยนทุกข้อความเป็นภาษาเดียวอย่างเร่งรีบ แต่เลือกป้ายให้คงที่ Scan / Collect / Analyze เหมือนปุ่มจริง และรักษาคำอธิบายไทยให้อ่านได้

### ข้อมูลและสถานะที่ต้องจริง

- ถ้า depth ยังเป็น normalized ให้แสดงระดับเป็นเปอร์เซ็นต์หรือ LEVEL ไม่แต่งตัวเลขเมตร
- Heading จากล้อแสดงที่มาว่า WHEEL ไม่ใช้คำว่า compass measured หรือ rotation tracking
- โหมดจำลองมีป้าย SIMULATED / NO BOARD มองเห็นตลอด แต่ไม่กินพื้นที่ครึ่งหน้า
- ช่องเลือก COM/refresh/request state/raw logs และ sliders/ปุ่ม jump target ของ simulator อยู่ใน settings/diagnostics ย่อได้ โดย mode และ connection ยังเห็นใน top bar
- ไม่แสดง absolute path ยาวในแผงหลัก เอาไว้ diagnostics หรือปุ่มเปิดโฟลเดอร์
- Empty state ก่อนเก็บ: รูปกรอบว่างพร้อมข้อความว่าให้ Scan แล้ว Collect ไม่มีภาพปลาสมมติที่ดูเหมือนเก็บแล้ว
- ถ้า asset เป็นเป้าทดสอบวงกลม ให้ติดป้าย test asset และใช้ภาพจริงที่ระบบมี ห้ามสร้างข้อมูลหรือภาพ specimen ปลอมเพื่อให้ screenshot สวย
- ใน hardware mode ปุ่ม Scan/Collect บน UI ถ้ายังไม่มี command path ต้องไม่แสดงว่าใช้งานได้จริง ใช้เป็นสถานะ feedback หรือ disable พร้อมคำบอกให้กดปุ่มชิ้นงาน Analyze เปิดตัวอย่างที่เลือกได้ตาม logic เดิม
- Scan miss, bezel gap, collect ACK pending/saved/error, analyze-empty, missing-audio และ disconnected เป็นคนละสถานะ ไม่ใช้คำว่า success เหมารวม

### Motion ที่มีหน้าที่

- Hover/focus/pressed ชัด ไม่พึ่งสีอย่างเดียว
- Scan: เส้นกวาดสั้นหรือ highlight 250–450 ms เฉพาะตอนเกิด Scan แล้วจบ ห้ามกวาดวนตลอดเมื่อไม่มี event
- Collect: thumbnail ใหม่ highlight/fade ประมาณ 180–250 ms และคง selection ของตัวอย่างที่บันทึกสำเร็จ ไม่เล่นเอฟเฟกต์สำเร็จก่อน ACK
- Analyze: เปิดรายละเอียดนุ่มนวลประมาณ 150–200 ms พร้อมชื่อ sample ที่ถูกเลือก
- Depth: interpolate เฉพาะตำแหน่งตัวชี้เพื่ออ่านง่าย ค่าตรรกะและการเก็บยังใช้ค่าจริง ห้าม animation ทำให้แสดงว่าภาพถูกเก็บคนละระดับ
- ใช้ `after` แบบไม่บล็อกและยกเลิก callback เมื่อปิดหน้าต่าง มี reduced motion/off ได้เมื่อทำได้โดยไม่ขยายงาน
- ไม่สร้างพื้นหลังอนุภาควิ่งตลอด ไม่เพิ่มเอฟเฟกต์ที่ทำให้ serial/UI หน่วง

## Validation และสิ่งส่งมอบ

1. อ่านสถานะล่าสุดแล้วรัน baseline ตามคำสั่งที่ Claude ใช้ก่อนแก้ บันทึก regression ที่มีอยู่ อย่าบอกว่า Python/PIO ไม่มีจากการเช็ก PATH อย่างเดียว: ดู venv, runtime ที่ติดตั้ง และ absolute executable path ตามบันทึกก่อน
2. หลังแก้ A รัน Python tests, native C++ test vectors และ firmware build รวม hardware compile path พร้อม buildfs ตามผลกระทบ เพิ่ม test ที่ตรวจ non-identity mount และ physical/pixel mapping จริง
3. รันแผงจริงใน simulation แล้วตรวจ Scan→Collect→Analyze, duplicate event, reconnect, เปิดคลังกลับ, missing audio และการเปลี่ยน selected sample ไม่ให้ regression
4. เก็บ screenshot จริงที่ 1280×800 และอย่างน้อยหนึ่งภาพที่หน้าต่างเล็ก พร้อมสถานะ empty, collected/analyzed และ error/disconnected ใช้ภาพจากแอปจริง ไม่ใช่ mockup แทนหลักฐาน
5. ส่ง `output/luna-02-status.md`: สี่ข้อ A แก้อะไร UI เปลี่ยนอย่างไร คำสั่งและผลจริง พร้อมสิ่งที่ยังรอผู้ใช้ฮาร์ดแวร์แยกชัด
6. อัปเดต wiring/config/docs ที่เกี่ยวข้องให้ตรงกัน แต่ไม่ทับประวัติผลทดสอบ Claude จนดูเหมือนผลใหม่ของคุณ

เน้นให้ผู้ใช้ต่อจอหนึ่งใบและมีแผงที่ใช้งานแล้วเข้าใจได้ก่อน อย่าให้การตามหา design reference หรือ library ใหม่กินรอบทำงานนี้ หากมีข้อสงสัยด้านแบบแสดงสถานะให้ใช้ brief นี้เป็นข้อกำหนดและทำต่อได้
