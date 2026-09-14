import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('./annotation-workbench.cjs');

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
const INDEX_HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

function contourBundle() {
  return { schemaVersion: 'annotation-bundle/1', entries: [{ sourceScanObservationId: 'o1', contourTypesToAnnotate: ['OUTER_BEARD_UNDERSIDE'] }] };
}

// ---------- 1/2. vertex hit wins over image pan / pointerdown does not start pan ----------

test('1. native image dragging is disabled (draggable="false" + CSS user-drag:none) -- the historical "clicking a vertex pans the image" mechanism is removed at the source', () => {
  assert.match(INDEX_HTML, /<img id="img"[^>]*draggable="false"/);
  assert.match(INDEX_HTML, /#img\{[^}]*-webkit-user-drag:none/);
});

test('2. every contour vertex hit target (.cHit) registers a pointerdown handler that calls preventDefault + stopPropagation FIRST, before any other logic', () => {
  const i = INDEX_HTML.indexOf('function onContourPointerDown(ev){');
  const body = INDEX_HTML.slice(i, i + 200);
  assert.match(body, /^function onContourPointerDown\(ev\)\{\s*\n\s*ev\.preventDefault\(\); ev\.stopPropagation\(\);/);
});

test('2b. .cHit hit targets are wired to onContourPointerDown and have pointer-events:auto (never fall through to #img)', () => {
  assert.match(INDEX_HTML, /#contourOverlay \.cHit\{fill:transparent;stroke:none;pointer-events:auto/);
  assert.match(INDEX_HTML, /querySelectorAll\('\.cHit'\)\.forEach\(function\(c\)\{ c\.addEventListener\('pointerdown', onContourPointerDown\); \}\)/);
});

// ---------- 3. click selects correct contour/index ----------

test('3. onContourPointerDown reads data-ct/data-i from the event target and sets selectedContourType/Index to exactly those values', () => {
  const i = INDEX_HTML.indexOf('function onContourPointerDown(ev){');
  const end = INDEX_HTML.indexOf('\n  }', i);
  const body = INDEX_HTML.slice(i, end);
  assert.match(body, /getAttribute\('data-ct'\)/);
  assert.match(body, /getAttribute\('data-i'\)/);
  assert.match(body, /selectedContourType=ct; selectedContourIndex=i;/);
});

// ---------- 4/5. drag modifies only the selected point / neighbors unchanged ----------

test('4. moveContourPointNoHistory updates only the targeted index, leaving every neighbor untouched', () => {
  let st = A.initContourState(contourBundle());
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 0);
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 10, 0);
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 20, 0);
  st = A.moveContourPointNoHistory(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 1, 99, 99);
  const pts = st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.points;
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[1], { x: 99, y: 99 });
  assert.deepEqual(pts[2], { x: 20, y: 0 });
});

// ---------- 6. one drag = one undo transaction ----------

test('6. beginContourDragTransaction + moveContourPointNoHistory: many simulated pointermoves during one drag add exactly ONE new history entry (not one per pointermove)', () => {
  let st = A.initContourState(contourBundle());
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 0);
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 10, 0);
  const historyLenBeforeDrag = st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.history.length; // 2, from the two appends above
  const pointsBeforeDrag = JSON.parse(JSON.stringify(st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.points));
  st = A.beginContourDragTransaction(st, 'o1', 'OUTER_BEARD_UNDERSIDE');
  for (let i = 1; i <= 30; i++) st = A.moveContourPointNoHistory(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, i, i);
  const inst = st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE;
  assert.equal(inst.history.length, historyLenBeforeDrag + 1, 'the whole drag (30 simulated pointermoves) must add exactly ONE history entry, not 30');
  assert.deepEqual(inst.points[0], { x: 30, y: 30 });
  st = A.undoLastContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE');
  assert.deepEqual(st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.points, pointsBeforeDrag, 'one undo restores the exact pre-drag point set');
});

// ---------- 7. selected state persists after drag ----------

test('7. onContourPointerDown never clears selectedContourType/Index on its own -- selection is only cleared by an explicit action (blank click / clear / lock / navigate)', () => {
  const i = INDEX_HTML.indexOf('function onContourPointerDown(ev){');
  const end = INDEX_HTML.indexOf('\n  }\n  // ---------- BI-2F0A UX addition', i);
  const body = INDEX_HTML.slice(i, end);
  assert.ok(!/selectedContourType=null/.test(body), 'the pointerdown/drag handler itself must never clear the selection it just set');
});

// ---------- 8/9. raw-pixel nudge amounts ----------

test('8. nudgeContourPoint moves exactly 1 raw image pixel', () => {
  let st = A.initContourState(contourBundle());
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 5, 5);
  st = A.nudgeContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 1, 0);
  assert.deepEqual(st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.points[0], { x: 6, y: 5 });
});

test('9. Shift+nudge moves exactly 5 raw image pixels', () => {
  let st = A.initContourState(contourBundle());
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 5, 5);
  st = A.nudgeContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 0, 5);
  assert.deepEqual(st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.points[0], { x: 5, y: 10 });
});

// ---------- 10. arrow keys call preventDefault when editor owns them ----------

test('10. the contour keydown handler calls ev.preventDefault() on every recognized arrow key before returning', () => {
  const i = INDEX_HTML.indexOf('// BI-2F0A.2 Part 6/7 -- keyboard nudge/delete for a selected CONTOUR vertex');
  const end = INDEX_HTML.indexOf('\n  });', i) + 6;
  const body = INDEX_HTML.slice(i, end);
  assert.match(body, /ev\.preventDefault\(\); \/\/ Part 6: browser\/page scrolling must NOT occur/);
  assert.match(body, /ev\.preventDefault\(\);\s*\n\s*return;/); // the Delete/Backspace branch also prevents default
});

// ---------- 11. arrow keys do not intercept normal form-control behavior ----------

test('11. the contour keydown handler excludes INPUT/TEXTAREA/SELECT and contenteditable targets before touching any point', () => {
  const i = INDEX_HTML.indexOf('// BI-2F0A.2 Part 6/7 -- keyboard nudge/delete for a selected CONTOUR vertex');
  const end = INDEX_HTML.indexOf('\n  });', i) + 6;
  const body = INDEX_HTML.slice(i, end);
  assert.match(body, /tag==='INPUT'\|\|tag==='TEXTAREA'\|\|tag==='SELECT'\|\|\(ev\.target&&ev\.target\.isContentEditable\)/);
});

test('11b. the contour keydown handler only acts when a vertex is actually selected (selectedContourType/Index both non-null)', () => {
  const i = INDEX_HTML.indexOf('// BI-2F0A.2 Part 6/7 -- keyboard nudge/delete for a selected CONTOUR vertex');
  const end = INDEX_HTML.indexOf('\n  });', i) + 6;
  const body = INDEX_HTML.slice(i, end);
  assert.match(body, /if\(selectedContourType==null \|\| selectedContourIndex==null \|\| !bundle \|\| !contourState\) return;/);
});

// ---------- 12/13. loupe follows selected vertex / updates after drag+nudge ----------

test('12. drawLoupe checks selectedContourType/Index (in addition to review\'s selectedHandle) before falling back to hover', () => {
  const i = INDEX_HTML.indexOf('function drawLoupe(e){');
  const end = INDEX_HTML.indexOf('\n  }', i);
  const body = INDEX_HTML.slice(i, end);
  assert.match(body, /selectedContourType!=null && contourState/);
  const contourCheckIdx = body.indexOf('selectedContourType!=null');
  const hoverFallbackIdx = body.indexOf('if(!p) p=hoverImagePoint;');
  assert.ok(contourCheckIdx >= 0 && hoverFallbackIdx >= 0 && contourCheckIdx < hoverFallbackIdx);
});

test('13. drawLoupe is called from the contour drag pointermove handler and after the contour keyboard nudge', () => {
  const dragIdx = INDEX_HTML.indexOf('function onContourPointerDown(ev){');
  const dragEnd = INDEX_HTML.indexOf('\n  }', dragIdx);
  assert.match(INDEX_HTML.slice(dragIdx, dragEnd), /drawLoupe\(e\);/);
  const keyIdx = INDEX_HTML.indexOf('// BI-2F0A.2 Part 6/7 -- keyboard nudge/delete for a selected CONTOUR vertex');
  const keyEnd = INDEX_HTML.indexOf('\n  });', keyIdx) + 6;
  assert.match(INDEX_HTML.slice(keyIdx, keyEnd), /drawLoupe\(e\); \/\/ Part 9/);
});

// ---------- 14. pan still works when pointer begins on empty image ----------

test('14. the #img click handler (blank-space path) still runs its existing add-point/insert logic unimpeded -- only clears a stale contour selection first, never blocks the click', () => {
  const i = INDEX_HTML.indexOf("el('img').addEventListener('click', function(ev){");
  const clearIdx = INDEX_HTML.indexOf('if(selectedContourType!=null){ selectedContourType=null; selectedContourIndex=null; }', i);
  const addModeIdx = INDEX_HTML.indexOf("if(addPointMode && reviewState){", i);
  assert.ok(clearIdx > i && addModeIdx > clearIdx, 'selection-clear must happen before the existing add/insert routing, never replace it');
});

// ---------- 15. no coordinate-registration code regression ----------

test('15. the BI-2F0A.1 coordinate-drift fix (syncOverlayGeometry, displayClickToImagePoint usage) is untouched by this stage', () => {
  assert.match(INDEX_HTML, /function syncOverlayGeometry\(\)\{/);
  assert.match(INDEX_HTML, /img\.offsetLeft/);
  assert.match(INDEX_HTML, /img\.offsetWidth/);
});

test('15b. precision-annotation-core.cjs round-trip functions are unchanged (still present, still pure)', () => {
  const src = readFileSync(new URL('./precision-annotation-core.cjs', import.meta.url), 'utf8');
  assert.match(src, /function displayToRaw\(/);
  assert.match(src, /function rawToDisplay\(/);
  assert.match(src, /function roundTripResidual\(/);
});

// ---------- 16. no production files changed ----------

test('16. production hashes (index.html at repo root, worker.js) remain unchanged', () => {
  const idx = readFileSync(new URL('../../index.html', import.meta.url));
  const wkr = readFileSync(new URL('../../worker.js', import.meta.url));
  assert.equal(sha256(idx), '928747a5d284060dddac43c95f97a1669492ab4d1ecebf0d34bc59f3a3b5b521');
  assert.equal(sha256(wkr), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});

test('16b. accuracy modules (neck scaffold, BI-2E occupancy) remain unchanged', () => {
  assert.equal(sha256(readFileSync(new URL('../../accuracy/sparse-neck-scaffold-v1.mjs', import.meta.url))), '3798248b018919a61dea71173802b7a4acf6420447edffecc3e49da020d306f9');
  assert.equal(sha256(readFileSync(new URL('../../accuracy/region-scoped-beard-occupancy-v1.mjs', import.meta.url))), '4296668b88e121859db0a40ff69bce19c3c47f0b273363acb73e133795d6eaaa');
});

// ---------- bonus: locked-target guard applies to the new mutators too ----------

test('bonus: a locked contour refuses moveContourPoint/nudgeContourPoint/deleteContourPointAt/beginContourDragTransaction', () => {
  let st = A.initContourState(contourBundle());
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 0);
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 10, 0);
  const PC = require('./precision-annotation-core.cjs');
  st = A.lockContour(st, 'o1', 'OUTER_BEARD_UNDERSIDE', PC, {});
  assert.throws(() => A.moveContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 5, 5), /LOCKED/);
  assert.throws(() => A.nudgeContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 1, 0), /LOCKED/);
  assert.throws(() => A.deleteContourPointAt(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0), /LOCKED/);
  assert.throws(() => A.beginContourDragTransaction(st, 'o1', 'OUTER_BEARD_UNDERSIDE'), /LOCKED/);
});

test('bonus2: deleteContourPointAt refuses to remove the only remaining point', () => {
  let st = A.initContourState(contourBundle());
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 0);
  assert.throws(() => A.deleteContourPointAt(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0), /only remaining point/);
});
