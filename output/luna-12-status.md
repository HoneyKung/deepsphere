# LUNA-12 — รายงานสถานะสำหรับ peer review

วันที่ 2 ตุลาคม 2026 · ทำงานจาก `prototype-v1/`

## เปิดเว็บเพื่อโชว์

[เปิด Web Twin พร้อมแผงตรวจเสียง](http://127.0.0.1:8087/twin/?audio=debug)

กด **BEGIN EXPLORATION** เพื่อเริ่ม ระบบ preload ไฟล์เสียงก่อนเข้าทวินและแสดง `LOADING SOUND n/N`; แผง `AUDIO CHECK` แสดง source, cue ล่าสุด, peak meter, volume, สวิตช์เพลง, ภาษาเสียง และตัวเลือก sonar ต่อเนื่อง หน้าเดโมเปิดค้างอยู่ที่ลิงก์ข้างบนแล้ว โหมด live ที่ไม่มีบอร์ดเปิดได้ที่ `?live=1&audio=debug` และแสดง `BOARD DISCONNECTED` โดยทวินยังทำงานได้

## สรุปการส่งมอบ

- เปลี่ยน playback ของ Web Twin เป็น `AudioContext` เดียว, Web Audio buffers และ 6 บัส: `bed`, `hull`, `life`, `tool`, `voice`, `music`; มี master M mute, volume และปุ่มเปิด/ปิดเพลงแยก
- โหลดข้อมูลจาก `sound-manifest.json`; catalog มี 77 cue IDs (63 file, 14 draft, 0 none), และตรวจพบไฟล์อ้างอิงครบ 120/120. Preload รอบเริ่มต้นผ่าน 57/57 ไฟล์
- Ambient 3 โซน, roomtone, hull creak, whale, scan และเพลง/ชั้นแยกทำงานผ่าน Web Audio; `sonar_idle` เล่นหลังสแกน 1 เป็นเวลา 10 วินาที และค่าเริ่มต้นไม่ปิงเอง
- ผูกปุ่ม 1/2/3/H/M, turn ทุก 5°, เปลี่ยนโซน/ความลึก, animal musical one-shot, priority/duck, discovery/home และ debug panel ตามตารางด้านล่าง
- `catalog.json` ยังคง `cues` 8 รายการตามสัญญาเดิมของ laptop dashboard และเพิ่มรายการทั้งหมดของ Web Twin ใต้ `twin_cues`; ไม่มี runtime path ไป `assets/audio/temp/` หรือ `assets/audio/legacy/`

## ตาราง cue → ไฟล์ → bus → duck → ผลเล่น

`เล่นจริงใน browser` หมายถึงสังเกต event จากแผง debug ในรอบ manual นี้; `ยังไม่ trigger` หมายถึงไฟล์และ path มีครบ แต่ไม่ได้เกิด event นั้นในรอบตรวจ. `—` หมายถึง cue นั้นไม่ได้เริ่ม duck เอง (ยังอาจถูกลดระดับชั่วคราวเมื่อมีพากย์หรือเหตุการณ์สำคัญ)

| Cue | ไฟล์ / source | Bus | Duck | ผลใน browser |
|---|---|---|---|---|
| `ambient_surface` | `ambient_surface.wav` | `bed` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `ambient_mid` | `ambient_mid.wav` | `bed` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `ambient_deep` | `ambient_deep.wav` | `bed` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `whale_distant` | `whale_distant.wav` | `bed` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `sub_roomtone` | `sub_roomtone.wav` | `hull` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `hull_creak` | `hull_creak_1.wav` … `hull_creak_25.wav` (สุ่ม ไม่ซ้ำติดกัน) | `hull` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `sonar_idle` | `sonar_idle.wav` | `hull` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `scan_sweep` | `scan_sweep.wav` | `tool` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `dive_start` | `dive_start_1.wav`, `dive_start_2.wav`, `dive_start_3.wav` | `tool` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `descend_thrust` | `descend_thrust_1.wav`, `descend_thrust_2.wav` | `hull` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `descend_bubbles` | `descend_bubbles.wav` | `hull` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `ascend_blow` | `ascend_blow_1.wav`, `ascend_blow_2.wav` | `hull` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `turn_periscope` | `turn_periscope_1.wav`, `turn_periscope_2.wav`, `turn_periscope_3.wav`, `turn_periscope_4.wav` | `tool` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `zone_enter_mid` | `zone_enter_mid.wav` | `tool` | ใช่: music/bed/life ลดชั่วคราว | เล่นจริงใน browser |
| `zone_enter_deep` | `zone_enter_deep.wav` | `tool` | ใช่: music/bed/life ลดชั่วคราว | เล่นจริงใน browser |
| `zone_up` | `zone_up.wav` | `tool` | ใช่: music/bed/life ลดชั่วคราว | เล่นจริงใน browser |
| `deep_mystery` | `deep_mystery_1.wav`, `deep_mystery_2.wav`, `deep_mystery_3.wav` | `bed` | ใช่: music/bed/life ลดชั่วคราว | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `max_depth_warning` | `max_depth_warning.wav` | `tool` | ใช่: music/bed/life ลดชั่วคราว | เล่นจริงใน browser |
| `surface_break` | `surface_break.wav` | `tool` | ใช่: music/bed/life ลดชั่วคราว | เล่นจริงใน browser |
| `scan_hit` | `scan_hit.wav` | `tool` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `scan_miss` | `scan_miss.wav` | `tool` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `action_error` | `action_error.wav` | `tool` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `collect_success` | `collect_success.wav` | `tool` | ใช่: music/bed/life ลดชั่วคราว | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `collect_duplicate` | `collect_duplicate.wav` | `tool` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `analyze_open` | `analyze_open.wav` | `tool` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `analyze_close` | `analyze_close.wav` | `tool` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `dive_assist_on` | `dive_assist_on.wav` | `tool` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `dive_assist_off` | `dive_assist_off.wav` | `tool` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `first_discovery` | `first_discovery.wav` | `tool` | ใช่: music/bed/life ลดชั่วคราว | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `mission_complete` | `mission_complete.wav` | `tool` | ใช่: music/bed/life ลดชั่วคราว | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `board_link_on` | `board_link_on.wav` | `tool` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `board_link_off` | `board_link_off.wav` | `tool` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_shoal_glimpse` | `life_shoal_glimpse.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_shoal_known` | `life_shoal_known.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_shoal_memory` | `life_shoal_memory.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_reef_glimpse` | `life_reef_glimpse.wav` | `life` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `life_reef_known` | `life_reef_known.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_reef_memory` | `life_reef_memory.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_seahorse_glimpse` | `life_seahorse_glimpse.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_seahorse_known` | `life_seahorse_known.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_seahorse_memory` | `life_seahorse_memory.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_manta_glimpse` | `life_manta_glimpse.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_manta_known` | `life_manta_known.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_manta_memory` | `life_manta_memory.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_jelly_glimpse` | `life_jelly_glimpse.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_jelly_known` | `life_jelly_known.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_jelly_memory` | `life_jelly_memory.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_lantern_glimpse` | `life_lantern_glimpse.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_lantern_known` | `life_lantern_known.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `life_lantern_memory` | `life_lantern_memory.wav` | `life` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `music_invite` | music/invite_{mix,pad,lead,motion,sparkle}.ogg (mix + 4 stems) | `music` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `music_shallow` | music/shallow_{mix,pad,lead,motion,sparkle}.ogg (mix + 4 stems) | `music` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `music_mid` | music/mid_{mix,pad,lead,motion,sparkle}.ogg (mix + 4 stems) | `music` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `music_deep` | music/deep_{mix,pad,lead,motion,sparkle}.ogg (mix + 4 stems) | `music` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `music_discovery` | music/discovery_{mix,pad,lead,motion,sparkle}.ogg (mix + 4 stems) | `music` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `music_home` | music/home_{mix,pad,lead,motion,sparkle}.ogg (mix + 4 stems) | `music` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `bridge_down_mid` | `music/bridge_down_mid.wav` | `music` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `bridge_down_deep` | `music/bridge_down_deep.wav` | `music` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `bridge_up_mid` | `music/bridge_up_mid.wav` | `music` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `bridge_up_shallow` | `music/bridge_up_shallow.wav` | `music` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `bridge_discovery_in` | `music/bridge_discovery_in.wav` | `music` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `bridge_discovery_out` | `music/bridge_discovery_out.wav` | `music` | — (ไม่ duck เฉพาะ cue) | ไฟล์ครบ; ยังไม่ trigger ในรอบนี้ |
| `bridge_to_invite` | `music/bridge_to_invite.wav` | `music` | — (ไม่ duck เฉพาะ cue) | เล่นจริงใน browser |
| `vo_welcome` | ไม่มีไฟล์แพ็กเกจ; `speechSynthesis` | `voice` | ใช่: bed×0.45, life×0.6, hull×0.7, music×0.58 | ได้ยินจริง: TTS อังกฤษ |
| `vo_zone_mid` | ไม่มีไฟล์แพ็กเกจ; `speechSynthesis` | `voice` | ใช่: bed×0.45, life×0.6, hull×0.7, music×0.58 | ยังไม่ trigger; TTS ร่าง |
| `vo_zone_deep` | ไม่มีไฟล์แพ็กเกจ; `speechSynthesis` | `voice` | ใช่: bed×0.45, life×0.6, hull×0.7, music×0.58 | ยังไม่ trigger; TTS ร่าง |
| `vo_scan_hit` | ไม่มีไฟล์แพ็กเกจ; `speechSynthesis` | `voice` | ใช่: bed×0.45, life×0.6, hull×0.7, music×0.58 | ยังไม่ trigger; TTS ร่าง |
| `vo_scan_miss` | ไม่มีไฟล์แพ็กเกจ; `speechSynthesis` | `voice` | ใช่: bed×0.45, life×0.6, hull×0.7, music×0.58 | ได้ยินจริง: TTS อังกฤษ |
| `vo_on_frame` | ไม่มีไฟล์แพ็กเกจ; `speechSynthesis` | `voice` | ใช่: bed×0.45, life×0.6, hull×0.7, music×0.58 | ยังไม่ trigger; TTS ร่าง |
| `vo_collect` | ไม่มีไฟล์แพ็กเกจ; `speechSynthesis` | `voice` | ใช่: bed×0.45, life×0.6, hull×0.7, music×0.58 | ยังไม่ trigger; TTS ร่าง |
| `vo_duplicate` | ไม่มีไฟล์แพ็กเกจ; `speechSynthesis` | `voice` | ใช่: bed×0.45, life×0.6, hull×0.7, music×0.58 | ยังไม่ trigger; TTS ร่าง |
| `vo_nothing` | ไม่มีไฟล์แพ็กเกจ; `speechSynthesis` | `voice` | ใช่: bed×0.45, life×0.6, hull×0.7, music×0.58 | ยังไม่ trigger; TTS ร่าง |
| `vo_tray_empty` | ไม่มีไฟล์แพ็กเกจ; `speechSynthesis` | `voice` | ใช่: bed×0.45, life×0.6, hull×0.7, music×0.58 | ได้ยินจริง: TTS อังกฤษ |
| `vo_analyze` | ไม่มีไฟล์แพ็กเกจ; `speechSynthesis` | `voice` | ใช่: bed×0.45, life×0.6, hull×0.7, music×0.58 | ยังไม่ trigger; TTS ร่าง |
| `vo_max_depth` | ไม่มีไฟล์แพ็กเกจ; `speechSynthesis` | `voice` | ใช่: bed×0.45, life×0.6, hull×0.7, music×0.58 | ได้ยินจริง: TTS อังกฤษ |
| `vo_surface` | ไม่มีไฟล์แพ็กเกจ; `speechSynthesis` | `voice` | ใช่: bed×0.45, life×0.6, hull×0.7, music×0.58 | ได้ยินจริง: TTS อังกฤษ |
| `vo_complete` | ไม่มีไฟล์แพ็กเกจ; `speechSynthesis` | `voice` | ใช่: bed×0.45, life×0.6, hull×0.7, music×0.58 | ยังไม่ trigger; TTS ร่าง |
## การตรวจรับและผลทดสอบ

### Browser manual pass

- เปิด `?audio=debug`, กดเริ่มและเห็น preload 57/57; console `error`/`warn` ว่างตลอดรอบที่ตรวจ
- ทดลองสแกนด้วย 1: `scan_sweep` เริ่มก่อน, `sonar_idle` ตามหลัง, `scan_miss` มาหลัง sweep; ตรวจการหมุนทีละ 5°, เปลี่ยนโซนตื้น/กลาง/ลึก, descend/ascend, creak, whale และ `life_reef_glimpse`
- ทดสอบ H, 2/3 ขณะไม่มีตัวอย่าง, M mute/unmute และเพลง mute/unmute; M ทำให้ meter ลดลงเหลือราว −81.5 dBFS และไม่มีเสียงพากย์หลุดจาก mute
- ที่ depth 1.0 สังเกต `max_depth_warning` กับ `vo_max_depth`; กลับ 0 ได้ `zone_up`, `surface_break`, `vo_surface`, `music_home` และ bridge กลับ `music_invite`
- ค่าสูงสุดที่สังเกตได้ระหว่างรอบสั้นอยู่ราว −14.7 dBFS (ค่าที่แผงอ่านได้เปลี่ยนตามเสียงที่กำลังเล่น) และไม่พบ clipping ในตัวอย่างนี้; **ยังไม่ได้ stress test ที่บังคับเสียงทุกชั้นพร้อมกัน**, ทดสอบฟังคลิกครอสเฟดด้วยลำโพงจริง/โมโน หรือยืนยัน mix peak ที่ต่ำกว่า −1 dBFS
- เปิด `?live=1` โดยไม่มีบอร์ด: แสดง `BOARD DISCONNECTED`, ไม่มี console error; ไม่ได้ทดสอบการต่อ/ถอดบอร์ดจริง

### Static checks และ test suite

- ผ่าน `node --check twin/twin.js`, `node --check twin/renderer.js`, `node --check assets/audio/validate_catalog.mjs`
- ผ่าน `node assets/audio/validate_catalog.mjs`: 77 cue IDs และทุกไฟล์ที่ catalog อ้างมีอยู่; ไม่มี `new Audio()` และไม่มี path `temp/`/`legacy/` ใน runtime twin
- `pytest`: 124 passed, 22 subtests passed, 2 failed. `tests/test_luna06_display_reset.py::Luna06DisplayResetTests::test_only_enabled_faces_are_initialized` เป็นการตรวจ firmware ที่อยู่นอกขอบเขตและไม่ได้แก้; `tests/test_dashboard_core.py::AudioTests::test_current_catalog_references_eight_valid_wav_files` คาดว่า WAV เดิม `scan_miss.wav` เป็น stereo แต่ไฟล์นี้ mono (เล่นใน browser ได้). ไม่ได้เปลี่ยน firmware หรือ reprocess เสียงสำเร็จรูปเพื่อกลบผลดังกล่าว

## สิ่งที่ต้องแจ้งผู้ใช้ / peer reviewer

- Browser นี้ไม่มี voice ภาษาไทย; ระบบสลับเป็น `speechSynthesis` ภาษาอังกฤษจริงและ debug panel แสดง `Thai unavailable; English selected`. ต้องเลือกว่าจะสาธิตด้วยเสียงอังกฤษ หรือใช้เครื่อง/เสียงพากย์ไทยที่มีเสียงไทยจริง
- LUNA-12 ระบุ 15 บทพากย์ แต่ reference map และ catalog ปัจจุบันมี 14 IDs (`vo_welcome` … `vo_complete`); ผมไม่สร้างประโยคที่ 15 ขึ้นเอง
- ยังไม่ได้ทริกเกอร์ scan hit/known, collect สำเร็จ/ซ้ำ, analyze ที่มีตัวอย่าง, first discovery และ mission complete; ตารางแยกไว้ตามจริง ไม่ถือว่าเสียงเหล่านี้ผ่าน browser listening test
- ที่มาสื่อ: 6 cue มี CC0 metadata เดิมครบ; 31 ไฟล์จากเพื่อนยังไม่มี URL/ผู้สร้าง/ใบอนุญาต; 37 reference ของเพลงและ bridge ระบุ CC0 ตามภาคผนวกแต่ยังไม่มี URL/ชื่อ sample pack; อีก 46 reference ยังไม่ทราบต้นทาง. รวม 114 file references ที่ URL ยังเป็น TODO. `ATTRIBUTION.md`/`catalog.json` ไม่อ้าง license ที่ไม่ทราบว่า CC0

