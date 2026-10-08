# แผงควบคุมเรือดำน้ำ

`app.py` คือแผงควบคุม (Tkinter) `core.py` คือส่วนที่ไม่ใช่ UI: การกันข้อความซ้ำ คลังตัวอย่าง เสียง serial worker และ `BoardSimulator`

```text
python laptop\app.py --simulate --no-audio
```

`--simulate` ใช้ `BoardSimulator` ที่คำนวณด้วย `tools/atlas_math.py` ตัวเดียวกับที่ตรวจเฟิร์มแวร์ จึงลองครบวงได้โดยไม่ต่อบอร์ด ป้าย `SIMULATED / NO BOARD` และ `SIMULATOR READY` ติดอยู่บนหน้าต่างเสมอ อย่าใช้เป็นหลักฐานว่าฮาร์ดแวร์ผ่าน

ลำดับใช้งาน: เปิดแผงและเลือก COM → ใช้ `Up/Down` ปรับ depth ใน keyboard-first demo → Scan ดูผล → Collect เก็บภาพ → เลือกตัวอย่างแล้วกด Analyze ดูรายละเอียด การกด Scan ก่อน Collect เป็นวิธีใช้งานแนะนำ ไม่ใช่เงื่อนไขบังคับของระบบ

ภาพตัวอย่างมาจาก crop บน asset pack ชุดเดียวกับบอร์ด ตรวจ pack id ก่อนบันทึก และเก็บเป็น snapshot ที่ไม่เปลี่ยนตามการเล่นภายหลัง เก็บไว้ที่ `output/samples/` เปิดแผงใหม่แล้วโหลดกลับได้ ไม่ได้ส่ง live video มาจากลูกบาศก์

เสียง: ambience ใช้สองแชนเนลสลับกันเพื่อ crossfade ตอนเปลี่ยนโซน ไม่ restart จาก state ซ้ำ one-shot อยู่คนละแชนเนล ไฟล์เสียงที่หายจะถูก log และข้าม ไม่ทำให้แผงล้ม

พอร์ตเดียวเปิดได้โปรแกรมเดียว ปิดแผงก่อนแฟลชหรือเปิด serial monitor

แผงรอบล่าสุดใช้ top bar, depth instrument, selected sample เป็นจุดเด่น, analysis panel และ thumbnail collection ด้านล่าง รอบ prototype นี้ใช้ keyboard-first controls: `1` Scan, `2` Collect, `3` Analyze, `Up/Down` ปรับ depth ครั้งละ 0.02 พร้อมปุ่มคลิกที่แสดง label เดียวกัน เมื่อ focus อยู่ในช่องตั้งค่า keyboard จะไม่ยิง action ซ่อนอยู่ โหมด hardware จะส่ง command/depth delta ผ่าน USB และรอ state/event จากบอร์ด ส่วน simulator ใช้ protocol เดียวกัน ป้ายโหมดและ connection ยังเห็นด้านบนเสมอ `after` ใช้ depth interpolation, key-repeat และ feedback motion สั้น ๆ และถูกยกเลิกเมื่อปิดหน้าต่าง
