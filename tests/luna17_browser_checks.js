/* In a browser with network access: open /twin/index.html?live=1&acceptance=1, start the dive, then run this file in DevTools. */
'use strict';
(async () => {
  const deadline = Date.now() + 120000;
  const missionStarted = () => typeof state !== 'undefined' && state.started;
  while (!missionStarted() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!missionStarted()) return [{name: 'mission started', status: 'FAIL', error: 'Start the dive before browser checks.'}];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const results = [];
  const check = (name, action) => {
    try { action(); results.push({name, status: 'PASS'}); }
    catch (error) { results.push({name, status: 'FAIL', error: error.message}); }
  };

  check('wheel event creates a smooth depth impulse', () => {
    state.started = true;
    state.depth = 0.3;
    motion.depthVel = 0;
    motion.wheelDepthVel = 0;
    motion.wheelDepthPending = 0;
    motion.pad.depth = 0;
    motion.last = performance.now();
    const before = state.depth;
    handleBridgeEvent({id: 1, v: 1, type: 'wheel', delta: 1});
    handleBridgeEvent({id: 2, v: 1, type: 'wheel', delta: 100});
    assert(motion.wheelDepthPending < -1, 'fast clicks must accumulate and clockwise must descend');
    motionStep(motion.last + 100);
    assert(state.depth < before && state.depth > before - 0.01, 'depth should ease smoothly by less than one click step');
    assert(motion.wheelDepthPending < -1, 'remaining clicks must stay queued');
  });

  check('blocked wheel clicks are cleared before a gate opens', () => {
    const originalSetDepth = setDepth;
    const originalDepth = state.depth;
    const blockedDepth = 0.3;
    let gateBlocked = true;
    state.depth = blockedDepth;
    motion.depthVel = 0;
    motion.wheelDepthVel = 0.05;
    motion.wheelDepthPending = 0.2;
    motion.pad.depth = 0;
    motion.last = performance.now();
    try {
      setDepth = (next, free) => {
        if (gateBlocked) state.depth = blockedDepth;
        else originalSetDepth(next, free);
      };
      motionStep(motion.last + 100);
      assert(motion.wheelDepthPending === 0 && motion.wheelDepthVel === 0, 'blocked wheel impulse must be discarded');
      gateBlocked = false;
      motionStep(motion.last + 1100);
      assert(state.depth === blockedDepth, 'opening the gate must not replay old wheel clicks');
    } finally {
      setDepth = originalSetDepth;
      originalSetDepth(originalDepth, true);
    }
  });

  check('KeyR clears wheel impulses as well as keyboard motion', () => {
    motion.depthVel = 0.04;
    motion.wheelDepthPending = 0.25;
    motion.wheelDepthVel = 0.03;
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyR', key: 'r', bubbles: true, cancelable: true}));
    assert(motion.depthVel === 0 && motion.wheelDepthPending === 0 && motion.wheelDepthVel === 0, 'KeyR must reset all depth motion');
  });

  check('Scan bridge button invokes the existing Scan action', () => {
    state.yaw = 0;
    const before = state.sweepStart;
    handleBridgeEvent({id: 2, v: 1, type: 'button', name: 'scan', state: 'down'});
    assert(state.sweepStart > before, 'scan action was not invoked');
  });

  check('button release and wheel push remain non-command events', () => {
    const before = state.sweepStart;
    handleBridgeEvent({id: 3, v: 1, type: 'button', name: 'scan', state: 'up'});
    handleBridgeEvent({id: 4, v: 1, type: 'button', name: 'wheel', state: 'down'});
    assert(state.sweepStart === before, 'non-action button triggered an action');
  });

  check('Arrow and Numpad keyboard bindings remain installed', () => {
    const arrow = new KeyboardEvent('keydown', {code: 'ArrowDown', key: 'ArrowDown', bubbles: true, cancelable: true});
    window.dispatchEvent(arrow);
    assert(motion.key.down, 'ArrowDown');
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'ArrowDown', key: 'ArrowDown', bubbles: true}));
    assert(!motion.key.down, 'ArrowDown release');
    const before = state.sweepStart;
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Numpad1', key: 'End', bubbles: true, cancelable: true}));
    assert(state.sweepStart > before, 'Numpad1 Scan');
  });

  return results;
})();
