# ร่างบทพากย์ v2 สำหรับเว็บปัจจุบัน

สถานะเอกสาร: ร่างสำหรับตรวจ ไม่ได้แก้หรือผูกโค้ด และไม่ได้อัดเสียงใหม่
เสียงที่กำหนดใน manifest: ภาษาอังกฤษ `en-US-MichelleNeural` ผ่าน edge-tts ตาม `assets/audio/sound-manifest.json:voice_note`

## 1. ตารางบทเดิม

อ่านข้อความเดิมจาก `VOICE_LINES` ใน `twin/twin.js:33-47` ซึ่งตรงกับแผนเสียงเดิมใน `assets/audio/soundmap-reference.html:444-458` ส่วนข้อความของคลิปชื่อสัตว์ไม่มี transcript ในไฟล์ที่อ่าน จึงระบุว่าไม่พบข้อความเดิม ไม่อนุมาน transcript จากชื่อไฟล์ คอลัมน์เล่นซ้ำสรุปจาก `VOICE_POLICY`/`VOICE_ALWAYS` ที่ `twin/twin.js:803-826` และจุดเรียก `speakLine` ที่แสดงท้ายคอลัมน์

| ไฟล์เสียง | ID | ข้อความเดิมที่พบ | เล่นตอนไหน (ไฟล์:บรรทัด) | กฎเล่นซ้ำ |
|---|---|---|---|---|
| `voice/vo_welcome_en.wav` | `vo_welcome` | “Hatch sealed. All systems ready. Beginning our descent.” (`twin/twin.js:34`) | หลังเสียง `dive_start` จบและหน่วงก่อนเล่น (`twin/twin.js:1869-1879`) | `VOICE_ALWAYS`; ไม่ติด cooldown 4 วินาทีระดับรวม แต่เล่นเมื่อเริ่มสำรวจ |
| `voice/vo_zone_mid_en.wav` | `vo_zone_mid` | “Passing 760 metres. Sunlight does not reach this far.” (`twin/twin.js:35`) | เมื่อเปลี่ยนจากผิวน้ำลงชั้นกลาง (`twin/twin.js:840-856`) | cooldown 60 วินาทีต่อ ID และ cooldown รวม 4 วินาที |
| `voice/vo_zone_deep_en.wav` | `vo_zone_deep` | “Below 1,976 metres. The only light down here is made by living things. Floodlights on.” (`twin/twin.js:36`) | เมื่อดำลงเข้าสู่ชั้นลึก (`twin/twin.js:840-856`) | cooldown 60 วินาทีต่อ ID และ cooldown รวม 4 วินาที |
| `voice/vo_scan_hit_en.wav` | `vo_scan_hit` | “Life signal in the reticle.” (`twin/twin.js:37`) | สแกนพบสัตว์ หลังผลสแกนและเสียงเอฟเฟกต์ (`twin/twin.js:1607-1619`) | 3 ครั้งแรก; หลังจากนั้นทุกครั้งที่ 2; cooldown รวม 4 วินาที |
| `voice/vo_scan_miss_en.wav` | `vo_scan_miss` | “No signal. Open water.” (`twin/twin.js:38`) | สแกนไม่พบสัตว์ (`twin/twin.js:1601-1605`) | ครั้งแรก แล้วทุกครั้งที่ 4; cooldown รวม 4 วินาที |
| `voice/vo_on_frame_en.wav` | `vo_on_frame` | “The reticle is on the frame. Turn a little further.” (`twin/twin.js:39`) | เมื่อเป้าเล็งอยู่บนกรอบแทนแผง (`twin/twin.js:1580-1585`) | **ไม่เล่นเลย**: `never: true` (`twin/twin.js:803-804`) |
| `voice/vo_collect_en.wav` | `vo_collect` | “Sample secured.” (`twin/twin.js:40`) | เก็บสัตว์สำเร็จ แต่ยังไม่ครบทั้งหมด (`twin/twin.js:1622-1646`) | 2 ครั้งแรก หลังจากนั้นไม่เล่น; cooldown รวม 4 วินาที |
| `voice/vo_duplicate_en.wav` | `vo_duplicate` | “Already in the tray.” (`twin/twin.js:41`) | พยายามเก็บสัตว์ที่อยู่ในถาดแล้ว (`twin/twin.js:1626-1629`) | cooldown 20 วินาทีต่อ ID และ 4 วินาทีรวม |
| `voice/vo_nothing_en.wav` | `vo_nothing` | “Nothing in the reticle to collect.” (`twin/twin.js:42`) | กดเก็บขณะไม่มีสัตว์ใต้เป้า (`twin/twin.js:1624-1627`) | cooldown 20 วินาทีต่อ ID และ 4 วินาทีรวม |
| `voice/vo_tray_empty_en.wav` | `vo_tray_empty` | “The tray is empty. Collect a sample first.” (`twin/twin.js:43`) | เปิดวิเคราะห์ขณะถาดว่าง (`twin/twin.js:1658-1661`) | cooldown 20 วินาทีต่อ ID และ 4 วินาทีรวม |
| `voice/vo_analyze_en.wav` | `vo_analyze` | “Analysis complete: {names}.” (`twin/twin.js:44`); manifest ระบุว่าไฟล์หลักพูด “Analysis complete.” และต่อคลิปชื่อสัตว์ (`assets/audio/sound-manifest.json:voice_note`, `voice_names_note`) | เปิด Analyze เมื่อมีตัวอย่าง; ส่งคีย์ชื่อที่เก็บตามลำดับ (`twin/twin.js:1658-1672`) | `VOICE_ALWAYS`; ไม่มี cooldown รวม |
| `voice/vo_max_depth_en.wav` | `vo_max_depth` | “Maximum depth, 3,040 metres. Over 300 times the pressure at the surface.” (`twin/twin.js:45`) | ถึงปลายช่วงความลึก (`twin/twin.js:1677-1686`) | `VOICE_ALWAYS`; ไม่มี cooldown รวม |
| `voice/vo_surface_en.wav` | `vo_surface` | “We have reached the surface.” (`twin/twin.js:46`) | กลับถึงผิวน้ำ (`twin/twin.js:1677-1687`) | `VOICE_ALWAYS`; ไม่มี cooldown รวม |
| `voice/vo_complete_en.wav` | `vo_complete` | “All eight samples collected. Mission complete.” (`twin/twin.js:47`) | เก็บครบสัตว์ทั้งหมด (`twin/twin.js:1635-1642`) | `VOICE_ALWAYS`; ไม่มี cooldown รวม |
| `voice/vo_name_shoal_en.wav` | `vo_name_shoal` | ไม่พบข้อความเดิม | เล่นต่อท้าย `vo_analyze` หากตัวอย่างนี้อยู่ในถาด (`twin/twin.js:908-914`, `1668-1671`) | ไม่มี `VOICE_POLICY` เฉพาะ; ตามชุด Analyze ซึ่ง `VOICE_ALWAYS` |
| `voice/vo_name_reef_en.wav` | `vo_name_reef` | ไม่พบข้อความเดิม | เล่นต่อท้าย `vo_analyze` หากตัวอย่างนี้อยู่ในถาด (`twin/twin.js:908-914`, `1668-1671`) | ไม่มี `VOICE_POLICY` เฉพาะ; ตามชุด Analyze ซึ่ง `VOICE_ALWAYS` |
| `voice/vo_name_seahorse_en.wav` | `vo_name_seahorse` | ไม่พบข้อความเดิม | เล่นต่อท้าย `vo_analyze` หากตัวอย่างนี้อยู่ในถาด (`twin/twin.js:908-914`, `1668-1671`) | ไม่มี `VOICE_POLICY` เฉพาะ; ตามชุด Analyze ซึ่ง `VOICE_ALWAYS` |
| `voice/vo_name_manta_en.wav` | `vo_name_manta` | ไม่พบข้อความเดิม | เล่นต่อท้าย `vo_analyze` หากตัวอย่างนี้อยู่ในถาด (`twin/twin.js:908-914`, `1668-1671`) | ไม่มี `VOICE_POLICY` เฉพาะ; ตามชุด Analyze ซึ่ง `VOICE_ALWAYS` |
| `voice/vo_name_lantern_en.wav` | `vo_name_lantern` | ไม่พบข้อความเดิม | เล่นต่อท้าย `vo_analyze` หากตัวอย่างนี้อยู่ในถาด (`twin/twin.js:908-914`, `1668-1671`) | ไม่มี `VOICE_POLICY` เฉพาะ; ตามชุด Analyze ซึ่ง `VOICE_ALWAYS` |
| `voice/vo_name_jelly_en.wav` | `vo_name_jelly` | ไม่พบข้อความเดิม | เล่นต่อท้าย `vo_analyze` หากตัวอย่างนี้อยู่ในถาด (`twin/twin.js:908-914`, `1668-1671`) | ไม่มี `VOICE_POLICY` เฉพาะ; ตามชุด Analyze ซึ่ง `VOICE_ALWAYS` |
| `voice/vo_name_angler_en.wav` | `vo_name_angler` | ไม่พบข้อความเดิม | เล่นต่อท้าย `vo_analyze` หากตัวอย่างนี้อยู่ในถาด (`twin/twin.js:908-914`, `1668-1671`) | ไม่มี `VOICE_POLICY` เฉพาะ; ตามชุด Analyze ซึ่ง `VOICE_ALWAYS` |
| `voice/vo_name_squid_en.wav` | `vo_name_squid` | ไม่พบข้อความเดิม | เล่นต่อท้าย `vo_analyze` หากตัวอย่างนี้อยู่ในถาด (`twin/twin.js:908-914`, `1668-1671`) | ไม่มี `VOICE_POLICY` เฉพาะ; ตามชุด Analyze ซึ่ง `VOICE_ALWAYS` |

ไฟล์เสียงจริงมีบทเหตุการณ์ 14 ไฟล์และชื่อสัตว์ 8 ไฟล์ รวม 22 (`assets/audio/sound-manifest.json:voice`, `voice_names`; `assets/audio/voice/` มีไฟล์ตามรายการข้างต้น) รายการชื่อสัตว์เป็น 8 ชนิด ไม่ใช่ 6 ตามบันทึกเก่าใน `work-orders/LUNA-13-VOICE-LOOK-BRIDGE.md:10` ; manifest ปัจจุบันมี `voice` ที่บรรทัด 693, `voice_note` ที่ 746, `voice_names` ที่ 747 และ `voice_names_note` ที่ 757 แต่ไม่ได้ยืนยัน transcript ของแต่ละไฟล์

## 2. ตารางช่องโหว่และสิ่งที่ไม่ตรงกับเว็บ

| เหตุการณ์/จุดไม่ตรง | หลักฐานไฟล์:บรรทัด | ข้อเสนอ |
|---|---|---|
| ชนพื้นท้ายชั้นเมื่อเป้าไม่ตรงช่อง บอกเป็นข้อความและมีเสียงเรือ แต่ไม่มีบทพากย์ | `twin/twin.js:1516-1527`, `1542-1545` | เพิ่ม `vo_gate_hint` เฉพาะชนพื้นขณะดำลง (`dir > 0`); ขาขึ้นคง feedback เดิม |
| พบช่อง: แสดง pill และ haptic ทั้งสองทิศ แต่ไม่มีเสียงพูด | `twin/twin.js:1554-1577` | เพิ่ม `vo_gate_found` เฉพาะตอนสถานะขาลงเปลี่ยนเป็น `ready > 0`; ไม่เล่นเมื่อ `ready = -1` ขาขึ้น |
| ผ่านช่องและเปลี่ยนชั้น: `gatePassed` พูดผ่าน `say()` ทั้งสองทิศ แต่ไม่เรียก `speakLine`; เสียงโซนเกิดตอนเปลี่ยน zone | `twin/twin.js:840-856`, `1529-1552`; เกณฑ์โซน `twin/renderer.js:3-4` | ใช้ `vo_gate_pass` เฉพาะตอนผ่านช่องขาลง (`dir > 0`) และเลือกแทนบทเข้าโซนใน transition นั้น; ขาขึ้นคง feedback เดิม |
| ถึงพื้นชั้นล่างสุด: ไม่มีช่องลงต่อ; มีบท `vo_max_depth` ทำงานเมื่อ depth = 1 อยู่แล้ว | `twin/twin.js:1555-1570`, `1684-1686`; `docs/plan-levels-creatures-card.md:20-24` | ไม่เพิ่มบทก้นทะเลแยก ให้บทความลึกสูงสุดครอบคลุมการถึงพื้นชั้นล่างสุดเพียงครั้งเดียว |
| เปิดการ์ดสปีชีส์หลังเก็บ: มีเสียง `vo_collect` แต่ไม่มีบทเฉพาะการ์ดหรือชื่อสัตว์; การ์ดแสดงชื่อ/คำอธิบาย | `twin/twin.js:1431-1448`, `1622-1647` | ให้ `vo_collect` ปัจจุบันนับเป็นเสียงตอบรับการ์ดแล้ว ไม่เพิ่มประโยคที่ซ้ำโดยไม่จำเป็น; ถ้าต้องการชื่อ ให้ถามเจ้าของด้านล่าง |
| ทุกสัตว์ใน `SPECIES` มีคีย์คลิปชื่อใน manifest ปัจจุบัน จึงไม่มีสัตว์ไร้ `vo_name_*` | `twin/twin.js:1383-1416`; รายการคีย์ renderer `twin/renderer.js:177-178`; `assets/audio/sound-manifest.json:voice_names` | ยืนยันชื่อพูดทั้ง 8 ใน Analyze; ตรวจถาดว่าง/คีย์หายให้ข้ามคลิปชื่อนั้นโดยไม่ผิดพลาด |
| เสียงโซนลึกยาวเกินเป้าหมายสำหรับคลิปสั้น (ประมาณ 16 คำ) | `twin/twin.js:36`, `853-856`; ต้นฉบับใน `assets/audio/soundmap-reference.html:446` | ย่อให้เหลือเฉพาะระดับความลึกและคำสั่งเปิดไฟส่อง ซึ่งมีอยู่ในบทเดิมแล้ว |
| บทถึงความลึกสูงสุดระบุแรงดันมากกว่า 300 เท่า ซึ่งไม่มีในข้อมูล SPECIES/การ์ดที่อนุญาตให้ใช้อ้างอิง | `twin/twin.js:45`, `1684-1686` | ตัดตัวเลขแรงดันออก เหลือเพียงความลึกที่หน้าจอกำหนด 3,040 เมตร |
| `vo_on_frame` มีไฟล์และ call site แต่ถูกปิดเสียงไว้ตามการตัดสินเดิม; ใช้กรอบสีเขียวบอกแทน | `twin/twin.js:803-804`, `1580-1585`; `work-orders/LUNA-15-SOUNDSCAPE-BREATHING.md:65`; `output/claude-14-15-status.md:10` | คงปิดเสียงไว้ ไม่เสนอเปิดใหม่ |
| กฎ cooldown รวม 4 วินาทีอาจตัดเสียงเหตุการณ์คนละประเภทที่เกิดใกล้กัน; รายการ `VOICE_ALWAYS` เลี่ยงกฎนี้ทั้งหมด | `twin/twin.js:808-825` | บทใหม่ใช้ cooldown เฉพาะเหตุการณ์และ cooldown รวมอย่างน้อย 4 วินาที ยกเว้นบทเริ่ม/จบที่เกิดครั้งเดียว |

หมายเหตุชั้น: renderer กำหนด `ZONE_BOUNDS=[0.25,0.65]` และความลึกสูงสุด 3,040 ม. ซึ่งคำนวณได้เป็น 760 และ 1,976 ม.; ตรงกับช่วงชั้นในแผน (`twin/renderer.js:3-4`, `docs/plan-levels-creatures-card.md:20-24`).

## 3. ร่างบทใหม่

บทพูดเป็นภาษาอังกฤษ ไม่เกินประมาณ 12 คำต่อคลิป ประโยคไทยเป็นคำแปล/คำอธิบายสำหรับผู้ตรวจ ชื่อสัตว์ใช้ชื่อสามัญที่มีอยู่ใน `SPECIES` (`twin/twin.js:1383-1416`). สำหรับคลิปชื่อสัตว์ transcript เดิมยังไม่พบ: ข้อความอังกฤษในตารางเป็นชื่อจากการ์ดเพื่อช่วยตรวจเท่านั้น ไม่ยืนยันว่าเสียงเดิมพูดตามนี้ จึงคงไฟล์เดิมไว้ เว้นแต่เจ้าของฟังแล้วขอแก้

| ID ที่เสนอ | สถานะ | บทภาษาอังกฤษ | คำแปลไทย | เหตุผลสั้น ๆ |
|---|---|---|---|---|
| `vo_welcome` | คงเดิม | Hatch sealed. All systems ready. Beginning our descent. | ปิดฝาเรียบร้อย ทุกระบบพร้อม เริ่มดำลงได้ | ต้อนรับเมื่อเริ่มสำรวจ สอดคล้องกับการเริ่มภารกิจ |
| `vo_zone_mid` | คงเดิม | Passing 760 metres. Sunlight does not reach this far. | ผ่าน 760 เมตรแล้ว แสงจากผิวน้ำมาไม่ถึงตรงนี้ | ระบุขอบชั้นกลางตามระบบปัจจุบัน |
| `vo_zone_deep_v2` | แก้ | Below 1,976 metres. Floodlights on. | ต่ำกว่า 1,976 เมตรแล้ว เปิดไฟส่อง | ย่อบทเดิมประมาณ 16 คำให้สั้น โดยคงสาระ “Floodlights on.” |
| `vo_scan_hit` | คงเดิม | Life signal in the reticle. | มีสัญญาณสิ่งมีชีวิตในเป้าเล็ง | feedback สแกนพบที่สั้นและไม่กล่าวชนิดสัตว์ผิด |
| `vo_scan_miss` | คงเดิม | No signal. Open water. | ไม่พบสัญญาณ มีแต่น้ำเปิด | ตรงกับสแกนไม่พบ |
| `vo_on_frame` | คงเดิม | The reticle is on the frame. Turn a little further. | เป้าเล็งอยู่บนกรอบ หมุนต่ออีกนิด | เก็บข้อความอ้างอิงไว้ แต่คงปิดเสียงตามการตัดสินเดิมและใช้กรอบสีเขียวแทน |
| `vo_collect` | คงเดิม | Sample secured. | เก็บตัวอย่างเรียบร้อย | สั้นและพอดีกับการเก็บ/แสดงการ์ด |
| `vo_duplicate` | คงเดิม | Already in the tray. | อยู่ในถาดแล้ว | แจ้งกรณีเก็บซ้ำโดยไม่ซ้ำคำยาว |
| `vo_nothing` | คงเดิม | Nothing in the reticle to collect. | ไม่มีอะไรใต้เป้าให้เก็บ | ตรงกับไม่มีสัตว์ใต้เป้า |
| `vo_tray_empty` | คงเดิม | The tray is empty. Collect a sample first. | ถาดยังว่าง เก็บตัวอย่างก่อน | แนะนำการกระทำถัดไป |
| `vo_analyze` | คงเดิม | Analysis complete. | วิเคราะห์เสร็จแล้ว | เล่นตามด้วยคลิปชื่อสัตว์ที่เก็บ ตามลำดับถาด |
| `vo_max_depth_v2` | แก้ | Maximum depth: 3,040 metres. The descent ends here. | ความลึกสูงสุด 3,040 เมตร การดำลงสิ้นสุดที่นี่ | ตัดตัวเลขแรงดันและรวมการถึงพื้นล่างสุดไว้ในบทเดียว (8 คำ) |
| `vo_surface` | คงเดิม | We have reached the surface. | เรากลับถึงผิวน้ำแล้ว | แจ้งเมื่อกลับสู่ผิวน้ำ |
| `vo_complete` | คงเดิม | All eight samples collected. Mission complete. | เก็บครบทั้งแปดตัวอย่าง ภารกิจสำเร็จ | สอดคล้องกับจำนวน SUBJECTS ทั้งหมด |
| `vo_name_shoal` | คงเดิม | Sea Goldie. | ปลาซีโกลดี | ข้อความอังกฤษเป็นเพียงชื่อจากการ์ด ไม่ใช่ transcript ที่ยืนยัน; คงไฟล์เดิมไว้ |
| `vo_name_reef` | คงเดิม | Red Sea Clownfish. | ปลาการ์ตูนทะเลแดง | ข้อความอังกฤษเป็นเพียงชื่อจากการ์ด ไม่ใช่ transcript ที่ยืนยัน; คงไฟล์เดิมไว้ |
| `vo_name_seahorse` | คงเดิม | Sea Pony. | ม้าน้ำ | ข้อความอังกฤษเป็นเพียงชื่อจากการ์ด ไม่ใช่ transcript ที่ยืนยัน; คงไฟล์เดิมไว้ |
| `vo_name_manta` | คงเดิม | Reef Manta Ray. | กระเบนราหูแนวปะการัง | ข้อความอังกฤษเป็นเพียงชื่อจากการ์ด ไม่ใช่ transcript ที่ยืนยัน; คงไฟล์เดิมไว้ |
| `vo_name_lantern` | คงเดิม | Skinnycheek Lanternfish. | ปลาโคมแก้มเรียว | ข้อความอังกฤษเป็นเพียงชื่อจากการ์ด ไม่ใช่ transcript ที่ยืนยัน; คงไฟล์เดิมไว้ |
| `vo_name_jelly` | คงเดิม | Atolla Jellyfish. | แมงกะพรุนอะโทลลา | ข้อความอังกฤษเป็นเพียงชื่อจากการ์ด ไม่ใช่ transcript ที่ยืนยัน; คงไฟล์เดิมไว้ |
| `vo_name_angler` | คงเดิม | Humpback Anglerfish. | ปลาตกเบ็ดหลังค่อม | ข้อความอังกฤษเป็นเพียงชื่อจากการ์ด ไม่ใช่ transcript ที่ยืนยัน; คงไฟล์เดิมไว้ |
| `vo_name_squid` | คงเดิม | Vampire Squid. | หมึกแวมไพร์ | ข้อความอังกฤษเป็นเพียงชื่อจากการ์ด ไม่ใช่ transcript ที่ยืนยัน; คงไฟล์เดิมไว้ |
| `vo_gate_hint` | ใหม่ | The floor is close. Turn the box to find the opening. | พื้นอยู่ใกล้แล้ว หมุนกล่องเพื่อหาช่อง | ใช้เฉพาะชนพื้นขณะดำลง (`dir > 0`); 11 คำ |
| `vo_gate_found` | ใหม่ | Opening found. Hold dive to pass through. | พบช่องแล้ว กดดำลงเพื่อผ่าน | ใช้เฉพาะเมื่อพบช่องขาลง (`ready > 0`); 7 คำ |
| `vo_gate_pass` | ใหม่ | Through the opening. Welcome to the next level. | ผ่านช่องแล้ว ยินดีต้อนรับสู่ชั้นถัดไป | ใช้เฉพาะการผ่านช่องขาลง (`dir > 0`); 8 คำ |


สรุปข้อเสนอในตารางนี้: คงเดิม 20 บท, แก้ 2 บท, ใหม่ 3 บท รวม 25 แถว. จำนวนคงเดิมรวม 12 บทเหตุการณ์และ 8 คลิปชื่อสัตว์; ชื่อสัตว์ยังคงไฟล์เสียงเดิม ไม่เสนอแก้โดยไม่มีหลักฐาน. บท gate ทุกบทด้านล่างมีเงื่อนไขขาลงเท่านั้น

## 4. ข้อเสนอการผูกโค้ด (เอกสารอย่างเดียว)

- `speakLine('vo_gate_hint')`: ใน `gateBump(gate, dir)` หลังตรวจ cooldown เมื่อ `dir > 0` เท่านั้น; ขาขึ้นให้คงข้อความ/เสียงเดิม ไม่เล่นบทนี้; แนะนำ cooldown 20–30 วินาทีต่อ gate
- `speakLine('vo_gate_found')`: ใน `updateGates()` เฉพาะตอน `ready` เปลี่ยนจาก 0 เป็น 1 (ช่องขาลง) เท่านั้น; ไม่เล่นเมื่อ `ready = -1` ขาขึ้น; cooldown 20 วินาทีต่อ gate และไม่เล่นซ้ำทุก frame
- `speakLine('vo_gate_pass')`: ใน `gatePassed(gate, dir)` หลังผ่านช่องจริงเมื่อ `dir > 0` เท่านั้น; ขาขึ้นคงข้อความเดิมโดยไม่เพิ่มเสียงนี้; เล่นหนึ่งครั้งต่อการเปลี่ยนระดับ และเลือกใช้แทน `vo_zone_mid`/`vo_zone_deep` สำหรับ transition เดียวกันเพื่อไม่ให้พูดซ้อน
- ไม่เพิ่ม `vo_seabed`: ใช้ `vo_max_depth` ที่มีอยู่ซึ่ง trigger ที่ depth = 1 ให้เป็นบทเดียวแจ้งทั้งความลึกสูงสุดและจุดสิ้นสุดของการดำลง
- สำหรับบทเหตุการณ์ที่แก้ ใช้ชื่อไฟล์รุ่นใหม่ตาม ID `_v2` เมื่ออัดและอนุมัติแล้ว; เก็บไฟล์เดิมไว้และไม่เขียนทับ; อย่าผูก `_v2` ก่อนยืนยันไฟล์ใหม่
- กำหนด `vo_gate_hint`/`vo_gate_found` cooldown เฉพาะและใช้ global gap อย่างน้อย 4 วินาที; ไม่เพิ่ม ID เหล่านี้เข้า `VOICE_ALWAYS` เพื่อเลี่ยงเสียงถี่
- คลิปชื่อสัตว์ใน Analyze ให้เรียงตาม `state.collected` ดังที่โค้ดส่ง `nameKeys`; เว้นประมาณ 150 ms ระหว่างคลิปตามแนวทางใน `assets/audio/sound-manifest.json:voice_names_note` และใช้ duck รอบเดียวต่อทั้งชุดตามการทำงานปัจจุบัน `twin/twin.js:908-940`
- รักษาบท `vo_collect` เป็น feedback ของการเปิดการ์ด ไม่เพิ่มเสียงเปิดการ์ดอีกชั้น; สัตว์ทั้ง 8 มี `SPECIES` และ `voice_names` mapping อยู่แล้ว (`twin/twin.js:1383-1416`, `assets/audio/sound-manifest.json:747-755`). หากเจ้าของฟังแล้วขออัดชื่อสัตว์ใหม่ ให้ใช้ไฟล์ใหม่ เช่น `voice/vo_name_shoal_v2_en.wav` แล้วเปลี่ยน path ของ key `shoal` ใน `voice_names` ให้ชี้ไฟล์ใหม่นั้น โดยเก็บ `vo_name_shoal_en.wav` เดิมไว้; ID ที่โค้ดสร้างยังคง `vo_name_shoal` ตาม `twin/twin.js:908-914`

## 5. คำถามถึงเจ้าของ

1. เจ้าของฟังคลิปชื่อสัตว์เดิมทั้ง 8 แล้วต้องการให้แก้ไฟล์ใดหรือไม่? **คำแนะนำ:** คงเดิมจนกว่าจะฟังแล้วระบุรายการที่ต้องแก้; ถ้าขอแก้ให้อัดเป็นไฟล์ชื่อรุ่นใหม่และเปลี่ยน path ใต้ `voice_names` โดยคงไฟล์เดิมไว้
2. ตอนผ่านช่องลงต้องการใช้ `vo_gate_pass` หรือเสียงเข้าโซนเดิม? **คำแนะนำ:** ใช้เพียงบทเดียวต่อ transition เพื่อไม่ให้เสียงซ้อนกัน
