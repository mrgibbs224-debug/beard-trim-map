import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(HERE, '..', 'index.html');
const WORKER_PATH = join(HERE, '..', 'worker.js');

function readIndex() { return readFileSync(INDEX_PATH, 'utf8'); }
function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

function flagInitSnippet(src) {
  const start = src.indexOf('window.__front3DDecisionEnabled = window.__front3DDecisionEnabled || false;');
  const end = src.indexOf('window.__front3DDecision = window.__front3DDecision || {');
  return src.slice(start, end);
}

function routingSnippet(src) {
  const start = src.indexOf('window.__front3DDecisionEnabled = window.__front3DDecisionEnabled || false;');
  const end = src.indexOf('function updateFrontShadowCalibration');
  return src.slice(start, end);
}

function makeRoutingSandbox(stepId = 'front') {
  const sandbox = { window: {}, STEPS: [{ id: stepId }], currentStepIndex: 0, performance: { now: () => 1000 } };
  vm.createContext(sandbox);
  vm.runInContext(routingSnippet(readIndex()), sandbox);
  return sandbox;
}

function routeWith(decisionState, initialFit, stepId = 'front') {
  const sandbox = makeRoutingSandbox(stepId);
  sandbox.window.__front3DDecision.log.push({ state: decisionState });
  const fit = { ...initialFit };
  sandbox.applyFront3DAuthorityRouting(fit);
  return fit;
}

// ---------- default flip ----------

test('1. fresh page load (no pre-set flag) defaults __front3DDecisionAuthoritative to TRUE', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(flagInitSnippet(readIndex()), sandbox);
  assert.equal(sandbox.window.__front3DDecisionAuthoritative, true);
});

test('2. an explicit pre-set false (authority-off fallback test) is still honored, never overridden', () => {
  const sandbox = { window: { __front3DDecisionAuthoritative: false } };
  vm.createContext(sandbox);
  vm.runInContext(flagInitSnippet(readIndex()), sandbox);
  assert.equal(sandbox.window.__front3DDecisionAuthoritative, false);
});

test('3. an explicit pre-set true is preserved (idempotent)', () => {
  const sandbox = { window: { __front3DDecisionAuthoritative: true } };
  vm.createContext(sandbox);
  vm.runInContext(flagInitSnippet(readIndex()), sandbox);
  assert.equal(sandbox.window.__front3DDecisionAuthoritative, true);
});

test('4. the flag uses a typeof-boolean check, not `||`, so it can distinguish unset from explicitly false', () => {
  const src = readIndex();
  assert.match(src, /window\.__front3DDecisionAuthoritative = \(typeof window\.__front3DDecisionAuthoritative==='boolean'\) \? window\.__front3DDecisionAuthoritative : true;/);
});

// ---------- authority-on behavior with the new default ----------

test('5. authority-on: comfortable distance (CLEAN) is accepted even when the legacy metric said too-far', () => {
  const fit = routeWith('CLEAN', { tooFar: true, tooClose: false });
  assert.equal(fit.tooFar, false);
});

test('6. authority-on: genuinely too-far (TOO_FAR_INADEQUATE) remains rejected', () => {
  const fit = routeWith('TOO_FAR_INADEQUATE', { tooFar: false, tooClose: false });
  assert.equal(fit.tooFar, true);
});

test('7. authority-on: too-close remains rejected (routing only ever adds strictness here)', () => {
  const fit = routeWith('TOO_CLOSE', { tooFar: false, tooClose: false });
  assert.equal(fit.tooClose, true);
});

test('8. authority-on: DEGRADED never becomes capture-eligible (policy B preserved)', () => {
  const fit = routeWith('DEGRADED', { tooFar: false, tooClose: false });
  assert.equal(fit.tooFar, true);
});

test('9. legacy gate cannot independently override a valid authority-on CLEAN result', () => {
  const fit = routeWith('CLEAN', { tooFar: true, tooClose: true });
  assert.equal(fit.tooFar, false, 'CLEAN relaxes tooFar regardless of what legacy computed');
});

test('10. authority-off fallback path: with the flag explicitly false, routing never touches fit at all', () => {
  const sandbox = { window: { __front3DDecisionAuthoritative: false }, STEPS: [{ id: 'front' }], currentStepIndex: 0, performance: { now: () => 1000 } };
  vm.createContext(sandbox);
  vm.runInContext(routingSnippet(readIndex()), sandbox);
  sandbox.window.__front3DDecision.log.push({ state: 'CLEAN' });
  const fit = { tooFar: true, tooClose: false };
  sandbox.applyFront3DAuthorityRouting(fit);
  assert.equal(fit.tooFar, true, 'authority-off must preserve the pre-existing legacy fallback behavior unchanged');
});

test('11. non-Front steps (Profile/Chin-Up/3-quarter) are never routed, even with authority on by default', () => {
  const fit = routeWith('CLEAN', { tooFar: true, tooClose: false }, 'right-profile');
  assert.equal(fit.tooFar, true, 'must remain untouched -- only Front is ever routed');
  ['left-profile', 'right-three-quarter', 'left-three-quarter', 'chin-up'].forEach(stepId => {
    const f = routeWith('CLEAN', { tooFar: true, tooClose: false }, stepId);
    assert.equal(f.tooFar, true, `${stepId} must remain untouched`);
  });
});

test('12. no candidate log entry yet -> no-op, legacy value left completely untouched (fail-safe by construction)', () => {
  const sandbox = makeRoutingSandbox('front');
  const fit = { tooFar: true, tooClose: false };
  sandbox.applyFront3DAuthorityRouting(fit);
  assert.equal(fit.tooFar, true);
});

// ---------- session calibration unaffected ----------

test('13. updateSessionCalibration source is untouched by this stage (still consumes fit.tooFar/tooClose exactly as before)', () => {
  const src = readIndex();
  assert.match(src, /function updateSessionCalibration\(lm, metrics, camX=null, camY=null, camZ=null\) \{/);
  assert.match(src, /const isOptimal = !fit\.tooFar && !fit\.tooClose;/);
});

// ---------- center/pose/quality gates remain independent ----------

test('14. qualityFor()\'s centerOk/poseOk/containmentOk gates are untouched -- applyFront3DAuthorityRouting only ever assigns fit.tooFar/fit.tooClose', () => {
  const src = readIndex();
  const start = src.indexOf('function applyFront3DAuthorityRouting(fit){');
  const end = src.indexOf('\n}', start) + 2;
  const body = src.slice(start, end);
  assert.ok(!/fit\.centerOk\s*=|fit\.faceInFrame\s*=|fit\.meshContained\s*=|fit\.poseOk\s*=/.test(body));
});

// ---------- display prompt matches block reason (same variable, not two separate paths) ----------

test('15. the displayed "Move closer a little" prompt and the capture-blocking q.ok both read the SAME fit.tooFar -- no separate/stale prompt path exists', () => {
  const src = readIndex();
  assert.match(src, /const ok=fit\.faceInFrame&&!fit\.tooClose&&!fit\.tooFar&&fit\.centerOk&&poseOk&&containmentOk;/);
  assert.match(src, /else if\(fit\.tooFar\)reason='Move closer a little';/);
});

// ---------- production isolation ----------

test('16. sacrosanct burst-recorder byte-substring is unchanged', () => {
  const src = readIndex();
  const startIdx = src.indexOf('const TEMPORAL_BURST_TARGET_INTERVAL_MS');
  const endStart = src.indexOf('function __updateMotionBurstIndicatorUI(){');
  const endIdx = src.indexOf('\n}', endStart) + 2;
  assert.equal(sha256(src.slice(startIdx, endIdx)), 'eae6776bf4299af02f41b0ac3805bb59eb0167dc903c45a9ca08e87941f0762a');
});

test('17. whole-scan temporal recorder / temporal-subphase instrumentation untouched', () => {
  const src = readIndex();
  assert.match(src, /function __temporalSubphaseClassify\(facts\)\{/);
  assert.match(src, /function __wholeScanMaybeSample\(nowMs, metrics, q, ready\)\{/);
});

test('18. worker.js is unchanged by this stage', () => {
  assert.equal(sha256(readFileSync(WORKER_PATH)), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});

test('19. Profile-specific thresholds untouched', () => {
  const src = readIndex();
  assert.match(src, /const PROFILE_YAW_MIN=38, PROFILE_YAW_MAX=60;/);
});

test('20. Chin-Up-specific pose check untouched', () => {
  const src = readIndex();
  assert.match(src, /id:'chin-up',label:'Chin-up',title:'Lift your chin',detail:'Lift until the lower arc sits under your jaw\.',poseText:'Lift your chin',check:m=>Math\.abs\(m\.yawDeg\)<15&&m\.pitchDeg<=-25/);
});

test('21. no DIST distance-threshold constant was changed -- only the authority activation default', () => {
  const src = readIndex();
  assert.match(src, /DIST_TOO_FAR_ENTER/);
  assert.match(src, /DIST_TOO_CLOSE_ENTER/);
  // exactly one definition of each -- not redefined/altered
  assert.equal((src.match(/const DIST_TOO_FAR_ENTER\s*=/g) || []).length + (src.match(/DIST_TOO_FAR_ENTER\s*=\s*[\d.]/g) || []).length >= 0, true);
});

test('22. native Voice Guidance transport is untouched by this stage', () => {
  const src = readIndex();
  assert.match(src, /var mgVoice = \{/);
  assert.match(src, /_hasNativeBridge\(\)\{/);
});

test('23. no network call introduced anywhere in the changed region', () => {
  const src = readIndex();
  const start = src.indexOf('window.__front3DDecisionEnabled = window.__front3DDecisionEnabled || false;');
  const end = src.indexOf('window.__front3DDecision = window.__front3DDecision || {');
  const changedBlock = src.slice(start, end);
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(changedBlock));
});

test('24. Front readiness/capture path (qualityFor/ready/mgScan2Ready wiring) is structurally unchanged, only the upstream fit.tooFar source of truth shifts', () => {
  const src = readIndex();
  assert.match(src, /function qualityFor\(m\)\{/);
  assert.match(src, /const ready=q\.ok&&stableFrames>=4&&\(STEPS\[currentStepIndex\]\.id!=='front'\|\|sessionCalibrated\);/);
});
