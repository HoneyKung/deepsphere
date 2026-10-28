# สถานะงาน LUNA-20 — วงจอหกเหลี่ยมบนเว็บ

วันที่ 28 ตุลาคม 2026

## สรุป

แก้โค้ดวงจอและโหมดทรงกลมในเครื่องแล้ว รายงานผลครอบคลุมรายการที่ตรวจได้ ส่วนตรวจด้วยเบราว์เซอร์และภาพหน้าจอ 3 ภาพยังทำไม่ได้ในสภาพแวดล้อมนี้: CUA แจ้งว่าไม่มีเบราว์เซอร์ให้ใช้ (inventory ว่าง และ createBrowserTab("iab", ...) ตอบ Browser is not available: iab) แม้ preview server ที่พอร์ต 8770 จะตอบ HTTP 200 แล้วก็ตาม โฟลเดอร์ output/luna-20/ ถูกสร้างไว้แล้ว แต่ยังไม่มีภาพ

**แก้ในเครื่องแล้ว ยังไม่ขึ้นเว็บสาธารณะ ยังไม่แก้เฟิร์มแวร์**

## ไฟล์ที่แก้

- twin/geometry.js:8,46-66 เพิ่มการแมปจอ n ใบกับพิกัดทรงกระบอกด้วย atan, ผกผันหาเป้า, wrap มุม และพิกัดความสูงร่วมกับ strip เดิม
- twin/renderer.js:17-18,36-39,948-958,1024-1065,1129-1145 เพิ่มโมเดลวงจอ, ภาพทะเล/สัตว์บน canvas ของแต่ละจอ, เป้าเล็ง และการหา subject จากพิกเซลจริง พร้อมคงโค้ด cube และ sphere ไว้
- twin/renderer.js:873-904 เพิ่มแถบรอบเส้นศูนย์สูตรบน sphere แบ่งตามจำนวนจอ เน้นช่องตาม yaw และปิดได้ด้วย ?band=0
- twin/twin.js:1818-1841,1902 เพิ่มการสลับ sphere/ring, รองรับ ?shape=cube, เริ่มค่า player เป็น sphere และค่า dev/live เป็น ring พร้อมแปลงค่า localStorage cube เดิมเป็น ring; ไม่แก้ส่วนเสียงหรือส่วนรับ wheel/button ที่ LUNA-17 เพิ่ม
- twin/index.html:126,159-162 ปรับปุ่มรูปทรงและ bump เวอร์ชันสคริปต์เป็น 20261028a
- config/twin.json:43-59 เพิ่มหัวข้อ ring พร้อมค่าเริ่มต้นและ note ภาษาไทยทุกค่า ข้อความไทยใน JSON เก็บเป็น Unicode escape ที่ JSON ถอดกลับเป็นภาษาไทยได้ เพื่อให้อ่านได้ทั้ง UTF-8 และ Python ที่ยังใช้ locale CP874 โดยไม่ระบุ encoding
- tests/test_luna20_ring.cjs:1-42 เพิ่มตรวจ yaw wrap, พิกัดจอ, n=4/6, coverage และตำแหน่งสิ่งมีชีวิต
- docs/hex-ring-geometry.md:1-40 เพิ่มสูตร ผังวงจอ และงานที่เฟิร์มแวร์ใบถัดไปต้องทำ
- output/luna-20/ สร้างโฟลเดอร์เก็บภาพตามใบสั่งงาน แต่ยังว่างเนื่องจากเปิดเบราว์เซอร์ไม่ได้

## ไฟล์ที่ไม่ได้แก้โดยงานนี้

firmware/, laptop/, assets/, config/faces.json, tools/twin_geometry.py, config/scene.json, ระบบเสียง และส่วน wheel/button ของ LUNA-17 ใน twin/twin.js ไม่ได้ถูกแก้โดยงานนี้ โค้ด cube เดิมยังอยู่

มีการเปลี่ยนแปลงอื่นใน working tree ก่อนเริ่มงาน (รวมถึง firmware, laptop, assets และ twin/twin.js) ตามผล git status ก่อนแก้ ผมไม่ได้ย้อนหรือเขียนทับการเปลี่ยนแปลงเหล่านั้น

## ผลตรวจ

- node --check twin/geometry.js — ผ่าน
- node --check twin/renderer.js — ผ่าน
- node --check twin/twin.js — ผ่าน
- python -m json.tool config/twin.json — ผ่าน
- node tests/test_luna20_ring.cjs — ผ่าน: yaw 0/360 กลับตำแหน่งเดิม, พิกัดต่อเนื่องและมีช่วงขอบซ่อน, พิกัดความสูง, พิกัดสิ่งมีชีวิตตรงกับแผนที่เดียวกับ sphere
- coverage เป้าเล็งจากตัวทดสอบ (นับมุม 0.01° รอบ 360°): n=6: 82.25%, n=4: 85.59%
- Select-String ... -Pattern '\?{4}' กับไฟล์ที่แก้ — ไม่พบเครื่องหมายคำถามติดกัน 4 ตัว
- .venv-validation\Scripts\python.exe -m pytest -q -k "not test_only_enabled_faces_are_initialized and not test_vectors_current_and_sprite_circle_ratio" — 140 passed, 2 deselected, 22 subtests passed
- .venv-validation\Scripts\python.exe -m pytest -q — 140 passed, 2 failed, 22 subtests passed: test_luna06_display_reset::test_only_enabled_faces_are_initialized (คาด constructor ST7789 หนึ่งตัว พบสองตัวในไฟล์ firmware ที่มีการแก้ก่อนงานนี้) และ test_twin_vertex_up::test_vectors_current_and_sprite_circle_ratio (fixture vectors เก่ามีตำแหน่ง subject ไม่ตรงกับ config ปัจจุบัน) ไม่มีการแก้หรือผ่อน test เดิม
- Invoke-WebRequest http://127.0.0.1:8770/twin/index.html — HTTP 200 จาก preview server Python ที่เปิดแทน launch config; .claude/launch.json ไม่มีใน workspace
- ตรวจ console และการแสดงผลจริงในเบราว์เซอร์ — ยังตรวจไม่ได้เพราะไม่มี browser surface ให้ CUA
- ภาพหน้าจอ sphere, ring และ ?shape=cube — ยังไม่ได้สร้าง เนื่องจากไม่มีเบราว์เซอร์ ภาพทั้งสามจึงยังไม่อยู่ใน output/luna-20/

## ค่าที่ต้องให้เจ้าของวัด/ยืนยัน

- ขนาดภาพจริงของจอ (ตอนนี้ตั้ง 23.4 มม.)
- ระยะขอบภาพที่มุม (ตอนนี้ตั้ง 6 มม.)
- ลำดับจอรอบวงและ mapping CS (ค่าเริ่ม px,nx,py,ny,pz,nz / CS 8,3,4,5,6,7) — รอเจ้าของยืนยัน

ไม่มีการ commit หรือ push

## รอบแก้ 1 — LUNA-20-FIX-1

แก้ครบ A, B และ C1–C6 ตามใบสั่งรอบแก้ โดยคงโค้ดรับ wheel/button และ bridge ใน `twin/twin.js` ไว้ตามขอบเขต LUNA-17

### รายการแก้และตำแหน่ง

- **A — ค่าเริ่มต้น/การจำรูปร่าง:** `twin/twin.js:1821-1838` เลือก sphere ใน player mode, ยอมรับ `?shape=ring`/`?shape=cube`, และไม่บันทึกรูปร่างลง localStorage; ปุ่มและ B สลับ sphere/ring
- **B — เรติเคิลเริ่มต้น:** `twin/renderer.js:1115-1120,1138-1143` ตั้งกล้องตาม `ring.reticle_azimuth_deg` และหันมายังศูนย์กลาง; `twin/geometry.js:48-61` วางจุดเล็งวงแหวนบน y=0; `twin/renderer.js:883-922,926-956` จัด texture, แถบศูนย์สูตร และเป้า sphere ให้ตรงแนวเดียวกัน
- **C1 — แถบศูนย์สูตร:** `twin/renderer.js:904-929` สร้างแถบโปร่งใสเป็นแผ่นรอบวงในระนาบ XY ที่ z=0 และเลือกแถบด้วย `ringAim(yaw).face`
- **C2 — สิ่งมีชีวิต/พื้นบนวง:** `twin/geometry.js:69-71` เพิ่มตำแหน่งและการอ่าน subject ตามพิกัด ring; `twin/renderer.js:580-715,705-711,963-969,1033-1090,1145-1149` ใช้ map แบบ x=มุม, y=ความสูง ไม่มีการหมุน 45 องศา และส่งตำแหน่งชุดเดียวกันให้ sphere กับ ring
- **C3 — สเกล:** `twin/geometry.js:47-52,69` ใช้รอบวงจริง `2πR = 159.977 มม.` แทน strip เดิม `212.132 มม.`; `twin/renderer.js:883-899,1033-1040,1056-1066` ใช้รอบวงนี้ใน texture/model และปรับระยะแนวตั้งให้เท่ากับส่วนโค้งแนวนอน เอกสารอธิบายเหตุผลและค่าที่วัดได้ใน `docs/hex-ring-geometry.md:3-9`
- **C4 — ทดสอบพิกัดจริง:** `tests/test_luna20_ring.cjs:20-78` เรียก `ringPanel`, `ringAim`, `ringPointAt`, `ringPoses` และ `ringSubjectAt`; ตรวจช่วงขอบจากมุมจริง, seam, พิกัดเป้า/เส้นศูนย์สูตร, ตำแหน่งสัตว์, การหัน sprite, ค่าเริ่มต้น player และ coverage
- **C5 — audio pan:** `twin/twin.js:1082-1089` ใช้ `hit.u` โดยตรงใน ring; ไม่แก้ไฟล์เสียงหรือ cue
- **C6 — ข้อความผู้เล่น:** `twin/index.html:6-7,17,19,108` ปรับ title, metadata, subtitle, hint และแป้นช่วยให้เรียก sphere; `twin/twin.js:71-76,1466` ปรับคำใน hint pill ที่แสดงและข้อความการค้นพบ โดยคงบทพูดไว้

### ผลตรวจรอบแก้

- `node tests/test_luna20_ring.cjs` — ผ่าน 14 checks; reticle coverage: 6 จอ **82.25%**, 4 จอ **85.59%**; ช่องว่างขอบเชิงส่วนโค้งที่คำนวณจากมุมจริงของ 6 จอ **4.728 มม.**
- `.venv-validation/Scripts/python.exe -m pytest -q tests/test_config_agreement.py tests/test_luna17_inputs.py` — **23 passed**
- `node --check twin/renderer.js`, `node --check twin/geometry.js`, `node --check twin/twin.js` — ผ่าน
- ภาพหน้าจอและการตรวจภาพในเบราว์เซอร์ — ทำไม่ได้ในรอบนี้ เพราะไม่มี browser surface ให้ใช้งาน; ยังไม่มีภาพ screenshot แนบ
- ไม่มีการแก้หรือเขียนไฟล์ narration/audio และไม่มีการ commit/push

## รอบแก้ 2 — LUNA-20-FIX-2

แก้ครบข้อ A, B และ C1–C6 ตามใบสั่งรอบแก้ โดยไม่ได้แก้ `VOICE_LINES`/ไฟล์เสียง หรือส่วนรับ wheel/button และ bridge ของ LUNA-17

### รายการแก้และตำแหน่ง

- **A — ช่องที่เห็นกับช่องที่ผ่าน:** `twin/geometry.js:80-85` เพิ่มสูตรร่วมสำหรับระยะช่องและสถานะผ่าน; `twin/twin.js:1529-1539` เลือกความยาววงแหวนใน ring/sphere และคงความยาว strip ใน cube; `twin/renderer.js:478-485` วาดช่องด้วยตำแหน่ง/ขนาดเดียวกัน รวมถึงชดเชย atan ของจอ ring; `tests/test_luna20_ring.cjs:57-73` เรียกฟังก์ชันจริงเทียบภาพเปิดกับ collision ทุก 0.01° ทั้งสามโหมด
- **B — จุดเล็งและกรอบเป้า:** `twin/geometry.js:85` ให้พิกัด marker คงที่ด้านหน้า; `twin/renderer.js:1073,1132,1148` ขยายกรอบเป็น 23 px และวาง marker ตามพิกัดคงที่; `tests/test_luna20_ring.cjs:56-59` ตรวจ yaw 0°, 90° และ 200°
- **C — ถ้อยคำและรายละเอียดภาพ:** `twin/twin.js:1523,1559,1599-1600,1965` เปลี่ยนข้อความ `say()` ที่เหลือจาก “box” เป็น “sphere”; ไม่แตะข้อความ narration ที่บันทึกเสียงไว้; `twin/renderer.js:711-716` และ `twin/geometry.js:71-74` ใช้ projection `atan` เดียวกับพิกัดภาพสำหรับภาพสัตว์; `tests/test_luna20_ring.cjs:43` ตรวจการแปลงพิกัด; `twin/renderer.js:929,1061` ซ่อนฐานเดิมในโหมด ring เพื่อไม่ให้ซ้อนฐานวงแหวน
- **เอกสาร:** `docs/hex-ring-geometry.md:59-63` อธิบายความสูงภาพจริง, atan projection และสูตรช่องผ่าน

### ผลตรวจรอบแก้ 2

- `node tests/test_luna20_ring.cjs` — ผ่าน; 18 checks, ทดสอบ gate 36,000 ค่า yaw ต่อโหมด (cube/ring/sphere); coverage 6 จอ **82.25%**, 4 จอ **85.59%**
- `.venv-validation/Scripts/python.exe -m pytest -q tests/test_config_agreement.py tests/test_luna17_inputs.py` — **23 passed**
- `.venv-validation/Scripts/python.exe -m pytest -q` — **140 passed, 2 failed, 22 subtests passed**; failure คือ `tests/test_luna06_display_reset.py::test_only_enabled_faces_are_initialized` (พบ `Adafruit_ST7789` 2 จุดแทน 1) และ `tests/test_twin_vertex_up.py::test_vectors_current_and_sprite_circle_ratio` (snapshot vectors ไม่ตรงผล build); ทั้งคู่ไม่เกี่ยวกับไฟล์ที่แก้รอบนี้
- `node --check twin/geometry.js`, `node --check twin/renderer.js`, `node --check twin/twin.js` — ผ่าน
- ไม่ commit/push; ไม่แก้ไฟล์เสียง, `VOICE_LINES` หรือส่วนรับ wheel/button ของ LUNA-17

## รอบแก้ 3 — LUNA-20-FIX-3

แก้ภาพพื้นกลับด้านทุกโหมด และคืนพฤติกรรมช่อง/ความกว้างพื้นของ cube ตามค่าเดิม

### รายการแก้และตำแหน่ง

- `twin/geometry.js:81-85` แยก `floorSolidAt` จาก `gateOpeningAt`; ค่าที่ใช้วาดพื้นทึบเป็น 1 และตรงช่องเปิดเป็น 0
- `twin/renderer.js:478-482,507,511,522-523` ให้ `drawFloor` ใช้ `floorSolidAt` อย่างสม่ำเสมอสำหรับความหนาพื้น, ขอบ และของตกแต่ง ไม่วาดพื้นปิดช่อง
- `twin/renderer.js:478-479` คืน `half_mm` เต็มใน cube; ring/sphere คง factor 0.8 ตามรูปแบบที่เพิ่มในรอบก่อน
- `tests/test_luna20_ring.cjs:60-73` เรียกฟังก์ชันจริงที่ renderer ใช้ ตรวจกลางช่องไม่ทึบ, ระยะ 2.5 เท่าครึ่งความกว้างทึบ และทุก yaw ที่ผ่านช่องได้ต้องไม่ทึบ ทั้ง cube/ring/sphere

### ผลตรวจรอบแก้ 3

- `node tests/test_luna20_ring.cjs` — ผ่าน; gate ผ่านการตรวจครบ yaw 36,000 ค่าในแต่ละโหมด
- ทดลองกลับเครื่องหมายใน `floorSolidAt` ชั่วคราวแล้วรันเทสต์ — เทสต์ล้มตามคาดที่ `tests/test_luna20_ring.cjs:68` (“cube floor must be open at the gate center”, ได้ 1 แต่คาด 0); คืนเครื่องหมายที่ถูกต้องแล้วรันทดสอบผ่าน
- `node --check twin/geometry.js`, `node --check twin/renderer.js`, `node --check twin/twin.js` — ผ่าน
- `.venv-validation/Scripts/python.exe -m pytest -q tests/test_config_agreement.py tests/test_luna17_inputs.py` — **23 passed**
- ไม่ commit/push; ไม่แก้ LUNA-17, ไฟล์เสียง หรือ `VOICE_LINES`
