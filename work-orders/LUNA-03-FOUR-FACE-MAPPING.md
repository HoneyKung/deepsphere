# Four-display physical mapping

SUPERSEDED: The user corrected this request to all SIX cube faces and confirmed the 50 x 50 mm face / centered 30 x 30 mm image. Follow LUNA-03-SIX-FACE-MAPPING.md instead; do not implement a four-face profile from this earlier brief.

## Latest user observations

- One display emitted a pop/burning smell and the user now reports that it no longer works. Exclude that unit from use. The user explicitly requests a four-display prototype now; do not assume why four rather than five.
- The replacement panel displays the single-panel diagnostic. With the module in the user's viewing position, the UP arrow points left, opposite the header side. This gives a module-relative orientation observation, not a confirmed world-space mounting angle.
- The user reports an image area of 30 x 30 mm and a 10 mm border on every side, with a printed frame already tried. Clarification is pending whether the border is measured from the active image or from the PCB. Only the first interpretation gives a 50 x 50 mm face and normalized image rectangle [0.2, 0.2, 0.8, 0.8]. Keep this provisional until answered.
- Clarification is pending whether the four displays are four selected surfaces on the original corner-mounted cube or an upright four-sided ring. Do not equate those geometries.

## Implementation work that can start now

1. Preserve the working single-display diagnostic and upload configuration until an explicit multi-display test is requested. Do not flash hardware in this work order. The verified pin map in the header/board.json is SCK12, MOSI11, RST10, DC9, CS {8,13,14,15,16,17}. faces.json still contains stale px=10/nx=12: reconcile it and add config consistency coverage rather than restoring the old pins.
2. Separate geometric surfaces from installed/enabled displays. Add an explicit four-display profile without deleting the existing cube's six geometric faces. In the tilted-cube case, select the actual intersected cube face first; if that surface has no display, the reticle is invisible and cannot yield a scan/collect hit. Never select the nearest enabled face to fill a missing surface. The actual four selected faces remain pending physical placement.
3. Support the screen's position and orientation in its physical face. Existing physical_face_uv handles an axis-aligned rectangle; mount_orientation rotates the whole assembly. A rectangle installed at an arbitrary in-plane angle needs an explicit angle/basis or corner coordinates and an inverse transform, not merely a larger bounding box. Use a simple affine rectangle transform if sufficient. Preserve full 240 x 240 pixels; do not black-mask the panel to imitate a physical bezel.
4. Keep LCD driver rotation (quarter turns), in-plane screen orientation, and global cube mount as distinct transforms and apply each once. Do not set rotation=1 or 3 merely from the word 'left' without a defined module reference. Document a face calibration reference showing header direction, pixel UP, and world UP.
5. Build a preview with face IDs, physical borders, image rectangles, a horizontal reference/grid and reticle. It must expose gaps and absent displays honestly. Scene rendering and reticle/hit testing must use the same physical coordinates. This work does not add camera tracking; no measured yaw is currently available.
6. Test affine forward/inverse round trips, offset/rotated rectangles, image edges, actual bezel gaps, absent faces, and a non-identity cube mount. Keep tests tied to behavior. Regenerate shared vectors and run Python/native/build checks affected by changes.

## Deliverables and scope

Implement the geometry/profile capability using explicit provisional fixtures while waiting for physical clarification. Do not label the user's complete four-face mounting as confirmed. Record assumptions and the small set of still-required measurements in output/luna-03-status.md; provide preview images. Continue addressing the previously reported UI defects, but prioritize a usable four-face geometry preview now. Do not reuse the old demo or introduce unrelated source documents. Retain keyboard 1/2/3 and Up/Down; no physical button wiring is required for this round.
