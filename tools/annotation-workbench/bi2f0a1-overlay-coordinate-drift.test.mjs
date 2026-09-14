import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PC = require('./precision-annotation-core.cjs');

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
const INDEX_HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

// A representative "correct" overlay box: #img's own measured box (BI-2F0A.1 fix), NOT the
// (buggy) container-assumed box. left/top simulate the image being offset within #imgStack by
// some amount (e.g. due to a scrollbar/side-panel/centering), width/height simulate a real
// rendered CSS size for a 640x480 natural image.
const NATURAL_W = 640, NATURAL_H = 480;
function correctBox() { return { left: 12, top: 7, width: 800, height: 600 }; } // 1.25x scale, offset origin

// ---------- 1/2/3. round trip (general, center 320,240, multiple points) ----------

test('1. client/display -> raw -> display round trip has near-zero residual using the CORRECT (image-measured) overlay box', () => {
  const box = correctBox();
  const displayPoints = [
    { x: box.left + 5, y: box.top + 5 },                          // top-left-ish
    { x: box.left + box.width / 2, y: box.top + box.height / 2 }, // center
    { x: box.left + box.width - 5, y: box.top + box.height - 5 }  // bottom-right-ish
  ];
  displayPoints.forEach(p => {
    const rt = PC.roundTripResidual(p.x, p.y, box, NATURAL_W, NATURAL_H);
    assert.ok(rt.residualPx <= 0.5, `residual ${rt.residualPx} exceeds 0.5px for point ${JSON.stringify(p)}`);
  });
});

test('2. the known synthetic CENTER MARKER at raw (320,240) round-trips through the correct box', () => {
  const box = correctBox();
  const displayOfCenter = PC.rawToDisplay(320, 240, box, NATURAL_W, NATURAL_H);
  // sanity: 320,240 is exactly the natural-image center, so its display position should be the
  // exact center of the measured box too.
  assert.ok(Math.abs(displayOfCenter.x - (box.left + box.width / 2)) < 1e-9);
  assert.ok(Math.abs(displayOfCenter.y - (box.top + box.height / 2)) < 1e-9);
  const rt = PC.roundTripResidual(displayOfCenter.x, displayOfCenter.y, box, NATURAL_W, NATURAL_H);
  assert.ok(rt.residualPx < 1e-6);
  assert.ok(Math.abs(rt.raw.x - 320) < 1e-6 && Math.abs(rt.raw.y - 240) < 1e-6);
});

test('3. multiple synthetic points along a guide curve all round-trip within tolerance', () => {
  const box = correctBox();
  // points loosely following the dashed guide's raw-pixel path used in the acceptance bundle
  const guidePoints = [[80, 380], [160, 300], [240, 340], [320, 260], [400, 220], [480, 180], [560, 140]];
  guidePoints.forEach(([rx, ry]) => {
    const disp = PC.rawToDisplay(rx, ry, box, NATURAL_W, NATURAL_H);
    const rt = PC.roundTripResidual(disp.x, disp.y, box, NATURAL_W, NATURAL_H);
    assert.ok(rt.residualPx <= 0.5);
    assert.ok(Math.abs(rt.raw.x - rx) < 1, `raw x drifted for guide point (${rx},${ry})`);
    assert.ok(Math.abs(rt.raw.y - ry) < 1, `raw y drifted for guide point (${rx},${ry})`);
  });
});

// ---------- 4. resize invariance ----------

test('4. resize invariance -- a different box size/position (simulating a window resize) still round-trips correctly on its own terms', () => {
  const resizedBox = { left: 20, top: 15, width: 480, height: 360 }; // smaller window
  const disp = PC.rawToDisplay(320, 240, resizedBox, NATURAL_W, NATURAL_H);
  const rt = PC.roundTripResidual(disp.x, disp.y, resizedBox, NATURAL_W, NATURAL_H);
  assert.ok(rt.residualPx < 1e-6);
});

// ---------- 5. scroll/pan invariance ----------

test('5. scroll/pan invariance -- shifting box.left/top (simulating a scrolled viewport) does not change the raw point recovered for the same relative click', () => {
  const box1 = { left: 0, top: 0, width: 640, height: 480 };
  const box2 = { left: -200, top: -100, width: 640, height: 480 }; // panned/scrolled
  const relClick = { x: 100, y: 100 }; // same position RELATIVE to the image in both cases
  const raw1 = PC.displayToRaw(box1.left + relClick.x, box1.top + relClick.y, box1, NATURAL_W, NATURAL_H);
  const raw2 = PC.displayToRaw(box2.left + relClick.x, box2.top + relClick.y, box2, NATURAL_W, NATURAL_H);
  assert.ok(Math.abs(raw1.x - raw2.x) < 1e-9 && Math.abs(raw1.y - raw2.y) < 1e-9);
});

// ---------- 6. tool zoom invariance ----------

test('6. tool zoom invariance -- a zoomed (larger) box still recovers the same raw point for the same relative click position', () => {
  const box1x = { left: 0, top: 0, width: 640, height: 480 };
  const box2x = { left: 0, top: 0, width: 1280, height: 960 }; // 2x zoom
  const raw1 = PC.displayToRaw(320, 240, box1x, NATURAL_W, NATURAL_H); // center of 1x box
  const raw2 = PC.displayToRaw(640, 480, box2x, NATURAL_W, NATURAL_H); // center of 2x box
  assert.ok(Math.abs(raw1.x - raw2.x) < 1e-9 && Math.abs(raw1.y - raw2.y) < 1e-9);
});

// ---------- 7/8. mirror / rotation invariance ----------

test('7. mirror invariance -- the coordinate model never references mirror state at all (mirroring is a transform on the SHARED parent of #img and the overlay, applied identically to both, so this layer is correctly mirror-agnostic)', () => {
  const src = readFileSync(new URL('./precision-annotation-core.cjs', import.meta.url), 'utf8');
  assert.ok(!/mirror/i.test(src), 'the pure coordinate-model functions must not need mirror-specific branches');
});

test('8. rotation invariance -- round-trip math is agnostic to which box dimensions represent "rotated" vs "normal" layout (transforms never change #img\'s own offsetWidth/Height, only how they are painted)', () => {
  const normalBox = { left: 0, top: 0, width: 640, height: 480 };
  const rotatedLayoutBox = { left: 0, top: 0, width: 640, height: 480 }; // offsetWidth/Height unchanged by a CSS transform
  [normalBox, rotatedLayoutBox].forEach(box => {
    const disp = PC.rawToDisplay(320, 240, box, NATURAL_W, NATURAL_H);
    const rt = PC.roundTripResidual(disp.x, disp.y, box, NATURAL_W, NATURAL_H);
    assert.ok(rt.residualPx < 1e-6);
  });
});

// ---------- 9. overlay SVG/image dimensions remain consistent (the actual fix) ----------

test('9. syncOverlayGeometry measures #img\'s OWN offsetLeft/Top/Width/Height and applies that exact box to all 3 overlay SVGs (the coordinate-drift fix itself)', () => {
  const i = INDEX_HTML.indexOf('function syncOverlayGeometry()');
  const end = INDEX_HTML.indexOf('\n  }', i);
  const body = INDEX_HTML.slice(i, end);
  assert.match(body, /img\.offsetLeft/);
  assert.match(body, /img\.offsetTop/);
  assert.match(body, /img\.offsetWidth/);
  assert.match(body, /img\.offsetHeight/);
  assert.match(body, /geomOverlay/);
  assert.match(body, /contourOverlay/);
  assert.match(body, /reviewOverlay/);
});

test('9b. syncOverlayGeometry is called after image load, after every render(), and on window resize -- never only once', () => {
  assert.match(INDEX_HTML, /addEventListener\('load', function\(\)\{ syncOverlayGeometry\(\); \}\)/);
  assert.match(INDEX_HTML, /renderReview\(e\);\s*\n\s*\/\/ BI-2F0A\.1[\s\S]{0,220}syncOverlayGeometry\(\);/);
  assert.match(INDEX_HTML, /window\.addEventListener\('resize', function\(\)\{ if\(bundle\) syncOverlayGeometry\(\); \}\)/);
});

test('9c. the overlay CSS inset:0/width:100%/height:100% is documented as a fallback only, overridden by JS-measured inline styles', () => {
  assert.match(INDEX_HTML, /FALLBACK for the instant before/);
});

// ---------- 10. two OPEN_POLYLINE targets use identical coordinate math ----------

test('10. addContourPoint / insertContourPoint contain no per-contourType coordinate branching -- the same ratio math applies to every target', () => {
  const src = readFileSync(new URL('./annotation-workbench.cjs', import.meta.url), 'utf8');
  const i = src.indexOf('function addContourPoint');
  const end = src.indexOf('\n  }', i);
  const body = src.slice(i, end);
  assert.ok(!/contourType\s*===|contourType\s*==/.test(body), 'addContourPoint must not special-case coordinates per contour type');
});

// ---------- 11. active/inactive visual distinction does not alter geometry ----------

test('11. the focusedContourType / dim-class logic only affects the rendered CSS class string, never the points array or export data', () => {
  const i = INDEX_HTML.indexOf('var visualFocus = activeContourType || focusedContourType;');
  assert.ok(i >= 0);
  const nearby = INDEX_HTML.slice(i, i + 300);
  assert.match(nearby, /var dim = /);
  assert.ok(!/\.points\s*=|\.points\.(push|splice)/.test(nearby), 'dim-class computation must not touch the points array');
});

// ---------- 12. no production files changed ----------

test('12. production hashes (index.html at repo root, worker.js) remain unchanged', () => {
  const idx = readFileSync(new URL('../../index.html', import.meta.url));
  const wkr = readFileSync(new URL('../../worker.js', import.meta.url));
  assert.equal(sha256(idx), '928747a5d284060dddac43c95f97a1669492ab4d1ecebf0d34bc59f3a3b5b521');
  assert.equal(sha256(wkr), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});

test('12b. accuracy modules (neck scaffold, BI-2E occupancy) remain unchanged', () => {
  assert.equal(sha256(readFileSync(new URL('../../accuracy/sparse-neck-scaffold-v1.mjs', import.meta.url))), '3798248b018919a61dea71173802b7a4acf6420447edffecc3e49da020d306f9');
  assert.equal(sha256(readFileSync(new URL('../../accuracy/region-scoped-beard-occupancy-v1.mjs', import.meta.url))), '4296668b88e121859db0a40ff69bce19c3c47f0b273363acb73e133795d6eaaa');
});

// ---------- bonus: proves the BUG mechanism itself (not just the fix) ----------

test('bonus: a WRONG overlay box (simulating the pre-fix bug, e.g. container-sized rather than #img-sized) reproduces a systematic, non-zero, DIRECTIONAL drift -- exactly the reported symptom', () => {
  const correctImgBox = { left: 12, top: 7, width: 800, height: 600 };
  // simulate the historical bug: SVG rendered against the WRAPPER's box (larger / differently
  // positioned than #img's own box) while the click conversion used #img's real box.
  const buggyContainerBox = { left: 0, top: 0, width: 824, height: 614 };
  const rawFromRealClick = PC.displayToRaw(correctImgBox.left + 100, correctImgBox.top + 100, correctImgBox, NATURAL_W, NATURAL_H);
  const wronglyRenderedBack = PC.rawToDisplay(rawFromRealClick.x, rawFromRealClick.y, buggyContainerBox, NATURAL_W, NATURAL_H);
  const dx = wronglyRenderedBack.x - (correctImgBox.left + 100), dy = wronglyRenderedBack.y - (correctImgBox.top + 100);
  const residual = Math.hypot(dx, dy);
  assert.ok(residual > 1, `expected a reproducible drift >1px with a mismatched box, got ${residual}`);
});
