# Ocean artwork and asset pack

The user requests preparing the sea imagery now while they assemble the prototype. Lunar owns implementation and art production; Astra supplies direction and reviews. Work only in prototype-v1, using its current six-face geometry. Do not reuse the old demo. Do not flash the board or enable additional displays.

## Visual direction

Produce an original illustrated underwater panorama, readable on the real 30 mm / 240 x 240 displays. Aim for an atmospheric exploration game: clear animal silhouettes, layered water and restrained detail, rather than the current flat grid and yellow target circles. No diagnostic text, grid, crosshair, UI labels or target boxes baked into the shipping art. The reticle remains a separate firmware layer.

- Surface band: luminous blue-green water, soft light from above, distant reef/rock shapes and a few recognizable fish. Keep it underwater rather than a beach/sky scene.
- Middle band: deeper blue, larger areas of open water, subdued distant silhouettes and distinct subjects such as a ray, squid or jellyfish.
- Deep band: dark navy with visible tonal separation on a small backlit LCD, sparse marine-snow texture and restrained luminous accents. Do not make most of the panel unreadably black.
- Blend between depths continuously, with horizontal wrapping at the left/right seam. No vertical wrapping. Avoid visual clutter, tiny labels, dense bubbles or a harsh flat boundary across the middle.
- Create at least six distinct illustrated collectible subjects, roughly two per depth band. Keep their silhouettes identifiable in actual six-face 240 px previews, not only on a large master image. Label them with general descriptive names; do not invent exact species, depths, biological claims or imply that illustrations are actual photographs.

Use raster illustration generation through the imagegen skill/tool if available and useful for art quality, then prepare the assets reproducibly. Read the applicable skill before using it. Keep original source artwork. A code/SVG-native illustration approach is also acceptable if the delivered result has recognizable subjects and coherent art direction; do not deliver recolored circles as finished ocean art. Assets may use a higher-resolution master, but the device output remains 1024 x 512 RGB565 (1,048,576 bytes).

## Pipeline and interaction requirements

1. Inspect the current generator first: generate_atlas.py currently draws its own test scene and does NOT render sea_atlas.svg despite reporting the SVG as source. Replace this mismatch with a real authoritative art input/composition pipeline. Editing the unused SVG alone does not complete this task. The manifest must name the actual source files and reproducible conversion steps.
2. Keep background art and collectible placement coordinated. Generate targets.json bounds/crops from the actual composed subject positions, including seam wrapping. Ensure visible subjects and Scan/Collect hit regions match. Do not leave target_01/02/03 metadata pointing at empty water after replacing art.
3. Preserve one quantization path for both laptop PNG and board RGB565 bytes, and verify identical decoded pixels. Keep the file size within the existing flash/PSRAM budget. Update generated target headers and stage the matching binary into firmware/data through the documented build workflow.
4. Use a new consistent asset-pack ID for this content so old test-art firmware cannot silently collect from the new laptop atlas. Remove hardcoded test-pack assumptions where needed; update firmware, laptop, config and manifests together. Preserve previously saved sample PNGs/metadata; do not delete the user's collection or reinterpret old snapshots with new imagery.
5. Keep dimension/mount/active-output status accurate. Render geometry previews for all six faces and the corner-upright concept fixture without pretending all six physical outputs are enabled. No camera tracking or new rotation input is part of this art task.
6. Verify that planned demo subjects can actually be reached by the depth sweep on an explicitly documented fixed-heading/front-face fixture. Do not rely only on unreachable angular positions or secretly steer yaw. Any proposed scene-test setup stays separate from the current working diagnostic until the next hardware test is requested.
7. Audio remains the existing eight-cue catalog. No audio rebuild/download or changes to pin assignments, power assumptions, or keyboard 1/2/3 and Up/Down controls.

## Reviewable delivery

- Full panorama PNG and reproducible source/composition assets.
- Six-face net and corner-upright previews at shallow/mid/deep settings, plus several unscaled 240 x 240 face images to judge small-screen readability. Shipping artwork must not contain preview overlays.
- Actual laptop simulated Scan -> Collect -> Analyze using the new pack, showing an illustrated subject in the saved snapshot and correct descriptive metadata. Keep SIMULATED / NO BOARD visible in that test.
- Checks for seam behavior, RGB565/PNG agreement, new pack agreement, actual target crops/hits and preserved old samples. Run affected Python/native/build/buildfs checks once relevant code/assets are final; no physical flash.
- output/luna-04-status.md listing actual generated files, tests run and remaining visual/hardware checks. Send an early real art preview once available, then continue integration without waiting for approval on routine choices. Do not claim human listening or physical screen readability has been tested merely from screenshots.
