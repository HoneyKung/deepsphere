# Continue from LUNA-05: shared reset first, then live ocean

## Latest user instruction: planar cube surfaces and authorized upload

The user explicitly authorizes uploading to the connected board once the work is ready. Astra coordinates that upload; Lunar must not start a competing flash/serial process. This supersedes the no-automatic-upload condition below, while preserving actual test/measurement reporting.

The user rejects the old spherical/equirectangular artwork because subjects pinch toward the upper corner of the diamond-mounted cube. The new animated scene must use six connected PLANAR cube faces, not atan2/asin panorama texture sampling. Use the existing cube face bases and shared physical edges to transform moving subjects' position and tangent across faces. Keep subject dimensions in physical face units; split an edge-crossing subject over its adjacent faces as necessary. Do not use 2D net adjacency as a substitute for actual cube adjacency. The 10 mm frames and the absent nz output are occlusions, not excuses to teleport creatures to another live screen. The cube's mounting transform positions the surfaces; it must not squeeze the artwork into a spherical pole. Existing ray-to-cube reticle math can remain, but hit testing and frozen Collect reconstruction must refer to the new planar moving scene. Deliver actual motion, not a static replacement picture.

Astra reviewed LUNA-05 and the actual source on 11 September 2026. Lunar owns implementation; Astra reviews. This order supersedes the static-art deliverable direction in LUNA-04, using the updated prototype requirements reported in the handoff. Do not import unrelated project documents or delete existing saved samples.

## A. Highest priority: fix the shared-reset initialization bug

Evidence in the current files:

- firmware/src/main.cpp setupDisplays constructs every ST7789 with the same kRst=10 and immediately calls init in a loop.
- The installed Adafruit_ST7789::init calls commonInit -> begin -> Adafruit_SPITFT::initSPI.
- Adafruit_SPITFT.cpp around line 642 toggles _rst when _rst >= 0. Each panel initialization therefore resets every panel on the shared reset wire, including ones already initialized.
- The last enabled panel is pz/CS6, exactly the sole visible panel described in LUNA-05. This is a concrete software defect and a strong explanation of that symptom; it does not prove the cause of subsequent USB disconnects.

Initialize configured/connected CS outputs inactive before sending display commands. Perform the shared hardware reset once using the installed library/controller's appropriate timing, then construct each display with no individual hardware reset pin (rst=-1) and initialize it separately via its own CS. Check any software reset command remains addressed to one selected panel. Do not edit the vendored library or simply remove all reset handling. Preserve single-panel diagnostic support, disabled nz, and current pin map SCK12/MOSI11/DC9/RST10/CS {8,13,4,5,6,17}. GPIO4/5/6 are display CS now; never restore encoder polling on them. GPIO19/20 remain USB.

Add a serial diagnostic command that draws a distinct solid color, face ID and UP on one enabled panel at a time, then an all-enabled-panel pattern. It must not reset the other initialized panels, change pin mapping or require rebuilding for each face. Bound commands and acknowledge errors; unknown/disabled faces must not drive pins. Keep diagnostic controls available on the laptop without heavy repainting or stealing a second COM connection. Add useful boot/reset-reason and initialization-stage logging without serial blocking.

Run an appropriate regression check that exercises the actual initialization orchestration and catches a repeated shared reset clearing previously initialized panels, then firmware build and existing affected tests. Deliver this repair as a separate testable milestone before live-scene changes. Do not flash automatically in this order: five-panel supply stability is still unresolved and no new powered test is authorized by this handoff alone.

Correct the status narrative: prior single-panel success does not rule out shared wiring/fan-out or supply issues with five connected panels. The 10 mA-per-panel figure was read at insufficient meter resolution and must not remain the justification for five-panel power adequacy in board.json/docs. Keep it as an unverified earlier observation, without silently changing physical wiring. Current evidence that a backlight lights with BL floating is not a full circuit specification.

## B. Live procedural ocean after the repair milestone

Use the user's updated brief reported in LUNA-05: code-drawn depth-dependent ocean, distinct shallow/mid/deep appearances, moving recognizable animals and restrained bubbles/particles, and Scan/Collect working on their displayed moving positions. Keep free Up/Down depth and current 1/2/3 actions; preserve current Left/Right heading controls as documented in the latest code. No physical rotation sensor or camera tracking is present.

Architecture decisions:

- Preserve six-face geometry, measured 50/30/10 mm openings, mount handling, enabled-face masks, existing keyboard/serial fixes, sound catalog and sample persistence.
- A static atlas can technically support animated sprite overlays; do not claim otherwise. The reason for switching to a procedural background is the updated user brief. Avoid rewriting unrelated transport/UI or math to implement it.
- Start with a small bounded population of clearly readable code-drawn animals and deterministic motion. Use shared/versioned scene parameters, IDs and a fixed simulation tick/seed so firmware and laptop can reproduce a captured scene. Subjects must pass through visible/aimable regions during the demo; this needs an actual reachability check, not an assumption that animation automatically solves the problem.
- Draw only changed sprite/reticle/particle regions during steady depth, restoring the procedural background and ALL overlapping layers in those regions. Background changes with depth can use a coalesced, paced full repaint. Do not run per-pixel filesystem seeks or one SPI transaction per pixel. Use strip transfers and a measured render budget; full five-panel RGB565 output is 576,000 bytes, already 192 ms of raw transfer at 24 MHz before overhead. Do not promise frame rates without measuring.
- Keep expensive fixed geometry transforms out of the per-frame path when practical, with an explicit RAM/PSRAM budget. Preserve wrap at horizontal panorama seam and real gaps/absent faces.
- Scan must use the positions actually presented on the relevant display, not a newer simulation state. Collect freezes that same displayed scene/time/pose. Laptop must save the matching reconstructed crop, including relevant background/overlapping objects, not a static old atlas crop or the fish at its later position. Define and test a compact versioned capture snapshot within the protocol's message budget. Preserve old sample images and their original metadata; never reinterpret them with the new renderer.
- Keep biological metadata modest and descriptive; no fabricated species facts, exact habitat depths or claims that illustrations are real photos.
- Keep producer/preview math consistent with shared vectors and test moving-hit/capture agreement, seam crossing, overlaps/restoration and missing faces. Test reconnect/dedup with the latest transport fixes rather than reverting them.

Deliver an early preview/video of live motion and depth changes plus a simulated scan/collect capture from the actual new renderer, then a buildable candidate. Actual readability, five-panel FPS/power and scan timing on physical hardware remain pending measurement. Do not spend time polishing static artwork before the live prototype works.

## Reporting

Use output/luna-06-status.md. Report A separately as soon as the shared-reset repair and diagnostic command build/test successfully, then continue B. Clearly distinguish code inspection, automated test, simulated GUI, actual firmware upload and physical observations. Do not promote assertions in a handoff document into independently verified facts.

## Review refinement: bounded sprites behind physical frames

For this prototype, keep every rotated sprite half-extent below 0.2 face units (10 mm). At a true cube edge such sprites are completely occluded by the physical frames, so no visible cross-hinge fragment needs to be rasterized. Enforce and test that bound; retain exact surface motion and transported heading, correct physical size, and partial clipping at the window boundaries 0.2/0.8. Remove placeholder neighbor circles. This supersedes a requirement to implement a general visible cross-hinge splitter for arbitrary large sprites. Larger sprites or thinner frames would require the actual splitter later. Frozen Collect must still match the visible current renderer. This is an implementation simplification consistent with the user's measured hardware, not a change to six-face planar mapping.
