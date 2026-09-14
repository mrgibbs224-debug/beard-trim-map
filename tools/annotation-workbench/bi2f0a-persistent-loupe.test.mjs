import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PC = require('./precision-annotation-core.cjs');

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
const INDEX_HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

// ---------- 1. source is original image pixels ----------

test('1. drawLoupe samples ONLY the real <img> element via canvas drawImage, with imageSmoothingEnabled=false (no interpolation/sharpening/enhancement)', () => {
  const i = INDEX_HTML.indexOf('function drawLoupe(e){');
  const end = INDEX_HTML.indexOf('\n  }', i);
  const body = INDEX_HTML.slice(i, end);
  assert.match(body, /mctx\.drawImage\(img,/);
  assert.match(body, /imageSmoothingEnabled\s*=\s*false/);
  assert.ok(!/blur|sharpen|enhance|interpolat/i.test(body));
});

// ---------- 2. hover coordinate maps to correct raw image coordinate ----------

test('2. the hover listener converts display coordinates to raw image coordinates using the SAME displayClickToImagePoint function the click handler uses (no duplicate/second conversion path)', () => {
  const i = INDEX_HTML.indexOf("el('img').addEventListener('mousemove'");
  const end = INDEX_HTML.indexOf('\n  });', i);
  const body = INDEX_HTML.slice(i, end);
  assert.match(body, /A\.displayClickToImagePoint\(ev\.offsetX, ev\.offsetY, img\.clientWidth, img\.clientHeight, img\.naturalWidth, img\.naturalHeight\)/);
});

test('2b. computeLoupeSampleRect produces a source rect exactly centered on the requested raw point at the requested zoom', () => {
  const rect = PC.computeLoupeSampleRect(100, 80, 8, 160);
  const half = 160 / (2 * 8);
  assert.ok(Math.abs(rect.sx - (100 - half)) < 1e-9);
  assert.ok(Math.abs(rect.sy - (80 - half)) < 1e-9);
  assert.ok(Math.abs(rect.sw - half * 2) < 1e-9 && Math.abs(rect.sh - half * 2) < 1e-9);
});

// ---------- 3. selected vertex takes precedence over hover position ----------

test('3. drawLoupe checks selectedHandle/reviewState BEFORE falling back to hoverImagePoint (precedence order proven by source position)', () => {
  const i = INDEX_HTML.indexOf('function drawLoupe(e){');
  const end = INDEX_HTML.indexOf('\n  }', i);
  const body = INDEX_HTML.slice(i, end);
  const selectedCheckIdx = body.indexOf('selectedHandle!=null');
  const hoverFallbackIdx = body.indexOf('if(!p) p=hoverImagePoint;');
  assert.ok(selectedCheckIdx >= 0 && hoverFallbackIdx >= 0 && selectedCheckIdx < hoverFallbackIdx, 'selected-vertex check must come before the hover fallback');
});

// ---------- 4. magnification control does not change stored coordinates ----------

test('4. the loupe zoom <select> handler never calls any state-mutating AWB function', () => {
  const i = INDEX_HTML.indexOf("el('magZoomSelect').addEventListener('change'");
  const end = INDEX_HTML.indexOf('});', i) + 3;
  const body = INDEX_HTML.slice(i, end);
  assert.ok(!/A\.(move|add|delete|undo|redo|reset|lock|set)/.test(body));
  assert.match(body, /loupeZoom\s*=/);
});

test('4b. LOUPE_ZOOM_LEVELS is exactly 4/6/8/10 and computeLoupeSampleRect falls back to the default for an invalid zoom rather than an arbitrary value', () => {
  assert.deepEqual(PC.LOUPE_ZOOM_LEVELS, [4, 6, 8, 10]);
  const rectValid = PC.computeLoupeSampleRect(50, 50, 8, 160);
  const rectInvalid = PC.computeLoupeSampleRect(50, 50, 999, 160);
  const rectDefault = PC.computeLoupeSampleRect(50, 50, PC.DEFAULT_LOUPE_ZOOM, 160);
  assert.notDeepEqual(rectValid, rectInvalid);
  assert.deepEqual(rectInvalid, rectDefault);
});

// ---------- 5. loupe display does not affect export ----------

test('5. loupe/hover/zoom state variables are never referenced by any export/build function', () => {
  const src = readFileSync(new URL('./annotation-workbench.cjs', import.meta.url), 'utf8');
  assert.ok(!/hoverImagePoint|loupeZoom|magZoomSelect|drawLoupe/.test(src), 'the data-core module must know nothing about the loupe UI');
});

test('5b. drawLoupe/hover handlers never call any of the point-mutating AWB functions', () => {
  const i = INDEX_HTML.indexOf('var loupeZoom = 6, hoverImagePoint = null;');
  const end = INDEX_HTML.indexOf("el('img').addEventListener('mouseleave'");
  const endBlock = INDEX_HTML.indexOf('});', end) + 3;
  const body = INDEX_HTML.slice(i, endBlock);
  assert.ok(!/A\.(moveHandlePoint|addHandlePoint|deleteHandlePoint|addContourPoint|insertContourPoint|undoLastEdit|redoLastEdit)/.test(body));
});

// ---------- 6. BLIND_GT remains prediction-free ----------

test('6. the loupe is never gated by isBlindBundle() -- it stays available in blind mode (Part 12: it only shows the same raw pixels the human already sees)', () => {
  const i = INDEX_HTML.indexOf('function drawLoupe(e){');
  const end = INDEX_HTML.indexOf('\n  }', i);
  const body = INDEX_HTML.slice(i, end);
  assert.ok(!/isBlindBundle/.test(body));
});

test('6b. the loupe never draws any machine-proposal, Hairness, or occupancy content -- only the decoded <img> element', () => {
  const i = INDEX_HTML.indexOf('function drawLoupe(e){');
  const end = INDEX_HTML.indexOf('\n  }', i);
  const body = INDEX_HTML.slice(i, end);
  assert.ok(!/proposal|hairness|occupancy/i.test(body));
});

// ---------- 7. no network calls ----------

test('7. precision-annotation-core.cjs (loupe geometry additions included) still has zero network calls', () => {
  const src = readFileSync(new URL('./precision-annotation-core.cjs', import.meta.url), 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(src));
});

// ---------- 8. production files unchanged ----------

test('8. production hashes (index.html at repo root, worker.js) remain unchanged', () => {
  const idx = readFileSync(new URL('../../index.html', import.meta.url));
  const wkr = readFileSync(new URL('../../worker.js', import.meta.url));
  assert.equal(sha256(idx), '928747a5d284060dddac43c95f97a1669492ab4d1ecebf0d34bc59f3a3b5b521');
  assert.equal(sha256(wkr), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});

test('8b. accuracy modules (neck scaffold, BI-2E occupancy) remain unchanged', () => {
  assert.equal(sha256(readFileSync(new URL('../../accuracy/sparse-neck-scaffold-v1.mjs', import.meta.url))), '3798248b018919a61dea71173802b7a4acf6420447edffecc3e49da020d306f9');
  assert.equal(sha256(readFileSync(new URL('../../accuracy/region-scoped-beard-occupancy-v1.mjs', import.meta.url))), '4296668b88e121859db0a40ff69bce19c3c47f0b273363acb73e133795d6eaaa');
});

// ---------- bonus: size/shape/reuse requirements ----------

test('bonus: the loupe canvas is 180px (within the requested 160-220px range) and circular (border-radius:50%)', () => {
  assert.match(INDEX_HTML, /#magCanvas\{[^}]*border-radius:50%/);
  assert.match(INDEX_HTML, /<canvas id="magCanvas" width="180" height="180">/);
});

test('bonus: drawMagnifier is preserved as a backward-compatible alias to drawLoupe (existing call sites keep working, no duplicate sampling logic)', () => {
  assert.match(INDEX_HTML, /function drawMagnifier\(e\)\{ drawLoupe\(e\); \}/);
});

test('bonus: the loupe is positioned in a fixed corner (never follows the cursor itself)', () => {
  assert.match(INDEX_HTML, /#magnifier\{position:absolute;right:10px;bottom:10px/);
});
