# Six-face cube mapping — authoritative corrected scope

This order supersedes LUNA-03-FOUR-FACE-MAPPING.md. The user corrected their request: calculate all six faces of the original cube, not a four-display ring or a four-face geometry.

## Confirmed dimensions

- Each physical cube face is 50 x 50 mm.
- Active image is 30 x 30 mm, centered in that face, leaving 10 mm on each side.
- Physical face coordinates for the image: x and y from 10 to 40 mm, or normalized rectangle left=0.2, top=0.2, right=0.8, bottom=0.8 on all six faces.
- Use normalized pixel coordinates: x_mm=10+30*u, y_mm=10+30*v; inverse u=(x_mm-10)/30, v=(y_mm-10)/30. Keep the existing pixel-center convention consistently in firmware and previews.
- These dimensions are user-reported confirmed geometry. They do not confirm individual screen mounting rotations, global mounting alignment, electrical wiring of all six screens, or display health.

## Required work

### Assembly convention chosen for the printed holders

The user is designing the holders with the same module placement on every face. Viewed from the display/image side, with that individual square holder's marked local UP edge at the top, the header is on the right. Pins run top-to-bottom: GND, VCC, SCL, SDA, RST, DC, CS, BL. Use this as the intended assembly constraint, not evidence that all units are already installed or calibrated. Local holder UP is not necessarily world vertical on the corner-mounted cube. Do not interpret a rear/PCB view as the front view. Label each holder/preview with its face ID and local UP; derive the required driver rotation or pixel transform from the observed diagnostic orientation and the face basis, applying it only once. Keep the user-tested diagnostic unchanged until preparing the next explicit scene test.

1. Retain all six cube surface bases and the original corner-mounted cube concept. Correct config/header physical rectangles to the confirmed dimensions, and replace contradictory 'all dimensions unmeasured' status with specific remaining uncertainties. Do not mark global mount or all wiring confirmed.
2. Calculate the background and inverse reticle mapping using each face's 3D basis, its centered image rectangle, and the whole-cube mount transform. A square viewed obliquely appears as a tilted quadrilateral; do not distort the logical panel into a guessed rectangle or simply rotate the panorama bitmap 45 degrees. Existing transforms may already suffice. Add arbitrary in-plane screen rotation only if a real mounting requirement establishes it, not speculative geometry support.
3. Keep LCD driver quarter-turn rotation separate from cube mount. User observed the diagnostic UP pointing left, opposite the connector side. Record that module-relative fact, but do not invent the final world orientation of all six panels. Provide a calibration preview/reference with face ID, connector edge, pixel UP and world UP.
4. Separate six geometric faces from enabled physical outputs. The user reports one dead panel and no spare. Do not choose the nearest live face when the actual intersected surface has no active screen: hide reticle/hit on the absent face. Which physical unit occupies each face is not confirmed yet. Preserve the working index-0-only diagnostic and do not flash or enable other outputs automatically.
5. Pin mapping is SCK12, MOSI11, RST10, DC9, six CS values {8,13,14,15,16,17}. Reconcile stale CS in faces.json with board.json/header and test agreement.
6. Produce a six-face net and an assembled-cube preview showing 50 mm face edges, 30 mm image openings, real gaps, face IDs, and a shared sea/grid reference. These are actual renderer/geometry previews, not decorative mockups. Label any unresolved mounting fixture explicitly. Scene, reticle and hit tests must share coordinates. No camera tracking is authorized by this order; yaw remains unsensed.
7. Run affected Python/native vector/config/build checks, including physical rectangle edges, forward/inverse mapping, gaps, absent outputs and non-identity cube mount. Update tests that previously asserted that physical rectangle dimensions must remain unmeasured. Do not weaken tests merely to pass.

Report in output/luna-03-status.md with preview paths and a precise distinction between dimensions confirmed, mounting still to calibrate, and hardware not yet tested. Keep keyboard 1/2/3 and Up/Down, existing audio and pending UI fixes. Do not import the old demo or unrelated project documents.
