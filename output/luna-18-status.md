# LUNA-18 Reset Probe Status

วันที่: 2026-10-28

## ผลงานและรอบแก้ 1

**build แล้ว ยังไม่ได้แฟลช ยังไม่ได้รันบนบอร์ด** ไม่มีการเรียก upload target

- แก้ปัญหา Serial ถูกอ่านจากสอง task: ลบ task อ่าน Serial ออกจาก `reset_probe.h`; panel รับ `r` ในตัวอ่านคีย์เดิม ส่วน live-yaw ตอบ `r` เฉพาะเมื่อเป็นบรรทัดเดี่ยวทั้งบรรทัด
- เพิ่ม `resetProbeTick()` และเรียกจาก loop ของทั้งสองโปรแกรม เพื่อให้การพิมพ์ซ้ำอยู่ใน task หลักเดียวกับ yaw/diagnostic และไม่แทรกกลางบรรทัด
- เปลี่ยนไปใช้ `rtc_get_reset_reason()` จาก SDK โดยตรงผ่าน `#include <esp32s3/rom/rtc.h>`; ลบ wrapper ที่บังชื่อ API ออก
- การตรวจข้อ 5: ทดลองใช้ env ใหม่ที่สืบทอด `lib_deps` ปกติแล้ว PlatformIO พยายามดาวน์โหลดไลบรารีและล้มเหลว (`HTTPClientError`) จึงคง `lib_extra_dirs = .pio/libdeps/panel-one` เพื่อ reuse ไลบรารีในเครื่องโดยไม่ติดตั้งหรือดาวน์โหลดเพิ่ม
- env เดิมไม่ได้แก้ และไม่ได้แฟลช

## Build และ MD5 หลังแก้

build ผ่านครบทั้งสี่ env ด้วย Arduino-ESP32 2.0.16 / esptool 4.5.1:

| Environment | MD5 ของ `firmware.bin` |
|---|---|
| `panel-one` | `4BD14CFA499CBCD0E942925E1BD3D472` |
| `live-yaw` | `170635F648A5A9B45AFD0ED69B6360D4` |
| `panel-one-noreset` | `4BD14CFA499CBCD0E942925E1BD3D472` |
| `live-yaw-noreset` | `170635F648A5A9B45AFD0ED69B6360D4` |

ตรวจ merged config แล้ว env ใหม่ทั้งสองตั้ง `board_upload.after_reset = no_reset`; builder นำค่านี้ไปใส่ใน esptool `--after`. ไม่ได้เรียก upload target เพราะเป็นการแฟลชจริง ไม่มี dry-run upload ใน PlatformIO ที่ติดตั้ง

## Bridge

จำลอง `type=boot` ผ่าน `_process_line` ใน `output/luna-18/simulate_bridge_boot.py`: ได้ `(False, False)`, parse error = 0 และไม่มี stdout/แจ้งเตือน จากนั้นบรรทัด yaw ยังได้รับการประมวลผลและอัปเดต state ได้ รายละเอียดอยู่ใน `output/luna-18/bridge-simulation-result.json`

## ไฟล์และบรรทัดที่แก้

- `firmware/include/reset_probe.h`: ใช้ SDK API ที่บรรทัด 6 และ 87–88; `resetProbeRequest()`/`resetProbeTick()` บรรทัด 74–84; ไม่มี task อ่าน Serial
- `firmware/src/diag/panel_one.cpp`: รับ `r` บรรทัด 145; เริ่ม probe ใน setup บรรทัด 159; เรียก tick ใน loop บรรทัด 170
- `firmware/src/demo_live_yaw.cpp`: รับบรรทัด `r` ตรงตัวบรรทัด 43–46; เริ่ม probe ใน setup บรรทัด 72; เรียก tick ใน loop บรรทัด 82
- `platformio.ini`: env noreset เริ่มบรรทัด 135 และ 141; ตั้ง `no_reset` บรรทัด 139 และ 143; คงการชี้ไปยังไลบรารีในเครื่องบรรทัด 138 เนื่องจาก registry ใช้ไม่ได้
- `output/luna-18-status.md`: รายงานนี้

## ไฟล์ที่ไม่ได้เปลี่ยน

ไม่ได้แก้ `laptop/twin_bridge.py`, `twin/`, `config/`, `firmware/include/deep_sphere_config.h`, `firmware/src/main.cpp`, `firmware/src/diag/panel_check.cpp`, SDK `reset_reasons.h` หรือ env เดิมใน `platformio.ini`. สถานะเปลี่ยนที่มีอยู่ก่อนเริ่มงานคงเดิม ไม่มี commit หรือ push

## ขั้นตอนทดสอบสำหรับเจ้าของ

แทน `COMx` ด้วยพอร์ตของบอร์ด และปิด serial monitor, bridge, Arduino IDE ก่อนเริ่มช่วงรอ:

```powershell
$port = 'COMx'
.\.venv-validation\Scripts\pio.exe run -e panel-one-noreset -t upload --upload-port $port
```

1. หลังแฟลชเสร็จ ถอดสาย USB แล้วเสียบใหม่หนึ่งครั้ง เพื่อเปิดไฟใหม่และเริ่มตัวนับ
2. ปิดทุกโปรแกรมที่ใช้พอร์ต แล้วรอ 66 วินาที:

```powershell
Start-Sleep -Seconds 66
```

3. เปิด monitor พิมพ์ `r` แล้วกด Enter จากนั้นส่งบรรทัด `boot` ที่ได้กลับมา:

```powershell
.\.venv-validation\Scripts\pio.exe device monitor --port $port --baud 115200
```

ใช้ `live-yaw-noreset` แทน `panel-one-noreset` ได้

## เกณฑ์อ่านผล

| ค่า | ความหมายตามเกณฑ์ล่วงหน้า |
|---|---|
| `boots_since_power_on` = 1 | ไม่มีรีเซ็ตเพิ่มในช่วงที่ไม่มีใครเปิดพอร์ต |
| มากกว่า 1 และ history มี `0x15` หรือ `0x16` | รีเซ็ตจาก USB |
| history มี `0x17` | ไฟกระตุก |
| history มี `0x0F` | ไฟตก |
