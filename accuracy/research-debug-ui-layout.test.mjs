import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(HERE, '..', 'index.html');
const WORKER_PATH = join(HERE, '..', 'worker.js');

function readIndex() { return readFileSync(INDEX_PATH, 'utf8'); }
function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

function scanDebugPanelRule() {
  const src = readIndex();
  const start = src.indexOf('.scan-debug-panel{');
  const end = src.indexOf('}', start) + 1;
  return src.slice(start, end);
}

function diagRailStyle(which) {
  const src = readIndex();
  const marker = `class="diag-rail-${which}" style="`;
  const start = src.indexOf(marker) + marker.length;
  const end = src.indexOf('"', start);
  return src.slice(start, end);
}

// ---------- debug/research container bounded to viewport ----------

test('1. scan-debug-panel is bounded (max-height set, not unbounded)', () => {
  const rule = scanDebugPanelRule();
  assert.match(rule, /max-height:52vh/);
});

test('2. scan-debug-panel is horizontally bounded to the viewport (left/right insets, no fixed overflow width)', () => {
  const rule = scanDebugPanelRule();
  assert.match(rule, /left:8px/);
  assert.match(rule, /right:8px/);
});

test('3. diag-rail-left and diag-rail-right are each width- and height-bounded', () => {
  assert.match(diagRailStyle('left'), /width:32vw/);
  assert.match(diagRailStyle('left'), /max-height:70vh/);
  assert.match(diagRailStyle('right'), /width:32vw/);
  assert.match(diagRailStyle('right'), /max-height:70vh/);
});

// ---------- safe wrapping of long telemetry ----------

test('4. scan-debug-panel wraps long lines safely (white-space:pre-wrap + word-break)', () => {
  const rule = scanDebugPanelRule();
  assert.match(rule, /white-space:pre-wrap/);
  assert.match(rule, /word-break:break-word/);
});

test('5. diag rails wrap long values safely (word-break added)', () => {
  assert.match(diagRailStyle('left'), /word-break:break-word/);
  assert.match(diagRailStyle('right'), /word-break:break-word/);
});

// ---------- the actual bug: overflow was unreachable (pointer-events:none blocked internal scroll) ----------

test('6. scan-debug-panel is now touch-scrollable (pointer-events:auto), fixing the physically-confirmed truncation bug', () => {
  const rule = scanDebugPanelRule();
  assert.match(rule, /pointer-events:auto/);
  assert.ok(!/pointer-events:none/.test(rule));
});

test('7. diag rails are now touch-scrollable (pointer-events:auto) while their parent #calibrationHUD remains pointer-events:none', () => {
  assert.match(diagRailStyle('left'), /pointer-events:auto/);
  assert.match(diagRailStyle('right'), /pointer-events:auto/);
  const src = readIndex();
  const chudStart = src.indexOf('id="calibrationHUD"');
  const chudTag = src.slice(chudStart, src.indexOf('>', chudStart));
  assert.match(chudTag, /pointer-events:\s*none/);
});

// ---------- no page-level scanner scrolling introduced ----------

test('8. overscroll-behavior:contain prevents a scroll gesture inside the debug panels from scrolling the scanner page itself', () => {
  assert.match(scanDebugPanelRule(), /overscroll-behavior:contain/);
  assert.match(diagRailStyle('left'), /overscroll-behavior:contain/);
  assert.match(diagRailStyle('right'), /overscroll-behavior:contain/);
});

test('9. .scanner-screen itself is not made scrollable by this stage (still min-height:100dvh, no overflow:auto/scroll added at the page level)', () => {
  const src = readIndex();
  const marker = '.scanner-screen{background:#020405';
  const start = src.indexOf(marker);
  const rule = src.slice(start, src.indexOf('}', start) + 1);
  assert.match(rule, /min-height:100dvh/);
  assert.ok(!/overflow:\s*(auto|scroll)/.test(rule));
});

// ---------- critical controls remain outside the debug overflow region ----------

test('10. the debug panels are top-anchored only (top/left/right, no bottom-spanning rule) so they cannot structurally cover bottom scanner controls', () => {
  const rule = scanDebugPanelRule();
  assert.match(rule, /top:max\(68px/);
  assert.ok(!/bottom:/.test(rule));
});

// ---------- safe-area handling ----------

test('11. scan-debug-panel and diag rails all account for env(safe-area-inset-*)', () => {
  assert.match(scanDebugPanelRule(), /env\(safe-area-inset-top\)/);
  assert.match(diagRailStyle('left'), /env\(safe-area-inset-top\)/);
  assert.match(diagRailStyle('left'), /env\(safe-area-inset-left\)/);
  assert.match(diagRailStyle('right'), /env\(safe-area-inset-right\)/);
});

// ---------- short-screen handling ----------

test('12. bounded max-height values are relative (vh) so they naturally shrink on a shorter screen rather than overflowing a fixed pixel box', () => {
  assert.match(scanDebugPanelRule(), /max-height:52vh/);
  assert.match(diagRailStyle('left'), /max-height:70vh/);
});

// ---------- camera/HUD firewall ----------

test('13. camera viewport geometry (video element object-fit/transform) is byte-unchanged', () => {
  const src = readIndex();
  assert.match(src, /video\{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX\(-1\) scale\(\.88\);transform-origin:center center;transition:transform \.16s ease;background:#000\}/);
});

test('14. #overlay (HUD canvas) geometry/z-index unchanged', () => {
  const src = readIndex();
  assert.match(src, /#overlay\{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:7\}/);
});

test('15. .camera-stage sizing unchanged', () => {
  const src = readIndex();
  assert.match(src, /\.camera-stage\{position:relative;height:100dvh;min-height:580px;background:#020405;overflow:hidden\}/);
});

// ---------- scanner-logic firewall ----------

test('16. DIST / Front 3D authority default (SCAN-LOCK-V1C fix) is unchanged', () => {
  const src = readIndex();
  assert.match(src, /window\.__front3DDecisionAuthoritative = \(typeof window\.__front3DDecisionAuthoritative==='boolean'\) \? window\.__front3DDecisionAuthoritative : true;/);
});

test('17. Profile/Chin-Up thresholds unchanged', () => {
  const src = readIndex();
  assert.match(src, /const PROFILE_YAW_MIN=38, PROFILE_YAW_MAX=60;/);
});

test('18. scanner readiness wiring (qualityFor/ready/mgScan2Ready) unchanged', () => {
  const src = readIndex();
  assert.match(src, /function qualityFor\(m\)\{/);
  assert.match(src, /const ready=q\.ok&&stableFrames>=4&&\(STEPS\[currentStepIndex\]\.id!=='front'\|\|sessionCalibrated\);/);
});

test('19. sacrosanct burst-recorder byte-substring is unchanged', () => {
  const src = readIndex();
  const startIdx = src.indexOf('const TEMPORAL_BURST_TARGET_INTERVAL_MS');
  const endStart = src.indexOf('function __updateMotionBurstIndicatorUI(){');
  const endIdx = src.indexOf('\n}', endStart) + 2;
  assert.equal(sha256(src.slice(startIdx, endIdx)), 'eae6776bf4299af02f41b0ac3805bb59eb0167dc903c45a9ca08e87941f0762a');
});

test('20. whole-scan recorder / temporal-subphase instrumentation unchanged', () => {
  const src = readIndex();
  assert.match(src, /function __temporalSubphaseClassify\(facts\)\{/);
  assert.match(src, /function __wholeScanMaybeSample\(nowMs, metrics, q, ready\)\{/);
});

test('21. native Voice Guidance transport/phrases unchanged', () => {
  const src = readIndex();
  assert.match(src, /var mgVoice = \{/);
  assert.match(src, /_hasNativeBridge\(\)\{/);
  assert.match(src, /mgVoice\.speak\('Hold\.'\)/);
  assert.match(src, /mgVoice\.speak\('Got it\.'\)/);
});

test('22. worker.js is unchanged by this stage', () => {
  assert.equal(sha256(readFileSync(WORKER_PATH)), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});

test('23. no network call introduced in the changed CSS/markup regions', () => {
  const rule = scanDebugPanelRule();
  assert.ok(!/url\(https?:|fetch\(|XMLHttpRequest/.test(rule));
});

test('24. this stage touches only layout (CSS/style attributes) for the two debug panels -- no changes to verifyOverlayPresentation()\'s diagnostic computation logic', () => {
  const src = readIndex();
  assert.match(src, /function verifyOverlayPresentation\(now=performance\.now\(\)\)\{if\(!overlayDebugEnabled\|\|now-overlayDiagnostics\.lastReportAt<250\)return;/);
});
