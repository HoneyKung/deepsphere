A.1 แก้การรอเสียง `dive_start` แล้วหน่วง 0.75 วินาทีก่อนเล่นเสียงต้อนรับ
ตรวจในเบราว์เซอร์: แผง `?audio=debug` แสดง `vo_welcome · FILE · voice/vo_welcome_en.wav`
A.2 เพิ่ม Voice 0–100% ทั้ง HUD/ดีบัก; sync และ localStorage ผ่านทดสอบ 60% หลังรีโหลด แล้วคืนเป็น 100%
เลือก `BUS_DEFAULTS.voice=1.0`: เพิ่มจาก 0.9 เพียง 0.9 dB; RMS พากย์ราว −21 dBFS และ duck เพลงเหลือ 0.58
A.3 `vo_analyze` ตามด้วยคลิปชื่อสัตว์ครบหกตัวตามลำดับถาดและเว้น 150 ms ภายใต้การ duck เพลงครั้งเดียว; browser acceptance ผ่าน 14/14
แก้ acceptance check ให้รอ preload/start เสร็จ และให้ expected order ตรงกับถาดจริง: shoal, reef, manta, jelly, lantern, seahorse
A.4 ตั้ง English เป็นค่าเริ่มต้น; Thai ถูกปิดเมื่อไม่มีไฟล์ และมีข้อความบอกเหตุผล
ตรวจ debug selector: English เลือกอยู่, Thai disabled; caption แสดงสองภาษา
B. ปรับ twin เป็น Sound Map ตามสี/ฟอนต์ที่ระบุ; คง geometry, renderer, artwork และ `config/scene.json` ไว้
ตรวจภาพที่ 1366×768 และ 1920×1080; deep zone ใช้ส้ม `#FF9F43`, HUD text อย่างน้อย 12 px, contrast บน hull 8.25:1–10.08:1 และคีย์ช่วยไม่ชน depth labels ที่ 1366
จับภาพ baseline จาก backup และภาพ after/caption/deep-orange ใน CUA preview; ไม่มี API บันทึก screenshot preview เป็นไฟล์ใน `output/luna-13/`
C. bridge เลือก USB VID:PID 303A:1001 อัตโนมัติ, reconnect ทุก ~1 s, ส่งเหตุผล, เก็บ rotating JSONL log และรองรับ `--simulate`
serial mocks ผ่าน 8 tests; simulate `/yaw` คืน yaw ถูกต้องและหน้าแสดง `SIMULATED — NO BOARD`; ไม่เปิดพอร์ตจริงหรือแฟลชบอร์ด
Full pytest: 133 passed, 1 firmware-scope assertion failed; ดูรายละเอียดใน `output/luna-13-status.md`


