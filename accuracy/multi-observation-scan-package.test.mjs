// Stage BS1-B — pure unit tests for the synchronized multi-observation scan package.
// Node built-in runner (node --test). Zero dependencies.

import test from 'node:test';
import assert from 'node:assert/strict';

import { SCAN_POSES, HairState, ObservationMethod } from './beard-surface-core.mjs';
import {
  SCHEMA_VERSION,
  SOURCE_ARCHITECTURE_VERSION,
  A6_DEFAULT_CAPS,
  SyncStatus,
  RetentionStatus,
  RejectionReason,
  SourceTier,
  ObservationPayloadKind,
  RawImageLifecycle,
  makeObservationQuality,
  combineObservationQuality,
  makeScanObservation,
  deriveSelfSyncStatus,
  makeSynchronizedPair,
  diversitySummary,
  filterValidObservations,
  rankObservations,
  selectRetained,
  makePoseObservationPackage,
  makeMultiObservationScanPackage,
  emptyScanPackage,
  summarizeScanPackage,
  diagnosticString,
  serialize,
  deserialize,
  describeBS1AAdapterBoundary
} from './multi-observation-scan-package.mjs';

let seq = 0;
const geomObs = (poseId, over = {}) => makeScanObservation({
  observationId: `g${seq++}`,
  poseId,
  nativeFrameTimestampNs: 1_000_000 + seq * 1000,
  monotonicMs: seq * 16,
  faceLocal3D: 468,
  landmarks2D: 468,
  transformationMatrix: new Array(16).fill(0),
  yawDeg: 0, pitchDeg: 0, rollDeg: 0,
  distanceMetric: { faceCameraZ: 0.35 },
  sourceTier: SourceTier.TIER_A_GEOMETRY,
  ...over
});
const keyframeObs = (poseId, over = {}) => makeScanObservation({
  observationId: `k${seq++}`,
  poseId,
  nativeFrameTimestampNs: 2_000_000 + seq * 1000,
  monotonicMs: seq * 16,
  imageRef: { ref: `kf-${poseId}-${seq}`, format: 'jpeg', width: 640, height: 480, rotationDegrees: 90, mirrored: false },
  faceLocal3D: 468,
  landmarks2D: 468,
  cameraIntrinsics: { fx: 500, fy: 500, cx: 320, cy: 240, imageWidth: 640, imageHeight: 480, space: 'IMAGE' },
  imageSpaceViewModelMatrix: new Array(16).fill(0),
  yawDeg: 0, pitchDeg: 0, rollDeg: 0,
  nativeSpatialKeyframe: true,
  coherenceStatus: 'VERIFIED_EXACT',
  sourceTier: SourceTier.TIER_B_IMAGE_KEYFRAME,
  ...over
});

// 1 — One visible pose can contain multiple hidden observations.
test('one visible pose can contain multiple hidden observations', () => {
  const many = Array.from({ length: 12 }, (_, i) => geomObs('front', { yawDeg: i }));
  const p = makePoseObservationPackage({ poseId: 'front', retainedGeometryObservations: many });
  assert.equal(p.retainedGeometryObservations.length, 12);
  assert.equal(p.selectionSummary.geometryRetainedCount, 12);
});

// 2 — Eight image observations are representable for one pose.
test('eight image observations are representable for one pose', () => {
  const imgs = Array.from({ length: 8 }, (_, i) => keyframeObs('right-45', { yawDeg: 20 + i }));
  const p = makePoseObservationPackage({ poseId: 'right-45', retainedImageObservations: imgs });
  assert.equal(p.retainedImageObservations.length, 8);
  assert.equal(p.selectionSummary.imageRetainedCount, 8);
  assert.equal(p.selectionSummary.capReachedImage, true); // default imagePerPose === 8
  assert.equal(p.caps.imagePerPose, 8);
});

// 3 — Forty geometry observations are representable for one pose.
test('forty geometry observations are representable for one pose', () => {
  const many = Array.from({ length: 40 }, (_, i) => geomObs('left-profile', { yawDeg: -48 + i * 0.1 }));
  const p = makePoseObservationPackage({ poseId: 'left-profile', retainedGeometryObservations: many });
  assert.equal(p.retainedGeometryObservations.length, 40);
  assert.equal(p.selectionSummary.capReachedGeometry, true); // default geometryPerPose === 40
});

// 4 — Geometry-only observations are valid.
test('geometry-only observation is valid and typed', () => {
  const o = geomObs('front');
  assert.equal(o.payloadKind, ObservationPayloadKind.GEOMETRY_ONLY);
  assert.equal(o.imageRef, null);
  assert.equal(deriveSelfSyncStatus(o), SyncStatus.UNPAIRED);
});

// 5 — Image+geometry synchronized observation is valid.
test('image+geometry synchronized observation is valid', () => {
  const o = keyframeObs('front');
  assert.equal(o.payloadKind, ObservationPayloadKind.IMAGE_AND_GEOMETRY);
  assert.equal(o.syncStatus, SyncStatus.EXACT_SYNCHRONIZED);
  assert.equal(o.sourceKind, ObservationMethod.LANDMARK_GEOMETRY);
});

// 6 — Exact synchronization survives packaging.
test('exact synchronization survives packaging', () => {
  const kf = keyframeObs('chin-up');
  const pair = makeSynchronizedPair(kf, kf);
  assert.equal(pair.syncStatus, SyncStatus.EXACT_SYNCHRONIZED);
  const p = makePoseObservationPackage({
    poseId: 'chin-up',
    retainedImageObservations: [kf],
    synchronizedObservationPairs: [pair]
  });
  const pkg = makeMultiObservationScanPackage({ posePackages: { 'chin-up': p } });
  assert.equal(pkg.overallQualitySummary.posesWithExactSync, 1);
  assert.equal(summarizeScanPackage(pkg).perPose['chin-up'].syncExactCount, 1);
});

// 7 — Unpaired observation remains explicitly unpaired.
test('unpaired observation remains explicitly unpaired', () => {
  assert.equal(deriveSelfSyncStatus(geomObs('front')), SyncStatus.UNPAIRED);
  const rejectedImg = keyframeObs('front', { coherenceStatus: 'REJECTED_UNMATCHED' });
  assert.equal(rejectedImg.syncStatus, SyncStatus.UNPAIRED);
  const g = geomObs('front', { nativeFrameTimestampNs: 10 });
  const i = keyframeObs('front', { nativeFrameTimestampNs: 9_999_999, coherenceStatus: null, nativeSpatialKeyframe: false });
  assert.equal(makeSynchronizedPair(i, g, { toleranceNs: 100 }).syncStatus, SyncStatus.UNPAIRED);
});

// 8 — Candidate and retained sets are distinct.
test('candidate and retained sets are distinct', () => {
  const cands = Array.from({ length: 6 }, (_, i) => geomObs('front', { yawDeg: i }));
  const { retained, rejected } = selectRetained(cands, { maxRetained: 3 });
  const p = makePoseObservationPackage({
    poseId: 'front',
    candidateGeometryObservations: cands,
    retainedGeometryObservations: retained,
    rejectedObservations: rejected
  });
  assert.equal(p.selectionSummary.geometryCandidateCount, 6);
  assert.equal(p.selectionSummary.geometryRetainedCount, 3);
  assert.equal(p.selectionSummary.rejectedCount, 3);
});

// 9 — Cap enforcement is deterministic.
test('cap enforcement is deterministic', () => {
  const cands = Array.from({ length: 5 }, (_, i) => geomObs('front', { observationId: `c${i}`, yawDeg: i * 10, nativeFrameTimestampNs: 100 + i }));
  const a = selectRetained(cands, { maxRetained: 2 });
  const b = selectRetained(cands, { maxRetained: 2 });
  assert.equal(a.retained.length, 2);
  assert.deepEqual(a.retained.map(o => o.observationId), b.retained.map(o => o.observationId));
  assert.deepEqual(a.rejected.map(o => o.rejectionReason), [RejectionReason.CAP_REACHED, RejectionReason.CAP_REACHED, RejectionReason.CAP_REACHED]);
});

// 10 — Duplicate observation IDs / timestamps handled deterministically.
test('duplicate ids and timestamps rank deterministically', () => {
  const dup1 = geomObs('front', { observationId: 'same', nativeFrameTimestampNs: 500 });
  const dup2 = geomObs('front', { observationId: 'same', nativeFrameTimestampNs: 500 });
  const r1 = rankObservations([dup1, dup2]).map(o => o.timestamp.nativeFrameTimestampNs);
  const r2 = rankObservations([dup2, dup1]).map(o => o.timestamp.nativeFrameTimestampNs);
  assert.deepEqual(r1, r2); // stable, total order
});

// 11 — Low-quality / invalid observation can be rejected without deleting provenance.
test('rejection preserves provenance', () => {
  const good = keyframeObs('front', { yawDeg: 0, trackingQuality: { trackingConfidence: 0.9 } });
  const weak = keyframeObs('front', { yawDeg: 0.2, trackingQuality: { trackingConfidence: 0.1 } });
  const { retained, rejected } = selectRetained([good, weak], { minQuality: 0.5, minYawSeparationDeg: 5 });
  assert.equal(retained.length, 1);
  assert.equal(retained[0].observationId, good.observationId);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].rejectionReason, RejectionReason.LOW_TRACKING_QUALITY);
  assert.equal(rejected[0].retentionStatus, RetentionStatus.REJECTED);
  assert.equal(rejected[0].poseId, 'front');           // provenance kept
  assert.equal(rejected[0].sourceTier, SourceTier.TIER_B_IMAGE_KEYFRAME);
  assert.equal(rejected[0].imageRef.ref, weak.imageRef.ref);
});

// 12 — Front-only observations remain Front provenance.
test('front-only observations remain front provenance', () => {
  const obs = [geomObs('front'), geomObs('front'), keyframeObs('front')];
  const p = makePoseObservationPackage({ poseId: 'front', retainedGeometryObservations: obs.slice(0, 2), retainedImageObservations: [obs[2]] });
  for (const o of [...p.retainedGeometryObservations, ...p.retainedImageObservations]) {
    assert.equal(o.poseId, 'front');
  }
});

// 13 — Intermediate measured angle metadata survives.
test('intermediate measured angle metadata survives', () => {
  const t = makeScanObservation({
    observationId: 't1',
    poseId: 'right-45',
    observedPoseRegion: 'RIGHT45_TO_RIGHT_PROFILE',
    nativeFrameTimestampNs: 42,
    faceLocal3D: 468,
    yawDeg: 38.4, pitchDeg: -2.1, rollDeg: 1.0,
    sourceTier: SourceTier.TIER_A_GEOMETRY
  });
  assert.equal(t.observedPoseRegion, 'RIGHT45_TO_RIGHT_PROFILE');
  assert.equal(t.yawDeg, 38.4);
  assert.equal(t.poseId, 'right-45'); // formal association preserved alongside measured angle
});

// 14 — Multiple distinct yaw samples produce greater diversity than identical yaw.
test('distinct yaw samples are more diverse than identical yaw', () => {
  const spread = [geomObs('front', { yawDeg: 0 }), geomObs('front', { yawDeg: 10 }), geomObs('front', { yawDeg: 20 })];
  const same = [geomObs('front', { yawDeg: 0 }), geomObs('front', { yawDeg: 0 }), geomObs('front', { yawDeg: 0 })];
  const dSpread = diversitySummary(spread, { yawDeltaDeg: 4 });
  const dSame = diversitySummary(same, { yawDeltaDeg: 4 });
  assert.equal(dSpread.yawSpanDeg, 20);
  assert.equal(dSame.yawSpanDeg, 0);
  assert.equal(dSpread.independentViewCount, 3);
  assert.equal(dSame.independentViewCount, 1);
});

// 15 — Missing quality data does not fabricate a score.
test('missing quality data yields null, not a fabricated score', () => {
  assert.equal(combineObservationQuality({}), null);
  assert.equal(makeObservationQuality({}).combined, null);
  const o = geomObs('front'); // no quality parts
  const p = makePoseObservationPackage({ poseId: 'front', retainedGeometryObservations: [o] });
  assert.equal(p.qualitySummary.qualityKnownCount, 0);
  assert.equal(p.qualitySummary.qualityUnknownCount, 1);
  assert.equal(p.qualitySummary.minKnownQuality, null);
});

// 16 — Package summary counts are deterministic.
test('package summary counts are deterministic', () => {
  const p1 = makePoseObservationPackage({ poseId: 'front', retainedGeometryObservations: [geomObs('front'), geomObs('front')], retainedImageObservations: [keyframeObs('front')] });
  const p2 = makePoseObservationPackage({ poseId: 'right-45', retainedGeometryObservations: [geomObs('right-45')] });
  const pkg = makeMultiObservationScanPackage({ posePackages: { front: p1, 'right-45': p2 } });
  const a = summarizeScanPackage(pkg);
  const b = summarizeScanPackage(pkg);
  assert.deepEqual(a, b);
  assert.equal(a.overall.totalGeometryObservations, 3);
  assert.equal(a.overall.totalImageObservations, 1);
  assert.equal(a.overall.posesWithImages, 1);
  assert.equal(typeof diagnosticString(pkg), 'string');
});

// 17 — Empty scan package is valid.
test('empty scan package is valid and not production-ready', () => {
  const pkg = emptyScanPackage({ scanSessionId: 's1' });
  assert.equal(pkg.schemaVersion, SCHEMA_VERSION);
  assert.equal(pkg.sourceArchitectureVersion, SOURCE_ARCHITECTURE_VERSION);
  assert.equal(pkg.overallQualitySummary.poseCount, 0);
  assert.equal(pkg.overallQualitySummary.totalImageObservations, 0);
  assert.equal(pkg.overallQualitySummary.readyForBeardSurfaceProjection, 'NOT_EVALUATED');
});

// 18 — Raw image lifecycle defaults to transient / non-persistent.
test('raw image lifecycle defaults to transient', () => {
  const o = keyframeObs('front');
  assert.equal(o.rawImageLifecycle, RawImageLifecycle.TRANSIENT);
  const explicit = keyframeObs('front', { rawImageLifecycle: RawImageLifecycle.ELIGIBLE_FOR_DISCARD });
  assert.equal(explicit.rawImageLifecycle, RawImageLifecycle.ELIGIBLE_FOR_DISCARD);
});

// 19 — Schema version round-trip.
test('serialization round-trips and rejects unknown schema versions', () => {
  const p = makePoseObservationPackage({ poseId: 'front', retainedGeometryObservations: [geomObs('front')] });
  const pkg = makeMultiObservationScanPackage({ scanSessionId: 'abc', posePackages: { front: p } });
  const wire = serialize(pkg);
  assert.equal(wire.schemaVersion, SCHEMA_VERSION);
  const back = deserialize(wire);
  assert.equal(back.scanSessionId, 'abc');
  assert.deepEqual(back.overallQualitySummary, pkg.overallQualitySummary);
  assert.throws(() => deserialize({ ...wire, schemaVersion: 'multi-observation-scan-package/999' }), /unsupported schemaVersion/);
});

// 20 — BS1-A adapter boundary can be represented without importing runtime app code.
test('BS1-A adapter boundary is representable without runtime app code', () => {
  const b = describeBS1AAdapterBoundary();
  assert.equal(typeof b.pipeline, 'string');
  assert.match(b.pipeline, /MultiObservationScanPackage.*PersonalizedBeardSurface/);
  assert.equal(b.consumes, 'accuracy/multi-observation-scan-package.mjs');
  assert.match(b.produces, /accuracy\/beard-surface-core\.mjs/);
  assert.equal(b.fieldMapping.method, ObservationMethod.LANDMARK_GEOMETRY);
  assert.equal(b.fieldMapping.hairState.startsWith(HairState.UNKNOWN), true);
  // No app-runtime symbols anywhere in the descriptor.
  const json = JSON.stringify(b);
  for (const forbidden of ['window', 'document', 'BeardTrimAndroid', 'index.html', 'requestSpatialKeyframe']) {
    assert.equal(json.includes(forbidden), false, `descriptor must not reference ${forbidden}`);
  }
});

// --- supporting checks ---

test('scan pose ids are the BS1-A / A60 set', () => {
  assert.deepEqual([...SCAN_POSES], ['front', 'right-45', 'right-profile', 'left-45', 'left-profile', 'chin-up']);
});

test('unknown pose / tier / lifecycle rejected early', () => {
  assert.throws(() => makeScanObservation({ poseId: 'top-down', faceLocal3D: 1, nativeFrameTimestampNs: 1 }), /unknown poseId/);
  assert.throws(() => makeScanObservation({ poseId: 'front', sourceTier: 'TIER_C', faceLocal3D: 1, nativeFrameTimestampNs: 1 }), /unknown sourceTier/);
  assert.throws(() => makePoseObservationPackage({ poseId: 'nope' }), /unknown poseId/);
});

test('filterValidObservations drops observations with neither payload nor timestamp', () => {
  const noPayload = makeScanObservation({ observationId: 'x', poseId: 'front', nativeFrameTimestampNs: 1 });
  const noTime = makeScanObservation({ observationId: 'y', poseId: 'front', faceLocal3D: 468 });
  const ok = geomObs('front');
  assert.deepEqual(filterValidObservations([noPayload, noTime, ok]).map(o => o.observationId), [ok.observationId]);
});

test('caps are configurable and not hard-wired to 8 images / six photographs', () => {
  const p = makePoseObservationPackage({
    poseId: 'front',
    caps: { imagePerPose: 20 },
    retainedImageObservations: Array.from({ length: 12 }, () => keyframeObs('front'))
  });
  assert.equal(p.caps.imagePerPose, 20);
  assert.equal(p.selectionSummary.capReachedImage, false); // 12 < 20
  assert.equal(A6_DEFAULT_CAPS.imagePerPose, 8);           // verified A6 default preserved
});
