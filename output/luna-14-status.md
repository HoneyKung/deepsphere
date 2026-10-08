# LUNA-14 — เลขความลึกกับภาพในเว็บทวิน

วันที่: 2 ต.ค. 2026  
สถานะ: แก้ Twin และเทสแล้ว; ไม่แตะเฟิร์มแวร์

## สรุปการแก้

- สำรอง `twin/` ก่อนแก้ไว้ที่ `twin_backup_20261002_luna14_prechange/`.
- เพิ่ม `depth_darkening` ใน `config/twin.json` ให้เฉดสีใช้ `state.depth` โดยตรง: ผิวน้ำ `[28,154,194]`, 760 ม. `[20,100,150]`, 1,976 ม. `[8,55,105]`, และ 3,040 ม. `[4,30,78]`.
- เพิ่ม `TwinOcean` เพื่อคำนวณสีพื้นหลังพร้อมเก็บแสงผิวน้ำ, Snell window, texture และ grid แบบลดความเข้มตามความลึก.
- แยก `backgroundScrollMm` ออกจาก `stripScrollMm`: แถบผิวน้ำเลื่อนพ้นจอภายใน 304 ม.; สูตร `stripScrollMm` สำหรับตำแหน่งสัตว์คงเดิม.
- `config/twin.json` คง subject ทั้งหกและค่า `x_mm`/`y_mm` เดิม. `config/scene.json`, `firmware/`, และ vectors เดิมไม่เปลี่ยน.

## RGB เฉลี่ยจอบน px + py + pz

แถว “ก่อน” มาจากตารางวัดเดิมในใบงาน. “หลัง” คำนวณจากพิกเซลพื้นหลัง 240×240 ของจอบนทั้งสามใบ โดยยังไม่รวมพิกเซลสัตว์และ reticle. ทุกช่องสีลดลงทุกก้าว.

| ความลึก | เมตร | v ก่อน | RGB ก่อน | RGB หลัง |
|---:|---:|---:|---:|---:|
| 0.00 | 0 | 0.450 | 24, 108, 148 | 30.91, 164.33, 206.59 |
| 0.10 | 304 | 0.417 | 26, 112, 150 | 25.26, 135.06, 179.80 |
| 0.25 | 760 | 0.367 | 27, 118, 156 | 20.26, 101.46, 152.08 |
| 0.50 | 1,520 | 0.283 | 26, 127, 166 | 12.55, 72.26, 122.44 |
| 0.65 | 1,976 | — | — | 7.99, 54.99, 104.90 |
| 0.75 | 2,280 | 0.200 | 28, 137, 175 | 6.82, 47.67, 96.84 |
| 1.00 | 3,040 | 0.117 | 78, 171, 204 | 3.94, 29.61, 76.92 |

สีฐานที่ 0 ม. ตรงกับ `[28,154,194]`; ค่าเฉลี่ยจริงสูงขึ้นเล็กน้อยจากแสงผิวน้ำและ vertical gradient. ที่ 760, 1,976 และ 3,040 ม. ได้ตามช่วงเป้าหมายในใบงาน. ค่า RGB ทุกระดับบันทึกไว้ที่ `output/luna-14/depth-rgb.json`.

## สัตว์ทั้งหก

`config/twin.json` กำหนดตำแหน่งสัตว์เป็น `x_mm`/`y_mm` และไม่มี `depth_norm` รายตัว. พิกัดและ mask คงเดิม; browser check วัด center hit-test ของทั้งหกที่ระดับ 0, 0.1, 0.25, 0.5, 0.65, 0.75 และ 1 แล้วพบ ID เดิมทุกครั้ง. เทส scan/collect เดิมยังพบ Surface Shoal Fish.

| ID | ชื่อ | x_mm | y_mm | band จาก targets.json |
|---|---|---:|---:|---|
| `luna04_surface_fish_seam` | Surface Shoal Fish | 21.213 | 22.627 | surface |
| `luna04_orange_reef_fish` | Orange Reef Fish | 84.853 | 15.556 | surface |
| `luna04_manta_ray` | Manta Ray | 148.492 | 4.950 | middle |
| `luna04_jellyfish` | Bloom Jellyfish | 159.099 | -4.243 | middle |
| `luna04_lantern_fish` | Lantern Fish | 140.007 | -15.556 | deep |
| `luna04_seahorse_shape` | Seahorse | 97.581 | -24.749 | deep |

## การตรวจ

- `node tests/test_twin_vectors.cjs`: PASS; vectors เดิม 36 sprite records, 36 seams และ 22 aim samples ผ่าน พร้อมเทส monotonic RGB และแถบผิวน้ำ.
- `pytest tests/test_twin_vertex_up.py -q`: 13 passed.
- Browser acceptance: 13/13 PASS รวมตรวจ monotonic brightness และการคงตำแหน่งสัตว์ทั้งหก.
- Full `pytest -q`: 134 passed, 1 failed, 1 warning, 22 subtests passed. Failure เดิมที่อยู่นอกขอบเขตงาน: `tests/test_luna06_display_reset.py::Luna06DisplayResetTests::test_only_enabled_faces_are_initialized` คาด `new Adafruit_ST7789` หนึ่งจุดแต่พบสองจุด. ไม่มีการแก้ firmware ในงานนี้.
- HUD ไม่ได้แก้; สถานะ LUNA-13 ระบุว่าตรวจ 1366×768 และ 1920×1080 แล้ว. ขนาด 1053×680 ไม่ได้ตรวจซ้ำในงานนี้.

## ต้องพอร์ตลงเฟิร์มแวร์

เฟิร์มแวร์ยังใช้สูตร ocean/background เดิม; การแก้ครั้งนี้อยู่ใน renderer ของเว็บทวินและ `config/twin.json` เท่านั้น. งานพอร์ตแยกต้องนำ color stops, depth-driven darkening, และการเลื่อนแถบผิวน้ำไปใช้ใน renderer ของเฟิร์มแวร์ โดยคงพิกัดสัตว์/strip map ที่ผ่าน vectors เดิม. จอจริงจะยังแสดงแบบเดิมจนกว่าจะมีงานพอร์ตนี้.

## ภาพหลักฐาน

ตามคำสั่งล่าสุดไม่ได้สร้างภาพ. `output/luna-14/` จึงมี `depth-rgb.json` แต่ไม่มีภาพ PNG ทั้งห้าระดับ.

## สิ่งที่ต้องให้ผู้ใช้ตัดสินใจ

ไม่มีค่าความมืดที่ค้างให้เลือก: ค่าที่ 760, 1,976 และ 3,040 ม. อยู่ใกล้เป้าหมายตามใบงาน และค่าเฉลี่ยมืดลงต่อเนื่องทุกระดับ.
