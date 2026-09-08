// Stage BS1-D — pure unit tests for the semantic evidence + cross-pose fusion foundation.
// Node built-in runner (node --test). Zero dependencies. Synthetic labels only — no model.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HairState, ObservationMethod, ObservationKind, CoordinateSpace } from './beard-surface-core.mjs';
import { SyncStatus, makeScanObservation, makePoseObservationPackage, makeMultiObservationScanPackage } from './multi-observation-scan-package.mjs';
import { fromA60Export } from './a6-scan-package-adapter.mjs';
import { SUPPORTED_REGIONS } from './beard-anatomy-map.mjs';
import { scanPackageToSurfaceObservations } from './scan-package-to-beard-surface.mjs';
import {
  RawImageLifecycle, ImageResolveStatus, imageResolverKey, resolveImageEvidence,
  advanceLifecycle, rawImagesRequiredAfterDerivation
} from './semantic-image-evidence.mjs';
import {
  makeSemanticHairObservation, semanticObservationsFromKeyframes,
  buildSemanticBeardSurfaceBundle, semanticSurfaceSummary, semanticDiagnosticString
} from './semantic-hair-evidence.mjs';

// ---- fixtures ----
function pts(overrides = {}) {
  const a = Array.from({ length: 468 }, (_, i) => ({ x: (i % 50) * 0.01, y: Math.floor(i / 50) * 0.01, z: (i % 7) * 0.005 }));
  for (const [k, v] of Object.entries(overrides)) a[Number(k)] = v;
  return a;
}
let ts = 5_000_000;
const g = (e = {}) => (ts += 1000, {
  nativeTs: ts, t: ts / 1000, yawDeg: 0, pitchDeg: 0, rollDeg: 0,
  faceCameraX: 0, faceCameraY: 0, faceCameraZ: 0.35, transformationMatrix: new Array(16).fill(0),
  landmarks2D: pts(), faceLocal3D: pts(), frameWidth: 1080, frameHeight: 1920, mirrored: true, coverageValid: true, ...e
});
const kf = (e = {}) => (ts += 1000, {
  nativeTs: ts, coherenceStatus: 'VERIFIED_EXACT', rejectReason: null,
  dataUrl: 'data:image/jpeg;base64,PIXELPIXELPIXEL', width: 640, height: 480, imageRotationDegrees: 90, imageMirrored: false,
  intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240, imageWidth: 640, imageHeight: 480, space: 'IMAGE' },
  landmarks2D: pts(), faceLocal3D: pts(), transformationMatrix: new Array(16).fill(0),
  imageSpaceViewModelMatrix: new Array(16).fill(0), yawDeg: 0, pitchDeg: 0, rollDeg: 0,
  faceCameraX: 0, faceCameraY: 0, faceCameraZ: 0.35, captureLatencyMs: 12, ...e
});
const a60 = (spec) => {
  const geometryObs = {}, imageKeyframes = {};
  for (const [p, s] of Object.entries(spec)) {
    geometryObs[p] = Array.from({ length: s.geom || 0 }, () => g());
    imageKeyframes[p] = Array.from({ length: s.img || 0 }, () => kf());
  }
  return { geometryObs, imageKeyframes };
};
const pkgOf = (spec) => fromA60Export(a60(spec)).scanPackage;
const geomObsOf = (scanPackage) => scanPackageToSurfaceObservations(scanPackage).surfaceObservations;
const anatomySupport = new Set(SUPPORTED_REGIONS);

// 1 — Resolver contract can represent RESOLVED (and never leaks pixels).
test('resolver contract represents RESOLVED and hands pixels only to the transient sink', () => {
  const key = imageResolverKey({ observationId: 'a60:front:img:0', imageRef: { ref: 'r' }, timestamp: { nativeFrameTimestampNs: 1 }, poseId: 'front', coherenceStatus: 'VERIFIED_EXACT' });
  let sink = null;
  const res = resolveImageEvidence(key, null, () => ({ status: 'RESOLVED', payload: 'RAWPIXELS', width: 640, height: 480 }), { onPayload: (p) => { sink = p; } });
  assert.equal(res.status, ImageResolveStatus.RESOLVED);
  assert.equal(res.payloadPresent, true);
  assert.equal(res.width, 640);
  assert.equal('payload' in res, false);            // descriptor never carries pixels
  assert.equal(sink, 'RAWPIXELS');                  // only the caller sink sees them
});

// 2 — NOT_FOUND / EXPIRED / thrown / no-resolver never throw.
test('resolver represents NOT_FOUND / EXPIRED / INVALID / UNSUPPORTED without throwing', () => {
  const k = imageResolverKey({});
  assert.equal(resolveImageEvidence(k, null, () => ({ status: 'NOT_FOUND' })).status, ImageResolveStatus.NOT_FOUND);
  assert.equal(resolveImageEvidence(k, null, () => ({ status: 'EXPIRED' })).status, ImageResolveStatus.EXPIRED);
  assert.equal(resolveImageEvidence(k, null, () => { throw new Error('boom'); }).status, ImageResolveStatus.INVALID);
  assert.equal(resolveImageEvidence(k, null, () => 42).status, ImageResolveStatus.INVALID);
  assert.equal(resolveImageEvidence(k, null, null).status, ImageResolveStatus.UNSUPPORTED);
});

// 3 — Raw image payload is not stored in BeardSurface.
test('no raw image payload lands in the PersonalizedBeardSurface', () => {
  const scanPackage = pkgOf({ front: { geom: 2, img: 2 } });
  const kfId = scanPackage.posePackages.front.retainedImageObservations[0].observationId;
  const bundle = buildSemanticBeardSurfaceBundle(scanPackage, geomObsOf(scanPackage),
    [{ scanObservationId: kfId, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }], { anatomySupport });
  const json = JSON.stringify(bundle.personalizedBeardSurface);
  for (const forbidden of ['PIXEL', 'base64', 'dataUrl', 'PIXELPIXELPIXEL']) assert.equal(json.includes(forbidden), false);
  assert.equal(typeof bundle.semanticObservations[0].imageRef, 'string');
});

// 4 — Derived semantic observation survives after image payload is absent.
test('derived semantic observation is self-sufficient without pixels', () => {
  const s = makeSemanticHairObservation({
    observationId: 'sem:x', anatomicalRegion: 'CHIN_CENTER', hairState: HairState.BEARD_CONFIRMED,
    poseId: 'front', syncStatus: SyncStatus.EXACT_SYNCHRONIZED, semanticConfidence: 0.7
  });
  assert.equal(s.hairState, HairState.BEARD_CONFIRMED);
  assert.equal(s.rawImageLifecycle, RawImageLifecycle.DERIVED_DATA_EXTRACTED);
  assert.equal(rawImagesRequiredAfterDerivation(), false);
  assert.equal(advanceLifecycle(RawImageLifecycle.DERIVED_DATA_EXTRACTED, RawImageLifecycle.ELIGIBLE_FOR_DISCARD).ok, true);
});

// 5 — Label referencing unknown image observation fails closed.
test('label referencing an unknown scan observation fails closed', () => {
  const scanPackage = pkgOf({ front: { img: 1 } });
  const r = semanticObservationsFromKeyframes(scanPackage, [{ scanObservationId: 'nope', anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }]);
  assert.equal(r.semanticObservations.length, 0);
  assert.equal(r.unsupportedSemanticLabels.length, 1);
  assert.match(r.unsupportedSemanticLabels[0].reason, /not found/);
});

// 6 — Label referencing geometry-only observation fails closed when image required.
test('label on a geometry-only observation fails closed when image is required', () => {
  const scanPackage = pkgOf({ front: { geom: 1 } });
  const gId = scanPackage.posePackages.front.retainedGeometryObservations[0].observationId;
  const r = semanticObservationsFromKeyframes(scanPackage, [{ scanObservationId: gId, anatomicalRegion: 'CHIN_CENTER', hairState: HairState.BEARD_CONFIRMED }]);
  assert.equal(r.semanticObservations.length, 0);
  assert.match(r.unsupportedSemanticLabels[0].reason, /not image-backed/);
});

// 7 — VERIFIED_EXACT keyframe preserves EXACT sync into the semantic observation.
test('VERIFIED_EXACT keyframe preserves EXACT_SYNCHRONIZED', () => {
  const scanPackage = pkgOf({ front: { img: 1 } });
  const kfId = scanPackage.posePackages.front.retainedImageObservations[0].observationId;
  const r = semanticObservationsFromKeyframes(scanPackage, [{ scanObservationId: kfId, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }]);
  assert.equal(r.semanticObservations[0].syncStatus, SyncStatus.EXACT_SYNCHRONIZED);
  assert.equal(r.semanticObservations[0].provenance.coherenceStatus, 'VERIFIED_EXACT');
  assert.equal(r.semanticObservations[0].provenance.nativeSpatialKeyframe, true);
});

// 8 — Weak sync is not upgraded.
test('weaker sync state on the source observation is preserved, never upgraded', () => {
  const weakImg = makeScanObservation({
    observationId: 'weak', poseId: 'front', nativeFrameTimestampNs: 1,
    imageRef: { ref: 'weak-ref', format: 'jpeg', width: 100, height: 100 },
    faceLocal3D: 468, nativeSpatialKeyframe: false, coherenceStatus: null
  });
  assert.equal(weakImg.syncStatus, SyncStatus.UNKNOWN);
  const scanPackage = makeMultiObservationScanPackage({
    posePackages: { front: makePoseObservationPackage({ poseId: 'front', retainedImageObservations: [weakImg] }) }
  });
  const r = semanticObservationsFromKeyframes(scanPackage, [{ scanObservationId: 'weak', anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }]);
  assert.equal(r.semanticObservations[0].syncStatus, SyncStatus.UNKNOWN);
});

// 9 — EXACT-only policy rejects weaker evidence.
test('requireExactSync rejects weaker evidence and accepts EXACT', () => {
  const weakImg = makeScanObservation({ observationId: 'weak', poseId: 'front', nativeFrameTimestampNs: 1, imageRef: { ref: 'w' }, faceLocal3D: 468 });
  const weakPkg = makeMultiObservationScanPackage({ posePackages: { front: makePoseObservationPackage({ poseId: 'front', retainedImageObservations: [weakImg] }) } });
  const rejected = semanticObservationsFromKeyframes(weakPkg, [{ scanObservationId: 'weak', anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }], { requireExactSync: true });
  assert.equal(rejected.semanticObservations.length, 0);
  assert.match(rejected.unsupportedSemanticLabels[0].reason, /EXACT-only/);

  const exactPkg = pkgOf({ front: { img: 1 } });
  const kfId = exactPkg.posePackages.front.retainedImageObservations[0].observationId;
  const accepted = semanticObservationsFromKeyframes(exactPkg, [{ scanObservationId: kfId, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }], { requireExactSync: true });
  assert.equal(accepted.semanticObservations.length, 1);
});

// 10–13 — hair states survive projection.
function surfaceWithLabel(region, state, extra = {}) {
  const scanPackage = pkgOf({ front: { geom: 2, img: 1 } });
  const kfId = scanPackage.posePackages.front.retainedImageObservations[0].observationId;
  return buildSemanticBeardSurfaceBundle(scanPackage, geomObsOf(scanPackage),
    [{ scanObservationId: kfId, anatomicalRegion: region, hairState: state, ...extra }], { anatomySupport });
}
test('BEARD_CONFIRMED survives projection', () => {
  assert.equal(surfaceWithLabel('LEFT_JAW', HairState.BEARD_CONFIRMED).personalizedBeardSurface.regions.LEFT_JAW.hairState, HairState.BEARD_CONFIRMED);
});
test('NON_BEARD_CONFIRMED survives projection', () => {
  assert.equal(surfaceWithLabel('NECK_FRONT', HairState.NON_BEARD_CONFIRMED).personalizedBeardSurface.regions.NECK_FRONT.hairState, HairState.NON_BEARD_CONFIRMED);
});
test('BOUNDARY survives projection', () => {
  assert.equal(surfaceWithLabel('CHIN_CENTER', HairState.BOUNDARY).personalizedBeardSurface.regions.CHIN_CENTER.hairState, HairState.BOUNDARY);
});
test('UNKNOWN remains UNKNOWN', () => {
  const b = surfaceWithLabel('CHIN_LEFT', HairState.UNKNOWN);
  assert.equal(b.semanticObservations[0].hairState, HairState.UNKNOWN);
  assert.equal(b.personalizedBeardSurface.regions.CHIN_LEFT.hairState, HairState.UNKNOWN);
});

// 14 — supplied semanticConfidence null stays null on the observation.
test('null semanticConfidence stays null on the semantic observation', () => {
  const b = surfaceWithLabel('LEFT_JAW', HairState.BEARD_CONFIRMED);
  assert.equal(b.semanticObservations[0].semanticConfidence, null);
});

// 15 — semanticConfidence is clamped to [0,1] or null.
test('semanticConfidence is bounded', () => {
  assert.equal(makeSemanticHairObservation({ anatomicalRegion: 'LEFT_JAW', semanticConfidence: 5 }).semanticConfidence, 1);
  assert.equal(makeSemanticHairObservation({ anatomicalRegion: 'LEFT_JAW', semanticConfidence: -3 }).semanticConfidence, 0);
  assert.equal(makeSemanticHairObservation({ anatomicalRegion: 'LEFT_JAW', semanticConfidence: null }).semanticConfidence, null);
});

// 16 — Eight Front semantic observations do not become multi-view / multi-pose.
test('eight Front semantic observations stay single-pose', () => {
  const scanPackage = pkgOf({ front: { img: 8 } });
  const kfIds = scanPackage.posePackages.front.retainedImageObservations.map(k => k.observationId);
  const labels = kfIds.map(id => ({ scanObservationId: id, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }));
  const b = buildSemanticBeardSurfaceBundle(scanPackage, [], labels, { anatomySupport });
  assert.equal(b.semanticSummary.perRegion.LEFT_JAW.multiPose, false);
  assert.deepEqual(b.semanticSummary.perRegion.LEFT_JAW.contributingPoses, ['front']);
  assert.equal(b.personalizedBeardSurface.regions.LEFT_JAW.multiViewSupported, false);
});

// 17 — Front + Right-45 can become multi-pose semantic support.
test('Front + Right-45 semantic labels are multi-pose', () => {
  const scanPackage = pkgOf({ front: { img: 1 }, 'right-45': { img: 1 } });
  const fId = scanPackage.posePackages.front.retainedImageObservations[0].observationId;
  const rId = scanPackage.posePackages['right-45'].retainedImageObservations[0].observationId;
  const b = buildSemanticBeardSurfaceBundle(scanPackage, [], [
    { scanObservationId: fId, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED },
    { scanObservationId: rId, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }
  ], { anatomySupport });
  assert.equal(b.semanticSummary.perRegion.LEFT_JAW.multiPose, true);
  assert.deepEqual(b.semanticSummary.perRegion.LEFT_JAW.contributingPoses, ['front', 'right-45']);
  assert.ok(b.semanticSummary.semanticMultiPoseRegions >= 1);
});

// 18 — BEARD + NON_BEARD conflict preserves BOUNDARY and does not erase either.
test('BEARD + NON_BEARD conflict preserves BOUNDARY and both observations', () => {
  const scanPackage = pkgOf({ front: { img: 1 }, 'right-45': { img: 1 } });
  const fId = scanPackage.posePackages.front.retainedImageObservations[0].observationId;
  const rId = scanPackage.posePackages['right-45'].retainedImageObservations[0].observationId;
  const b = buildSemanticBeardSurfaceBundle(scanPackage, [], [
    { scanObservationId: fId, anatomicalRegion: 'RIGHT_JAW', hairState: HairState.BEARD_CONFIRMED },
    { scanObservationId: rId, anatomicalRegion: 'RIGHT_JAW', hairState: HairState.NON_BEARD_CONFIRMED }
  ], { anatomySupport });
  assert.equal(b.personalizedBeardSurface.regions.RIGHT_JAW.hairState, HairState.BOUNDARY);
  assert.equal(b.semanticSummary.perRegion.RIGHT_JAW.conflict, true);
  assert.equal(b.semanticSummary.perRegion.RIGHT_JAW.observationCount, 2);
  assert.ok(b.semanticSummary.semanticConflictRegions >= 1);
});

// 19 — Provenance retains contributing poses.
test('semantic provenance retains contributing poses and source metadata', () => {
  const scanPackage = pkgOf({ front: { img: 1 }, 'left-45': { img: 1 } });
  const fId = scanPackage.posePackages.front.retainedImageObservations[0].observationId;
  const lId = scanPackage.posePackages['left-45'].retainedImageObservations[0].observationId;
  const b = buildSemanticBeardSurfaceBundle(scanPackage, [], [
    { scanObservationId: fId, anatomicalRegion: 'LEFT_LOWER_CHEEK', hairState: HairState.BEARD_CONFIRMED },
    { scanObservationId: lId, anatomicalRegion: 'LEFT_LOWER_CHEEK', hairState: HairState.BEARD_CONFIRMED }
  ], { anatomySupport });
  assert.deepEqual(b.semanticSummary.perRegion.LEFT_LOWER_CHEEK.contributingPoses, ['front', 'left-45']);
  assert.equal(b.semanticObservations[0].provenance.sourceTier, 'TIER_B_IMAGE_KEYFRAME');
  assert.equal(b.personalizedBeardSurface.regions.LEFT_LOWER_CHEEK.provenance.poses.includes('front'), true);
});

// 20 — Geometry-only region remains valid without semantics.
test('a geometry-only region is valid with no semantic evidence', () => {
  const scanPackage = pkgOf({ front: { geom: 2 }, 'right-45': { geom: 2 } });
  const b = buildSemanticBeardSurfaceBundle(scanPackage, geomObsOf(scanPackage), [], { anatomySupport });
  const jaw = b.personalizedBeardSurface.regions.RIGHT_JAW;
  assert.ok(jaw.observationKind === ObservationKind.MULTI_VIEW_FUSED || jaw.observationKind === ObservationKind.DIRECT_GEOMETRY);
  assert.equal(jaw.hairState, HairState.UNKNOWN);
  assert.equal(jaw.semanticSupported, false);
});

// 21 — Semantic-only region remains valid without geometry.
test('a semantic-only region is valid with no geometry', () => {
  const scanPackage = pkgOf({ front: { img: 1 } });
  const kfId = scanPackage.posePackages.front.retainedImageObservations[0].observationId;
  const b = buildSemanticBeardSurfaceBundle(scanPackage, [], [{ scanObservationId: kfId, anatomicalRegion: 'NECK_FRONT', hairState: HairState.BEARD_CONFIRMED }], { anatomySupport });
  const neck = b.personalizedBeardSurface.regions.NECK_FRONT;
  assert.equal(neck.hairState, HairState.BEARD_CONFIRMED);
  assert.equal(neck.fusedPosition, null);
  assert.equal(neck.observationKind, ObservationKind.SEMANTIC_OBSERVATION);
  assert.equal(neck.multiViewSupported, false);
});

// 22 — Geometry + semantic region reports both.
test('a geometry+semantic region reports both kinds of support', () => {
  const scanPackage = pkgOf({ front: { geom: 2, img: 1 }, 'right-45': { geom: 2 } });
  const kfId = scanPackage.posePackages.front.retainedImageObservations[0].observationId;
  const b = buildSemanticBeardSurfaceBundle(scanPackage, geomObsOf(scanPackage),
    [{ scanObservationId: kfId, anatomicalRegion: 'RIGHT_JAW', hairState: HairState.BEARD_CONFIRMED }], { anatomySupport });
  const jaw = b.personalizedBeardSurface.regions.RIGHT_JAW;
  assert.equal(jaw.semanticSupported, true);
  assert.ok(jaw.geometryCoverage > 0);
  assert.ok(jaw.provenance.methods.includes(ObservationMethod.LANDMARK_GEOMETRY));
  assert.ok(jaw.provenance.methods.includes(ObservationMethod.SEMANTIC_SEGMENTATION));
});

// 23 — Under-jaw semantic evidence does not fabricate canonical 3D.
test('under-jaw semantic evidence adds no canonical 3D', () => {
  const scanPackage = pkgOf({ 'chin-up': { img: 1 } });
  const kfId = scanPackage.posePackages['chin-up'].retainedImageObservations[0].observationId;
  const b = buildSemanticBeardSurfaceBundle(scanPackage, [], [{ scanObservationId: kfId, anatomicalRegion: 'UNDER_JAW_CENTER', hairState: HairState.BEARD_CONFIRMED }], { anatomySupport });
  const uj = b.personalizedBeardSurface.regions.UNDER_JAW_CENTER;
  assert.equal(uj.fusedPosition, null);
  assert.equal(uj.geometryCoverage, 0);
  assert.equal(b.semanticObservations[0].spatialSupport.geometryRegionSupported, false);
});

// 24 — Unsupported geometry region stays geometrically unsupported even with semantics.
test('semantic evidence does not make an unsupported geometry region geometry-supported', () => {
  assert.equal(SUPPORTED_REGIONS.includes('NECK_FRONT'), false);
  const scanPackage = pkgOf({ front: { img: 1 } });
  const kfId = scanPackage.posePackages.front.retainedImageObservations[0].observationId;
  const b = buildSemanticBeardSurfaceBundle(scanPackage, [], [{ scanObservationId: kfId, anatomicalRegion: 'NECK_FRONT', hairState: HairState.BEARD_CONFIRMED }], { anatomySupport });
  assert.equal(SUPPORTED_REGIONS.includes('NECK_FRONT'), false);
  assert.equal(b.personalizedBeardSurface.regions.NECK_FRONT.geometryCoverage, 0);
  assert.equal(b.personalizedBeardSurface.regions.NECK_FRONT.multiViewSupported, false);
});

// 25 — RawImageLifecycle can reach DERIVED_DATA_EXTRACTED / ELIGIBLE_FOR_DISCARD contractually.
test('raw-image lifecycle progresses forward only', () => {
  assert.equal(advanceLifecycle(RawImageLifecycle.TRANSIENT, RawImageLifecycle.DERIVED_DATA_EXTRACTED).ok, true);
  assert.equal(advanceLifecycle(RawImageLifecycle.DERIVED_DATA_EXTRACTED, RawImageLifecycle.ELIGIBLE_FOR_DISCARD).state, RawImageLifecycle.ELIGIBLE_FOR_DISCARD);
  assert.equal(advanceLifecycle(RawImageLifecycle.ELIGIBLE_FOR_DISCARD, RawImageLifecycle.TRANSIENT).ok, false);
  assert.equal(advanceLifecycle(RawImageLifecycle.PERSISTED_BY_EXPLICIT_FEATURE, RawImageLifecycle.ELIGIBLE_FOR_DISCARD).ok, false);
});

// 26 — Semantic summary is deterministic.
test('semantic summary is deterministic', () => {
  const scanPackage = pkgOf({ front: { geom: 2, img: 2 }, 'right-45': { img: 1 } });
  const kfs = scanPackage.posePackages.front.retainedImageObservations.map(k => k.observationId);
  const rId = scanPackage.posePackages['right-45'].retainedImageObservations[0].observationId;
  const labels = [
    { scanObservationId: kfs[0], anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED, semanticConfidence: 0.8 },
    { scanObservationId: kfs[1], anatomicalRegion: 'CHIN_CENTER', hairState: HairState.BOUNDARY },
    { scanObservationId: rId, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }
  ];
  const a = buildSemanticBeardSurfaceBundle(scanPackage, geomObsOf(scanPackage), labels, { anatomySupport });
  const b = buildSemanticBeardSurfaceBundle(scanPackage, geomObsOf(scanPackage), labels, { anatomySupport });
  assert.deepEqual(a.semanticSummary, b.semanticSummary);
  assert.equal(typeof semanticDiagnosticString(a), 'string');
});

// 27 — Empty semantic input is valid.
test('empty semantic input produces a valid bundle', () => {
  const scanPackage = pkgOf({ front: { geom: 2 } });
  const b = buildSemanticBeardSurfaceBundle(scanPackage, geomObsOf(scanPackage), [], { anatomySupport });
  assert.equal(b.semanticObservations.length, 0);
  assert.equal(b.semanticSummary.semanticRegionsObserved, 0);
  assert.equal(b.unsupportedSemanticLabels.length, 0);
  assert.equal(b.semanticSummary.rawImagesRequiredAfterDerivation, false);
});

// --- supporting ---
test('MANUAL_GROUND_TRUTH flows through and is captured by the BS1-D summary', () => {
  const scanPackage = pkgOf({ front: { img: 1 } });
  const kfId = scanPackage.posePackages.front.retainedImageObservations[0].observationId;
  const b = buildSemanticBeardSurfaceBundle(scanPackage, [], [
    { scanObservationId: kfId, anatomicalRegion: 'CHIN_CENTER', hairState: HairState.BEARD_CONFIRMED, sourceMethod: ObservationMethod.MANUAL_GROUND_TRUTH, synthetic: true }
  ], { anatomySupport });
  assert.equal(b.semanticObservations[0].sourceMethod, ObservationMethod.MANUAL_GROUND_TRUTH);
  assert.equal(b.semanticSummary.perRegion.CHIN_CENTER.fusedHairState, HairState.BEARD_CONFIRMED);
  assert.ok(b.semanticSummary.perRegion.CHIN_CENTER.methods.includes(ObservationMethod.MANUAL_GROUND_TRUTH));
});

test('synthetic labels are tagged synthetic and never claim runtime segmentation', () => {
  const s = makeSemanticHairObservation({ anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED });
  assert.equal(s.synthetic, true);
  assert.match(s.notes, /synthetic/);
});

test('imageResolverKey carries only identity/provenance, no pixels', () => {
  const k = imageResolverKey({ observationId: 'o', imageRef: { ref: 'r' }, timestamp: { nativeFrameTimestampNs: 9 }, poseId: 'front', coherenceStatus: 'VERIFIED_EXACT', metadata: { scannerSessionId: 'sess' } });
  assert.deepEqual(Object.keys(k).sort(), ['coherenceStatus', 'imageRef', 'nativeFrameTimestampNs', 'observationId', 'poseId', 'scannerSessionId']);
});
