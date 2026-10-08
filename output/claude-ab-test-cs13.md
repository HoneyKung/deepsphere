# A/B test: firmware with nx CS = GPIO13 (Claude, 2026-09-18)

The board currently runs a TEMPORARY build with nx CS = 13 and kButtonAnalyze = 3 (the config that
existed before Gemini's nx=3 change). Purpose: compare it with the nx=3 build under the same wiring.
Source was restored immediately after flashing: firmware/include/deep_sphere_config.h is back to nx = 3.
So the board does NOT match the source right now. Rebuild from source before trusting the board state.
Logs: output/claude-ab-cs13-build.log, output/claude-ab-cs13-upload.log
