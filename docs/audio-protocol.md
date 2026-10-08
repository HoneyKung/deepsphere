# สัญญาสื่อสารแผงควบคุมและเสียง v1

ESP32 กับแผงคอมใช้สัญญานี้ร่วมกัน ปุ่มที่ผู้ใช้ยืนยันคือ Scan / Collect / Analyze ส่วนล้อควบคุมความลึกและมุมหัน โดยกดล้อสลับหน้าที่ ชื่อไฟล์นี้คงไว้เพื่อให้ลิงก์ใบสั่งงานเดิมไม่ขาด แต่ครอบคลุมข้อมูลภาพตัวอย่างและแผงควบคุมด้วย

## ข้อมูลระหว่างบอร์ดกับคอม

- USB CDC, UTF-8 JSON หนึ่ง object ต่อบรรทัด จบด้วย newline จำกัดบรรทัดไม่เกิน 512 bytes
- ทุกข้อความจากบอร์ดมี v, type, session และ seq; session เปลี่ยนเมื่อบูตใหม่ seq เพิ่มต่อเนื่องใน session
- เลือก COM ในแผงคอม ตั้งค่าเครื่องมือเริ่มต้น 115200 โดยไม่อ้างค่านี้เป็นแบนด์วิดท์ภาพของ native USB
- Serial reader ทำงานไม่บล็อก UI ส่ง message ที่ parse แล้วเข้าคิวของแผง Parse error ให้ log และอ่านต่อ
- ข้อความ debug ใช้ type=log หรือแยกช่องทาง ไม่ใส่ข้อความเปล่าปะปน
- โปรแกรมแผงเดียวเป็นเจ้าของพอร์ตและ audio mixer ต้องปิดพอร์ตของแผงก่อนแฟลชหรือเปิด serial monitor
- ไม่ส่งภาพหกจอผ่าน USB คอมมี asset pack ชุดเดียวกับบอร์ดสำหรับสร้างภาพตัวอย่างจากตำแหน่งที่เก็บ

รอบต้นแบบนี้แผงคอมใช้ keyboard-first input: `1` = Scan, `2` = Collect, `3` = Analyze, `Up` = ตื้นขึ้น และ `Down` = ลึกลง โดยกดค้าง action ไม่ยิงซ้ำ และ depth clamp ที่ 0..1 ตาม config เมื่ออยู่ hardware mode คำสั่งจะส่งผ่าน USB ให้บอร์ดเป็นเจ้าของ state และ hit test; เมื่ออยู่ simulated mode ใช้ BoardSimulator ที่มี protocol เดียวกัน ปุ่มจริงและ KY-040 ไม่ต้องต่อเพื่อบูต demo

คำสั่งจากแผงคอม:

```json
{"v":1,"type":"command","action":"scan","request_id":"ui-1"}
{"v":1,"type":"depth_delta","delta_norm":-0.02,"request_id":"ui-2"}
```

บอร์ดตอบ `type=ack` พร้อม `request_id` และ `status=accepted|duplicate`; หลังจากนั้นบอร์ดส่ง `state` หรือ `event` ที่เป็นผลจริง คำสั่งซ้ำด้วย request_id เดิมไม่ทำ action ซ้ำ

## สถานะและตัวอย่าง message

ตัวอย่างค่าพิกัดและชื่อ target ต่อไปนี้เป็นข้อมูลจำลอง ต้องไม่แสดงเป็นผลวัดหรือชนิดสัตว์จริง

```json
{"v":1,"type":"hello","session":"b001","seq":0,"device":"deep-sphere-v1","inputs":"hardware","yaw_source":"encoder","asset_pack":"pack-001"}
{"v":1,"type":"state","session":"b001","seq":1,"depth_norm":0.35,"zone":"mid","yaw_deg":272.90,"aim_visible":true,"target_id":"luna04_manta_ray","inputs":"keyboard","yaw_source":"keyboard","wheel_role":"none"}
{"v":1,"type":"event","session":"b001","seq":2,"t_ms":5400,"name":"scan","result":"hit","target_id":"luna04_manta_ray","depth_norm":0.35}
{"v":1,"type":"event","session":"b001","seq":3,"t_ms":5900,"name":"scan","result":"miss","target_id":null}
{"v":1,"type":"event","session":"b001","seq":4,"t_ms":6400,"name":"collect","result":"candidate","sample_id":"b001-4","target_id":"luna04_manta_ray","asset_pack":"luna-04-ocean-atlas","depth_norm":0.35,"crop":{"u":0.32,"v":0.40,"w":0.12,"h":0.18}}
{"v":1,"type":"event","session":"b001","seq":5,"t_ms":6800,"name":"collect","result":"miss","reason":"no_target"}
{"v":1,"type":"event","session":"b001","seq":6,"t_ms":7100,"name":"analyze"}
```

`candidate` หมายถึงบอร์ดพบตัวอย่างที่เก็บได้ ยังไม่เท่ากับคอมบันทึกภาพสำเร็จ `reason` สำหรับ collect ที่ไม่สำเร็จเริ่มจาก no_target, reticle_gap หรือ scene_updating

`yaw_source` เป็น none หรือ encoder และ `wheel_role` เป็น depth หรือ yaw ทั้งสองค่าบอกแผงว่ามุมหันมาจากไหน แผงต้องแสดงตามที่บอร์ดบอก ไม่สรุปเองว่าเป็นการหมุนตัวลูกจริง ต้นแบบปัจจุบันไม่มีเซนเซอร์วัดการหมุน จึงเริ่มด้วย `yaw_source: none`, heading คงที่ และ input แบบ keyboard-first; ทาง KY-040 ยังมีไว้สำหรับรอบยืนยัน hardware ภายหลัง โดยรูปแบบ message ไม่ต้องเปลี่ยน

## การเริ่มเชื่อมและตรวจการบันทึก

คอมส่ง `{"v":1,"type":"get_state"}` หลังเชื่อมต่อ บอร์ดส่ง hello และ state ปัจจุบันกลับมา แม้คอมเปิดหลังบอร์ดบูตแล้วก็ตาม จากนั้นส่ง state เมื่อโซนเปลี่ยนหรือเป็นระยะไม่เกิน 5 ครั้ง/วินาที

ขั้น Collect บนคอม:

1. ตรวจ event ซ้ำด้วย `(session, seq)` และ sample_id
2. ตรวจ asset_pack ให้ตรงกับแพ็กในคอม ถ้าไม่ตรงแสดง asset_mismatch และไม่สร้างรูปหลอก
3. ตัดภาพตาม crop จาก atlas ที่ quantize ตรงกับบอร์ด แล้วบันทึก PNG และ metadata ลง `output/samples/`
4. เพิ่ม thumbnail ใหม่และเลือกตัวอย่างนั้นบนแผง ภาพต้องไม่เปลี่ยนตาม depth ปัจจุบันในอนาคต
5. บันทึกสำเร็จแล้วส่ง ACK และเล่น collect_success; ล้มเหลวแสดงเหตุผลและเล่น action_error

ตัวอย่าง ACK:

```json
{"v":1,"type":"collect_ack","session":"b001","sample_id":"b001-4","status":"saved"}
{"v":1,"type":"collect_ack","session":"b001","sample_id":"b001-4","status":"error","reason":"asset_mismatch"}
```

บอร์ดรอ ACK แบบไม่บล็อก หากไม่ได้ ACK ภายในเวลาที่ตั้ง เช่น 2 วินาที แสดงว่ายังไม่ได้ยืนยันการบันทึก ห้ามถือว่าการส่ง JSON สำเร็จเท่ากับภาพถูกเก็บบนคอม ไม่ต้องทำคิวเก็บย้อนหลังหรือ retry อัตโนมัติในขั้นแรก

## ข้อตกลง crop และตัวอย่าง

- crop.u และ crop.v คือพิกัดมุมซ้ายบน normalized ใน atlas; w และ h คือขนาด normalized ที่กำหนดไว้ใน target metadata ค่า u/v ใน `assets/source/targets.json` เป็นจุดกึ่งกลาง บอร์ดจึงต้องส่ง `u - w/2` และ `v - h/2` ไม่ใช่จุดกึ่งกลางดิบ
- `assets/generated/sea_atlas.png` ที่คอมใช้ตัดภาพ ถูก quantize เป็น RGB565 แล้วเหมือนไฟล์ .bin ของบอร์ด ภาพตัวอย่างจึงเป็นสีเดียวกับที่จอแสดง
- U วนกลับที่ขอบแนวนอน V clamp/pad ตามกติกาเดียวกับเครื่องมือสร้างภาพ ไม่อ่านนอกขอบ
- target_id, depth_norm และ crop เป็น snapshot ณ ตอนกด ไม่คำนวณจากสถานะล่าสุดเมื่อข้อความมาถึง
- sample_id ต้องไม่ชนกันแม้บอร์ดรีบูต; ตัวอย่างใช้ session-seq ได้เมื่อ session มีค่าไม่ซ้ำจริง
- คอมสร้างและเก็บภาพใหม่จากบริเวณ atlas ที่ระบุ ไม่ใช้แค่ภาพ stock ประจำ target_id ซึ่งอาจไม่ตรงกับตำแหน่งที่เก็บ
- ไฟล์ meta ของตัวอย่างเก็บ sample_id, target_id, depth_norm, asset_pack, crop และเวลารับบนคอม แยกเวลาบอร์ดออกจากเวลานาฬิกา

## พฤติกรรม Scan / Analyze

Scan hit แสดงผลสแกนบนแผงพร้อมข้อมูล target ที่มีอยู่ Scan miss แสดงว่าไม่พบ ไม่เอาตัวอย่างที่เก็บก่อนหน้ามาแสดงเป็นผลสแกนปัจจุบัน

Analyze ใช้ตัวอย่างที่ผู้ใช้เลือกในคลังบนคอม หรือชิ้นล่าสุดถ้าไม่มีการเลือก ไม่เปลี่ยนไปวิเคราะห์ปลาใต้เป้า ณ เวลานั้นโดยเงียบ ๆ ไม่มีตัวอย่างให้แสดงข้อความให้เก็บก่อนพร้อม action_error

ผล Analyze ขั้นแรกคือภาพที่เก็บ รหัส/ชื่อจาก metadata ระดับที่เก็บ และรายละเอียดที่มีแหล่งกำกับ ไม่ใช้ LLM ไม่แต่งคำอธิบายวิทยาศาสตร์ขึ้นเอง แผงโหลดคลังตัวอย่างกลับได้เมื่อเปิดใหม่

## ชื่อเสียง

| cue_id | trigger | วิธีเล่น |
|---|---|---|
| ambient_surface | zone=surface | loop |
| ambient_mid | zone=mid | loop |
| ambient_deep | zone=deep | loop |
| scan_hit | Scan hit | one-shot |
| scan_miss | Scan miss | one-shot |
| collect_success | คอมบันทึกภาพตัวอย่างสำเร็จ | one-shot |
| analyze_open | เปิดรายละเอียดตัวอย่างได้จริง | one-shot |
| action_error | Collect ไม่สำเร็จ หรือ Analyze ไม่มีตัวอย่าง | one-shot |

zone ใช้ depth_norm สำหรับงานศิลป์: surface < 0.25, mid < 0.65, ที่เหลือ deep ใส่ hysteresis ตอนเปลี่ยนโซน ตัวเลขนี้ไม่ใช่การแบ่งเขตทะเลเชิงวิทยาศาสตร์

Ambient crossfade เมื่อโซนเปลี่ยน ไม่ restart จาก state ซ้ำ แยกช่อง loop กับ interaction จำกัดเสียงซ้อน ป้องกัน event ซ้ำจาก session/seq และไม่ให้ทั้งผู้รับข้อความกับ UI เล่น cue เดียวกันสองครั้ง

พอร์ตหลุดให้แสดง disconnected และค่อย ๆ ลด ambience คลังภาพเดิมยังดูได้ เมื่อเชื่อมใหม่ขอ state ไม่เล่น event เก่าย้อนหลัง ไฟล์เสียงหายให้ log และข้าม ไม่ทำให้แผงภาพล้ม

## Catalog เสียง

`assets/audio/catalog.json` มี schema_version: 1 และ cues เป็น array รายการหนึ่งมีรูปแบบดังนี้:

```json
{
  "cue_id": "collect_success",
  "file": "collect_success.wav",
  "loop": false,
  "gain_db": -12,
  "source_url": "URL ต้นฉบับที่ดาวน์โหลดจริง",
  "creator": "ชื่อผู้สร้าง",
  "license": "ชื่อใบอนุญาตจริง",
  "license_url": "URL เงื่อนไขสิทธิ์",
  "attribution": "ข้อความเครดิตที่ต้องใช้",
  "processing": "การ trim/fade/resample ที่ทำจริง"
}
```

path ของ file สัมพันธ์กับ assets/audio/ ส่ง WAV PCM 16-bit 44.1 kHz stereo ค่า gain_db เป็นค่าตั้งต้นที่ต้องฟังรวม ไม่ได้บังคับ -12 dB ทุกเสียง ข้อมูลตัวอย่างเป็นคำอธิบาย schema ไม่ใช่เสียงที่ตรวจสิทธิ์แล้ว
