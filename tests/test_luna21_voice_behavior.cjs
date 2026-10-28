const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(process.env.LUNA21_SOURCE_PATH || 'twin/twin.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('assets/audio/sound-manifest.json', 'utf8'));
const render = JSON.parse(fs.readFileSync('tools/voice/render-voice-v2.json', 'utf8'));
const voiceStart = source.indexOf('{', source.indexOf('const VOICE_LINES ='));
const voiceEnd = source.indexOf('\n};', voiceStart);
const voiceLines = vm.runInNewContext(`(${source.slice(voiceStart, voiceEnd + 2)})`);
for (const id of Object.keys(manifest.voice)) assert.ok(voiceLines[id], `missing VOICE_LINES entry: ${id}`);

function section(start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing source section ${start}`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `missing end section ${end}`);
  return source.slice(from, to);
}
const voiceCode = [
  section('const VOICE_POLICY = {', 'function playBridge('),
  section('function pumpVoiceQueue(', '// ---------------------------------------------------------------- the player'),
  section('function handleZoneChange(', 'function toggleMusic('),
  section('function gateBump(', 'function doScan(')
].join('\n') + '\nglobalThis.__voicePolicy = VOICE_POLICY; globalThis.__voiceAlways = VOICE_ALWAYS;';

function wavDuration(path) {
  const data = fs.readFileSync(path);
  let offset = 12, sampleRate = 0, byteRate = 0, dataSize = 0;
  while (offset + 8 <= data.length) {
    const tag = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    if (tag === 'fmt ') byteRate = data.readUInt32LE(offset + 16);
    if (tag === 'data') { dataSize = size; break; }
    offset += 8 + size + (size & 1);
  }
  if (!byteRate || !dataSize) throw new Error(`cannot read WAV duration ${path}`);
  return dataSize / byteRate;
}
const audioDurations = {
  ...Object.fromEntries(Object.entries(render.lines).map(([id, line]) => [id, line.sec])),
  vo_scan_hit: wavDuration('assets/audio/voice/vo_scan_hit_en.wav')
};

function makeRig(durationOverrides = {}) {
  let now = 5000;
  let sequence = 0;
  const timers = [];
  const intervals = [];
  const spoken = [];
  const gate = { depth: 1, kind: 'test', seen: true, bumps: 0 };
  const audio = {
    muted: false, musicEnabled: true, voiceLanguage: 'en', voiceAvailable: { en: true, th: false },
    voiceVolume: 100, volume: 1, speakToken: 0, voiceCurrentId: '', voicePendingId: '',
    voiceQueue: [], voiceCurrentRequest: null, voiceCount: {}, voiceLast: {}, voiceLastAny: -1e9, activeCues: new Map(),
    zoneCueAt: {}, bumpAt: -1e9, gatePassAt: -1e9, gatePassVoiceZone: '', ducks: new Set(),
    mus: { state: 'FADE', restUntil: 0, fadeReason: '', player: {}, voiceHold: false },
    manifest: { voice: manifest.voice, voice_names: {} }
  };
  const state = { started: true, depth: 0.96, level: 0, gateReady: 0, zone: 'surface', bubbleBurstAt: 0 };
  const noop = () => {};
  const sandbox = {
    audio, state, gate, VOICE_LINES: voiceLines, BUS_NAMES: ['bed', 'life', 'hull', 'music', 'hand'],
    performance: { now: () => now },
    $: (id) => id === 'audio-language' ? { value: 'en' } : null,
    updateVoiceAvailability: noop, showVoiceNarration: noop, audioLog: noop,
    loadBuffer: async (path) => {
      const id = Object.keys(manifest.voice).find((key) => manifest.voice[key].en === path);
      const seconds = durationOverrides[id] || audioDurations[id] || 2.2;
      return { duration: seconds, _id: id };
    },
    playBuffer: (id, buffer, options) => {
      const start = now, end = now + buffer.duration * 1000;
      intervals.push({ id, start, end });
      spoken.push(id);
      const source = { stop: () => options.onended() };
      audio.activeCues.set(id, source);
      timers.push({ at: end, order: sequence++, run: () => { audio.activeCues.delete(id); options.onended(); } });
      return { id };
    },
    duck: () => 1, applyThemeLevels: noop, applyBusGain: noop,
    gateList: () => [gate], gateOpen: () => true, gateOffset: () => 1,
    GATE_AHEAD: {}, LEVEL_LABELS: ['Surface', 'Mid', 'Deep'],
    showPill: noop, say: noop, cue: noop, handNote: noop,
    playBridge: noop, scheduleAtmosphere: noop, endPerformance: noop, dirRnd: () => 1,
    MUS: { restZone: 1 }, window: { speechSynthesis: true, setTimeout: (fn, ms) => {
      timers.push({ at: now + ms, order: sequence++, run: fn }); return sequence;
    } },
    speechSynthesis: { cancel: noop, getVoices: () => [] },
    setTimeout: (fn, ms) => { timers.push({ at: now + ms, order: sequence++, run: fn }); return sequence; },
    clearTimeout: noop,
    SpeechSynthesisUtterance: function () { this.lang = ''; },
    voiceAllowed: null, speakLine: null
  };
  vm.createContext(sandbox);
  vm.runInContext(voiceCode, sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.__voicePolicy)), {
    vo_on_frame: { never: true }, vo_scan_hit: { first: 3, every: 2 }, vo_scan_miss: { first: 1, every: 4 },
    vo_collect: { first: 2, then: 'never' }, vo_duplicate: { cool: 20 }, vo_nothing: { cool: 20 }, vo_tray_empty: { cool: 20 },
    vo_zone_mid: { cool: 60 }, vo_zone_deep: { cool: 60 }, vo_zone_deep_v2: { cool: 60 },
    vo_gate_hint: { cool: 25 }, vo_gate_found: { cool: 20 }, vo_gate_pass: { cool: 0 }
  });
  assert.ok(sandbox.__voiceAlways.includes('vo_gate_pass'));

  async function flush() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  }
  async function advance(milliseconds) {
    const target = now + milliseconds;
    await flush();
    while (true) {
      timers.sort((a, b) => a.at - b.at || a.order - b.order);
      const timer = timers[0];
      if (!timer || timer.at > target) break;
      timers.shift(); now = timer.at; timer.run(); await flush();
    }
    now = target; await flush();
  }
  return { sandbox, audio, state, gate, spoken, intervals, advance, now: () => now };
}

function assertNoOverlap(intervals) {
  const ordered = [...intervals].sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(ordered[i].start >= ordered[i - 1].end - 1, `${ordered[i - 1].id} overlaps ${ordered[i].id}`);
  }
}
function passAndZone(r) {
  r.state.level = 1;
  r.sandbox.gatePassed(r.gate, 1);
  r.sandbox.handleZoneChange('surface', 'mid');
}
async function onePassCase(name, setup, atMs, expected) {
  const r = makeRig();
  setup(r);
  await r.advance(atMs);
  passAndZone(r);
  await r.advance(12000);
  const passageLines = r.intervals.filter((item) => ['vo_gate_pass', 'vo_gate_found', 'vo_zone_mid'].includes(item.id));
  assert.equal(passageLines.length, 1, `${name}: expected one passage narration, got ${passageLines.map((x) => x.id)}`);
  assert.equal(passageLines[0].id, expected, `${name}: expected ${expected}`);
  assertNoOverlap(r.intervals);
  return r;
}

(async () => {
  // (a) Hint active at crossing: pass waits for the 5.96-second clip, without overlap.
  const hint = await onePassCase('hint then pass at 3s', (r) => r.sandbox.gateBump(r.gate, 1), 3000, 'vo_gate_pass');
  assert.ok(hint.intervals.some((x) => x.id === 'vo_gate_hint'));

  // (b) A scan clip active at crossing also completes before the passage line.
  const scan = await onePassCase('scan then pass', (r) => r.sandbox.speakLine('vo_scan_hit'), 1000, 'vo_gate_pass');
  assert.ok(scan.intervals.some((x) => x.id === 'vo_scan_hit'));

  // (c) Found at t=0 and crossing at t=1s: keep found as the single passage line.
  const found = await onePassCase('found then pass at 1s', (r) => r.sandbox.updateGates(), 1000, 'vo_gate_found');

  // (d) With no active voice, the pass line starts immediately.
  await onePassCase('pass without previous voice', () => {}, 0, 'vo_gate_pass');

  // A delayed pass from an earlier level is dropped and the queued zone voice fills the slot.
  const stale = makeRig();
  stale.sandbox.speakLine('vo_gate_hint');
  await stale.advance(1000);
  passAndZone(stale);
  stale.state.level = 2;
  await stale.advance(12000);
  const stalePassage = stale.intervals.filter((item) => ['vo_gate_pass', 'vo_gate_found', 'vo_zone_mid', 'vo_zone_deep_v2'].includes(item.id));
  assert.deepEqual(stalePassage.map((item) => item.id), ['vo_zone_deep_v2']);
  assertNoOverlap(stale.intervals);

  const surfaced = makeRig();
  surfaced.sandbox.speakLine('vo_gate_hint');
  await surfaced.advance(1000);
  passAndZone(surfaced);
  surfaced.state.level = 0;
  await surfaced.advance(12000);
  assert.ok(!surfaced.intervals.some((item) => ['vo_gate_pass', 'vo_gate_found', 'vo_zone_mid', 'vo_zone_deep_v2'].includes(item.id)));

  // A stuck buffer load is bounded by the 12-second default watchdog, which releases the queue.
  const stuck = makeRig();
  const loadBuffer = stuck.sandbox.loadBuffer;
  stuck.sandbox.loadBuffer = (path) => path === manifest.voice.vo_gate_hint.en ? new Promise(() => {}) : loadBuffer(path);
  stuck.sandbox.speakLine('vo_gate_hint');
  await stuck.advance(1000);
  stuck.sandbox.speakLine('vo_complete');
  await stuck.advance(12000);
  assert.ok(stuck.intervals.some((item) => item.id === 'vo_complete'));
  await stuck.advance(3000);
  assert.equal(stuck.audio.voiceCurrentRequest, null);

  // A scan line that waits more than six seconds behind another line expires silently.
  const aged = makeRig({ vo_gate_hint: 12 });
  aged.sandbox.speakLine('vo_gate_hint');
  await aged.advance(4000);
  aged.sandbox.speakLine('vo_scan_hit');
  await aged.advance(8000);
  assert.ok(aged.intervals.some((item) => item.id === 'vo_gate_hint'));
  assert.ok(!aged.intervals.some((item) => item.id === 'vo_scan_hit'));

  const bounded = makeRig();
  bounded.sandbox.speakLine('vo_welcome');
  ['vo_analyze', 'vo_complete', 'vo_max_depth', 'vo_surface', 'vo_gate_pass'].forEach((id) => bounded.sandbox.speakLine(id));
  assert.equal(bounded.audio.voiceQueue.length, 4);

  // (e) Ascending does not trigger any of the three downward-only IDs.
  const up = makeRig();
  up.state.level = 1; up.state.depth = 1.02;
  up.sandbox.gateBump(up.gate, -1); up.sandbox.updateGates(); up.sandbox.gatePassed(up.gate, -1);
  await up.advance(12000);
  assert.ok(!up.intervals.some((x) => ['vo_gate_hint', 'vo_gate_found', 'vo_gate_pass'].includes(x.id)));

  console.log(`PASS: scenarios (a)-(e); stale zone fallback by current level; surface fallback silent; load timeout recovers; aged queue item expires; queue capped at 4; maximum overlap 0`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
