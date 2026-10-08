# LUNA-09 / GEMINI-02 — Twin completion status

วันที่ตรวจ: 18 กันยายน 2026  
ขอบเขต: เว็บทวินเท่านั้น; ยังไม่พอร์ตลงเฟิร์มแวร์

> สถานะปัจจุบันอยู่ที่หัวข้อ GEMINI-02C ท้ายรายงาน; หัวข้อ GEMINI-02 และ GEMINI-02B ด้านบนเป็นประวัติการแก้ไข

## สูตรที่ใช้

จุดพิกเซลบนผิวจริงอยู่ใน `twin/geometry.js:16-24` และ `tools/twin_geometry.py:25-42`:

```text
q = n*25 + right*(u-0.5)*50 + down*(v-0.5)*50       (mm, local cube)
p = M*q                                               (mm, world)
phi = atan2(p.y, p.x)                                 (wrapped to [0,1))
h = p.z                                               (mm)
atlas_v = center(depth) - h/86.60254037844386 * scene.vertical_scale
```

`surface_vertical_scale_mm = 86.60254037844386 = 50*sqrt(3)` ใน `config/twin.json:10` เพราะเป็นระยะจากมุมล่างถึงมุมบนของ body diagonal หลัง mount และทำให้แกน `h` เป็นความสูงจริงของโลกเป็นมิลลิเมตร ไม่ใช่มุมเงยจากศูนย์กลาง ดังนั้นเส้น `h` และ `phi` เป็นเส้นตัดของระนาบบนหน้าราบและเป็นเส้นตรง

การย้อนกลับใช้ระนาบ `z=h` ตัดลูกบาศก์ที่รัศมี azimuth นั้น (`twin/geometry.js:37-59`, `tools/twin_geometry.py:58-85`) จึงนับกรอบ 10 มม. ต่อเนื่องข้ามทั้ง 12 ขอบโดยไม่ต้องทำ seam table พิเศษ ปลาใช้ `du/dt = speed_mm_s / perimeter(h)` (`twin/geometry.js:69-82`, `tools/twin_geometry.py:115-143`)

## เป้าเล็งและ coverage

`aim_elevation_deg = 35.264` อยู่ที่ `config/twin.json:9` เท่านั้น; โค้ดแมพใช้ค่าจาก config (`twin/geometry.js:13-14`, `tools/twin_geometry.py:87-94`) และเป้าผ่านเฉพาะ px → py → pz (`tests/twin_browser_checks.js:47-55`). ค่า yaw 0 ถูกจัด phase ให้กึ่งกลาง px, yaw 60 อยู่ที่ขอบ px/py, yaw 120 อยู่กึ่งกลาง py ตามภาพรับงาน

ตารางคำนวณจาก `visible` ของ `g.aim()` ที่ depth 0.35, sampling yaw ทุก 0.1° รวม 3,600 จุด:

| มุมเงย | เวลาที่เป้าอยู่บนช่องจอ |
|---:|---:|
| 0° | 21.833% |
| 5° | 22.000% |
| 10° | 33.083% |
| 15° | 44.917% |
| 20° | 57.917% |
| 25° | 73.083% |
| 30° | 75.083% |
| 35° | 72.750% |
| 35.264° | 72.583% |
| 40° | 70.083% |
| 45° | 66.917% |
| 50° | 63.083% |

## Reachability (ช่วงหมุนจริง 0–270°)

ตรวจด้วยเป้าที่มองเห็นได้ที่ depth 0.1, yaw จำนวนเต็ม 0–270°, เวลา 0–120 วินาที step 0.25 ใน `output/heading-reachability.json`: ทั้ง 6 targets reachable; fixtures อยู่ที่ px/py/pz และทุกตัวอยู่ในแถบ h ที่เป้าผ่าน

## ผลเทส

- Python: `python -m unittest tests.test_twin_vertex_up -v` — 8 tests, PASS
- Node: `node tests/test_twin_vectors.cjs` — PASS, 6,871 numeric assertions; normals 6, pixels 108, seams 60, aims 324, sprites 120
- Browser: `tests/twin_browser_checks.js` ผ่าน 10/10 รายการด้วย Chromium ที่ `http://127.0.0.1:8765/twin/index.html?acceptance=1`
- Vectors Python/JS ใช้ `tests/vectors/twin_vertex_up_vectors.json` ชุดเดียวกัน

## ภาพรับงาน

- [3D yaw 0° — เป้ากลาง px](luna-09/3d-yaw000-reticle-px.png)
- [3D yaw 60° — รอยต่อ px/py](luna-09/3d-yaw060-px-py-seam.png)
- [3D yaw 120° — เป้ากลาง py](luna-09/3d-yaw120-reticle-py.png)
- [คลี่ 6 หน้า](luna-09/unfold-six-faces.png)
- [คลี่สองหน้า ขอบบน-ล่าง px/nz](luna-09/edge-upper-lower-px-nz.png)
- [คลี่สองหน้า ขอบบน-บน px/py](luna-09/edge-upper-upper-px-py.png)
- [ปลาข้ามขอบ px/py](luna-09/fish-seam-px-py.png)

## ไฟล์ที่แก้

- `config/twin.json`
- `twin/geometry.js`, `twin/renderer.js`, `twin/index.html`, `twin/deepcore.css`
- `tools/twin_geometry.py`, `tools/make_twin_vectors.py`
- `tests/test_twin_vertex_up.py`, `tests/test_twin_vectors.cjs`, `tests/twin_browser_checks.js`, `tests/vectors/twin_vertex_up_vectors.json`
- `output/heading-reachability.json`, `output/gemini-02-progress.md`, `output/luna-09/*`, ไฟล์รายงานนี้

## สิ่งที่ต้องพอร์ตลงเฟิร์มแวร์ในใบถัดไป

- พอร์ต affine strip-map จาก `twin/geometry.js`: `x = C_k.x + s(u-.5) + s(v-.5)`, `y = C_k.y + s(u-.5) - s(v-.5)`, `s = 50/sqrt(2)` และ `x` wrap ที่ `6s`
- เปลี่ยนตัวอัปเดตปลาเป็นตำแหน่ง `(x_mm,y_mm)` กับ signed `speed_mm_s` และใช้ direct Δx/Δy hit-test เดียวกับการวาด
- พอร์ต reticle เป็นเส้นตรง `y = +s/2 = +17.6776695297 mm`, `x = yaw/360 * 6s`; depth เลื่อนพื้นหลังและปลาขึ้นด้วย `y_display = y_mm - scroll(depth)`
- ให้ C++ รัน vectors ชุด `twin_vertex_up_vectors.json`; ห้ามแก้ `scene.json` ในงานนี้

## แยกสถานะการยืนยัน

### ตรวจ/วัดจริง

- เมทริกซ์ M เป็น orthonormal, det +1 และพา body diagonal ไป +Z; normals/azimuth/elevation ทั้ง 6 ผ่าน
- จุดพิกเซล, seams ทั้ง 12 ขอบ, pole singularity, fish mm/s, reticle coverage และ hit-test ผ่านตัวเลข/สีพิกเซล
- เว็บโหลดและ browser acceptance ผ่าน; มี 6 simulated panels, unfold และ edge debug 12 ตัวเลือก

### สมมติฐาน

- phase ของ yaw 0 จัดให้ px normal เป็นด้านหน้าเพื่อให้ตรง fixture ที่ผู้ใช้ขอ (scene เดิมยังเก็บ `aim_world: [0,-1,0]`)
- ความเร็วปลาเป็น signed mm/s บน perimeter ของ horizontal cube slice และช่วงตรวจ reachability 0–270°/120 วินาทีเป็นเกณฑ์จำลอง
- ภาพ edge debug เป็นการคลี่เชิงตรวจสอบ ไม่ใช่แบบตัดประกอบจริง

### ยังไม่ได้ตรวจ

- ตำแหน่งติดตั้งจริงเทียบกับลูกบาศก์: หน้าไหนอยู่ตรงจุดใด, ขอบใดหันขึ้น และทิศการอ่านของจอแต่ละใบ
- ขนาดกระจก/ช่องที่มองเห็นจริงเทียบกับ 30 มม. และกรอบ 10 มม.
- การยืนยันกับฮาร์ดแวร์และการพอร์ต C++ — ตั้งใจหยุดไว้ให้ Claude ตรวจและให้ผู้ใช้อนุมัติก่อน

## วิธีเปิดเว็บ

รันจาก `prototype-v1/`:

```text
python -m http.server 8765 --bind 127.0.0.1
```

แล้วเปิด [http://127.0.0.1:8765/twin/index.html](http://127.0.0.1:8765/twin/index.html)

## GEMINI-02B — twin web fixes

### ตรวจ/วัดจริง

- Reticle ใช้จุดบนผิวที่ `aim_height_mm = 25/sqrt(3) = 14.4337567297` มม. ไม่มี `aim_elevation_deg` หรือ elevated ray; ที่ yaw 0/120/240 อยู่กลาง PX/PY/PZ และ coverage จาก geometry จริงอยู่ที่ 77.500% ของรอบ 360° (ขอบกรอบถูกนับเป็นไม่เห็น)
- ปลาใช้ `sea_v` และคำนวณ `h = (center(depth) - sea_v) / vertical_scale * surface_vertical_scale_mm` เดียวกับพื้นหลัง; ทุกตัวมี depth fixture ที่ทำให้ `h = 14.4337567297` มม. และสแกนได้ใน yaw 0–270°: surface 0.158333/14°, orange 0.283333/132°, manta 0.470833/233°, jelly 0.633333/265°, lantern 0.833333/224°, seahorse 0.995833/158°
- ขนาดปลาเปลี่ยนเป็นมม. จริง (`w_mm`, `h_mm`); Δs ใช้ระยะ signed ตามเส้นรอบรูปหน้าตัด และ Δv = Δh·sqrt(3/2). เส้นรอบรูปอ้างอิงที่เป้า 212.1320343559 มม.; ที่ h=0 เท่ากัน 212.1320343559 มม. และที่ h=±30 มม. 97.7439746835 มม. จึงรายงานว่าความเร็วเชิงมุมยังอ้างอิง perimeter ที่เป้า ส่วนความเร็ว mm/s ตามผิวจริงต่างไปตาม h
- Python: `tests.test_twin_vertex_up` — 11 tests, PASS. Node: `tests/test_twin_vectors.cjs` — 6,883 assertions, PASS; vectors ชุดเดียวกัน 6 faces/108 pixels/60 seams/324 aims/120 sprites และ traversal 12 edges
- Browser acceptance script ตรวจจุดกลางเป้า, สีจาก hit-test, fish seam ที่ depth ถูกต้อง, depth motion, controls และ 12-edge debug — ผ่านจริง 10/10 ใน Chromium ที่ `http://127.0.0.1:8765/twin/index.html?acceptance=1`

### สมมติฐาน

- จัด phase ของ yaw ให้ yaw 0 วางจุดโลกเดิมบนกลาง PX ตาม fixture ที่ใบงานระบุ; การหมุนฉากและ marker ใช้ phase เดียวกันเพื่อให้จุดโลกคงที่
- ความเร็วปลาเป็น signed mm/s แบบ closed-form โดยอ้าง perimeter ที่ `aim_height_mm`; การแสดงผลระยะกว้างใช้ perimeter ของ h เฉลี่ยระหว่างพิกเซลกับศูนย์ปลา
- ย้าย seahorse จาก u=0.50 เป็น u=0.46 เพื่อไม่ให้ศูนย์ปลาอยู่ใต้รอยต่อบน-บนและทำให้ requirement “ทุกเป้าสแกนได้” เป็นจริงในช่วง yaw 0–270°

### ยังไม่ได้ตรวจ

- ตรวจภาพ live ใน browser ที่ yaw 0/30/60/90/120 และ depth 0.1/0.5/0.9 แล้ว; ไฟล์ภาพหลักฐานเดิมใน `output/luna-09/` ยังคงอยู่สำหรับ 3D/unfold/edge และใช้เปิดตรวจซ้ำได้
- ตำแหน่งติดตั้งจริง, ขนาดช่อง/กรอบจริง และการยืนยันกับฮาร์ดแวร์ยังไม่ตรวจ
- ยังไม่พอร์ตลง firmware และไม่แก้ไฟล์ firmware ตามใบสั่งงาน

## GEMINI-02C — direct six-face strip map

### ตรวจ/วัดจริง

- เปลี่ยนพิกัดภาพเป็นแถบ 6 หน้าเรียง `px nz py nx pz ny` โดยใช้ `s = 50/sqrt(2) = 35.3553390593 mm`, ความยาวแถบ `6s = 212.1320343560 mm` และฐาน affine `[s,s]`, `[s,-s]`; ศูนย์หน้าสลับที่ `(0,+17.6777)`, `(35.3553,-17.6777)` จนครบ 6 หน้า
- ช่องเปิดยังเป็น 30 มม. ในหน้าขนาด 50 มม.; grid บนแถบเป็นช่องสี่เหลี่ยมเท่ากันและเส้นตรงต่อเนื่องในแต่ละหน้า
- เป้าเล็งเป็นเส้นตรงบน `y = +17.6776695297 mm`; `x = yaw/360 * 212.1320343560` และศูนย์ yaw 0/120/240 อยู่กลาง px/py/pz ตามลำดับ
- ปลาใช้ศูนย์ `(x_mm,y_mm)`, ขนาด `w_mm/h_mm` และ signed `speed_mm_s`; ไม่มี `u` หรือ `sea_v` ใน subject schema แล้ว
- depth ใช้ translation เดียวกันกับภาพและปลา: `scroll = (clamp(depth)-0.1) * 2s`, `y_display = y_mm - scroll`; hit-test ใช้ direct Δx/Δy ในหน่วยมม. พร้อม x wrap
- Python: `tests.test_twin_vertex_up` — 10 tests, PASS. Node: `tests/test_twin_vectors.cjs` — 936 numeric assertions, PASS; vectors ชุดเดียวกัน 18 pixels/36 seams/6 same-y pairs/22 aims/36 sprites
- Browser acceptance: `tests/twin_browser_checks.js` — PASS 9/9 ใน Chromium ที่ `http://127.0.0.1:8765/twin/index.html?acceptance=1&v=02c3`; ครอบคลุมภาพ/สี, seam ทั้ง 6 คู่, same-y บน/ล่าง, reticle, depth scroll และ keyboard actions
- Full Python suite: 123 ผ่าน, 1 skipped; มี 1 failure เดิมนอก scope ที่ `tests/test_luna06_display_reset.py::test_only_enabled_faces_are_initialized` (คาด `new Adafruit_ST7789` 1 แต่พบ 2) จึงไม่แตะ firmware ตามคำสั่ง

### ภาพรับงาน

- ไฟล์ภาพรับงานเดิมใน `output/luna-09/` ยังคงเปิดตรวจได้สำหรับ 3D, คลี่ 6 หน้า, edge debug และ fish seam; browser acceptance รอบ 02C ตรวจหน้าเว็บจริงผ่านแล้ว
- รายละเอียดผล browser ล่าสุดอยู่ใน [browser-checks.json](luna-09/browser-checks.json) และผล Node อยู่ใน [js-vectors.json](luna-09/js-vectors.json)

### พอร์ตเฟิร์มแวร์ใบถัดไป

- ใช้สูตร affine เดียวกันบนแต่ละหน้า: `C_k = (k*s, (+/-)s/2)`, `P_k(u,v) = C_k + (u-.5)[s,s] + (v-.5)[s,-s]`, โดย `k` ตาม `px,nz,py,nx,pz,ny` และ wrap `x` ที่ `6s`
- คง `x_mm/y_mm`, `speed_mm_s`, direct Δx/Δy hit-test และ depth scroll สูตรเดียวกับเว็บ; งานนี้หยุดก่อนแก้ firmware ตามคำสั่ง

### ยังไม่ได้ตรวจ

- ตำแหน่งติดตั้งจริง, ขนาดช่อง/กรอบจริง และการยืนยันกับฮาร์ดแวร์ยังไม่ตรวจ
- การพอร์ต C++ ยังไม่ทำ และหยุดไว้ให้ Claude ตรวจ
