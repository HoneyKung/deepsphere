# Filesystem assets

`platformio.ini` sets `data_dir = firmware/data`, so this folder becomes the LittleFS image.

Run `tools/generate_atlas.py`, copy `assets/generated/sea_atlas_rgb565_be.bin` here, then `pio run -t buildfs` to check the image builds and `pio run -t uploadfs --upload-port COMx` to flash it. The atlas is 1 MB and the `default.csv` partition table leaves 1.4 MB for the filesystem.

At boot the firmware loads the whole atlas into PSRAM in native byte order, then renders in 16-row stripes from that copy. It never allocates six display framebuffers. Without PSRAM it logs the fact and draws a diagnostic ramp rather than pretending to show the sea. Copying this file here does not enable hardware output; that still needs `kHardwarePinsConfirmed`. Set `kSingleDisplayTest` and `kSingleDisplayIndex` for the staged face-id, UP-arrow, and RGB-bars test; the default remains six-panel scene mode.
