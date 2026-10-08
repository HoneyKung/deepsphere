# Atlas tools

`generate_atlas.py` composes the LUNA-04 raster master from `assets/source/sea_atlas_luna04_master.png` according to `assets/source/sea_atlas_luna04_composition.json`, resizes it to 1024x512, quantizes it to RGB565 once so the PNG the laptop crops from and the big-endian `.bin` the board reads are the same pixels, writes target metadata and `firmware/include/targets_generated.h`, and records byte hashes in `pack.json`.

`preview.py` renders six separate face previews from the same mapping functions and accepts `--yaw`, `--depth`, `--grid` and `--output`. It prints which target, if any, sits under the reticle, so a preview frame doubles as evidence for a heading. `--sweep N` writes N frames of a full turn into `output/preview-sweep/`; laid side by side they show the reticle crossing faces while the sea stays put, which is the whole point of the mapping.

`preview_cube.py --grid` writes the LUNA-03 six-face net, assembled-cube, corner-upright concept fixture, and module-calibration previews to `output/`. The net and assembled views use the configured face basis and physical dimensions; the assembled view maps the full 240x240 display texture into each configured opening and keeps the frame separate. The corner-upright image is a non-confirmed fixture for holder/concept work.

`make_vectors.py` writes `tests/vectors/cube_math_vectors.json` and the matching `tests/native/vectors_generated.h`. Both implementations are then held to that one file: `tests/test_atlas_math.py` checks the Python side, and `tests/native/run_native_test.py` compiles `firmware/src/math/cube_math.cpp` on the host and checks the C++ side. Re-run it after any change to `config/scene.json` or `config/faces.json`, or the two sides can drift apart without a test noticing.

The mapping contract lives in `atlas_math.py`. Two rules there are load-bearing:

- `background_uv()` takes no yaw. Turning the cube must not move the sea in the cube's own coordinates.
- the reticle's `atlas_uv` is `background_uv()` of the aim ray, which is exactly the pixel the renderer drew underneath it. Deriving a second UV from screen coordinates makes scanning read somewhere other than what the player sees.

Display-pixel UV and physical-face UV are separate. `physical_face_uv` rectangles map a complete 240x240 panel into a measured face opening; current values are fixtures only. `preview.py` uses inverse mapping for the reticle and does not paint a fake black bezel into the panel.
