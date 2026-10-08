# Wiring table — LUNA-07, 17 September 2026

## Current six-panel bring-up

Six ST7789 240x240 panels are available. Main firmware `esp32-s3-zero` runs
`kPanelSweepTest = true` and initializes all six CS lines at the existing 4 MHz sweep
clock. The ocean mask remains `true,true,true,true,true,false` pending bring-up.
Physical controls remain disabled; Scan/Collect/Analyze use the laptop numpad.

Use **ESP32-S3-Zero 3V3** for all display VCC pins and common GND. **MP1584 is not
connected for this test. Never join the outputs of two supplies.** BL stays unconnected.
Unplug power before adding, removing or swapping any panel.

| Board GPIO / rail | Connection | Shared? | Status |
|---|---|---|---|
| GPIO12 | All display SCL / SCK | yes | SPI clock |
| GPIO11 | All display SDA / MOSI | yes | SPI data, not sensor I2C SDA |
| GPIO10 | All display RST | yes | shared reset |
| GPIO9 | All display DC | yes | data/command |
| GPIO8 | Panel 1 `px` CS | no | existing assignment |
| GPIO3 | Panel 2 `nx` CS | no | moved from GPIO13; confirmed usable by the user |
| GPIO4 | Panel 3 `py` CS | no | existing assignment |
| GPIO5 | Panel 4 `ny` CS | no | existing assignment |
| GPIO6 | Panel 5 `pz` CS | no | existing assignment |
| GPIO7 | Panel 6 `nz` CS | no | replaces old GPIO17 placeholder; not spare or Analyze |
| GPIO17 | none | no | old nz placeholder retired; not assigned as a spare |
| GPIO1 | AS5600 SDA | reserved | next phase; LUNA-07 must not drive it |
| GPIO2 | AS5600 SCL | reserved | next phase; LUNA-07 must not drive it |
| GPIO13 | none | no | no signal observed; do not use until it is confirmed whether the GPIO or solder point is faulty |
| ESP32 3V3 | All six display VCC | yes | sole display supply; six-panel capacity unverified |
| ESP32 GND | All display GND | yes | common ground |
| Display BL / BLK | leave unconnected | per panel | working module arrangement |

No spare pin is assigned (`kSparePin = -1`), and no alternative Analyze GPIO is assigned.
The legacy Scan=1 and Collect=2 constants remain in the firmware but do not authorize wiring
buttons or enabling physical control polling. Analyze is unassigned (`-1`) because GPIO3 is nx
CS. GPIO1/2
are reserved for AS5600. There is no sensor driver in this work order.
The KY-040 remains disconnected; its old GPIO4/5/6 now carry display CS.

GPIO19/20 remain USB, GPIO0 BOOT, GPIO21 onboard RGB, and GPIO33–37 PSRAM.
GPIO14/15/16 were previously dropped because their pads were inaccessible to the user.

## Pin measurement in sweep mode

Use one serial client at 115200 baud, DTR=1 and RTS=0. Check the current COM port
before every upload or monitor connection. Send compact JSON, one command per line:

```json
{"type":"command","action":"hold_pin","pin":7}
{"type":"command","action":"scan_shorts"}
{"type":"command","action":"resume_sweep"}
```

`hold_pin` stops painting, releases SPI and holds only the selected signal high;
all other test signals are low. Allowed GPIOs are **12,11,9,10,8,3,4,5,6,7**.
GPIO1/2 and other unrelated pins are rejected. `hold_pin` with `pin:-1` also resumes.
`scan_shorts` temporarily tests the same signals, then restores the held pin if
one was held, or reinitializes all six panels and resumes painting otherwise.
Other display commands are rejected during bring-up so they cannot disturb a hold.

Measure at the display end of the wire. Module pull-ups, especially RST, can read
high without a short; scan results alone do not prove a wiring short.

## Evidence and remaining checks

The user previously obtained a working single-panel image after replacing faulty
jumper wires and breadboard contacts. See `docs/display-bringup-findings.md` for
dated history; older GPIO17, five-panel and MP1584 plans are superseded here.
The sixth panel and CS7 assignment were confirmed by the user on 17 September.
The current session starts with USB connected and **no displays attached**.

Six-panel power adequacy remains unverified. The earlier 0.01 A measurement on a
10 A range is too coarse to establish it. Check voltage at the furthest panel with
all six lit; current measurements use the mA range. If laptop USB is unstable, move
the board's USB cable to a wall charger and record visual results without serial logs.

Pass requires six panels lit together, correct colors, and five minutes of changing
patterns without a dark panel, corruption or reboot. A serial init log alone does
not establish that any physical panel lit.
