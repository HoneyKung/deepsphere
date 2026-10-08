"""Deep Sphere V1 - build the eight audio cues from downloaded CC0 originals.

Reads only from assets/audio/originals/ and writes the eight cue WAV files into
assets/audio/. Output is WAV PCM 16-bit 44.1 kHz stereo throughout.

Every transformation applied here is what the "processing" field of catalog.json
describes. Run with no arguments:  python build_cues.py

Dependencies: numpy, scipy, soundfile.
"""

import json
import math
import os

import numpy as np
import soundfile as sf
from scipy import signal

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
ORIG = os.path.join(HERE, "originals")

# Mix targets. gain_db in the catalog is derived from these so that the console
# starts from a sane balance: interaction cues sit clearly above the bed.
AMBIENT_TARGET_RMS_DB = -32.0
# Interaction cues are aimed 8 dB above the bed on their loudest 300 ms, which
# keeps a button clear without making it jump out of the mix.
ONESHOT_TARGET_SHORT_TERM_DB = -24.0
ONESHOT_MAX_PEAK_DB = -8.0

# The three beds are written at a common in-file level so a receiver can swap
# between them without the file itself changing the balance.
AMBIENT_FILE_RMS_DB = -24.0
AMBIENT_FILE_PEAK_CEIL_DB = -3.0


# ----------------------------------------------------------------- primitives

def db_to_lin(d):
    return 10.0 ** (d / 20.0)


def lin_to_db(v):
    return 20.0 * math.log10(max(float(v), 1e-12))


def read_any(path):
    """Read to float64 stereo at the sample rate stored in the file."""
    x, sr = sf.read(os.path.join(ORIG, path), always_2d=True, dtype="float64")
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    elif x.shape[1] > 2:
        x = x[:, :2]
    return x, sr


def to_sr(x, sr, target=SR):
    if sr == target:
        return x
    g = math.gcd(int(sr), int(target))
    return signal.resample_poly(x, target // g, sr // g, axis=0)


def speed(x, k):
    """Play back k times faster: duration / k, spectrum shifted up by k."""
    if k == 1.0:
        return x
    return signal.resample(x, int(round(len(x) / k)), axis=0)


def butter(x, sr, fc, kind, order=4):
    fc = min(fc, sr * 0.49)
    b, a = signal.butter(order, fc / (sr / 2.0), btype=kind)
    return signal.filtfilt(b, a, x, axis=0)


def lp(x, sr, fc, order=4):
    return butter(x, sr, fc, "low", order)


def hp(x, sr, fc, order=2):
    return butter(x, sr, fc, "high", order)


def peak(x):
    return float(np.max(np.abs(x))) if len(x) else 0.0


def rms(x):
    return float(np.sqrt(np.mean(x ** 2))) if len(x) else 0.0


def norm_peak(x, target_db):
    p = peak(x)
    return x * (db_to_lin(target_db) / p) if p > 0 else x


def fade(x, sr, in_ms, out_ms):
    y = x.copy()
    n_in = min(int(sr * in_ms / 1000.0), len(y) // 2)
    n_out = min(int(sr * out_ms / 1000.0), len(y) // 2)
    if n_in > 1:
        y[:n_in] *= np.linspace(0.0, 1.0, n_in)[:, None] ** 0.5
    if n_out > 1:
        y[-n_out:] *= np.linspace(1.0, 0.0, n_out)[:, None] ** 0.5
    return y


def level(x, sr, window_s=0.35, ratio=0.55, knee_db=6.0):
    """Slow downward levelling, so a bed reads as continuous water.

    The wave recordings are beach material with hard crests. Left alone they
    poke out of a background bed. This tracks a slow RMS envelope and pulls the
    loud parts down by ratio, leaving the quiet parts untouched.
    """
    m = np.abs(x).mean(axis=1)
    n = max(4, int(sr * window_s))
    k = np.hanning(n)
    k = k / k.sum()
    env = signal.fftconvolve(m, k, mode="same") + 1e-9
    ref = float(np.median(env))
    over_db = 20.0 * np.log10(env / ref)
    over_db = np.maximum(over_db - knee_db, 0.0)
    gain = 10.0 ** (-(over_db * ratio) / 20.0)
    gain = signal.fftconvolve(gain, k, mode="same")
    return x * gain[:, None]


def soft_peak(x, thresh_db=-9.0, ceiling_db=-3.0):
    """Round off isolated sample spikes.

    The water recordings carry a handful of droplet transients that are far
    above the body of the bed. Peak normalising against them costs several dB
    of level across the whole file for a few thousandths of a percent of
    samples. This bends only what is over the threshold, smoothly, so the bed
    can sit at its intended level.
    """
    t, c = db_to_lin(thresh_db), db_to_lin(ceiling_db)
    a = np.abs(x)
    over = a > t
    if not over.any():
        return x
    room = c - t
    y = x.copy()
    y[over] = np.sign(x[over]) * (t + room * np.tanh((a[over] - t) / room))
    return y


def trim_silence(x, sr, thresh_db=-60.0, pad_ms=5.0):
    """Drop unintended silence at head and tail, keeping a small pad."""
    env = np.max(np.abs(x), axis=1)
    thr = db_to_lin(thresh_db)
    idx = np.where(env > thr)[0]
    if len(idx) == 0:
        return x, 0.0, 0.0
    pad = int(sr * pad_ms / 1000.0)
    a = max(0, idx[0] - pad)
    b = min(len(x), idx[-1] + pad)
    return x[a:b], a / sr, (len(x) - b) / sr


# --------------------------------------------------------------- loop helpers

def chain(clips, out_len, sr, xfade_s, rng, per_channel=True):
    """Concatenate clips end to end with equal-power crossfades.

    Produces a continuous texture of at least out_len samples. When per_channel
    is set, left and right get independent clip orders, which widens the image
    without comb filtering, because the material is uncorrelated water noise.
    """
    xf = int(sr * xfade_s)

    def one_channel(ch):
        buf = np.zeros(0)
        while len(buf) < out_len + xf:
            c = clips[rng.integers(len(clips))][:, ch % 2].copy()
            if len(c) < xf * 2 + 1:
                c = np.tile(c, int(np.ceil((xf * 2 + 1) / len(c))))
            if len(buf) == 0:
                buf = c
                continue
            n = min(xf, len(buf) // 2, len(c) // 2)
            fo = np.linspace(1.0, 0.0, n) ** 0.5
            fi = np.linspace(0.0, 1.0, n) ** 0.5
            head = buf[:-n]
            mixed = buf[-n:] * fo + c[:n] * fi
            buf = np.concatenate([head, mixed, c[n:]])
        return buf[: out_len + xf]

    if per_channel:
        left, right = one_channel(0), one_channel(1)
    else:
        left = right = one_channel(0)
    return np.stack([left, right], axis=1)


def sprinkle(bed, clip, sr, count, gain_db, rng, jitter_gain_db=4.0):
    """Drop count copies of clip into bed at random positions, faded in and out."""
    out = bed.copy()
    n = len(clip)
    if n < 8 or len(out) <= n:
        return out
    c = fade(clip, sr, 30.0, 120.0)
    for _ in range(count):
        pos = int(rng.integers(0, len(out) - n))
        g = db_to_lin(gain_db + float(rng.uniform(-jitter_gain_db, jitter_gain_db)))
        out[pos:pos + n] += c * g
    return out


def wrap_loop(x, sr, loop_s, xfade_s):
    """Fold the tail back over the head so the loop point is continuous.

    Needs loop_s + xfade_s of material. The returned block is exactly loop_s
    long and its end joins its own start with an equal-power crossfade.
    """
    n = int(sr * loop_s)
    xf = int(sr * xfade_s)
    if len(x) < n + xf:
        reps = int(np.ceil((n + xf) / len(x)))
        x = np.tile(x, (reps, 1))
    body = x[:n].copy()
    tail = x[n:n + xf]
    fo = (np.linspace(1.0, 0.0, xf) ** 0.5)[:, None]
    fi = (np.linspace(0.0, 1.0, xf) ** 0.5)[:, None]
    body[:xf] = body[:xf] * fi + tail * fo
    return body


def declick_loop_edge(x, sr, ms=3.0):
    """Remove any residual step at the wrap point with a tiny matched ramp."""
    n = max(2, int(sr * ms / 1000.0))
    step = (x[0] - x[-1]) / 2.0
    ramp = np.linspace(1.0, 0.0, n)[:, None]
    y = x.copy()
    y[:n] -= step * ramp
    y[-n:] += step * ramp[::-1]
    return y


def write16(path, x, sr=SR):
    x = np.clip(x, -1.0, 1.0)
    sf.write(path, x, sr, subtype="PCM_16")


# ------------------------------------------------------------------- measures

def measure(x, sr):
    m = x.mean(axis=1)
    f, p = signal.welch(m, sr, nperseg=min(8192, max(256, len(m) // 4)))
    tot = np.trapezoid(p, f) + 1e-20

    def band(lo, hi):
        k = (f >= lo) & (f < min(hi, sr / 2))
        return 100.0 * float(np.trapezoid(p[k], f[k])) / tot if k.sum() > 1 else 0.0

    return {
        "dur_s": round(len(x) / sr, 3),
        "peak_dbfs": round(lin_to_db(peak(x)), 2),
        "rms_dbfs": round(lin_to_db(rms(m)), 2),
        "centroid_hz": int(np.sum(f * p) / (np.sum(p) + 1e-20)),
        "pct_below_250hz": round(band(20, 250), 1),
        "pct_300hz_8khz": round(band(300, 8000), 1),
        "loop_sample_step": round(float(np.max(np.abs(x[0] - x[-1]))), 5),
    }


def seam_check(x, sr, frame_ms=10.0):
    """Is the loop join audible?

    Plays the loop twice back to back and compares the level change across the
    join with the level changes the material makes on its own. A join that sits
    inside the normal variation of the bed will not be heard as a seam.
    """
    y = np.concatenate([x, x], axis=0)
    m = np.abs(y).mean(axis=1)
    n = max(4, int(sr * frame_ms / 1000.0))
    fr = len(m) // n
    env = np.sqrt(np.mean(m[: fr * n].reshape(fr, n) ** 2, axis=1)) + 1e-9
    d = np.abs(np.diff(20.0 * np.log10(env)))
    j = len(x) // n
    win = d[max(0, j - 2): j + 2]
    jump = float(np.max(win)) if len(win) else 0.0
    others = np.delete(d, np.s_[max(0, j - 2): j + 2])
    p99 = float(np.percentile(others, 99))
    return {
        "sample_step": round(float(np.max(np.abs(x[0] - x[-1]))), 6),
        "join_jump_db": round(jump, 2),
        "material_p99_jump_db": round(p99, 2),
        "within_material_variation": bool(jump <= p99),
    }


# ------------------------------------------------------------------ ambiences

def load_water_clips():
    """The eight CC0 wave recordings, at 44.1 kHz, DC trimmed and level matched."""
    names = [
        "wave_01_cc0-11505__transitking__wavesound.flac",
        "wave_02_cc0-11505__transitking__wavesound.flac",
        "wave_03_cc0-11505__transitking__wavesound.flac",
        "wave_04_cc0-11505__transitking__wavesound.flac",
        "wave_01_cc0-18363__jasinski__alkaibeach.flac",
        "wave_02_cc0-18363__jasinski__alkaibeach.flac",
        "wave_03_cc0-18363__jasinski__alkaibeach.flac",
        "wave_04_cc0-18363__jasinski__alkaibeach.flac",
    ]
    out = []
    for n in names:
        x, sr = read_any(n)
        x = to_sr(x, sr)
        x = hp(x, SR, 35.0)
        x = x - x.mean(axis=0)
        r = rms(x.mean(axis=1))
        if r > 0:
            x = x * (db_to_lin(-26.0) / r)
        out.append(fade(x, SR, 15.0, 15.0))
    return out


def ocean_bed(name, speed_k):
    x, sr = read_any(name)
    x = to_sr(x, sr)            # 96 kHz to 44.1 kHz, pitch preserved
    x = speed(x, speed_k)       # speed change, spectrum shifted up by speed_k
    x = x - x.mean(axis=0)
    return x


def tile_to(x, n):
    return np.tile(x, (int(np.ceil(n / len(x))), 1))[:n]


def build_ambient_surface(water, rng):
    """Brightest bed. Water movement close above, not a beach.

    The top is rolled off at 4.2 kHz so the source stops reading as open-air
    surf, and the crests are levelled so the bed stays in the background.
    """
    bed = chain(water, int(SR * 33), SR, 1.4, rng)
    bed = lp(bed, SR, 4200.0)
    bed = hp(bed, SR, 70.0)
    # Two passes: a slow one for the swell, a fast one for individual crests.
    bed = level(bed, SR, window_s=0.30, ratio=0.65)
    bed = level(bed, SR, window_s=0.07, ratio=0.55, knee_db=4.0)
    deep = ocean_bed("underwater_or_space_engine_0.ogg", 3.0)
    deep = lp(deep, SR, 900.0)
    deep = tile_to(deep, len(bed))
    mix = bed + deep * db_to_lin(-11.0)
    b2, sr2 = read_any("bubbles-loop2-amp.wav")
    b2 = hp(to_sr(b2, sr2), SR, 180.0)
    b2 = lp(b2, SR, 5000.0)
    mix = sprinkle(mix, b2, SR, 5, -22.0, rng)
    loop = wrap_loop(mix, SR, 30.0, 2.5)
    return declick_loop_edge(loop, SR)


def build_ambient_mid(water, rng):
    """Denser and duller. The shifted ocean bed leads, water sits behind it."""
    deep = ocean_bed("underwater_or_space_engine_0.ogg", 3.0)
    deep = lp(deep, SR, 1500.0)
    bed = chain(water, int(SR * 29), SR, 1.8, rng)
    bed = lp(bed, SR, 1100.0)
    bed = hp(bed, SR, 60.0)
    bed = level(bed, SR, window_s=0.40, ratio=0.7)
    deep = tile_to(deep, len(bed))
    mix = deep * db_to_lin(-3.0) + bed * db_to_lin(-10.0)
    b1, sr1 = read_any("bubbles-loop1-amp.wav")
    b1 = lp(to_sr(b1, sr1), SR, 1800.0)
    mix = sprinkle(mix, b1, SR, 3, -26.0, rng)
    loop = wrap_loop(mix, SR, 26.0, 2.5)
    return declick_loop_edge(loop, SR)


def build_ambient_deep(water, rng):
    """Darkest and calmest. Enough presence left to carry a laptop speaker."""
    main = ocean_bed("underwater_or_space_engine_0.ogg", 3.0)
    main = lp(main, SR, 520.0)
    weight = ocean_bed("deep_rumble.ogg", 4.0)
    weight = lp(weight, SR, 320.0)
    n = max(len(main), int(SR * 27))
    main = tile_to(main, n)
    weight = tile_to(weight, n)
    bed = chain(water, n, SR, 2.6, rng)[:n]
    bed = lp(bed, SR, 420.0)
    bed = hp(bed, SR, 55.0)
    bed = level(bed, SR, window_s=0.50, ratio=0.75)
    mix = main * db_to_lin(-2.0) + weight * db_to_lin(-5.0) + bed * db_to_lin(-16.0)
    loop = wrap_loop(mix, SR, 24.0, 3.0)
    return declick_loop_edge(loop, SR)


# ------------------------------------------------------------------- oneshots

def build_oneshot(src, max_s=None, fade_in_ms=2.0, fade_out_ms=25.0):
    x, sr = read_any(src)
    x = to_sr(x, sr)
    x, head, tail = trim_silence(x, SR)
    if max_s is not None and len(x) > int(SR * max_s):
        x = x[: int(SR * max_s)]
        fade_out_ms = max(fade_out_ms, 60.0)
    # Offset is removed once the final segment is chosen: taking a segment out
    # of a file that was already centred leaves the segment off centre again.
    x = x - x.mean(axis=0)
    x = fade(x, SR, fade_in_ms, fade_out_ms)
    return norm_peak(x, -3.0), head, tail


def short_term_loudness_db(x, sr, window_s=0.30):
    """Loudest 300 ms of the cue.

    Whole-file RMS misjudges one-shots: a sparse cue like a readout sequence
    measures quiet and would then be pushed too loud. The loudest short window
    tracks how loud the cue actually lands.
    """
    m = x.mean(axis=1) ** 2
    n = max(4, int(sr * window_s))
    if len(m) <= n:
        return lin_to_db(math.sqrt(float(np.mean(m))))
    c = np.concatenate([[0.0], np.cumsum(m)])
    win = (c[n:] - c[:-n]) / n
    return lin_to_db(math.sqrt(float(np.max(win))))


# ----------------------------------------------------------------------- main

def main():
    rng = np.random.default_rng(20260910)
    water = load_water_clips()

    results = {}

    ambients = {
        "ambient_surface": build_ambient_surface(water, rng),
        "ambient_mid": build_ambient_mid(water, rng),
        "ambient_deep": build_ambient_deep(water, rng),
    }
    for cue, x in ambients.items():
        # Match the beds to each other by RMS, then back off if that would put
        # a crest above the ceiling.
        x = soft_peak(x, thresh_db=lin_to_db(rms(x.mean(axis=1))) + 14.0,
                      ceiling_db=lin_to_db(rms(x.mean(axis=1))) + 20.0)
        r = rms(x.mean(axis=1))
        if r > 0:
            x = x * (db_to_lin(AMBIENT_FILE_RMS_DB) / r)
        p = peak(x)
        if lin_to_db(p) > AMBIENT_FILE_PEAK_CEIL_DB:
            x = x * (db_to_lin(AMBIENT_FILE_PEAK_CEIL_DB) / p)
        write16(os.path.join(HERE, cue + ".wav"), x)
        m = measure(x, SR)
        m["gain_db"] = round(AMBIENT_TARGET_RMS_DB - m["rms_dbfs"], 1)
        m["crest_db"] = round(m["peak_dbfs"] - m["rms_dbfs"], 1)
        m["loop_seam"] = seam_check(x, SR)
        results[cue] = m

    oneshots = {
        "scan_hit": ("question_003.ogg", None),
        "scan_miss": ("question_004.ogg", None),
        "collect_success": ("confirmation_004.ogg", None),
        "analyze_open": ("UI_020.wav", 1.45),
        "action_error": ("minimize_008.ogg", None),
    }
    for cue, (src, cap) in oneshots.items():
        x, head, tail = build_oneshot(src, cap)
        write16(os.path.join(HERE, cue + ".wav"), x)
        m = measure(x, SR)
        st = short_term_loudness_db(x, SR)
        g = min(ONESHOT_TARGET_SHORT_TERM_DB - st, ONESHOT_MAX_PEAK_DB - m["peak_dbfs"])
        m["gain_db"] = round(g, 1)
        m["short_term_dbfs"] = round(st, 2)
        m["playback_peak_dbfs"] = round(m["peak_dbfs"] + g, 1)
        m["trimmed_head_s"] = round(head, 3)
        m["trimmed_tail_s"] = round(tail, 3)
        results[cue] = m

    with open(os.path.join(HERE, "build_report.json"), "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=1)

    for cue, m in results.items():
        print(f"{cue:16s} {m['dur_s']:6.2f}s pk{m['peak_dbfs']:6.1f} rms{m['rms_dbfs']:7.1f} "
              f"cen{m['centroid_hz']:5d}Hz  <250Hz {m['pct_below_250hz']:5.1f}%  "
              f"300-8k {m['pct_300hz_8khz']:5.1f}%  gain_db {m['gain_db']:+6.1f}  "
              f"loopstep {m['loop_sample_step']:.5f}")


if __name__ == "__main__":
    main()
