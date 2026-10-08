# LUNA-06 status

## Milestone A — shared reset and serial display diagnostic

Status: complete in source and build checks. No firmware was flashed and no new powered hardware test was performed.

- Current map remains SCK=12, MOSI=11, DC=9, RST=10, CS `{8,13,4,5,6,17}` with `nz` disabled.
- Boot now prepares every configured CS inactive HIGH, pulses the shared reset once, then constructs each enabled ST7789 with `rst=-1` so per-panel initialization cannot toggle the shared reset line.
- Serial commands `display_diagnostic` with a face id and `display_diagnostic_all` paint the enabled outputs without a second reset. Unknown, disabled, uninitialized and no-panel cases return bounded rejection acknowledgements.
- Laptop Settings keeps one-face and all-enabled diagnostic controls; the simulator mirrors accepted/rejected command behavior without opening another serial connection.
- `config/board.json` and `config/wiring-table.md` now mark five-panel supply adequacy unresolved. The prior 10 mA-per-panel reading is retained only as an unverified 10 A-range observation, not as a power justification. BL floating remains an observation, not a complete circuit specification.

Checks:

- Python: `79 passed` (one Pillow deprecation warning).
- Native geometry: `PASS: 1413 checks, 0 failures`.
- PlatformIO firmware build: success for `esp32-s3-zero`.
- PlatformIO LittleFS build: success; atlas file included.

Evidence type: source inspection and automated checks only. Physical five-panel stability and USB behavior remain pending a separately authorized powered test.

## Checkpoint B — planar live-ocean implementation in progress

Status: not complete yet; source is being preserved for the next focused review. This checkpoint is deliberately not a flash approval.

Working now:

- `config/live_ocean.json` defines a versioned renderer, seed, fixed tick and six bounded subjects on true face-local cube coordinates.
- `tools/live_ocean.py` advances subjects across exact cube edges by consuming distance to the edge and rotating the tangent across the shared hinge. It does not use panorama/equirectangular mapping for the live background or hit test.
- Firmware draws the depth-dependent procedural background from `{faceU, faceV}` with strip transfers, uses the same 8x8 mask/palette concept for scaled subject sprites, and restores moving subject/reticle dirty regions. `nz` remains absent from output and subjects disappear there until they re-emerge on an enabled face.
- Scan/Collect now use face-local moving poses. Collect carries `renderer`, `scene_version`, `scene_tick`, `face_id`, crop and a frozen snapshot; the laptop reconstructs the face-local crop with RGB565-quantized background and the shared sprite mask, preserving old atlas samples.
- `output/preview-live-ocean.gif` and 240 px face montage frames were generated from the new renderer and visually inspected.

Checks actually run at this checkpoint:

- Python: `86 passed`, one existing Pillow deprecation warning.
- Native cube geometry: `PASS: 1413 checks, 0 failures`.
- PlatformIO firmware build passed after planar motion and before the final scaled-mask edit; it must be rerun before handoff.
- LittleFS build passed previously and contains the preserved LUNA-04 atlas; it must be rerun with the final candidate as part of handoff.

Remaining blockers before B can be called ready:

- Rerun firmware and LittleFS builds after the final scaled sprite-mask changes.
- Add/finish a behavioral native regression that compares the C++ edge-fold pose against the Python pose across an edge crossing; current tests cover the Python route and source contract but do not yet execute the C++ live-motion routine.
- Perform one final simulated collect/capture check and report firmware/FS artifacts. No flash or physical powered test has been performed by this thread; Astra remains the sole flash owner.

## Checkpoint B - LUNA-06B finish (continued by Claude after Luna/Astra hit limits), 11 Sep 2026

Status: flashed to the board on COM6 at the user's authorization in LUNA-06B. Filesystem upload is
not needed: the new firmware never mounts or samples the old LUNA-04 atlas.

LUNA-06B items:

1. One sprite rule on both hosts: exact cardinal heading (no trig), floorf, lowest index on top for
   both drawing and hitting, sampled at the pixel centre under the reticle. `firmware/include/live_ocean_render.h`
   mirrors `tools/live_ocean.py`; the unrotated `target_for_uv` path is gone.
2. Sprites are composited with the water inside the existing stripe buffer (no per-pixel SPI). Dirty
   rectangles use the rotated bounds, old and new merged per face. Reticle erase repaints through the
   same composite, so it restores the animal under it.
3. Rotated half-extents stay below 0.2 face units; a sprite centred on a hinge has no pixel on either
   panel. The fish mask now has a forked tail and an eye hole; jellyfish and seahorse masks turned so
   the bell or head leads.
4. Collect freezes the shown tick and depth and sends a square crop in panel pixels; the laptop
   rebuilds those exact pixels (frame colour outside the opening). Depth is held at 4 decimals on
   both hosts. The firmware refuses a collect line over 511 bytes (`event_too_long`).
5. Preview montage: cut for the user's deadline. Not delivered in this checkpoint.
6. Native behavioural test `tests/native/test_live_ocean.cpp` runs the production motion, mask,
   background, dirty-rectangle and crop code against `tests/native/live_vectors_generated.h`
   (from `tools/make_live_vectors.py`).

Scene: `config/live_ocean.json` schema 2. Every animal's route passes the ny panel centre, where the
board's fixed reticle rests; five use the four enabled side faces, the seahorse the ny/pz/py/nz loop.
Background colours now follow depth continuously between three keyframes.

Checks run after the last source edit:

- Python: 93 passed
- Native: cube math PASS 1413 checks; live ocean PASS 2412 checks, background 343/343 bit-exact with Python
- Firmware build: SUCCESS, RAM 6.0%, Flash 24.3%
- Upload: firmware written, 4 of 4 regions hash-verified

Measured on the board over serial (not physical observation):

- hello reports panels `px,nx,py,ny,pz` initialized, scene_version 2
- live tick render max 147 ms against a 250 ms tick (393 ms before caching the water gradient)
- full five-panel repaint after a depth change 811 ms (2155 ms before)
- the orange reef fish and seahorse passed under the fixed reticle within the first 12 s

Remaining, not done or not verifiable from here:

- Nobody has confirmed with their eyes that five panels show the scene, in the right orientation.
- No bubbles/particles, and animals are not depth-band specific; the brief asked for both.
- The edge-crossing preview montage (item 5) was cut.
- Five-panel supply stability is still unmeasured; the shared-reset bug, not supply, explained the
  earlier one-panel symptom.
