# Configuration contract

Implementation files now live in this directory. Do not treat this page as a wiring diagram; `wiring-table.md` is the one to read before soldering, and it is a proposal, not permission to connect hardware. The current firmware deliberately keeps hardware output disabled until the user confirms the physical map.

ต้องแยกค่าต่อไปนี้ออกจาก renderer:

- Board: ชื่อรุ่น Flash/PSRAM ที่คาดหวัง GPIO จริง SPI clock USB mode และ input source hardware/simulated
- Displays: logical face id, CS, rotation, inversion, offsets, normal/u/v axes และ active-image bounds บนหน้าลูกบาศก์
- Geometry: ท่าตั้งบนมุม Q, ทิศผู้เล่น, zero offset และเครื่องหมายการอ่าน yaw
- Scene: atlas size, pixel format/byte order, vertical viewport, targets metadata และขอบเขตความลึก
- Controls: `yaw.source` หน้าที่สามปุ่ม หน้าที่ล้อและสวิตช์ของล้อ ขั้นการหมุน debounce/cooldown และการตั้งศูนย์
- Audio: protocol version, zone thresholds และ hysteresis

การแมพหน้าจอ/ขาไม่ควรผูกกับลำดับสร้าง object ใน code เท่านั้น ต้องมีตารางที่ผู้ประกอบอ่านได้

`config/*.json` เป็นเอกสารสำหรับคนอ่านและสำหรับเครื่องมือฝั่ง Python เฟิร์มแวร์อ่านค่าจาก `firmware/include/deep_sphere_config.h` เพราะเป็นค่า compile-time สองไฟล์นี้ต้องแก้คู่กันเสมอ โดยเฉพาะ `yaw.source` กับ `kYawSource` `tests/vectors/cube_math_vectors.json` เป็นตัวจับว่าค่า scene/faces ทั้งสองฝั่งยังตรงกันอยู่ รันซ้ำด้วย `tools/make_vectors.py` ทุกครั้งที่แก้
