// Stage BS1-H2 — verified geometry overlay for the annotation workbench.
// Node built-in runner (node --test). Zero dependencies. Synthetic fixtures only.
//
// The overlay is OPTIONAL and ANATOMICAL-REFERENCE-ONLY. A BS1-G AnnotationBundle v1 carries
// no landmark coordinates; an entry may additionally carry an `annotation-overlay-data/1`
// object that a future BS1-I stage would populate from the exact keyframe. These tests pin:
// default OFF, only-verified-indices, no fabrication, no under-jaw/neck, identical display
// transform for image and overlay, annotation defaults untouched, export unchanged.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import AWB from './annotation-workbench.cjs';
import * as OD from '../../accuracy/annotation-overlay-data.mjs';
import { UNSUPPORTED_REGIONS } from '../../accuracy/beard-anatomy-map.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OVERLAY_FIXTURE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'synthetic-overlay-bundle.json'), 'utf8'));
const PLAIN_FIXTURE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'synthetic-bundle.json'), 'utf8'));

const overlayBundle = () => JSON.parse(JSON.stringify(OVERLAY_FIXTURE));
const plainBundle = () => JSON.parse(JSON.stringify(PLAIN_FIXTURE));

// 1 — Overlay starts OFF.
test('1: geometry guide defaults OFF in a fresh annotation state', () => {
  const st = AWB.initAnnotationState(overlayBundle());
  assert.equal(st.geometryGuide, false);
});

// 2 — Overlay can be enabled when verified geometry exists.
test('2: overlay is available on an entry carrying verified overlay data, and can be toggled ON', () => {
  const b = overlayBundle();
  assert.equal(AWB.overlayAvailable(b.entries[0]), true);
  let st = AWB.initAnnotationState(b);
  st = AWB.setGeometryGuide(st, true);
  assert.equal(st.geometryGuide, true);
  const model = AWB.overlayDisplayModel(b.entries[0]);
  assert.ok(model && Array.isArray(model.points) && model.points.length > 0);
});

// 3 — Overlay unavailable when coordinates absent.
test('3: overlay is unavailable when the entry carries no overlay data', () => {
  assert.equal(AWB.overlayAvailable(overlayBundle().entries[2]), false); // chin-up entry, no overlayData
  assert.equal(AWB.overlayAvailable(plainBundle().entries[0]), false);   // BS1-G v1 bundle, no overlayData
  assert.equal(AWB.overlayDisplayModel(plainBundle().entries[0]), null);
});

// 4 — No geometry fabricated when unavailable.
test('4: no points are invented when overlay data is missing', () => {
  const m = AWB.overlayDisplayModel(overlayBundle().entries[2]);
  assert.equal(m, null);
  // the plain BS1-G fixture has landmarkCount-style summary at most, never coordinates
  const plain = plainBundle().entries[0];
  assert.equal('overlayData' in plain, false);
  assert.equal(AWB.overlayDisplayModel(plain), null);
});

// 5 — Only verified landmark indices accepted.
test('5: makeOverlayData accepts only verified landmark indices; the workbench set matches the contract', () => {
  assert.deepEqual([...AWB.VERIFIED_OVERLAY_INDICES], [...OD.VERIFIED_OVERLAY_INDICES]);
  const ok = OD.makeOverlayData({
    sourceScanObservationId: 'x', imageRef: 'x:ref', nativeFrameTimestampNs: 1,
    space: 'IMAGE', imageWidth: 64, imageHeight: 48,
    points: [{ index: 152, x: 1, y: 2, group: 'jaw-chin' }]
  });
  assert.equal(ok.points.length, 1);
  assert.equal(ok.schemaVersion, 'annotation-overlay-data/1');
});

// 6 — Unsupported landmark index rejected.
test('6: an unverified landmark index is rejected (whole call throws, nothing silently dropped)', () => {
  assert.throws(() => OD.makeOverlayData({
    sourceScanObservationId: 'x', imageRef: 'x:ref', nativeFrameTimestampNs: 1, space: 'IMAGE',
    points: [{ index: 999, x: 1, y: 2 }]
  }), /not a verified overlay landmark index/);
  assert.equal(AWB.isVerifiedOverlayIndex(999), false);
  assert.equal(OD.isVerifiedOverlayIndex(999), false);
});

// 7 — Jaw/chin set matches current source evidence.
test('7: the jaw/chin overlay group is exactly LOWER_FACE_DIAGNOSTIC_SETS.jawChinRail', () => {
  const g = OD.OVERLAY_GROUPS.find(x => x.id === 'jaw-chin');
  assert.deepEqual([...g.indices], [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397]);
  const wb = AWB.OVERLAY_GROUPS.find(x => x.id === 'jaw-chin');
  assert.deepEqual([...wb.indices], [...g.indices]);
  assert.match(g.source, /jawChinRail/);
});

// 8 — Cheek sets match current source evidence.
test('8: the cheek overlay group is exactly cheekRailA + cheekRailB', () => {
  const g = OD.OVERLAY_GROUPS.find(x => x.id === 'cheek');
  assert.deepEqual([...g.indices], [234, 116, 123, 205, 186, 454, 345, 352, 425, 410]);
  assert.match(g.source, /cheekRailA/);
  assert.match(g.source, /cheekRailB/);
  const mr = OD.OVERLAY_GROUPS.find(x => x.id === 'mouth-ref');
  assert.deepEqual([...mr.indices], [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]);
});

// 9 — Under-jaw/neck regions have no geometry overlay.
test('9: no overlay group or index maps to a BS1-C unsupported under-jaw / neck / sideburn region', () => {
  const prohibited = ['LEFT_SIDEBURN', 'RIGHT_SIDEBURN', 'LEFT_UPPER_CHEEK', 'RIGHT_UPPER_CHEEK',
    'MOUSTACHE_LEFT', 'MOUSTACHE_RIGHT', 'SOUL_PATCH', 'UNDER_CHIN', 'UNDER_JAW_LEFT',
    'UNDER_JAW_CENTER', 'UNDER_JAW_RIGHT', 'NECK_FRONT', 'NECK_LEFT', 'NECK_RIGHT', 'CHIN_NECK_TRANSITION'];
  for (const r of prohibited) assert.ok(OD.PROHIBITED_OVERLAY_REGIONS.includes(r), r + ' is prohibited');
  for (const r of prohibited) assert.ok(UNSUPPORTED_REGIONS.includes(r));
  // groups are named jaw-chin / cheek / mouth-ref only — no neck/under-jaw group id exists
  assert.deepEqual(OD.OVERLAY_GROUP_IDS, ['jaw-chin', 'cheek', 'mouth-ref']);
});

// 10 — Derived throat point is never presented as tracked geometry.
test('10: the index.html derived throat/neck point is explicitly excluded from the overlay', () => {
  assert.equal(OD.DERIVED_THROAT_POINT_EXCLUDED, true);
  assert.match(OD.DERIVED_THROAT_POINT_SOURCE, /derivedThroatPointFromDisplay|drawDerivedNeck/);
  // it is not a verified index, so it can never be added
  assert.equal([...OD.VERIFIED_OVERLAY_INDICES].some(i => typeof i !== 'number'), false);
});

// 11 — Rotation transform applies equally to image and overlay.
test('11: overlay display model uses the SAME rotation transform as the image', () => {
  const e = overlayBundle().entries[0]; // rotationDegrees 90, mirrored false
  const m = AWB.overlayDisplayModel(e);
  assert.equal(m.transformCss, AWB.displayTransform(e).css);
  assert.equal(m.rotateDeg, 90);
  assert.match(m.transformCss, /rotate\(90deg\)/);
});

// 12 — Mirroring transform applies equally.
test('12: overlay display model uses the SAME mirror transform as the image', () => {
  const e = overlayBundle().entries[1]; // rotationDegrees 270, mirrored true
  const m = AWB.overlayDisplayModel(e);
  assert.equal(m.transformCss, AWB.displayTransform(e).css);
  assert.equal(m.mirrored, true);
  assert.match(m.transformCss, /scaleX\(-1\)/);
  assert.match(m.transformCss, /rotate\(270deg\)/);
});

// 13 — Overlay coordinates stay bounded to image display where appropriate.
test('13: the synthetic overlay points are inside the raw image frame; viewBox matches image size', () => {
  const e = overlayBundle().entries[0];
  assert.equal(AWB.overlayPointsInImageBounds(e), true);
  const m = AWB.overlayDisplayModel(e);
  assert.deepEqual(m.viewBox, { x: 0, y: 0, w: 64, h: 48 });
  assert.equal(OD.pointInImageBounds(e.overlayData, e.overlayData.points[0]), true);
});

// 14 — Missing image disables overlay rendering.
test('14: an entry without a renderable image never yields an overlay, even with overlay data', () => {
  const b = overlayBundle();
  b.entries[0].rawImagePayload = null;
  assert.equal(AWB.imageRenderable(b.entries[0]), false);
  assert.equal(AWB.overlayAvailable(b.entries[0]), false);
  assert.equal(AWB.overlayDisplayModel(b.entries[0]), null);
});

// 15 & 16 — HairState / AnnotationStatus defaults remain UNKNOWN.
test('15+16: annotation defaults are untouched by the overlay feature', () => {
  const d = AWB.defaultRegionLabel();
  assert.equal(d.hairState, 'UNKNOWN');
  assert.equal(d.annotationStatus, 'UNKNOWN');
  const st = AWB.initAnnotationState(overlayBundle());
  for (const obs of Object.values(st.byEntry)) for (const l of Object.values(obs)) {
    assert.equal(l.hairState, 'UNKNOWN');
    assert.equal(l.annotationStatus, 'UNKNOWN');
  }
});

// 17 — Enabling overlay never changes an annotation.
test('17: toggling the geometry guide does not alter any region label', () => {
  const b = overlayBundle();
  const id = b.entries[0].sourceScanObservationId;
  let st = AWB.initAnnotationState(b);
  st = AWB.setRegionLabel(st, id, 'CHIN_CENTER', { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  const before = JSON.stringify(st.byEntry);
  st = AWB.setGeometryGuide(st, true);
  st = AWB.setGeometryGuide(st, false);
  assert.equal(JSON.stringify(st.byEntry), before);
  assert.equal(st.byEntry[id].CHIN_CENTER.hairState, 'BEARD_CONFIRMED');
});

// 18 — Export remains MANUAL_GROUND_TRUTH.
test('18: export sourceMethod is still MANUAL_GROUND_TRUTH with the overlay feature present', () => {
  const b = overlayBundle();
  const exp = AWB.buildExport(b, AWB.initAnnotationState(b));
  assert.equal(exp.sourceMethod, 'MANUAL_GROUND_TRUTH');
  assert.ok(exp.labels.every(l => l.sourceMethod === 'MANUAL_GROUND_TRUTH'));
  assert.equal(AWB.validateExport(exp, b).ok, true);
});

// 19 — Export contains no raw image payload.
test('19: export JSON carries no raw image payload', () => {
  const b = overlayBundle();
  const exp = AWB.buildExport(b, AWB.initAnnotationState(b));
  const json = JSON.stringify(exp);
  for (const bad of ['rawImagePayload', 'base64', 'data:image', 'iVBOR']) assert.equal(json.includes(bad), false);
});

// 20 — Export does not contain geometry-guide claims.
test('20: export carries no overlay / geometry-guide / landmark fields', () => {
  const b = overlayBundle();
  let st = AWB.initAnnotationState(b);
  st = AWB.setGeometryGuide(st, true);
  st = AWB.setRegionLabel(st, b.entries[0].sourceScanObservationId, 'CHIN_CENTER', { hairState: 'NON_BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  const exp = AWB.buildExport(b, st);
  const json = JSON.stringify(exp);
  for (const bad of ['overlayData', 'geometryGuide', 'landmark', 'overlayPoints', 'jawChinRail']) {
    assert.equal(json.toLowerCase().includes(bad.toLowerCase()), false, 'export must not contain ' + bad);
  }
  // labels keep exactly the BS1-F shape, plus BI-1W's additive dual-channel / raw-identity fields
  // (surfaceObservability, identityMode, rawObservationId, adapterRetained) and BI-2F1's additive
  // evaluation-region-identity / entry-lock-lineage fields (evaluationRegionId, entryLocked,
  // entryLockFingerprint, entryRevision, entryBasedOnFingerprint, entryBasedOnRevision) — schema
  // grows only by adding keys, never by renaming or removing any historical one.
  for (const l of exp.labels) {
    assert.deepEqual(Object.keys(l).sort(), [
      'adapterRetained', 'anatomicalRegion', 'annotationConfidence', 'annotationStatus',
      'entryBasedOnFingerprint', 'entryBasedOnRevision', 'entryLockFingerprint', 'entryLocked',
      'entryRevision', 'evaluationRegionId',
      'hairState', 'identityMode', 'imageRef', 'labelId', 'nativeFrameTimestampNs', 'notes',
      'observedPoseRegion', 'poseId', 'rawObservationId', 'revision', 'scanSessionId',
      'sourceMethod', 'sourceScanObservationId', 'surfaceObservability', 'syncStatus'
    ]);
  }
});

// 21 — Autosave still contains no raw image (and no coordinates).
test('21: autosave keeps only the geometry-guide boolean — no pixels, no coordinates', () => {
  const b = overlayBundle();
  let st = AWB.initAnnotationState(b);
  st = AWB.setGeometryGuide(st, true);
  const save = AWB.buildAutosavePayload(b, st);
  assert.equal(save.geometryGuide, true);
  const json = JSON.stringify(save);
  for (const bad of ['rawImagePayload', 'base64', 'data:image', 'iVBOR', 'overlayData', '"points"', 'jawChinRail']) {
    assert.equal(json.includes(bad), false, 'autosave must not contain ' + bad);
  }
  // round-trips through restore
  const res = AWB.restoreFromAutosave(save, b);
  assert.equal(res.ok, true);
  assert.equal(res.state.geometryGuide, true);
});

// 22 — Existing BS1-H behaviour: bundles with AND without overlay data both validate.
test('22: validateBundle still accepts a v1 bundle with no overlay data AND one that carries it', () => {
  assert.equal(AWB.validateBundle(plainBundle()).ok, true);
  assert.equal(AWB.validateBundle(overlayBundle()).ok, true);
  // fingerprint is identity-only and unaffected by overlayData presence
  const b1 = overlayBundle();
  const b2 = overlayBundle();
  delete b2.entries[0].overlayData;
  assert.equal(AWB.bundleFingerprint(b1), AWB.bundleFingerprint(b2));
});

// 23 — Overlay data identity must match its entry (fail closed).
test('23: overlay data whose identity does not match the entry is treated as unavailable', () => {
  const b = overlayBundle();
  b.entries[0].overlayData = { ...b.entries[0].overlayData, sourceScanObservationId: 'someone-else' };
  assert.equal(AWB.overlayAvailable(b.entries[0]), false);
  assert.throws(() => OD.attachOverlayData(b.entries[1], b.entries[0].overlayData), /mismatch/);
});

// 24 — Overlay carries no semantic meaning (contract refuses semantic keys).
test('24: the overlay contract refuses any hair-state / beard / neckline field', () => {
  assert.throws(() => OD.makeOverlayData({
    sourceScanObservationId: 'x', imageRef: 'x:ref', nativeFrameTimestampNs: 1, space: 'IMAGE',
    hairState: 'BEARD_CONFIRMED', points: [{ index: 152, x: 1, y: 1 }]
  }), /semantic key/);
  assert.throws(() => OD.makeOverlayData({
    sourceScanObservationId: 'x', imageRef: 'x:ref', nativeFrameTimestampNs: 1, space: 'IMAGE',
    points: [{ index: 152, x: 1, y: 1, beardLine: true }]
  }), /semantic key/);
});

// 25 — CAPTURE_NORMALIZED coordinates are refused, never reinterpreted as pixels.
test('25: non-IMAGE coordinate space is refused', () => {
  assert.throws(() => OD.makeOverlayData({
    sourceScanObservationId: 'x', space: 'CAPTURE_NORMALIZED',
    points: [{ index: 152, x: 0.5, y: 0.5 }]
  }), /space must be "IMAGE"/);
  assert.equal(OD.overlayDataFromKeyframeLandmarks({
    space: 'CAPTURE_NORMALIZED', landmarks2D: new Array(468).fill({ x: 0.5, y: 0.5 })
  }), null);
});

// 26 — overlayDataFromKeyframeLandmarks extracts only verified indices, never fabricates.
test('26: a BS1-I-style resolver extracts only present verified indices and invents nothing', () => {
  const lm = new Array(468).fill(null).map(() => ({ x: NaN, y: NaN }));
  lm[152] = { x: 30, y: 40 }; lm[172] = { x: 10, y: 20 }; lm[17] = { x: 30, y: 35 };
  const od = OD.overlayDataFromKeyframeLandmarks({
    sourceScanObservationId: 'k', imageRef: 'k:ref', nativeFrameTimestampNs: 5,
    space: 'IMAGE', imageWidth: 64, imageHeight: 48, rotationDegrees: 90, mirrored: false,
    landmarks2D: lm
  });
  assert.equal(od.points.length, 3);
  assert.deepEqual(od.points.map(p => p.index).sort((a, b) => a - b), [17, 152, 172]);
  assert.ok(od.points.every(p => OD.isVerifiedOverlayIndex(p.index)));
});

// 27 — attachOverlayData is pure and identity-checked.
test('27: attachOverlayData returns a frozen copy and never mutates the entry', () => {
  const b = overlayBundle();
  const plainEntry = { ...b.entries[2] }; // no overlayData
  const od = OD.makeOverlayData({
    sourceScanObservationId: plainEntry.sourceScanObservationId, imageRef: plainEntry.imageRef,
    nativeFrameTimestampNs: plainEntry.nativeFrameTimestampNs, space: 'IMAGE',
    imageWidth: 64, imageHeight: 48, points: [{ index: 152, x: 30, y: 40, group: 'jaw-chin' }]
  });
  const withOd = OD.attachOverlayData(plainEntry, od);
  assert.equal('overlayData' in plainEntry, false);
  assert.equal(withOd.overlayData, od);
  assert.equal(AWB.overlayAvailable(withOd), true);
});

// ===========================================================================
// BS1-H2.1 — strict exact-keyframe identity + display-metadata consistency +
// group membership, exercised on the DIRECT JSON-load path
// (JSON bundle -> AWB.validateBundle -> AWB.overlayAvailable), not only attachOverlayData.
// ===========================================================================

// helper: a fixture entry that HAS verified overlay data, patched via plain object spread
// exactly as a hand-edited / malformed bundle JSON would arrive.
const patchedEntry0 = (patch) => {
  const b = overlayBundle();
  b.entries[0].overlayData = { ...b.entries[0].overlayData, ...patch };
  return b.entries[0];
};

// 28 — correct sourceScanObservationId + WRONG imageRef -> overlay unavailable.
test('28: direct-load overlay with a matching obs id but a different imageRef is unavailable', () => {
  const e = patchedEntry0({ imageRef: 'synthetic:front:img:0:ts9999' });
  assert.equal(AWB.overlayAvailable(e), false);
  assert.match(AWB.overlayUnavailableReason(e), /imageRef mismatch/);
});

// 29 — correct sourceScanObservationId + WRONG nativeFrameTimestampNs -> unavailable.
test('29: direct-load overlay with a matching obs id but a different timestamp is unavailable', () => {
  const e = patchedEntry0({ nativeFrameTimestampNs: 1000 + 1 });
  assert.equal(AWB.overlayAvailable(e), false);
  assert.match(AWB.overlayUnavailableReason(e), /nativeFrameTimestampNs mismatch/);
});

// 30 & 31 — a required exact-keyframe identity field absent on the overlay data -> fail closed.
test('30+31: overlay data missing imageRef or nativeFrameTimestampNs fails closed (no guessing)', () => {
  const noRef = patchedEntry0({ imageRef: undefined });
  delete noRef.overlayData.imageRef;
  assert.equal(AWB.overlayAvailable(noRef), false);
  assert.match(AWB.overlayUnavailableReason(noRef), /imageRef missing/);

  const noTs = patchedEntry0({ nativeFrameTimestampNs: undefined });
  delete noTs.overlayData.nativeFrameTimestampNs;
  assert.equal(AWB.overlayAvailable(noTs), false);
  assert.match(AWB.overlayUnavailableReason(noTs), /nativeFrameTimestampNs missing/);
});

// 32 — full identity match -> available (baseline).
test('32: an unpatched fixture entry with full identity + consistent metadata is available', () => {
  const b = overlayBundle();
  assert.equal(AWB.overlayUnavailableReason(b.entries[0]), null);
  assert.equal(AWB.overlayAvailable(b.entries[0]), true);
  assert.equal(AWB.overlayAvailable(b.entries[1]), true);
});

// 33–36 — a concrete display-metadata contradiction (both sides present) -> unavailable.
test('33: conflicting imageWidth (both sides present) makes the overlay unavailable', () => {
  const e = patchedEntry0({ imageWidth: 65 });
  assert.equal(AWB.overlayAvailable(e), false);
  assert.match(AWB.overlayUnavailableReason(e), /imageWidth contradiction/);
});
test('34: conflicting imageHeight (both sides present) makes the overlay unavailable', () => {
  const e = patchedEntry0({ imageHeight: 47 });
  assert.equal(AWB.overlayAvailable(e), false);
  assert.match(AWB.overlayUnavailableReason(e), /imageHeight contradiction/);
});
test('35: conflicting rotationDegrees (both sides present) makes the overlay unavailable', () => {
  const e = patchedEntry0({ rotationDegrees: 270 }); // entry is 90
  assert.equal(AWB.overlayAvailable(e), false);
  assert.match(AWB.overlayUnavailableReason(e), /rotationDegrees contradiction/);
});
test('36: conflicting mirrored (both sides present) makes the overlay unavailable', () => {
  const e = patchedEntry0({ mirrored: true }); // entry is false
  assert.equal(AWB.overlayAvailable(e), false);
  assert.match(AWB.overlayUnavailableReason(e), /mirrored contradiction/);
});

// 37 — rotationDegrees that is equal MOD 360 is NOT a contradiction.
test('37: rotationDegrees equal mod 360 (90 vs 450) is accepted', () => {
  const e = patchedEntry0({ rotationDegrees: 450 });
  assert.equal(AWB.overlayAvailable(e), true);
});

// 38 — a display-metadata field absent on the overlay data (present on entry) is fine.
test('38: overlay data omitting an optional display-metadata field stays available', () => {
  const e = patchedEntry0({ rotationDegrees: null, mirrored: null, imageWidth: null });
  assert.equal(AWB.overlayAvailable(e), true);
});

// 39 & 40 — makeOverlayData rejects a verified index labelled with the WRONG group.
test('39: makeOverlayData rejects a jaw/chin index (152) labelled "mouth-ref"', () => {
  assert.throws(() => OD.makeOverlayData({
    sourceScanObservationId: 'x', imageRef: 'x:ref', nativeFrameTimestampNs: 1, space: 'IMAGE',
    points: [{ index: 152, x: 1, y: 1, group: 'mouth-ref' }]
  }), /index 152 is not a member of group "mouth-ref"/);
});
test('40: makeOverlayData rejects a mouth-reference index (17) labelled "cheek"', () => {
  assert.throws(() => OD.makeOverlayData({
    sourceScanObservationId: 'x', imageRef: 'x:ref', nativeFrameTimestampNs: 1, space: 'IMAGE',
    points: [{ index: 17, x: 1, y: 1, group: 'cheek' }]
  }), /index 17 is not a member of group "cheek"/);
  assert.equal(OD.overlayPointGroupValid(17, 'cheek'), false);
  assert.equal(AWB.overlayPointGroupValid(17, 'cheek'), false);
});

// 41 — direct JSON load: a mislabelled point makes the overlay unavailable (not silently fixed).
test('41: direct-load overlay with a point in the wrong group is unavailable, never reassigned', () => {
  const b = overlayBundle();
  const od = b.entries[0].overlayData;
  b.entries[0].overlayData = {
    ...od,
    points: od.points.map((p, i) => i === 0 ? { ...p, group: 'mouth-ref' } : p) // point 0 is index 152 (jaw-chin)
  };
  assert.equal(AWB.overlayAvailable(b.entries[0]), false);
  assert.match(AWB.overlayUnavailableReason(b.entries[0]), /not valid for group mouth-ref/);
});

// 42 — correct group membership + an ungrouped named anatomy anchor remain accepted.
test('42: correct group membership is accepted; an ungrouped verified anchor (index 8) is accepted', () => {
  assert.equal(OD.overlayPointGroupValid(152, 'jaw-chin'), true);
  assert.equal(OD.overlayPointGroupValid(234, 'cheek'), true);
  assert.equal(OD.overlayPointGroupValid(291, 'mouth-ref'), true);
  const ok = OD.makeOverlayData({
    sourceScanObservationId: 'x', imageRef: 'x:ref', nativeFrameTimestampNs: 1, space: 'IMAGE',
    points: [{ index: 152, x: 1, y: 1, group: 'jaw-chin' }, { index: 8, x: 2, y: 2 }] // 8 = midline, ungrouped
  });
  assert.equal(ok.points.length, 2);
  assert.equal(ok.points[1].group, null);
});

// 43 — makeOverlayData / attachOverlayData now REQUIRE the exact-keyframe identity fields.
test('43: makeOverlayData requires imageRef + nativeFrameTimestampNs; attachOverlayData enforces exact identity', () => {
  assert.throws(() => OD.makeOverlayData({
    sourceScanObservationId: 'x', nativeFrameTimestampNs: 1, space: 'IMAGE',
    points: [{ index: 152, x: 1, y: 1 }]
  }), /imageRef is required/);
  assert.throws(() => OD.makeOverlayData({
    sourceScanObservationId: 'x', imageRef: 'x:ref', space: 'IMAGE',
    points: [{ index: 152, x: 1, y: 1 }]
  }), /nativeFrameTimestampNs is required/);

  const b = overlayBundle();
  const idMatch = OD.overlayDataMatchesEntryIdentity(b.entries[0], b.entries[0].overlayData);
  assert.equal(idMatch.ok, true);
  assert.throws(() => OD.attachOverlayData(b.entries[1], b.entries[0].overlayData), /mismatch/);
});

// 44 — Part 4 items 13 & 14: the shipped synthetic bundle stays valid; a plain BS1-G bundle
// still validates with the Geometry Guide simply unavailable.
test('44: shipped synthetic overlay bundle stays valid; plain BS1-G bundle -> guide unavailable', () => {
  const b = overlayBundle();
  assert.equal(AWB.validateBundle(b).ok, true);
  assert.equal(AWB.overlayAvailable(b.entries[0]), true);
  assert.equal(AWB.overlayAvailable(b.entries[1]), true);
  assert.equal(AWB.overlayAvailable(b.entries[2]), false); // chin-up: no overlayData

  const p = plainBundle();
  assert.equal(AWB.validateBundle(p).ok, true);
  assert.equal(AWB.overlayAvailable(p.entries[0]), false);
  assert.match(AWB.overlayUnavailableReason(p.entries[0]), /no overlayData/);
});

// ===========================================================================
// BS1-H2.1.1 — malformed point elements must FAIL CLOSED, never throw
// (direct JSON-load path: JSON -> validateBundle -> overlayAvailable).
// ===========================================================================

// an otherwise fully-valid exact-identity overlay entry with a hostile `points` array.
const entry0WithPoints = (points) => {
  const b = overlayBundle();
  b.entries[0].overlayData = { ...b.entries[0].overlayData, points };
  return b.entries[0];
};
// assert every render-validation entry point fails closed WITHOUT throwing.
const assertFailsClosed = (points, reasonRe) => {
  const e = entry0WithPoints(points);
  for (const [name, fn] of [
    ['OD.overlayDataUnavailableReason', () => OD.overlayDataUnavailableReason(e)],
    ['OD.overlayDataValid', () => OD.overlayDataValid(e)],
    ['AWB.overlayUnavailableReason', () => AWB.overlayUnavailableReason(e)],
    ['AWB.overlayAvailable', () => AWB.overlayAvailable(e)]
  ]) {
    let v; assert.doesNotThrow(() => { v = fn(); }, name + ' threw on points=' + JSON.stringify(points));
    if (name.endsWith('Reason')) { assert.notEqual(v, null, name); if (reasonRe) assert.match(v, reasonRe, name); }
    else assert.equal(v, name === 'OD.overlayDataValid' ? false : false, name); // both -> falsey "not available"
  }
};

// 45 (Part 3 #1) — points:[null] (also the exact shape a sparse array serializes to in JSON).
test('45: points:[null] -> overlay unavailable, no throw (the reported defect)', () => {
  assertFailsClosed([null], /point object/);
  // a JSON.stringify of a sparse array [ , ] yields [null] — that real shape is covered here.
  assert.deepEqual(JSON.parse('[null]'), [null]);
});

// 46 (Part 3 #2,#3) — primitive point elements.
test('46: primitive point elements (number, string) -> unavailable, no throw', () => {
  assertFailsClosed([42], /point object/);
  assertFailsClosed(['bad'], /point object/);
  assertFailsClosed([true], /point object/);
});

// 47 (Part 3 #4) — an array where a point object is required.
test('47: an array element (points:[[]]) -> unavailable, no throw', () => {
  assertFailsClosed([[]], /point object/);
  assertFailsClosed([[152, 1, 2]], /point object/);
});

// 48 (Part 3 #5,#6,#7) — empty / missing-coordinate point objects.
test('48: {} / missing x / missing y -> unavailable via "point coordinate", no throw', () => {
  assertFailsClosed([{}], /point coordinate/);
  assertFailsClosed([{ index: 152, y: 1, group: 'jaw-chin' }], /point coordinate/);
  assertFailsClosed([{ index: 152, x: 1, group: 'jaw-chin' }], /point coordinate/);
});

// 49 (Part 3 #8,#9) — non-finite coordinates.
test('49: non-finite x / y (null, NaN, Infinity, string) -> unavailable, no throw', () => {
  assertFailsClosed([{ index: 152, x: null, y: 1, group: 'jaw-chin' }], /point coordinate/);
  assertFailsClosed([{ index: 152, x: 1, y: NaN, group: 'jaw-chin' }], /point coordinate/);
  assertFailsClosed([{ index: 152, x: Infinity, y: 1, group: 'jaw-chin' }], /point coordinate/);
  assertFailsClosed([{ index: 152, x: '1', y: 2, group: 'jaw-chin' }], /point coordinate/);
});

// 50 — a hostile element MIXED with a valid one still fails the whole overlay closed.
test('50: one malformed element among valid ones fails the whole overlay closed (never partial)', () => {
  assertFailsClosed([{ index: 152, x: 1, y: 2, group: 'jaw-chin' }, null], /point object/);
});

// 51 (Part 3 #10) — a well-formed points array is still accepted (regression).
test('51: a valid point array still renders (no regression from the null guard)', () => {
  const e = entry0WithPoints([{ index: 152, x: 10, y: 20, group: 'jaw-chin' }, { index: 8, x: 5, y: 5 }]);
  assert.equal(OD.overlayDataUnavailableReason(e), null);
  assert.equal(OD.overlayDataValid(e), true);
  assert.equal(AWB.overlayUnavailableReason(e), null);
  assert.equal(AWB.overlayAvailable(e), true);
  assert.equal(AWB.overlayDisplayModel(e).points.length, 2);
  // and the shipped synthetic fixture (unpatched) is unaffected
  const b = overlayBundle();
  assert.equal(AWB.overlayAvailable(b.entries[0]), true);
  assert.equal(AWB.overlayAvailable(b.entries[1]), true);
});

// 52 — BI-1E finding: a real session produced an overlay that passes every identity/schema/
// group check (overlayAvailable stays true, matching its documented "diagnostic only, out-of-
// frame is allowed" contract) yet whose points land outside the image frame. The workbench's
// region-highlight feature must not treat that as trustworthy: overlayPointsInImageBounds is the
// pre-existing diagnostic it composes with overlayAvailable to decide whether to actually draw.
test('52: points outside the image frame stay overlayAvailable=true (unchanged contract) but overlayPointsInImageBounds=false', () => {
  const e = entry0WithPoints([
    { index: 152, x: -110, y: 291, group: 'jaw-chin' }, // real out-of-frame shape found in BI-1E
    { index: 172, x: 56, y: 278, group: 'jaw-chin' }
  ]);
  assert.equal(AWB.overlayAvailable(e), true, 'the render-validation gate contract is unchanged');
  assert.equal(AWB.overlayPointsInImageBounds(e), false);
  // this is the exact composition the workbench UI uses to decide whether a region highlight
  // (or the manual Geometry Guide toggle) may actually be shown as trustworthy.
  const uiTrustworthy = AWB.overlayAvailable(e) && AWB.overlayPointsInImageBounds(e) !== false;
  assert.equal(uiTrustworthy, false);
});
