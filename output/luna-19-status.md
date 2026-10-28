# LUNA-19 สถานะงาน

วันที่: 2026-10-28

## ไฟล์ที่อ่าน

- `work-orders/LUNA-19-VOICE-SCRIPT-DRAFT.md`
- `work-orders/LUNA-19-FIX-1.md`
- `twin/twin.js` — VOICE_LINES, VOICE_POLICY/VOICE_ALWAYS/voiceAllowed, จุดเรียก speakLine, SPECIES, การ์ด/วิเคราะห์ และ gate logic
- `twin/renderer.js` — ART_KEYS/ART, ขอบเขตความลึกและช่วงชั้น
- `assets/audio/sound-manifest.json`, `assets/audio/soundmap-reference.html:444-458` และรายชื่อไฟล์ใน `assets/audio/voice/`
- `work-orders/LUNA-13-VOICE-LOOK-BRIDGE.md`
- `docs/plan-levels-creatures-card.md`
- `work-orders/LUNA-14B-START-AT-ZERO-AND-SEAMLESS.md` — ตรวจบันทึกบทต้อนรับและจุดเริ่มความลึก
- `output/luna-12-status.md`, `output/luna-13-progress.md` — ตรวจข้อความอ้างอิงเดิมที่พบ
- `tests/twin_browser_checks.js` — ค้นหาการอ้างอิงคีย์คลิปชื่อสัตว์ (ไม่ได้รันเทส)

## ผลจัดทำ

- พบไฟล์เสียงพากย์ 22 ไฟล์: บทเหตุการณ์ 14 ไฟล์ และคลิปชื่อสัตว์ 8 ไฟล์
- ร่างข้อเสนอ 25 แถว: คงเดิม 20, แก้ 2, ใหม่ 3 (นับ 8 คลิปชื่อสัตว์เป็นคงเดิม)
- ข้อความเดิมของ 14 บทเหตุการณ์พบใน `twin/twin.js:33-47`; ไม่พบ transcript เดิมของคลิปชื่อสัตว์ จึงระบุชัดว่าไม่พบและใช้ชื่อสามัญจาก SPECIES เป็นเพียงข้อความช่วยตรวจที่ยังไม่ยืนยันเป็น transcript
- สร้าง `docs/voice-script-v2.md` พร้อมตารางบทเดิม ช่องโหว่ ร่างบท ข้อเสนอการผูกโค้ด และคำถามถึงเจ้าของ
- ไม่แก้โค้ด ไฟล์เสียง หรือไฟล์ใดใน `twin/`, `assets/`, `firmware/`, `laptop/`, `config/`

## รอบแก้ 1

- จำกัด `vo_gate_hint`, `vo_gate_found` และ `vo_gate_pass` ไว้เฉพาะเหตุการณ์ขาลง โดยระบุเงื่อนไข `dir > 0` / `ready > 0`; ขาขึ้นคง feedback เดิม
- คง `vo_on_frame` ปิดเสียงตามการตัดสินเดิม และอ้างหลักฐานการใช้กรอบสีเขียวแทน
- เปลี่ยนคลิปชื่อสัตว์ทั้ง 8 เป็นสถานะคงเดิม เพราะยังไม่มี transcript ยืนยัน; เพิ่มแนวทางอัดไฟล์ชื่อใหม่และเปลี่ยน path ของ `voice_names` โดยไม่ทับไฟล์เก่าเมื่อเจ้าของฟังแล้วขอแก้
- ตัด `vo_seabed` ที่ซ้ำกับ `vo_max_depth`; รวมความหมายถึงปลายทางไว้ในข้อความ `vo_max_depth_v2` เพียงบทเดียว
- แก้เหตุผลของ `vo_zone_deep`: ปัญหาคือความยาวประมาณ 16 คำ; คงสาระ “Floodlights on.” จากบทเดิม
- ตัวนับฉบับแก้: คงเดิม 20, แก้ 2, ใหม่ 3 รวม 25 แถว

**ร่างเท่านั้น ยังไม่อัดเสียง ยังไม่ผูกโค้ด**





