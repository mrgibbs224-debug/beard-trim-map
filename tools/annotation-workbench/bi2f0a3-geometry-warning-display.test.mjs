import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PC = require('./precision-annotation-core.cjs');
const A = require('./annotation-workbench.cjs');

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
const INDEX_HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

// ---------- 1/2/3. self-intersection detection correctness ----------

test('1. a real self-intersecting OPEN_POLYLINE (bowtie) is detected', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
  const v = PC.validateGeometry(pts, PC.GEOMETRY_TYPE.OPEN_POLYLINE, 100, 100);
  assert.ok(v.warnings.includes('SELF_INTERSECTION'));
});

test('2. adjacent segments (sharing a vertex) are never falsely flagged as an intersection', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }, { x: 30, y: 0 }];
  const v = PC.validateGeometry(pts, PC.GEOMETRY_TYPE.OPEN_POLYLINE, 100, 100);
  assert.ok(!v.warnings.includes('SELF_INTERSECTION'));
});

test('3. OPEN_POLYLINE first/last edge relationship is never treated as a closing edge (a simple non-crossing zigzag never warns)', () => {
  const pts = [{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 40, y: 0 }, { x: 60, y: 20 }, { x: 80, y: 0 }];
  const v = PC.validateGeometry(pts, PC.GEOMETRY_TYPE.OPEN_POLYLINE, 200, 200);
  assert.ok(!v.warnings.includes('SELF_INTERSECTION'));
});

// ---------- 4/5/6. near-closed open curve ----------

test('4. a near-closed OPEN_POLYLINE (endpoints close together) is detected', () => {
  const pts = [{ x: 80, y: 380 }, { x: 300, y: 200 }, { x: 90, y: 390 }]; // ~14px apart on a 640x480 image
  const v = PC.validateGeometry(pts, PC.GEOMETRY_TYPE.OPEN_POLYLINE, 640, 480);
  assert.ok(v.warnings.includes('OPEN_POLYLINE_NEARLY_CLOSED'));
});

test('5. clearly non-near endpoints (opposite corners) never warn', () => {
  const pts = [{ x: 10, y: 10 }, { x: 300, y: 200 }, { x: 620, y: 460 }];
  const v = PC.validateGeometry(pts, PC.GEOMETRY_TYPE.OPEN_POLYLINE, 640, 480);
  assert.ok(!v.warnings.includes('OPEN_POLYLINE_NEARLY_CLOSED'));
});

test('6. a CLOSED_POLYGON is never given the open-curve near-close warning merely because its endpoints are intentionally coincident/close', () => {
  const pts = [{ x: 80, y: 380 }, { x: 300, y: 200 }, { x: 90, y: 390 }];
  const v = PC.validateGeometry(pts, PC.GEOMETRY_TYPE.CLOSED_POLYGON, 640, 480);
  assert.ok(!v.warnings.includes('OPEN_POLYLINE_NEARLY_CLOSED'));
});

// ---------- 7/8. large jump ----------

test('7. an obviously anomalous segment (realistic 13-point trace + one huge outlier) is detected', () => {
  const guide = [[80, 380], [110, 350], [140, 325], [170, 305], [200, 290], [230, 270], [260, 255], [290, 240], [320, 230], [350, 215], [380, 195], [420, 175]];
  const pts = guide.map(([x, y]) => ({ x, y })).concat([{ x: 620, y: 30 }]); // dramatic outlier
  const v = PC.validateGeometry(pts, PC.GEOMETRY_TYPE.OPEN_POLYLINE, 640, 480);
  assert.ok(v.warnings.includes('LARGE_JUMP'));
});

test('8. normal, roughly-even manual-tracing spacing never falsely warns', () => {
  const guide = [[80, 380], [110, 350], [140, 325], [170, 305], [200, 290], [230, 270], [260, 255], [290, 240], [320, 230], [350, 215], [380, 195], [420, 175], [480, 150]];
  const pts = guide.map(([x, y]) => ({ x, y }));
  const v = PC.validateGeometry(pts, PC.GEOMETRY_TYPE.OPEN_POLYLINE, 640, 480);
  assert.ok(!v.warnings.includes('LARGE_JUMP'));
});

// ---------- 9-14. recomputation is wired after every mutation (source-level proof) ----------

test('9-14. renderGeometryWarningBox is invoked from BOTH the contour-row and review-row templates, which are rebuilt by render() after EVERY mutation (drag/nudge/insert/delete/undo/redo all end by calling render())', () => {
  assert.match(INDEX_HTML, /renderGeometryWarningBox\(c\.points, PC\?PC\.GEOMETRY_TYPE\.OPEN_POLYLINE:'OPEN_POLYLINE', rec\.imageWidth, rec\.imageHeight\)/);
  assert.match(INDEX_HTML, /renderGeometryWarningBox\(inst\.humanFinalPoints, PC\?PC\.GEOMETRY_TYPE\.CLOSED_POLYGON:'CLOSED_POLYGON', rec\.imageWidth, rec\.imageHeight\)/);
  // every contour/review mutator call site in the UI ends with saveXLocal(); render(); (or is
  // itself called from inside render()'s own renderContours/renderReview), so a fresh row (and
  // therefore a fresh warning box) is rebuilt after each one.
  ['onContourButton', 'onContourPointerDown', 'onHandlePointerDown', 'onReviewButton'].forEach(fn => {
    const i = INDEX_HTML.indexOf('function ' + fn + '(');
    assert.ok(i >= 0, fn + ' must exist');
  });
});

// ---------- 15. multiple simultaneous warnings ----------

test('15. multiple simultaneous warnings (self-intersection + large-jump) are all reported together, not just the first one found', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 620, y: 30 }]; // bowtie crossing AND a huge trailing outlier
  const v = PC.validateGeometry(pts, PC.GEOMETRY_TYPE.OPEN_POLYLINE, 640, 480);
  assert.ok(v.warnings.includes('SELF_INTERSECTION'), 'expected SELF_INTERSECTION, got: ' + JSON.stringify(v.warnings));
  assert.ok(v.warnings.includes('LARGE_JUMP'), 'expected LARGE_JUMP, got: ' + JSON.stringify(v.warnings));
});

// ---------- 16. warning disappears after correction ----------

test('16. renderGeometryWarningBox returns an empty string once the offending geometry is corrected', () => {
  const badPts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
  const goodPts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }, { x: 30, y: 20 }];
  const vBad = PC.validateGeometry(badPts, PC.GEOMETRY_TYPE.OPEN_POLYLINE, 100, 100);
  const vGood = PC.validateGeometry(goodPts, PC.GEOMETRY_TYPE.OPEN_POLYLINE, 100, 100);
  assert.ok(vBad.warnings.length > 0);
  assert.equal(vGood.warnings.length, 0);
});

// ---------- 17/18. read-only proof ----------

test('17. validateGeometry never mutates the points array passed to it', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
  const before = JSON.stringify(pts);
  PC.validateGeometry(pts, PC.GEOMETRY_TYPE.OPEN_POLYLINE, 100, 100);
  assert.equal(JSON.stringify(pts), before);
});

test('18. warning computation never calls any state-mutating AWB function', () => {
  const i = INDEX_HTML.indexOf('function renderGeometryWarningBox(points, geometryType, w, h){');
  const end = INDEX_HTML.indexOf('\n  }', i);
  const body = INDEX_HTML.slice(i, end);
  assert.ok(!/A\.(move|add|delete|undo|redo|reset|lock|set)/.test(body));
});

test('18b. exported/stored contour points are identical before and after a render cycle that computes warnings', () => {
  let st = A.initContourState({ schemaVersion: 'annotation-bundle/1', entries: [{ sourceScanObservationId: 'o1', contourTypesToAnnotate: ['OUTER_BEARD_UNDERSIDE'] }] });
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 0);
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 10, 10);
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 10, 0);
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 10); // self-intersecting
  const before = JSON.stringify(st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.points);
  PC.validateGeometry(st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.points, PC.GEOMETRY_TYPE.OPEN_POLYLINE, 640, 480);
  assert.equal(JSON.stringify(st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.points), before);
});

// ---------- 19/20/21. no regressions in the other BI-2F0A fixes ----------

test('19. no coordinate-drift regression -- syncOverlayGeometry and the round-trip functions are untouched', () => {
  assert.match(INDEX_HTML, /function syncOverlayGeometry\(\)\{/);
  const src = readFileSync(new URL('./precision-annotation-core.cjs', import.meta.url), 'utf8');
  assert.match(src, /function displayToRaw\(/);
  assert.match(src, /function rawToDisplay\(/);
});

test('20. no vertex-edit regression -- onContourPointerDown/onHandlePointerDown and the contour mutators are untouched', () => {
  assert.match(INDEX_HTML, /function onContourPointerDown\(ev\)\{/);
  assert.match(INDEX_HTML, /ev\.preventDefault\(\); ev\.stopPropagation\(\);/);
  ['moveContourPoint', 'moveContourPointNoHistory', 'beginContourDragTransaction', 'nudgeContourPoint', 'deleteContourPointAt'].forEach(fn => {
    assert.equal(typeof A[fn], 'function');
  });
});

test('21. no loupe regression -- drawLoupe still exists with its selected-vertex-over-hover precedence intact', () => {
  const i = INDEX_HTML.indexOf('function drawLoupe(e){');
  const end = INDEX_HTML.indexOf('\n  }', i);
  const body = INDEX_HTML.slice(i, end);
  assert.match(body, /selectedHandle!=null/);
  assert.match(body, /selectedContourType!=null/);
  assert.match(body, /hoverImagePoint/);
});

// ---------- 22. no production files changed ----------

test('22. production hashes (index.html at repo root, worker.js) remain unchanged', () => {
  const idx = readFileSync(new URL('../../index.html', import.meta.url));
  const wkr = readFileSync(new URL('../../worker.js', import.meta.url));
  assert.equal(sha256(idx), '928747a5d284060dddac43c95f97a1669492ab4d1ecebf0d34bc59f3a3b5b521');
  assert.equal(sha256(wkr), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});

test('22b. accuracy modules (neck scaffold, BI-2E occupancy) remain unchanged', () => {
  assert.equal(sha256(readFileSync(new URL('../../accuracy/sparse-neck-scaffold-v1.mjs', import.meta.url))), '3798248b018919a61dea71173802b7a4acf6420447edffecc3e49da020d306f9');
  assert.equal(sha256(readFileSync(new URL('../../accuracy/region-scoped-beard-occupancy-v1.mjs', import.meta.url))), '4296668b88e121859db0a40ff69bce19c3c47f0b273363acb73e133795d6eaaa');
});

// ---------- bonus: plain-language text matches the requested examples ----------

test('bonus: warning text uses plain, non-alarming "Warning:" phrasing matching the requested examples', () => {
  assert.match(INDEX_HTML, /Warning: self-intersection detected\./);
  assert.match(INDEX_HTML, /Warning: open curve nearly closes on itself\./);
  assert.match(INDEX_HTML, /Warning: unusually large segment detected\./);
});

test('bonus2: the warning box has a distinct, restrained visual style (bordered box, not just colored text)', () => {
  assert.match(INDEX_HTML, /\.geom-warn-box\{border:1px solid var\(--warn\)/);
});
