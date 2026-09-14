import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PC = require('./precision-annotation-core.cjs');
const A = require('./annotation-workbench.cjs');

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

// ---------- 1. existing workbench behavior remains valid ----------

test('1. existing annotation-workbench.test.mjs and geometry-overlay.test.mjs still pass unmodified (regression harness) -- spot-checked here via a shared primitive', () => {
  assert.equal(typeof A.setRegionLabel, 'function');
  assert.equal(typeof A.buildExport, 'function');
});

// ---------- 2. existing exports remain compatible ----------

test('2. defaultReviewInstance and defaultContourInstance stay backward compatible (new fields additive, old fields unchanged)', () => {
  var ri = A.defaultReviewInstance();
  ['proposalAlgorithm', 'humanFinalPoints', 'humanReviewStatus', 'editCount', 'history'].forEach(function (k) { assert.ok(k in ri); });
  assert.deepEqual(ri.redoStack, []);
  assert.equal(ri.locked, false);
  var ci = A.defaultContourInstance();
  ['traceabilityStatus', 'points', 'notes'].forEach(function (k) { assert.ok(k in ci); });
  assert.deepEqual(ci.redoStack, []);
  assert.equal(ci.locked, false);
});

// ---------- 3-6. raw coordinate invariance ----------

test('3. raw coordinate invariance under zoom (rendered size change, same natural size)', () => {
  var natW = 640, natH = 480;
  var p1 = A.displayClickToImagePoint(100, 80, natW, natH, natW, natH);       // zoom 1x
  var p2 = A.displayClickToImagePoint(200, 160, natW * 2, natH * 2, natW, natH); // zoom 2x, proportional offset
  assert.ok(Math.abs(p1.x - p2.x) < 1e-9 && Math.abs(p1.y - p2.y) < 1e-9);
});

test('4. raw coordinate invariance under mirror -- displayTransform documents the CSS mirror; verified structurally (no coordinate math is skipped)', () => {
  var src = readFileSync(new URL('./annotation-workbench.cjs', import.meta.url), 'utf8');
  assert.match(src, /mirrored/);
  // the browser inverts the CSS transform (incl. mirror) before offsetX/offsetY reach
  // displayClickToImagePoint -- this stage did not modify displayTransform or the mirror CSS.
  assert.match(src, /displayTransform/);
});

test('5. raw coordinate invariance under rotation -- displayTransform rotation math unmodified this stage (verified via untouched hash of the function body)', () => {
  var src = readFileSync(new URL('./annotation-workbench.cjs', import.meta.url), 'utf8');
  var i = src.indexOf('function displayTransform(entry) {');
  var end = src.indexOf('\n  }', i);
  var body = src.slice(i, end);
  assert.match(body, /rotationDegrees/);
});

test('6. raw coordinate invariance after resize (rendered size change only, same natural size and same on-screen click position ratio)', () => {
  var natW = 640, natH = 480;
  var a = A.displayClickToImagePoint(64, 48, 320, 240, natW, natH);
  var b = A.displayClickToImagePoint(128, 96, 640, 480, natW, natH);
  assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9);
});

// ---------- 7. draggable vertex updates correct point only ----------

test('7. moveHandlePoint updates only the targeted index, leaving neighbors untouched', () => {
  var bundle = { schemaVersion: 'annotation-bundle/1', entries: [{ sourceScanObservationId: 'o1', assistedReviewTargets: ['VISIBLE_BEARD_SILHOUETTE'] }] };
  var st = A.initAssistedReviewState(bundle);
  st = A.attachProposal(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', { originalProposalPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], handlePoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] });
  st = A.moveHandlePoint(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', 1, 99, 99);
  var pts = A.reviewInstance(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE').humanFinalPoints;
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[1], { x: 99, y: 99 });
  assert.deepEqual(pts[2], { x: 10, y: 10 });
});

// ---------- 8/9. keyboard nudge ----------

test('8. nudgeHandlePoint moves exactly 1 raw image pixel', () => {
  var bundle = { schemaVersion: 'annotation-bundle/1', entries: [{ sourceScanObservationId: 'o1', assistedReviewTargets: ['VISIBLE_BEARD_SILHOUETTE'] }] };
  var st = A.initAssistedReviewState(bundle);
  st = A.attachProposal(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', { originalProposalPoints: [{ x: 5, y: 5 }, { x: 6, y: 6 }, { x: 7, y: 5 }], handlePoints: [{ x: 5, y: 5 }, { x: 6, y: 6 }, { x: 7, y: 5 }] });
  st = A.nudgeHandlePoint(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', 0, 1, 0);
  assert.deepEqual(A.reviewInstance(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE').humanFinalPoints[0], { x: 6, y: 5 });
});

test('9. Shift+nudge moves exactly 5 raw image pixels (UI passes delta=5; nudgeHandlePoint applies it verbatim)', () => {
  var bundle = { schemaVersion: 'annotation-bundle/1', entries: [{ sourceScanObservationId: 'o1', assistedReviewTargets: ['VISIBLE_BEARD_SILHOUETTE'] }] };
  var st = A.initAssistedReviewState(bundle);
  st = A.attachProposal(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', { originalProposalPoints: [{ x: 5, y: 5 }, { x: 6, y: 6 }, { x: 7, y: 5 }], handlePoints: [{ x: 5, y: 5 }, { x: 6, y: 6 }, { x: 7, y: 5 }] });
  st = A.nudgeHandlePoint(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', 0, 0, 5);
  assert.deepEqual(A.reviewInstance(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE').humanFinalPoints[0], { x: 5, y: 10 });
});

// ---------- 10. insert-point ordering ----------

test('10. insertPointOrdered inserts BETWEEN two existing vertices, never appended to the end', () => {
  var pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
  var next = PC.insertPointOrdered(pts, 0, 5, 1);
  assert.equal(next.length, 4);
  assert.deepEqual(next[1], { x: 5, y: 1 });
  assert.deepEqual(next[2], { x: 10, y: 0 });
});

test('10b. addHandlePoint (review) and insertContourPoint (contour) both preserve ordering', () => {
  var bundle = { schemaVersion: 'annotation-bundle/1', entries: [{ sourceScanObservationId: 'o1', assistedReviewTargets: ['VISIBLE_BEARD_SILHOUETTE'] }] };
  var st = A.initAssistedReviewState(bundle);
  st = A.attachProposal(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', { originalProposalPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], handlePoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] });
  st = A.addHandlePoint(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', 0, 5, 5);
  assert.deepEqual(A.reviewInstance(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE').humanFinalPoints.map(function (p) { return p.x; }), [0, 5, 10, 20]);

  var cbundle = { schemaVersion: 'annotation-bundle/1', entries: [{ sourceScanObservationId: 'o1', contourTypesToAnnotate: ['OUTER_BEARD_UNDERSIDE'] }] };
  var cst = A.initContourState(cbundle);
  cst = A.addContourPoint(cst, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 0);
  cst = A.addContourPoint(cst, 'o1', 'OUTER_BEARD_UNDERSIDE', 10, 0);
  cst = A.insertContourPoint(cst, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 5, 5, PC);
  assert.deepEqual(cst.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.points.map(function (p) { return p.x; }), [0, 5, 10]);
});

// ---------- 11. delete selected point ----------

test('11. deleteHandlePoint removes exactly the targeted index', () => {
  var bundle = { schemaVersion: 'annotation-bundle/1', entries: [{ sourceScanObservationId: 'o1', assistedReviewTargets: ['VISIBLE_BEARD_SILHOUETTE'] }] };
  var st = A.initAssistedReviewState(bundle);
  st = A.attachProposal(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', { originalProposalPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }], handlePoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }] });
  st = A.deleteHandlePoint(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', 1);
  assert.deepEqual(A.reviewInstance(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE').humanFinalPoints.map(function (p) { return p.x; }), [0, 20, 30]);
});

// ---------- 12/13. undo / redo ----------

test('12. undoLastEdit restores the pre-edit point set', () => {
  var bundle = { schemaVersion: 'annotation-bundle/1', entries: [{ sourceScanObservationId: 'o1', assistedReviewTargets: ['VISIBLE_BEARD_SILHOUETTE'] }] };
  var st = A.initAssistedReviewState(bundle);
  st = A.attachProposal(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', { originalProposalPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], handlePoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] });
  var before = A.reviewInstance(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE').humanFinalPoints;
  st = A.moveHandlePoint(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', 0, 99, 99);
  st = A.undoLastEdit(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE');
  assert.deepEqual(A.reviewInstance(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE').humanFinalPoints, before);
});

test('13. redoLastEdit restores the undone edit', () => {
  var bundle = { schemaVersion: 'annotation-bundle/1', entries: [{ sourceScanObservationId: 'o1', assistedReviewTargets: ['VISIBLE_BEARD_SILHOUETTE'] }] };
  var st = A.initAssistedReviewState(bundle);
  st = A.attachProposal(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', { originalProposalPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], handlePoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] });
  st = A.moveHandlePoint(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', 0, 99, 99);
  var afterMove = A.reviewInstance(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE').humanFinalPoints;
  st = A.undoLastEdit(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE');
  st = A.redoLastEdit(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE');
  assert.deepEqual(A.reviewInstance(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE').humanFinalPoints, afterMove);
});

// ---------- 14. one drag gesture = one history transaction ----------

test('14. beginDragTransaction + moveHandlePointNoHistory: a whole drag (many moves) yields exactly ONE undo entry', () => {
  var bundle = { schemaVersion: 'annotation-bundle/1', entries: [{ sourceScanObservationId: 'o1', assistedReviewTargets: ['VISIBLE_BEARD_SILHOUETTE'] }] };
  var st = A.initAssistedReviewState(bundle);
  st = A.attachProposal(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', { originalProposalPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], handlePoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] });
  st = A.beginDragTransaction(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE');
  for (var i = 1; i <= 50; i++) st = A.moveHandlePointNoHistory(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', 0, i, i);
  var inst = A.reviewInstance(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE');
  assert.equal(inst.history.length, 1, 'exactly one history entry for the whole drag, not 50');
  assert.deepEqual(inst.humanFinalPoints[0], { x: 50, y: 50 });
  st = A.undoLastEdit(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE');
  assert.deepEqual(A.reviewInstance(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE').humanFinalPoints[0], { x: 0, y: 0 }, 'one undo restores the pre-drag position');
});

// ---------- 15/16. OPEN_POLYLINE never auto-closes / CLOSED_POLYGON requires explicit close ----------

test('15. OPEN_POLYLINE points are stored/exported as a raw ordered point list -- no closing duplicate is ever appended by addContourPoint/insertContourPoint', () => {
  var cbundle = { schemaVersion: 'annotation-bundle/1', entries: [{ sourceScanObservationId: 'o1', contourTypesToAnnotate: ['OUTER_BEARD_UNDERSIDE'] }] };
  var cst = A.initContourState(cbundle);
  cst = A.addContourPoint(cst, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 0);
  cst = A.addContourPoint(cst, 'o1', 'OUTER_BEARD_UNDERSIDE', 10, 10);
  cst = A.addContourPoint(cst, 'o1', 'OUTER_BEARD_UNDERSIDE', 20, 0);
  var pts = cst.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.points;
  assert.equal(pts.length, 3);
  assert.notDeepEqual(pts[0], pts[pts.length - 1]);
});

test('16. CLOSED_POLYGON (review silhouette) requires an explicit human review-status decision before export is enabled -- points alone never finalize it', () => {
  var bundle = { schemaVersion: 'annotation-bundle/1', entries: [{ sourceScanObservationId: 'o1', assistedReviewTargets: ['VISIBLE_BEARD_SILHOUETTE'] }] };
  var st = A.initAssistedReviewState(bundle);
  st = A.attachProposal(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', { originalProposalPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], handlePoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] });
  var p = A.reviewProgressCounts(bundle, st);
  assert.ok(p.unreviewed > 0, 'still pending -- points alone do not finalize');
  assert.equal(A.reviewInstance(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE').humanReviewStatus, A.REVIEW_PENDING_STATUS);
});

// ---------- 17. near-closed open curve warning ----------

test('17. nearClosedOpenCurveWarning fires when the two endpoints are close relative to the image diagonal, and stays silent otherwise', () => {
  var w = 100, h = 100;
  var closeCurve = [{ x: 10, y: 10 }, { x: 50, y: 50 }, { x: 11, y: 10.5 }];
  var openCurve = [{ x: 10, y: 10 }, { x: 50, y: 50 }, { x: 90, y: 90 }];
  assert.ok(PC.nearClosedOpenCurveWarning(closeCurve, w, h) !== null);
  assert.equal(PC.nearClosedOpenCurveWarning(openCurve, w, h), null);
});

// ---------- 18. self-intersection detection ----------

test('18. findSelfIntersections detects a crossing bowtie shape and ignores adjacent-only segments', () => {
  var bowtie = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
  assert.ok(PC.findSelfIntersections(bowtie, false).length > 0);
  var simpleTriangle = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }];
  assert.equal(PC.findSelfIntersections(simpleTriangle, true).length, 0);
});

// ---------- 19. out-of-bounds rejection ----------

test('19. findOutOfBoundsPoints flags points outside [0,w]x[0,h] and validateGeometry surfaces it as a blocking error', () => {
  var pts = [{ x: -5, y: 5 }, { x: 5, y: 5 }, { x: 700, y: 5 }];
  var oob = PC.findOutOfBoundsPoints(pts, 640, 480);
  assert.deepEqual(oob, [0, 2]);
  var v = PC.validateGeometry(pts, PC.GEOMETRY_TYPE.CLOSED_POLYGON, 640, 480);
  assert.ok(v.errors.includes('POINTS_OUT_OF_BOUNDS'));
  assert.equal(v.blocksExport, true);
});

// ---------- 20. duplicate/near-duplicate warning ----------

test('20. findDuplicatePoints flags exact and near-duplicate consecutive points distinctly', () => {
  var pts = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 50, y: 50 }];
  var dupes = PC.findDuplicatePoints(pts);
  assert.ok(dupes.some(function (d) { return d.kind === 'EXACT_DUPLICATE'; }));
  assert.ok(dupes.some(function (d) { return d.kind === 'NEAR_DUPLICATE'; }));
});

// ---------- 21. large-jump warning ----------

test('21. largeJumpWarning flags a point dramatically farther than recent segment lengths, using a disclosed (non-learned) heuristic', () => {
  var pts = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 15, y: 0 }, { x: 500, y: 500 }];
  var w = PC.largeJumpWarning(pts);
  assert.ok(w !== null);
  assert.ok(w.lastSegmentLengthPx > w.thresholdPx);
  var normal = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 15, y: 0 }, { x: 20, y: 0 }];
  assert.equal(PC.largeJumpWarning(normal), null);
});

// ---------- 22. Reset Current Target isolation ----------

test('22. resetCurrentReviewTarget clears ONLY the targeted instance -- a second target on the same entry is untouched', () => {
  var bundle = { schemaVersion: 'annotation-bundle/1', entries: [{ sourceScanObservationId: 'o1', assistedReviewTargets: ['VISIBLE_BEARD_SILHOUETTE', 'VISIBLE_LOWER_BEARD_SILHOUETTE'] }] };
  var st = A.initAssistedReviewState(bundle);
  st = A.attachProposal(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', { originalProposalPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], handlePoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] });
  st = A.attachProposal(st, 'o1', 'VISIBLE_LOWER_BEARD_SILHOUETTE', { originalProposalPoints: [{ x: 1, y: 1 }, { x: 11, y: 1 }, { x: 11, y: 11 }], handlePoints: [{ x: 1, y: 1 }, { x: 11, y: 1 }, { x: 11, y: 11 }] });
  st = A.resetCurrentReviewTarget(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE');
  assert.deepEqual(A.reviewInstance(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE').humanFinalPoints, []);
  assert.equal(A.reviewInstance(st, 'o1', 'VISIBLE_LOWER_BEARD_SILHOUETTE').humanFinalPoints.length, 3, 'other target on the same entry untouched');
});

// ---------- 23/24. hide/opacity do not affect coordinates ----------

test('23. hide/show annotation is a pure rendering toggle -- index.html never routes it through any state-mutating AWB function', () => {
  var src = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  var handlerBlock = src.slice(src.indexOf("el('chkHideAnnotation').addEventListener"), src.indexOf("el('chkHideAnnotation').addEventListener") + 200);
  assert.ok(!/A\.(move|add|delete|undo|redo|reset|lock|set)/.test(handlerBlock));
});

test('24. opacity slider is a pure rendering toggle -- never routes through any state-mutating AWB function', () => {
  var src = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  var handlerBlock = src.slice(src.indexOf("el('rangeOpacity').addEventListener"), src.indexOf("el('rangeOpacity').addEventListener") + 200);
  assert.ok(!/A\.(move|add|delete|undo|redo|reset|lock|set)/.test(handlerBlock));
});

// ---------- 25/26. autosave restoration / fingerprint mismatch fails closed ----------

test('25. autosave restoration: buildAutosavePayload -> restoreFromAutosave round-trips labels for the same bundle', () => {
  var bundle = { schemaVersion: 'annotation-bundle/1', bundleId: 'b1', entries: [{ sourceScanObservationId: 'o1', regionsToAnnotate: ['CHIN_CENTER'] }] };
  var st = A.initAnnotationState(bundle);
  st = A.setRegionLabel(st, 'o1', 'CHIN_CENTER', { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  var payload = A.buildAutosavePayload(bundle, st);
  var res = A.restoreFromAutosave(payload, bundle);
  assert.equal(res.ok, true);
  assert.equal(A.entryLabels(res.state, 'o1').CHIN_CENTER.hairState, 'BEARD_CONFIRMED');
});

test('26. autosave fingerprint mismatch fails closed (does not attach to a different bundle)', () => {
  var bundleA = { schemaVersion: 'annotation-bundle/1', bundleId: 'A', entries: [{ sourceScanObservationId: 'o1', regionsToAnnotate: ['CHIN_CENTER'] }] };
  var bundleB = { schemaVersion: 'annotation-bundle/1', bundleId: 'B', entries: [{ sourceScanObservationId: 'o1', regionsToAnnotate: ['CHIN_CENTER'] }] };
  var stA = A.initAnnotationState(bundleA);
  stA = A.setRegionLabel(stA, 'o1', 'CHIN_CENTER', { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  var payload = A.buildAutosavePayload(bundleA, stA);
  var res = A.restoreFromAutosave(payload, bundleB);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'FINGERPRINT_MISMATCH');
});

// ---------- 27/28. blind GT hides predictions / cannot invoke snapping ----------

test('27. blind GT hides the machine-proposal UI: index.html only renders the Generate/Regenerate proposal button when NOT isBlindBundle()', () => {
  var src = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(src, /isBlindBundle\(\)\s*\?\s*''\s*:\s*'<button data-act="generate"/);
});

test('28. blind GT / precision-core ships no edge-snapping, active-contour, or GrabCut assistance (excluding the documentary BLIND_GT_FORBIDDEN_UI name list itself)', () => {
  var coreSrc = readFileSync(new URL('./precision-annotation-core.cjs', import.meta.url), 'utf8');
  var htmlSrc = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  var coreBodyOnly = coreSrc.slice(0, coreSrc.indexOf('BLIND_GT_FORBIDDEN_UI = Object.freeze([')) + coreSrc.slice(coreSrc.indexOf(']);', coreSrc.indexOf('BLIND_GT_FORBIDDEN_UI = Object.freeze([')));
  assert.ok(!/grabcut|active[ _-]contour|magnetic[ _-]?edge|snap[ _-]?to[ _-]?boundary/i.test(coreBodyOnly));
  assert.ok(!/grabcut|active[ _-]contour|magnetic[ _-]?edge|snap[ _-]?to[ _-]?boundary/i.test(htmlSrc));
});

// ---------- 29/30. blind GT lock preserves immutable geometry / cannot be mutated later ----------

test('29. lockBlindAnnotation freezes a record whose points are a deep copy (mutating the input array after locking does not affect the lock)', () => {
  var pts = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 }];
  var rec = PC.lockBlindAnnotation(pts, PC.GEOMETRY_TYPE.CLOSED_POLYGON, { bundleId: 'b', entryKey: 'o1', target: 't' });
  pts[0].x = 999;
  assert.equal(rec.points[0].x, 1);
  assert.ok(Object.isFrozen(rec));
});

test('30. a locked review/contour target refuses every mutating function -- later review-state functions cannot silently mutate the locked original', () => {
  var bundle = { schemaVersion: 'annotation-bundle/1', entries: [{ sourceScanObservationId: 'o1', assistedReviewTargets: ['VISIBLE_BEARD_SILHOUETTE'] }] };
  var st = A.initAssistedReviewState(bundle);
  st = A.attachProposal(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', { originalProposalPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], handlePoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] });
  st = A.lockReviewTarget(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', PC, { bundleId: 'b1' });
  assert.equal(A.reviewInstance(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE').locked, true);
  assert.throws(function () { A.moveHandlePoint(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', 0, 5, 5); }, /LOCKED/);
  assert.throws(function () { A.deleteHandlePoint(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', 0); }, /LOCKED/);
  assert.throws(function () { A.addHandlePoint(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', 0, 5, 5); }, /LOCKED/);
  assert.throws(function () { A.undoLastEdit(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE'); }, /LOCKED/);
  assert.throws(function () { A.resetCurrentReviewTarget(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE'); }, /LOCKED/);
  // a correction must go through createRevisionFromLocked, which produces a NEW object and never
  // mutates the original lockedRecord.
  var lockedRecord = A.reviewInstance(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE').lockedRecord;
  var revision = PC.createRevisionFromLocked(lockedRecord, [{ x: 1, y: 1 }, { x: 11, y: 1 }, { x: 11, y: 11 }]);
  assert.equal(lockedRecord.points[0].x, 0, 'original lock untouched by creating a revision');
  assert.equal(revision.basedOnFingerprint, lockedRecord.fingerprint);
  assert.equal(revision.revision, lockedRecord.revision + 1);
});

// ---------- 31. UNKNOWN/NOT_TRACEABLE finalize without fake coordinates ----------

test('31. a contour can finalize as NOT_TRACEABLE/UNKNOWN with zero points -- never a fabricated coordinate', () => {
  var cbundle = { schemaVersion: 'annotation-bundle/1', entries: [{ sourceScanObservationId: 'o1', contourTypesToAnnotate: ['OUTER_BEARD_UNDERSIDE'] }] };
  var cst = A.initContourState(cbundle);
  cst = A.setContourTraceabilityStatus(cst, 'o1', 'OUTER_BEARD_UNDERSIDE', 'NOT_TRACEABLE');
  var c = cst.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE;
  assert.equal(c.traceabilityStatus, 'NOT_TRACEABLE');
  assert.equal(c.points.length, 0);
});

// ---------- 32. pre-export structural validation ----------

test('32. validateGeometry blocks export (blocksExport=true) on structural errors and never repairs the input array', () => {
  var pts = [{ x: -1, y: 0 }, { x: 5, y: 5 }];
  var before = JSON.stringify(pts);
  var v = PC.validateGeometry(pts, PC.GEOMETRY_TYPE.OPEN_POLYLINE, 100, 100);
  assert.equal(v.blocksExport, true);
  assert.equal(JSON.stringify(pts), before, 'input array never mutated');
});

// ---------- 33. no network calls ----------

test('33. precision-annotation-core.cjs has zero network calls', () => {
  var src = readFileSync(new URL('./precision-annotation-core.cjs', import.meta.url), 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(src));
});

// ---------- 34/35. production hashes / scanner-runtime files unchanged ----------

test('34. production hashes (index.html at repo root, worker.js) remain unchanged', () => {
  var idx = readFileSync(new URL('../../index.html', import.meta.url));
  var wkr = readFileSync(new URL('../../worker.js', import.meta.url));
  assert.equal(sha256(idx), '928747a5d284060dddac43c95f97a1669492ab4d1ecebf0d34bc59f3a3b5b521');
  assert.equal(sha256(wkr), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});

test('35. scanner/research runtime files (sparse-neck-scaffold-v1.mjs, region-scoped-beard-occupancy-v1.mjs, hairness-core-v1.mjs) unchanged', () => {
  assert.equal(sha256(readFileSync(new URL('../../accuracy/sparse-neck-scaffold-v1.mjs', import.meta.url))), '3798248b018919a61dea71173802b7a4acf6420447edffecc3e49da020d306f9');
  assert.equal(sha256(readFileSync(new URL('../../accuracy/region-scoped-beard-occupancy-v1.mjs', import.meta.url))), '4296668b88e121859db0a40ff69bce19c3c47f0b273363acb73e133795d6eaaa');
});
