# ผลฟังเสียงรอบ 1 (ผู้ใช้เลือก 2 ต.ค. 2026) — เก็บไว้ให้ลูน่าอ่าน

ที่มา: หน้า `assets/audio/temp/listen.html` ผู้ใช้ติ๊กใช้/ไม่เอา เพิ่มเติมคือบรีฟใหม่ 3 ข้อ

## บรีฟใหม่จากผู้ใช้ (ทับสเปกเดิมในอาร์ติแฟคต์ Sound Map)
1. **มีเพลงประกอบ** นอกเหนือเสียงทะเล โดยเฉพาะตอนลึกมากที่เสียงเบา แนวเดียวกับเกม Sky: Children of the Light คือดนตรีนุ่มบาง ๆ ที่บอกความเป็นธรรมชาติในจังหวะเงียบ ไม่ใช่เพลงจริงจัง ไม่ใช่เสียงบรรยากาศธรรมชาติ
2. **อารมณ์ใต้ทะเล = ลึกลับ น่าสำรวจ ไม่น่ากลัว** เปลี่ยนจาก "ลึกลับ น่ากลัว" ในสเปกเดิม (กระทบ deep_mystery, ambient_deep, hull_creak ที่ต้องฟังเป็นเสียงเรือเฉย ๆ ไม่ใช่หนังผี)
3. **เสียงสัตว์ = ดนตรีสั้น ๆ (motif)** ไม่ใช่เสียงจักรกล

## ใช้แล้ว (ผู้ใช้ติ๊ก ✓)
| cue | ไฟล์ |
|---|---|
| ambient_surface / mid / whale / sub_roomtone / sonar_idle / scan_sweep | ไฟล์เพื่อนทั้งหมด |
| ambient_deep | ไฟล์เพื่อน แต่ **เบาไปและคล้ายชั้นบน** → ต้องเพิ่มระดับและเปลี่ยนเนื้อเสียง |
| hull_creak 1–6 | ไฟล์เพื่อน แต่ **1–4 เงียบค้างนานก่อนเสียงเกิด ต้องตัดช่วงเงียบออก** |
| descend_thrust | `kenney_sci-fi-sounds/spaceEngineLow_000.ogg`, `spaceEngineLow_001.ogg`, `water-splash-slime-sfx/loop_bubbles_1.ogg` |
| ascend_blow | `water-splash-slime-sfx/bubble_03.ogg`, `loop_bubbles_02.ogg` |
| turn_periscope | `kenney_interface-sounds/click_003.ogg` (ตัวเดียว → ต้องปรับเสียงสุ่มเล็กน้อยด้วย pitch ±3% / ความดัง ±2 dB) |
| scan_hit | `sonar_ping.mp3` |
| scan_miss | `kenney_interface-sounds/question_004.ogg` |
| action_error | `kenney_interface-sounds/minimize_008.ogg` |
| collect_success | `kenney_interface-sounds/confirmation_004.ogg` |
| collect_duplicate | `kenney_interface-sounds/pluck_002.ogg` |
| analyze_open | `kenney_interface-sounds/open_001.ogg` (เสียงประมวลผลยาวไป ตัดทิ้ง ใช้แค่เสียงหน้าต่างเปิด) |
| dive_assist_on / off | `toggle_001.ogg` / `toggle_002.ogg` |
| first_discovery | `kenney_interface-sounds/glass_004.ogg` **แต่เบาไป** ต้องหาตัวที่ดังกว่านี้หรือซ้อนชั้น |
| mission_complete | `confirmation_004.ogg` |
| board_link_off | `minimize_006.ogg` |
| life_shoal | `loop_water_03.ogg`, `loop_bubbles_1.ogg` (ก่อนบรีฟ "สัตว์ = ดนตรี" ต้องเปลี่ยนใหม่) |
| life_reef | `loop_bubbles_02`, `bubble_01`, `bubble_03`, `slime_02` **ต้องสุ่มสลับ ห้ามเล่นตัวเดิมติดกัน** (ก่อนบรีฟดนตรี) |

## ไม่ผ่าน ต้องหาใหม่ (พร้อมเหตุผล)
| cue | เหตุผลของผู้ใช้ |
|---|---|
| dive_start | ควรเป็นฟีลปิดห้องแรงดัน/ห้องออกซิเจน |
| zone_enter_mid / deep | อยากได้เสียงแนว `impactBell_heavy_000.ogg` เหมือนเสียงเข้าด่านใน Sky (โซนลึกให้ใช้แบบลึกกว่า) |
| zone_up | เสียงไม่ถูกเลย หาใหม่ |
| max_depth_warning | ควรเป็น "ติ๊ด ติ๊ด" เหมือนเตือนทางหนีไฟในห้องแล็บ |
| surface_break | ต้องใหญ่กว่านี้ แบบคลื่นน้ำกระทบผิวน้ำ ที่ให้ฟังเป็นวัตถุเล็ก |
| deep_mystery | ต้องไม่ใช่เสียงเครื่องจักร (ลึกลับ น่าสำรวจ) |
| analyze_close | ไม่ใช่คลิกนุ่ม ๆ |
| board_link_on | อยากได้เสียงเปิดระบบปฏิบัติการ |
| life_seahorse / manta / lantern / jelly | ทั้งชั้นสัตว์ต้องเป็นดนตรีสั้น ๆ ไม่ใช่เสียงจักรกล |
