// Stage BS1-D1 — MANUAL_GROUND_TRUTH must be first-class semantic evidence in fuseRegion.
// Node built-in runner (node --test). Zero dependencies.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fuseRegion, buildBeardSurface,
  makeSurfaceObservation,
  HairState, ObservationMethod, ObservationKind, CoordinateSpace,
  SEMANTIC_OBSERVATION_METHODS, isSemanticObservationMethod
} from './beard-surface-core.mjs';

const REGION = 'CHIN_CENTER';
const semObs = (method, state, extra = {}) => makeSurfaceObservation({
  region: REGION,
  position: null,
  space: CoordinateSpace.CANONICAL_FACE_LOCAL,
  pose: 'front',
  method,
  kind: ObservationKind.SEMANTIC_OBSERVATION,
  hairState: state,
  ...extra
});
const mgt = (state, pose = 'front') => makeSurfaceObservation({
  region: REGION, position: null, space: CoordinateSpace.CANONICAL_FACE_LOCAL, pose,
  method: ObservationMethod.MANUAL_GROUND_TRUTH, kind: ObservationKind.SEMANTIC_OBSERVATION, hairState: state
});
const seg = (state, pose = 'front') => makeSurfaceObservation({
  region: REGION, position: null, space: CoordinateSpace.CANONICAL_FACE_LOCAL, pose,
  method: ObservationMethod.SEMANTIC_SEGMENTATION, kind: ObservationKind.SEMANTIC_OBSERVATION, hairState: state
});

// 1 — Prove the pre-fix predicate would have excluded MANUAL_GROUND_TRUTH; the new one includes it.
test('pre-fix predicate (SEMANTIC_SEGMENTATION-only) would exclude MANUAL_GROUND_TRUTH', () => {
  const preFixIsSemantic = (o) => o && o.method === ObservationMethod.SEMANTIC_SEGMENTATION;
  const o = mgt(HairState.BEARD_CONFIRMED);
  assert.equal(preFixIsSemantic(o), false);                       // the reported defect
  assert.equal(isSemanticObservationMethod(o.method), true);       // fixed rule
  assert.deepEqual([...SEMANTIC_OBSERVATION_METHODS].sort(),
    [ObservationMethod.MANUAL_GROUND_TRUTH, ObservationMethod.SEMANTIC_SEGMENTATION].sort());
});

// 2 — Manual GT BEARD_CONFIRMED contributes to hairState.
test('manual GT BEARD_CONFIRMED drives region hairState', () => {
  const r = fuseRegion(REGION, [mgt(HairState.BEARD_CONFIRMED)]);
  assert.equal(r.hairState, HairState.BEARD_CONFIRMED);
});

// 3 — Manual GT NON_BEARD_CONFIRMED contributes.
test('manual GT NON_BEARD_CONFIRMED drives region hairState', () => {
  assert.equal(fuseRegion(REGION, [mgt(HairState.NON_BEARD_CONFIRMED)]).hairState, HairState.NON_BEARD_CONFIRMED);
});

// 4 — Manual GT BOUNDARY contributes.
test('manual GT BOUNDARY drives region hairState', () => {
  assert.equal(fuseRegion(REGION, [mgt(HairState.BOUNDARY)]).hairState, HairState.BOUNDARY);
});

// 5 — Manual GT sets semanticSupported true.
test('manual GT sets semanticSupported and SEMANTIC_OBSERVATION kind', () => {
  const r = fuseRegion(REGION, [mgt(HairState.BEARD_CONFIRMED)]);
  assert.equal(r.semanticSupported, true);
  assert.equal(r.observationKind, ObservationKind.SEMANTIC_OBSERVATION);
});

// 6 — Manual GT increments the semantic evidence count.
test('manual GT counts toward semanticCount / semanticCoverage', () => {
  const r = fuseRegion(REGION, [mgt(HairState.BEARD_CONFIRMED), mgt(HairState.BEARD_CONFIRMED, 'right-45')]);
  assert.equal(r.provenance.semanticCount, 2);
  assert.equal(r.semanticCoverage, 1); // SEMANTIC_COVERAGE_FULL_OBS = 2
});

// 7 — Manual GT provenance method survives.
test('manual GT method stays visible in provenance.methods', () => {
  const r = fuseRegion(REGION, [mgt(HairState.BEARD_CONFIRMED)]);
  assert.deepEqual(r.provenance.methods, [ObservationMethod.MANUAL_GROUND_TRUTH]);
  const both = fuseRegion(REGION, [seg(HairState.BEARD_CONFIRMED), mgt(HairState.BEARD_CONFIRMED)]);
  assert.deepEqual(both.provenance.methods,
    [ObservationMethod.MANUAL_GROUND_TRUTH, ObservationMethod.SEMANTIC_SEGMENTATION].sort());
});

// 8 & 9 — Semantic-only manual-GT region: geometryCoverage 0, no fabricated position.
test('semantic-only manual GT region has geometryCoverage 0 and null position', () => {
  const r = fuseRegion(REGION, [mgt(HairState.BEARD_CONFIRMED)]);
  assert.equal(r.geometryCoverage, 0);
  assert.equal(r.fusedPosition, null);
  assert.equal(r.multiViewSupported, false);
  assert.equal(r.distinctGeometryPoses, 0);
});

// 10 — Segmentation + manual GT, same state, remains that state.
test('segmentation + manual GT agreeing on BEARD stays BEARD', () => {
  assert.equal(fuseRegion(REGION, [seg(HairState.BEARD_CONFIRMED), mgt(HairState.BEARD_CONFIRMED)]).hairState, HairState.BEARD_CONFIRMED);
});

// 11 — Segmentation BEARD + manual GT NON_BEARD preserves conflict → BOUNDARY.
test('segmentation BEARD + manual GT NON_BEARD → BOUNDARY, neither erased', () => {
  const r = fuseRegion(REGION, [seg(HairState.BEARD_CONFIRMED, 'front'), mgt(HairState.NON_BEARD_CONFIRMED, 'right-45')]);
  assert.equal(r.hairState, HairState.BOUNDARY);
  assert.equal(r.provenance.semanticCount, 2);
  assert.equal(r.provenance.observationCount, 2);
});

// 12 — LANDMARK_GEOMETRY is still not semantic; FUSED is not semantic.
test('LANDMARK_GEOMETRY and FUSED are not semantic methods', () => {
  assert.equal(isSemanticObservationMethod(ObservationMethod.LANDMARK_GEOMETRY), false);
  assert.equal(isSemanticObservationMethod(ObservationMethod.FUSED), false);
  const geom = makeSurfaceObservation({ region: REGION, position: { x: 0.1, y: 0.2, z: 0.3 }, pose: 'front', method: ObservationMethod.LANDMARK_GEOMETRY, kind: ObservationKind.DIRECT_GEOMETRY });
  const r = fuseRegion(REGION, [geom]);
  assert.equal(r.semanticSupported, false);
  assert.equal(r.hairState, HairState.UNKNOWN);
  assert.equal(r.provenance.semanticCount, 0);
});

// 13 — Existing SEMANTIC_SEGMENTATION behavior unchanged.
test('SEMANTIC_SEGMENTATION-only behavior is unchanged', () => {
  const r = fuseRegion(REGION, [seg(HairState.BEARD_CONFIRMED)]);
  assert.equal(r.hairState, HairState.BEARD_CONFIRMED);
  assert.equal(r.semanticSupported, true);
  assert.equal(r.provenance.semanticCount, 1);
  assert.equal(r.observationKind, ObservationKind.SEMANTIC_OBSERVATION);
});

// --- extra: manual GT with a position contributes to BOTH pools (documented) ---
test('manual GT that also carries a position contributes to geometry and semantics', () => {
  const o = makeSurfaceObservation({
    region: REGION, position: { x: 0.4, y: 0.5, z: 0.6 }, pose: 'front',
    method: ObservationMethod.MANUAL_GROUND_TRUTH, kind: ObservationKind.DIRECT_GEOMETRY,
    hairState: HairState.BEARD_CONFIRMED
  });
  const r = fuseRegion(REGION, [o]);
  assert.deepEqual(r.fusedPosition, { x: 0.4, y: 0.5, z: 0.6 }); // direct pool
  assert.equal(r.hairState, HairState.BEARD_CONFIRMED);           // semantic pool
  assert.equal(r.semanticSupported, true);
  assert.equal(r.provenance.directCount, 1);
  assert.equal(r.provenance.semanticCount, 1);
});

// --- integration: core surface via buildBeardSurface now reflects manual GT ---
test('buildBeardSurface reflects manual GT in the core region', () => {
  const surface = buildBeardSurface([mgt(HairState.BEARD_CONFIRMED)]);
  const region = surface.regions[REGION];
  assert.equal(region.hairState, HairState.BEARD_CONFIRMED);
  assert.equal(region.semanticSupported, true);
  assert.equal(region.provenance.methods.includes(ObservationMethod.MANUAL_GROUND_TRUTH), true);
});
