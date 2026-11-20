// Twin audio, HUD and controls; geometry and rendering live in renderer.js.
'use strict';

// ---------------------------------------------------------------- language: Thai (default) / English
// ?lang=en or ?lang=th forces a language; otherwise the saved choice (localStorage), otherwise Thai. Voice-over stays English.
const LANG_KEY = 'deepSphereLang';
let LANG = 'th';
(function pickLang() {
  let asked = null;
  try { asked = new URLSearchParams(location.search).get('lang'); } catch (_) {}
  if (asked === 'en' || asked === 'th') { LANG = asked; return; }
  try { const saved = window.localStorage.getItem(LANG_KEY); if (saved === 'en' || saved === 'th') LANG = saved; } catch (_) {}
})();
const L = (th, en) => ({ th, en });
const tx = (value) => (value && typeof value === 'object') ? (value[LANG] != null ? value[LANG] : value.en) : (value == null ? '' : String(value));

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
  voiceCurrentId: '', voicePendingId: '',
  eventTimer: null, eventPillTimer: 0, priorityEvent: '', priorityRank: 0, lastPriorityAt: 0,
  depthMotionTimer: 0, lastAscendAt: 0, boardConnected: false
};

const VOICE_LINES = {
  vo_welcome: { th: 'ปิดฝาเรียบร้อย ทุกระบบพร้อม เริ่มดำลงได้', en: 'Hatch sealed. All systems ready. Beginning our descent.' },
  vo_zone_mid: { th: 'ผ่าน 760 เมตรแล้ว แสงจากผิวน้ำลงมาไม่ถึงตรงนี้', en: 'Passing 760 metres. Sunlight does not reach this far.' },
  vo_zone_deep: { th: 'ต่ำกว่า 1,976 เมตรแล้ว เปิดไฟส่อง', en: 'Below 1,976 metres. Floodlights on.' },
  vo_zone_deep_v2: { th: 'ต่ำกว่า 1,976 เมตรแล้ว เปิดไฟส่อง', en: 'Below 1,976 metres. Floodlights on.' },
  vo_scan_hit: { th: 'มีสัญญาณสิ่งมีชีวิตในเป้าเล็ง', en: 'Life signal in the reticle.' },
  vo_scan_miss: { th: 'ไม่มีสัญญาณ ตรงนี้มีแต่น้ำ', en: 'No signal. Open water.' },
  vo_on_frame: { th: 'เป้าเล็งอยู่บนขอบจอ หมุนต่ออีกนิด', en: 'The reticle is on the frame. Turn a little further.' },
  vo_collect: { th: 'เก็บตัวอย่างเข้าถาดแล้ว', en: 'Sample secured.' },
  vo_duplicate: { th: 'ตัวนี้อยู่ในถาดแล้ว', en: 'Already in the tray.' },
  vo_nothing: { th: 'ไม่มีอะไรในเป้าให้เก็บ', en: 'Nothing in the reticle to collect.' },
  vo_tray_empty: { th: 'ถาดยังว่าง ลองเก็บตัวอย่างก่อน', en: 'The tray is empty. Collect a sample first.' },
  vo_analyze: { th: 'วิเคราะห์เสร็จ พบ {names}', en: 'Analysis complete: {names}.' },
  vo_max_depth: { th: 'ถึงความลึกสูงสุด 3,040 เมตร การดำลงสิ้นสุดที่นี่', en: 'Maximum depth: 3,040 metres. The descent ends here.' },
  vo_max_depth_v2: { th: 'ถึงความลึกสูงสุด 3,040 เมตร การดำลงสิ้นสุดที่นี่', en: 'Maximum depth: 3,040 metres. The descent ends here.' },
  vo_gate_hint: { th: 'พื้นอยู่ใกล้แล้ว หมุนทรงกลมเพื่อหาช่อง', en: 'The floor is close. Turn the sphere to find the opening.' },
  vo_gate_found: { th: 'พบช่องแล้ว กดดำลงเพื่อผ่าน', en: 'Opening found. Hold dive to pass through.' },
  vo_gate_pass: { th: 'ผ่านช่องแล้ว ยินดีต้อนรับสู่ชั้นถัดไป', en: 'Through the opening. Welcome to the next level.' },
  vo_surface: { th: 'ขึ้นถึงผิวน้ำแล้ว', en: 'We have reached the surface.' },
  vo_complete: { th: 'เก็บครบทั้งแปดตัวอย่าง ภารกิจสำเร็จ', en: 'All eight samples collected. Mission complete.' }
};

const VOICE_SPECIES = {
  shoal: 'ฝูงปลาผิวน้ำ', reef: 'ปลาแนวปะการังสีส้ม', seahorse: 'ม้าน้ำ',
  manta: 'กระเบนราหู', lantern: 'ปลาตะเกียง', jelly: 'แมงกะพรุน',
  angler: 'ปลาตกเบ็ดทะเลลึก', squid: 'หมึกยักษ์ทะเลลึก'
};

const AUDIO_EVENT_LABELS = {
  zone_enter_mid: L('ชั้น 2 · ซากเรือจม', 'Level 2 · Shipwreck shelf'),
  zone_enter_deep: L('ชั้น 3 · ปล่องภูเขาไฟใต้ทะเล', 'Level 3 · Volcanic vents'),
  zone_up: L('กำลังลอยขึ้น', 'Heading back up'),
  scan_hit: L('พบสิ่งมีชีวิต', 'Life detected'),
  first_discovery: L('พบสายพันธุ์ใหม่', 'New species found'),
  collect_success: L('เก็บตัวอย่างแล้ว', 'Sample collected'),
  mission_complete: L('ภารกิจสำเร็จ', 'Mission complete'),
  max_depth_warning: L('คำเตือน: ถึงความลึกสูงสุดแล้ว', 'Warning: maximum depth')
};

function showAudioEvent(cueId) {
  if (AUDIO_EVENT_LABELS[cueId]) showPill(AUDIO_EVENT_LABELS[cueId], 2800);
}

function showPill(text, ms) {
  const pill = $('audio-event-pill');
  const label = $('audio-event-label');
  if (!text || !pill || !label) return;
  clearTimeout(audio.eventPillTimer);
  label.textContent = String(tx(text)).replace(/\bthe box\b/gi, 'the sphere').replace(/\bthe cube\b/gi, 'the sphere');
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
    setStartLabel('sound', loaded, paths.length);
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
  vo_zone_mid: { cool: 60 }, vo_zone_deep: { cool: 60 }, vo_zone_deep_v2: { cool: 60 },
  vo_gate_hint: { cool: 25 }, vo_gate_found: { cool: 20 }, vo_gate_pass: { cool: 0 }
};
const VOICE_ALWAYS = ['vo_welcome', 'vo_analyze', 'vo_complete', 'vo_max_depth', 'vo_max_depth_v2', 'vo_surface', 'vo_gate_pass'];
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
  const gatePassCovered = audio.gatePassVoiceZone === next;
  if (gatePassCovered) audio.gatePassVoiceZone = '';
  audio.zoneCueAt = audio.zoneCueAt || {};
  const zoneRepeat = performance.now() - (audio.zoneCueAt[zoneKey] || -1e9) < 20000;
  if (!zoneRepeat) audio.zoneCueAt[zoneKey] = performance.now();
  if (zoneRepeat) {
    audioLog('zone_' + zoneKey, 'silent', 'zone cue cooldown');
  } else if (next === 'mid' && down) {
    cue('zone_enter_mid', { duck: true });
    if (!gatePassCovered) speakLine('vo_zone_mid');
  } else if (next === 'deep' && down) {
    cue('zone_enter_deep', { duck: true });
    if (!gatePassCovered) speakLine('vo_zone_deep_v2');
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
  if (sound) { sound.setAttribute('aria-pressed', audio.muted ? 'false' : 'true'); updateSoundButton(); }
  say(audio.muted ? L('ปิดเสียงแล้ว', 'Audio muted.') : L('เปิดเสียงแล้ว', 'Audio on.'));
  audioLog('master_mute', audio.muted ? 'silent' : 'file', audio.muted ? 'muted' : 'unmuted');
}

function pumpVoiceQueue() {
  if (audio.voiceCurrentRequest || !audio.voiceQueue || !audio.voiceQueue.length) return;
  const item = audio.voiceQueue.shift();
  const now = performance.now();
  if (!VOICE_ALWAYS.includes(item.id) && now - item.queuedAt > 6000) {
    pumpVoiceQueue();
    return;
  }
  if (item.id === 'vo_gate_pass' &&
      (now > item.expiresAt || state.level !== item.expectedLevel)) {
    audio.gatePassVoiceZone = '';
    const currentZoneVoice = state.level >= 2 ? 'vo_zone_deep_v2' : state.level === 1 ? 'vo_zone_mid' : '';
    if (currentZoneVoice) speakLine(currentZoneVoice);
    pumpVoiceQueue();
    return;
  }
  audio.voiceCurrentRequest = item;
  audio.voiceCurrentId = item.id;
  audio.voicePendingId = audio.voiceQueue.length ? audio.voiceQueue[0].id : '';
  let finished = false;
  let watchdogVersion = 0;
  const armWatchdog = (milliseconds) => {
    const version = ++watchdogVersion;
    window.setTimeout(() => {
      if (finished || version !== watchdogVersion) return;
      audio.speakToken++;
      (item.voiceTrackIds || []).forEach((id) => {
        const source = audio.activeCues && audio.activeCues.get(id);
        if (source) { try { source.stop(); } catch (_) {} }
      });
      if (audio.voiceDuckId) {
        audio.ducks.delete(audio.voiceDuckId);
        audio.voiceDuckId = 0;
      }
      audio.mus.voiceHold = false;
      audio.voiceCurrentId = '';
      onComplete(false);
    }, milliseconds);
  };
  armWatchdog(12000);
  const onComplete = () => {
    if (finished) return;
    finished = true;
    if (audio.voiceCurrentRequest === item) {
      audio.voiceCurrentRequest = null;
      audio.voiceCurrentId = '';
      audio.voicePendingId = audio.voiceQueue.length ? audio.voiceQueue[0].id : '';
    }
    pumpVoiceQueue();
  };
  playVoiceLineNow(item.id, item.values, onComplete, (seconds) => armWatchdog(Math.max(1000, seconds * 1000 + 2000)), item).catch((error) => {
    audioLog(item.id, 'silent', error.message);
    onComplete(false);
  });
}

function speakLine(id, values) {
  if (!VOICE_LINES[id]) return false;
  if (!voiceAllowed(id)) { audioLog(id, 'silent', 'voice rule: skipped'); return false; }
  if (audio.muted || !state.started) {
    audioLog(id, 'silent', audio.muted ? 'muted' : 'dive not started');
    return false;
  }
  const select = $('audio-language');
  if ((select ? select.value : audio.voiceLanguage) === 'off') {
    audioLog(id, 'silent', 'voice disabled');
    return false;
  }
  audio.voiceQueue = audio.voiceQueue || [];
  const item = { id, values: values || {}, queuedAt: performance.now() };
  if (id === 'vo_gate_pass') {
    item.expectedLevel = state.level;
    item.expiresAt = performance.now() + 10000;
  }
  const maxQueue = 4;
  if (audio.voiceQueue.length >= maxQueue) {
    const replaceIndex = VOICE_ALWAYS.includes(id) ? audio.voiceQueue.findIndex((queued) => !VOICE_ALWAYS.includes(queued.id)) : -1;
    if (replaceIndex < 0) {
      audioLog(id, 'silent', 'voice queue full');
      return false;
    }
    audio.voiceQueue.splice(replaceIndex, 1);
  }
  audio.voiceQueue.push(item);
  audio.voicePendingId = audio.voiceQueue[0].id;
  pumpVoiceQueue();
  return true;
}

async function playVoiceLineNow(id, values, onComplete, onDuration, request) {
  const lines = VOICE_LINES[id];
  if (!lines) return;
  if (audio.muted || !state.started) { onComplete(false); return; }
  const select = $('audio-language');
  const requested = select ? select.value : audio.voiceLanguage;
  if (requested === 'off') { onComplete(false); return; }
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
      if (token !== audio.speakToken || audio.muted) { onComplete(false); return false; }
      onDuration(buffers.reduce((sum, buffer) => sum + (Number(buffer.duration) || 0), Math.max(0, entries.length - 1) * 0.15));
      const voiceDuck = duck({ bed: 0.45, life: 0.6, hull: 0.7, music: 0.58, hand: 0.5 }, 0, id);
      audio.voiceDuckId = voiceDuck;
      audio.mus.voiceHold = true; applyThemeLevels(0.25);
      let index = 0;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        audio.ducks.delete(voiceDuck);
        if (audio.voiceDuckId === voiceDuck) audio.voiceDuckId = 0;
        BUS_NAMES.forEach((name) => applyBusGain(name, 1.2));
        audio.mus.voiceHold = false; applyThemeLevels(1.2);
        onComplete(true);
      };
      const playNext = () => {
        if (token !== audio.speakToken || audio.muted) { finish(); return; }
        const entry = entries[index];
        request.voiceTrackIds = request.voiceTrackIds || [];
        request.voiceTrackIds.push(entry.cueId);
        audio.voiceCurrentId = entry.cueId;
        const track = playBuffer(entry.cueId, buffers[index], { bus: 'voice', onended: () => {
          if (audio.voiceCurrentId === entry.cueId) audio.voiceCurrentId = '';
          index++;
          if (index < entries.length) window.setTimeout(playNext, 150);
          else finish();
        } });
        if (track) audioLog(entry.cueId, 'file', entry.path);
        else { if (audio.voiceCurrentId === entry.cueId) audio.voiceCurrentId = ''; finish(); }
      };
      playNext();
      return true;
    } catch (error) {
      audioLog(id, 'draft', error.message);
      if (token !== audio.speakToken || audio.muted) { onComplete(false); return false; }
    }
  }
  if (!('speechSynthesis' in window)) { audioLog(id, 'silent', 'speechSynthesis unavailable'); onComplete(false); return false; }
  if (!audio.voiceAvailable[language]) { audioLog(id, 'silent', 'no ' + language + ' speech voice'); onComplete(false); return false; }
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
      if (audio.voiceDuckId === voiceDuck) audio.voiceDuckId = 0;
      BUS_NAMES.forEach((name) => applyBusGain(name, 1.2));
    }
    audio.mus.voiceHold = false; applyThemeLevels(1.2);
    if (audio.voiceCurrentId === id) audio.voiceCurrentId = '';
    if (token !== audio.speakToken) return;
    audioLog(id, 'draft', 'speechSynthesis ' + language);
    onComplete(true);
  };
  utterance.onstart = () => { audio.voiceCurrentId = id; voiceDuck = duck({ bed: 0.45, life: 0.6, hull: 0.7, music: 0.58 }, 0, id); audio.voiceDuckId = voiceDuck; };
  utterance.onend = finish;
  utterance.onerror = finish;
  endTimer = window.setTimeout(finish, 12000);
  audio.voiceCurrentId = id;
  speechSynthesis.speak(utterance);
  return true;
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
  const rect = targetIndex >= 0 && !state.sphere && !state.ring ? FACES[hit.face].rect : null;
  const center = rect ? (rect.left + rect.right) / 2 : 0;
  const pan = state.ring && targetIndex >= 0 ? Math.max(-0.85, Math.min(0.85, (hit.u - 0.5) * 1.7)) :
    (rect ? Math.max(-0.85, Math.min(0.85, (hit.u - center) / ((rect.right - rect.left) / 2))) : 0);
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
  { name: 'SURFACE', max: 30, visibility: 'EXCELLENT', told: true, nameTh: 'ผิวน้ำ',
    note: 'Surface zone, 0 to 30 metres. 28 °C and about 40 PSU: the Red Sea is one of the warmest and saltiest seas on Earth.',
    noteTh: 'โซนผิวน้ำ ลึก 0–30 เมตร อุณหภูมิ 28 °C ความเค็มราว 40 PSU ทะเลแดงเป็นหนึ่งในทะเลที่อุ่นและเค็มที่สุดในโลก' },
  { name: 'SUNLIGHT ZONE', max: 88, visibility: 'GOOD', nameTh: 'ชั้นแสงแดด',
    note: 'Sunlight zone, 30 to 88 metres. Still bright enough for reef-building corals and the fish that live among them.',
    noteTh: 'ชั้นแสงแดด ลึก 30–88 เมตร ยังสว่างพอให้ปะการังสร้างแนวได้ และมีปลาอาศัยอยู่ท่ามกลางปะการังเหล่านั้น' },
  { name: 'MESOPHOTIC', max: 200, visibility: 'MODERATE', nameTh: 'ชั้นแสงรำไร',
    note: 'Mesophotic zone, 88 to 200 metres. About one percent of the surface light is left; only low-light corals still photosynthesise.',
    noteTh: 'ชั้นแสงรำไร ลึก 88–200 เมตร เหลือแสงจากผิวน้ำราว 1 เปอร์เซ็นต์ มีเพียงปะการังที่ทนแสงน้อยเท่านั้นที่ยังสังเคราะห์แสงได้' },
  { name: 'TWILIGHT ZONE', max: 494, visibility: 'LOW', nameTh: 'ชั้นสนธยา',
    note: 'Twilight zone, 200 to 494 metres. Too dark for photosynthesis. From here down, most light is made by animals.',
    noteTh: 'ชั้นสนธยา ลึก 200–494 เมตร มืดเกินกว่าจะสังเคราะห์แสงได้ จากตรงนี้ลงไป แสงส่วนใหญ่มาจากตัวสัตว์เอง' },
  { name: 'BATHYAL ZONE', max: 1000, visibility: 'MINIMAL', nameTh: 'ชั้นบาทิอัล',
    note: 'Bathyal zone, 494 to 1,000 metres. Pressure passes 50 atmospheres, yet the Red Sea stays near 21 °C, unusually warm for deep water.',
    noteTh: 'ชั้นบาทิอัล ลึก 494–1,000 เมตร ความดันเกิน 50 บรรยากาศ แต่ทะเลแดงยังอุ่นราว 21 °C ซึ่งอุ่นผิดปกติสำหรับน้ำลึก' },
  { name: 'MIDNIGHT ZONE', max: 2000, visibility: 'NONE', nameTh: 'ชั้นเที่ยงคืน',
    note: 'Midnight zone, 1,000 to 2,000 metres. No sunlight at all. Brine pools were found on the Red Sea floor at about 1,770 metres.',
    noteTh: 'ชั้นเที่ยงคืน ลึก 1,000–2,000 เมตร ไม่มีแสงอาทิตย์เลย เคยพบแอ่งน้ำเกลือเข้มข้นบนพื้นทะเลแดงที่ความลึกราว 1,770 เมตร' },
  { name: 'ABYSSAL ZONE', max: 1e9, visibility: 'NONE', nameTh: 'ชั้นอบิสซัล',
    note: 'Below 2,000 metres. The Red Sea is a young ocean, a rift still opening between Africa and Arabia, about 3,040 metres at its deepest.',
    noteTh: 'ลึกกว่า 2,000 เมตร ทะเลแดงเป็นมหาสมุทรอายุน้อย เป็นรอยแยกที่ยังค่อย ๆ เปิดกว้างขึ้นระหว่างแอฟริกากับคาบสมุทรอาหรับ ลึกที่สุดราว 3,040 เมตร' }
];
const VISIBILITY_TH = { EXCELLENT: 'ดีเยี่ยม', GOOD: 'ดี', MODERATE: 'ปานกลาง', LOW: 'ต่ำ', MINIMAL: 'น้อยมาก', NONE: 'ไม่มี' };
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
  $('val-visibility').textContent = tx(L(VISIBILITY_TH[sea.visibility] || sea.visibility, sea.visibility));
  $('val-salinity').textContent = (40 + 0.6 * clamp01(m / 300)).toFixed(1) + ' PSU';
  $('val-panels').textContent = FACES.filter((f) => f.on).length + ' / 6';
  $('val-reticle').textContent = hit ? FACES[hit.face].id + (hit.onPanel ? '' : ' (frame)') : '—';
  $('val-specimens').textContent = state.collected.length + ' / ' + SUBJECTS.length;
  renderDeck();
  $('depth-marker').style.top = (state.depth * 100) + '%';

  const el = $('depth-zone');
  el.dataset.zone = state.zone;
  el.textContent = tx(L(sea.nameTh || sea.name, sea.name));
  $('depth-level').textContent = tx(LEVEL_LABELS[state.zone]);
  // The first time each zone is reached, the narration box says what is known about it.
  if (state.started && audio.seaZone !== sea) {
    audio.seaZone = sea;
    if (!sea.told) { sea.told = true; say(L(sea.noteTh || sea.note, sea.note)); }
  }
}

function setLiveBanner(status, deg, reason) {
  const connected = status === 'live';
  if (state.started && connected !== audio.boardConnected) cue(connected ? 'board_link_on' : 'board_link_off');
  audio.boardConnected = connected;
  const banner = document.querySelector('.twin-banner');
  if (!banner) return;
  banner.removeAttribute('data-i18n');
  if (status === 'live') bannerState.text = L('LIVE — มุมหันแม่เหล็ก ' + deg.toFixed(1) + '°', 'LIVE — MAGNET yaw ' + deg.toFixed(1) + '°');
  else if (status === 'simulated') bannerState.text = L('จำลอง — ไม่ได้ต่อบอร์ด', 'SIMULATED — NO BOARD');
  else if (status === 'disconnected') {
    const message = String(reason || 'board disconnected');
    const labels = {
      'port not found': L('บอร์ด — ไม่พบพอร์ต', 'BOARD — PORT NOT FOUND'),
      'no data (wrong firmware?)': L('บอร์ด — ไม่มีข้อมูล ตรวจเฟิร์มแวร์ live-yaw', 'BOARD — NO DATA; CHECK LIVE-YAW FIRMWARE'),
      'board is running diagnostic firmware, flash live-yaw': L('บอร์ดใช้เฟิร์มแวร์ตรวจสอบอยู่ ให้ใช้ live-yaw', 'BOARD — DIAGNOSTIC FIRMWARE; USE LIVE-YAW'),
      'sensor unavailable (AS5600 not responding)': L('บอร์ด — เซนเซอร์ AS5600 ไม่ตอบสนอง', 'BOARD — AS5600 SENSOR UNAVAILABLE'),
      'bridge unavailable': L('บอร์ด — เชื่อมต่อสะพานไม่ได้', 'BOARD — BRIDGE UNAVAILABLE'),
      'mqtt offline': L('บอร์ดออฟไลน์ (MQTT)', 'BOARD OFFLINE (MQTT)'),
      'mqtt no data': L('บอร์ด — ไม่มีข้อมูลจาก MQTT เกิน 5 วินาที', 'BOARD — NO MQTT DATA FOR 5 S'),
      'mqtt connecting': L('กำลังเชื่อมต่อ MQTT…', 'CONNECTING TO MQTT…'),
      'mqtt broker unavailable': L('เชื่อมต่อ MQTT broker ไม่ได้', 'MQTT BROKER UNAVAILABLE'),
      'mqtt library failed': L('โหลดไลบรารี MQTT ไม่สำเร็จ', 'MQTT LIBRARY FAILED TO LOAD')
    };
    bannerState.text = labels[message] || L('บอร์ดหลุดการเชื่อมต่อ — ' + message, 'BOARD DISCONNECTED — ' + message.toUpperCase());
  }
  renderBanner();
}

// ---- MQTT live source (?mqtt=<chip>) ----------------------------------------------------------------------
// The base ESP32 publishes the same raw serial lines to broker.hivemq.com (firmware/include/base_online.h):
//   deepsphere/<chip>/state  retained {"v":1,"type":"state","ch":N,"yaw":<yaw line|null>,"scene":<scene line|null>}
//   deepsphere/<chip>/events one raw line per message; deepsphere/<chip>/status "online" / "offline".
// mqttTranslator turns them into the same object GET /yaw returns (mirrors laptop/twin_bridge.py YawState), so the
// page's one update path (consume, inside initLiveYaw) serves both sources. Pure: no DOM, no network, no clock.
// MQTT-PURE-BEGIN
function mqttChipFromSearch(search) {
  const p = new URLSearchParams(search);
  const v = (p.get('mqtt') || '').toLowerCase();
  return /^[0-9a-f]{6}$/.test(v) ? v : null;
}
function mqttTranslator(opts) {
  const o = opts || {};
  const sceneMaxAgeMs = o.sceneMaxAgeMs || 750, noDataMs = o.noDataMs || 5000;
  const seedFor = o.seedFor, session = 'mqtt-' + Math.random().toString(36).slice(2, 8);
  const st = { ok: false, magnet: 'missing', reason: 'mqtt no data', deg: 0, yawAt: 0, scene: null, sceneAt: 0, stateAt: 0,
    status: null, events: [], seq: 0, sceneRejected: 0, ever: false };
  const parse = (x) => { if (x && typeof x === 'object') return x; try { return JSON.parse(String(x)); } catch (e) { return null; } };
  const pushEvent = (m) => { st.seq++; st.events.push({ ...m, id: st.seq }); st.events = st.events.slice(-256); };
  const takeYaw = (m, now) => {   // YawState.update, message type "yaw"
    const ok = !!m.ok;
    const magnet = String(m.magnet || (ok ? 'ok' : 'missing'));
    st.magnet = magnet; st.ok = ok;
    if (!ok) {
      st.reason = ['missing', 'absent', 'not_found'].includes(magnet.toLowerCase()) ? 'sensor unavailable (AS5600 not responding)'
        : String(m.reason || 'sensor unavailable (AS5600 not responding)');
      return;
    }
    const v = (m.deg === null || m.deg === undefined || m.deg === '' || typeof m.deg === 'boolean') ? NaN : Number(m.deg);
    if (!Number.isFinite(v)) { st.ok = false; st.reason = 'invalid yaw'; return; }
    st.deg = ((v % 360) + 360) % 360; st.yawAt = now; st.reason = '';
  };
  const takeScene = (m, now) => {   // YawState.update, message type "scene" (the ck check sum needs the raw line, which the state JSON no longer has)
    const t_ms = Number(m.t_ms), depth = Number(m.depth), expedition = Number(m.expedition), seed = Number(m.seed) >>> 0;
    const bad = !Number.isInteger(t_ms) || t_ms < 0 || !Number.isFinite(depth) || depth < 0 || depth > 1 ||
      !Number.isInteger(expedition) || expedition < 1 || expedition > 100000 || (seedFor && seed !== seedFor(expedition));
    if (bad) { st.sceneRejected++; return; }
    st.scene = { v: 1, type: 'scene', t_ms, depth, expedition, seed };
    if (Number.isInteger(m.tray) && m.tray >= 0 && m.tray <= 255) st.scene.tray = m.tray;
    st.sceneAt = now;
  };
  return {
    state: st,
    onStatus(text) { st.status = String(text).trim().toLowerCase(); },
    onState(payload, now, retained) {
      const m = parse(payload);
      if (!m || m.type !== 'state') return false;
      if (m.yaw && typeof m.yaw === 'object') takeYaw(m.yaw, now);
      if (m.scene && typeof m.scene === 'object') takeScene(m.scene, now);
      st.ever = true;
      if (!retained) st.stateAt = now;   // a retained copy is only the broker's last memory, not proof the board is alive
      return true;
    },
    onEvent(payload) {   // YawState.update for wheel / button / hello
      const m = parse(payload);
      if (!m || typeof m !== 'object') return false;
      if (m.type === 'wheel') { if (!Number.isInteger(m.delta) || m.delta === 0) return false; }
      else if (m.type === 'button') { if (!['scan', 'collect', 'analyze', 'wheel'].includes(m.name) || !['down', 'up'].includes(m.state)) return false; }
      else if (m.type === 'hello') { if (m.board !== 'base-io') return false; }
      else return false;
      pushEvent(m); return true;
    },
    // The /yaw-shaped snapshot. afterId = events newer than that id (same as /yaw?after=).
    snapshot(now, afterId) {
      const events = st.events.filter((e) => e.id > (afterId || 0));
      const base = { events, event_session: session, event_latest_id: st.seq, source: 'mqtt' };
      const scene = st.scene && now - st.sceneAt <= sceneMaxAgeMs ? { ...st.scene, rejected: st.sceneRejected } : null;
      let reason = null;
      if (st.status === 'offline') reason = 'mqtt offline';
      else if (!st.stateAt || now - st.stateAt > noDataMs) reason = st.ever ? 'mqtt no data' : 'mqtt connecting';
      else if (!st.ok) reason = st.reason || 'mqtt no data';
      if (reason) return { ...base, ok: false, reason, magnet: st.magnet, scene };
      return { ...base, deg: Math.round(st.deg * 100) / 100, ok: true, magnet: st.magnet, age_ms: Math.max(0, Math.round(now - st.yawAt)), simulated: false, scene };
    }
  };
}
// MQTT-PURE-END
function startMqttSource(chip, consume) {
  const tr = mqttTranslator({ seedFor: expeditionSeedFor });
  const top = 'deepsphere/' + chip + '/';
  let client = null, lastEventId = 0, brokerDown = false, libFailed = false;
  const tick = () => {
    const now = performance.now();
    const snap = tr.snapshot(now, lastEventId);
    if (libFailed) { snap.ok = false; snap.reason = 'mqtt library failed'; delete snap.deg; }
    else if (brokerDown) { snap.ok = false; snap.reason = 'mqtt broker unavailable'; delete snap.deg; }
    if (snap.events.length) lastEventId = snap.events[snap.events.length - 1].id;
    consume(snap);
  };
  const connect = () => {
    try {
      client = window.mqtt.connect('wss://broker.hivemq.com:8884/mqtt', { reconnectPeriod: 2000, connectTimeout: 8000, clean: true,
        clientId: 'deepsphere-twin-' + Math.random().toString(16).slice(2, 10) });
    } catch (e) { libFailed = true; return; }
    client.on('connect', () => { brokerDown = false; client.subscribe([top + 'state', top + 'events', top + 'status'], { qos: 0 }); });
    client.on('close', () => { brokerDown = true; });
    client.on('error', () => { brokerDown = true; });
    client.on('message', (topic, payload, packet) => {
      const text = payload.toString();
      const now = performance.now();
      if (topic === top + 'state') tr.onState(text, now, !!(packet && packet.retain));
      else if (topic === top + 'events') tr.onEvent(text);
      else if (topic === top + 'status') tr.onStatus(text);
    });
  };
  // mqtt.js is loaded only in this mode, from a pinned CDN version.
  const script = document.createElement('script');
  script.src = 'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js';
  script.onload = connect;
  script.onerror = () => { libFailed = true; };
  document.head.appendChild(script);
  tick();
  setInterval(tick, 50);
}

function initLiveYaw() {
  const mqttChip = mqttChipFromSearch(location.search);
  if (new URLSearchParams(location.search).get('live') !== '1' && !mqttChip) return;
  state.liveMode = true;
  state.mqttMode = !!mqttChip;   // view only: never POST /command; data comes from MQTT instead of /yaw
  state.liveConnected = false;
  state.liveTargetYaw = state.yaw;
  setLiveBanner('disconnected');
  let inFlight = false;
  const boardSync = { restoreDepth: 0, restoreUntil: 0 };
  const applyBoardScene = (scene) => {
    const valid = scene && scene.v === 1 && scene.type === 'scene' && Number.isFinite(Number(scene.t_ms)) &&
      Number.isFinite(Number(scene.depth)) && Number(scene.depth) >= 0 && Number(scene.depth) <= 1;
    if (!valid) return false;
    const now = performance.now();
    const reconnecting = !state.boardScene || now - (state.boardSceneReceivedAt || 0) > 750;
    // The board restarted mid-show: its clock went back. It wakes at depth 0.1 and expedition 1, so give it the
    // show's depth back (the expedition count is re-sent by syncBoardExpedition below).
    const rebooted = !reconnecting && Number(scene.t_ms) + 2000 < Number(state.boardScene.t_ms);
    state.boardScene = scene;
    state.boardSceneReceivedAt = now;
    // 11-06 owner: the web was jerky because it jumped to each board time (3-6 a second). Keep the web's own
    // clock running and pull it gently toward the board; snap only when far off (reconnect, board reboot).
    const boardSeconds = Number(scene.t_ms) / 1000, clockErr = boardSeconds - state.seconds;
    if (reconnecting || Math.abs(clockErr) > 1.5) state.seconds = boardSeconds;
    else state.seconds += clockErr * 0.15;
    // 11-06: the board's tray (bit i = SUBJECTS[i] stored on the panels). New bits play the normal collect.
    if (Number.isInteger(scene.tray)) {
      const tray = scene.tray;
      const inTray = (i) => (tray >> i) & 1;
      if (state.collected.some((c) => !inTray(SUBJECTS.findIndex((x) => x.id === c.id)))) {
        state.collected = state.collected.filter((c) => inTray(SUBJECTS.findIndex((x) => x.id === c.id)));
      }
      for (let i = 0; i < SUBJECTS.length; i++) {
        if (inTray(i) && !state.collected.some((c) => c.id === SUBJECTS[i].id)) storeSample(i, reticleHit(state.yaw));
      }
    }
    if (rebooted) {
      boardSync.restoreDepth = state.depth;
      boardSync.restoreUntil = now + 3000;
      postBoardCommand({ type: 'command', action: 'depth', value: Math.round(state.depth * 100000) / 100000 })
        .catch((error) => console.warn('Depth restore after board restart failed', error));
    }
    const boardDepth = Number(scene.depth);
    const restoring = boardSync.restoreUntil > now && Math.abs(boardDepth - boardSync.restoreDepth) > 0.002;
    if (!restoring) {
      boardSync.restoreUntil = 0;
      if (reconnecting) {
        // first scene after a (re)connect: take the board's depth quietly, no dive sounds for the jump
        state.depth = clamp01(boardDepth); state.boardTargetDepth = state.depth;
        syncLevel(state.depth);
        updateZone(state.depth);
        const depthInput = $('depth-input');
        if (depthInput) depthInput.value = state.depth;
      } else {
        // Same path as the web's own depth changes (free: the board has no gate rule), so the dive bed, bubbles,
        // depth notes and the surface / max-depth voice lines play while the wheel on the box is turned.
        // syncLevel inside setDepth keeps the passed floors where the board has them.
        state.boardTargetDepth = boardDepth;  // motionStep glides to it every frame (smooth web, 11-06)
      }
    }
    if (Number.isFinite(Number(scene.expedition))) syncBoardExpedition(Math.max(1, Number(scene.expedition) >>> 0), now);
    return true;
  };
  let lastBridgeEventId = 0;
  let bridgeEventSession = null;
  let hasBridgeCursor = false;
  fetch('/config/controls.json', { cache: 'no-cache' }).then((response) => response.json()).then((controls) => {
    const baseBoard = controls.base_board || {};
    const configuredStep = Number(baseBoard.wheel_depth_per_click);
    if (Number.isFinite(configuredStep) && configuredStep > 0 && configuredStep <= 1) wheelDepthPerClick = configuredStep;
    if (typeof baseBoard.wheel_depth_reverse === 'boolean') wheelDepthReverse = baseBoard.wheel_depth_reverse;
  }).catch(() => {});
  // Turn direction: key 9 flips it on the spot and the browser remembers (owner said 10-30 the flip was wrong way round).
  let LIVE_YAW_REVERSE = true;   // owner 10-30 05:05: with reverse off the twin still turned against the real ring
  // Front set by the owner 10-30 05:00: raw magnet 151.9 deg = the real front. Key 0 re-sets it (saved per browser).
  let liveYawZero = 151.9;
  try { const z = localStorage.getItem('deepSphereYawFront'); if (z !== null && Number.isFinite(Number(z))) liveYawZero = Number(z); } catch (e) {}
  try { const r = localStorage.getItem('deepSphereYawReverse2'); if (r !== null) LIVE_YAW_REVERSE = r === '1'; } catch (e) {}
  // 11-06: ?yawfront=N sets the front to the same raw angle the ring-fish board uses (its reticle and its
  // collect test), so web and panels agree on what is in the reticle. Clears the 6-face calibration and reverse
  // override, which the board does not have.
  try {
    const qf = Number(new URLSearchParams(location.search).get('yawfront'));
    if (new URLSearchParams(location.search).has('yawfront') && Number.isFinite(qf)) {
      liveYawZero = qf; LIVE_YAW_REVERSE = true;
      localStorage.setItem('deepSphereYawFront', String(qf));
      localStorage.setItem('deepSphereYawReverse2', '1');
      localStorage.removeItem('deepSphereYawCal6');
    }
  } catch (e) {}
  // Key 0: the screen now facing the visitor becomes the front (the twin's start view).
  addEventListener('keydown', (e) => {
    if (e.code === 'Digit9' || e.code === 'Numpad9') {
      LIVE_YAW_REVERSE = !LIVE_YAW_REVERSE;
      try { localStorage.setItem('deepSphereYawReverse2', LIVE_YAW_REVERSE ? '1' : '0'); } catch (err) {}
    }
    if ((e.code === 'Digit0' || e.code === 'Numpad0') && Number.isFinite(state.liveRawYaw)) {
      liveYawZero = state.liveRawYaw;
      try { localStorage.setItem('deepSphereYawFront', String(liveYawZero)); } catch (err) {}
    }
  });
  // Steady the magnet: median of the last 7 readings (drops single spikes), then a 1.5 deg dead band so a still
  // ring holds dead still, then a gentle glide toward the new angle.
  // Raw clean-up (log output/base-test/yaw-rotate.log, 10-30): on a small turn the sensor sometimes flips by ~180 deg
  // and stays there, and throws single 10-40 deg spikes. A jump of 140-220 deg in one 50 ms sample is treated as that
  // flip and cancelled; a jump of 40-140 deg (no hand turns that fast) is dropped as a spike.
  let rawLast = null, rawFlip = 0, rawSpikes = 0;
  const cleanRaw = (deg) => {
    const fixed = (deg + rawFlip + 360) % 360;
    if (rawLast === null) { rawLast = fixed; return fixed; }
    let d = fixed - rawLast; while (d > 180) d -= 360; while (d < -180) d += 360;
    if (Math.abs(d) >= 140) { rawFlip = (rawFlip + 180) % 360; return rawLast; }
    if (Math.abs(d) >= 60 && rawSpikes < 2) { rawSpikes++; return rawLast; }   // short hold only, so a real turn is never stuck
    rawSpikes = 0; rawLast = fixed; return fixed;
  };
  const yawHistory = [];
  let steady = null;
  const steadyYaw = (deg) => {
    const last = yawHistory.length ? yawHistory[yawHistory.length - 1] : deg;
    let d = deg - (((last % 360) + 360) % 360); while (d > 180) d -= 360; while (d < -180) d += 360;
    yawHistory.push(last + d); if (yawHistory.length > 7) yawHistory.shift();   // unwrapped, so 359 -> 1 is +2
    const median = [...yawHistory].sort((a, b) => a - b)[yawHistory.length >> 1];
    if (steady === null) steady = median;
    let gap = median - steady; while (gap > 180) gap -= 360; while (gap < -180) gap += 360;
    if (Math.abs(gap) > 1.5) steady += gap - Math.sign(gap) * 1.5 * 0.5;
    return ((steady % 360) + 360) % 360;
  };
  // Six-face calibration (key C): turn the ring one screen at a time, pressing C with each screen facing the visitor,
  // starting at the front. The raw magnet angle at each press maps to 0, 60, 120 ... so an off-centre or uneven magnet
  // still lands exactly on every screen; between presses the angle is interpolated.
  let yawCal = null, calPresses = [];
  try { const c = JSON.parse(localStorage.getItem('deepSphereYawCal6') || 'null'); if (Array.isArray(c) && c.length === 6) yawCal = c; } catch (e) {}
  const shortest = (a, b) => { let d = b - a; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
  const calibratedYaw = (raw) => {
    if (!yawCal) return null;
    const steps = yawCal.map((r, i) => shortest(r, yawCal[(i + 1) % 6]));
    const s = Math.sign(steps.reduce((a, b) => a + b, 0)) || 1;
    const cum = [0]; for (const st of steps) cum.push(cum[cum.length - 1] + Math.abs(st));
    const d = ((((raw - yawCal[0]) * s) % 360) + 360) % 360 * cum[6] / 360;
    let k = 0; while (k < 5 && d >= cum[k + 1]) k++;
    const frac = (d - cum[k]) / Math.max(1e-6, cum[k + 1] - cum[k]);
    const yawSign = LIVE_YAW_REVERSE ? -s : s;   // keeps the turn direction the owner confirmed
    return ((yawSign * (k + frac) * 60) % 360 + 360) % 360;
  };
  const calNote = document.createElement('div');
  calNote.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:50;padding:8px 14px;border:1px solid #e5c07b;border-radius:6px;background:rgba(0,10,14,.85);color:#e5c07b;font:600 14px monospace;display:none';
  document.body.appendChild(calNote);
  const showCal = (text, ms) => { calNote.textContent = text; calNote.style.display = 'block'; clearTimeout(showCal.t); if (ms) showCal.t = setTimeout(() => { calNote.style.display = 'none'; }, ms); };
  addEventListener('keydown', (e) => {
    // 11-06 owner: C was pressed by accident at the show and wrecked the angles. Now Shift+C only.
    if (e.code !== 'KeyC' || !e.shiftKey || !Number.isFinite(state.liveRawYaw)) return;
    calPresses.push(state.liveRawYaw);
    if (calPresses.length < 6) { showCal('CALIBRATE ' + calPresses.length + '/6 — turn to the next screen, press C', 0); return; }
    yawCal = calPresses; calPresses = [];
    try { localStorage.setItem('deepSphereYawCal6', JSON.stringify(yawCal)); } catch (err) {}
    console.log('yaw calibration', JSON.stringify(yawCal));
    showCal('CALIBRATED ✓', 2500);
  });
  // One /yaw-shaped snapshot in, all page updates out. Used by the /yaw poll and by the MQTT source alike.
  const consume = (data) => {
    const latestId = Number.isInteger(data.event_latest_id) ? data.event_latest_id : null;
    const sessionChanged = bridgeEventSession !== null && data.event_session && data.event_session !== bridgeEventSession;
    const sequenceReset = latestId !== null && latestId < lastBridgeEventId;
    if (!hasBridgeCursor || sessionChanged || sequenceReset) {
      bridgeEventSession = data.event_session || null;
      lastBridgeEventId = latestId === null ? Math.max(0, ...((data.events || []).map((event) => Number.isInteger(event.id) ? event.id : 0))) : latestId;
      hasBridgeCursor = true;
    } else {
      bridgeEventSession = data.event_session || bridgeEventSession;
      if (Array.isArray(data.events)) {
        for (const event of data.events) {
          if (!Number.isInteger(event.id) || event.id <= lastBridgeEventId) continue;
          handleBridgeEvent(event);
          lastBridgeEventId = event.id;
        }
      }
      if (latestId !== null) lastBridgeEventId = Math.max(lastBridgeEventId, latestId);
    }
    if (data.ok === true && Number.isFinite(Number(data.deg))) {
      state.liveConnected = true;
      // Key 9 flips the turn direction, key 0 sets which screen is the front.
      state.liveRawYaw = cleanRaw(Number(data.deg));
      const calibrated = calibratedYaw(state.liveRawYaw);
      const target = calibrated !== null ? calibrated : (((LIVE_YAW_REVERSE ? -1 : 1) * (state.liveRawYaw - liveYawZero)) % 360 + 360) % 360;
      state.liveTargetYaw = steadyYaw(target);
      setLiveBanner(data.simulated ? 'simulated' : 'live', state.liveTargetYaw);
      if (!applyBoardScene(data.scene) && performance.now() - (state.boardSceneReceivedAt || 0) > 750) state.boardScene = null;
    } else {
      state.liveConnected = false;
      if (!applyBoardScene(data.scene) && performance.now() - (state.boardSceneReceivedAt || 0) > 750) state.boardScene = null;
      setLiveBanner('disconnected', null, data.reason);
    }
  };
  const poll = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const response = await fetch('/yaw?after=' + lastBridgeEventId + '&ts=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      consume(await response.json());
    } catch (error) {
      state.liveConnected = false;
      if (performance.now() - (state.boardSceneReceivedAt || 0) > 750) state.boardScene = null;
      setLiveBanner('disconnected', null, 'bridge unavailable');
    } finally {
      inFlight = false;
    }
  };
  if (state.mqttMode) { startMqttSource(mqttChip, consume); return; }
  poll();
  setInterval(poll, 50);
}

// say() takes a plain string or L(th, en); the line is kept so a language switch repaints it at once.
let narrationSrc = null;
function paintNarration() {
  const narration = $('narration');
  if (!narration || narrationSrc === null) return;
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  narration.replaceChildren(document.createTextNode(tx(narrationSrc)), cursor);
}
const say = (text) => { narrationSrc = text; paintNarration(); };

function showVoiceNarration(id, values) {
  const lines = VOICE_LINES[id];
  if (!lines || !$('narration')) return;
  const params = values || {};
  say(L(String(lines.th || lines.en || '').replace('{names}', params.thNames || params.names || ''),
    String(lines.en || '').replace('{names}', params.enNames || params.names || '')));
}

// ---------------------------------------------------------------- Thai / English: fixed page text, toggle button
const UI = {
  banner: ['ดิจิทัลทวิน — จอจำลอง ไม่ได้ต่อบอร์ด', 'DIGITAL TWIN — SIMULATED PANELS, NO BOARD ATTACHED'],
  intro_sub: ['ภาพสดจากกล้อง 360° ของเรือดำน้ำ ROV', 'LIVE 360° ROV SUBMARINE CAMERA'],
  intro_hint: ['คุณกำลังมองผ่านกล้อง 360° ของเรือดำน้ำสำรวจทะเลลึก (ROV)<br>จับวงจอหมุนรอบตัวเหมือนส่องกล้องเพริสโคป<br>ลากเพื่อหมุนกล้อง · กด ▼ ค้างไว้เพื่อดำลง · สแกน → เก็บตัวอย่าง → วิเคราะห์<br>เรือดำน้ำมีน้ำหนัก จึงค่อย ๆ เร่งความเร็ว และไหลต่ออีกนิดก่อนจะหยุด<br>ทะเลมีสามชั้น แต่ละชั้นมีพื้นขวางอยู่ ให้หมุนกล้องเพื่อหาช่องลงไปต่อ<br>แนะนำให้ใส่หูฟัง · ดนตรีจะดังขึ้นเมื่อคุณเคลื่อนที่ และค่อย ๆ เบาลงเมื่อหยุด<br>(เสียงพากย์เป็นภาษาอังกฤษ)',
    'You are looking through the 360° camera of a deep-sea submarine (ROV).<br>Grab the ring and turn it like a periscope.<br>Drag to turn the camera · hold ▼ to dive · Scan → Collect → Analyze<br>The sub has weight: it gathers way slowly and glides to a stop.<br>The sea has three levels. Each ends in a floor: turn the sphere to find the way down.<br>Headphones recommended · the music joins when you move and fades when you stop'],
  cam_label: ['ROV CAM 360° · กล้องเรือดำน้ำ', 'ROV CAM 360° · SUBMARINE CAMERA'],
  status_title: ['ระบบนำทาง DeepCore', 'DeepCore Navigation'],
  l_pressure: ['ความดัน', 'Pressure'], l_temp: ['อุณหภูมิ', 'Temp'], l_visibility: ['ทัศนวิสัย', 'Visibility'],
  l_salinity: ['ความเค็ม', 'Salinity'], l_coord: ['พิกัด', 'Coord'], l_specimens: ['ตัวอย่าง', 'Specimens'],
  l_panels: ['จอที่ติด', 'Panels lit'], l_heading: ['ทิศที่หัน', 'Heading'], l_reticle: ['เป้าเล็ง', 'Reticle'],
  meters: ['เมตร', 'METERS'],
  m_explore: ['สำรวจ', 'Explore'], m_scan: ['สแกน', 'Scan'], m_collect: ['เก็บ', 'Collect'], m_analyze: ['วิเคราะห์', 'Analyze'],
  narr_label: ['Deep Sphere · ภาพจำลอง', 'Deep Sphere Twin'],
  k_depth: ['ความลึก', 'depth'], k_turn: ['หมุนทรงกลม', 'turn the sphere'], k_scan: ['สแกน', 'scan'], k_collect: ['เก็บ', 'collect'],
  k_analyze: ['วิเคราะห์', 'analyze'], k_reset: ['รีเซ็ต', 'reset'], k_mute: ['ปิดเสียง', 'mute'], k_mute_aria: ['ปิดเสียง', 'Mute audio'],
  k_voice: ['เสียงพากย์', 'Voice'], k_voice_aria: ['ระดับเสียงพากย์', 'Voice volume'],
  deck_aria: ['การ์ดตัวอย่าง', 'Specimen cards'], deck_title: ['บันทึกตัวอย่าง', 'SPECIMEN LOG'],
  guide_aria: ['วิธีเล่น', 'How to play'], guide_title: ['ปุ่มควบคุม', 'CONTROLS'],
  g1: ['หมุนวงจอแบบเพริสโคป<small>หมุนกล้องเรือดำน้ำ มองรอบตัว</small>', 'Turn the ring like a periscope<small>Turn the ROV camera to look around</small>'],
  g2: ['หมุนล้อ = ดำลง / ลอยขึ้น<small>หมุนล้อเพื่อดำให้ลึกขึ้น</small>', 'Turn the wheel = dive / rise<small>Wheel dives deeper</small>'],
  g3: ['ปุ่มแดง = สแกน<small>ค้นหาสิ่งมีชีวิต</small>', 'Red button = scan<small>Scan for life</small>'],
  g4: ['ปุ่มขาว = เก็บ<small>เก็บสิ่งที่อยู่ในเป้าเล็ง</small>', 'White button = collect<small>Collect what is in the reticle</small>'],
  g5: ['ปุ่มน้ำเงิน = วิเคราะห์<small>เปิดผลวิเคราะห์</small>', 'Blue button = analyze<small>Open the analysis</small>'],
  pad_aria: ['ปุ่มควบคุม', 'Controls'], pad_left: ['หมุนซ้าย', 'Turn left'], pad_right: ['หมุนขวา', 'Turn right'],
  pad_up: ['ลอยขึ้น', 'Rise'], pad_down: ['ดำลง', 'Dive'], pad_up_t: ['ขึ้น', 'UP'], pad_down_t: ['ดำลง', 'DIVE'],
  shape_title: ['สลับระหว่างทรงกลมกับวงแหวนหกจอ (กด B)', 'Switch between the sphere and six-screen ring (B)'],
  sound_aria: ['เปิดหรือปิดเสียง', 'Sound on or off'],
  ack: ['รับทราบ', 'ACKNOWLEDGE'], dismiss_aria: ['ปิดการแจ้งเตือน', 'Dismiss event']
};
const SHAPE_NAMES = { sphere: L('ทรงกลม', 'sphere'), ring: L('วงแหวน', 'ring'), cube: L('ลูกบาศก์', 'cube') };
const START_LABELS = { loading: L('กำลังโหลดแผงจอ', 'LOADING PANELS'), begin: L('เริ่มสำรวจ', 'BEGIN EXPLORATION'),
  sound: L('กำลังโหลดเสียง', 'LOADING SOUND'), retry: L('เปิดเสียงไม่ได้ — ลองอีกครั้ง', 'AUDIO UNAVAILABLE — RETRY'),
  failed: L('โหลดไม่สำเร็จ — โหลดหน้าใหม่', 'LOAD FAILED - RELOAD') };
const startLabel = { key: 'loading', n: 0, total: 0, shown: null };
const bannerState = { text: null };
const popupState = { mode: '', subject: null, sample: null };

function setStartLabel(key, n, total) {
  if (key) { startLabel.key = key; startLabel.n = n || 0; startLabel.total = total || 0; }
  const button = $('btn-start');
  if (!button) return;
  let text = tx(START_LABELS[startLabel.key]);
  if (startLabel.key === 'sound') text += ' ' + startLabel.n + '/' + startLabel.total;
  startLabel.shown = text;
  if (button.textContent !== text) button.textContent = text;
}
// renderer.js writes BEGIN EXPLORATION straight into the button; catch it and show it in the chosen language.
function watchStartButton() {
  const button = $('btn-start');
  if (!button || !window.MutationObserver) return;
  new MutationObserver(() => {
    const now = button.textContent;
    if (now === startLabel.shown) return;
    if (now === 'BEGIN EXPLORATION') setStartLabel('begin');
  }).observe(button, { childList: true, characterData: true, subtree: true });
}
function updateSoundButton() {
  const sound = $('btn-sound');
  if (sound) sound.textContent = tx(audio.muted ? L('เสียง: ปิด', 'Sound: off') : L('เสียง: เปิด', 'Sound: on'));
}
function updateShapeButton() {
  const button = $('btn-shape');
  if (!button || !state.shape) return;
  button.textContent = tx(L('รูปทรง: ', 'Shape: ')) + tx(SHAPE_NAMES[state.shape] || state.shape);
}
function renderBanner() {
  const banner = document.querySelector('.twin-banner');
  if (banner && bannerState.text) banner.textContent = tx(bannerState.text);
}
function renderLangButton() {
  const button = $('btn-lang');
  if (!button) return;
  button.innerHTML = '<span class="' + (LANG === 'th' ? 'on' : '') + '">TH</span> / <span class="' + (LANG === 'en' ? 'on' : '') + '">EN</span>';
  button.setAttribute('aria-label', tx(L('เปลี่ยนภาษา (ไทย / English)', 'Switch language (Thai / English)')));
}
function refreshPopup() {
  const popup = $('discovery-popup');
  if (!popup || !popup.classList.contains('show')) return;
  if (popupState.mode === 'card' && popupState.subject) showSpeciesCard(popupState.subject, popupState.sample);
  else if (popupState.mode === 'analysis') showAnalysis();
}
function applyLang() {
  const index = LANG === 'th' ? 0 : 1;
  document.documentElement.lang = LANG;
  document.title = LANG === 'th' ? 'Deep Sphere — ดำดิ่งสู่ทะเลลึก' : 'Deep Sphere — dive the ocean';
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', LANG === 'th' ? 'สำรวจ Deep Sphere ภาพจำลองดิจิทัล ตามหาสัตว์ทะเล และดำผ่านชั้นต่าง ๆ ของมหาสมุทร' : 'Explore the Deep Sphere digital twin, follow marine life, and dive through the layers of the ocean.');
  document.querySelectorAll('[data-i18n]').forEach((el) => { const entry = UI[el.dataset.i18n]; if (entry) el.innerHTML = entry[index]; });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { const entry = UI[el.dataset.i18nAria]; if (entry) el.setAttribute('aria-label', entry[index]); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { const entry = UI[el.dataset.i18nTitle]; if (entry) el.title = entry[index]; });
  renderLangButton();
  setStartLabel();
  updateSoundButton();
  try { updateShapeButton(); } catch (_) {}
  paintNarration();
  renderBanner();
  try { if (typeof FACES !== 'undefined' && SUBJECTS.length) updateHUD(null); } catch (_) {}
  try { renderDeck(); } catch (_) {}
  try { refreshPopup(); } catch (_) {}
}
function setLang(next, remember) {
  if (next !== 'th' && next !== 'en') return;
  LANG = next;
  if (remember) { try { window.localStorage.setItem(LANG_KEY, next); } catch (_) {} }
  applyLang();
}
function initLang() {
  const button = $('btn-lang');
  if (button) button.addEventListener('click', () => setLang(LANG === 'th' ? 'en' : 'th', true));
  watchStartButton();
  if (narrationSrc === null) narrationSrc = L('ระบบจำลองพร้อมแล้ว ยังไม่ได้ต่อบอร์ด', 'Twin online. No board attached.');
  applyLang();
}

// ---------------------------------------------------------------- actions

// ---------------------------------------------------------------- species card and analysis list
const LEVEL_LABELS = { surface: L('ชั้น 1 · แนวปะการัง', 'LEVEL 1 · CORAL REEF'), mid: L('ชั้น 2 · ซากเรือจม', 'LEVEL 2 · SHIPWRECK'),
  deep: L('ชั้น 3 · ปล่องภูเขาไฟใต้ทะเล', 'LEVEL 3 · VOLCANIC VENTS') };
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
// Thai text for the species cards (scientific names stay Latin; sources stay as published).
const SPECIES_TH = {
  shoal: { common: 'ปลาแอนเทียสหางพิณ',
    lines: ['ฝูงปลาสีส้มทองเหล่านี้ลอยเป็นกลุ่มเหนือแนวปะการังทะเลแดง คอยจับแพลงก์ตอนจากกระแสน้ำกินเป็นอาหาร',
      'ปลาทุกตัวเกิดมาเป็นเพศเมีย ตัวที่ใหญ่ที่สุดในฝูงจะเปลี่ยนเป็นเพศผู้'],
    range: 'ความลึก: 0–55 ม. / แนวปะการัง' },
  reef: { common: 'ปลาการ์ตูนทะเลแดง',
    lines: ['ปลาการ์ตูนสองแถบ พบในทะเลแดงและอ่าวเอเดน',
      'อาศัยอยู่ท่ามกลางหนวดพิษของดอกไม้ทะเล โดยมีเมือกที่ตัวเองสร้างขึ้นคอยป้องกัน'],
    range: 'ความลึก: 1–30 ม. / แนวปะการัง' },
  seahorse: { common: 'ม้าน้ำพอนี',
    lines: ['ม้าน้ำตัวเล็กที่อยู่ตามแหล่งหญ้าทะเลที่กำบังลมในทะเลแดงและมหาสมุทรอินเดีย ใช้หางเกาะยึดตัวไว้กับที่',
      'ตัวผู้เป็นฝ่ายอุ้มไข่ไว้ในถุงที่ท้อง และเป็นฝ่ายให้กำเนิดลูก'],
    range: 'ความลึก: น้ำตื้น ลึกถึงราว 10 ม. / แหล่งหญ้าทะเล' },
  manta: { common: 'กระเบนราหูแนวปะการัง',
    lines: ['กินแพลงก์ตอนโดยกรองจากน้ำ ปีกกางกว้างได้ถึงราว 5 เมตร',
      'กระเบนราหูมีสมองใหญ่ที่สุดในบรรดาปลาทั้งหมด ตัวในทะเลแดงที่ติดเครื่องติดตามเคยดำลงลึกเกิน 400 เมตร'],
    range: 'ความลึก: ส่วนใหญ่อยู่ใน 30 ม. บนสุด แต่ดำลึกได้เกิน 400 ม. / แนวปะการังและน้ำเปิด' },
  lantern: { common: 'ปลาตะเกียงแก้มเรียว',
    lines: ['ปลาที่มีมากที่สุดในชั้นสนธยาของทะเลแดง ยาวราว 5 ซม. มีแถวอวัยวะเรืองแสงเรียงตามท้อง',
      'กลางวันหลบอยู่ในความมืดลึกลงไปมาก ตกกลางคืนจึงว่ายขึ้นมาใกล้ผิวน้ำเพื่อหาอาหาร'],
    range: 'ความลึก: ใกล้ผิวน้ำตอนกลางคืน ราว 300–800 ม. ตอนกลางวัน / น้ำเปิด' },
  jelly: { common: 'แมงกะพรุนอะโทลลา (แมงกะพรุนมงกุฎ)',
    lines: ['แมงกะพรุนสีแดงเข้มแห่งชั้นเที่ยงคืน พบได้ในมหาสมุทรทั่วโลก',
      'เมื่อถูกโจมตี มันจะปล่อยวงแสงสีน้ำเงินหมุนวน เหมือน "สัญญาณกันขโมย" ที่ล่อให้ผู้ล่าตัวใหญ่กว่าเข้ามา'],
    range: 'ความลึก: ราว 1,000–4,000 ม. / น้ำเปิด' },
  angler: { common: 'ปลาตกเบ็ดหลังค่อม',
    lines: ['นักล่าที่ซุ่มรออยู่ในทะเลลึก ตัวเมียห้อยเหยื่อเรืองแสงไว้หน้าปากที่เต็มไปด้วยฟันยาว',
      'แสงนั้นมาจากแบคทีเรียที่อาศัยอยู่ในเหยื่อ ตัวเมียยาวราว 15 ซม. ส่วนตัวผู้เล็กกว่า 3 ซม.'],
    range: 'ความลึก: ราว 200–1,500 ม. / น้ำเปิด' },
  squid: { common: 'หมึกแวมไพร์',
    lines: ['ไม่ใช่หมึกกล้วยแท้ และไม่ใช่ปลาหมึกยักษ์ แต่เป็นสมาชิกเพียงชนิดเดียวที่ยังมีชีวิตอยู่ในอันดับของมันเอง',
      'อาศัยอยู่ในที่ที่แทบไม่มีออกซิเจน มีอวัยวะเรืองแสงที่ปลายแขน และพ่นเมือกเรืองแสงแทนการพ่นหมึก'],
    range: 'ความลึก: ราว 600–1,200 ม. / ชั้นที่มีออกซิเจนต่ำสุด' }
};
function spec(key) {
  const base = SPECIES[key];
  if (!base) return { lines: [] };
  return LANG === 'th' && SPECIES_TH[key] ? Object.assign({}, base, SPECIES_TH[key]) : base;
}
// A creature's name in both languages (the English one is the name in config/twin.json).
function subjName(subject) { return L(VOICE_SPECIES[subjectCueKey(subject)] || subject.name, subject.name); }
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
  const key = subjectCueKey(subject), info = spec(key), done = state.collected.length >= SUBJECTS.length;
  popupState.mode = 'card'; popupState.subject = subject; popupState.sample = sample;
  $('discovery-title').textContent = tx(done ? L('★ เก็บครบทุกตัวอย่างแล้ว ★', '★ ALL SPECIMENS COLLECTED ★') : L('★ เก็บตัวอย่างใหม่ได้แล้ว ★', '★ NEW SPECIMEN COLLECTED ★')) + '  ' + state.collected.length + ' / ' + SUBJECTS.length;
  const art = $('discovery-art');
  art.hidden = false;
  $('discovery-emoji').textContent = '';
  $('discovery-species').textContent = info.sci || subject.name;
  $('discovery-sub').textContent = (info.common || tx(subjName(subject))) + tx(L(' · ในภาพ: ', ' · in view: ')) + tx(subjName(subject));
  const rows = (info.lines || []).map((text) => { const row = document.createElement('div'); row.textContent = text; return row; });
  const range = document.createElement('div'), log = document.createElement('div');
  range.className = 'fact';
  range.textContent = (info.range || '') + (info.source ? tx(L(' / แหล่งข้อมูล: ', ' / Source: ')) + info.source : '');
  log.className = 'logged';
  log.textContent = tx(L('บันทึกตัวอย่างที่ความลึก ', 'Sample logged at ')) + Math.round(sample.depth * MAX_METRES) + tx(L(' ม. · ', ' m · ')) + tx(LEVEL_LABELS[sample.zone]) + ' · 22.3°N 38.9°E';
  $('discovery-info').replaceChildren(...rows, range, log);
  card.items = [{ canvas: art, subject, depth: sample.depth }];
  $('discovery-popup').classList.add('show');
  cardAnimate();
}

function showAnalysis() {
  popupState.mode = 'analysis'; popupState.subject = null; popupState.sample = null;
  $('discovery-title').textContent = tx(L('ผลวิเคราะห์', 'ANALYSIS'));
  $('discovery-art').hidden = true;
  $('discovery-emoji').textContent = 'ANALYSIS';
  $('discovery-species').textContent = LANG === 'th' ? 'ตัวอย่าง ' + state.collected.length + ' / ' + SUBJECTS.length : state.collected.length + ' / ' + SUBJECTS.length + ' specimens';
  $('discovery-sub').textContent = state.collected.length >= SUBJECTS.length ? tx(L('เก็บครบทุกสายพันธุ์ในการสำรวจนี้แล้ว', 'Every species in this survey has been collected.')) : tx(L('สายพันธุ์ที่ยังไม่พบ จะแสดงชั้นที่มันอาศัยอยู่', 'Species not found yet are listed with the level they live on.'));
  const rows = [], items = [];
  const order = SUBJECTS.map((_, index) => index).sort((x, y) => SUBJECTS[x].y_mm - SUBJECTS[y].y_mm);
  for (const index of order) {
    const subject = SUBJECTS[index], sample = state.collected.find((c) => c.id === subject.id), info = spec(subjectCueKey(subject));
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
      meta.textContent = (info.common || tx(subjName(subject))) + tx(L(' · เก็บที่ความลึก ', ' · logged at ')) + Math.round(sample.depth * MAX_METRES) + tx(L(' ม.', ' m'));
    } else {
      const unknown = document.createElement('div');
      unknown.className = 'unknown'; unknown.textContent = '?';
      row.append(unknown);
      const home = 0.1 + (subject.y_mm - geometry.aimHeightMm) / geometry.depthTravelMm;
      name.textContent = tx(L('ยังไม่พบ', 'Not found yet'));
      meta.textContent = tx(LEVEL_LABELS[home < ZONE_BOUNDS[0] ? 'surface' : home < ZONE_BOUNDS[1] ? 'mid' : 'deep']);
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
  reef: L('ด้านล่างเป็นพื้นทรายและแนวปะการัง · หมุนทรงกลมเพื่อหาทางลง', 'Sand and a coral reef below · turn the sphere to find the way down'),
  wreck: L('ด้านล่างมีซากเรืออับปางบนหิ้งหิน · มองหารอยแยกที่เรืองแสงเพื่อดำลงลึกขึ้น', 'A shipwreck on a rock shelf below · look for the glowing rift to go deeper')
};
const GATE_AHEAD_DEFAULT = L('หมุนทรงกลมเพื่อหาทางลง', 'Turn the sphere to find the way down');

function gateList() { return GATES_ON && config && config.gates || []; }
// Millimetres along the strip from the reticle to the opening; positive means turn right.
function gateOffset(gate) {
  const ringMode = state.ring || state.sphere;
  const length = ringMode ? geometry.ringLengthMm : geometry.stripLengthMm;
  const offset = ringMode ? (config.ring.reticle_azimuth_deg || 0) : 0;
  return geometry.gateOffset(gate, state.yaw, length, offset);
}
function gateOpen(gate) {
  const ringMode = state.ring || state.sphere;
  const length = ringMode ? geometry.ringLengthMm : geometry.stripLengthMm;
  const offset = ringMode ? (config.ring.reticle_azimuth_deg || 0) : 0;
  return geometry.gateOpen(gate, state.yaw, length, offset);
}

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
  if (dir > 0 && now - (gate.voiceHintAt || -1e9) >= 25000) {
    gate.voiceHintAt = now;
    speakLine('vo_gate_hint');
  }
  cue('hull_creak', { minGap: 0 });
  const wayEn = dir > 0 ? 'the way down' : 'the way up', wayTh = dir > 0 ? 'ทางลง' : 'ทางขึ้น';
  const right = gateOffset(gate) > 0;
  const sideEn = right ? 'turn right ▶' : '◀ turn left', sideTh = right ? 'หมุนไปทางขวา ▶' : '◀ หมุนไปทางซ้าย';
  const text = L((dir > 0 ? 'พื้นขวางทางอยู่' : 'มีโขดหินอยู่ด้านบน') + ' · ' + (gate.bumps > 1 ? sideTh + ' เพื่อหา' + wayTh : 'หมุนทรงกลมเพื่อหา' + wayTh),
    (dir > 0 ? 'The floor is in the way' : 'Rock overhead') + ' · ' + (gate.bumps > 1 ? sideEn + ' to find ' + wayEn : 'turn the sphere to find ' + wayEn));
  showPill(text, 3200);
  say(text);
}

function gatePassed(gate, dir) {
  gate.bumps = 0;
  audio.gatePassAt = performance.now();
  state.bubbleBurstAt = performance.now();
  if (dir > 0) {
    const nextZone = ['surface', 'mid', 'deep'][Math.min(2, state.level)];
    const foundAlreadySpeaking = audio.voiceCurrentId === 'vo_gate_found';
    const queuedFound = (audio.voiceQueue || []).findIndex((item) => item.id === 'vo_gate_found');
    if (foundAlreadySpeaking) audio.gatePassVoiceZone = nextZone;
    else {
      if (queuedFound >= 0) audio.voiceQueue.splice(queuedFound, 1);
      speakLine('vo_gate_pass');
      if (audio.voiceCurrentId === 'vo_gate_pass' || audio.voicePendingId === 'vo_gate_pass') audio.gatePassVoiceZone = nextZone;
    }
  }
  const toLevel = LEVEL_LABELS[['surface', 'mid', 'deep'][Math.min(2, state.level)]];
  say(L((dir > 0 ? 'ผ่านช่องแล้ว ลงสู่ ' : 'ขึ้นกลับสู่ ') + toLevel.th, (dir > 0 ? 'Through the gap, down to ' : 'Back up to ') + toLevel.en + '.'));
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
      showPill(GATE_AHEAD[below.kind] || GATE_AHEAD_DEFAULT, 4200);
      say(GATE_AHEAD[below.kind] || GATE_AHEAD_DEFAULT);
    }
    if (!below && !audio.seaBedSeen && state.depth > 0.9) {
      audio.seaBedSeen = true;
      say(L('พื้นทะเล: หินบะซอลต์สีดำ รอยแตกที่มีลาวาเรืองแสง และปล่องน้ำร้อนใต้ทะเล', 'The sea bed: black basalt, glowing lava cracks and hydrothermal vents.'));
    }
  }
  if (ready && ready !== state.gateReady && performance.now() - (audio.gatePassAt || 0) > 2500) {
    const readyGate = ready > 0 ? list[state.level] : list[state.level - 1];
    if (state.gateReady === 0 && ready === 1 && readyGate && performance.now() - (readyGate.voiceFoundAt || -1e9) >= 20000) {
      readyGate.voiceFoundAt = performance.now();
      speakLine('vo_gate_found');
    }
    showPill(ready > 0 ? L('พบช่องแล้ว · กด ▼ ค้างเพื่อดำลง', 'Found the gap · hold ▼ to dive') : L('พบช่องแล้ว · กด ▲ ค้างเพื่อลอยขึ้น', 'Found the gap · hold ▲ to rise'), 2600);
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
    say(L('เป้าเล็งอยู่บนขอบจอ ไม่ได้อยู่บนแผงจอ ไม่มีอะไรให้สแกน', 'The reticle is on the printed frame, not on a panel. Nothing to scan.')); return;
  }
  const s = aimedSubject(hit);
  const fx = $('scan-effect');
  fx.classList.remove('active'); void fx.offsetWidth; fx.classList.add('active');
  state.sweepStart = performance.now();
  state.highlightUntil = performance.now() + HIGHLIGHT_MS;
  cue('scan_sweep', { minGap: 0 });
  activity('act');
  beginSonarWindow();
  if (s < 0) say(L('สแกนที่จอ ' + FACES[hit.face].id + ': มีแต่น้ำ', 'Scan on face ' + FACES[hit.face].id + ': open water.'));
  else { const nm = subjName(SUBJECTS[s]); say(L('สแกนที่จอ ' + FACES[hit.face].id + ': พบ' + nm.th + 'ในเป้าเล็ง กด 2 เพื่อเก็บตัวอย่าง', 'Scan on face ' + FACES[hit.face].id + ': ' + nm.en + ' is in the reticle. Press 2 to collect.')); }
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
  // 11-06 owner: the panels decide (their reticle, their tray); the web follows the board's "tray" in the scene.
  if (state.boardScene && Number.isInteger(state.boardScene.tray)) return;
  const hit = reticleHit(state.yaw);
  const s = aimedSubject(hit);
  if (s < 0) { cue('action_error'); speakLine('vo_nothing'); say(L('ไม่มีอะไรในเป้าเล็งให้เก็บ', 'Nothing under the reticle to collect.')); return; }
  if (state.collected.some((c) => c.id === SUBJECTS[s].id)) {
    cue('collect_duplicate'); speakLine('vo_duplicate');
    const nm = subjName(SUBJECTS[s]); say(L(nm.th + ' อยู่ในถาดตัวอย่างแล้ว', nm.en + ' is already in the sample tray.')); return;
  }
  storeSample(s, hit);
}

// One sample goes into the tray (from the web's own collect, or from the board's tray in its scene line).
function storeSample(s, hit) {
  state.collectFlash = performance.now();
  activity('act'); sparkleFor(6);
  state.collectFace = hit.face;
  state.collectXY = [hit.pixel_uv[0] * 240, hit.pixel_uv[1] * 240];
  state.collected.push({ id: SUBJECTS[s].id, depth: state.depth, zone: state.zone, face: FACES[hit.face].id });
  if (state.collected.length >= SUBJECTS.length) {
    prioritySound('mission_complete', 3);
    window.setTimeout(() => speakLine('vo_complete'), 550);
    clearTimeout(EXPEDITION.timer);
    EXPEDITION.timer = window.setTimeout(() => newExpedition('complete'), EXPEDITION.afterCompleteMs);
  } else {
    prioritySound('collect_success', 1);
    window.setTimeout(() => speakLine('vo_collect'), 500);
  }
  // A collected sample brings up its species card; Analyze lists the whole tray.
  const nm = subjName(SUBJECTS[s]);
  say(L('เก็บตัวอย่างแล้ว: ' + nm.th + ' — ในถาดมี ' + state.collected.length + ' จาก ' + SUBJECTS.length + ' กด 3 เพื่อวิเคราะห์',
    'Sample stored: ' + nm.en + ' — ' + state.collected.length + ' of ' + SUBJECTS.length + ' in the tray. Press 3 to analyse.'));
  showSpeciesCard(SUBJECTS[s], state.collected[state.collected.length - 1]);
}

// Endless play for the exhibition (owner 11-05): a full tray, or a long time with nobody at the box,
// starts a new expedition. The tray empties and every creature moves to a new spot round the ring,
// at its own depth, so the next visitor has to hunt again. No reload needed.
const EXPEDITION = { afterCompleteMs: 15000, idleMs: 4 * 60 * 1000, retryMs: 5000, timer: 0, count: 1, syncedN: 0, pending: false,
  mismatchSince: 0, resentAt: 0 };

function postBoardCommand(body) {
  if (state.mqttMode) return Promise.resolve();   // MQTT mode is view only: no POST /command
  return fetch('/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((response) => { if (!response.ok) throw new Error('Board command: HTTP ' + response.status); });
}

// Every scene carries the board's expedition count. Board ahead (page reloaded, or the web missed it): take its
// count and replay the positions. Board behind for over a second (a lost command, or the board restarted):
// send the web's count down again instead of moving the creatures back.
function syncBoardExpedition(boardN, now) {
  if (boardN > EXPEDITION.count) {
    applyExpeditionPositions(boardN);
    EXPEDITION.count = boardN;
    EXPEDITION.syncedN = boardN;
    EXPEDITION.mismatchSince = 0;
    return;
  }
  if (boardN === EXPEDITION.count) { EXPEDITION.mismatchSince = 0; return; }
  if (!EXPEDITION.mismatchSince) { EXPEDITION.mismatchSince = now; return; }
  if (EXPEDITION.pending || now - EXPEDITION.mismatchSince < 1000 || now - EXPEDITION.resentAt < 2000) return;
  EXPEDITION.resentAt = now;
  const n = EXPEDITION.count;
  postBoardCommand({ type: 'command', action: 'expedition', n, seed: expeditionSeedFor(n) })
    .catch((error) => console.warn('Expedition re-send failed', error));
}

// Shared with ring-fish firmware: xorshift32, unsigned seed, one draw per subject in config order.
function expeditionShift(seed) {
  let value = seed >>> 0;
  value ^= value << 13; value >>>= 0;
  value ^= value >>> 17; value >>>= 0;
  value ^= value << 5; value >>>= 0;
  return { seed: value, mm: 40 + value * (400 / 4294967296) };
}

// Each expedition n has a fixed seed (same function as ring_fish.cpp expeditionSeedFor), so the web and the board
// can both rebuild the positions from the count alone, e.g. after a page reload or a missed command.
function expeditionSeedFor(n) {
  let v = (Math.imul(n >>> 0, 0x9e3779b9) ^ 0x7f4a7c15) >>> 0;
  v ^= v >>> 16; v = Math.imul(v, 0x85ebca6b) >>> 0; v ^= v >>> 13; v = Math.imul(v, 0xc2b2ae35) >>> 0; v ^= v >>> 16;
  return (v >>> 0) || 1;
}

// Positions after expedition n: the config position plus every expedition's shift from 2 to n.
function applyExpeditionPositions(n) {
  const total = SUBJECTS.map(() => 0);
  for (let k = 2; k <= n; k++) {
    let shiftSeed = expeditionSeedFor(k);
    SUBJECTS.forEach((subject, i) => {
      const shift = expeditionShift(shiftSeed);
      shiftSeed = shift.seed;
      total[i] += shift.mm;
    });
  }
  SUBJECTS.forEach((subject, i) => {
    if (subject.baseX_mm === undefined) subject.baseX_mm = subject.x_mm;
    subject.x_mm = subject.baseX_mm + total[i] % geometry.stripLengthMm;   // positions wrap round the ring
  });
}

function newExpedition(reason) {
  clearTimeout(EXPEDITION.timer);
  if (EXPEDITION.pending) return;
  const next = EXPEDITION.count + 1;
  const begin = () => {
    EXPEDITION.count = next;
    EXPEDITION.syncedN = next;
    state.collected = [];
    state.scannedSubjects = [];
    applyExpeditionPositions(next);
    $('discovery-popup').classList.remove('show');
    audio.mus.lastActive = performance.now();
    if (reason === 'complete') speakLine('vo_welcome');
    say(L('ภารกิจรอบที่ ' + EXPEDITION.count + ': ถาดว่างแล้ว และสัตว์ทะเลย้ายที่แล้ว ลองหาให้ครบทั้ง ' + SUBJECTS.length + ' ชนิดอีกครั้ง',
      'Expedition ' + EXPEDITION.count + ': the tray is empty and the creatures have moved. Find all ' + SUBJECTS.length + ' again.'));
  };
  // Without a board (plain web page) there is nothing to keep in step with.
  if (!state.liveMode) { begin(); return; }
  if (state.mqttMode) return;   // view only: the board starts new expeditions; the scene's expedition count follows it
  // With the board: move the creatures only once the bridge has taken the command, so both sides agree.
  EXPEDITION.pending = true;
  fetch('/command', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'command', action: 'expedition', n: next, seed: expeditionSeedFor(next) }) })
    .then((response) => { if (!response.ok) throw new Error('Expedition command: HTTP ' + response.status); begin(); })
    .catch((error) => {
      console.warn('Expedition command failed; creatures stay where they are, retrying', error);
      EXPEDITION.timer = window.setTimeout(() => newExpedition(reason), EXPEDITION.retryMs);
    })
    .finally(() => { EXPEDITION.pending = false; });
}

setInterval(() => {
  if (state.collected.length && performance.now() - audio.mus.lastActive > EXPEDITION.idleMs) newExpedition('idle');
}, 5000);

// Dive assist: keep every creature outlined until it is switched off again.
function toggleHighlight() {
  state.highlight = !state.highlight;
  const button = $('btn-highlight');
  if (button) button.setAttribute('aria-pressed', state.highlight ? 'true' : 'false');
  cue(state.highlight ? 'dive_assist_on' : 'dive_assist_off');
  say(state.highlight ? L('เปิดโหมดช่วยดำแล้ว: สัตว์ทุกตัวในภาพจะมีเส้นขอบ', 'Dive assist on: every creature in view is outlined.') : L('ปิดโหมดช่วยดำแล้ว', 'Dive assist off.'));
}

function doAnalyze() {
  if (state.collected.length === 0) { cue('action_error'); speakLine('vo_tray_empty'); say(L('ถาดตัวอย่างยังว่าง เก็บตัวอย่างก่อนนะ', 'The sample tray is empty. Collect something first.')); return; }
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
  say(L('วิเคราะห์ตัวอย่าง ' + state.collected.length + ' ชิ้น: ' + state.collected.map((c) => subjName(SUBJECTS.find((x) => x.id === c.id)).th).join(', '),
    'Analysis of ' + state.collected.length + ' sample(s): ' + names.join(', ') + '.'));
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
  depthVel: 0, wheelDepthVel: 0, wheelDepthPending: 0, yawVel: 0, dragVel: 0, dragAt: 0, last: 0 };

function easeSpeed(value, target, dt, rise, fall) {
  const gathering = target !== 0 && (value === 0 || Math.sign(target) === Math.sign(value)) && Math.abs(target) >= Math.abs(value);
  return value + (target - value) * (1 - Math.exp(-dt / (gathering ? rise : fall)));
}

function motionStep(now) {
  requestAnimationFrame(motionStep);
  const dt = Math.min(0.2, Math.max(0, (now - (motion.last || now)) / 1000));   // stays true to the clock on a slow device
  motion.last = now;
  if (!state.started) return;
  const boardSceneFresh = !!state.boardScene && performance.now() - (state.boardSceneReceivedAt || 0) <= 750;
  if (state.boardScene && !boardSceneFresh) state.boardScene = null;
  if (boardSceneFresh) {
    motion.depthVel = 0;
    motion.wheelDepthPending = 0;
    motion.wheelDepthVel = 0;
    if (Number.isFinite(state.boardTargetDepth) && Math.abs(state.boardTargetDepth - state.depth) > 0.00005)
      setDepth(state.depth + (state.boardTargetDepth - state.depth) * (1 - Math.exp(-dt / 0.12)), true);
  }
  const depthStart = state.depth;
  const depthInput = Math.max(-1, Math.min(1, (motion.key.down ? 1 : 0) - (motion.key.up ? 1 : 0) + motion.pad.depth));
  motion.depthVel = easeSpeed(motion.depthVel, depthInput * MOTION.depthSpeed, dt, MOTION.depthRise, MOTION.depthFall);
  if (Math.abs(motion.depthVel) <= 0.0003 && !depthInput) motion.depthVel = 0;
  const wheelDirection = Math.sign(motion.wheelDepthPending);
  const wheelAcceleration = MOTION.depthSpeed / MOTION.depthRise;
  const wheelStopSpeed = Math.sqrt(2 * wheelAcceleration * Math.abs(motion.wheelDepthPending));
  const wheelTarget = wheelDirection * Math.min(MOTION.depthSpeed, wheelStopSpeed);
  motion.wheelDepthVel = easeSpeed(motion.wheelDepthVel, wheelTarget, dt, MOTION.depthRise, MOTION.depthFall);
  let wheelDelta = motion.wheelDepthVel * dt;
  if (wheelDirection && wheelDelta * wheelDirection < 0) wheelDelta = 0;
  if (wheelDirection && Math.abs(wheelDelta) >= Math.abs(motion.wheelDepthPending)) wheelDelta = motion.wheelDepthPending;
  const depthWant = clamp01(depthStart + motion.depthVel * dt + wheelDelta);
  if (!boardSceneFresh && (Math.abs(motion.depthVel) > 0.0003 || Math.abs(wheelDelta) > 0)) setDepth(depthWant);
  // Stop a control that is pushing against a gate, the surface or the sea bed.
  const depthBlocked = Math.abs(state.depth - depthWant) > 1e-9;
  if (depthBlocked) {
    motion.depthVel = 0;
    motion.wheelDepthPending = 0;
    motion.wheelDepthVel = 0;
  } else if (state.depth <= 0 && motion.depthVel < 0 || state.depth >= 1 && motion.depthVel > 0) {
    motion.depthVel = 0;
  }
  if (wheelDirection && !depthBlocked) {
    motion.wheelDepthPending -= wheelDelta;
    if (Math.abs(motion.wheelDepthPending) < 1e-7) motion.wheelDepthPending = 0;
    if (state.depth <= 0 && wheelDirection < 0 || state.depth >= 1 && wheelDirection > 0) { motion.wheelDepthPending = 0; motion.wheelDepthVel = 0; }
  } else if (Math.abs(motion.wheelDepthVel) < 0.0003) motion.wheelDepthVel = 0;
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

let wheelDepthPerClick = 1 / 60;
let wheelDepthReverse = true;
function handleBridgeEvent(event) {
  if (!event || typeof event !== 'object') return;
  if (event.type === 'wheel' && Number.isFinite(event.delta)) {
    motion.wheelDepthPending += event.delta * wheelDepthPerClick * (wheelDepthReverse ? -1 : 1);
    activity('move');
    return;
  }
  if (event.type !== 'button' || event.state !== 'down') return;
  // Exhibition: with a card open, any console button just closes it (no laptop needed).
  if ($('discovery-popup').classList.contains('show')) { $('btn-discovery-close').click(); return; }
  if (event.name === 'scan') doScan();
  else if (event.name === 'collect') doCollect();
  else if (event.name === 'analyze') doAnalyze();
  else if (event.name === 'wheel') console.info('Wheel push switch pressed');
}

// Friends open the page with no hardware: the player view hides the engineering controls and adds on-screen
// buttons. ?dev=1 (and the live-board and acceptance runs) keep the full twin.
const DEV_MODE = /[?&](dev|acceptance)=1/.test(location.search);  // 10-30: live=1 keeps the clean exhibition view
state.pretty = !/[?&](acceptance=1|sprites=blocks)/.test(location.search);
if (!DEV_MODE) {
  document.body.classList.add('player', 'hide-labels');
  state.labels = false;
  state.grid = false;
  orbit.dist = 2.2;  // exhibition: start zoomed in on the screen box / sphere
}
// 11-06: two live pages for the show, both following the board. ?view=screen = the simulation alone, full
// window, silent, no popups. ?view=console = submarine console: viewport, values, specimen cards, popups, sound.
const VIEW = new URLSearchParams(location.search).get('view');
if (VIEW === 'screen' || VIEW === 'console') document.body.classList.add('view-' + VIEW);
if (VIEW === 'screen') {
  $('intro').classList.add('hide');
  orbit.dist = 1.6;  // the sphere fills the window
  window.addEventListener('dblclick', () => setShape(state.shape === 'sphere' ? 'ring' : 'sphere'));  // or key B
}
if (VIEW === 'console') {
  const col = document.createElement('div');
  col.className = 'console-col';
  orbit.dist = 1.8;
  col.append($('hud-depth'), $('hud-status'), $('card-deck'));
  // controls guide: under the viewport in landscape, in the column (after the cards) in portrait
  const narrow = matchMedia('(max-width: 900px)');
  const placeGuide = () => (narrow.matches ? col : document.body).append($('control-guide'));
  placeGuide();
  narrow.addEventListener('change', placeGuide);
  document.body.append(col);
}

const deck = { key: null, items: [], timer: 0, lang: '' };
function renderDeck() {
  if (VIEW !== 'console') return;
  if (!SUBJECTS.length) return;   // 11-20: applyLang runs before the creatures load; don't lock in an empty deck
  const key = state.collected.map((c) => c.id).join(',');
  if (key === deck.key && deck.lang === LANG) return;
  deck.lang = LANG;
  const fresh = deck.key === null ? [] : state.collected.filter((c) => !deck.key.split(',').includes(String(c.id))).map((c) => c.id);
  deck.key = key;
  deck.items = [];
  $('deck-count').textContent = state.collected.length + ' / ' + SUBJECTS.length;
  $('deck-grid').replaceChildren(...SUBJECTS.map((subject, index) => {
    const sample = state.collected.find((c) => c.id === subject.id), info = spec(subjectCueKey(subject));
    const cardEl = document.createElement('div'), name = document.createElement('div'), meta = document.createElement('div');
    cardEl.className = 'deck-card' + (sample ? ' got' : '') + (fresh.includes(subject.id) ? ' fresh' : '');
    name.className = 'deck-name'; meta.className = 'deck-meta';
    if (sample) {
      const canvas = document.createElement('canvas');
      canvas.width = 168; canvas.height = 100;
      cardEl.append(canvas);
      deck.items.push({ canvas, subject, depth: sample.depth });
      name.textContent = info.common || tx(subjName(subject));
      meta.textContent = Math.round(sample.depth * MAX_METRES) + tx(L(' ม.', ' m'));
    } else {
      const unknown = document.createElement('div');
      unknown.className = 'deck-unknown'; unknown.textContent = '?';
      cardEl.append(unknown);
      name.textContent = tx(L('ยังไม่พบ', 'UNKNOWN'));
      meta.textContent = tx(L('ลำดับ ', 'NO. ')) + String(index + 1).padStart(2, '0');
    }
    cardEl.append(name, meta);
    return cardEl;
  }));
  clearInterval(deck.timer);
  let t = state.seconds;
  const paint = () => { t += 0.1; deck.items.forEach((item, i) => paintCreature(item.canvas, item.subject, t + i * 1.3, item.depth)); };
  paint();
  if (deck.items.length) deck.timer = window.setInterval(paint, 100);
}

function yawHoldStop() { motion.pad.yaw = 0; }
function yawHoldStart(dir) { motion.pad.yaw = dir; }

// The player toggles between the sphere and the six-screen ring. The cube remains as a dev fixture.
const SHAPE_KEY = 'deepSphereShape';
function setShape(shape, remember) {
  if (typeof shape === 'boolean') shape = shape ? 'sphere' : 'cube';
  if (!['sphere', 'ring', 'cube'].includes(shape)) shape = 'sphere';
  state.shape = shape;
  state.sphere = shape === 'sphere';
  state.ring = shape === 'ring';
  if (cubeGroup) applyShape();
  const button = $('btn-shape');
  if (button) { updateShapeButton(); button.setAttribute('aria-pressed', state.sphere ? 'true' : 'false'); }
}
function initShape() {
  const asked = new URLSearchParams(location.search).get('shape');
  const initial = ['sphere', 'ring', 'cube'].includes(asked) ? asked :
    VIEW ? 'sphere' :  // 11-06 show pages start on the sphere (B switches)
    'ring';  // 10-30: the hex ring is the default view; sphere stays on the Shape button
  setShape(initial, false);
  const button = $('btn-shape');
  if (button) button.addEventListener('click', () => setShape(state.shape === 'sphere' ? 'ring' : 'sphere'));
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
      case 'KeyR': orbit = { theta: -1.3, phi: 1.32, dist: DEV_MODE ? 4.4 : 2.2 }; fitOrbit(); motion.depthVel = 0; motion.wheelDepthPending = 0; motion.wheelDepthVel = 0; motion.yawVel = 0; setYaw(0); setDepth(0, true); break;
      case 'Enter': case 'Escape': if ($('discovery-popup').classList.contains('show')) $('btn-discovery-close').click(); break;
      case 'KeyD': e.preventDefault(); setDebug(!audio.debug); break;
      case 'KeyB': setShape(state.shape === 'sphere' ? 'ring' : 'sphere'); break;
      case 'KeyN': audio.handNotes = !audio.handNotes; say(audio.handNotes ? L('เปิดโน้ตเสียงประกอบแล้ว', 'Hand notes on.') : L('ปิดโน้ตเสียงประกอบแล้ว', 'Hand notes off.')); break;
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
    say(L('Deep Sphere ออนไลน์ กำลังสำรวจทะเลแดง พิกัด 22.3°N 38.9°E ลากเพื่อหมุนทรงกลม กด ▼ ค้างเพื่อดำลง แล้วหาทางลงของแต่ละชั้น',
      'Deep Sphere online. Red Sea survey, 22.3°N 38.9°E. Drag to turn the sphere, hold ▼ to dive, and find the way down through each level.'));
  } catch (error) {
    console.error(error);
    setStartLabel('retry');
    button.disabled = false;
  } finally {
    state.starting = false;
  }
}

initLang();
init().catch(error => {
  console.error(error);
  setStartLabel('failed');
  say(error.message);
});

initLiveYaw();
