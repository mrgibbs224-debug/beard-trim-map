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

function loadMgVoiceSandbox({ enabled = true, supported = true, hidden = false } = {}) {
  const src = readIndex();
  const start = src.indexOf('function scanVoiceGuidanceEnabled(){');
  const end = src.indexOf("document.addEventListener('visibilitychange'", start);
  const endLineEnd = src.indexOf('\n', end) + 1;
  const snippet = src.slice(start, endLineEnd);
  const spokenLog = [];
  let cancelCount = 0;
  let visibilityHandler = null;
  const mockMgPrefs = { _vals: { scan_voice_guidance_enabled: enabled }, get(k) { return this._vals[k]; } };
  const sandbox = {
    console, mgPrefs: mockMgPrefs,
    window: supported ? {
      speechSynthesis: { cancel() { cancelCount++; }, speak(u) { spokenLog.push(u.text); } },
      SpeechSynthesisUtterance: function (text) { this.text = text; }
    } : {},
    document: { hidden, addEventListener(type, fn) { if (type === 'visibilitychange') visibilityHandler = fn; } }
  };
  vm.createContext(sandbox);
  vm.runInContext(snippet, sandbox);
  return { sandbox, spokenLog, getCancelCount: () => cancelCount, getVisibilityHandler: () => visibilityHandler, mockMgPrefs };
}

test('1. Voice Guidance ON propagation -- enabled preference results in real speech', () => {
  const { sandbox, spokenLog } = loadMgVoiceSandbox({ enabled: true });
  sandbox.mgVoice.speak('Hold.');
  assert.deepEqual(spokenLog, ['Hold.']);
});

test('2. Voice Guidance OFF suppression -- disabled preference results in total silence', () => {
  const { sandbox, spokenLog } = loadMgVoiceSandbox({ enabled: false });
  sandbox.mgVoice.speak('Got it.');
  assert.deepEqual(spokenLog, []);
});

test('3. settings persistence -- scan_voice_guidance_enabled is read fresh on every speak() call, not cached at load', () => {
  const { sandbox, spokenLog, mockMgPrefs } = loadMgVoiceSandbox({ enabled: true });
  sandbox.mgVoice.speak('A');
  mockMgPrefs._vals.scan_voice_guidance_enabled = false;
  sandbox.mgVoice.speak('B');
  mockMgPrefs._vals.scan_voice_guidance_enabled = true;
  sandbox.mgVoice.speak('C');
  assert.deepEqual(spokenLog, ['A', 'C']);
});

test('4. no duplicate speech spam / utterance replacement -- every speak() cancels any prior utterance first', () => {
  const { sandbox, getCancelCount } = loadMgVoiceSandbox({ enabled: true });
  sandbox.mgVoice.speak('one');
  sandbox.mgVoice.speak('two');
  sandbox.mgVoice.speak('three');
  assert.equal(getCancelCount(), 3);
});

test('5. engine-unavailable behavior -- speak() never throws and produces no speech when speechSynthesis/Utterance is absent', () => {
  const { sandbox, spokenLog } = loadMgVoiceSandbox({ enabled: true, supported: false });
  assert.doesNotThrow(() => sandbox.mgVoice.speak('x'));
  assert.deepEqual(spokenLog, []);
});

test('6. pause/resume -- a visibilitychange handler is registered and cancels speech when the app is hidden', () => {
  const { sandbox, getVisibilityHandler, getCancelCount } = loadMgVoiceSandbox({ enabled: true });
  const handler = getVisibilityHandler();
  assert.ok(typeof handler === 'function');
  sandbox.document.hidden = true;
  handler();
  assert.equal(getCancelCount(), 1);
});

test('7. cancel() is a no-op (never throws) when the engine is unsupported', () => {
  const { sandbox } = loadMgVoiceSandbox({ enabled: true, supported: false });
  assert.doesNotThrow(() => sandbox.mgVoice.cancel());
});

test('8. speak() with empty/falsy text is a silent no-op', () => {
  const { sandbox, spokenLog } = loadMgVoiceSandbox({ enabled: true });
  sandbox.mgVoice.speak('');
  sandbox.mgVoice.speak(null);
  assert.deepEqual(spokenLog, []);
});

test('9. guidance event generation -- all four call sites exist and reuse existing/documented copy verbatim', () => {
  const src = readIndex();
  assert.match(src, /mgVoice\.speak\('Voice guidance on\.'\)/, 'scan-start status announcement missing');
  assert.match(src, /mgVoice\.speak\('Hold\.'\)/, 'pose-lock guidance missing');
  assert.match(src, /mgVoice\.speak\('Got it\.'\)/, 'capture-success guidance missing');
  assert.match(src, /mgVoice\.speak\('Move into position for the next angle\.'\)/, 'next-pose guidance missing');
});

test('10. "Hold." fires exactly at the mgScan2 locked-state edge (same guard as mgScan2FireSweep, never every frame)', () => {
  const src = readIndex();
  assert.match(src, /if\(mgScan2\.state!=='locked'\)\{ mgScan2SetState\('locked'\); mgScan2FireSweep\(\); mgVoice\.speak\('Hold\.'\); \}/);
});

test('11. "Got it." fires at the exact same call site as the existing capture-success haptic (uiHaptic), never a separate/new trigger point', () => {
  const src = readIndex();
  assert.match(src, /uiHaptic\(\[140,110,140\]\);\s*mgVoice\.speak\('Got it\.'\);/);
});

test('12. scan-start announcement only fires on a genuine reset (new scan), never on every beginScan re-entry', () => {
  const src = readIndex();
  assert.match(src, /if\(reset\) mgVoice\.speak\('Voice guidance on\.'\);/);
});

test('13. scan lifecycle restart -- Voice Guidance status is announced once per fresh scan start, tied to resetScan', () => {
  const src = readIndex();
  const beginScanFn = src.slice(src.indexOf('async function beginScan('), src.indexOf('async function beginScan(') + 2200);
  assert.match(beginScanFn, /if\(reset\) resetScan\(\);[\s\S]*?if\(reset\) mgVoice\.speak/);
});

test('14. Settings UI toggle exists and mirrors the exact existing Scan Sounds pattern (on/off buttons + sync function)', () => {
  const src = readIndex();
  assert.match(src, /id="settingsVoiceOnBtn"/);
  assert.match(src, /id="settingsVoiceOffBtn"/);
  assert.match(src, /function settingsSyncVoiceGuidanceUI\(\)\{/);
  assert.match(src, /settingsSyncVoiceGuidanceUI\(\);/);
});

test('15. Test Voice Guidance button bypasses scanner choreography and never fires silently behind OFF', () => {
  const src = readIndex();
  const start = src.indexOf("document.getElementById('settingsTestVoiceBtn')");
  const body = src.slice(start, start + 400);
  assert.match(body, /if\(mgPrefs\.get\('scan_voice_guidance_enabled'\)===false\)\{ showToast\('Voice Guidance is off\.'\); return; \}/);
});

test('16. no network call anywhere in the voice guidance code (on-device Web Speech API only)', () => {
  const src = readIndex();
  const voiceBlock = src.slice(src.indexOf('function scanVoiceGuidanceEnabled(){'), src.indexOf("document.addEventListener('visibilitychange'") + 300);
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(voiceBlock));
});

test('17. no PAID/cloud TTS bridge call -- SCAN-LOCK-V1B deliberately added an on-device native BeardTrimAndroid speech bridge (see voice-guidance-native-transport.test.mjs), which is authorized and expected here; this test only guards against a network-based or paid TTS service being introduced', () => {
  const src = readIndex();
  const voiceBlock = src.slice(src.indexOf('function scanVoiceGuidanceEnabled(){'), src.indexOf("document.addEventListener('visibilitychange'") + 2000);
  assert.ok(!/fetch\(.*tts|googleapis\.com|azure|aws|elevenlabs/i.test(voiceBlock));
});

test('18. DIST/Profile/Chin-Up threshold constants are byte-identical to the BI-1Z2B baseline (untouched)', () => {
  const src = readIndex();
  assert.match(src, /const PROFILE_YAW_MIN=38, PROFILE_YAW_MAX=60;/);
});

test('19. sacrosanct burst-recorder byte-substring is unchanged', () => {
  const src = readIndex();
  const startIdx = src.indexOf('const TEMPORAL_BURST_TARGET_INTERVAL_MS');
  const endStart = src.indexOf('function __updateMotionBurstIndicatorUI(){');
  const endIdx = src.indexOf('\n}', endStart) + 2;
  assert.equal(sha256(src.slice(startIdx, endIdx)), 'eae6776bf4299af02f41b0ac3805bb59eb0167dc903c45a9ca08e87941f0762a');
});

test('20. whole-scan temporal recorder / temporal-subphase instrumentation untouched (BI-1Z2A functions still present verbatim)', () => {
  const src = readIndex();
  assert.match(src, /function __temporalSubphaseClassify\(facts\)\{/);
  assert.match(src, /function __wholeScanMaybeSample\(nowMs, metrics, q, ready\)\{/);
});

test('21. worker.js is unchanged by this stage', () => {
  assert.equal(sha256(readFileSync(WORKER_PATH)), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});

test('22. no scanner timing constant introduced or altered in the voice guidance block', () => {
  const src = readIndex();
  const voiceBlock = src.slice(src.indexOf('function scanVoiceGuidanceEnabled(){'), src.indexOf("document.addEventListener('visibilitychange'") + 300);
  assert.ok(!/setTimeout|setInterval/.test(voiceBlock));
});

test('23. Android native preference allowlist already includes scan_voice_guidance_enabled (no bridge change was necessary)', () => {
  const kotlin = readFileSync(join(HERE, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'beardtrimmap', 'app', 'NativeTrackingBridge.kt'), 'utf8');
  assert.match(kotlin, /"scan_voice_guidance_enabled" to true/);
});

test('24. mgVoice speak() and cancel() never mutate scanner state (currentStepIndex, stableFrames, mgScan2) directly', () => {
  const src = readIndex();
  const mgVoiceObj = src.slice(src.indexOf('var mgVoice = {'), src.indexOf("document.addEventListener('visibilitychange'"));
  assert.ok(!/currentStepIndex\s*=|stableFrames\s*=|mgScan2\.\w+\s*=/.test(mgVoiceObj));
});
