### 1. เสียงพื้นฐานและเพลงโซน
- เพิ่ม Web Audio จาก manifest, 6 บัส, ambient/roomtone/creak และโหลดเพลง invite/shallow/mid/deep แบบแสดง n/N ใน `twin/twin.js`; เพิ่มแผงตรวจเสียงใน `twin/index.html` และ `twin/deepcore.css`.
- `node --check` ผ่านทั้ง twin.js/renderer.js และตรวจ manifest แล้วไม่พบไฟล์อ้างอิงขาด; ยังเปิด preview ผ่าน in-app browser ไม่ได้เพราะ localhost ถูกบล็อก. ขั้นต่อไป: ผูก cue กับการหมุน/ความลึก/สแกน.
### 2. เหตุการณ์ทวิน
- ผูก turn_periscope ทุก 5° ผ่านคีย์/ลาก/AS5600, โซนพร้อม hysteresis, dive_start, descend/ascend, scan sweep→ผลหลังเสียง sweep และปุ่ม 1/2/3 ใน `twin/twin.js`/`twin/renderer.js`.
- เพิ่มเตือนผิวน้ำ/ความลึกและ sonar หลังสแกนเท่านั้น; ขั้นต่อไป: วลีสัตว์ พากย์ และ duck/priority.

### 3. สัตว์และพากย์
- ผูก one-shot glimpse/known/memory ตาม reticle, แพนและเว้นวลีเดิม 6 วินาที; เพิ่ม narration ไทย/อังกฤษ, duck, M mute และลำดับ mission/discovery/collect.
- เพิ่ม voice file map ว่างใน manifest เพื่อใช้ไฟล์พากย์เมื่อมี; ขั้นต่อไป: เพลงทางเชื่อม discovery/home, ตรวจเสียง, แหล่งที่มา.

### 4. เพลงและแผงตรวจ
- เพิ่ม bridge เปลี่ยนโซน/discovery, เพลง home/invite และชั้น lead/sparkle; เปิดแผงตรวจด้วย `?audio=debug` หรือ D และเพิ่ม `assets/audio/catalog.json`/`ATTRIBUTION.md`.
- เพิ่ม `assets/audio/validate_catalog.mjs`; ขั้นต่อไป: ตรวจ static รอบสุดท้ายและเขียน status สำหรับ peer review.
- ตรวจพรีวิวจริงที่ `http://127.0.0.1:8087/twin/?audio=debug`: โหลดไฟล์หลัก 57/57; ลองสแกน/หมุน/เปลี่ยนโซน/ความลึกสูงสุด/กลับผิวน้ำและเพลง home→invite, M/H/1/2/3, whale/creak/reef glimpse; console ไม่มี error/warning.
- ขั้นต่อไป: สรุปตารางครบ 77 cue และผลตรวจใน `output/luna-12-status.md`; เบราว์เซอร์นี้ไม่มีเสียงพูดไทย (สลับอังกฤษอัตโนมัติ) และ Sound Map มี 14 บทพูด ขณะที่สเปกระบุ 15.
- สร้าง `output/luna-12-status.md` พร้อมตารางครบ 77 cue, ผล browser จริง/ยังไม่ trigger, bus/duck/source, pytest และข้อค้างเรื่องเสียงไทย/ที่มา; ตรวจจำนวนแถวแล้วครบ 77.
- พร้อม peer review: พรีวิว local ยังค้างที่หน้าเริ่มต้น surface พร้อม debug panel; ขั้นต่อไปคือฟังบนลำโพง/โมโนและตัดสินใจเรื่องเสียงไทยกับบทพากย์ที่ 15.
