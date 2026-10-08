# Audio asset handoff

The receiver is implemented before the licensed WAV set arrives. No old audio is used as fallback. Add only new 16-bit 44.1 kHz stereo WAV files and update `catalog.json` with verified source, creator, license, attribution, and processing fields. Missing cues are logged and skipped without crashing the dashboard.
