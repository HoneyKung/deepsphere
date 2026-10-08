"""Candidate sounds for Deep Sphere round 2 (generated locally, no external audio).
Everything here is original synthesis or processing of the CC0 files already in assets/audio/temp.
"""
import os, sys, math
import numpy as np, soundfile as sf
from scipy import signal as ss

SR = 44100
ROOT = r"C:\Users\Acer\Downloads\oceanX\prototype-v1\assets\audio\temp"
OUT = os.path.join(ROOT, "synth")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(20261002)

mf = lambda m: 440.0 * 2 ** ((m - 69) / 12)

def T(d): return np.arange(int(d * SR)) / SR
def db(x): return 10 ** (x / 20)
def peak_db(x): return 20 * math.log10(max(np.max(np.abs(x)), 1e-9))
def rms_db(x): return 20 * math.log10(max(math.sqrt(np.mean(x ** 2)), 1e-9))

def stereo(x, pan=0.0):
    """mono -> (n,2), pan -1..1 constant power"""
    a = (pan + 1) * math.pi / 4
    return np.stack([x * math.cos(a), x * math.sin(a)], 1)

def lp(x, fc, order=2):
    sos = ss.butter(order, fc, "low", fs=SR, output="sos")
    return ss.sosfilt(sos, x, axis=0)
def hp(x, fc, order=2):
    sos = ss.butter(order, fc, "high", fs=SR, output="sos")
    return ss.sosfilt(sos, x, axis=0)
def bp(x, lo, hi, order=2):
    sos = ss.butter(order, [lo, hi], "band", fs=SR, output="sos")
    return ss.sosfilt(sos, x, axis=0)

def fade(x, fin=0.005, fout=0.05):
    x = x.copy(); n = len(x)
    a = min(int(fin * SR), n); b = min(int(fout * SR), n)
    if a: x[:a] *= (np.linspace(0, 1, a) ** 2).reshape((-1,) + (1,) * (x.ndim - 1))
    if b: x[-b:] *= (np.linspace(1, 0, b) ** 2).reshape((-1,) + (1,) * (x.ndim - 1))
    return x

def partials(f, dur, parts, atk=0.004):
    tt = T(dur); y = np.zeros_like(tt)
    for r, a, dec in parts:
        if f * r < SR / 2.2:
            y += a * np.sin(2 * np.pi * f * r * tt + rng.uniform(0, 6.28)) * np.exp(-tt / dec)
    y *= np.minimum(1, tt / atk)
    return y

# ---- instruments (mono) ----
def kalimba(f, dur=2.0):
    y = partials(f, dur, [(1, 1, 0.9), (2.0, 0.22, 0.45), (5.4, 0.3, 0.06), (8.2, 0.08, 0.03)])
    n = int(0.012 * SR); y[:n] += 0.12 * rng.standard_normal(n) * np.linspace(1, 0, n)
    return fade(y, 0.002, 0.2)
def bell(f, dur=3.5):
    y = partials(f, dur, [(1, 1, dur * 0.42), (2.76, 0.45, dur * 0.22), (5.4, 0.25, dur * 0.12), (8.93, 0.12, dur * 0.07), (3.0, 0.2, dur * 0.3)])
    return fade(y, 0.003, 0.3)
def glass(f, dur=3.0):  # smooth, pure, slow-ish attack
    y = partials(f, dur, [(1, 1, dur * 0.5), (2, 0.18, dur * 0.3), (3, 0.08, dur * 0.2), (4.1, 0.04, dur * 0.1)], atk=0.02)
    return fade(y, 0.02, 0.3)
def harp(f, dur=3.0):
    y = partials(f, dur, [(1, 1, 1.6), (2, 0.5, 0.9), (3, 0.28, 0.55), (4, 0.15, 0.35), (5, 0.07, 0.2)], atk=0.003)
    return fade(y, 0.002, 0.3)
def marimba(f, dur=1.0):
    y = partials(f, dur, [(1, 1, 0.3), (4, 0.28, 0.07), (10, 0.08, 0.03)], atk=0.002)
    return fade(y, 0.001, 0.1)
def pad(f, dur, atk=3.0, rel=3.0, bright=1.0):
    tt = T(dur); y = np.zeros_like(tt)
    for d in (-0.003, 0.0, 0.003):
        ff = f * (1 + d)
        y += np.sin(2 * np.pi * ff * tt) + 0.28 * bright * np.sin(2 * np.pi * 2 * ff * tt) + 0.1 * bright * np.sin(2 * np.pi * 3 * ff * tt)
    e = np.minimum(1, tt / atk) ** 2 * np.minimum(1, (dur - tt) / rel) ** 2
    return y * e / 3
def choir(f, dur, atk=1.5, rel=2.0):
    tt = T(dur); y = np.zeros_like(tt)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * tt) * np.minimum(1, tt / 1.5)
    ph = np.cumsum(2 * np.pi * f * vib / SR)
    for k in range(1, 24):
        fk = f * k
        if fk > 5000: break
        a = math.exp(-((fk - 380) / 160) ** 2) + 0.55 * math.exp(-((fk - 850) / 220) ** 2) + 0.02
        y += a / k ** 0.3 * np.sin(k * ph + k)
    e = np.minimum(1, tt / atk) ** 2 * np.minimum(1, (dur - tt) / rel) ** 2
    return y * e

# ---- space ----
def make_ir(rt=3.5, lowcut=5000, seed=1):
    r = np.random.default_rng(seed); n = int(rt * SR); tt = np.arange(n) / SR
    ir = r.standard_normal((n, 2)) * np.exp(-tt / (rt / 6.9))[:, None]
    ir = lp(ir, lowcut); ir[: int(0.015 * SR)] *= np.linspace(0, 1, int(0.015 * SR))[:, None]
    return ir / np.sqrt(np.sum(ir ** 2, 0, keepdims=True)) * 0.9
IR_S, IR_M, IR_L = make_ir(2.0, 6000, 1), make_ir(3.5, 5000, 2), make_ir(6.0, 4000, 3)
def reverb(x, ir, wet=0.35):
    if x.ndim == 1: x = stereo(x)
    w = np.stack([ss.fftconvolve(x[:, c], ir[:, c]) for c in (0, 1)], 1)
    out = np.zeros_like(w); out[: len(x)] += x * (1 - wet); out += w * wet * 2.2
    return out

def place(buf, sig, t0, gain=1.0, pan=0.0):
    s = stereo(sig, pan) if sig.ndim == 1 else sig
    i = int(t0 * SR)
    if i < 0: s = s[-i:]; i = 0
    if i >= len(buf) or len(s) == 0: return
    j = min(len(buf), i + len(s))
    buf[i:j] += s[: j - i] * gain

def norm(x, peak=-3.0):
    return x * (db(peak) / max(np.max(np.abs(x)), 1e-9))
def set_rms(x, target, peak_cap=-3.0):
    g = db(target) / max(math.sqrt(np.mean(x ** 2)), 1e-9)
    y = x * g
    if peak_db(y) > peak_cap: y = y * db(peak_cap) / np.max(np.abs(y))
    return y

def trim_tail(x, rel_db=-48, pad=0.12):
    a = np.abs(x).max(1) if x.ndim > 1 else np.abs(x)
    thr = a.max() * db(rel_db)
    idx = np.nonzero(a > thr)[0]
    end = min(len(x), (idx[-1] if len(idx) else len(x)) + int(pad * SR))
    return fade(x[:end], 0.0, 0.12)

def write(name, x, peak=-3.0, rms=None, trim=True):
    x = x[:, None] if x.ndim == 1 else x
    if x.shape[1] == 1: x = np.repeat(x, 2, 1)
    if trim: x = trim_tail(x)
    x = set_rms(x, rms, peak) if rms is not None else norm(x, peak)
    sf.write(os.path.join(OUT, name + ".wav"), x.astype(np.float32), SR, subtype="PCM_16")
    return name

def loopify(x, total, tail):
    """fold the reverb tail back over the head so the loop is seamless"""
    out = x[:total].copy(); t = x[total: total + tail]
    out[: len(t)] += t
    return out
