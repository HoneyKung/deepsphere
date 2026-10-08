# Luna 03 — six-face mapping status

บันทึก: 10 กันยายน 2026

## ยืนยันจากผู้ใช้

- ลูกบาศก์มี 6 หน้าเดิม แต่ละหน้า 50×50 มม.
- ช่องภาพ active image อยู่กลางหน้า 30×30 มม. มีกรอบด้านละ 10 มม.; normalized rectangle ของทุกหน้าคือ `{left: 0.2, top: 0.2, right: 0.8, bottom: 0.8}`
- โมดูล diagnostic รายงานว่า `UP` ชี้ไปทางซ้าย ตรงข้ามขอบ connector; นี่เป็นข้อเท็จจริงในกรอบโมดูล ไม่ใช่การยืนยัน world orientation ของแต่ละหน้า
- จอหนึ่งใบเสียและไม่มีจอสำรอง; diagnostic ที่ใช้งานอยู่จึงเปิดเฉพาะ face `px` / index 0 / CS8

## สิ่งที่ทำ

- ซิงก์ `config/faces.json`, `config/board.json` และ `firmware/include/deep_sphere_config.h` เป็น six-face basis เดิมกับ pin map ใหม่: SCK12, MOSI11, RST10, DC9, CS `{8,13,14,15,16,17}`
- แยก geometric faces จาก `kDisplayEnabled[]`; face ที่ยังไม่มี output จะไม่แสดง reticle และไม่ผ่าน hit test แม้ ray จะตัดกับผิว geometry นั้น
- คง `kHardwarePinsConfirmed=true`, `kSingleDisplayTest=true`, `kSingleDisplayIndex=0` ตาม working single-panel diagnostic; `kPhysicalControlsEnabled=false` และ full-assembly wiring ใน `board.json` ยังไม่ถูกยืนยัน
- เพิ่ม `enabled_faces` ใน shared Python projection และ simulator เพื่อให้ preview/laptop/firmware semantics ตรงกัน
- ปรับ net ให้มีกรอบ 10 มม. รอบ opening 30 มม. และหา quarter-turn จาก shared 3D edge endpoints จริง พร้อม regression check เรื่อง foldability
- ปรับ assembled-cube ให้ warp texture เต็ม 240×240 ลง opening quadrilateral แยกจาก frame และวาด grid เป็น overlay; เพิ่ม corner-upright concept fixture ที่ fit viewport และ cull/depth จาก mounted normals
- ปรับ module calibration เป็น template ของ diagnostic unit เดียว พร้อม holder constraint, pin order และช่อง `FINAL MOUNT: UNKNOWN`
- เพิ่ม net, assembled-cube และ module calibration previews จาก face basis/physical dimensions เดิม ไม่สร้าง arbitrary quad และไม่ใช้ camera tracking

หลักฐาน preview (LUNA-04 เปลี่ยนชื่อไฟล์ให้มี suffix ตามระดับความลึก ลิงก์ด้านล่างชี้ไปชุด `-mid` ซึ่งเป็นไฟล์เดียวกับที่ LUNA-03 สร้างไว้ ต่างกันแค่ชื่อ):

- [six-face net](preview-six-face-net-mid.png)
- [assembled cube](preview-six-face-assembled-mid.png)
- [corner-upright concept fixture](preview-six-face-corner-upright-mid.png)
- [module calibration reference](preview-six-face-calibration-mid.png)
- [preview metadata](preview-six-face-metadata-mid.json)

## ผลตรวจ

- Python suite: `63 passed` หลังเพิ่ม dimensions, CS agreement, absent-output, net-foldability, opening-ratio, texture-corner และ mount-fixture checks
- Native shared math vectors: `1385 checks, 0 failures`
- PlatformIO firmware build และ LittleFS build: ผ่านหลังใช้ six-face pin map ใหม่
- Preview generator: สร้างภาพจริงจาก atlas/face basis และบันทึก face edge 50 มม., opening 30 มม., frame 10 มม.
- หมายเหตุ: firmware บนบอร์ดยังอยู่ใน single-display diagnostic/pattern path; sea art ปัจจุบันเป็น test atlas ไม่ใช่ final sea art

## ยังไม่ยืนยัน

- ตำแหน่ง physical unit ที่เสียและการจับคู่ unit กับแต่ละ face
- global cube mount quaternion, world-up, per-face LCD rotation/inversion และ connector orientation ของแต่ละ unit
- wiring/ไฟ/BL ของอีกห้าจอ, load ของ MP1584 และความปลอดภัยของจอที่เสีย
- การเปิด full six-output mode หรือการแฟลชหลายจออัตโนมัติ

`dimensions_confirmed` ไม่เท่ากับ `mount_confirmed` หรือ `wiring_confirmed`; diagnostic working state จึงยังต้องคงแยกสถานะเหล่านี้ต่อไปครับ
