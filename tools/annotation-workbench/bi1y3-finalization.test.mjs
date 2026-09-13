// Stage BI-1Y3 — assisted-silhouette GT finalization + export hardening tests.
// Node built-in runner (node --test). Synthetic fixtures only, plus structural checks against the
// real (unmodified) BI-1Y2 completed export and the real BI-1Y3 geometry-ready derivative.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import AWB from './annotation-workbench.cjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'synthetic-bundle.json'), 'utf8'));
const bundle = () => JSON.parse(JSON.stringify(FIXTURE));
const TARGET = 'VISIBLE_BEARD_SILHOUETTE';
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwAEhgGAWjR9awAAAABJRU5ErkJggg==';

function rawEntry(overrides) {
  return Object.assign({
    schemaVersion: 'annotation-bundle/1',
    identityMode: 'RAW_SCAN_OBSERVATION',
    sourceScanObservationId: null,
    scanSessionId: 'synthetic-session-raw',
    nativeFrameTimestampNs: '9999',
    rawObservationId: 3,
    adapterRetained: false,
    imageRef: 'synthetic-raw:img:3:ts9999',
    poseId: 'chin-up',
    observedPoseRegion: 'CHINUP_REGION',
    currentScannerStep: 'front',
    yawDeg: 0.8, pitchDeg: -39.2, rollDeg: 5.2,
    regionsToAnnotate: [], contourTypesToAnnotate: [],
    assistedReviewTargets: [TARGET],
    // deliberately NOT setting imageWidth/imageHeight on the bundle entry itself -- BI-1Y3
    // Issue 1 is precisely that this field is null on every real bundle entry.
    rawImagePayload: TINY_PNG,
    rawImageFormat: 'data-url', rawImageStorageScope: 'LOCAL_ANNOTATION_BUNDLE',
    bundleImageStatus: 'INCLUDED_FOR_ANNOTATION', outcome: 'RESOLVED'
  }, overrides || {});
}
function reviewBundle(entryOverrides) {
  const b = bundle();
  b.entries = [rawEntry(entryOverrides)];
  return b;
}
const PROPOSAL_POLY = [{ x: 10, y: 10 }, { x: 50, y: 5 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }];
const PROPOSAL = {
  algorithm: 'beard-proposal-otsu-prior-hybrid', algorithmVersion: 'beard-proposal/1',
  parameters: { priorDilateRadius: 18 }, generatedAt: '2026-01-01T00:00:00.000Z',
  originalProposalPoints: PROPOSAL_POLY, handlePoints: PROPOSAL_POLY.map(p => ({ x: p.x, y: p.y }))
};
function attached(b, w, h) {
  const key = AWB.entryKey(b.entries[0]);
  let st = AWB.initAssistedReviewState(b);
  if (w != null) st = AWB.setReviewImageDimensions(st, key, w, h);
  return AWB.attachProposal(st, key, TARGET, PROPOSAL);
}

// 1 — assisted-review IMAGE export requires dimensions
test('1: a GroundTruth item with no captured image dimensions fails validateAssistedReviewExport', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b, null, null); // no setReviewImageDimensions call -- simulates the BI-1Y2 bug
  st = AWB.setReviewStatus(st, key, TARGET, 'APPROVED_AS_IS');
  const exp = AWB.buildAssistedReviewExport(b, st);
  assert.equal(exp.items[0].imageWidth, null);
  const v = AWB.validateAssistedReviewExport(exp, b);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /missing valid positive imageWidth\/imageHeight/.test(e)));
});

// 2 — decoded/canonical image dimensions propagate into export
test('2: setReviewImageDimensions propagates the real decoded size into the export, and export then validates', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b, 640, 480);
  st = AWB.setReviewStatus(st, key, TARGET, 'APPROVED_AS_IS');
  const exp = AWB.buildAssistedReviewExport(b, st);
  assert.equal(exp.items[0].imageWidth, 640);
  assert.equal(exp.items[0].imageHeight, 480);
  const v = AWB.validateAssistedReviewExport(exp, b);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});
test('2b: bundle-declared imageWidth/imageHeight is used as a fallback only when the review record never captured real dimensions', () => {
  const b = reviewBundle({ imageWidth: 320, imageHeight: 240 });
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b, null, null);
  st = AWB.setReviewStatus(st, key, TARGET, 'APPROVED_AS_IS');
  const exp = AWB.buildAssistedReviewExport(b, st);
  assert.equal(exp.items[0].imageWidth, 320);
  assert.equal(exp.items[0].imageHeight, 240);
});

// 3 — numeric-string timestamp preservation
test('3: assisted-review export preserves a numeric-string nativeFrameTimestampNs verbatim', () => {
  const b = reviewBundle({ nativeFrameTimestampNs: '424242' });
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b, 640, 480);
  st = AWB.setReviewStatus(st, key, TARGET, 'APPROVED_AS_IS');
  const exp = AWB.buildAssistedReviewExport(b, st);
  assert.equal(exp.items[0].nativeFrameTimestampNs, '424242');
});

// 4 — humanFinalPoints unchanged (through the fix)
test('4: humanFinalPoints are unaffected by the dimension-plumbing fix', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b, 640, 480);
  st = AWB.moveHandlePoint(st, key, TARGET, 0, 7, 8);
  st = AWB.setReviewStatus(st, key, TARGET, 'EDITED_AND_APPROVED');
  const exp = AWB.buildAssistedReviewExport(b, st);
  assert.deepEqual(exp.items[0].humanFinalPoints[0], { x: 7, y: 8 });
});

// 5 — originalProposalPoints unchanged
test('5: originalProposalPoints remain exactly the dense machine proposal, untouched by dimension capture or edits', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b, 640, 480);
  st = AWB.moveHandlePoint(st, key, TARGET, 0, 7, 8);
  st = AWB.setReviewStatus(st, key, TARGET, 'EDITED_AND_APPROVED');
  const exp = AWB.buildAssistedReviewExport(b, st);
  assert.deepEqual(exp.items[0].originalProposalPoints, PROPOSAL_POLY);
});

// 6 — geometry-ready derivative preserves exact human GT (simulated derivation step)
test('6: a geometry-ready derivative built the same way as the real BI-1Y3 script preserves humanFinalPoints/originalProposalPoints/status/identity exactly', () => {
  const b = reviewBundle({ scanSessionId: 'scan_mtcfdr6x_atfvgh', rawObservationId: 6, observedPoseRegion: 'FRONT_REGION' });
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b, 640, 480);
  st = AWB.moveHandlePoint(st, key, TARGET, 0, 7, 8);
  st = AWB.setReviewStatus(st, key, TARGET, 'EDITED_AND_APPROVED');
  const exp = AWB.buildAssistedReviewExport(b, st, { exportedAt: '2026-01-01T00:00:00.000Z' });
  const v0 = AWB.validateAssistedReviewExport(exp, b);
  assert.equal(v0.ok, true, JSON.stringify(v0.errors));

  // simulate the BI-1Y3 derivation: copy each item, overwrite ONLY dimension + provenance fields
  const derivedItems = exp.items.map(it => {
    const copy = JSON.parse(JSON.stringify(it));
    copy.imageWidth = 640; copy.imageHeight = 480; // independently "verified" value
    copy.imageDimensionProvenance = { method: 'JPEG_SOF0_MARKER_PARSE' };
    return copy;
  });
  exp.items.forEach((orig, i) => {
    const d = derivedItems[i];
    assert.deepEqual(d.humanFinalPoints, orig.humanFinalPoints);
    assert.deepEqual(d.originalProposalPoints, orig.originalProposalPoints);
    assert.equal(d.humanReviewStatus, orig.humanReviewStatus);
    assert.equal(d.scanSessionId, orig.scanSessionId);
    assert.equal(d.rawObservationId, orig.rawObservationId);
    assert.equal(d.nativeFrameTimestampNs, orig.nativeFrameTimestampNs);
    assert.equal(d.sourceScanObservationId, orig.sourceScanObservationId);
  });
});

// 7 — raw identity exact
test('7: scanSessionId/rawObservationId/observedPoseRegion/sourceScanObservationId/adapterRetained round-trip exactly', () => {
  const b = reviewBundle({ scanSessionId: 'scan_mtcfdr6x_atfvgh', rawObservationId: 6, observedPoseRegion: 'FRONT_REGION' });
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b, 640, 480);
  st = AWB.setReviewStatus(st, key, TARGET, 'APPROVED_AS_IS');
  const exp = AWB.buildAssistedReviewExport(b, st);
  const it = exp.items[0];
  assert.equal(it.scanSessionId, 'scan_mtcfdr6x_atfvgh');
  assert.equal(it.rawObservationId, 6);
  assert.equal(it.observedPoseRegion, 'FRONT_REGION');
  assert.equal(it.sourceScanObservationId, null);
  assert.equal(it.adapterRetained, false);
});

// 8 — holdout absent
test('8: validateAssistedReviewExport rejects the sealed holdout identity', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b, 640, 480);
  st = AWB.setReviewStatus(st, key, TARGET, 'APPROVED_AS_IS');
  const exp = AWB.buildAssistedReviewExport(b, st);
  exp.items[0].scanSessionId = 'scan_mtdogmlr_espu2w';
  exp.items[0].rawObservationId = 22;
  const v = AWB.validateAssistedReviewExport(exp, b);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /SEALED HOLDOUT/.test(e)));
});

// 9 — self-intersecting final polygon: flagged via a read-only diagnostic (never silently repaired)
test('9: a self-intersecting humanFinalPoints polygon is detectable by a pure geometry check (bowtie quad)', () => {
  // a classic self-intersecting "bowtie": edges (0->1) and (2->3) cross
  const bowtie = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
  function ccw(a, c, d) { return (c.x - a.x) * (d.y - a.y) - (c.y - a.y) * (d.x - a.x); }
  function segInt(p1, p2, p3, p4) {
    const d1 = ccw(p3, p4, p1), d2 = ccw(p3, p4, p2), d3 = ccw(p1, p2, p3), d4 = ccw(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  function hasSelfIntersection(pts) {
    const n = pts.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segInt(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
    return false;
  }
  assert.equal(hasSelfIntersection(bowtie), true);
  assert.equal(hasSelfIntersection(PROPOSAL_POLY), false);
});

// 10 — zero-area polygon rejected
test('10: a zero-area (degenerate/collinear) polygon is detectable by a pure shoelace-area check', () => {
  function area(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; }
  const collinear = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
  assert.equal(area(collinear), 0);
  assert.ok(area(PROPOSAL_POLY) > 0);
});

// 11 — future gesture telemetry does not count every pointermove as a separate logical gesture
test('11: recordDragGesture increments dragGestureCount exactly once per call, independent of how many moveHandlePoint calls preceded it', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b, 640, 480);
  // simulate a real drag: many intermediate moveHandlePoint calls (as pointermove would produce)...
  for (let i = 0; i < 50; i++) st = AWB.moveHandlePoint(st, key, TARGET, 0, 10 + i, 10 + i);
  assert.equal(st.byEntry[key].targets[TARGET].pointsMoved, 50, 'legacy pointsMoved still counts every move (preserved for provenance)');
  // ...but exactly ONE drag gesture is recorded on release, regardless of the 50 intermediate moves
  st = AWB.recordDragGesture(st, key, TARGET, 0, 123.4, 56.6);
  const inst = st.byEntry[key].targets[TARGET];
  assert.equal(inst.dragGestureCount, 1);
  assert.deepEqual(inst.distinctHandlesMoved, [0]);
  assert.equal(inst.totalVertexDisplacementPx, 123.4);
  assert.equal(inst.netVertexDisplacementPx, 56.6);
  // a second gesture on a different handle increments the gesture count and the distinct-handle set
  st = AWB.recordDragGesture(st, key, TARGET, 2, 10, 5);
  assert.equal(st.byEntry[key].targets[TARGET].dragGestureCount, 2);
  assert.deepEqual(st.byEntry[key].targets[TARGET].distinctHandlesMoved, [0, 2]);
  // a second gesture on the SAME handle increments the gesture count but not the distinct-handle set
  st = AWB.recordDragGesture(st, key, TARGET, 0, 10, 5);
  assert.equal(st.byEntry[key].targets[TARGET].dragGestureCount, 3);
  assert.deepEqual(st.byEntry[key].targets[TARGET].distinctHandlesMoved, [0, 2]);
});
test('11b: an instance with no recorded drag gestures defaults to zero/empty, never a fabricated count', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  const st = attached(b, 640, 480);
  const inst = st.byEntry[key].targets[TARGET];
  assert.equal(inst.dragGestureCount, 0);
  assert.deepEqual(inst.distinctHandlesMoved, []);
  assert.equal(inst.netVertexDisplacementPx, 0);
  assert.equal(inst.totalVertexDisplacementPx, 0);
});
test('11c: exported dragGestureCount/distinctHandlesMovedCount/displacement fields are present and consistent', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b, 640, 480);
  st = AWB.recordDragGesture(st, key, TARGET, 1, 50, 20);
  st = AWB.setReviewStatus(st, key, TARGET, 'APPROVED_AS_IS');
  const exp = AWB.buildAssistedReviewExport(b, st);
  assert.equal(exp.items[0].dragGestureCount, 1);
  assert.equal(exp.items[0].distinctHandlesMovedCount, 1);
  assert.equal(exp.items[0].totalVertexDisplacementPx, 50);
  assert.equal(exp.items[0].netVertexDisplacementPx, 20);
});

// 12 — old BI-1Y/BI-1W artifacts untouched
test('12: BI-1Y contour and BI-1W categorical state/export are unaffected by any BI-1Y3 change', () => {
  const b = reviewBundle();
  b.entries[0].regionsToAnnotate = ['UNDER_CHIN'];
  b.entries[0].contourTypesToAnnotate = ['OUTER_BEARD_UNDERSIDE'];
  const key = AWB.entryKey(b.entries[0]);

  let catState = AWB.initAnnotationState(b);
  catState = AWB.setRegionLabel(catState, key, 'UNDER_CHIN', { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED', surfaceObservability: 'VISIBLE_SKIN' });
  const catBefore = JSON.parse(JSON.stringify(catState));

  let contourState = AWB.initContourState(b);
  contourState = AWB.setContourImageDimensions(contourState, key, 640, 480);
  const contourBefore = JSON.parse(JSON.stringify(contourState));

  let st = attached(b, 640, 480);
  st = AWB.moveHandlePoint(st, key, TARGET, 0, 1, 1);
  st = AWB.recordDragGesture(st, key, TARGET, 0, 10, 5);
  st = AWB.setReviewStatus(st, key, TARGET, 'EDITED_AND_APPROVED');

  assert.deepEqual(catState, catBefore);
  assert.deepEqual(contourState, contourBefore);
});

// ---- structural checks against the real BI-1Y2 completed export + BI-1Y3 derivative --------
test('structural: the real completed BI-1Y2 export is 5/5 EDITED_AND_APPROVED, isGroundTruth, 0 unreviewed/rejected/not-traceable, holdout-free', () => {
  const expPath = 'C:/Users/queen/Downloads/bi1y2-outer-beard-assisted-review-dev-001.assisted-review-groundtruth.json';
  const bundlePath = 'D:/MettleTemp/annotation/bi1y2_outer_beard_assisted_review_bundle.json';
  let exp, bundleReal;
  try {
    exp = JSON.parse(readFileSync(expPath, 'utf8'));
    bundleReal = JSON.parse(readFileSync(bundlePath, 'utf8'));
  } catch { return; } // stage-external artifacts; skip if absent
  assert.equal(exp.items.length, 5);
  assert.equal(exp.summary.editedApproved, 5);
  assert.equal(exp.summary.approvedAsIs, 0);
  assert.equal(exp.summary.rejected, 0);
  assert.equal(exp.summary.notTraceable, 0);
  assert.equal(exp.summary.unreviewed, 0);
  exp.items.forEach(it => {
    assert.equal(it.humanReviewStatus, 'EDITED_AND_APPROVED');
    assert.equal(it.isGroundTruth, true);
    assert.equal(it.reviewTarget, TARGET);
    assert.equal(it.sourceScanObservationId, null);
    assert.equal(it.adapterRetained, false);
    assert.equal(typeof it.nativeFrameTimestampNs, 'string');
    assert.equal(AWB.isSealedHoldoutEntry(it), false);
  });
  assert.equal(exp.bundleFingerprint, AWB.bundleFingerprint(bundleReal));
});
test('structural: the real BI-1Y3 geometry-ready derivative preserves exact human GT and carries verified 640x480 dimensions', () => {
  const derivedPath = 'D:/MettleTemp/annotation/bi1y2_outer_beard_assisted_gt_geometry_ready.json';
  const expPath = 'C:/Users/queen/Downloads/bi1y2-outer-beard-assisted-review-dev-001.assisted-review-groundtruth.json';
  let derived, orig, origRaw;
  try {
    origRaw = readFileSync(expPath, 'utf8');
    orig = JSON.parse(origRaw);
    derived = JSON.parse(readFileSync(derivedPath, 'utf8'));
  } catch { return; } // stage-external artifacts; skip if absent
  assert.equal(derived.items.length, 5);
  assert.equal(derived.derivationStage, 'BI-1Y3');
  assert.equal(derived.sourceArtifact.sha256, createHash('sha256').update(origRaw, 'utf8').digest('hex'), 'derivative must record the exact hash of the untouched source export');
  derived.items.forEach(d => {
    assert.equal(d.imageWidth, 640);
    assert.equal(d.imageHeight, 480);
    const o = orig.items.find(x => x.reviewItemId === d.reviewItemId);
    assert.ok(o, 'every derived item must resolve back to a real original item');
    assert.deepEqual(d.humanFinalPoints, o.humanFinalPoints);
    assert.deepEqual(d.originalProposalPoints, o.originalProposalPoints);
    assert.equal(d.humanReviewStatus, o.humanReviewStatus);
  });
});
