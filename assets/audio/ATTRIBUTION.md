# Deep Sphere audio credits

`sound-manifest.json` is the asset list for the Web Twin. `catalog.json` keeps the eight-entry `cues` contract used by the laptop dashboard and adds all 77 Web Twin entries under `twin_cues`, with files, bus, playback type, source status, and provenance status.

## Provenance that is recorded

The existing tool cues `scan_hit`, `scan_miss`, `collect_success`, `mission_complete`, `analyze_open`, and `action_error` retain the source and CC0 metadata already recorded in the catalog. `mission_complete.wav` is byte-for-byte identical to `collect_success.wav`.

The six music pieces use CC0 samples as stated by LUNA-12B. The sample pack names, creators, and URLs have not been recorded yet, so the catalog leaves those source URLs as TODO.

## Friend recordings needing attribution

The following 31 derived media files come from the recordings shared by the friend: `ambient_surface.wav`, `ambient_mid.wav`, `whale_distant.wav`, `sub_roomtone.wav`, 25 `hull_creak_N.wav` clips, `sonar_idle.wav`, and `scan_sweep.wav`. Their creator, source URL, and license are not yet known. The catalog uses `TODO จากเพื่อน` and `ไม่ทราบ ต้องตรวจก่อนเผยแพร่นอกห้องเรียน` for these entries.

Other audio files whose creator or source was not preserved in the manifest are marked TODO in `catalog.json`; no license is inferred. There are 83 such additional file references, including the song layers and bridge files whose CC0 sample sources still need to be named. The 14 narration cues currently use browser `speechSynthesis` drafts and have no packaged recordings.
