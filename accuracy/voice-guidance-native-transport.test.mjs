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
const ANDROID_APP = join(HERE, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'beardtrimmap', 'app');

function readIndex() { return readFileSync(INDEX_PATH, 'utf8'); }
function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

function loadMgVoiceSnippet() {
  const src = readIndex();
  const start = src.indexOf('function scanVoiceGuidanceEnabled(){');
  const end = src.indexOf("document.addEventListener('visibilitychange'", start);
  const endLineEnd = src.indexOf('\n', end) + 1;
  return src.slice(start, endLineEnd);
}

function makeSandbox({ enabled = true, nativeAvailable = true, hasNativeBridge = true, webSpeechSupported = false } = {}) {
  const spokenNative = [], spokenWeb = [];
  let stopNativeCount = 0, cancelWebCount = 0;
  const mockMgPrefs = { _vals: { scan_voice_guidance_enabled: enabled }, get(k) { return this._vals[k]; } };
  const win = {};
  if (hasNativeBridge) {
    win.BeardTrimAndroid = {
      isVoiceGuidanceAvailable() { return nativeAvailable; },
      speakVoiceGuidance(text) { spokenNative.push(text); },
      stopVoiceGuidance() { stopNativeCount++; }
    };
  }
  if (webSpeechSupported) {
    win.speechSynthesis = { cancel() { cancelWebCount++; }, speak(u) { spokenWeb.push(u.text); } };
    win.SpeechSynthesisUtterance = function (text) { this.text = text; };
  }
  const sandbox = { console, mgPrefs: mockMgPrefs, window: win, document: { hidden: false, addEventListener() {} } };
  vm.createContext(sandbox);
  vm.runInContext(loadMgVoiceSnippet(), sandbox);
  return { sandbox, spokenNative, spokenWeb, getStopNativeCount: () => stopNativeCount, getCancelWebCount: () => cancelWebCount };
}

// ---------- Kotlin native bridge existence / structure ----------

test('1. VoiceGuidanceTts.kt exists and wraps android.speech.tts.TextToSpeech', () => {
  const kt = readFileSync(join(ANDROID_APP, 'VoiceGuidanceTts.kt'), 'utf8');
  assert.match(kt, /import android\.speech\.tts\.TextToSpeech/);
  assert.match(kt, /class VoiceGuidanceTts\(context: Context\)/);
});

test('2. asynchronous initialization handling -- TTS is constructed with an init-status callback, not assumed ready', () => {
  const kt = readFileSync(join(ANDROID_APP, 'VoiceGuidanceTts.kt'), 'utf8');
  assert.match(kt, /TextToSpeech\(context\.applicationContext\)\s*\{\s*status\s*->/);
});

test('3. SUCCESS readiness requires both TextToSpeech.SUCCESS and a genuinely available language', () => {
  const kt = readFileSync(join(ANDROID_APP, 'VoiceGuidanceTts.kt'), 'utf8');
  assert.match(kt, /status == TextToSpeech\.SUCCESS/);
  assert.match(kt, /LANG_AVAILABLE.*LANG_COUNTRY_AVAILABLE.*LANG_COUNTRY_VAR_AVAILABLE/s);
});

test('4. initialization failure (non-SUCCESS status) results in ready=false, never a crash', () => {
  const kt = readFileSync(join(ANDROID_APP, 'VoiceGuidanceTts.kt'), 'utf8');
  assert.match(kt, /\} else \{\s*false\s*\}/);
});

test('5. isAvailable() exposes the tracked ready flag, not mere object construction', () => {
  const kt = readFileSync(join(ANDROID_APP, 'VoiceGuidanceTts.kt'), 'utf8');
  assert.match(kt, /fun isAvailable\(\): Boolean = ready/);
});

test('6. speak() is a no-op when not ready, and uses QUEUE_FLUSH (stale-instruction replacement, no queue pile-up)', () => {
  const kt = readFileSync(join(ANDROID_APP, 'VoiceGuidanceTts.kt'), 'utf8');
  assert.match(kt, /fun speak\(text: String\) \{[\s\S]*?if \(!ready\) return/);
  assert.match(kt, /TextToSpeech\.QUEUE_FLUSH/);
});

test('7. stop() and shutdown() exist and are wrapped in try/catch (never throw)', () => {
  const kt = readFileSync(join(ANDROID_APP, 'VoiceGuidanceTts.kt'), 'utf8');
  assert.match(kt, /fun stop\(\) \{\s*try \{/);
  assert.match(kt, /fun shutdown\(\) \{/);
  assert.match(kt, /tts\?\.shutdown\(\)/);
});

test('8. shutdown() releases the engine reference and resets readiness (no leak)', () => {
  const kt = readFileSync(join(ANDROID_APP, 'VoiceGuidanceTts.kt'), 'utf8');
  assert.match(kt, /tts = null[\s\S]*?ready = false/);
});

test('9. no network/cloud/paid-service dependency in the native TTS class (system engine only)', () => {
  const kt = readFileSync(join(ANDROID_APP, 'VoiceGuidanceTts.kt'), 'utf8');
  assert.ok(!/http:|https:|URL\(|HttpURLConnection|OkHttp|Retrofit/.test(kt));
});

// ---------- NativeTrackingBridge wiring ----------

function readBridge() { return readFileSync(join(ANDROID_APP, 'NativeTrackingBridge.kt'), 'utf8'); }

test('10. NativeTrackingBridge constructs VoiceGuidanceTts eagerly (asynchronous init starts at app launch, not on first use)', () => {
  const kt = readBridge();
  assert.match(kt, /private val voiceGuidance = VoiceGuidanceTts\(activity\)/);
});

test('11. isVoiceGuidanceAvailable/speakVoiceGuidance/stopVoiceGuidance are all @JavascriptInterface-exposed', () => {
  const kt = readBridge();
  assert.match(kt, /@JavascriptInterface\s*\n\s*fun isVoiceGuidanceAvailable\(\): Boolean = voiceGuidance\.isAvailable\(\)/);
  assert.match(kt, /@JavascriptInterface\s*\n\s*fun speakVoiceGuidance\(text: String\)/);
  assert.match(kt, /@JavascriptInterface\s*\n\s*fun stopVoiceGuidance\(\)/);
});

test('12. speakVoiceGuidance/stopVoiceGuidance dispatch onto the UI thread (never called mid-scanner-frame off-thread)', () => {
  const kt = readBridge();
  const speakBlock = kt.slice(kt.indexOf('fun speakVoiceGuidance'), kt.indexOf('fun speakVoiceGuidance') + 150);
  const stopBlock = kt.slice(kt.indexOf('fun stopVoiceGuidance'), kt.indexOf('fun stopVoiceGuidance') + 150);
  assert.match(speakBlock, /activity\.runOnUiThread/);
  assert.match(stopBlock, /activity\.runOnUiThread/);
});

test('13. lifecycle cleanup -- onPauseLifecycle() stops speech, close() shuts down the engine', () => {
  const kt = readBridge();
  const pauseBlock = kt.slice(kt.indexOf('fun onPauseLifecycle()'), kt.indexOf('fun onPauseLifecycle()') + 250);
  const closeBlock = kt.slice(kt.indexOf('override fun close()'), kt.indexOf('override fun close()') + 150);
  assert.match(pauseBlock, /voiceGuidance\.stop\(\)/);
  assert.match(closeBlock, /voiceGuidance\.shutdown\(\)/);
});

test('14. the existing preference allowlist (scan_voice_guidance_enabled) is unchanged -- native availability is a separate concept', () => {
  const kt = readBridge();
  assert.match(kt, /"scan_voice_guidance_enabled" to true/);
});

// ---------- JS mgVoice: native-preferred, web-fallback, single-transport-per-environment ----------

test('15. preference ON + native available -> speaks via native transport only', () => {
  const { sandbox, spokenNative, spokenWeb } = makeSandbox({ enabled: true, nativeAvailable: true, hasNativeBridge: true, webSpeechSupported: true });
  sandbox.mgVoice.speak('Hold.');
  assert.deepEqual(spokenNative, ['Hold.']);
  assert.deepEqual(spokenWeb, []);
});

test('16. preference OFF -> total suppression regardless of transport', () => {
  const { sandbox, spokenNative, spokenWeb } = makeSandbox({ enabled: false, nativeAvailable: true, hasNativeBridge: true, webSpeechSupported: true });
  sandbox.mgVoice.speak('Got it.');
  assert.deepEqual(spokenNative, []);
  assert.deepEqual(spokenWeb, []);
});

test('17. Test Voice Guidance native path: isSupported() reflects native isVoiceGuidanceAvailable() truthfully', () => {
  const { sandbox } = makeSandbox({ hasNativeBridge: true, nativeAvailable: true });
  assert.equal(sandbox.mgVoice.isSupported(), true);
});

test('18. engine unavailable (native bridge exists but not yet initialized) -- silent, NEVER falls back to Web Speech on Android', () => {
  const { sandbox, spokenNative, spokenWeb } = makeSandbox({ enabled: true, nativeAvailable: false, hasNativeBridge: true, webSpeechSupported: true });
  sandbox.mgVoice.speak('Move into position for the next angle.');
  assert.deepEqual(spokenNative, []);
  assert.deepEqual(spokenWeb, [], 'must not create two simultaneously-active speech engines by silently falling back');
  assert.equal(sandbox.mgVoice.isSupported(), false);
});

test('19. no Web Speech dependency for Android output -- web fallback used ONLY when no native bridge exists at all', () => {
  const { sandbox, spokenNative, spokenWeb } = makeSandbox({ enabled: true, hasNativeBridge: false, webSpeechSupported: true });
  sandbox.mgVoice.speak('Voice guidance on.');
  assert.deepEqual(spokenNative, []);
  assert.deepEqual(spokenWeb, ['Voice guidance on.']);
});

test('20. QUEUE_FLUSH / stale-instruction replacement behavior -- stop() is called before/at cancel() on native transport', () => {
  const { sandbox, getStopNativeCount } = makeSandbox({ hasNativeBridge: true, nativeAvailable: true });
  sandbox.mgVoice.cancel();
  assert.equal(getStopNativeCount(), 1);
});

test('21. no duplicate guidance spam -- repeated speak() calls each dispatch exactly once to native, no local queuing/buffering in JS', () => {
  const { sandbox, spokenNative } = makeSandbox({ hasNativeBridge: true, nativeAvailable: true });
  sandbox.mgVoice.speak('Hold.');
  sandbox.mgVoice.speak('Got it.');
  assert.deepEqual(spokenNative, ['Hold.', 'Got it.']);
});

test('22. isSupported() is never cached -- reflects a native availability flip within the same session', () => {
  const { sandbox } = makeSandbox({ hasNativeBridge: true, nativeAvailable: false });
  assert.equal(sandbox.mgVoice.isSupported(), false);
  sandbox.window.BeardTrimAndroid.isVoiceGuidanceAvailable = () => true;
  assert.equal(sandbox.mgVoice.isSupported(), true);
});

test('23. lifecycle resume/reinitialization: visibilitychange handler still calls mgVoice.cancel(), which now also stops native speech', () => {
  const src = readIndex();
  assert.match(src, /document\.addEventListener\('visibilitychange', function\(\)\{ if\(document\.hidden\) mgVoice\.cancel\(\); \}\);/);
});

test('24. empty/falsy text remains a silent no-op on the native path too', () => {
  const { sandbox, spokenNative } = makeSandbox({ hasNativeBridge: true, nativeAvailable: true });
  sandbox.mgVoice.speak('');
  sandbox.mgVoice.speak(null);
  assert.deepEqual(spokenNative, []);
});

test('25. no network call anywhere in the mgVoice block', () => {
  const src = readIndex();
  const voiceBlock = src.slice(src.indexOf('function scanVoiceGuidanceEnabled(){'), src.indexOf("document.addEventListener('visibilitychange'") + 300);
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(voiceBlock));
});

test('26. current proof-of-transport phrases are unchanged from SCAN-LOCK-V1A (no phrase redesign this stage)', () => {
  const src = readIndex();
  assert.match(src, /mgVoice\.speak\('Voice guidance on\.'\)/);
  assert.match(src, /mgVoice\.speak\('Hold\.'\)/);
  assert.match(src, /mgVoice\.speak\('Got it\.'\)/);
  assert.match(src, /mgVoice\.speak\('Move into position for the next angle\.'\)/);
  assert.ok(!/Slowly turn/.test(src));
});

// ---------- Production isolation ----------

test('27. sacrosanct burst-recorder byte-substring is unchanged', () => {
  const src = readIndex();
  const startIdx = src.indexOf('const TEMPORAL_BURST_TARGET_INTERVAL_MS');
  const endStart = src.indexOf('function __updateMotionBurstIndicatorUI(){');
  const endIdx = src.indexOf('\n}', endStart) + 2;
  assert.equal(sha256(src.slice(startIdx, endIdx)), 'eae6776bf4299af02f41b0ac3805bb59eb0167dc903c45a9ca08e87941f0762a');
});

test('28. whole-scan temporal recorder / temporal-subphase instrumentation untouched', () => {
  const src = readIndex();
  assert.match(src, /function __temporalSubphaseClassify\(facts\)\{/);
  assert.match(src, /function __wholeScanMaybeSample\(nowMs, metrics, q, ready\)\{/);
});

test('29. worker.js is unchanged by this stage', () => {
  assert.equal(sha256(readFileSync(WORKER_PATH)), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});

test('30. DIST/Profile/Chin-Up threshold constants untouched', () => {
  const src = readIndex();
  assert.match(src, /const PROFILE_YAW_MIN=38, PROFILE_YAW_MAX=60;/);
});

test('31. no scanner timing constant introduced or altered in the voice guidance block', () => {
  const src = readIndex();
  const voiceBlock = src.slice(src.indexOf('function scanVoiceGuidanceEnabled(){'), src.indexOf("document.addEventListener('visibilitychange'") + 300);
  assert.ok(!/setTimeout|setInterval/.test(voiceBlock));
});

test('32. mgVoice never mutates scanner state directly', () => {
  const src = readIndex();
  const mgVoiceObj = src.slice(src.indexOf('var mgVoice = {'), src.indexOf("document.addEventListener('visibilitychange'"));
  assert.ok(!/currentStepIndex\s*=|stableFrames\s*=|mgScan2\.\w+\s*=/.test(mgVoiceObj));
});
