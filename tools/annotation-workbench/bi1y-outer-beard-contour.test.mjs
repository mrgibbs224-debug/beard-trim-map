// Stage BI-1Y — outer-beard contour ground-truth workbench tests.
// BI-1Y CORRECTION revision: canonical OUTER_BEARD_UNDER_JAW_LEFT/RIGHT key order (was
// OUTER_BEARD_LEFT_UNDER_JAW/RIGHT_UNDER_JAW), and CONTOUR_PENDING_STATUS ('UNSET') as a fourth,
// non-final internal state distinct from the real answer 'UNKNOWN' (Issues 1 & 2).
// Node built-in runner (node --test). Zero dependencies. Synthetic fixtures only, plus one
// structural check against the real (unmodified) BI-1Y development bundle file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import AWB from './annotation-workbench.cjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'synthetic-bundle.json'), 'utf8'));
const bundle = () => JSON.parse(JSON.stringify(FIXTURE));

const CONTOUR_TYPES = AWB.CONTOUR_TYPES;
const PENDING = AWB.CONTOUR_PENDING_STATUS;
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwAEhgGAWjR9awAAAABJRU5ErkJggg==';

function rawEntry(overrides) {
  return Object.assign({
    schemaVersion: 'annotation-bundle/1',
    identityMode: 'RAW_SCAN_OBSERVATION',
    sourceScanObservationId: null,
    scanSessionId: 'synthetic-session-raw',
    nativeFrameTimestampNs: '9999', // STRING on purpose -- the real-world shape (BI-1W hotfix)
    rawObservationId: 3,
    adapterRetained: false,
    imageRef: 'synthetic-raw:img:3:ts9999',
    poseId: 'chin-up',
    observedPoseRegion: 'CHINUP_REGION',
    currentScannerStep: 'front',
    yawDeg: 0.8, pitchDeg: -39.2, rollDeg: 5.2,
    regionsToAnnotate: [], // BI-1Y: never require relabeling categorical GT (Part 13)
    contourTypesToAnnotate: CONTOUR_TYPES.slice(),
    rawImagePayload: TINY_PNG,
    rawImageFormat: 'data-url', rawImageStorageScope: 'LOCAL_ANNOTATION_BUNDLE',
    bundleImageStatus: 'INCLUDED_FOR_ANNOTATION', outcome: 'RESOLVED'
  }, overrides || {});
}
function contourBundle(entryOverrides) {
  const b = bundle();
  b.entries = [rawEntry(entryOverrides)];
  return b;
}
function traceMinimal(state, obsId, ct) {
  let st = AWB.addContourPoint(state, obsId, ct, 10, 20);
  st = AWB.addContourPoint(st, obsId, ct, 30, 40);
  return AWB.setContourTraceabilityStatus(st, obsId, ct, 'TRACED');
}
function decideAll(bundleObj, status) {
  // helper: mark every requested contour instance with an explicit decision (TRACED needs points)
  let st = AWB.initContourState(bundleObj);
  st = AWB.setContourImageDimensions(st, AWB.entryKey(bundleObj.entries[0]), 100, 100);
  for (const e of bundleObj.entries) {
    const key = AWB.entryKey(e);
    for (const ct of e.contourTypesToAnnotate) {
      if (status === 'TRACED') st = traceMinimal(st, key, ct);
      else st = AWB.setContourTraceabilityStatus(st, key, ct, status);
    }
  }
  return st;
}

// ---- Issue 1 / Part 15 items 1-2 — canonical key rename -----------------------------------
test('1: canonical contour names are exactly OUTER_BEARD_UNDERSIDE / OUTER_BEARD_UNDER_JAW_LEFT / OUTER_BEARD_UNDER_JAW_RIGHT', () => {
  assert.deepEqual(CONTOUR_TYPES.slice().sort(), ['OUTER_BEARD_UNDERSIDE', 'OUTER_BEARD_UNDER_JAW_LEFT', 'OUTER_BEARD_UNDER_JAW_RIGHT'].sort());
  assert.ok(AWB.CONTOUR_TYPE_DISPLAY.OUTER_BEARD_UNDER_JAW_LEFT);
  assert.ok(AWB.CONTOUR_TYPE_DISPLAY.OUTER_BEARD_UNDER_JAW_RIGHT);
  assert.ok(AWB.CONTOUR_TYPE_DEFINITIONS.OUTER_BEARD_UNDER_JAW_LEFT);
  assert.ok(AWB.CONTOUR_TYPE_DEFINITIONS.OUTER_BEARD_UNDER_JAW_RIGHT);
});
test('2: the incorrect BI-1Y LEFT_UNDER_JAW/RIGHT_UNDER_JAW naming no longer exists anywhere', () => {
  assert.equal(CONTOUR_TYPES.indexOf('OUTER_BEARD_LEFT_UNDER_JAW'), -1);
  assert.equal(CONTOUR_TYPES.indexOf('OUTER_BEARD_RIGHT_UNDER_JAW'), -1);
  assert.equal('OUTER_BEARD_LEFT_UNDER_JAW' in AWB.CONTOUR_TYPE_DISPLAY, false);
  assert.equal('OUTER_BEARD_RIGHT_UNDER_JAW' in AWB.CONTOUR_TYPE_DISPLAY, false);
  assert.equal('OUTER_BEARD_LEFT_UNDER_JAW' in AWB.CONTOUR_TYPE_DEFINITIONS, false);
  assert.equal('OUTER_BEARD_RIGHT_UNDER_JAW' in AWB.CONTOUR_TYPE_DEFINITIONS, false);
  // an old-named contour type is rejected by bundle validation, not silently accepted
  const b = contourBundle({ contourTypesToAnnotate: ['OUTER_BEARD_LEFT_UNDER_JAW'] });
  const v = AWB.validateContourBundle(b);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /invalid contour type/.test(e)));
});

// ---- Issue 2 / Part 15 items 3-8 — UNSET vs UNKNOWN ----------------------------------------
test('3: initial contour state is CONTOUR_PENDING_STATUS (UNSET), not a real answer', () => {
  assert.equal(PENDING, 'UNSET');
  // BI-2F0 added redoStack/locked/lockedRecord; BI-2F0A.4 added revisionNumber/basedOnFingerprint/
  // basedOnRevision/priorRevisions (additive; a plain UNSET instance has none in use yet).
  assert.deepEqual(AWB.defaultContourInstance(), { traceabilityStatus: 'UNSET', points: [], notes: '', history: [], redoStack: [], locked: false, lockedRecord: null, revisionNumber: 1, basedOnFingerprint: null, basedOnRevision: null, priorRevisions: [] });
});
test('4: an untouched contour instance is never UNKNOWN', () => {
  const b = contourBundle();
  const st = AWB.initContourState(b);
  const key = AWB.entryKey(b.entries[0]);
  for (const ct of CONTOUR_TYPES) {
    assert.equal(st.byEntry[key].contours[ct].traceabilityStatus, PENDING);
    assert.notEqual(st.byEntry[key].contours[ct].traceabilityStatus, 'UNKNOWN');
  }
  // UNSET is deliberately excluded from the three-member "real answer" enum
  assert.equal(AWB.TRACEABILITY_STATUSES.indexOf(PENDING), -1);
});
test('5: initial contourProgressCounts reports 0/15 explicit decisions on the real dev-shaped bundle', () => {
  const b = contourBundle();
  b.entries.push(rawEntry({ rawObservationId: 7, nativeFrameTimestampNs: '1', imageRef: 'i7' }));
  b.entries.push(rawEntry({ rawObservationId: 8, nativeFrameTimestampNs: '2', imageRef: 'i8' }));
  b.entries.push(rawEntry({ rawObservationId: 9, nativeFrameTimestampNs: '3', imageRef: 'i9' }));
  b.entries.push(rawEntry({ rawObservationId: 10, nativeFrameTimestampNs: '4', imageRef: 'i10' }));
  assert.equal(b.entries.length * CONTOUR_TYPES.length, 15);
  const st = AWB.initContourState(b);
  const p = AWB.contourProgressCounts(b, st);
  assert.equal(p.contoursRequested, 15);
  assert.equal(p.contoursDecided, 0);
  assert.equal(p.contoursUnset, 15);
  assert.equal(p.contoursTraced, 0);
  assert.equal(p.contoursNotTraceable, 0);
  assert.equal(p.contoursUnknown, 0);
});
test('6: explicitly choosing Unknown becomes a completed decision (contoursDecided, not contoursUnset)', () => {
  const b = contourBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = AWB.initContourState(b);
  st = AWB.setContourTraceabilityStatus(st, key, 'OUTER_BEARD_UNDERSIDE', 'UNKNOWN');
  const p = AWB.contourProgressCounts(b, st);
  assert.equal(p.contoursUnknown, 1);
  assert.equal(p.contoursDecided, 1);
  assert.equal(p.contoursUnset, CONTOUR_TYPES.length - 1);
});
test('7: NOT_TRACEABLE becomes a completed decision', () => {
  const b = contourBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = AWB.initContourState(b);
  st = AWB.setContourTraceabilityStatus(st, key, 'OUTER_BEARD_UNDER_JAW_LEFT', 'NOT_TRACEABLE');
  const p = AWB.contourProgressCounts(b, st);
  assert.equal(p.contoursNotTraceable, 1);
  assert.equal(p.contoursDecided, 1);
});
test('8: a valid TRACED contour becomes a completed decision', () => {
  const b = contourBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = traceMinimal(AWB.initContourState(b), key, 'OUTER_BEARD_UNDER_JAW_RIGHT');
  const p = AWB.contourProgressCounts(b, st);
  assert.equal(p.contoursTraced, 1);
  assert.equal(p.contoursDecided, 1);
});

// ---- Part 15 items 9-10 — export completion gating -----------------------------------------
test('9: an UNSET contour blocks final export with a specific, non-generic message', () => {
  const b = contourBundle();
  const st = AWB.initContourState(b); // everything still UNSET
  const exp = AWB.buildContourExport(b, st);
  const v = AWB.validateContourExport(exp, b);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /is UNSET/.test(e)), JSON.stringify(v.errors));
});
test('10: all 15 explicit decisions (on a 5x3 bundle) permit export', () => {
  const b = contourBundle();
  b.entries.push(rawEntry({ rawObservationId: 7, nativeFrameTimestampNs: '111', imageRef: 'i7' }));
  b.entries.push(rawEntry({ rawObservationId: 8, nativeFrameTimestampNs: '222', imageRef: 'i8' }));
  b.entries.push(rawEntry({ rawObservationId: 9, nativeFrameTimestampNs: '333', imageRef: 'i9' }));
  b.entries.push(rawEntry({ rawObservationId: 10, nativeFrameTimestampNs: '444', imageRef: 'i10' }));
  assert.equal(b.entries.length * CONTOUR_TYPES.length, 15);
  let st = AWB.initContourState(b);
  const statuses = ['TRACED', 'NOT_TRACEABLE', 'UNKNOWN'];
  b.entries.forEach((e, ei) => {
    const key = AWB.entryKey(e);
    st = AWB.setContourImageDimensions(st, key, 100, 100);
    e.contourTypesToAnnotate.forEach((ct, ci) => {
      const status = statuses[(ei + ci) % 3];
      st = status === 'TRACED' ? traceMinimal(st, key, ct) : AWB.setContourTraceabilityStatus(st, key, ct, status);
    });
  });
  const p = AWB.contourProgressCounts(b, st);
  assert.equal(p.contoursRequested, 15);
  assert.equal(p.contoursDecided, 15);
  assert.equal(p.contoursUnset, 0);
  const exp = AWB.buildContourExport(b, st);
  const v = AWB.validateContourExport(exp, b);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(exp.contours.length, 15);
});

// ---- Part 15 item 11 — autosave preserves pending vs explicit UNKNOWN ----------------------
test('11: autosave/restore preserves the UNSET vs explicit-UNKNOWN distinction exactly', () => {
  const b = contourBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = AWB.initContourState(b);
  // OUTER_BEARD_UNDERSIDE: left untouched (must stay UNSET)
  // OUTER_BEARD_UNDER_JAW_LEFT: explicit Unknown
  st = AWB.setContourTraceabilityStatus(st, key, 'OUTER_BEARD_UNDER_JAW_LEFT', 'UNKNOWN');
  // OUTER_BEARD_UNDER_JAW_RIGHT: explicit Not traceable
  st = AWB.setContourTraceabilityStatus(st, key, 'OUTER_BEARD_UNDER_JAW_RIGHT', 'NOT_TRACEABLE');
  const save = AWB.buildContourAutosavePayload(b, st);
  const res = AWB.restoreContourFromAutosave(save, b);
  assert.equal(res.ok, true);
  assert.equal(res.state.byEntry[key].contours.OUTER_BEARD_UNDERSIDE.traceabilityStatus, PENDING, 'an untouched contour must reload as UNSET, never UNKNOWN');
  assert.equal(res.state.byEntry[key].contours.OUTER_BEARD_UNDER_JAW_LEFT.traceabilityStatus, 'UNKNOWN', 'an explicit Unknown decision must reload as UNKNOWN, not be lost or downgraded');
  assert.equal(res.state.byEntry[key].contours.OUTER_BEARD_UNDER_JAW_RIGHT.traceabilityStatus, 'NOT_TRACEABLE');
  const p = AWB.contourProgressCounts(b, res.state);
  assert.equal(p.contoursUnset, 1);
  assert.equal(p.contoursDecided, 2);
});
test('11b: a garbled/unrecognized saved status fails closed to UNSET, never to a real answer', () => {
  const b = contourBundle();
  const key = AWB.entryKey(b.entries[0]);
  const st = AWB.initContourState(b);
  const save = AWB.buildContourAutosavePayload(b, st);
  save.contours[key].contours.OUTER_BEARD_UNDERSIDE.traceabilityStatus = 'SOME_GARBAGE';
  const res = AWB.restoreContourFromAutosave(save, b);
  assert.equal(res.ok, true);
  assert.equal(res.state.byEntry[key].contours.OUTER_BEARD_UNDERSIDE.traceabilityStatus, PENDING);
});

// ---- Part 15 item 12 — categorical GT untouched --------------------------------------------
test('12: performing contour work never mutates the bundle or the categorical annotation state', () => {
  const b = contourBundle();
  b.entries[0].regionsToAnnotate = ['UNDER_CHIN'];
  const key = AWB.entryKey(b.entries[0]);
  let catState = AWB.initAnnotationState(b);
  catState = AWB.setRegionLabel(catState, key, 'UNDER_CHIN', { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED', surfaceObservability: 'VISIBLE_SKIN' });
  const catBefore = JSON.parse(JSON.stringify(catState));
  const bundleBefore = JSON.parse(JSON.stringify(b));

  let contourState = AWB.initContourState(b);
  contourState = AWB.setContourImageDimensions(contourState, key, 100, 100);
  contourState = traceMinimal(contourState, key, 'OUTER_BEARD_UNDER_JAW_LEFT');
  AWB.buildContourExport(b, contourState);

  assert.deepEqual(catState, catBefore);
  assert.deepEqual(b, bundleBefore);
  assert.equal(catState.byEntry[key].UNDER_CHIN.hairState, 'BEARD_CONFIRMED');
});
test('12b: BI-1W categorical buildExport/validateExport are unaffected by contour additions', () => {
  const b = bundle();
  let st = AWB.initAnnotationState(b);
  const key = AWB.entryKey(b.entries[0]);
  for (const region of b.entries[0].regionsToAnnotate) {
    const patch = { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' };
    if (AWB.regionRequiresSurfaceObservability(region)) patch.surfaceObservability = 'VISIBLE_SKIN';
    st = AWB.setRegionLabel(st, key, region, patch);
  }
  const exp = AWB.buildExport(b, st);
  const vexp = AWB.validateExport(exp, b);
  assert.equal(vexp.ok, true, JSON.stringify(vexp.errors));
  assert.equal('contours' in exp, false);
});

// ---- Part 15 item 13 — raw timestamp numeric strings ----------------------------------------
test('13: contour export preserves a numeric-string nativeFrameTimestampNs verbatim', () => {
  const b = contourBundle({ nativeFrameTimestampNs: '424242' });
  const key = AWB.entryKey(b.entries[0]);
  const st = decideAll(b, 'TRACED');
  const exp = AWB.buildContourExport(b, st);
  for (const c of exp.contours) assert.equal(c.nativeFrameTimestampNs, '424242');
});

// ---- Part 15 item 14 — sealed holdout absent -------------------------------------------------
test('14: validateContourBundle/validateContourExport reject the sealed holdout by identity', () => {
  const b = contourBundle();
  b.entries.push(rawEntry({
    identityMode: 'RAW_SCAN_OBSERVATION', sourceScanObservationId: null,
    scanSessionId: 'scan_mtdogmlr_espu2w', rawObservationId: 22, observedPoseRegion: 'CHINUP_APPROACH',
    imageRef: 'holdout-obs22'
  }));
  const v = AWB.validateContourBundle(b);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /SEALED HOLDOUT/.test(e)));

  const clean = contourBundle();
  const key = AWB.entryKey(clean.entries[0]);
  const st = decideAll(clean, 'TRACED');
  const exp = AWB.buildContourExport(clean, st);
  exp.contours[0].scanSessionId = 'scan_mtdogmlr_espu2w';
  exp.contours[0].rawObservationId = 23;
  const vexp = AWB.validateContourExport(exp, clean);
  assert.equal(vexp.ok, false);
  assert.ok(vexp.errors.some(e => /SEALED HOLDOUT/.test(e)));
});

// ---- Part 15 item 15 — zero pre-filled points -------------------------------------------------
test('15: the canonical dev-bundle-shaped state carries zero pre-filled contour points', () => {
  const b = contourBundle();
  b.entries.push(rawEntry({ rawObservationId: 7, nativeFrameTimestampNs: '1', imageRef: 'i7' }));
  const st = AWB.initContourState(b);
  for (const e of b.entries) {
    const rec = st.byEntry[AWB.entryKey(e)];
    for (const ct of e.contourTypesToAnnotate) assert.equal(rec.contours[ct].points.length, 0);
  }
});

// ---- Part 15 items 16-18 — coordinate mapping / display-change spatial attachment ----------
// Item 16 (actual browser/DOM automation): no local browser automation tooling exists in this
// project or globally (audited this stage -- no node_modules, no Playwright browser cache, no
// chromedriver/geckodriver on PATH) and none was installed per instruction. A developer
// self-test page (coordinate-self-test.html) was built instead so a human can exercise the REAL
// event path directly; it is not exercised by this Node test runner. See the final report.
test('16: (documented above) no local browser automation is available -- see coordinate-self-test.html', () => { assert.ok(true); });

test('17: displayClickToImagePoint corrects for scaled / non-1:1 / resized display (never shifts the canonical point)', () => {
  const p1 = AWB.displayClickToImagePoint(50, 25, 200, 100, 200, 100); // 1:1
  assert.deepEqual(p1, { x: 50, y: 25 });
  const p2 = AWB.displayClickToImagePoint(25, 10, 100, 50, 400, 200); // quarter scale
  assert.deepEqual(p2, { x: 100, y: 40 });
  const p3 = AWB.displayClickToImagePoint(50, 20, 200, 100, 400, 200); // half scale ("after resize")
  assert.deepEqual(p3, { x: 100, y: 40 });
  const p4 = AWB.displayClickToImagePoint(10, 10, 50, 25, 500, 100); // different aspect ratio, per-axis
  assert.deepEqual(p4, { x: 100, y: 40 });
  assert.equal(AWB.displayClickToImagePoint(NaN, 1, 10, 10, 10, 10), null);
  assert.equal(AWB.displayClickToImagePoint(1, 1, 0, 10, 10, 10), null);
});
test('18: a stored canonical IMAGE point remains spatially attached across arbitrary display re-renders', () => {
  // The point is written ONCE in raw image-pixel space (addContourPoint) and is NEVER
  // recomputed from display state afterward -- rendering it back at any later display size is a
  // pure, idempotent forward mapping (imagePointToDisplayPoint), never a re-derivation.
  const b = contourBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = AWB.initContourState(b);
  st = AWB.setContourImageDimensions(st, key, 400, 200);
  // simulate a click at display size A (100x50, quarter scale) landing on image point (100,40)
  const clickedAtA = AWB.displayClickToImagePoint(25, 10, 100, 50, 400, 200);
  st = AWB.addContourPoint(st, key, 'OUTER_BEARD_UNDERSIDE', clickedAtA.x, clickedAtA.y);
  const storedBefore = JSON.parse(JSON.stringify(st.byEntry[key].contours.OUTER_BEARD_UNDERSIDE.points));
  // "resize" to several different display sizes (simulating window resize / zoom change) and
  // confirm the stored raw point is untouched, and forward-maps to the geometrically correct
  // display position at each new size.
  const sizesToCheck = [[400, 200], [200, 100], [800, 400], [50, 25]];
  for (const [rw, rh] of sizesToCheck) {
    assert.deepEqual(st.byEntry[key].contours.OUTER_BEARD_UNDERSIDE.points, storedBefore, 'raw canonical point must never change with display size');
    const displayPos = AWB.imagePointToDisplayPoint(storedBefore[0].x, storedBefore[0].y, rw, rh, 400, 200);
    // round-trip: mapping that display position back through the click path recovers the SAME
    // canonical point (within floating-point tolerance), proving the overlay stays attached.
    const backToImage = AWB.displayClickToImagePoint(displayPos.x, displayPos.y, rw, rh, 400, 200);
    assert.ok(Math.abs(backToImage.x - storedBefore[0].x) < 1e-9);
    assert.ok(Math.abs(backToImage.y - storedBefore[0].y) < 1e-9);
  }
});

// ---- other core behaviors carried over from the original BI-1Y test file -------------------
test('a historical categorical bundle (no contour fields) still loads via validateContourBundle', () => {
  const b = bundle();
  const vOld = AWB.validateBundle(b);
  const vNew = AWB.validateContourBundle(b);
  assert.equal(vNew.ok, vOld.ok);
  assert.deepEqual(vNew.errors, vOld.errors);
});
test('contour points export in the exact order they were clicked (open polyline, never closed)', () => {
  const b = contourBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = AWB.initContourState(b);
  st = AWB.setContourImageDimensions(st, key, 100, 100);
  st = AWB.addContourPoint(st, key, 'OUTER_BEARD_UNDERSIDE', 5, 90);
  st = AWB.addContourPoint(st, key, 'OUTER_BEARD_UNDERSIDE', 50, 95);
  st = AWB.addContourPoint(st, key, 'OUTER_BEARD_UNDERSIDE', 95, 90);
  st = AWB.setContourTraceabilityStatus(st, key, 'OUTER_BEARD_UNDERSIDE', 'TRACED');
  const exp = AWB.buildContourExport(b, st);
  const c = exp.contours.find(x => x.contourType === 'OUTER_BEARD_UNDERSIDE');
  assert.deepEqual(c.points, [{ x: 5, y: 90 }, { x: 50, y: 95 }, { x: 95, y: 90 }]);
});
test('undoLastContourPoint removes only the most recently added point; safe no-op when empty', () => {
  const b = contourBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = AWB.initContourState(b);
  st = AWB.addContourPoint(st, key, 'OUTER_BEARD_UNDERSIDE', 1, 1);
  st = AWB.addContourPoint(st, key, 'OUTER_BEARD_UNDERSIDE', 2, 2);
  st = AWB.addContourPoint(st, key, 'OUTER_BEARD_UNDERSIDE', 3, 3);
  st = AWB.undoLastContourPoint(st, key, 'OUTER_BEARD_UNDERSIDE');
  assert.deepEqual(st.byEntry[key].contours.OUTER_BEARD_UNDERSIDE.points, [{ x: 1, y: 1 }, { x: 2, y: 2 }]);
  let empty = AWB.initContourState(b);
  empty = AWB.undoLastContourPoint(empty, key, 'OUTER_BEARD_UNDERSIDE');
  assert.deepEqual(empty.byEntry[key].contours.OUTER_BEARD_UNDERSIDE.points, []);
});
test('clearContour resets only the targeted contour instance, back to UNSET (not UNKNOWN)', () => {
  const b = contourBundle();
  b.entries.push(rawEntry({ rawObservationId: 7, nativeFrameTimestampNs: '8888', imageRef: 'synthetic-raw:img:7' }));
  const key0 = AWB.entryKey(b.entries[0]), key1 = AWB.entryKey(b.entries[1]);
  let st = AWB.initContourState(b);
  st = AWB.addContourPoint(st, key0, 'OUTER_BEARD_UNDERSIDE', 1, 1);
  st = AWB.addContourPoint(st, key0, 'OUTER_BEARD_UNDER_JAW_LEFT', 2, 2);
  st = AWB.addContourPoint(st, key1, 'OUTER_BEARD_UNDERSIDE', 3, 3);
  st = AWB.setContourTraceabilityStatus(st, key0, 'OUTER_BEARD_UNDER_JAW_LEFT', 'NOT_TRACEABLE');
  st = AWB.clearContour(st, key0, 'OUTER_BEARD_UNDERSIDE');
  // BI-2F0 added redoStack/locked/lockedRecord; BI-2F0A.4 added revisionNumber/basedOnFingerprint/
  // basedOnRevision/priorRevisions (all additive; clearContour resets to the same plain default).
  assert.deepEqual(st.byEntry[key0].contours.OUTER_BEARD_UNDERSIDE, { traceabilityStatus: PENDING, points: [], notes: '', history: [], redoStack: [], locked: false, lockedRecord: null, revisionNumber: 1, basedOnFingerprint: null, basedOnRevision: null, priorRevisions: [] });
  assert.deepEqual(st.byEntry[key0].contours.OUTER_BEARD_UNDER_JAW_LEFT.traceabilityStatus, 'NOT_TRACEABLE');
  assert.deepEqual(st.byEntry[key1].contours.OUTER_BEARD_UNDERSIDE.points, [{ x: 3, y: 3 }]);
});
test('bundle fingerprint isolation: contour autosave fails closed on a mismatch, never cross-attaches', () => {
  const b = contourBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = traceMinimal(AWB.setContourImageDimensions(AWB.initContourState(b), key, 100, 100), key, 'OUTER_BEARD_UNDERSIDE');
  const save = AWB.buildContourAutosavePayload(b, st);
  const otherBundle = contourBundle({ rawObservationId: 999, imageRef: 'different-image' });
  const res = AWB.restoreContourFromAutosave(save, otherBundle);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'FINGERPRINT_MISMATCH');
});
test('TRACED cannot be set with fewer than MIN_CONTOUR_POINTS points', () => {
  const b = contourBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = AWB.addContourPoint(AWB.initContourState(b), key, 'OUTER_BEARD_UNDERSIDE', 1, 1);
  assert.throws(() => AWB.setContourTraceabilityStatus(st, key, 'OUTER_BEARD_UNDERSIDE', 'TRACED'), /at least/);
  st = AWB.addContourPoint(st, key, 'OUTER_BEARD_UNDERSIDE', 2, 2);
  assert.doesNotThrow(() => AWB.setContourTraceabilityStatus(st, key, 'OUTER_BEARD_UNDERSIDE', 'TRACED'));
});
test('NOT_TRACEABLE and UNKNOWN both always clear any existing points', () => {
  const b = contourBundle();
  const key = AWB.entryKey(b.entries[0]);
  for (const status of ['NOT_TRACEABLE', 'UNKNOWN']) {
    let st = AWB.addContourPoint(AWB.initContourState(b), key, 'OUTER_BEARD_UNDERSIDE', 1, 1);
    st = AWB.addContourPoint(st, key, 'OUTER_BEARD_UNDERSIDE', 2, 2);
    st = AWB.setContourTraceabilityStatus(st, key, 'OUTER_BEARD_UNDERSIDE', status);
    assert.deepEqual(st.byEntry[key].contours.OUTER_BEARD_UNDERSIDE.points, []);
  }
});
test('an out-of-bounds point fails validateContourExport', () => {
  const b = contourBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = AWB.setContourImageDimensions(AWB.initContourState(b), key, 100, 100);
  st = AWB.addContourPoint(st, key, 'OUTER_BEARD_UNDERSIDE', 10, 10);
  st = AWB.addContourPoint(st, key, 'OUTER_BEARD_UNDERSIDE', 999, 10);
  st = AWB.setContourTraceabilityStatus(st, key, 'OUTER_BEARD_UNDERSIDE', 'TRACED');
  const exp = AWB.buildContourExport(b, st);
  const v = AWB.validateContourExport(exp, b);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /out of bounds/.test(e)));
});
test('a duplicated contourId fails validateContourExport', () => {
  const b = contourBundle();
  const key = AWB.entryKey(b.entries[0]);
  const st = traceMinimal(AWB.setContourImageDimensions(AWB.initContourState(b), key, 100, 100), key, 'OUTER_BEARD_UNDERSIDE');
  const exp = AWB.buildContourExport(b, st);
  exp.contours.push(Object.assign({}, exp.contours[0]));
  const v = AWB.validateContourExport(exp, b);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /duplicate contourId/.test(e)));
});
test('sourceScanObservationId stays null and raw identity round-trips exactly for a RAW_SCAN_OBSERVATION contour export', () => {
  const b = contourBundle({ scanSessionId: 'scan_mtcfdr6x_atfvgh', rawObservationId: 6, observedPoseRegion: 'FRONT_REGION', contourTypesToAnnotate: ['OUTER_BEARD_UNDERSIDE'] });
  const key = AWB.entryKey(b.entries[0]);
  const st = traceMinimal(AWB.setContourImageDimensions(AWB.initContourState(b), key, 100, 100), key, 'OUTER_BEARD_UNDERSIDE');
  const exp = AWB.buildContourExport(b, st);
  const c = exp.contours.find(x => x.contourType === 'OUTER_BEARD_UNDERSIDE');
  assert.equal(c.sourceScanObservationId, null);
  assert.equal(c.scanSessionId, 'scan_mtcfdr6x_atfvgh');
  assert.equal(c.rawObservationId, 6);
  assert.equal(c.observedPoseRegion, 'FRONT_REGION');
  const v = AWB.validateContourExport(exp, b);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});
test('the verified geometry overlay (jaw rail) is untouched by, and never mutates, contour state', () => {
  const b = contourBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = AWB.addContourPoint(AWB.initContourState(b), key, 'OUTER_BEARD_UNDERSIDE', 1, 1);
  const before = JSON.parse(JSON.stringify(st));
  AWB.overlayAvailable(b.entries[0]);
  const model = AWB.overlayDisplayModel(b.entries[0], { groupIds: ['jaw-chin'] });
  assert.equal(model, null); // no overlayData on this synthetic entry -- correctly unavailable
  assert.deepEqual(st, before);
});

// ---- structural check against the real, unmodified BI-1Y development bundle -------------
test('structural: the real BI-1Y development bundle carries exactly the 5 locked observations, canonical contour keys, 0 holdout, 0 pre-filled', () => {
  const path = 'D:/MettleTemp/annotation/bi1y_outer_beard_contour_dev_bundle.json';
  let real;
  try { real = JSON.parse(readFileSync(path, 'utf8')); } catch { return; } // stage-external artifact; skip if absent
  const v = AWB.validateContourBundle(real);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(real.entries.length, 5);
  const expected = [
    ['scan_mtcfdr6x_atfvgh', 6], ['scan_mtcfdr6x_atfvgh', 3], ['scan_mtcfdr6x_atfvgh', 0],
    ['scan_mtdd38q8_zfbhtp', 11], ['scan_mtdm14vu_5v2nkg', 15]
  ];
  assert.deepEqual(real.entries.map(e => [e.scanSessionId, e.rawObservationId]), expected);
  for (const e of real.entries) {
    assert.equal(e.regionsToAnnotate.length, 0, 'BI-1Y must not require relabeling categorical GT');
    assert.deepEqual(e.contourTypesToAnnotate.slice().sort(), CONTOUR_TYPES.slice().sort());
    assert.equal(AWB.isSealedHoldoutEntry(e), false);
    assert.ok(AWB.imageRenderable(e));
  }
  const st = AWB.initContourState(real);
  assert.equal(real.entries.length * CONTOUR_TYPES.length, 15); // Part 14 expected maximum
  const p = AWB.contourProgressCounts(real, st);
  assert.equal(p.contoursRequested, 15);
  assert.equal(p.contoursUnset, 15);
  assert.equal(p.contoursTraced, 0);
  assert.equal(p.contoursNotTraceable, 0);
  assert.equal(p.contoursUnknown, 0); // BI-1Y correction: nothing pre-decided as Unknown either
  for (const e of real.entries) {
    const rec = st.byEntry[AWB.entryKey(e)];
    for (const ct of e.contourTypesToAnnotate) assert.equal(rec.contours[ct].points.length, 0);
  }
});
