"""Sampled instruments from VSCO-2-CE (CC0). Nearest sample + pitch shift, sustain-looping for winds/strings."""
import os, re, glob, math
from fractions import Fraction
from synth_kit import *

INSTR = os.path.join(ROOT, "instruments")
_N = {"C": 0, "D": 2, "E": 4, "F": 6 - 1, "G": 7, "A": 9, "B": 11}
_RE = re.compile(r"_([A-G])(#?)(\d)(?=_|\.|$)")

def parse_midi(fn):
    m = _RE.search(fn)
    if not m: return None
    return 12 * (int(m.group(3)) + 1) + {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[m.group(1)] + (1 if m.group(2) else 0)

def _shift(x, ratio):
    if abs(ratio - 1) < 1e-4: return x
    fr = Fraction(ratio).limit_denominator(240)
    return ss.resample_poly(x, fr.denominator, fr.numerator)

class Bank:
    def __init__(self, folder, kind, gain=1.0, max_shift=4.0):
        self.kind, self.gain, self.max_shift = kind, gain, max_shift
        self.items = []
        for f in sorted(glob.glob(os.path.join(INSTR, folder, "*.wav"))):
            mi = parse_midi(os.path.basename(f))
            if mi is None: continue
            x, sr = sf.read(f); x = x.mean(1) if x.ndim > 1 else x
            if sr != SR: x = ss.resample_poly(x, SR, sr)
            a = np.abs(x); on = int(np.argmax(a > a.max() * 0.03)); x = x[max(0, on - int(0.004 * SR)):]
            seg = x[: int(0.8 * SR)]; r = math.sqrt(np.mean(seg ** 2)) or 1e-6
            self.items.append((mi, x * (db(-20) / r) * gain))
        if not self.items: raise RuntimeError("no samples in " + folder)

    def play(self, midi, dur, rel=0.25):
        mi, x = min(self.items, key=lambda it: abs(it[0] - midi))
        y = _shift(x, 2 ** ((midi - mi) / 12))
        n = int(dur * SR)
        if self.kind == "perc":           # decays by itself; just cut at dur
            y = y[:n]
        else:                             # sustained: loop the steady part if the sample is shorter than the note
            if len(y) < n:
                a = int(len(y) * 0.35); body = y[a:]; xf = int(0.18 * SR); out = y.copy()
                while len(out) < n and len(body) > 2 * xf:
                    w = np.linspace(0, 1, xf)
                    out = np.concatenate([out[:-xf], out[-xf:] * (1 - w) + body[:xf] * w, body[xf:]])
                y = out
            y = y[:n]
        return fade(y, 0.002, min(rel, dur * 0.6))

BANKS = {}
def bank(name):
    if name not in BANKS:
        cfg = {"piano": ("piano", "perc", 1.0), "harp": ("harp", "perc", 1.0), "flute": ("flute", "sus", 1.5), "oboe": ("oboe", "sus", 1.5),
               "cello": ("cello", "sus", 1.3), "violin": ("violin", "sus", 1.3), "glock": ("glock", "perc", 0.45), "marimba": ("marimba", "perc", 0.9)}[name]
        BANKS[name] = Bank(cfg[0], cfg[1], cfg[2])
    return BANKS[name]

hz2m = lambda f: 69 + 12 * math.log2(f / 440)
def piano(f, dur=2.5): return bank("piano").play(round(hz2m(f)), min(dur, 4.0), 0.35)
def harp(f, dur=3.0): return bank("harp").play(round(hz2m(f)), min(dur, 4.0), 0.3)
def flute(f, dur, **k): return bank("flute").play(round(hz2m(f)), dur, 0.25)
def oboe(f, dur): return bank("oboe").play(round(hz2m(f)), dur, 0.25)
def strings(f, dur, **k):
    m = round(hz2m(f)); return bank("cello" if m < 59 else "violin").play(m, dur, 0.3)
def glock(f, dur=3.0): return bank("glock").play(round(hz2m(f)), min(dur, 3.0), 0.4)
def marimba(f, dur=1.0): return bank("marimba").play(round(hz2m(f)), min(dur, 1.4), 0.15)
def glassS(f, dur=3.0):   # soft glass-harmonica feel: glockenspiel body with a slow synthesized swell underneath
    sw = partials(f, dur, [(1, 1, dur * 0.5), (2, 0.15, dur * 0.3)], atk=0.05)
    g = glock(f, dur); g = np.pad(g, (0, max(0, len(sw) - len(g))))[: len(sw)]
    return g * 0.5 + 0.6 * sw
