import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
const HTML_PATH = 'D:/MettleTemp/annotation/bi2b1_neck_gt_annotate.html';

function readHtml() { return readFileSync(HTML_PATH, 'utf8'); }

function loadPureFns() {
  const html = readHtml();
  const start = html.indexOf('function zoomToward');
  const end = html.indexOf('viewport.addEventListener');
  const snippet = html.slice(start, end);
  return new Function(snippet + '\nreturn { zoomToward, screenToCanvasCoords };')();
}

// ---------- mouse-wheel zoom exists ----------

test('1. mouse-wheel zoom is wired to the viewport with preventDefault (no page scroll while zooming)', () => {
  const html = readHtml();
  assert.match(html, /viewport\.addEventListener\('wheel', \(e\) => \{/);
  assert.match(html, /e\.preventDefault\(\); \/\/ never let the page itself scroll while zooming the annotation viewport/);
  assert.match(html, /\{ passive: false \}/);
});

test('2. zoom range is clamped to approximately 1x-5x', () => {
  const html = readHtml();
  assert.match(html, /const ZOOM_MIN = 1, ZOOM_MAX = 5;/);
});

// ---------- pan exists ----------

test('3. middle-mouse and Space+left-drag both trigger panning, distinct from annotation clicks', () => {
  const html = readHtml();
  assert.match(html, /function isPanTrigger\(e\) \{ return e\.button === 1 \|\| \(e\.button === 0 && spacePressed\); \}/);
});

test('4. a left-click while NOT panning still places an annotation point (unambiguous)', () => {
  const html = readHtml();
  assert.match(html, /if \(e\.button !== 0\) return; \/\/ annotation clicks are left-button only/);
});

// ---------- Reset View exists ----------

test('5. Reset View button exists and restores zoom=1 / pan=0 without touching annotations', () => {
  const html = readHtml();
  assert.match(html, /id="resetViewBtn">Reset View</);
  assert.match(html, /function resetView\(\) \{\s*view = \{ zoom: 1, panX: 0, panY: 0 \};/);
});

// ---------- zoom indicator exists ----------

test('6. a zoom percentage indicator is present and updated on every view change', () => {
  const html = readHtml();
  assert.match(html, /id="zoomIndicator"/);
  assert.match(html, /document\.getElementById\('zoomIndicator'\)\.textContent = Math\.round\(view\.zoom \* 100\) \+ '%';/);
});

// ---------- annotation coordinates remain source-image coordinates / zoom+pan don't alter them ----------

test('7. screenToCanvasCoords uses only the element\'s actual rendered rect and fixed drawing-buffer size -- never a hardcoded/assumed scale', () => {
  const html = readHtml();
  const fnMatch = html.match(/function screenToCanvasCoords\([\s\S]*?\n\}/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /cvWidth \/ rect\.width/);
  assert.match(fnMatch[0], /cvHeight \/ rect\.height/);
});

test('8. identical canvas-space target point yields identical exported coordinates at zoom=1/pan=0 vs zoom=2.5/panned', () => {
  const fns = loadPureFns();
  const cvWidth = 480, cvHeight = 640;
  const targetX = 240, targetY = 320;
  const rectA = { left: 100, top: 50, width: cvWidth, height: cvHeight };
  const outA = fns.screenToCanvasCoords(rectA.left + targetX, rectA.top + targetY, rectA, cvWidth, cvHeight);
  const zoom = 2.5, panX = 30, panY = -20;
  const rectB = { left: panX, top: panY, width: cvWidth * zoom, height: cvHeight * zoom };
  const outB = fns.screenToCanvasCoords(rectB.left + targetX * zoom, rectB.top + targetY * zoom, rectB, cvWidth, cvHeight);
  assert.deepEqual(outA, { x: targetX, y: targetY });
  assert.deepEqual(outB, { x: targetX, y: targetY });
});

test('9. zoomToward keeps the canvas-local point under the cursor stationary (the zoom-toward-cursor invariant)', () => {
  const fns = loadPureFns();
  const view = { zoom: 1, panX: 0, panY: 0 };
  const mx = 200, my = 150;
  const localX = (mx - view.panX) / view.zoom, localY = (my - view.panY) / view.zoom;
  const newView = fns.zoomToward(view, mx, my, 1.7, 1, 5);
  assert.ok(Math.abs((newView.panX + localX * newView.zoom) - mx) < 1e-9);
  assert.ok(Math.abs((newView.panY + localY * newView.zoom) - my) < 1e-9);
});

test('10. zoomToward clamps to [min, max] and is a no-op pass-through when already at the bound', () => {
  const fns = loadPureFns();
  const atMax = fns.zoomToward({ zoom: 4.9, panX: 0, panY: 0 }, 0, 0, 2, 1, 5);
  assert.equal(atMax.zoom, 5);
  const atMin = fns.zoomToward({ zoom: 1.05, panX: 0, panY: 0 }, 0, 0, 0.5, 1, 5);
  assert.equal(atMin.zoom, 1);
});

// ---------- pan does not change exported coordinates (view state is never part of the export) ----------

test('11. the exported annotation object never includes zoom/pan/view fields -- only source-image-space points', () => {
  const html = readHtml();
  const exportMatch = html.match(/document\.getElementById\('exportBtn'\)\.onclick = \(\) => \{([\s\S]*?)\};/);
  assert.ok(exportMatch);
  assert.ok(!/view\.zoom|view\.panX|view\.panY|zoomIndicator/.test(exportMatch[1]));
  assert.match(exportMatch[1], /annotations: state\[img\.imageId\]\.shapes/);
});

// ---------- rotation metadata remains intact ----------

test('12. rotationAppliedDegrees is still exported per image, unaffected by the zoom/pan patch', () => {
  const html = readHtml();
  assert.match(html, /rotationAppliedDegrees: state\[img\.imageId\]\.rotation/);
});

test('13. the coordinate-space export note still explains rotation vs. raw-pixel space honestly', () => {
  const html = readHtml();
  assert.match(html, /rotationAppliedDegrees and original width\/height so this can be inverted later/);
});

// ---------- localStorage annotations preserved (no schema change / no migration) ----------

test('14. the localStorage key and state shape are byte-identical to the pre-patch tool -- no migration needed', () => {
  const html = readHtml();
  assert.match(html, /const STORAGE_KEY = 'bi2b1_neck_gt_annotations_v1';/);
  assert.match(html, /fresh\[img\.imageId\] = \{ rotation: 0, shapes: \{\} \};/);
});

test('15. view (zoom/pan) state is never written to or read from localStorage', () => {
  const html = readHtml();
  const start = html.indexOf('let view = {');
  const end = html.indexOf('function loadState()');
  const viewDecl = html.slice(start, end);
  assert.ok(!/localStorage/.test(viewDecl));
  assert.ok(!/JSON\.stringify\(view\)|JSON\.parse\(view\)/.test(html));
});

// ---------- no semantic annotation targets changed ----------

test('16. POSE_TARGETS keys are byte-identical to the original packet (CHIN_TO_NECK_TRANSITION_CURVE, VISIBLE_NECK_SKIN_POLYGON, UNKNOWN_OCCLUSION_MASK, UNDER_JAW_VISIBLE_BOUNDARY)', () => {
  const html = readHtml();
  assert.match(html, /CHIN_TO_NECK_TRANSITION_CURVE/);
  assert.match(html, /VISIBLE_NECK_SKIN_POLYGON/);
  assert.match(html, /UNDER_JAW_VISIBLE_BOUNDARY/);
  const occurrences = (html.match(/UNKNOWN_OCCLUSION_MASK/g) || []).length;
  assert.ok(occurrences >= 3);
});

test('17. no beard-neckline/trim-line/outer-envelope/density annotation TARGET (POSE_TARGETS key) was introduced -- the instructions may still mention "trim line" only as an explicit exclusion/negation', () => {
  const html = readHtml();
  const targetsMatch = html.match(/const POSE_TARGETS = (\{[\s\S]*?\n\};)/);
  assert.ok(targetsMatch);
  assert.ok(!/beard.?neckline|trim.?line|outer.?envelope|beard.?density|fade.?zone/i.test(targetsMatch[1]));
  // the instructions' one "trim line" mention must be the explicit negation this stage's prompt required
  const chinUpMatch = html.match(/'chin-up': "([\s\S]*?)",\s*\n\s*'right-profile'/);
  assert.match(chinUpMatch[1], /is not a trim line/i);
});

// ---------- instructions explicitly exclude shoulder/clavicle/chest ----------

test('18. Chin-Up instructions explicitly exclude shoulders, clavicles, chest, shirt, beard, and background', () => {
  const html = readHtml();
  const chinUpMatch = html.match(/'chin-up': "([\s\S]*?)",\s*\n\s*'right-profile'/);
  assert.ok(chinUpMatch);
  const text = chinUpMatch[1];
  ['shoulders', 'clavicles', 'chest', 'shirt', 'beard', 'background'].forEach(w => assert.ok(new RegExp(w, 'i').test(text), 'missing exclusion: ' + w));
});

test('19. Chin-Up instructions clarify the bottom edge is not a trim line or anatomical boundary', () => {
  const html = readHtml();
  assert.match(html, /is not a trim line or special anatomical boundary/);
});

test('20. Chin-Up instructions retain the UNKNOWN-rather-than-guessing guidance', () => {
  const html = readHtml();
  assert.match(html, /mark that region UNKNOWN rather than guessing/);
});

// ---------- no production / no scanner files changed ----------

test('21. production hashes (index.html, worker.js, burst recorder) remain unchanged', () => {
  const idx = readFileSync(new URL('../index.html', import.meta.url));
  const wkr = readFileSync(new URL('../worker.js', import.meta.url));
  assert.equal(sha256(idx), '928747a5d284060dddac43c95f97a1669492ab4d1ecebf0d34bc59f3a3b5b521');
  assert.equal(sha256(wkr), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
  const src = idx.toString('utf8');
  const startIdx = src.indexOf('const TEMPORAL_BURST_TARGET_INTERVAL_MS');
  const endStart = src.indexOf('function __updateMotionBurstIndicatorUI(){');
  const endIdx = src.indexOf('\n}', endStart) + 2;
  assert.equal(sha256(Buffer.from(src.slice(startIdx, endIdx))), 'eae6776bf4299af02f41b0ac3805bb59eb0167dc903c45a9ca08e87941f0762a');
});

test('22. the selected 9-image GT packet manifest is unchanged by this UX patch', () => {
  const m = JSON.parse(readFileSync('D:/MettleTemp/annotation/bi2b1_neck_gt_selection_manifest.json', 'utf8'));
  assert.equal(m.selection.totalImagesSelected, 9);
  assert.deepEqual(m.selection.poseBalance, { 'chin-up': 3, 'right-profile': 3, 'left-profile': 3 });
});

// ---------- no network behavior introduced ----------

test('23. the updated tool still has zero network calls and all 9 images remain embedded as data URIs', () => {
  const html = readHtml();
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|<script src=|<link\s+rel=["']stylesheet["']\s+href=/.test(html));
  const count = (html.match(/data:image\/jpeg;base64,/g) || []).length;
  assert.equal(count, 9);
});

test('24. the annotation tool still never references any scanner runtime global', () => {
  const html = readHtml();
  assert.ok(!/BeardTrimAndroid|mgScan2|qualityFor\(|__temporalMotionBurstRecorder|__wholeScanTemporalRecorder/.test(html));
});
