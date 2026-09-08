// Stage BS1-A — pure unit tests for the Personalized Beard Surface core model.
// Runs on Node's built-in test runner (node --test). Zero dependencies.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA_VERSION,
  SCAN_POSES,
  CoordinateSpace,
  BEARD_SURFACE_SPACE,
  AnatomicalRegion,
  REGION_META,
  CORE_REGIONS,
  FUTURE_REGIONS,
  HairState,
  ObservationMethod,
  ObservationKind,
  Disagreement,
  LiveMapReadiness,
  makeConfidence,
  combineConfidence,
  makeSurfaceObservation,
  countIndependentPoses,
  classifyDisagreement,
  fuseHairState,
  fuseRegion,
  mergeObservations,
  assertSameSpace,
  emptyBeardSurface,
  buildBeardSurface,
  summarizeSurface,
  diagnosticString,
  serialize,
  deserialize
} from './beard-surface-core.mjs';

const geom = (region, pose, position, extra = {}) => makeSurfaceObservation({
  region, pose, position,
  method: ObservationMethod.LANDMARK_GEOMETRY,
  kind: ObservationKind.DIRECT_GEOMETRY,
  ...extra
});
const semantic = (region, pose, hairState) => makeSurfaceObservation({
  region, pose,
  method: ObservationMethod.SEMANTIC_SEGMENTATION,
  kind: ObservationKind.SEMANTIC_OBSERVATION,
  hairState
});
const inferred = (region, position) => makeSurfaceObservation({
  region, position,
  method: ObservationMethod.LANDMARK_GEOMETRY,
  kind: ObservationKind.INFERRED
});

// 1 — Unknown stays unknown.
test('unknown stays unknown', () => {
  const r = fuseRegion(AnatomicalRegion.NECK_FRONT, []);
  assert.equal(r.observationKind, ObservationKind.UNKNOWN);
  assert.equal(r.hairState, HairState.UNKNOWN);
  assert.equal(r.confidence.combinedConfidence, null);
  assert.equal(r.disagreement.level, Disagreement.INSUFFICIENT_DATA);
});

// 2 — Front-only observation does NOT become multi-view.
test('front-only does not become multi-view', () => {
  const r = fuseRegion(AnatomicalRegion.CHIN_CENTER, [
    geom(AnatomicalRegion.CHIN_CENTER, 'front', { x: 0.5, y: 0.8, z: 0.1 }),
    geom(AnatomicalRegion.CHIN_CENTER, 'front', { x: 0.51, y: 0.8, z: 0.1 })
  ]);
  assert.equal(r.multiViewSupported, false);
  assert.equal(r.distinctGeometryPoses, 1);
  assert.equal(r.observationKind, ObservationKind.DIRECT_GEOMETRY);
});

// 3 — Same region from Front + right-45 becomes multi-view supported.
test('front + right-45 becomes multi-view supported', () => {
  const r = fuseRegion(AnatomicalRegion.RIGHT_JAW, [
    geom(AnatomicalRegion.RIGHT_JAW, 'front', { x: 0.7, y: 0.6, z: 0.0 }),
    geom(AnatomicalRegion.RIGHT_JAW, 'right-45', { x: 0.71, y: 0.6, z: 0.02 })
  ]);
  assert.equal(r.multiViewSupported, true);
  assert.equal(r.distinctGeometryPoses, 2);
  assert.equal(r.observationKind, ObservationKind.MULTI_VIEW_FUSED);
});

// 4 — Direct observation outranks inferred observation.
test('direct outranks inferred for fused position', () => {
  const r = fuseRegion(AnatomicalRegion.UNDER_CHIN, [
    geom(AnatomicalRegion.UNDER_CHIN, 'chin-up', { x: 0.5, y: 0.9, z: 0.2 }),
    inferred(AnatomicalRegion.UNDER_CHIN, { x: 0.0, y: 0.0, z: 0.0 })
  ]);
  assert.equal(r.usedInferredOnly, false);
  assert.equal(r.fusedPosition.x, 0.5);
  assert.equal(r.fusedPosition.y, 0.9);

  const only = fuseRegion(AnatomicalRegion.UNDER_CHIN, [
    inferred(AnatomicalRegion.UNDER_CHIN, { x: 0.4, y: 0.85, z: 0.2 })
  ]);
  assert.equal(only.usedInferredOnly, true);
  assert.equal(only.observationKind, ObservationKind.INFERRED);
});

// 5 — Conflicting observations preserve disagreement (not averaged away).
test('conflicting observations preserve disagreement', () => {
  const r = fuseRegion(AnatomicalRegion.NECK_FRONT, [
    geom(AnatomicalRegion.NECK_FRONT, 'front', { x: 0.50, y: 0.95, z: 0.0 }),
    geom(AnatomicalRegion.NECK_FRONT, 'chin-up', { x: 0.50, y: 0.60, z: 0.0 })
  ], { toleranceNormalized: 0.02 });
  assert.equal(r.disagreement.level, Disagreement.HIGH_DISAGREEMENT);
  assert.ok(r.disagreement.spread > 0.02);
  assert.equal(r.perPose.length, 2);
  assert.deepEqual(r.perPose.map(p => p.pose), ['chin-up', 'front']);
});

// 6 — Missing semantic data does not mean NON_BEARD.
test('missing semantic data yields UNKNOWN not NON_BEARD_CONFIRMED', () => {
  const r = fuseRegion(AnatomicalRegion.LEFT_LOWER_CHEEK, [
    geom(AnatomicalRegion.LEFT_LOWER_CHEEK, 'front', { x: 0.35, y: 0.55, z: 0.0 }),
    geom(AnatomicalRegion.LEFT_LOWER_CHEEK, 'left-45', { x: 0.34, y: 0.55, z: 0.0 })
  ]);
  assert.equal(r.hairState, HairState.UNKNOWN);
  assert.equal(r.semanticSupported, false);
  assert.equal(r.semanticCoverage, null);
});

// 7 — Confidence remains bounded.
test('confidence components and combine stay within [0,1] or null', () => {
  const c = makeConfidence({
    geometryConfidence: 5, semanticConfidence: -3, multiViewConfidence: 0.4,
    registrationConfidence: 1, coverageConfidence: 0.9, combinedConfidence: 2
  });
  assert.equal(c.geometryConfidence, 1);
  assert.equal(c.semanticConfidence, 0);
  assert.equal(c.combinedConfidence, 1);
  const combined = combineConfidence({
    geometryConfidence: 9, registrationConfidence: 0.8, coverageConfidence: 0.7,
    semanticConfidence: 2, multiViewConfidence: 0.9
  });
  assert.ok(combined >= 0 && combined <= 1);
  assert.equal(combined, 0.7); // min of clamped present components
});

// 8 — A zero / unknown critical component cannot be hidden by high unrelated scores.
test('zero or unknown critical confidence cannot be hidden', () => {
  assert.equal(combineConfidence({
    geometryConfidence: 0, registrationConfidence: 1, coverageConfidence: 1,
    semanticConfidence: 1, multiViewConfidence: 1
  }), 0);
  assert.equal(combineConfidence({
    geometryConfidence: null, registrationConfidence: 1, coverageConfidence: 1,
    semanticConfidence: 1, multiViewConfidence: 1
  }), null);
  assert.equal(combineConfidence({
    geometryConfidence: 0.9, registrationConfidence: 0.9, coverageConfidence: 0.9
  }, { requireAllCritical: false }), 0.9);
});

// 9 — Provenance survives fusion.
test('provenance survives fusion', () => {
  const r = fuseRegion(AnatomicalRegion.CHIN_NECK_TRANSITION, [
    geom(AnatomicalRegion.CHIN_NECK_TRANSITION, 'chin-up', { x: 0.5, y: 0.7, z: 0.1 }),
    geom(AnatomicalRegion.CHIN_NECK_TRANSITION, 'left-profile', { x: 0.5, y: 0.71, z: 0.1 }),
    semantic(AnatomicalRegion.CHIN_NECK_TRANSITION, 'front', HairState.BEARD_CONFIRMED)
  ], { toleranceNormalized: 0.05 });
  assert.deepEqual(r.provenance.poses, ['chin-up', 'front', 'left-profile']);
  assert.deepEqual(r.provenance.methods, [ObservationMethod.LANDMARK_GEOMETRY, ObservationMethod.SEMANTIC_SEGMENTATION]);
  assert.equal(r.provenance.directCount, 2);
  assert.equal(r.provenance.semanticCount, 1);
  assert.equal(r.provenance.observationCount, 3);
});

// 10 — Region coverage summary is deterministic.
test('region coverage summary is deterministic', () => {
  const obs = [
    geom(AnatomicalRegion.CHIN_CENTER, 'front', { x: 0.5, y: 0.8, z: 0.0 }),
    geom(AnatomicalRegion.CHIN_CENTER, 'right-45', { x: 0.5, y: 0.8, z: 0.0 }),
    geom(AnatomicalRegion.LEFT_JAW, 'front', { x: 0.3, y: 0.6, z: 0.0 }),
    semantic(AnatomicalRegion.MOUSTACHE_CENTER, 'front', HairState.BEARD_CONFIRMED)
  ];
  const surface = buildBeardSurface(obs, { toleranceNormalized: 0.03 });
  const a = summarizeSurface(surface);
  const b = summarizeSurface(surface);
  assert.deepEqual(a, b);
  assert.equal(a.regionsObserved, 3);
  assert.equal(a.regionsUnknown, CORE_REGIONS.length - 3);
  assert.equal(a.multiViewSupportedRegions, 1);
  assert.equal(a.semanticSupportedRegions, 1);
  assert.equal(typeof diagnosticString(surface), 'string');
});

// 11 — Empty Beard Surface is valid and reports unknown / not-evaluated.
test('empty beard surface is valid and reports unknown / not-evaluated', () => {
  const s = emptyBeardSurface();
  const sum = summarizeSurface(s);
  assert.equal(sum.regionsObserved, 0);
  assert.equal(sum.regionsUnknown, CORE_REGIONS.length);
  assert.equal(sum.overallGeometryCoverage, 0);
  assert.equal(sum.overallSemanticCoverage, null); // unknown, NOT zero
  assert.equal(sum.readyForLiveMap, LiveMapReadiness.NOT_EVALUATED);
});

// 12 — Serialization / versioning.
test('serialization round-trips and rejects unknown schema versions', () => {
  const s = buildBeardSurface([
    geom(AnatomicalRegion.CHIN_CENTER, 'front', { x: 0.5, y: 0.8, z: 0.0 })
  ], { identityId: 'user-x', toleranceNormalized: 0.03 });
  const wire = serialize(s);
  assert.equal(wire.schemaVersion, SCHEMA_VERSION);
  const back = deserialize(wire);
  assert.equal(back.identityId, 'user-x');
  assert.equal(back.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(summarizeSurface(back), summarizeSurface(s));
  assert.throws(() => deserialize({ ...wire, schemaVersion: 'beard-surface-core/999' }), /unsupported schemaVersion/);
});

// 13 — Future neck / ear / clavicle / shoulder region types compile and are representable.
test('future anatomical region types compile and are representable', () => {
  for (const r of ['CHIN_NECK_TRANSITION', 'UNDER_JAW_CENTER', 'NECK_FRONT', 'NECK_LEFT', 'NECK_RIGHT']) {
    assert.equal(AnatomicalRegion[r], r);
    assert.ok(REGION_META[r]);
    assert.ok(!REGION_META[r].future);        // core anatomy, participates in fusion + summary
    assert.ok(CORE_REGIONS.includes(r));
  }
  for (const r of ['LEFT_EAR_CONTEXT', 'RIGHT_EAR_CONTEXT', 'LEFT_CLAVICLE_CONTEXT', 'RIGHT_CLAVICLE_CONTEXT', 'UPPER_SHOULDER_CONTEXT']) {
    assert.equal(AnatomicalRegion[r], r);
    assert.equal(REGION_META[r].future, true);
    assert.ok(FUTURE_REGIONS.includes(r));
    assert.ok(!CORE_REGIONS.includes(r));
  }
  // A future region can be observed without throwing, and stays out of the core summary.
  const obs = makeSurfaceObservation({
    region: AnatomicalRegion.LEFT_EAR_CONTEXT, pose: 'left-profile',
    position: { x: 0.1, y: 0.4, z: 0.3 }
  });
  const fused = fuseRegion(AnatomicalRegion.LEFT_EAR_CONTEXT, [obs]);
  assert.equal(fused.region, AnatomicalRegion.LEFT_EAR_CONTEXT);
  const surface = buildBeardSurface([obs]);
  assert.equal(summarizeSurface(surface).regionsObserved, 0); // context region not counted
});

// --- supporting primitives ---

test('countIndependentPoses counts only distinct recognised poses', () => {
  assert.equal(countIndependentPoses([
    geom(AnatomicalRegion.CHIN_CENTER, 'front', { x: 0, y: 0 }),
    geom(AnatomicalRegion.CHIN_CENTER, 'front', { x: 0, y: 0 }),
    geom(AnatomicalRegion.CHIN_CENTER, 'right-profile', { x: 0, y: 0 }),
    makeSurfaceObservation({ region: AnatomicalRegion.CHIN_CENTER, pose: null, position: { x: 0, y: 0 } })
  ]), 2);
});

test('classifyDisagreement needs >=2 points and a caller tolerance', () => {
  assert.equal(classifyDisagreement([{ x: 0, y: 0 }], 0.01).level, Disagreement.INSUFFICIENT_DATA);
  assert.equal(classifyDisagreement([{ x: 0, y: 0 }, { x: 0.001, y: 0 }], null).level, Disagreement.INSUFFICIENT_DATA);
  // spread is measured from the median (midpoint), so a gap of g gives spread g/2.
  assert.equal(classifyDisagreement([{ x: 0, y: 0 }, { x: 0.001, y: 0 }], 0.01).level, Disagreement.CONSISTENT);   // spread 0.0005
  assert.equal(classifyDisagreement([{ x: 0, y: 0 }, { x: 0.03, y: 0 }], 0.01).level, Disagreement.LOW_DISAGREEMENT); // spread 0.015
  assert.equal(classifyDisagreement([{ x: 0, y: 0 }, { x: 0.5, y: 0 }], 0.01).level, Disagreement.HIGH_DISAGREEMENT);  // spread 0.25
});

test('fuseHairState never invents NON_BEARD from absence and merges conflict to BOUNDARY', () => {
  assert.equal(fuseHairState([]), HairState.UNKNOWN);
  assert.equal(fuseHairState([geom(AnatomicalRegion.CHIN_CENTER, 'front', { x: 0, y: 0 })]), HairState.UNKNOWN);
  assert.equal(fuseHairState([
    semantic(AnatomicalRegion.CHIN_CENTER, 'front', HairState.BEARD_CONFIRMED),
    semantic(AnatomicalRegion.CHIN_CENTER, 'left-45', HairState.NON_BEARD_CONFIRMED)
  ]), HairState.BOUNDARY);
});

test('assertSameSpace rejects mixed coordinate spaces', () => {
  assert.throws(() => assertSameSpace([
    makeSurfaceObservation({ region: AnatomicalRegion.CHIN_CENTER, space: CoordinateSpace.CANONICAL_FACE_LOCAL, position: { x: 0, y: 0 } }),
    makeSurfaceObservation({ region: AnatomicalRegion.CHIN_CENTER, space: CoordinateSpace.CAMERA_FRAME, position: { x: 0, y: 0 } })
  ]), /mixed coordinate spaces/);
  assert.equal(BEARD_SURFACE_SPACE, CoordinateSpace.CANONICAL_FACE_LOCAL);
});

test('mergeObservations groups by region', () => {
  const regions = mergeObservations([
    geom(AnatomicalRegion.CHIN_CENTER, 'front', { x: 0.5, y: 0.8 }),
    geom(AnatomicalRegion.CHIN_CENTER, 'right-45', { x: 0.5, y: 0.8 }),
    geom(AnatomicalRegion.LEFT_JAW, 'front', { x: 0.3, y: 0.6 })
  ], { toleranceNormalized: 0.03 });
  assert.deepEqual(Object.keys(regions).sort(), [AnatomicalRegion.CHIN_CENTER, AnatomicalRegion.LEFT_JAW].sort());
  assert.equal(regions[AnatomicalRegion.CHIN_CENTER].multiViewSupported, true);
});

test('unknown region / pose / space are rejected early', () => {
  assert.throws(() => makeSurfaceObservation({ region: 'NOSE_TIP', position: { x: 0, y: 0 } }), /unknown region/);
  assert.throws(() => makeSurfaceObservation({ region: AnatomicalRegion.CHIN_CENTER, pose: 'top-down', position: { x: 0, y: 0 } }), /unknown pose/);
  assert.throws(() => fuseRegion('NOSE_TIP', []), /unknown region/);
  assert.equal(SCAN_POSES.length, 6);
});
