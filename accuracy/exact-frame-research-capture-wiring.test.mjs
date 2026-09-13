// Stage BI-1Z0B — static regression guard for the EXACT_FRAME_RESEARCH_CAPTURE production wiring
// in root index.html. Node built-in runner (node --test). READ-ONLY: parses index.html's source
// text only, never executes it (no DOM/ARCore/Blob available in Node) -- this catches an
// accidental flip of either gating flag's default, or accidental removal of the gate checks
// themselves, without requiring a browser. The interactive DOM/Blob/download behavior itself was
// verified by code review + the project's own JsSyntaxValidator (see the BI-1Z0B report).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(join(HERE, '..', 'index.html'), 'utf8');

test('1: window.__EXACT_FRAME_RESEARCH_CAPTURE defaults to false (research mode off by default)', () => {
  assert.match(INDEX_HTML, /window\.__EXACT_FRAME_RESEARCH_CAPTURE\s*=\s*false\s*;/);
});
test('2: window.__scannerSpatialRecorderEnabled still defaults to false (pre-existing A6.0B gate, unchanged)', () => {
  assert.match(INDEX_HTML, /window\.__scannerSpatialRecorderEnabled\s*=\s*false\s*;/);
});
test('3: the scanner-activation call site enables the recorder only when a gating flag is true', () => {
  const m = INDEX_HTML.match(/if \(window\.__EXACT_FRAME_RESEARCH_CAPTURE\) window\.__scannerSpatialRecorderEnabled = true;\s*\n\s*if \(window\.__scannerSpatialRecorderEnabled\) window\.__scannerSpatialRecorder\.start\(\);/);
  assert.ok(m, 'expected the research-capture gate immediately before the existing recorder.start() call');
});
test('4: stopCamera only auto-saves when research capture is on AND a session was actually recording', () => {
  assert.match(INDEX_HTML, /if \(window\.__EXACT_FRAME_RESEARCH_CAPTURE && __wasRecordingForExactFrameCapture\) __saveExactFrameResearchCapture\(\);/);
});
test('5: the "was recording" flag is captured BEFORE .stop() clears .active (fires at most once per session)', () => {
  const idx1 = INDEX_HTML.indexOf('var __wasRecordingForExactFrameCapture = window.__scannerSpatialRecorder.active;');
  assert.ok(idx1 > -1, 'the was-recording capture line must exist');
  // the generic "if (...active) ...stop();" guard also appears once earlier, in
  // handleNativeStateChange's unrelated 'stopped' branch -- search for THIS one only after idx1.
  const idx2 = INDEX_HTML.indexOf('if (window.__scannerSpatialRecorder.active) window.__scannerSpatialRecorder.stop();', idx1);
  assert.ok(idx2 > -1 && idx1 < idx2);
});
test('6: the durable-export path uses a plain local Blob + <a download> as its fallback (native bridge is the primary path) — no network/fetch/XHR call is introduced', () => {
  const start = INDEX_HTML.indexOf('function __saveExactFrameResearchCapture');
  const end = INDEX_HTML.indexOf('\nfunction __a60bScannerTick', start);
  assert.ok(start > -1 && end > start);
  const fnBody = INDEX_HTML.slice(start, end);
  assert.match(fnBody, /new Blob/);
  assert.match(fnBody, /a\.download=/);
  assert.match(fnBody, /BeardTrimAndroid\.saveResearchCapture/, 'the native bridge save path must be attempted first');
  assert.equal(/fetch\(|XMLHttpRequest|\.send\(/.test(fnBody), false);
});
test('6b: __saveExactFrameResearchCapture reports both success and failure to the user via showToast, never silently', () => {
  const start = INDEX_HTML.indexOf('function __saveExactFrameResearchCapture');
  const end = INDEX_HTML.indexOf('\nfunction __a60bScannerTick', start);
  const fnBody = INDEX_HTML.slice(start, end);
  assert.match(fnBody, /showToast\('Research capture saved/);
  assert.match(fnBody, /showToast\('Research capture failed/);
});
test('7: Tier-B geometry is copied via a shallow spread/assign, never reduced, in the production mirror', () => {
  const start = INDEX_HTML.indexOf('function __buildExactFrameResearchPackage');
  const end = INDEX_HTML.indexOf('\nfunction __saveExactFrameResearchCapture', start);
  assert.ok(start > -1 && end > start);
  const fnBody = INDEX_HTML.slice(start, end);
  assert.match(fnBody, /imageKeyframes:rec\.imageKeyframes\.map\(function\(k\)\{ return Object\.assign\(\{\},k,\{lensFacing:/);
  assert.equal(/landmarks2D:\s*\{kind/.test(fnBody), false, 'must never count-reduce Tier-B landmarks2D');
});
test('7b: the production mirror captures device metadata once via the native bridge, failing closed to null', () => {
  const start = INDEX_HTML.indexOf('function __buildExactFrameResearchPackage');
  const end = INDEX_HTML.indexOf('\nfunction __saveExactFrameResearchCapture', start);
  const fnBody = INDEX_HTML.slice(start, end);
  assert.match(fnBody, /BeardTrimAndroid\.deviceResearchMetadata/);
  assert.match(fnBody, /deviceMetadata=null/);
});
test('7c: Tier-A rows pass through distState/currentRatio only when present, and record the packetFreshAtSample structural guarantee', () => {
  const start = INDEX_HTML.indexOf('function __buildExactFrameResearchPackage');
  const end = INDEX_HTML.indexOf('\nfunction __saveExactFrameResearchCapture', start);
  const fnBody = INDEX_HTML.slice(start, end);
  assert.match(fnBody, /distState:\(typeof g\.distState/);
  assert.match(fnBody, /currentRatio:\(typeof g\.currentRatio/);
  assert.match(fnBody, /packetFreshAtSample:true/);
});
test('7d: the new native bridge methods are called through window.BeardTrimAndroid, the existing single bridge object', () => {
  assert.match(INDEX_HTML, /window\.BeardTrimAndroid\.isResearchBuild|BeardTrimAndroid\.isResearchBuild/);
  assert.match(INDEX_HTML, /BeardTrimAndroid\.saveResearchCapture/);
  assert.match(INDEX_HTML, /BeardTrimAndroid\.deviceResearchMetadata/);
});
test('8: the frozen anatomical jaw-support side mapping in the production mirror matches the tested module', () => {
  assert.match(INDEX_HTML, /172:'RIGHT',149:'RIGHT',152:'CENTER',378:'LEFT',397:'LEFT'/);
});
test('9: no holdout session identifier appears anywhere in index.html', () => {
  assert.equal(INDEX_HTML.includes('espu2w'), false);
});

// ---- BI-1Z0C -- on-device Settings control (no developer console required) ------------------
test('10: the Research & Development settings section is hidden by default in the markup', () => {
  const m = INDEX_HTML.match(/<section class="mg-set-section" id="settingsResearchSection" hidden>/);
  assert.ok(m, 'the section must ship with the hidden attribute already present');
});
test('11: the section is only unhidden after an explicit native isResearchBuild() confirmation, never by default or by URL param', () => {
  // Anchored on the settingsResearchSection markup itself (not the first textual mention of
  // "BeardTrimAndroid.isResearchBuild" anywhere in the file) -- Stage BI-1Z1G's temporal-burst
  // gating legitimately reuses the SAME isResearchBuild() check earlier in the file for its own,
  // unrelated defense-in-depth purpose (Part 2), so a plain first-occurrence indexOf is no longer
  // unique enough to identify this specific settings-unhide site.
  // lastIndexOf, not indexOf: the settings-unhide site is the LAST occurrence of this string in
  // the file (Stage BI-1Z1G's unrelated temporal-burst gating reuses the same check earlier).
  const start = INDEX_HTML.lastIndexOf('BeardTrimAndroid.isResearchBuild');
  assert.ok(start > -1);
  const nearby = INDEX_HTML.slice(Math.max(0, start - 200), start + 300);
  assert.match(nearby, /settingsResearchSection/);
  assert.match(nearby, /\.hidden=false/);
});
test('12: the On/Off toggle controls window.__EXACT_FRAME_RESEARCH_CAPTURE directly, with no mgPrefs/SharedPreferences persistence', () => {
  const onStart = INDEX_HTML.indexOf("getElementById('settingsResearchOnBtn')?.addEventListener");
  const offStart = INDEX_HTML.indexOf("getElementById('settingsResearchOffBtn')?.addEventListener");
  assert.ok(onStart > -1 && offStart > -1);
  const block = INDEX_HTML.slice(onStart, offStart + 300);
  assert.match(block, /window\.__EXACT_FRAME_RESEARCH_CAPTURE=true/);
  assert.match(block, /window\.__EXACT_FRAME_RESEARCH_CAPTURE=false/);
  assert.equal(/mgPrefs\.(get|set)\('.*research/i.test(block), false, 'must never read/write a persisted preference for this flag');
});
test('13: the flag is declared as a plain session-only variable defaulting to false, not sourced from any persisted store at declaration', () => {
  const idx = INDEX_HTML.indexOf('window.__EXACT_FRAME_RESEARCH_CAPTURE = false;');
  assert.ok(idx > -1);
  const before = INDEX_HTML.slice(Math.max(0, idx - 400), idx);
  assert.equal(/mgPrefs|localStorage|getBoolPreference/.test(before.slice(-120)), false);
});
test('14: a "RESEARCH CAPTURE ACTIVE" indicator element exists on the scan-setup screen and is hidden by default', () => {
  assert.match(INDEX_HTML, /<div class="eyebrow" id="researchCaptureActiveNote"[^>]*hidden>RESEARCH CAPTURE ACTIVE<\/div>/);
});
test('15: the scan-setup screen indicator is kept in sync with the flag from both the Settings toggle and screen navigation', () => {
  assert.match(INDEX_HTML, /function updateResearchCaptureActiveNote\(\)/);
  assert.match(INDEX_HTML, /updateResearchCaptureActiveNote\(\);\s*\n\s*\}\);\s*\ndocument\.getElementById\('settingsResearchOffBtn'\)/);
  assert.match(INDEX_HTML, /if\(name==='scanSetup' && typeof updateResearchCaptureActiveNote==='function'\) updateResearchCaptureActiveNote\(\);/);
});
