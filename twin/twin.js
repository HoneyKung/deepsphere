// Twin audio, HUD and controls; geometry and rendering live in renderer.js.
'use strict';

// ---------------------------------------------------------------- audio (manifest-driven Web Audio)

const AUDIO_DIR = '../assets/audio/';
const BUS_NAMES = ['bed', 'hull', 'life', 'tool', 'voice', 'music', 'hand'];
const VOICE_VOLUME_KEY = 'deepSphereVoiceVolume';

function savedVoiceVolume() {
  try {
    const value = window.localStorage.getItem(VOICE_VOLUME_KEY);
    const parsed = Number(value);
    if (value !== null && Number.isFinite(parsed)) return Math.max(0, Math.min(100, Math.round(parsed)));
  } catch (_) {}
  return 100;
}

const BUS_DEFAULTS = { bed: 0.42, hull: 0.28, life: 0.58, tool: 0.72, voice: 1, music: 1, hand: 0.6 };
const audio = {
  manifest: null, context: null, master: null, analyser: null, buses: {}, buffers: new Map(),
  beds: new Map(), active: new Set(), activeCues: new Map(), recent: [],
  lastFile: new Map(), lastCueAt: new Map(), ducks: new Map(), duckId: 0,
  muted: false, musicEnabled: true, volume: 0.85, currentAmbient: null,
  clock0: null, handNotes: true, zoneTimer: 0, lifeTarget: -1,
  previousLifeCue: '', lastLifeAt: 0, lifeTrack: null, scanTimer: 0, sonarUntil: 0, debug: false,
  debugInterval: 0, yawProgress: 0, lastClickAt: 0, lastScanResult: 0,
  voiceLanguage: 'en', voiceAvailable: { th: false, en: false }, voiceVolume: savedVoiceVolume(), speakToken: 0,
  eventTimer: null, eventPillTimer: 0, priorityEvent: '', priorityRank: 0, lastPriorityAt: 0,
  depthMotionTimer: 0, lastAscendAt: 0, boardConnected: false
};

const VOICE_LINES = {
  vo_welcome: { th: 'ปิดฝาเรียบร้อย ทุกระบบพร้อม เริ่มดำลงได้', en: 'Hatch sealed. All systems ready. Beginning our descent.' },
  vo_zone_mid: { th: 'ผ่าน 760 เมตรแล้ว แสงจากผิวน้ำลงมาไม่ถึงตรงนี้', en: 'Passing 760 metres. Sunlight does not reach this far.' },
  vo_zone_deep: { th: 'ต่ำกว่า 1,976 เมตร แสงเดียวที่เหลือคือแสงจากสิ่งมีชีวิต เปิดไฟส่อง', en: 'Below 1,976 metres. The only light down here is made by living things. Floodlights on.' },
  vo_scan_hit: { th: 'มีสัญญาณสิ่งมีชีวิตในเป้าเล็ง', en: 'Life signal in the reticle.' },
  vo_scan_miss: { th: 'ไม่มีสัญญาณ ตรงนี้มีแต่น้ำ', en: 'No signal. Open water.' },
  vo_on_frame: { th: 'เป้าเล็งอยู่บนขอบจอ หมุนต่ออีกนิด', en: 'The reticle is on the frame. Turn a little further.' },
  vo_collect: { th: 'เก็บตัวอย่างเข้าถาดแล้ว', en: 'Sample secured.' },
  vo_duplicate: { th: 'ตัวนี้อยู่ในถาดแล้ว', en: 'Already in the tray.' },
  vo_nothing: { th: 'ไม่มีอะไรในเป้าให้เก็บ', en: 'Nothing in the reticle to collect.' },
  vo_tray_empty: { th: 'ถาดยังว่าง ลองเก็บตัวอย่างก่อน', en: 'The tray is empty. Collect a sample first.' },
  vo_analyze: { th: 'วิเคราะห์เสร็จ พบ {names}', en: 'Analysis complete: {names}.' },
  vo_max_depth: { th: 'ถึงความลึกสูงสุด 3,040 เมตร แรงดันมากกว่าที่ผิวน้ำกว่า 300 เท่า', en: 'Maximum depth, 3,040 metres. Over 300 times the pressure at the surface.' },
  vo_surface: { th: 'ขึ้นถึงผิวน้ำแล้ว', en: 'We have reached the surface.' },
  vo_complete: { th: 'เก็บครบทั้งแปดตัวอย่าง ภารกิจสำเร็จ', en: 'All eight samples collected. Mission complete.' }
};

const VOICE_SPECIES = {
  shoal: 'ฝูงปลาผิวน้ำ', reef: 'ปลาแนวปะการังสีส้ม', seahorse: 'ม้าน้ำ',
  manta: 'กระเบนราหู', lantern: 'ปลาตะเกียง', jelly: 'แมงกะพรุน',
  angler: 'ปลาตกเบ็ดทะเลลึก', squid: 'หมึกยักษ์ทะเลลึก'
};

const AUDIO_EVENT_LABELS = {
  zone_enter_mid: 'Level 2 · Shipwreck shelf',
  zone_enter_deep: 'Level 3 · Volcanic vents',
  zone_up: 'Heading back up',
  scan_hit: 'Life detected',
  first_discovery: 'New species found',
  collect_success: 'Sample collected',
  mission_complete: 'Mission complete',
  max_depth_warning: 'Warning: maximum depth'
};

function showAudioEvent(cueId) {
  if (AUDIO_EVENT_LABELS[cueId]) showPill(AUDIO_EVENT_LABELS[cueId], 2800);
}

function showPill(text, ms) {
  const pill = $('audio-event-pill');
  const label = $('audio-event-label');
  if (!text || !pill || !label) return;
  clearTimeout(audio.eventPillTimer);
  label.textContent = text;
  pill.hidden = false;
  pill.classList.remove('show');
  void pill.offsetWidth;
  pill.classList.add('show');
  audio.eventPillTimer = window.setTimeout(() => {
    pill.classList.remove('show');
    window.setTimeout(() => { pill.hidden = true; }, 220);
  }, ms || 2800);
}

function audioLog(cueId, source, detail) {
  if (source === 'loaded' || detail === 'loaded') return;
  const entry = { cueId, source, detail: detail || '', time: new Date().toLocaleTimeString() };
  audio.recent.unshift(entry);
  audio.recent.length = Math.min(audio.recent.length, 20);
  if (source !== 'loaded') showAudioEvent(cueId);
  if (audio.debug) renderAudioDebug();
}

function initAudio() {
  const response = fetch(AUDIO_DIR + 'sound-manifest.json', { cache: 'no-cache' });
  audio.debug = new URLSearchParams(location.search).get('audio') === 'debug';
  const panel = $('audio-debug');
  if (panel) panel.hidden = !(audio.debug && new URLSearchParams(location.search).get('panel') === '1');
  if (audio.debug && !audio.debugInterval) audio.debugInterval = window.setInterval(renderAudioDebug, 250);
  const toggle = $('audio-music-toggle');
  if (toggle) toggle.addEventListener('click', toggleMusic);
  const volume = $('audio-volume');
  if (volume) volume.addEventListener('input', () => {
    audio.volume = Number(volume.value) / 100;
    setMasterGain();
  });
  ['voice-volume', 'audio-voice-volume'].forEach((id) => {
    const input = $(id);
    if (input) input.addEventListener('input', () => setVoiceVolume(input.value));
  });
  setVoiceVolume(audio.voiceVolume, false);
  const language = $('audio-language');
  if (language) language.addEventListener('change', () => {
    audio.voiceLanguage = language.value;
    updateVoiceAvailability();
  });
  const ping = $('audio-sonar-toggle');
  if (ping) ping.addEventListener('change', () => {
    audio.continuousSonar = ping.checked;
    scheduleContinuousSonar();
  });
  const dismissEvent = $('audio-event-dismiss');
  if (dismissEvent) dismissEvent.addEventListener('click', () => {
    clearTimeout(audio.eventPillTimer);
    const pill = $('audio-event-pill');
    if (pill) { pill.classList.remove('show'); pill.hidden = true; }
  });
  if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = updateVoiceAvailability;
    window.setTimeout(updateVoiceAvailability, 500);
  }
  return response.then((r) => {
    if (!r.ok) throw new Error('Sound manifest: ' + r.status);
    return r.json();
  }).then((manifest) => {
    if (manifest.schema !== 2 || !manifest.sfx || !manifest.music) throw new Error('Unsupported sound manifest');
    audio.manifest = manifest;
    updateVoiceAvailability();
    renderAudioDebug();
    return manifest;
  });
}

function updateVoiceAvailability() {
  const voiceList = 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
  const voiceFiles = audio.manifest && audio.manifest.voice || {};
  audio.voiceAvailable.th = Object.values(voiceFiles).some((entry) => entry && entry.th) || voiceList.some((voice) => /^th(?:-|$)/i.test(voice.lang));
  audio.voiceAvailable.en = Object.values(voiceFiles).some((entry) => entry && entry.en) || voiceList.some((voice) => /^en(?:-|$)/i.test(voice.lang));
  if (!audio.voiceAvailable.th && audio.voiceLanguage === 'th' && audio.voiceAvailable.en) audio.voiceLanguage = 'en';
  const label = $('audio-voice-status');
  if (label) {
    label.textContent = audio.voiceAvailable.th ? 'Thai voice available' :
      audio.voiceAvailable.en ? 'Thai files unavailable; English selected' : 'No Thai or English voice found';
  }
  const language = $('audio-language');
  if (language) {
    const thai = language.querySelector('option[value="th"]');
    if (thai) {
      thai.disabled = !audio.voiceAvailable.th;
      thai.hidden = !audio.voiceAvailable.th;
    }
    if (!audio.voiceAvailable.th && language.value === 'th') language.value = 'en';
    if (language.value !== 'off') language.value = audio.voiceLanguage;
  }
}

function setVoiceVolume(value, persist) {
  const volume = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  audio.voiceVolume = volume;
  ['voice-volume', 'audio-voice-volume'].forEach((id) => {
    const input = $(id);
    if (input && Number(input.value) !== volume) input.value = String(volume);
  });
  ['voice-volume-value', 'audio-voice-volume-value'].forEach((id) => {
    const output = $(id);
    if (output) output.textContent = volume + '%';
  });
  if (audio.context) applyBusGain('voice', 0.05);
  if (persist !== false) {
    try { window.localStorage.setItem(VOICE_VOLUME_KEY, String(volume)); } catch (_) {}
  }
}

function ensureAudioGraph() {
  if (audio.context) return;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) throw new Error('This browser does not support Web Audio.');
  audio.context = new Context();
  audio.master = audio.context.createGain();
  audio.analyser = audio.context.createAnalyser();
  audio.analyser.fftSize = 1024;
  for (const name of BUS_NAMES) {
    const gain = audio.context.createGain();
    audio.buses[name] = gain;
    gain.connect(audio.master);
    gain.gain.value = BUS_DEFAULTS[name];
  }
  audio.master.connect(audio.analyser);
  audio.analyser.connect(audio.context.destination);
  applyBusGain('voice', 0);
  setMasterGain();
}

function setMasterGain() {
  if (!audio.master || !audio.context) return;
  const now = audio.context.currentTime;
  audio.master.gain.cancelScheduledValues(now);
  audio.master.gain.setTargetAtTime(audio.muted ? 0 : audio.volume, now, 0.025);
}

function busDuckFactor(busName) {
  let factor = 1;
  for (const duck of audio.ducks.values()) factor = Math.min(factor, duck[busName] || 1);
  return factor;
}

function applyBusGain(busName, duration) {
  const node = audio.buses[busName];
  if (!node || !audio.context) return;
  const musicMute = busName === 'music' && !audio.musicEnabled ? 0 : 1;
  const voiceLevel = busName === 'voice' ? audio.voiceVolume / 100 : 1;
  const value = BUS_DEFAULTS[busName] * busDuckFactor(busName) * musicMute * voiceLevel;
  const now = audio.context.currentTime;
  node.gain.cancelScheduledValues(now);
  node.gain.setTargetAtTime(value, now, duration || 0.09);
}

function duck(busFactors, durationMs, reason) {
  const token = ++audio.duckId;
  audio.ducks.set(token, busFactors);
  BUS_NAMES.forEach((name) => applyBusGain(name, 0.08));
  if (durationMs > 0) window.setTimeout(() => {
    audio.ducks.delete(token);
    BUS_NAMES.forEach((name) => applyBusGain(name, 0.35));
  }, durationMs);
  return token;
}

function setParam(param, value, seconds) {
  if (!audio.context) return;
  const now = audio.context.currentTime;
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, Math.max(0.015, (seconds || 0.1) / 3));
}

async function loadBuffer(path) {
  if (!audio.context) ensureAudioGraph();
  if (audio.buffers.has(path)) return audio.buffers.get(path);
  const decode = (file) => fetch(AUDIO_DIR + file).then((r) => {
    if (!r.ok) throw new Error(file + ': ' + r.status);
    return r.arrayBuffer();
  }).then((bytes) => audio.context.decodeAudioData(bytes));
  // The hosted page carries a compressed MP3 copy of every recording (tools/make_web_audio.py). WAV originals are
  // large, so their copy is tried first; the music is already compact OGG, so its copy is only the fallback for
  // browsers that cannot decode OGG.
  const web = audio.manifest && audio.manifest.web;
  const copy = web && web.files && web.files[path] ? web.dir + web.files[path] : '';
  const order = !copy ? [path] : /\.ogg$/i.test(path) ? [path, copy] : [copy, path];
  const promise = decode(order[0]).catch((error) => { if (order[1]) return decode(order[1]); throw error; });
  audio.buffers.set(path, promise);
  try {
    const buffer = await promise;
    audio.buffers.set(path, buffer);
    return buffer;
  } catch (error) {
    audio.buffers.delete(path);
    throw error;
  }
}

function uniquePaths(paths) { return Array.from(new Set(paths.filter(Boolean))); }

function requiredSessionPaths() {
  const sfx = audio.manifest.sfx;
  const paths = [];
  for (const id of ['ambient_surface', 'sub_roomtone', 'scan_sweep', 'dive_start', 'turn_periscope']) {
    if (sfx[id]) paths.push(...sfx[id].files);
  }
  const files = audio.manifest.music.invite.files;
  paths.push(files.pad, files.lead, files.motion, files.sparkle);
  return uniquePaths(paths);
}

async function loadBackground() {
  const sfx = audio.manifest.sfx;
  const paths = [];
  const stems = (piece) => {
    const files = audio.manifest.music[piece] && audio.manifest.music[piece].files;
    if (files) paths.push(files.pad, files.lead, files.motion, files.sparkle);
  };
  stems('shallow');
  for (const id of ['scan_hit', 'scan_miss', 'collect_success', 'descend_thrust', 'descend_bubble_pop', 'ambient_mid', 'zone_enter_mid', 'zone_up']) {
    if (sfx[id]) paths.push(...sfx[id].files);
  }
  stems('mid');
  for (const id of ['ambient_deep', 'zone_enter_deep', 'sonar_idle', 'hull_creak']) {
    if (sfx[id]) paths.push(...sfx[id].files);
  }
  stems('deep');
  const rest = uniquePaths(paths);
  let cursor = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (cursor < rest.length) { try { await loadBuffer(rest[cursor++]); } catch (_) {} }
  }));
}

async function preloadSession() {
  const paths = requiredSessionPaths();
  const invitePaths = paths.filter((path) => path.startsWith('music/invite_'));
  let loaded = 0;
  const button = $('btn-start');
  const progress = (path) => {
    loaded++;
    if (button) button.textContent = 'LOADING SOUND ' + loaded + '/' + paths.length;
    audioLog(path, 'file', 'loaded');
  };
  await Promise.all(invitePaths.map((path) => loadBuffer(path).then(() => progress(path)).catch((error) => {
    audioLog(path, 'silent', error.message); progress(path);
  })));
  const remaining = paths.filter((path) => !invitePaths.includes(path));
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (cursor < remaining.length) {
      const path = remaining[cursor++];
      try { await loadBuffer(path); progress(path); }
      catch (error) { audioLog(path, 'silent', error.message); progress(path); }
    }
  });
  await Promise.all(workers);
  loadBackground();
}

function chooseFile(cueId, files) {
  if (!files || !files.length) return null;
  let index = Math.floor(Math.random() * files.length);
  const previous = audio.lastFile.get(cueId);
  if (files.length > 1 && files[index] === previous) index = (index + 1 + Math.floor(Math.random() * (files.length - 1))) % files.length;
  audio.lastFile.set(cueId, files[index]);
  return files[index];
}

function cueRecord(cueId) { return audio.manifest && audio.manifest.sfx[cueId]; }

function playBuffer(cueId, buffer, options) {
  const opts = options || {};
  if (!audio.context || !buffer || audio.muted) return null;
  const busName = opts.bus || (cueRecord(cueId) && cueRecord(cueId).bus) || 'tool';
  const source = audio.context.createBufferSource();
  const gain = audio.context.createGain();
  const pan = audio.context.createStereoPanner ? audio.context.createStereoPanner() : null;
  source.buffer = buffer;
  gain.gain.value = opts.gain == null ? 1 : opts.gain;
  if (pan) pan.pan.value = Math.max(-1, Math.min(1, opts.pan || 0));
  source.connect(gain);
  if (pan) { gain.connect(pan); pan.connect(audio.buses[busName] || audio.buses.tool); }
  else gain.connect(audio.buses[busName] || audio.buses.tool);
  audio.active.add(source);
  source._cueId = cueId;
  source._audioGain = gain;
  audio.activeCues.set(cueId, source);
  source.onended = () => {
    audio.active.delete(source);
    if (audio.activeCues.get(cueId) === source) audio.activeCues.delete(cueId);
    if (audio.lifeTrack && audio.lifeTrack.source === source) audio.lifeTrack = null;
    if (opts.onended) opts.onended();
    renderAudioDebug();
  };
  const when = Math.max(audio.context.currentTime, opts.at || 0);
  if (opts.fadeIn) {
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(opts.gain == null ? 1 : opts.gain, when + opts.fadeIn);
  }
  if (opts.duration != null) source.start(when, opts.offset || 0, opts.duration);
  else source.start(when, opts.offset || 0);
  if (opts.fadeOut && opts.duration) {
    const end = when + opts.duration;
    gain.gain.setValueAtTime(opts.gain == null ? 1 : opts.gain, end - opts.fadeOut);
    gain.gain.linearRampToValueAtTime(0, end);
  }
  return { source, gain, pan };
}

// Beds (sea, thrusters): the long recordings are never switched to loop. One pass plays forward from a random
// spot; before it runs out the next pass fades in over it from another spot at a slightly different speed, so
// there is no seam that comes round again.
const FADE_CURVE = (() => {
  const up = new Float32Array(33), down = new Float32Array(33);
  for (let i = 0; i <= 32; i++) { up[i] = Math.sin(i / 32 * Math.PI / 2); down[i] = Math.cos(i / 32 * Math.PI / 2); }
  return { up, down };
})();

function bedPass(bed) {
  if (bed.stopped || !audio.context) return;
  const ctx = audio.context;
  const buffer = bed.buffers[bed.turn++ % bed.buffers.length];
  const rate = bed.rate * (1 + (Math.random() * 2 - 1) * bed.detune);
  const room = Math.max(0, buffer.duration - bed.cross * 2.6 * rate);
  let offset = Math.random() * room;
  if (room > 1 && Math.abs(offset - bed.lastOffset) < room * 0.2) offset = (offset + room * 0.5) % room;
  bed.lastOffset = offset;
  const length = (buffer.duration - offset) / rate;
  const cross = Math.min(bed.cross, length / 2.2);
  const source = ctx.createBufferSource(), gain = ctx.createGain(), t0 = ctx.currentTime + 0.03;
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.connect(gain); gain.connect(bed.out);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.setValueCurveAtTime(FADE_CURVE.up, t0, cross);
  gain.gain.setValueCurveAtTime(FADE_CURVE.down, t0 + length - cross, cross - 0.02);
  source.start(t0, offset);
  source.stop(t0 + length + 0.05);
  const pass = { source, gain };
  bed.passes.add(pass);
  source.onended = () => { bed.passes.delete(pass); try { gain.disconnect(); } catch (_) {} };
  bed.timer = window.setTimeout(() => bedPass(bed), Math.max(200, (length - cross) * 1000 - 40));
}

function startBed(key, cueId, options) {
  const opts = options || {};
  if (audio.beds.has(key)) return audio.beds.get(key).ready;
  const record = cueRecord(cueId);
  const files = (record && record.files) || [];
  if (!files.length || !audio.context) return Promise.resolve(null);
  const bed = { key, cueId, passes: new Set(), timer: 0, turn: Math.floor(Math.random() * files.length), lastOffset: -1e9,
    cross: opts.cross == null ? 8 : opts.cross, detune: opts.detune == null ? 0.03 : opts.detune, rate: 1,
    level: opts.level == null ? 1 : opts.level, stopped: false, out: null, ready: null };
  audio.beds.set(key, bed);
  bed.ready = Promise.all(files.map((path) => loadBuffer(path))).then((buffers) => {
    if (bed.stopped) return null;
    bed.buffers = buffers;
    bed.out = audio.context.createGain();
    bed.out.gain.value = 0;
    bed.out.connect(audio.buses[opts.bus || record.bus] || audio.buses.bed);
    setParam(bed.out.gain, bed.level, opts.fadeIn == null ? 0.6 : opts.fadeIn);
    bedPass(bed);
    audioLog(cueId, 'file', files.join(', '));
    return bed;
  }).catch((error) => {
    audioLog(cueId, 'draft', error.message);
    if (audio.beds.get(key) === bed) audio.beds.delete(key);
    bed.stopped = true;
    return null;
  });
  return bed.ready;
}

function stopBed(key, fadeSeconds) {
  const bed = audio.beds.get(key);
  if (!bed) return;
  audio.beds.delete(key);
  bed.stopped = true;
  clearTimeout(bed.timer);
  if (!bed.out) return;
  const seconds = fadeSeconds == null ? 0.6 : fadeSeconds;
  setParam(bed.out.gain, 0, seconds);
  window.setTimeout(() => {
    bed.passes.forEach((pass) => { try { pass.source.stop(); } catch (_) {} });
    try { bed.out.disconnect(); } catch (_) {}
  }, seconds * 1500 + 150);
}

function sourceForCue(cueId) {
  return cueRecord(cueId) && cueRecord(cueId).files.length ? 'file' : 'draft';
}

async function playCue(cueId, options) {
  const opts = options || {};
  if (!audio.context || !state.started || audio.muted) return false;
  if (!audio.manifest) return playDraft(cueId, opts);
  const now = performance.now();
  const minimumGap = opts.minGap == null ? 140 : opts.minGap;
  if (!opts.force && now - (audio.lastCueAt.get(cueId) || 0) < minimumGap) return false;
  if (!opts.allowOverlap && audio.activeCues.has(cueId)) return false;
  audio.lastCueAt.set(cueId, now);
  const record = cueRecord(cueId);
  if (!record || !record.files.length) return playDraft(cueId, opts);
  const path = opts.path || chooseFile(cueId, record.files);
  try {
    const buffer = await loadBuffer(path);
    if (audio.muted || (opts.guard && !opts.guard())) return false;
    const duration = opts.duration || (cueId === 'sonar_idle' ? 10 : undefined);
    const track = playBuffer(cueId, buffer, { bus: record.bus, gain: opts.gain == null ? 1 : opts.gain,
      pan: opts.pan || 0, duration, onended: opts.onended, at: ON_THE_BEAT.test(cueId) ? gridTime(BEAT.eighth, 0.01) : 0 });
    if (track && cueId.startsWith('life_')) audio.lifeTrack = track;
    audioLog(cueId, 'file', path);
    if (opts.duck) duck({ music: 0.63, bed: 0.55, life: 0.55 }, duration ? duration * 1000 : Math.min(1800, buffer.duration * 1000), cueId);
    return Boolean(track);
  } catch (error) {
    audioLog(cueId, 'draft', error.message);
    return playDraft(cueId, opts);
  }
}

function playDraft(cueId, options) {
  const opts = options || {};
  if (!audio.context || audio.muted || !state.started) return false;
  const bus = opts.bus || (cueId.startsWith('life_') ? 'life' : 'tool');
  const notes = cueId.includes('zone') || cueId.includes('discovery') ? [293.66, 369.99, 440] : [440, 587.33];
  const start = audio.context.currentTime;
  notes.forEach((frequency, index) => {
    const oscillator = audio.context.createOscillator();
    const envelope = audio.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0.0001, start + index * 0.09);
    envelope.gain.exponentialRampToValueAtTime(0.08, start + index * 0.09 + 0.018);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.09 + 0.35);
    oscillator.connect(envelope); envelope.connect(audio.buses[bus] || audio.buses.tool);
    oscillator.start(start + index * 0.09); oscillator.stop(start + index * 0.09 + 0.37);
  });
  audioLog(cueId, 'draft', 'Web Audio tone');
  return true;
}

function cue(name, options) { return playCue(name, options); }

async function playAmbient(zone, previousZone) {
  if (!state.started || !audio.manifest) return;
  const nextId = 'ambient_' + zone;
  if (audio.currentAmbient !== nextId) {
    const oldKey = audio.currentAmbient;
    audio.currentAmbient = nextId;
    startBed(nextId, nextId, { level: 1, fadeIn: oldKey ? 4 : 1.5, cross: 8 });
    if (oldKey) stopBed(oldKey, 4);
  }
  directorStart();
  if (previousZone && previousZone !== zone) handleZoneChange(previousZone, zone);
}

function renderAudioDebug() {
  if (!audio.debug) return;
  const events = $('audio-events');
  if (events) events.textContent = audio.recent.length ? audio.recent.map((entry) =>
    entry.time + '  ' + entry.cueId + ' · ' + (entry.source === 'file' ? 'FILE' : entry.source === 'draft' ? 'DRAFT' : 'SILENT') +
    (entry.detail ? ' · ' + entry.detail : '')).join('\n') : 'No sound events yet.';
  const current = $('audio-current');
  if (current) {
    const playing = Array.from(audio.activeCues.keys());
    playing.push(...Array.from(audio.beds.values()).map((bed) => bed.cueId));
    const mus = audio.mus;
    current.textContent = (Array.from(new Set(playing)).join(', ') || 'None') + '  |  music: ' + mus.state +
      (mus.player ? ' ' + mus.player.piece : mus.restUntil > performance.now() ? ' (' + Math.round((mus.restUntil - performance.now()) / 1000) + 's)' : '');
  }
  const meter = $('audio-meter');
  if (meter && audio.analyser) {
    const values = new Float32Array(audio.analyser.fftSize);
    audio.analyser.getFloatTimeDomainData(values);
    let peak = 0;
    for (const value of values) peak = Math.max(peak, Math.abs(value));
    meter.textContent = peak ? (20 * Math.log10(peak)).toFixed(1) + ' dBFS peak' : '−∞ dBFS peak';
  }
}

function setDebug(open) {
  audio.debug = Boolean(open);
  const panel = $('audio-debug');
  if (panel) panel.hidden = !audio.debug;
  if (audio.debug && !audio.debugInterval) audio.debugInterval = window.setInterval(renderAudioDebug, 250);
  if (!audio.debug && audio.debugInterval) { clearInterval(audio.debugInterval); audio.debugInterval = 0; }
  renderAudioDebug();
}

const THEME_LEVELS = { invite: 0.28, shallow: 0.25, mid: 0.42, deep: 0.45, discovery: 0.36, home: 0.32 };
const MUSIC_LAYERS = ['pad', 'lead', 'motion', 'sparkle'];
const ZONE_PIECE = { surface: 'shallow', mid: 'mid', deep: 'deep' };

// ---------------------------------------------------------------- one clock for everything
// The pieces are in 6/8 at dotted-quarter = 72. The clock starts with the dive and keeps counting through the
// silences, so music entries, creature phrases, bubbles and hand notes all land on the same grid.
const BEAT = (() => { const eighth = 60 / (72 * 3); return { eighth, bar: eighth * 6, phrase: eighth * 48 }; })();
const ON_THE_BEAT = /^(life_|descend_bubble_pop|scan_hit|collect_success|first_discovery|zone_|deep_mystery|hull_creak|mission_complete|surface_break)/;

function gridTime(unit, ahead) {
  const ctx = audio.context;
  if (audio.clock0 == null) audio.clock0 = ctx.currentTime;
  const t = ctx.currentTime + (ahead == null ? 0.03 : ahead);
  return audio.clock0 + Math.ceil((t - audio.clock0) / unit) * unit;
}

// ---------------------------------------------------------------- music that follows the player
// Researched from Sky / Flower / Journey (docs/plan-sky-sound-ecosystem-web.md): layers rise with what the
// player does and fall away when they stop; nothing loops; music is an event with real silence around it.
//   moving for enterAfter s      -> pad enters on a bar line, then motion, then lead
//   still for grace s            -> layers fade out one after another, even mid-piece; moving again brings them back
//   phrases[] phrases played     -> the performance winds down by itself and rests
// Each performance carries on from the next phrase of the piece, so the file is heard through once, never looped.
const MUS = { enterAfter: 1.2, grace: 4, phrases: [2, 3], restStop: [10, 18], restCap: [16, 30], restEnd: [24, 40],
  restZone: [3, 6], idle: [55, 85], fade: { lead: 2.5, sparkle: 2, motion: 3.5, pad: 7 } };
audio.mus = { state: 'REST', player: null, pos: {}, restUntil: 0, lastActive: -1e9, lastMove: -1e9, streakAt: -1e9,
  idleAt: 0, f: { pad: 0, lead: 0, motion: 0, sparkle: 0 }, timers: [], stopTimer: 0, voiceHold: false, fadeReason: '', log: [] };
audio.dir = { started: false, roomTimer: 0, breathTimer: 0, tick: 0, lastAtmosphere: 0 };
const HUM = { length: [14, 22], gap: [30, 60], level: 0.3, deep: 0.2 };
const dirRnd = (range) => range[0] + Math.random() * (range[1] - range[0]);
const musicResting = () => audio.mus.state === 'REST';

function musLog(what) {
  const mus = audio.mus;
  mus.log.push({ t: Math.round(performance.now()), what });
  if (mus.log.length > 60) mus.log.shift();
}

function themeLayerLevel(piece, layer) {
  const mus = audio.mus;
  if (layer === 'lead' && (audio.lifeTarget >= 0 || mus.voiceHold)) return 0;
  return (THEME_LEVELS[piece] || 0.3) * (mus.f[layer] || 0) * (mus.player && mus.player.soft ? 0.75 : 1);
}

function applyThemeLevels(seconds) {
  const mus = audio.mus;
  if (!mus.player || mus.state !== 'PLAY') return;
  for (const [layer, track] of Object.entries(mus.player.layers)) setParam(track.gain.gain, themeLayerLevel(mus.player.piece, layer), seconds);
}
function musSet(layer, value, fade) { audio.mus.f[layer] = value; applyThemeLevels(fade); }
function musAt(seconds, fn) { audio.mus.timers.push(window.setTimeout(fn, Math.max(0, seconds) * 1000)); }
function musClear() { audio.mus.timers.forEach(clearTimeout); audio.mus.timers = []; }

async function startPerformance(piece, options) {
  const opts = options || {}, mus = audio.mus;
  const spec = audio.manifest && audio.manifest.music[piece];
  if (!spec || !audio.context || !audio.musicEnabled || mus.state !== 'REST') return false;
  mus.state = 'LOAD';
  const names = MUSIC_LAYERS.filter((layer) => spec.files[layer]);
  let buffers;
  try { buffers = await Promise.all(names.map((layer) => loadBuffer(spec.files[layer]))); }
  catch (error) {
    audioLog('music_' + piece, 'silent', error.message);
    mus.state = 'REST'; mus.restUntil = performance.now() + 5000;
    return false;
  }
  if (mus.state !== 'LOAD') return false;
  if (!audio.musicEnabled) { mus.state = 'REST'; return false; }
  const ctx = audio.context, duration = buffers[0].duration;
  let offset = opts.event || opts.fromStart ? 0 : (mus.pos[piece] || 0);
  if (duration - offset < BEAT.phrase * 1.5) offset = 0;
  const when = opts.event ? ctx.currentTime + 0.05 : gridTime(BEAT.bar, 0.06);
  const length = opts.event ? Math.min(duration, opts.maxSeconds || duration)
    : Math.min((opts.phrases || Math.round(dirRnd(MUS.phrases))) * BEAT.phrase, duration - offset);
  const player = { piece, layers: {}, when, offset, length, duration, event: Boolean(opts.event), soft: Boolean(opts.soft),
    hold: when + (opts.hold || 0), reachesEnd: offset + length >= duration - 0.5 };
  names.forEach((layer, index) => {
    // One performance, played forward once. A piece is never set to loop.
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffers[index];
    gain.gain.value = 0;
    source.connect(gain); gain.connect(audio.buses.music);
    source.start(when, offset);
    player.layers[layer] = { source, gain };
  });
  musClear();
  mus.player = player; mus.state = 'PLAY';
  mus.f = { pad: 0, lead: 0, motion: 0, sparkle: 0 };
  const lead = when - ctx.currentTime;
  if (opts.event) {
    musAt(lead, () => { mus.f = { pad: 1, lead: 1, motion: 1, sparkle: 1 }; applyThemeLevels(opts.fadeIn || 0.8); });
  } else {
    musAt(lead, () => musSet('pad', 1, 4));
    if (!opts.soft) musAt(lead + BEAT.bar, () => musSet('motion', 1, 3.5));
    musAt(lead + BEAT.bar * 2, () => musSet('lead', 1, 3));
  }
  musAt(lead + length - (opts.event ? 3 : 4.5), () => endPerformance(opts.event ? 'event' : player.reachesEnd ? 'end' : 'cap'));
  musLog('start ' + piece + ' @' + Math.round(offset) + 's for ' + Math.round(length) + 's');
  audioLog('music_' + piece, 'file', 'from ' + Math.round(offset) + ' s, ' + Math.round(length) + ' s, no loop');
  return true;
}

// reason: 'stop' the player went still (can be picked up again while it fades) | 'cap' enough phrases |
// 'end' the piece ran out | 'zone' new depth zone | 'event' a one-off piece finished or is taking over
function endPerformance(reason, quickSeconds) {
  const mus = audio.mus, player = mus.player;
  if (!player || mus.state !== 'PLAY') return;
  musClear();
  const at = player.offset + Math.max(0, audio.context.currentTime - player.when);
  if (!player.event) {
    let next = Math.ceil((at + 1) / BEAT.phrase) * BEAT.phrase;
    if (reason === 'end' || player.duration - next < BEAT.phrase * 1.5) next = 0;
    mus.pos[player.piece] = next;
  }
  const scale = quickSeconds ? quickSeconds / MUS.fade.pad : 1;
  let longest = 0;
  for (const [layer, track] of Object.entries(player.layers)) {
    const seconds = (MUS.fade[layer] || 3) * scale;
    longest = Math.max(longest, seconds);
    setParam(track.gain.gain, 0, seconds);
  }
  const rest = reason === 'stop' ? MUS.restStop : reason === 'end' ? MUS.restEnd : reason === 'cap' ? MUS.restCap : MUS.restZone;
  mus.restUntil = performance.now() + (longest + dirRnd(rest)) * 1000;
  mus.idleAt = mus.restUntil + dirRnd(MUS.idle) * 1000;
  mus.fadeReason = reason;
  const finish = () => {
    for (const track of Object.values(player.layers)) {
      try { track.source.stop(); } catch (_) {}
      try { track.gain.disconnect(); } catch (_) {}
    }
    if (mus.player === player) { mus.player = null; mus.state = 'REST'; }
  };
  if (reason === 'stop') {
    mus.state = 'FADE';
    mus.stopTimer = window.setTimeout(finish, longest * 1500 + 200);
  } else {
    // Not coming back: free the slot now and let the old performance die away on its own.
    mus.player = null; mus.state = 'REST';
    window.setTimeout(finish, longest * 1500 + 200);
  }
  musLog('fade (' + reason + ') at ' + Math.round(at) + 's of ' + player.piece);
}

function resumePerformance() {
  const mus = audio.mus, player = mus.player;
  if (mus.state !== 'FADE' || mus.fadeReason !== 'stop' || !player) return;
  const left = player.when + player.length - audio.context.currentTime;
  if (left < 8) return;
  clearTimeout(mus.stopTimer);
  mus.state = 'PLAY'; mus.restUntil = 0;
  mus.f.pad = 1; mus.f.lead = 1; mus.f.motion = player.soft ? 0 : 1;
  applyThemeLevels(2);
  musAt(left - 4.5, () => endPerformance(player.reachesEnd ? 'end' : 'cap'));
  musLog('picked up again');
}

// Every turn of the box, depth step and button press reports here.
function activity(kind) {
  const mus = audio.mus, now = performance.now();
  if (kind === 'move') {
    if (now - mus.lastMove > 2500) mus.streakAt = now;
    mus.lastMove = now;
  }
  mus.lastActive = now;
  state.stir = Math.min(1, (state.stir || 0) + (kind === 'move' ? 0.1 : 0.45));
  if (mus.state === 'FADE') resumePerformance();
}

function sparkleFor(seconds) {
  const mus = audio.mus;
  if (mus.state !== 'PLAY' || mus.player.event) return;
  musSet('sparkle', 1, 1.2);
  musAt(seconds, () => musSet('sparkle', 0, 2.5));
}

function musicTick() {
  const mus = audio.mus, now = performance.now();
  if (!state.started || !audio.manifest || !audio.musicEnabled || audio.muted) return;
  if (mus.state === 'PLAY') {
    const player = mus.player;
    if (!player.event && audio.context.currentTime > player.hold && now - mus.lastActive > MUS.grace * 1000) endPerformance('stop');
    return;
  }
  if (mus.state !== 'REST' || now < mus.restUntil || now < (audio.quietUntil || 0)) return;
  const piece = ZONE_PIECE[state.zone] || 'shallow';
  if (now - mus.lastMove < 1500 && now - mus.streakAt >= MUS.enterAfter * 1000) startPerformance(piece);
  else if (now > mus.idleAt && now - mus.lastActive > 20000) {
    // Nobody has touched anything for a long while: one quiet phrase drifts past, then silence again.
    mus.idleAt = now + dirRnd(MUS.idle) * 1000;
    startPerformance(state.zone === 'surface' ? 'invite' : piece, { phrases: 1, soft: true, hold: BEAT.phrase });
  }
}

// Cabin hum: a swell that comes and goes, never a constant drone.
function humSwell() {
  clearTimeout(audio.dir.roomTimer);
  if (!state.started) return;
  const record = cueRecord('sub_roomtone');
  const later = (seconds) => { audio.dir.roomTimer = window.setTimeout(humSwell, seconds * 1000); };
  if (!record || !record.files.length || audio.muted || !musicResting()) { later(12); return; }
  loadBuffer(record.files[0]).then((buffer) => {
    const length = Math.min(dirRnd(HUM.length), buffer.duration);
    playBuffer('sub_roomtone', buffer, { bus: record.bus, gain: state.zone === 'deep' ? HUM.deep : HUM.level,
      offset: Math.random() * Math.max(0, buffer.duration - length), duration: length, fadeIn: 5, fadeOut: 7 });
    audioLog('sub_roomtone', 'file', Math.round(length) + ' s swell');
    later(length + dirRnd(HUM.gap));
  }).catch(() => later(30));
}

// The sea level breathes in four-bar waves, a little fuller while the music rests.
function seaBreath() {
  clearTimeout(audio.dir.breathTimer);
  if (!state.started) return;
  const bed = audio.beds.get(audio.currentAmbient);
  if (bed && bed.out) setParam(bed.out.gain, (0.8 + Math.random() * 0.2) * (musicResting() ? 1.15 : 0.95), BEAT.bar * 3);
  audio.dir.breathTimer = window.setTimeout(seaBreath, BEAT.bar * 4 * 1000);
}

function directorStart() {
  if (audio.dir.started) return;
  audio.dir.started = true;
  audio.mus.idleAt = performance.now() + dirRnd(MUS.idle) * 1000;
  humSwell();
  seaBreath();
  audio.dir.tick = window.setInterval(musicTick, 250);
}

function atmosphereOk(requireRest) {
  const now = performance.now();
  if (now - audio.dir.lastAtmosphere < 10000) return false;
  if (now < (audio.quietUntil || 0)) return false;
  if (audio.ducks.size) return false;
  if (requireRest && !musicResting()) return false;
  audio.dir.lastAtmosphere = now;
  return true;
}

const VOICE_POLICY = {
  vo_on_frame: { never: true }, vo_scan_hit: { first: 3, every: 2 }, vo_scan_miss: { first: 1, every: 4 },
  vo_collect: { first: 2, then: 'never' }, vo_duplicate: { cool: 20 }, vo_nothing: { cool: 20 }, vo_tray_empty: { cool: 20 },
  vo_zone_mid: { cool: 60 }, vo_zone_deep: { cool: 60 }
};
const VOICE_ALWAYS = ['vo_welcome', 'vo_analyze', 'vo_complete', 'vo_max_depth', 'vo_surface'];
function voiceAllowed(id) {
  const policy = VOICE_POLICY[id];
  const now = performance.now();
  if (policy && policy.never) return false;
  audio.voiceCount = audio.voiceCount || {};
  audio.voiceLast = audio.voiceLast || {};
  const n = audio.voiceCount[id] = (audio.voiceCount[id] || 0) + 1;
  if (policy) {
    if (policy.cool && now - (audio.voiceLast[id] || -1e9) < policy.cool * 1000) return false;
    if (policy.first !== undefined && n > policy.first) {
      if (policy.then === 'never') return false;
      if (policy.every && (n - policy.first) % policy.every !== 0) return false;
    }
  }
  if (!VOICE_ALWAYS.includes(id) && now - (audio.voiceLastAny || -1e9) < 4000) return false;
  audio.voiceLast[id] = now;
  audio.voiceLastAny = now;
  return true;
}

function playBridge(bridgeId) {
  const path = audio.manifest && audio.manifest.bridges[bridgeId];
  if (!path || !audio.context || audio.muted || !audio.musicEnabled) return Promise.resolve(0);
  return loadBuffer(path).then((buffer) => {
    if (audio.muted || !audio.musicEnabled) return 0;
    const track = playBuffer('bridge_' + bridgeId, buffer, { bus: 'music' });
    audioLog('bridge_' + bridgeId, 'file', path);
    return track ? buffer.duration : 0;
  }).catch((error) => { audioLog('bridge_' + bridgeId, 'silent', error.message); return 0; });
}

function handleZoneChange(previous, next) {
  const down = next === 'mid' && previous === 'surface' || next === 'deep' && previous !== 'deep';
  const up = next === 'mid' && previous === 'deep' || next === 'surface' && previous !== 'surface';
  const bridge = down ? (next === 'mid' ? 'down_mid' : 'down_deep') :
    up ? (next === 'mid' ? 'up_mid' : 'up_shallow') : '';
  const zoneKey = (down ? 'd_' : 'u_') + next;
  audio.zoneCueAt = audio.zoneCueAt || {};
  const zoneRepeat = performance.now() - (audio.zoneCueAt[zoneKey] || -1e9) < 20000;
  if (!zoneRepeat) audio.zoneCueAt[zoneKey] = performance.now();
  if (zoneRepeat) {
    audioLog('zone_' + zoneKey, 'silent', 'zone cue cooldown');
  } else if (next === 'mid' && down) {
    cue('zone_enter_mid', { duck: true });
    speakLine('vo_zone_mid');
  } else if (next === 'deep' && down) {
    cue('zone_enter_deep', { duck: true });
    speakLine('vo_zone_deep');
  } else if (up) {
    cue('zone_up', { duck: true });
  }
  // The old zone's music bows out; the new zone's piece comes in by itself once the player keeps moving.
  // (while the player is still on the move the two simply cross over, on the same beat and in the same key)
  if (audio.mus.state === 'PLAY' && !audio.mus.player.event) { endPerformance('zone', 3); audio.mus.restUntil = performance.now() + 500; }
  else if (audio.mus.state === 'FADE') audio.mus.fadeReason = 'zone';
  else audio.mus.restUntil = Math.min(audio.mus.restUntil, performance.now() + dirRnd(MUS.restZone) * 1000);
  if (bridge && !zoneRepeat) playBridge(bridge);
  duck({ music: 0.63, bed: 0.62, life: 0.62 }, 1800, 'zone');
  audio.lastZoneChange = { from: previous, to: next, at: performance.now() };
  scheduleAtmosphere();
}

function toggleMusic() {
  audio.musicEnabled = !audio.musicEnabled;
  applyBusGain('music', 0.08);
  const button = $('audio-music-toggle');
  if (button) button.textContent = audio.musicEnabled ? 'Music: on' : 'Music: off';
  if (!audio.musicEnabled && audio.mus.state === 'PLAY') endPerformance('event', 0.6);
}

function toggleMute() {
  audio.muted = !audio.muted;
  state.muted = audio.muted;
  if (!audio.muted) audio.lifeTarget = -1;
  setMasterGain();
  if (audio.muted && 'speechSynthesis' in window) speechSynthesis.cancel();
  const sound = $('btn-sound');
  if (sound) { sound.setAttribute('aria-pressed', audio.muted ? 'false' : 'true'); sound.textContent = audio.muted ? 'Sound: off' : 'Sound: on'; }
  say(audio.muted ? 'Audio muted.' : 'Audio on.');
  audioLog('master_mute', audio.muted ? 'silent' : 'file', audio.muted ? 'muted' : 'unmuted');
}

async function speakLine(id, values) {
  const lines = VOICE_LINES[id];
  if (!lines) return;
  if (!voiceAllowed(id)) { audioLog(id, 'silent', 'voice rule: skipped'); return; }
  if (audio.muted || !state.started) {
    audioLog(id, 'silent', audio.muted ? 'muted' : 'dive not started');
    return;
  }
  const select = $('audio-language');
  const requested = select ? select.value : audio.voiceLanguage;
  if (requested === 'off') { audioLog(id, 'silent', 'voice disabled'); return; }
  updateVoiceAvailability();
  let language = requested || 'en';
  if (language === 'th' && !audio.voiceAvailable.th && audio.voiceAvailable.en) language = 'en';
  const voicePath = audio.manifest && audio.manifest.voice && audio.manifest.voice[id] && audio.manifest.voice[id][language];
  const params = values || {};
  showVoiceNarration(id, params);
  const nameKeys = id === 'vo_analyze' && Array.isArray(params.nameKeys) ? params.nameKeys : [];
  const voiceNames = audio.manifest && audio.manifest.voice_names || {};
  const nameEntries = nameKeys.map((key) => {
    const entry = voiceNames[key];
    const path = typeof entry === 'string' ? entry : entry && (entry[language] || entry.en);
    return path ? { cueId: 'vo_name_' + key, path } : null;
  }).filter(Boolean);
  const token = ++audio.speakToken;
  if (voicePath) {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    try {
      const entries = [{ cueId: id, path: voicePath }, ...nameEntries];
      const buffers = await Promise.all(entries.map((entry) => loadBuffer(entry.path)));
      if (token !== audio.speakToken || audio.muted) return;
      const voiceDuck = duck({ bed: 0.45, life: 0.6, hull: 0.7, music: 0.58, hand: 0.5 }, 0, id);
      audio.mus.voiceHold = true; applyThemeLevels(0.25);
      let index = 0;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        audio.ducks.delete(voiceDuck);
        BUS_NAMES.forEach((name) => applyBusGain(name, 1.2));
        audio.mus.voiceHold = false; applyThemeLevels(1.2);
      };
      const playNext = () => {
        if (token !== audio.speakToken || audio.muted) { finish(); return; }
        const entry = entries[index];
        const track = playBuffer(entry.cueId, buffers[index], { bus: 'voice', onended: () => {
          index++;
          if (index < entries.length) window.setTimeout(playNext, 150);
          else finish();
        } });
        if (track) audioLog(entry.cueId, 'file', entry.path);
        else finish();
      };
      playNext();
      return;
    } catch (error) { audioLog(id, 'draft', error.message); }
  }
  if (!('speechSynthesis' in window)) { audioLog(id, 'silent', 'speechSynthesis unavailable'); return; }
  if (!audio.voiceAvailable[language]) { audioLog(id, 'silent', 'no ' + language + ' speech voice'); return; }
  const line = String(lines[language] || lines.en).replace('{names}', params[language + 'Names'] || params.names || '');
  let voiceDuck = 0;
  speechSynthesis.cancel();
  audio.mus.voiceHold = true; applyThemeLevels(0.1);
  const utterance = new SpeechSynthesisUtterance(line);
  utterance.lang = language === 'th' ? 'th-TH' : 'en-US';
  utterance.rate = language === 'th' ? 0.92 : 0.95;
  utterance.pitch = 0.95;
  utterance.volume = audio.volume * (audio.voiceVolume / 100);
  const voices = speechSynthesis.getVoices();
  utterance.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith(language)) || null;
  let endTimer = 0;
  const finish = () => {
    clearTimeout(endTimer);
    if (voiceDuck) {
      audio.ducks.delete(voiceDuck);
      BUS_NAMES.forEach((name) => applyBusGain(name, 1.2));
    }
    audio.mus.voiceHold = false; applyThemeLevels(1.2);
    if (token !== audio.speakToken) return;
    audioLog(id, 'draft', 'speechSynthesis ' + language);
  };
  utterance.onstart = () => { voiceDuck = duck({ bed: 0.45, life: 0.6, hull: 0.7, music: 0.58 }, 0, id); };
  utterance.onend = finish;
  utterance.onerror = finish;
  endTimer = window.setTimeout(finish, 12000);
  speechSynthesis.speak(utterance);
}

// ---------------------------------------------------------------- the player's hands as an instrument
// Turning and diving sound soft notes in the key of the music (D major pentatonic) on the beat grid, the way
// Sky tunes what the player does to the score. Synthesised live, on top of the recorded sounds.
const HAND = { turnDeg: 30, depthStep: 0.04, level: 0.1,
  melody: [62, 64, 69, 66, 64, 62, 66, 69, 71, 69, 66, 64],
  scaleDown: [86, 83, 81, 78, 76, 74, 71, 69, 66, 64, 62, 59, 57, 54, 52, 50] };

function handGraph() {
  if (audio.handIn) return audio.handIn;
  const ctx = audio.context, input = ctx.createGain(), delay = ctx.createDelay(2), feedback = ctx.createGain(), tone = ctx.createBiquadFilter();
  delay.delayTime.value = BEAT.eighth * 3;
  feedback.gain.value = 0.28;
  tone.type = 'lowpass'; tone.frequency.value = 1900;
  input.connect(audio.buses.hand);
  input.connect(delay); delay.connect(tone); tone.connect(feedback); feedback.connect(delay); tone.connect(audio.buses.hand);
  audio.handIn = input;
  return input;
}

function handNote(midi, velocity) {
  if (!audio.context || !state.started || audio.muted || !audio.handNotes) return;
  const ctx = audio.context, when = gridTime(BEAT.eighth / 2, 0.02);
  if (when - (audio.handLast || 0) < BEAT.eighth / 2 - 0.001) return;
  audio.handLast = when;
  const env = ctx.createGain(), hz = 440 * Math.pow(2, (midi - 69) / 12), level = HAND.level * (velocity || 1);
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(level, when + 0.012);
  env.gain.exponentialRampToValueAtTime(level * 0.3, when + 0.35);
  env.gain.exponentialRampToValueAtTime(0.0001, when + 1.6);
  env.connect(handGraph());
  [[1, 1], [2, 0.22], [3, 0.06]].forEach(([ratio, amount]) => {
    const osc = ctx.createOscillator(), part = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = hz * ratio; part.gain.value = amount;
    osc.connect(part); part.connect(env);
    osc.start(when); osc.stop(when + 1.65);
  });
  audio.handCount = (audio.handCount || 0) + 1;
}

function turnNotes(delta) {
  audio.turnProgress = (audio.turnProgress || 0) + delta;
  audio.turnIndex = audio.turnIndex || 0;
  const n = HAND.melody.length;
  while (audio.turnProgress >= HAND.turnDeg) { audio.turnProgress -= HAND.turnDeg; audio.turnIndex = (audio.turnIndex + 1) % n; handNote(HAND.melody[audio.turnIndex]); }
  while (audio.turnProgress <= -HAND.turnDeg) { audio.turnProgress += HAND.turnDeg; audio.turnIndex = (audio.turnIndex + n - 1) % n; handNote(HAND.melody[audio.turnIndex]); }
}

function depthNotes(depth) {
  const slot = Math.round(depth / HAND.depthStep);
  if (slot === audio.depthSlot) return;
  audio.depthSlot = slot;
  const index = Math.round(slot * HAND.depthStep * (HAND.scaleDown.length - 1));
  if (index === audio.depthNote) return;
  audio.depthNote = index;
  handNote(HAND.scaleDown[index], 0.9);
}

function setYaw(nextYaw) {
  const previous = Number(state.yaw) || 0;
  const normalized = ((Number(nextYaw) % 360) + 360) % 360;
  let delta = normalized - previous;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  state.yaw = normalized;
  if (Math.abs(delta) < 0.0001) return;
  if (state.started) turnNotes(delta);
  audio.yawProgress += delta;
  while (audio.yawProgress >= 5) { audio.yawProgress -= 5; periscopeClick(); }
  while (audio.yawProgress <= -5) { audio.yawProgress += 5; periscopeClick(); }
}

function periscopeClick() {
  const now = performance.now();
  if (!state.started || now - audio.lastClickAt < 40) return;
  audio.lastClickAt = now;
  activity('move');
  cue('turn_periscope', { minGap: 0, gain: 0.8 });
}

function subjectCueKey(subject) {
  const name = String(subject && subject.name || '').toLowerCase();
  if (name.includes('shoal')) return 'shoal';
  if (name.includes('reef')) return 'reef';
  if (name.includes('seahorse')) return 'seahorse';
  if (name.includes('manta')) return 'manta';
  if (name.includes('lantern')) return 'lantern';
  if (name.includes('jelly')) return 'jelly';
  if (name.includes('angler')) return 'angler';
  if (name.includes('squid')) return 'squid';
  return '';
}

// The lead steps aside for a creature in the reticle (audio.lifeTarget) and for the voice (mus.voiceHold).
function setThemeLeadMuted() { applyThemeLevels(0.25); }

function stopLifePhrases() {
  for (const source of Array.from(audio.active)) {
    if (!String(source._cueId || '').startsWith('life_')) continue;
    if (source._audioGain) setParam(source._audioGain.gain, 0, 0.08);
    window.setTimeout(() => { try { source.stop(); } catch (_) {} }, 100);
  }
}

function updateAudioFocus(hit) {
  if (!state.started || !audio.manifest) return;
  const targetIndex = aimedSubject(hit);
  const rect = targetIndex >= 0 && !state.sphere ? FACES[hit.face].rect : null;
  const center = rect ? (rect.left + rect.right) / 2 : 0;
  const pan = rect ? Math.max(-0.85, Math.min(0.85, (hit.u - center) / ((rect.right - rect.left) / 2))) : 0;
  if (targetIndex === audio.lifeTarget) {
    if (audio.lifeTrack && audio.lifeTrack.pan) setParam(audio.lifeTrack.pan.pan, pan, 0.08);
    return;
  }
  stopLifePhrases();
  audio.lifeTarget = targetIndex;
  setThemeLeadMuted(targetIndex >= 0);
  if (targetIndex < 0) return;
  const subject = SUBJECTS[targetIndex];
  const species = subjectCueKey(subject);
  if (!species) return;
  const collected = state.collected.some((item) => item.id === subject.id);
  const phrase = collected ? 'memory' : 'glimpse';
  window.setTimeout(() => {
    if (audio.lifeTarget !== targetIndex) return;
    const nowT = performance.now();
    audio.animalLast = audio.animalLast || {};
    if (nowT - (audio.animalLast[species] || -1e9) < 20000 || nowT - (audio.animalLastAny || -1e9) < 6000 ||
        audio.ducks.size || nowT < (audio.quietUntil || 0)) return;
    audio.animalLast[species] = nowT;
    audio.animalLastAny = nowT;
    cue('life_' + species + '_' + phrase, { bus: 'life', pan, gain: collected ? 0.72 : 0.9,
      minGap: 6000, guard: () => audio.lifeTarget === targetIndex });
  }, 700);
}

function scheduleAtmosphere() {
  clearTimeout(audio.creakTimer);
  clearTimeout(audio.whaleTimer);
  clearTimeout(audio.mysteryTimer);
  if (!state.started) return;
  scheduleCreak();
  scheduleWhale();
  scheduleMystery();
}

function scheduleCreak() {
  clearTimeout(audio.creakTimer);
  if (!state.started || (state.zone !== 'mid' && state.zone !== 'deep')) return;
  const delay = state.zone === 'mid' ? 25000 + Math.random() * 20000 : 15000 + Math.random() * 15000;
  audio.creakTimer = window.setTimeout(() => {
    if (state.zone !== 'surface' && Math.random() > 0.25 && atmosphereOk(false)) cue('hull_creak', { minGap: 0 });
    scheduleCreak();
  }, delay);
}

function scheduleWhale() {
  clearTimeout(audio.whaleTimer);
  if (!state.started || (state.zone !== 'surface' && state.zone !== 'mid')) return;
  audio.whaleTimer = window.setTimeout(() => {
    if ((state.zone === 'surface' || state.zone === 'mid') && Math.random() > 0.3 && atmosphereOk(false)) whalePassage();
    scheduleWhale();
  }, 90000 + Math.random() * 90000);
}

// The whale recording runs over a minute; each visit plays one passage of it, faded in and out.
function whalePassage() {
  const record = cueRecord('whale_distant');
  if (!record || !record.files.length || audio.muted) return;
  const path = chooseFile('whale_distant', record.files);
  loadBuffer(path).then((buffer) => {
    const length = Math.min(buffer.duration, 18 + Math.random() * 8);
    if (!playBuffer('whale_distant', buffer, { bus: record.bus, offset: Math.random() * Math.max(0, buffer.duration - length),
      duration: length, fadeIn: 3, fadeOut: 6 })) return;
    state.whaleAt = performance.now();
    state.whaleX = reticleHit(state.yaw).strip_mm[0] - 48;
    state.whaleFor = length * 1000;
    audioLog('whale_distant', 'file', path + ' · ' + Math.round(length) + ' s passage');
  }).catch((error) => audioLog('whale_distant', 'silent', error.message));
}

function scheduleMystery() {
  clearTimeout(audio.mysteryTimer);
  if (!state.started || state.zone !== 'deep') return;
  audio.mysteryTimer = window.setTimeout(() => {
    if (state.zone === 'deep' && atmosphereOk(true)) cue('deep_mystery', { minGap: 0, duck: true });
    scheduleMystery();
  }, 120000 + Math.random() * 120000);
}

function scheduleContinuousSonar() {
  clearTimeout(audio.sonarTimer);
  if (!state.started || !audio.continuousSonar) return;
  audio.sonarTimer = window.setTimeout(() => {
    if (audio.continuousSonar && performance.now() > audio.sonarUntil) cue('sonar_idle', { minGap: 0 });
    scheduleContinuousSonar();
  }, 9000 + Math.random() * 4000);
}

function prioritySound(cueId, rank) {
  if (rank < audio.priorityRank) return;
  audio.priorityCue = cueId;
  audio.priorityRank = rank;
  clearTimeout(audio.priorityTimer);
  audio.priorityTimer = window.setTimeout(() => {
    const chosen = audio.priorityCue;
    audio.priorityCue = '';
    audio.priorityRank = 0;
    audio.lastPriorityAt = performance.now();
    cue(chosen, { minGap: 0, duck: true });
  }, 90);
}

function playDiscoverySequence() {
  if (audio.mus.state === 'PLAY') endPerformance('event', 1.2);
  else if (audio.mus.state === 'FADE') audio.mus.fadeReason = 'event';
  playBridge('discovery_in').then((duration) => {
    const hold = 12;
    audio.quietUntil = performance.now() + (hold + 6) * 1000;
    window.setTimeout(() => {
      if (audio.mus.state === 'FADE') { clearTimeout(audio.mus.stopTimer); audio.mus.player = null; audio.mus.state = 'REST'; }
      startPerformance('discovery', { event: true, maxSeconds: hold });
      window.setTimeout(() => playBridge('discovery_out'), (hold - 2) * 1000);
    }, Math.min(700, duration * 300));
  });
}

function playHomeMusic() {
  if (audio.mus.state === 'PLAY') endPerformance('event', 1.5);
  window.setTimeout(() => {
    if (state.depth !== 0 || !state.started) return;
    if (audio.mus.state === 'FADE') { clearTimeout(audio.mus.stopTimer); audio.mus.player = null; audio.mus.state = 'REST'; }
    startPerformance('home', { event: true, fadeIn: 1.8 });
  }, 400);
}

function beginSonarWindow() {
  audio.sonarUntil = performance.now() + 10000;
  cue('sonar_idle', { minGap: 0, duration: 10, allowOverlap: false });
  scheduleContinuousSonar();
}

function bubbleTick() {
  audio.bubbleTimer = 0;
  if (!audio.descending || !state.started) return;
  cue('descend_bubble_pop', { minGap: 0, gain: 0.7, allowOverlap: true });
  state.bubbleBurstAt = performance.now();
  const eighths = [3, 5, 6, 8, 9, 12][Math.floor(Math.random() * 6)];
  audio.bubbleTimer = window.setTimeout(bubbleTick, eighths * BEAT.eighth * 1000);
}

function updateDepthMotion(previous, next) {
  const now = performance.now();
  const elapsed = Math.max(0.05, (now - (audio.lastDepthAt || now - 100)) / 1000);
  const speed = Math.min(1, Math.abs(next - previous) / elapsed);
  audio.lastDepthAt = now;
  activity('move');
  depthNotes(next);
  if (next > previous) {
    startBed('descend_thrust', 'descend_thrust', { level: 0.75, fadeIn: 0.3, cross: 1.2, detune: 0.05 }).then((bed) => {
      if (bed) bed.rate = 1 + speed * 0.32;
    });
    audio.descending = true;
    if (!audio.bubbleTimer) audio.bubbleTimer = window.setTimeout(bubbleTick, 700);
    clearTimeout(audio.depthMotionTimer);
    audio.depthMotionTimer = window.setTimeout(() => {
      stopBed('descend_thrust', 0.95);
      audio.descending = false; clearTimeout(audio.bubbleTimer); audio.bubbleTimer = 0;
    }, 1000);
  } else if (next < previous) {
    clearTimeout(audio.depthMotionTimer);
    stopBed('descend_thrust', 0.95);
    audio.descending = false; clearTimeout(audio.bubbleTimer); audio.bubbleTimer = 0;
    if (now - audio.lastAscendAt >= 1200) {
      audio.lastAscendAt = now;
      cue('ascend_blow', { minGap: 1200 });
    }
  }
}

// ---------------------------------------------------------------- HUD

const $ = (id) => document.getElementById(id);

// Depth zones and read-outs for the Red Sea survey the original DeepCore screen was written around
// (22.3°N 38.9°E). Pressure rises one atmosphere every ten metres; the deep Red Sea stays near 21 °C and is
// saltier than the open ocean.
const SEA_ZONES = [
  { name: 'SURFACE', max: 30, visibility: 'EXCELLENT', told: true,
    note: 'Surface zone, 0 to 30 metres. 28 °C and about 40 PSU: the Red Sea is one of the warmest and saltiest seas on Earth.' },
  { name: 'SUNLIGHT ZONE', max: 88, visibility: 'GOOD',
    note: 'Sunlight zone, 30 to 88 metres. Still bright enough for reef-building corals and the fish that live among them.' },
  { name: 'MESOPHOTIC', max: 200, visibility: 'MODERATE',
    note: 'Mesophotic zone, 88 to 200 metres. About one percent of the surface light is left; only low-light corals still photosynthesise.' },
  { name: 'TWILIGHT ZONE', max: 494, visibility: 'LOW',
    note: 'Twilight zone, 200 to 494 metres. Too dark for photosynthesis. From here down, most light is made by animals.' },
  { name: 'BATHYAL ZONE', max: 1000, visibility: 'MINIMAL',
    note: 'Bathyal zone, 494 to 1,000 metres. Pressure passes 50 atmospheres, yet the Red Sea stays near 21 °C, unusually warm for deep water.' },
  { name: 'MIDNIGHT ZONE', max: 2000, visibility: 'NONE',
    note: 'Midnight zone, 1,000 to 2,000 metres. No sunlight at all. Brine pools were found on the Red Sea floor at about 1,770 metres.' },
  { name: 'ABYSSAL ZONE', max: 1e9, visibility: 'NONE',
    note: 'Below 2,000 metres. The Red Sea is a young ocean, a rift still opening between Africa and Arabia, about 3,040 metres at its deepest.' }
];
function seaZone(metres) { return SEA_ZONES.find((zone) => metres < zone.max) || SEA_ZONES[SEA_ZONES.length - 1]; }

function updateHUD(hit) {
  const m = Math.round(state.depth * MAX_METRES);
  $('val-heading').textContent = state.yaw.toFixed(1) + ' deg';
  if (document.activeElement !== $('heading-input')) $('heading-input').value = state.yaw.toFixed(1);
  $('depth-number').textContent = m;
  $('val-pressure').textContent = (1 + m / 10).toFixed(1) + ' ATM';
  const sea = seaZone(m);
  $('val-pressure').classList.toggle('warning', m > 500);
  $('val-temp').textContent = Math.max(21, 28 - m * 0.007).toFixed(1) + '°C';
  $('val-visibility').textContent = sea.visibility;
  $('val-salinity').textContent = (40 + 0.6 * clamp01(m / 300)).toFixed(1) + ' PSU';
  $('val-panels').textContent = FACES.filter((f) => f.on).length + ' / 6';
  $('val-reticle').textContent = hit ? FACES[hit.face].id + (hit.onPanel ? '' : ' (frame)') : '—';
  $('val-specimens').textContent = state.collected.length + ' / ' + SUBJECTS.length;
  $('depth-marker').style.top = (state.depth * 100) + '%';

  const el = $('depth-zone');
  el.dataset.zone = state.zone;
  el.textContent = sea.name;
  $('depth-level').textContent = LEVEL_LABELS[state.zone] || '';
  // The first time each zone is reached, the narration box says what is known about it.
  if (state.started && audio.seaZone !== sea) {
    audio.seaZone = sea;
    if (!sea.told) { sea.told = true; say(sea.note); }
  }
}

function setLiveBanner(status, deg, reason) {
  const connected = status === 'live';
  if (state.started && connected !== audio.boardConnected) cue(connected ? 'board_link_on' : 'board_link_off');
  audio.boardConnected = connected;
  const banner = document.querySelector('.twin-banner');
  if (!banner) return;
  if (status === 'live') banner.textContent = 'LIVE — MAGNET yaw ' + deg.toFixed(1) + '°';
  else if (status === 'simulated') banner.textContent = 'SIMULATED — NO BOARD';
  else if (status === 'disconnected') {
    const message = String(reason || 'board disconnected');
    const labels = {
      'port not found': 'BOARD — PORT NOT FOUND',
      'no data (wrong firmware?)': 'BOARD — NO DATA; CHECK LIVE-YAW FIRMWARE',
      'board is running diagnostic firmware, flash live-yaw': 'BOARD — DIAGNOSTIC FIRMWARE; USE LIVE-YAW',
      'sensor unavailable (AS5600 not responding)': 'BOARD — AS5600 SENSOR UNAVAILABLE',
      'bridge unavailable': 'BOARD — BRIDGE UNAVAILABLE'
    };
    banner.textContent = labels[message] || ('BOARD DISCONNECTED — ' + message.toUpperCase());
  }
}

function initLiveYaw() {
  if (new URLSearchParams(location.search).get('live') !== '1') return;
  state.liveMode = true;
  state.liveConnected = false;
  state.liveTargetYaw = state.yaw;
  setLiveBanner('disconnected');
  let inFlight = false;
  const poll = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const response = await fetch('/yaw?ts=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (data.ok === true && Number.isFinite(Number(data.deg))) {
        state.liveConnected = true;
        state.liveTargetYaw = ((Number(data.deg) % 360) + 360) % 360;
        setLiveBanner(data.simulated ? 'simulated' : 'live', state.liveTargetYaw);
      } else {
        state.liveConnected = false;
        setLiveBanner('disconnected', null, data.reason);
      }
    } catch (error) {
      state.liveConnected = false;
      setLiveBanner('disconnected', null, 'bridge unavailable');
    } finally {
      inFlight = false;
    }
  };
  poll();
  setInterval(poll, 50);
}

const say = (text) => {
  const narration = $('narration');
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  narration.replaceChildren(document.createTextNode(String(text)), cursor);
};

function showVoiceNarration(id, values) {
  const lines = VOICE_LINES[id];
  if (!lines || !$('narration')) return;
  const params = values || {};
  say(String(lines.en || '').replace('{names}', params.enNames || params.names || ''));
}

// ---------------------------------------------------------------- actions

// ---------------------------------------------------------------- species card and analysis list
const LEVEL_LABELS = { surface: 'LEVEL 1 · CORAL REEF', mid: 'LEVEL 2 · SHIPWRECK', deep: 'LEVEL 3 · VOLCANIC VENTS' };
// What each creature on the cube stands for. sci = scientific name, range = where it really lives.
const SPECIES = {
  shoal: { sci: 'Pseudanthias squamipinnis', common: 'Sea Goldie (Lyretail Anthias)',
    lines: ['Clouds of these orange-gold fish hover over Red Sea reefs, picking plankton out of the current.',
      'Every one is born female; the largest in a group turns into a male.'],
    range: 'Depth: 0–55 m / Coral reef', source: 'FishBase' },
  reef: { sci: 'Amphiprion bicinctus', common: 'Red Sea Clownfish',
    lines: ['The two-banded anemonefish, native to the Red Sea and the Gulf of Aden.',
      'Lives among the stinging tentacles of sea anemones, protected by its own coat of mucus.'],
    range: 'Depth: 1–30 m / Coral reef', source: 'FishBase' },
  seahorse: { sci: 'Hippocampus fuscus', common: 'Sea Pony',
    lines: ['A small seahorse of sheltered seagrass beds in the Red Sea and Indian Ocean; it anchors itself with its tail.',
      'The male carries the eggs in a belly pouch and gives birth to the young.'],
    range: 'Depth: shallow water, to about 10 m / Seagrass', source: 'FishBase' },
  manta: { sci: 'Mobula alfredi', common: 'Reef Manta Ray',
    lines: ['Filter-feeds on plankton, with a wingspan of up to about 5 metres.',
      'Mantas have the largest brain of any fish. Tagged Red Sea mantas have dived deeper than 400 m.'],
    range: 'Depth: mostly the top 30 m, dives past 400 m / Reefs and open water', source: 'FishBase; Braun et al. 2014, PLoS ONE' },
  lantern: { sci: 'Benthosema pterotum', common: 'Skinnycheek Lanternfish',
    lines: ['The most abundant fish of the Red Sea twilight zone: about 5 cm long, with rows of light organs along its belly.',
      'Spends the day in the dark far below and swims up towards the surface every night to feed.'],
    range: 'Depth: near the surface at night, about 300–800 m by day / Open water', source: 'FishBase' },
  jelly: { sci: 'Atolla wyvillei', common: 'Atolla (Crown) Jellyfish',
    lines: ['A deep-red jellyfish of the midnight zone, found in oceans around the world.',
      'When attacked it sets off a spinning ring of blue flashes, a "burglar alarm" that draws in bigger predators.'],
    range: 'Depth: about 1,000–4,000 m / Open water', source: 'SeaLifeBase' },
  angler: { sci: 'Melanocetus johnsonii', common: 'Humpback Anglerfish',
    lines: ['An ambush predator of the deep. The female dangles a glowing lure in front of a mouth full of long teeth.',
      'The light is made by bacteria living in the lure. Females reach about 15 cm; males stay under 3 cm.'],
    range: 'Depth: about 200–1,500 m / Open water', source: 'FishBase' },
  squid: { sci: 'Vampyroteuthis infernalis', common: 'Vampire Squid',
    lines: ['Neither a true squid nor an octopus: the only living member of its own order.',
      'Lives where there is almost no oxygen, carries light organs on its arm tips, and squirts glowing mucus instead of ink.'],
    range: 'Depth: about 600–1,200 m / Oxygen minimum zone', source: 'SeaLifeBase' }
};
const card = { timer: 0, items: [] };

function cardAnimate() {
  clearInterval(card.timer);
  let t = state.seconds;
  const paint = () => {
    if (!$('discovery-popup').classList.contains('show')) { clearInterval(card.timer); return; }
    t += 0.08;
    card.items.forEach((item, index) => paintCreature(item.canvas, item.subject, t + index * 1.3, item.depth));
  };
  paint();
  card.timer = window.setInterval(paint, 80);
}

function showSpeciesCard(subject, sample) {
  const key = subjectCueKey(subject), info = SPECIES[key] || { lines: [] }, done = state.collected.length >= SUBJECTS.length;
  $('discovery-title').textContent = (done ? '★ ALL SPECIMENS COLLECTED ★' : '★ NEW SPECIMEN COLLECTED ★') + '  ' + state.collected.length + ' / ' + SUBJECTS.length;
  const art = $('discovery-art');
  art.hidden = false;
  $('discovery-emoji').textContent = '';
  $('discovery-species').textContent = info.sci || subject.name;
  $('discovery-sub').textContent = (info.common || subject.name) + ' · on the cube: ' + subject.name;
  const rows = (info.lines || []).map((text) => { const row = document.createElement('div'); row.textContent = text; return row; });
  const range = document.createElement('div'), log = document.createElement('div');
  range.className = 'fact';
  range.textContent = (info.range || '') + (info.source ? ' / Source: ' + info.source : '');
  log.className = 'logged';
  log.textContent = 'Sample logged at ' + Math.round(sample.depth * MAX_METRES) + ' m · ' + (LEVEL_LABELS[sample.zone] || '') + ' · 22.3°N 38.9°E';
  $('discovery-info').replaceChildren(...rows, range, log);
  card.items = [{ canvas: art, subject, depth: sample.depth }];
  $('discovery-popup').classList.add('show');
  cardAnimate();
}

function showAnalysis() {
  $('discovery-title').textContent = 'ANALYSIS';
  $('discovery-art').hidden = true;
  $('discovery-emoji').textContent = 'ANALYSIS';
  $('discovery-species').textContent = state.collected.length + ' / ' + SUBJECTS.length + ' specimens';
  $('discovery-sub').textContent = state.collected.length >= SUBJECTS.length ? 'Every species in this survey has been collected.' : 'Species not found yet are listed with the level they live on.';
  const rows = [], items = [];
  const order = SUBJECTS.map((_, index) => index).sort((x, y) => SUBJECTS[x].y_mm - SUBJECTS[y].y_mm);
  for (const index of order) {
    const subject = SUBJECTS[index], sample = state.collected.find((c) => c.id === subject.id), info = SPECIES[subjectCueKey(subject)] || {};
    const row = document.createElement('div'), text = document.createElement('div'), name = document.createElement('div'), meta = document.createElement('div');
    row.className = 'specimen-row' + (sample ? '' : ' missing');
    name.className = 'name'; meta.className = 'meta';
    if (sample) {
      const canvas = document.createElement('canvas');
      canvas.width = 168; canvas.height = 100;
      row.append(canvas);
      items.push({ canvas, subject, depth: sample.depth });
      const sci = document.createElement('i');
      sci.textContent = info.sci || subject.name;
      name.append(sci);
      meta.textContent = (info.common || subject.name) + ' · logged at ' + Math.round(sample.depth * MAX_METRES) + ' m';
    } else {
      const unknown = document.createElement('div');
      unknown.className = 'unknown'; unknown.textContent = '?';
      row.append(unknown);
      const home = 0.1 + (subject.y_mm - geometry.aimHeightMm) / geometry.depthTravelMm;
      name.textContent = 'Not found yet';
      meta.textContent = LEVEL_LABELS[home < ZONE_BOUNDS[0] ? 'surface' : home < ZONE_BOUNDS[1] ? 'mid' : 'deep'];
    }
    text.append(name, meta); row.append(text); rows.push(row);
  }
  $('discovery-info').replaceChildren(...rows);
  card.items = items;
  $('discovery-popup').classList.add('show');
  cardAnimate();
}

// ---------------------------------------------------------------- levels: a floor with one way through
// Each level ends in a floor (config.gates). The reticle is where the sub is, so a floor can only be passed, in
// either direction, while the reticle is over the opening. renderer.js draws the floors; this is the rule.
const GATES_ON = !/[?&](acceptance=1|gates=0)/.test(location.search);
state.gatesOff = !GATES_ON;
const GATE_AHEAD = {
  reef: 'Sand and a coral reef below · turn the box to find the way down',
  wreck: 'A shipwreck on a rock shelf below · look for the glowing rift to go deeper'
};

function gateList() { return GATES_ON && config && config.gates || []; }
// Millimetres along the strip from the reticle to the opening; positive means turn right.
function gateOffset(gate) {
  const L = geometry.stripLengthMm;
  return geometry.wrapDistance(gate.u * L, ((state.yaw / 360 * L) % L + L) % L);
}
function gateOpen(gate) { return Math.abs(gateOffset(gate)) <= gate.half_mm * 0.8; }

function syncLevel(depth) {
  const list = gateList();
  let level = 0;
  list.forEach((gate, index) => {
    if (depth > gate.depth + 1e-9 || Math.abs(depth - gate.depth) <= 1e-9 && state.level > index) level = index + 1;
  });
  state.level = level;
}

function gateBump(gate, dir) {
  const now = performance.now();
  if (now - (audio.bumpAt || 0) < 1500) return;
  audio.bumpAt = now;
  gate.bumps = (gate.bumps || 0) + 1;
  cue('hull_creak', { minGap: 0 });
  const way = dir > 0 ? 'the way down' : 'the way up';
  const side = gateOffset(gate) > 0 ? 'turn right ▶' : '◀ turn left';
  const text = (dir > 0 ? 'The floor is in the way' : 'Rock overhead') + ' · ' + (gate.bumps > 1 ? side + ' to find ' + way : 'turn the box to find ' + way);
  showPill(text, 3200);
  say(text);
}

function gatePassed(gate, dir) {
  gate.bumps = 0;
  audio.gatePassAt = performance.now();
  state.bubbleBurstAt = performance.now();
  say((dir > 0 ? 'Through the gap, down to ' : 'Back up to ') + LEVEL_LABELS[['surface', 'mid', 'deep'][Math.min(2, state.level)]] + '.');
}

// Where the sub actually ends up when it tries to go from one depth to another.
function passGates(previous, next) {
  const list = gateList();
  if (!list.length) return next;
  syncLevel(previous);
  for (;;) {
    if (next > previous && state.level < list.length && next > list[state.level].depth) {
      const gate = list[state.level];
      if (!gateOpen(gate)) { gateBump(gate, 1); return gate.depth; }
      state.level++; gatePassed(gate, 1);
    } else if (next < previous && state.level > 0 && next < list[state.level - 1].depth) {
      const gate = list[state.level - 1];
      if (!gateOpen(gate)) { gateBump(gate, -1); return gate.depth; }
      state.level--; gatePassed(gate, -1);
    } else return next;
  }
}

// Every frame: is the reticle over a way through that is within reach? (renderer.js turns the reticle gold.)
function updateGates() {
  const list = gateList();
  let ready = 0;
  if (list.length && state.started) {
    const below = list[state.level], above = list[state.level - 1];
    if (below && below.depth - state.depth < 0.06 && gateOpen(below)) ready = 1;
    else if (above && state.depth - above.depth < 0.06 && gateOpen(above)) ready = -1;
    if (below && !below.seen && below.depth - state.depth < 0.11) {
      below.seen = true;
      showPill(GATE_AHEAD[below.kind] || 'Turn the box to find the way down', 4200);
      say(GATE_AHEAD[below.kind] || 'Turn the box to find the way down');
    }
    if (!below && !audio.seaBedSeen && state.depth > 0.9) {
      audio.seaBedSeen = true;
      say('The sea bed: black basalt, glowing lava cracks and hydrothermal vents.');
    }
  }
  if (ready && ready !== state.gateReady && performance.now() - (audio.gatePassAt || 0) > 2500) {
    showPill(ready > 0 ? 'Found the gap · hold ▼ to dive' : 'Found the gap · hold ▲ to rise', 2600);
    handNote(74, 1);
    window.setTimeout(() => handNote(81, 1), 170);
  }
  state.gateReady = ready;
}

function doScan() {
  renderPanels();
  const hit = reticleHit(state.yaw);
  if (!hit || !hit.onPanel) {
    cue('action_error'); speakLine('vo_on_frame');
    say('The reticle is on the printed frame, not on a panel. Nothing to scan.'); return;
  }
  const s = aimedSubject(hit);
  const fx = $('scan-effect');
  fx.classList.remove('active'); void fx.offsetWidth; fx.classList.add('active');
  state.sweepStart = performance.now();
  state.highlightUntil = performance.now() + HIGHLIGHT_MS;
  cue('scan_sweep', { minGap: 0 });
  activity('act');
  beginSonarWindow();
  if (s < 0) say('Scan on face ' + FACES[hit.face].id + ': open water.');
  else say('Scan on face ' + FACES[hit.face].id + ': ' + SUBJECTS[s].name + ' is in the reticle. Press 2 to collect.');
  const sweepFile = cueRecord('scan_sweep') && cueRecord('scan_sweep').files[0];
  const sweepBuffer = sweepFile && audio.buffers.get(sweepFile);
  const resultDelay = Math.max(500, ((sweepBuffer && sweepBuffer.duration) || 1.8) * 1000 + 500);
  clearTimeout(audio.scanTimer);
  audio.scanTimer = window.setTimeout(() => {
    if (s < 0) {
      cue('scan_miss', { minGap: 0 });
      window.setTimeout(() => speakLine('vo_scan_miss'), 350);
      return;
    }
    const subject = SUBJECTS[s];
    const first = !state.scannedSubjects.includes(subject.id);
    if (first) state.scannedSubjects.push(subject.id);
    cue('scan_hit', { minGap: 0 });
    sparkleFor(7);
    const species = subjectCueKey(subject);
    if (species) window.setTimeout(() => cue('life_' + species + (first ? '_known' : '_glimpse'), { bus: 'life', minGap: 0, gain: 0.9, force: true }), 300);
    if (first) {
      prioritySound('first_discovery', 2);
      playDiscoverySequence();
    }
    window.setTimeout(() => speakLine('vo_scan_hit'), 350);
  }, resultDelay);
}

function doCollect() {
  renderPanels();
  const hit = reticleHit(state.yaw);
  const s = aimedSubject(hit);
  if (s < 0) { cue('action_error'); speakLine('vo_nothing'); say('Nothing under the reticle to collect.'); return; }
  if (state.collected.some((c) => c.id === SUBJECTS[s].id)) {
    cue('collect_duplicate'); speakLine('vo_duplicate');
    say(SUBJECTS[s].name + ' is already in the sample tray.'); return;
  }
  state.collectFlash = performance.now();
  activity('act'); sparkleFor(6);
  state.collectFace = hit.face;
  state.collectXY = [hit.pixel_uv[0] * 240, hit.pixel_uv[1] * 240];
  state.collected.push({ id: SUBJECTS[s].id, depth: state.depth, zone: state.zone, face: FACES[hit.face].id });
  if (state.collected.length >= SUBJECTS.length) {
    prioritySound('mission_complete', 3);
    window.setTimeout(() => speakLine('vo_complete'), 550);
  } else {
    prioritySound('collect_success', 1);
    window.setTimeout(() => speakLine('vo_collect'), 500);
  }
  // A collected sample brings up its species card; Analyze lists the whole tray.
  say('Sample stored: ' + SUBJECTS[s].name + ' — ' + state.collected.length + ' of ' + SUBJECTS.length +
    ' in the tray. Press 3 to analyse.');
  showSpeciesCard(SUBJECTS[s], state.collected[state.collected.length - 1]);
}

// Dive assist: keep every creature outlined until it is switched off again.
function toggleHighlight() {
  state.highlight = !state.highlight;
  const button = $('btn-highlight');
  if (button) button.setAttribute('aria-pressed', state.highlight ? 'true' : 'false');
  cue(state.highlight ? 'dive_assist_on' : 'dive_assist_off');
  say(state.highlight ? 'Dive assist on: every creature in view is outlined.' : 'Dive assist off.');
}

function doAnalyze() {
  if (state.collected.length === 0) { cue('action_error'); speakLine('vo_tray_empty'); say('The sample tray is empty. Collect something first.'); return; }
  cue('analyze_open');
  activity('act');
  const names = state.collected.map((c) => SUBJECTS.find((s) => s.id === c.id).name);
  showAnalysis();
  const last = state.collected[state.collected.length - 1];
  const lastSubject = SUBJECTS.find((subject) => subject.id === last.id);
  const species = subjectCueKey(lastSubject);
  if (species) cue('life_' + species + '_memory', { bus: 'life', gain: 0.72, minGap: 6000 });
  const nameKeys = state.collected.map((item) => subjectCueKey(SUBJECTS.find((subject) => subject.id === item.id))).filter(Boolean);
  const thNames = nameKeys.map((key) => VOICE_SPECIES[key]).filter(Boolean).join(' ');
  const enNames = names.join(', ');
  window.setTimeout(() => speakLine('vo_analyze', { thNames, enNames, nameKeys }), 500);
  say('Analysis of ' + state.collected.length + ' sample(s): ' + names.join(', ') + '.');
}

// ---------------------------------------------------------------- input

function setDepth(next, free) {
  const previous = state.depth;
  state.depth = free ? clamp01(next) : passGates(previous, clamp01(next));
  if (free) syncLevel(state.depth);
  if (state.started && state.depth !== previous) updateDepthMotion(previous, state.depth);
  updateZone(state.depth);
  $('depth-input').value = state.depth;
  if (previous < 1 && state.depth >= 1) { cue('max_depth_warning', { duck: true }); speakLine('vo_max_depth'); }
  if (previous > 0 && state.depth <= 0) {
    cue('surface_break', { duck: true }); speakLine('vo_surface');
    playHomeMusic();
  }
}

// ---------------------------------------------------------------- motion: the sub has mass
// Depth and heading are driven by a speed that eases towards what the controls ask for, so the sub gathers way
// when a control is held and glides to a stop after it is released. A short tap is a small nudge. Turning by
// drag is direct while the finger is down and coasts on from the speed it was released at.
const MOTION = { depthSpeed: 0.055, depthRise: 0.55, depthFall: 0.6, yawSpeed: 48, yawRise: 0.35, yawFall: 0.4, fling: 200 };
const motion = { key: { up: false, down: false, left: false, right: false }, pad: { depth: 0, yaw: 0 },
  depthVel: 0, yawVel: 0, dragVel: 0, dragAt: 0, last: 0 };

function easeSpeed(value, target, dt, rise, fall) {
  const gathering = target !== 0 && (value === 0 || Math.sign(target) === Math.sign(value)) && Math.abs(target) >= Math.abs(value);
  return value + (target - value) * (1 - Math.exp(-dt / (gathering ? rise : fall)));
}

function motionStep(now) {
  requestAnimationFrame(motionStep);
  const dt = Math.min(0.2, Math.max(0, (now - (motion.last || now)) / 1000));   // stays true to the clock on a slow device
  motion.last = now;
  if (!state.started) return;
  const depthInput = Math.max(-1, Math.min(1, (motion.key.down ? 1 : 0) - (motion.key.up ? 1 : 0) + motion.pad.depth));
  motion.depthVel = easeSpeed(motion.depthVel, depthInput * MOTION.depthSpeed, dt, MOTION.depthRise, MOTION.depthFall);
  if (Math.abs(motion.depthVel) > 0.0003) {
    const want = clamp01(state.depth + motion.depthVel * dt);
    setDepth(want);
    // Stopped dead by a floor, the surface or the sea bed.
    if (Math.abs(state.depth - want) > 1e-9 || want <= 0 && motion.depthVel < 0 || want >= 1 && motion.depthVel > 0) motion.depthVel = 0;
  } else if (!depthInput) motion.depthVel = 0;
  const live = state.liveMode && state.liveConnected;
  if (dragging || live) { motion.yawVel = 0; return; }
  const yawInput = Math.max(-1, Math.min(1, (motion.key.right ? 1 : 0) - (motion.key.left ? 1 : 0) + motion.pad.yaw));
  motion.yawVel = easeSpeed(motion.yawVel, yawInput * MOTION.yawSpeed, dt, MOTION.yawRise, MOTION.yawFall);
  if (Math.abs(motion.yawVel) > 0.05) setYaw(state.yaw + motion.yawVel * dt);
  else if (!yawInput) motion.yawVel = 0;
}

function dragTurn(clientX) {
  const now = performance.now(), turn = (clientX - lastX) * 0.4, elapsed = Math.max(8, now - (motion.dragAt || now - 16));
  motion.dragVel = 0.6 * motion.dragVel + 0.4 * (turn / elapsed * 1000);
  motion.dragAt = now;
  setYaw(state.yaw + turn);
}
function dragStart() { dragging = true; motion.dragVel = 0; motion.yawVel = 0; motion.dragAt = performance.now(); }
function dragEnd() {
  if (dragging && performance.now() - motion.dragAt < 90) motion.yawVel = Math.max(-MOTION.fling, Math.min(MOTION.fling, motion.dragVel));
  dragging = false;
}
function motionRelease() { motion.key.up = motion.key.down = motion.key.left = motion.key.right = false; motion.pad.depth = 0; motion.pad.yaw = 0; }

function depthHoldStop() { motion.pad.depth = 0; }
function depthHoldStart(dir) { motion.pad.depth = dir; }

// Friends open the page with no hardware: the player view hides the engineering controls and adds on-screen
// buttons. ?dev=1 (and the live-board and acceptance runs) keep the full twin.
const DEV_MODE = /[?&](dev|live|acceptance)=1/.test(location.search);
state.pretty = !/[?&](acceptance=1|sprites=blocks)/.test(location.search);
if (!DEV_MODE) {
  document.body.classList.add('player', 'hide-labels');
  state.labels = false;
  state.grid = false;
  orbit.dist = 3.5;
}

function yawHoldStop() { motion.pad.yaw = 0; }
function yawHoldStart(dir) { motion.pad.yaw = dir; }

// Cube or sphere: the same sea on a different body. The choice is remembered on this device.
const SHAPE_KEY = 'deepSphereShape';
function setShape(sphere, remember) {
  state.sphere = Boolean(sphere);
  applyShape();
  const button = $('btn-shape');
  if (button) { button.textContent = state.sphere ? 'Shape: sphere' : 'Shape: cube'; button.setAttribute('aria-pressed', state.sphere ? 'true' : 'false'); }
  if (remember !== false) { try { window.localStorage.setItem(SHAPE_KEY, state.sphere ? 'sphere' : 'cube'); } catch (_) {} }
}
function initShape() {
  const asked = new URLSearchParams(location.search).get('shape');
  let saved = '';
  try { saved = window.localStorage.getItem(SHAPE_KEY) || ''; } catch (_) {}
  if (!DEV_MODE && (asked || saved) === 'sphere' || asked === 'sphere') setShape(true, false);
  const button = $('btn-shape');
  if (button) button.addEventListener('click', () => setShape(!state.sphere));
}

function initPad() {
  const hold = (id, down, up) => {
    const el = $(id);
    if (!el) return;
    const release = () => { el.classList.remove('held'); up(); };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.classList.add('held'); try { el.setPointerCapture(e.pointerId); } catch (_) {} down(); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) => el.addEventListener(type, release));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  hold('pad-up', () => depthHoldStart(-1), depthHoldStop);
  hold('pad-down', () => depthHoldStart(1), depthHoldStop);
  hold('pad-left', () => yawHoldStart(-1), yawHoldStop);
  hold('pad-right', () => yawHoldStart(1), yawHoldStop);
  const sound = $('btn-sound');
  if (sound) sound.addEventListener('click', toggleMute);
}

function initInput() {
  const el = renderer.domElement;
  el.addEventListener('mousedown', (e) => { if (state.liveMode && state.liveConnected) return; dragStart(); lastX = e.clientX; lastY = e.clientY; document.body.style.cursor = 'grabbing'; });
  window.addEventListener('mouseup', () => { dragEnd(); document.body.style.cursor = 'grab'; });
  window.addEventListener('mousemove', (e) => {
    if (!dragging || (state.liveMode && state.liveConnected)) return;
    // Sideways drag turns the box on its own standing axis, the same one the arrow keys drive.
    // The mounted body diagonal remains vertical during yaw.
    dragTurn(e.clientX);
    lastX = e.clientX; lastY = e.clientY;
  });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.dist = Math.max(1.6, Math.min(7, orbit.dist + e.deltaY * 0.002));
  }, { passive: false });

  el.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1 && !(state.liveMode && state.liveConnected)) { dragStart(); lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; }
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!dragging || e.touches.length !== 1 || (state.liveMode && state.liveConnected)) return;
    dragTurn(e.touches[0].clientX);
    lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', dragEnd);
  el.addEventListener('touchcancel', dragEnd);

  // config/controls.json laptop_demo_input.keys
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof Element && e.target.matches('input, select, textarea')) return;
    switch (e.code) {
      case 'ArrowUp': e.preventDefault(); motion.key.up = true; break;
      case 'ArrowDown': e.preventDefault(); motion.key.down = true; break;
      case 'ArrowLeft': e.preventDefault(); motion.key.left = true; break;
      case 'ArrowRight': e.preventDefault(); motion.key.right = true; break;
      case 'KeyH': e.preventDefault(); toggleHighlight(); break;
      case 'Digit1': case 'Numpad1': e.preventDefault(); doScan(); break;
      case 'Digit2': case 'Numpad2': e.preventDefault(); doCollect(); break;
      case 'Digit3': case 'Numpad3': e.preventDefault(); doAnalyze(); break;
      case 'KeyR': orbit = { theta: -1.3, phi: 1.32, dist: DEV_MODE ? 4.4 : 3.5 }; fitOrbit(); motion.depthVel = 0; motion.yawVel = 0; setYaw(0); setDepth(0, true); break;
      case 'Enter': case 'Escape': if ($('discovery-popup').classList.contains('show')) $('btn-discovery-close').click(); break;
      case 'KeyD': e.preventDefault(); setDebug(!audio.debug); break;
      case 'KeyB': setShape(!state.sphere); break;
      case 'KeyN': audio.handNotes = !audio.handNotes; say(audio.handNotes ? 'Hand notes on.' : 'Hand notes off.'); break;
      case 'KeyM':
        toggleMute();
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    const name = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.code];
    if (name) motion.key[name] = false;
  });
  window.addEventListener('blur', motionRelease);
  requestAnimationFrame(motionStep);
  initPad();
  initShape();

  $('btn-scan').addEventListener('click', doScan);
  $('btn-collect').addEventListener('click', doCollect);
  $('btn-analyze').addEventListener('click', doAnalyze);
  $('btn-mute').addEventListener('click', toggleMute);
  $('btn-discovery-close').addEventListener('click', () => {
    $('discovery-popup').classList.remove('show'); card.items = []; cue('analyze_close');
  });
}


async function start() {
  if (state.started || state.starting) return;
  state.starting = true;
  const button = $('btn-start');
  button.disabled = true;
  try {
    ensureAudioGraph();
    await audio.context.resume();
    audio.clock0 = audio.context.currentTime;
    state.started = true;
    let welcomeQueued = false;
    const queueWelcome = () => {
      if (welcomeQueued) return;
      welcomeQueued = true;
      window.setTimeout(() => speakLine('vo_welcome'), 750);
    };
    const diveStart = cue('dive_start', { minGap: 0, onended: queueWelcome });
    diveStart.then((played) => {
      if (!played) { queueWelcome(); return; }
      const source = audio.activeCues.get('dive_start');
      const durationMs = source && source.buffer ? Math.ceil(source.buffer.duration * 1000) : 0;
      if (durationMs) window.setTimeout(queueWelcome, durationMs + 150);
      else queueWelcome();
    }).catch(queueWelcome);
    if (audio.manifest) await preloadSession();
    $('intro').classList.add('hide');
    playAmbient(state.zone);
    scheduleAtmosphere();
    scheduleContinuousSonar();
    // The opening: two phrases of the invitation, then the sea is left alone until the player moves.
    window.setTimeout(() => startPerformance('invite', { fromStart: true, phrases: 2, hold: BEAT.phrase }), 900);
    if (audio.boardConnected) cue('board_link_on');
    say('Deep Sphere online. Red Sea survey, 22.3°N 38.9°E. Drag to turn the box, hold ▼ to dive, and find the way down through each level.');
  } catch (error) {
    console.error(error);
    button.textContent = 'AUDIO UNAVAILABLE — RETRY';
    button.disabled = false;
  } finally {
    state.starting = false;
  }
}

init().catch(error => {
  console.error(error);
  $('btn-start').textContent = 'LOAD FAILED - RELOAD';
  $('narration').textContent = error.message;
});

initLiveYaw();
