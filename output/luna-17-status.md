# LUNA-17 — สถานะส่งมอบ

วันที่ 2026-10-28 · สาขา `main` · ไม่มี commit หรือ push

## สรุป

- เพิ่ม firmware `base-io` สำหรับ ESP32 รุ่นปกติ ใช้ GPIO ตามใบงาน, debounce ปุ่ม, นับ KY-040 ครบหนึ่ง detent ต่อคลิก และส่ง event ทาง USB/UART2
- Bridge รับ `yaw`, `wheel`, `button`, `hello`; พอร์ต CP210x/CH340 ถูกจัดไว้ก่อนพอร์ต USB CDC ของ S3 และเมื่อรับ `hello` ของ `base-io` แล้วจะจำพอร์ตนั้นเป็นพอร์ตหลัก
- หน้า twin poll `/yaw` ช่องทางเดิม รับ input events พร้อม event ID; ล้อเพิ่มแรงผลักให้ motion ลื่นเดิมและอ่าน `wheel_depth_per_click` จาก config ปุ่ม Scan/Collect/Analyze เรียก action เดียวกับคีย์เดิม ปุ่มกดล้อบันทึก log
- สถานะ Git ก่อนเริ่ม: `main` ตาม `origin/main`; มีไฟล์แก้/ลบ/เพิ่มค้างอยู่ก่อนงานตามที่เห็นใน `git status` บันทึกก่อนเริ่ม ผมจำกัดการแก้ของงานนี้ตามรายการด้านล่าง และไม่ได้ commit/push

## ไฟล์ที่แก้ในงานนี้

| ไฟล์ | จุดเปลี่ยน |
|---|---|
| `firmware/src/base_io.cpp` | บรรทัด 5–151: ขา GPIO, quadrature 4 transitions/detent, debounce 35 ms, รวม wheel delta ในหน้าต่าง 20 ms, JSON events และ forward UART แบบคงข้อความ |
| `platformio.ini` | บรรทัด 146–155: เพิ่ม `[env:base-io]`, board `esp32dev`, ใช้เฉพาะ `base_io.cpp` |
| `config/controls.json` | บรรทัด 17–51: ขาล้อ/ปุ่ม, `wheel_depth_per_click=0.0166666667`, UART2 และค่า batch |
| `config/wiring-table.md` | บรรทัด 82–119: หัวข้อบอร์ดฐาน ตารางขา และผังสลิปริง 12 เส้น |
| `laptop/twin_bridge.py` | บรรทัด 33–40, 70–85, 118–153, 174–185, 253–285, 400–410: VID, event queue, hello/port preference และ query event cursor |
| `twin/twin.js` | บรรทัด 1331–1378, 1752–1767: ดึงค่าคลิกจาก controls config, consume event ID, ส่งแรง wheel เข้า motion และ route ปุ่ม |
| `tests/test_luna17_inputs.py` | เพิ่ม 4 bridge tests สำหรับ VID/order, input ปน yaw/บรรทัดเสีย, base hello และ event cursor |
| `tests/luna17_browser_checks.js` | เพิ่ม browser acceptance checks สำหรับ wheel motion, ปุ่ม Scan, ปุ่ม wheel, Arrow และ Numpad |
| `output/luna-17/base-io-build.log` | บันทึกผล build |
| `output/luna-17-status.md` | รายงานฉบับนี้ |

`platformio.ini` ถูกแก้ค้างอยู่ก่อนเริ่มงานด้วย งานนี้เพิ่มเฉพาะ block `base-io` ที่บรรทัด 146 เป็นต้นไป

## ขาบอร์ดฐาน

| อุปกรณ์ | ขา KY-040 หรือปุ่ม | GPIO | หมายเหตุ |
|---|---|---:|---|
| KY-040 | CLK | 32 | `INPUT_PULLUP`, quadrature |
| KY-040 | DT | 33 | `INPUT_PULLUP`, ต้องครบ 4 transitions จึงนับหนึ่ง detent |
| KY-040 | SW | 25 | ต่อ GND เมื่อกด, debounce 35 ms, log-only `button/wheel` |
| Scan | signal | 26 | อีกขาต่อ GND, active-low, debounce 35 ms |
| Collect | signal | 27 | อีกขาต่อ GND, active-low, debounce 35 ms |
| Analyze | signal | 13 | อีกขาต่อ GND, active-low, debounce 35 ms |
| UART2 ไปบอร์ดหมุน | RX | 16 | รับ JSON line แล้ว forward ออก USB โดยไม่แก้ข้อความ |
| UART2 ไปบอร์ดหมุน | TX | 17 | ส่ง button/wheel events กลับบอร์ดหมุน |
| USB ผ่าน USB-UART บน DevKit | `Serial` / UART0 | UART0 | 115200 baud; ไม่ใช้ GPIO1/3 เป็น I/O |

ขาที่ใช้ไม่ชน strapping GPIO0/2/5/12/15, flash GPIO6–11 หรือ input-only GPIO34–39; GPIO13/26/27 ใช้เป็น digital input และ firmware ไม่เปิด Wi-Fi

### ผังสลิปริง 12 เส้น

| เส้น | บอร์ดฐาน | บอร์ดหมุน | หน้าที่ |
|---:|---|---|---|
| 1 | 5V | 5V | จ่ายไฟ |
| 2 | 5V | 5V | จ่ายไฟ |
| 3 | 5V | 5V | จ่ายไฟ |
| 4 | GND | GND | กราวด์ร่วม |
| 5 | GND | GND | กราวด์ร่วม |
| 6 | GND | GND | กราวด์ร่วม |
| 7 | GPIO17 / UART2 TX | UART RX | event จากฐานไปบอร์ดหมุน |
| 8 | GPIO16 / UART2 RX | UART TX | yaw จากบอร์ดหมุนไปฐาน |
| 9 | สำรอง | สำรอง | ไม่ต่อ |
| 10 | สำรอง | สำรอง | ไม่ต่อ |
| 11 | สำรอง | สำรอง | ไม่ต่อ |
| 12 | สำรอง | สำรอง | ไม่ต่อ |

## ผลตรวจ

| คำสั่ง/รายการ | ผล |
|---|---|
| `PLATFORMIO_CORE_DIR=.platformio-core; python -m platformio run -e base-io --disable-auto-clean` | ผ่าน · Espressif 32 6.7.0, ESP32 Dev Module, toolchain `8.4.0+2021r2-patch5`; ใช้ของที่ติดตั้งไว้แล้ว ไม่มีการดาวน์โหลด |
| MD5 ของ `.pio/build/base-io/firmware.bin` | `10C48EF181BBDF944D74E8963A017A01` |
| ฟังก์ชันทดสอบใน `tests/test_luna17_inputs.py` และ `tests/test_luna13_bridge.py` ที่เรียกผ่าน Python `runpy` | ผ่านทั้งหมด 12 ฟังก์ชัน |
| `python -m pytest ...` | รันไม่ได้ เพราะ Python ปัจจุบันไม่มีโมดูล `pytest`; ใช้เรียก test functions โดยตรงแทน |
| `python -m json.tool config/controls.json` | ผ่าน |
| `python -m py_compile laptop/twin_bridge.py tests/test_luna17_inputs.py` | ผ่าน |
| `node --check twin/twin.js` และ `node --check tests/luna17_browser_checks.js` | ผ่าน |
| ตรวจสตริงเครื่องหมายคำถาม 4 ตัวติดกันในไฟล์งาน | พบ 0 จุด |
| browser acceptance | ยังยืนยันผ่านไม่ได้: headless run เรียก checks ก่อน async scene/config initialization จบ ทำให้ renderer และ keyboard listeners ยังไม่พร้อม; ไม่ดาวน์โหลด Three.js หรือเครื่องมือเพิ่มเพื่อลองซ้ำ |
| แฟลชบอร์ด | **ยังไม่ได้แฟลช** |

คำสั่ง build ที่ใช้จริง (เปิด PowerShell จาก root repository):

```powershell
$env:PLATFORMIO_CORE_DIR = (Join-Path (Get-Location) '.platformio-core')
python -m platformio run -e base-io --disable-auto-clean
```

คำสั่งแฟลชที่เจ้าของคัดลอกไปใช้ภายหลังได้ โดยแทน `COMx` ด้วยพอร์ตของบอร์ดฐาน:

```powershell
$env:PLATFORMIO_CORE_DIR = (Join-Path (Get-Location) '.platformio-core')
python -m platformio run -e base-io -t upload --upload-port COMx
```

## ไฟล์สำคัญที่ไม่ได้แก้ในงานนี้

- `firmware/src/main.cpp`, `firmware/src/demo_live_yaw.cpp`, `firmware/src/diag/`, `firmware/include/deep_sphere_config.h`
- `twin/renderer.js`, `twin/index.html`, และทุกไฟล์ใน `assets/audio/`
- ระบบ audio ใน `twin/twin.js`; การเปลี่ยนในไฟล์นั้นจำกัดอยู่ที่การรับ event จาก bridge และ input handler
- `README.md`, ไฟล์ work order อื่น และไฟล์เก่าที่มีสถานะเปลี่ยนก่อนเริ่มงาน

## สถานะฮาร์ดแวร์และรายการทดสอบของเจ้าของ

**ยังไม่ได้ลองหมุนล้อ/กดปุ่มจริง** และยังไม่ได้แฟลช ให้เจ้าของทดสอบกับบอร์ดฐานเมื่อพร้อม:

1. หมุนล้อ 1 คลิก แล้วดู `wheel.delta` เป็น `+1` หรือ `-1` หนึ่งครั้ง
2. หมุนเร็ว 1 รอบ แล้วตรวจว่าครบประมาณ 20 คลิกและความลึกเลื่อนไหล ไม่กระโดด
3. กด Scan, Collect, Analyze ทีละปุ่ม และตรวจว่าทำงานเหมือน Numpad 1/2/3
4. กดแต่ละปุ่มค้าง ตรวจว่ามี `down` ครั้งเดียวและ `up` เมื่อปล่อย
5. ทดสอบลูกศรและ Numpad เดิมทุกปุ่ม

## รอบแก้ 1 — ปิดประเด็น FIX FIRST (2026-10-28)

ผมตรวจและแก้ตาม `work-orders/LUNA-17-FIX-1.md` ครบแล้ว รายละเอียดในหัวข้อนี้เป็นผลล่าสุดและแทนค่าทดสอบกับ MD5 รอบก่อนหน้า

### รายการแก้

- `config/controls.json:18-39` คืนค่าคอนฟิกเดิมของบอร์ดหมุน โดยคง `wheel.depth_step_norm` ที่ `0.02` ให้ตรงกับ `kDepthStepPerDetent` และคืนคีย์ `buttons.analyze_recommended_alternative`; ค่าฐานบอร์ดอยู่ใต้ `base_board`
- `laptop/twin_bridge.py:117-181,296-311,418-423` เพิ่ม session ID และเลข event ล่าสุดใน snapshot, กำหนด ID ตามลำดับทับ ID ที่ติดมากับข้อความ, ปิด DTR สำหรับ CP210x/CH340 และคง DTR ของ S3; การอ่าน query `after` รองรับ URL query
- `twin/twin.js:1331-1380` poll ครั้งแรกเลื่อน cursor ไปยัง event ล่าสุดโดยไม่เรียก action เก่า และตั้ง cursor ใหม่เมื่อ session เปลี่ยนหรือเลขลำดับลดลงหลัง bridge เริ่มใหม่
- `firmware/src/base_io.cpp:13,56,91-111,148-166` ส่ง hello ซ้ำทุก 5 วินาที และนับ detent โดยยึดสถานะพัก `0b11` เพื่อช่วยกู้การนับเมื่อพลาด transition
- `twin/twin.js:1341-1345,1723-1760,1782-1791` อ่านระยะและทิศ wheel จาก `base_board`, ตั้งทิศหมุนตามเข็มให้ลดความลึก และสะสมคลิกที่เข้ามาเร็วไว้เป็น pending ระหว่างปรับความเร็วอย่างนุ่มนวล
- `tests/test_luna17_inputs.py:89-127` เพิ่มการตรวจ ID ที่ถูก override, cursor เมื่อ reload/restart และ DTR ของ CP210x, CH340 กับ S3
- `tests/luna17_browser_checks.js:1-54` ปรับ acceptance check ให้รอ `state.started` ก่อนตรวจ และตรวจการสะสมคลิกกับการเคลื่อนอย่างนุ่มนวล

### ผลตรวจและ build

| รายการ | ผล |
|---|---|
| `python -m unittest tests.test_config_agreement` | ผ่าน 16/16 |
| ฟังก์ชันทดสอบใน `tests.test_luna17_inputs` | ผ่าน 7/7 |
| ฟังก์ชันทดสอบใน `tests.test_luna13_bridge` | ผ่าน 8/8 |
| รวม bridge tests สำหรับ LUNA-17 | ผ่าน 15/15 |
| `py_compile`, `node --check` สำหรับ JavaScript ทั้งสองไฟล์ และตรวจ JSON | ผ่าน |
| PlatformIO `run -e base-io --disable-auto-clean` | สำเร็จ; `esp32dev`, Espressif 32 6.7.0, toolchain `8.4.0+2021r2-patch5`; ไม่ได้ดาวน์โหลดแพ็กเกจเพิ่ม |
| MD5 `.pio/build/base-io/firmware.bin` | `3971659E16390A1CE59100EA590101D7` |
| การแฟลชบอร์ด | ไม่ได้แฟลช |

บันทึก build อยู่ที่ `output/luna-17/base-io-build.log` ส่วน browser acceptance ให้รันในเบราว์เซอร์ที่เข้าถึง CDN ของ Three.js ได้: เปิด `http://127.0.0.1:8765/twin/index.html?live=1&acceptance=1`, เริ่ม dive แล้วรัน `tests/luna17_browser_checks.js` ใน DevTools สคริปต์จะรอจน `state.started` ก่อนตรวจ

**ข้อกำหนดบอร์ด:** ใช้โมดูล ESP32-WROOM ไม่ใช้ WROVER เพราะ PSRAM บน WROVER ใช้ GPIO16/17 ซึ่งสงวนไว้สำหรับ UART2

**โหมด input:** ล้อและปุ่มจาก bridge ทำงานเมื่อเปิด `?live=1` เท่านั้น


## รอบแก้ 2 — แก้ประเด็น FIX FIRST (2026-10-28)

ผมแก้ตาม `work-orders/LUNA-17-FIX-2.md` ภายในขอบเขตไฟล์ที่กำหนดแล้ว

### รายการแก้

- `tests/luna17_browser_checks.js:5-9` เปลี่ยนเงื่อนไขรอเริ่ม dive เป็น `typeof state !== 'undefined' && state.started` ไม่ตรวจ `window.state` เพราะ `state` เป็น binding ระดับบนสุดที่ไม่ได้อยู่บน `window`
- `tests/luna17_browser_checks.js:34-58` เพิ่ม regression check จำลอง gate ที่ยังปิด ตรวจว่า wheel impulse ถูกล้าง แล้วเปิด gate โดยไม่มีการเคลื่อนที่จากคลิกเก่า
- `tests/luna17_browser_checks.js:61-66` เพิ่ม check ว่ากด KeyR แล้วล้าง motion จาก wheel
- `twin/twin.js:1752-1763` เมื่อ `depthBlocked` ให้ล้าง `wheelDepthPending` และ `wheelDepthVel` พร้อมหยุด `depthVel` ป้องกันคลิกค้างถูกนำกลับมาใช้เมื่อ gate เปิด
- `twin/twin.js:1892` KeyR ล้าง `wheelDepthPending` และ `wheelDepthVel` เพิ่มจากการล้างความเร็วเดิม

### ผลตรวจรอบแก้ 2

| รายการ | ผล |
|---|---|
| `python -m unittest tests.test_config_agreement` | ผ่าน 16/16 |
| bridge tests จาก `tests.test_luna17_inputs` และ `tests.test_luna13_bridge` | ผ่าน 15/15 |
| `node --check twin/twin.js` | ผ่าน |
| `node --check tests/luna17_browser_checks.js` | ผ่าน |
| MD5 `.pio/build/base-io/firmware.bin` | `3971659E16390A1CE59100EA590101D7` ตรงกับรอบก่อน |

ไม่ได้แก้ firmware, ไม่ได้ build firmware รอบนี้ และไม่ได้แฟลชบอร์ด ตามใบงานระบุว่า browser test ให้หัวงานรันเอง
