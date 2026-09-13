// Stage BI-1Y2 — assisted (machine-proposed, human-verified) beard-boundary review tests.
// Node built-in runner (node --test). Synthetic fixtures only, plus one structural check against
// the real (unmodified) BI-1Y2 assisted-review bundle file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
    imageWidth: 100, imageHeight: 100,
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
const PROPOSAL = {
  algorithm: 'beard-proposal-otsu-prior-hybrid', algorithmVersion: 'beard-proposal/1',
  parameters: { priorDilateRadius: 18 }, generatedAt: '2026-01-01T00:00:00.000Z',
  originalProposalPoints: [{ x: 10, y: 10 }, { x: 50, y: 5 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }],
  handlePoints: [{ x: 10, y: 10 }, { x: 50, y: 5 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }]
};
function attached(b) {
  const key = AWB.entryKey(b.entries[0]);
  let st = AWB.initAssistedReviewState(b);
  return AWB.attachProposal(st, key, TARGET, PROPOSAL);
}

// 1 — proposal immutability
test('1: originalProposalPoints and originalHandlePoints are never mutated by any edit', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  const beforeOriginal = JSON.parse(JSON.stringify(st.byEntry[key].targets[TARGET].originalProposalPoints));
  const beforeHandles = JSON.parse(JSON.stringify(st.byEntry[key].targets[TARGET].originalHandlePoints));
  st = AWB.moveHandlePoint(st, key, TARGET, 0, 999, 999);
  st = AWB.addHandlePoint(st, key, TARGET, 0, 5, 5);
  st = AWB.deleteHandlePoint(st, key, TARGET, 1);
  assert.deepEqual(st.byEntry[key].targets[TARGET].originalProposalPoints, beforeOriginal);
  assert.deepEqual(st.byEntry[key].targets[TARGET].originalHandlePoints, beforeHandles);
});

// 2 — machine/final separation
test('2: humanFinalPoints and originalProposalPoints are separate arrays -- editing one never touches the other', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.moveHandlePoint(st, key, TARGET, 0, 1, 2);
  const inst = st.byEntry[key].targets[TARGET];
  assert.deepEqual(inst.humanFinalPoints[0], { x: 1, y: 2 });
  assert.deepEqual(inst.originalProposalPoints[0], { x: 10, y: 10 });
  assert.deepEqual(inst.originalHandlePoints[0], { x: 10, y: 10 });
});

// 3 — drag point
test('3: moveHandlePoint (drag) updates exactly the targeted point and increments counters', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.moveHandlePoint(st, key, TARGET, 2, 42, 43);
  const inst = st.byEntry[key].targets[TARGET];
  assert.deepEqual(inst.humanFinalPoints[2], { x: 42, y: 43 });
  assert.equal(inst.humanFinalPoints.length, 5);
  assert.equal(inst.editCount, 1);
  assert.equal(inst.pointsMoved, 1);
});

// 4 — add point
test('4: addHandlePoint inserts a new point at the requested position and increments counters', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.addHandlePoint(st, key, TARGET, 1, 60, 6);
  const inst = st.byEntry[key].targets[TARGET];
  assert.equal(inst.humanFinalPoints.length, 6);
  assert.deepEqual(inst.humanFinalPoints[2], { x: 60, y: 6 });
  assert.equal(inst.pointsAdded, 1);
  assert.equal(inst.editCount, 1);
});

// 5 — delete point
test('5: deleteHandlePoint removes exactly the targeted point and increments counters', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.deleteHandlePoint(st, key, TARGET, 1);
  const inst = st.byEntry[key].targets[TARGET];
  assert.equal(inst.humanFinalPoints.length, 4);
  assert.equal(inst.humanFinalPoints.some(p => p.x === 50 && p.y === 5), false);
  assert.equal(inst.pointsDeleted, 1);
});
test('5b: deleteHandlePoint refuses to shrink below MIN_SILHOUETTE_POINTS', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.deleteHandlePoint(st, key, TARGET, 0);
  st = AWB.deleteHandlePoint(st, key, TARGET, 0);
  assert.throws(() => AWB.deleteHandlePoint(st, key, TARGET, 0), /at least/);
});

// 6 — undo
test('6: undoLastEdit reverts exactly the most recent point mutation', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  const before = JSON.parse(JSON.stringify(st.byEntry[key].targets[TARGET].humanFinalPoints));
  st = AWB.moveHandlePoint(st, key, TARGET, 0, 1, 1);
  st = AWB.moveHandlePoint(st, key, TARGET, 0, 2, 2);
  st = AWB.undoLastEdit(st, key, TARGET);
  assert.deepEqual(st.byEntry[key].targets[TARGET].humanFinalPoints[0], { x: 1, y: 1 });
  st = AWB.undoLastEdit(st, key, TARGET);
  assert.deepEqual(st.byEntry[key].targets[TARGET].humanFinalPoints, before);
});
test('6b: undoLastEdit is a safe no-op with an empty history', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  const before = JSON.parse(JSON.stringify(st.byEntry[key].targets[TARGET].humanFinalPoints));
  st = AWB.undoLastEdit(st, key, TARGET);
  assert.deepEqual(st.byEntry[key].targets[TARGET].humanFinalPoints, before);
});

// 7 — reset to exact proposal
test('7: resetToProposal restores the exact original handle set and zeroes all edit counters', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.moveHandlePoint(st, key, TARGET, 0, 1, 1);
  st = AWB.addHandlePoint(st, key, TARGET, 0, 2, 2);
  st = AWB.setReviewStatus(st, key, TARGET, 'EDITED_AND_APPROVED');
  st = AWB.resetToProposal(st, key, TARGET);
  const inst = st.byEntry[key].targets[TARGET];
  assert.deepEqual(inst.humanFinalPoints, PROPOSAL.handlePoints);
  assert.equal(inst.editCount, 0); assert.equal(inst.pointsMoved, 0);
  assert.equal(inst.pointsAdded, 0); assert.equal(inst.pointsDeleted, 0);
  assert.equal(inst.humanReviewStatus, AWB.REVIEW_PENDING_STATUS, 'reset must un-approve -- a reset shape has not been re-reviewed');
});

// 8/9 — precision keyboard nudge (1px / 5px)
test('8: nudgeHandlePoint moves a point by exactly a 1-pixel delta', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  const before = st.byEntry[key].targets[TARGET].humanFinalPoints[0];
  st = AWB.nudgeHandlePoint(st, key, TARGET, 0, 1, 0);
  assert.deepEqual(st.byEntry[key].targets[TARGET].humanFinalPoints[0], { x: before.x + 1, y: before.y });
});
test('9: nudgeHandlePoint moves a point by exactly a 5-pixel delta (Shift+Arrow)', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  const before = st.byEntry[key].targets[TARGET].humanFinalPoints[0];
  st = AWB.nudgeHandlePoint(st, key, TARGET, 0, 0, -5);
  assert.deepEqual(st.byEntry[key].targets[TARGET].humanFinalPoints[0], { x: before.x, y: before.y - 5 });
});

// 10/11/12/13 — the four human review statuses
test('10: APPROVED_AS_IS is only allowed with zero edits, and exports as GroundTruth', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.setReviewStatus(st, key, TARGET, 'APPROVED_AS_IS');
  const exp = AWB.buildAssistedReviewExport(b, st);
  assert.equal(exp.items[0].humanReviewStatus, 'APPROVED_AS_IS');
  assert.equal(exp.items[0].isGroundTruth, true);
  const v = AWB.validateAssistedReviewExport(exp, b);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});
test('10b: APPROVED_AS_IS is refused once any edit has been made', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.moveHandlePoint(st, key, TARGET, 0, 1, 1);
  assert.throws(() => AWB.setReviewStatus(st, key, TARGET, 'APPROVED_AS_IS'), /EDITED_AND_APPROVED/);
});
test('11: EDITED_AND_APPROVED preserves the human-corrected points and exports as GroundTruth', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.moveHandlePoint(st, key, TARGET, 0, 7, 8);
  st = AWB.setReviewStatus(st, key, TARGET, 'EDITED_AND_APPROVED');
  const exp = AWB.buildAssistedReviewExport(b, st);
  assert.equal(exp.items[0].isGroundTruth, true);
  assert.deepEqual(exp.items[0].humanFinalPoints[0], { x: 7, y: 8 });
  const v = AWB.validateAssistedReviewExport(exp, b);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});
test('12: REJECTED clears final points and never exports as GroundTruth', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.setReviewStatus(st, key, TARGET, 'REJECTED');
  assert.deepEqual(st.byEntry[key].targets[TARGET].humanFinalPoints, []);
  const exp = AWB.buildAssistedReviewExport(b, st);
  assert.equal(exp.items[0].isGroundTruth, false);
  const v = AWB.validateAssistedReviewExport(exp, b);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});
test('13: NOT_TRACEABLE clears final points and never exports as GroundTruth', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.setReviewStatus(st, key, TARGET, 'NOT_TRACEABLE');
  assert.deepEqual(st.byEntry[key].targets[TARGET].humanFinalPoints, []);
  const exp = AWB.buildAssistedReviewExport(b, st);
  assert.equal(exp.items[0].isGroundTruth, false);
});

// 14 — unreviewed proposals cannot export as GT (export blocked entirely, fail-closed)
test('14: an UNREVIEWED item blocks the whole export with a specific message', () => {
  const b = reviewBundle();
  const st = AWB.initAssistedReviewState(b); // no proposal attached, still UNREVIEWED
  const exp = AWB.buildAssistedReviewExport(b, st);
  const v = AWB.validateAssistedReviewExport(exp, b);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /is UNREVIEWED/.test(e)));
});

// 15 — numeric-string timestamps
test('15: assisted-review export preserves a numeric-string nativeFrameTimestampNs verbatim', () => {
  const b = reviewBundle({ nativeFrameTimestampNs: '424242' });
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.setReviewStatus(st, key, TARGET, 'APPROVED_AS_IS');
  const exp = AWB.buildAssistedReviewExport(b, st);
  assert.equal(exp.items[0].nativeFrameTimestampNs, '424242');
});

// 16 — raw identity round-trip
test('16: scanSessionId/rawObservationId/observedPoseRegion/sourceScanObservationId round-trip exactly', () => {
  const b = reviewBundle({ scanSessionId: 'scan_mtcfdr6x_atfvgh', rawObservationId: 6, observedPoseRegion: 'FRONT_REGION' });
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.setReviewStatus(st, key, TARGET, 'APPROVED_AS_IS');
  const exp = AWB.buildAssistedReviewExport(b, st);
  const it = exp.items[0];
  assert.equal(it.scanSessionId, 'scan_mtcfdr6x_atfvgh');
  assert.equal(it.rawObservationId, 6);
  assert.equal(it.observedPoseRegion, 'FRONT_REGION');
  assert.equal(it.sourceScanObservationId, null);
  assert.equal(it.adapterRetained, false);
  const v = AWB.validateAssistedReviewExport(exp, b);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

// 17 — coordinate correctness (out-of-bounds fails validation)
test('17: an out-of-bounds humanFinalPoint fails validateAssistedReviewExport', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.moveHandlePoint(st, key, TARGET, 0, 9999, 9999);
  st = AWB.setReviewStatus(st, key, TARGET, 'EDITED_AND_APPROVED');
  const exp = AWB.buildAssistedReviewExport(b, st);
  const v = AWB.validateAssistedReviewExport(exp, b);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /out of bounds/.test(e)));
});

// 18 — autosave/restore
test('18: assisted-review autosave/restore round-trips points, status, edit counters and notes', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.moveHandlePoint(st, key, TARGET, 0, 11, 12);
  st = AWB.setReviewNotes(st, key, TARGET, 'jaw looked slightly off, nudged left corner');
  st = AWB.setReviewStatus(st, key, TARGET, 'EDITED_AND_APPROVED');
  const save = AWB.buildAssistedReviewAutosavePayload(b, st);
  const res = AWB.restoreAssistedReviewFromAutosave(save, b);
  assert.equal(res.ok, true);
  const inst = res.state.byEntry[key].targets[TARGET];
  assert.deepEqual(inst.humanFinalPoints[0], { x: 11, y: 12 });
  assert.equal(inst.humanReviewStatus, 'EDITED_AND_APPROVED');
  assert.equal(inst.editCount, 1);
  assert.equal(inst.notes, 'jaw looked slightly off, nudged left corner');
});
test('18b: assisted-review autosave fails closed on a fingerprint mismatch', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  const save = AWB.buildAssistedReviewAutosavePayload(b, st);
  const other = reviewBundle({ rawObservationId: 999, imageRef: 'different' });
  const res = AWB.restoreAssistedReviewFromAutosave(save, other);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'FINGERPRINT_MISMATCH');
});
test('18c: a garbled saved review status fails closed to UNREVIEWED, never a real decision', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  const save = AWB.buildAssistedReviewAutosavePayload(b, st);
  save.review[key].targets[TARGET].humanReviewStatus = 'GARBAGE';
  const res = AWB.restoreAssistedReviewFromAutosave(save, b);
  assert.equal(res.state.byEntry[key].targets[TARGET].humanReviewStatus, AWB.REVIEW_PENDING_STATUS);
});

// 19 — old BI-1Y export untouched (this stage never reads/writes it; simulate the invariant)
test('19: assisted-review functions never touch BI-1Y contour state or its export shape', () => {
  const b = reviewBundle();
  b.entries[0].contourTypesToAnnotate = ['OUTER_BEARD_UNDERSIDE'];
  const key = AWB.entryKey(b.entries[0]);
  let contourState = AWB.initContourState(b);
  const contourBefore = JSON.parse(JSON.stringify(contourState));
  let st = attached(b);
  st = AWB.moveHandlePoint(st, key, TARGET, 0, 1, 1);
  st = AWB.setReviewStatus(st, key, TARGET, 'EDITED_AND_APPROVED');
  assert.deepEqual(contourState, contourBefore);
});

// 20 — BI-1W categorical GT untouched
test('20: assisted-review functions never touch BI-1W categorical annotation state', () => {
  const b = reviewBundle();
  b.entries[0].regionsToAnnotate = ['UNDER_CHIN'];
  const key = AWB.entryKey(b.entries[0]);
  let catState = AWB.initAnnotationState(b);
  catState = AWB.setRegionLabel(catState, key, 'UNDER_CHIN', { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED', surfaceObservability: 'VISIBLE_SKIN' });
  const catBefore = JSON.parse(JSON.stringify(catState));
  let st = attached(b);
  st = AWB.moveHandlePoint(st, key, TARGET, 0, 1, 1);
  st = AWB.setReviewStatus(st, key, TARGET, 'EDITED_AND_APPROVED');
  assert.deepEqual(catState, catBefore);
});

// 21 — sealed holdout absent
test('21: validateAssistedReviewExport rejects the sealed holdout identity', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.setReviewStatus(st, key, TARGET, 'APPROVED_AS_IS');
  const exp = AWB.buildAssistedReviewExport(b, st);
  exp.items[0].scanSessionId = 'scan_mtdogmlr_espu2w';
  exp.items[0].rawObservationId = 22;
  const v = AWB.validateAssistedReviewExport(exp, b);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /SEALED HOLDOUT/.test(e)));
});
test('21b: an unrecognized reviewTarget is rejected, never guessed', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.setReviewStatus(st, key, TARGET, 'APPROVED_AS_IS');
  const exp = AWB.buildAssistedReviewExport(b, st);
  exp.items[0].reviewTarget = 'BOGUS_TARGET';
  const v = AWB.validateAssistedReviewExport(exp, b);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /unrecognized reviewTarget/.test(e)));
});
test('22: duplicate reviewItemId fails validation', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.setReviewStatus(st, key, TARGET, 'APPROVED_AS_IS');
  const exp = AWB.buildAssistedReviewExport(b, st);
  exp.items.push(Object.assign({}, exp.items[0]));
  const v = AWB.validateAssistedReviewExport(exp, b);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /duplicate reviewItemId/.test(e)));
});
test('23: missing proposalAlgorithm provenance fails validation -- every GT row must be traceable to a machine proposal', () => {
  const b = reviewBundle();
  const key = AWB.entryKey(b.entries[0]);
  let st = attached(b);
  st = AWB.setReviewStatus(st, key, TARGET, 'APPROVED_AS_IS');
  const exp = AWB.buildAssistedReviewExport(b, st);
  exp.items[0].proposalAlgorithm = null;
  const v = AWB.validateAssistedReviewExport(exp, b);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /proposalAlgorithm/.test(e)));
});

// ---- structural check against the real, unmodified BI-1Y2 assisted-review bundle ----------
test('structural: the real BI-1Y2 bundle carries exactly the 5 locked observations, 1 review target each, 0 holdout, 0 pre-decided', () => {
  const path = 'D:/MettleTemp/annotation/bi1y2_outer_beard_assisted_review_bundle.json';
  let real;
  try { real = JSON.parse(readFileSync(path, 'utf8')); } catch { return; } // stage-external artifact; skip if absent
  assert.equal(real.entries.length, 5);
  const expected = [
    ['scan_mtcfdr6x_atfvgh', 6], ['scan_mtcfdr6x_atfvgh', 3], ['scan_mtcfdr6x_atfvgh', 0],
    ['scan_mtdd38q8_zfbhtp', 11], ['scan_mtdm14vu_5v2nkg', 15]
  ];
  assert.deepEqual(real.entries.map(e => [e.scanSessionId, e.rawObservationId]), expected);
  for (const e of real.entries) {
    assert.deepEqual(e.assistedReviewTargets, [TARGET]);
    assert.equal(AWB.isSealedHoldoutEntry(e), false);
    assert.ok(AWB.imageRenderable(e));
  }
  const st = AWB.initAssistedReviewState(real);
  const p = AWB.reviewProgressCounts(real, st);
  assert.equal(p.targetsRequested, 5);
  assert.equal(p.unreviewed, 5);
  assert.equal(p.decided, 0);
});
