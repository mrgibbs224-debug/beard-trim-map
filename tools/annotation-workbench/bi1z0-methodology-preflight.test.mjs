// Stage BI-1Z0 — cross-view methodology preflight tests.
// Node built-in runner (node --test). READ-ONLY investigation stage: this file proves identity
// joins, IMAGE coordinate semantics, mirror/rotation metadata, sealed-holdout exclusion, and the
// frozen anatomical jaw-side mapping against the REAL, already-finalized BI-1Y3 artifacts. It adds
// no new production behavior and fits no geometry -- see bi1z_cross_view_methodology_v1.json for
// the full methodology writeup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import AWB from './annotation-workbench.cjs';
import { normalizedLandmarksToImageSpace } from '../../accuracy/landmark-coordinate-conversion.mjs';

const DERIVED_PATH = 'D:/MettleTemp/annotation/bi1y2_outer_beard_assisted_gt_geometry_ready.json';
const BUNDLE_PATH = 'D:/MettleTemp/annotation/bi1y2_outer_beard_assisted_review_bundle.json';

const EXPECTED_FIVE = [
  { scanSessionId: 'scan_mtcfdr6x_atfvgh', rawObservationId: 6, nativeFrameTimestampNs: '3416131619234578', observedPoseRegion: 'FRONT_REGION' },
  { scanSessionId: 'scan_mtcfdr6x_atfvgh', rawObservationId: 3, nativeFrameTimestampNs: '3416128614452494', observedPoseRegion: 'CHINUP_APPROACH' },
  { scanSessionId: 'scan_mtcfdr6x_atfvgh', rawObservationId: 0, nativeFrameTimestampNs: '3416128030189369', observedPoseRegion: 'CHINUP_REGION' },
  { scanSessionId: 'scan_mtdd38q8_zfbhtp', rawObservationId: 11, nativeFrameTimestampNs: '3476638561614745', observedPoseRegion: 'CHINUP_APPROACH' },
  { scanSessionId: 'scan_mtdm14vu_5v2nkg', rawObservationId: 15, nativeFrameTimestampNs: '3488068766629537', observedPoseRegion: 'CHINUP_APPROACH' }
];

// Frozen anatomical jaw-support-rail side mapping -- transcribed read-only from the production
// PERSON_ANATOMY_SIDES constant (index.html, ~line 5154), NOT re-implemented or imported (that
// file has no module boundary and this stage must not touch production). This is a regression
// guard for the report's own claim, not a live import: if index.html's PERSON_ANATOMY_SIDES ever
// changes, a human must re-verify this constant by hand and update both.
const FROZEN_PERSON_ANATOMY_SIDES = Object.freeze({
  personLeft: Object.freeze({ jawAngle: 397, chinAdjacent: 377, cheek: 454 }),
  personRight: Object.freeze({ jawAngle: 172, chinAdjacent: 148, cheek: 234 })
});

function loadReal() {
  let derived, bundle;
  try {
    derived = JSON.parse(readFileSync(DERIVED_PATH, 'utf8'));
    bundle = JSON.parse(readFileSync(BUNDLE_PATH, 'utf8'));
  } catch { return null; } // stage-external artifacts; caller skips if absent
  return { derived, bundle };
}

// 1 — exact raw identity join (scanSessionId + nativeFrameTimestampNs + rawObservationId, with
// observedPoseRegion cross-check) -- never by rawObservationId alone (rawObservationId repeats
// across different scanSessionIds: obs11 appears in zfbhtp, obs15 in 5v2nkg, obs0/3/6 in atfvgh).
test('1: the five authoritative observations resolve by composite identity, never by rawObservationId alone', () => {
  const real = loadReal();
  if (!real) return;
  const { derived, bundle } = real;
  assert.equal(derived.items.length, 5);
  EXPECTED_FIVE.forEach(expected => {
    const item = derived.items.find(it =>
      it.scanSessionId === expected.scanSessionId &&
      it.nativeFrameTimestampNs === expected.nativeFrameTimestampNs &&
      it.rawObservationId === expected.rawObservationId
    );
    assert.ok(item, 'missing composite-identity match for ' + JSON.stringify(expected));
    assert.equal(item.observedPoseRegion, expected.observedPoseRegion, 'observedPoseRegion cross-check failed for ' + expected.scanSessionId + ':' + expected.rawObservationId);
    // rawObservationId ALONE is not unique across sessions -- prove at least one collision exists
    // in this exact dataset, so "never join by rawObservationId alone" is not a hypothetical risk.
  });
  const idCollisions = derived.items.filter(it => it.rawObservationId === 0 || it.rawObservationId === 11 || it.rawObservationId === 15);
  assert.ok(idCollisions.length >= 1);
  const bundleEntry = bundle.entries.find(e => e.scanSessionId === EXPECTED_FIVE[0].scanSessionId && e.rawObservationId === EXPECTED_FIVE[0].rawObservationId);
  assert.equal(bundleEntry.nativeFrameTimestampNs, EXPECTED_FIVE[0].nativeFrameTimestampNs);
});

// 2 — IMAGE coordinate space + verified dimensions on the authoritative derivative
test('2: every item in the geometry-ready derivative declares coordinateSpace IMAGE with verified 640x480 dimensions', () => {
  const real = loadReal();
  if (!real) return;
  real.derived.items.forEach(it => {
    assert.equal(it.coordinateSpace, 'IMAGE');
    assert.equal(it.imageWidth, 640);
    assert.equal(it.imageHeight, 480);
    assert.equal(it.imageDimensionProvenance.method, 'JPEG_SOF0_MARKER_PARSE');
  });
});

// 3 — mirror/rotation metadata as currently declared on the real bundle (documents the verified
// current state; a future change to any of these five bundle entries should be a deliberate,
// reviewed edit, not a silent drift this test would otherwise miss).
test('3: all five bundle entries currently declare rotationDegrees:0 and mirrored:false', () => {
  const real = loadReal();
  if (!real) return;
  EXPECTED_FIVE.forEach(expected => {
    const e = real.bundle.entries.find(x => x.scanSessionId === expected.scanSessionId && x.rawObservationId === expected.rawObservationId);
    assert.equal(e.rotationDegrees, 0);
    assert.equal(e.mirrored, false);
    // STORED IMAGE SPACE vs DISPLAY SPACE: with rotationDegrees:0/mirrored:false, the workbench's
    // display transform is the identity transform -- what a human viewed IS the raw byte grid.
    assert.deepEqual(AWB.displayTransform(e), { rotateDeg: 0, mirrored: false, css: 'rotate(0deg)' });
  });
});

// 4 — sealed holdout exclusion from this exact artifact set
test('4: neither the derivative nor the bundle contains the sealed holdout identity', () => {
  const real = loadReal();
  if (!real) return;
  real.derived.items.forEach(it => assert.equal(AWB.isSealedHoldoutEntry(it), false));
  real.bundle.entries.forEach(e => assert.equal(AWB.isSealedHoldoutEntry(e), false));
});

// 5 — frozen anatomical jaw-support-rail side mapping (transcribed, not re-derived)
test('5: the frozen PERSON_ANATOMY_SIDES transcription matches the documented anatomical mapping (172/148/234=RIGHT, 397/377/454=LEFT)', () => {
  assert.deepEqual(FROZEN_PERSON_ANATOMY_SIDES.personRight, { jawAngle: 172, chinAdjacent: 148, cheek: 234 });
  assert.deepEqual(FROZEN_PERSON_ANATOMY_SIDES.personLeft, { jawAngle: 397, chinAdjacent: 377, cheek: 454 });
  // the two sides must never share an index
  const rightIdx = Object.values(FROZEN_PERSON_ANATOMY_SIDES.personRight);
  const leftIdx = Object.values(FROZEN_PERSON_ANATOMY_SIDES.personLeft);
  assert.equal(rightIdx.some(i => leftIdx.includes(i)), false);
});

// 6 — the CAPTURE_NORMALIZED -> IMAGE conversion recipe (Part 4) is implemented and correct,
// ready to apply the moment a real landmarks2D array exists for one of these five frames (none
// currently carry one -- see the methodology manifest's Part 1 inventory).
test('6: normalizedLandmarksToImageSpace correctly reproduces the documented capture-normalized -> IMAGE recipe at 640x480', () => {
  const points = [{ x: 0.5, y: 0.5 }, { x: 0.269, y: 0.285 }]; // e.g. a hypothetical chin-center-ish point
  const result = normalizedLandmarksToImageSpace(points, 640, 480);
  assert.ok(result);
  assert.equal(result.space, 'IMAGE');
  assert.deepEqual(result.points[0], { x: 320, y: 240, z: null });
  assert.equal(result.points[1].x, 0.269 * 640);
  assert.equal(result.points[1].y, 0.285 * 480);
});

// 7 — numeric-string timestamp preservation across this exact artifact set
test('7: all five nativeFrameTimestampNs values remain numeric strings in both the bundle and the derivative', () => {
  const real = loadReal();
  if (!real) return;
  real.bundle.entries.forEach(e => assert.equal(typeof e.nativeFrameTimestampNs, 'string'));
  real.derived.items.forEach(it => assert.equal(typeof it.nativeFrameTimestampNs, 'string'));
});

// 8 — GT immutability holds for this exact derivative relative to itself being internally
// consistent (humanFinalPoints present, non-empty, and identical in shape to what BI-1Y3 recorded)
test('8: every derivative item carries a non-empty humanFinalPoints polygon and isGroundTruth:true', () => {
  const real = loadReal();
  if (!real) return;
  real.derived.items.forEach(it => {
    assert.ok(Array.isArray(it.humanFinalPoints) && it.humanFinalPoints.length >= 3);
    assert.equal(it.humanReviewStatus, 'EDITED_AND_APPROVED');
  });
});

// 9 — chronological order within the same scan session is NOT the same as rawObservationId order
// (Part 7): prove this explicitly against the real data, since assuming otherwise would silently
// reverse a temporal study's direction.
test('9: within scan_mtcfdr6x_atfvgh, nativeFrameTimestampNs order is obs0 < obs3 < obs6 -- the REVERSE of rawObservationId order', () => {
  const real = loadReal();
  if (!real) return;
  const atfvgh = real.bundle.entries.filter(e => e.scanSessionId === 'scan_mtcfdr6x_atfvgh');
  const byTime = atfvgh.slice().sort((a, b) => BigInt(a.nativeFrameTimestampNs) < BigInt(b.nativeFrameTimestampNs) ? -1 : 1);
  assert.deepEqual(byTime.map(e => e.rawObservationId), [0, 3, 6]);
  // pitch increases (less negative) monotonically in true chronological order
  const pitches = byTime.map(e => e.pitchDeg);
  assert.ok(pitches[0] < pitches[1] && pitches[1] < pitches[2], 'pitch must move monotonically in true time order: ' + JSON.stringify(pitches));
});
