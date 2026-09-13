// Stage BI-1Z0B — EXACT_FRAME_RESEARCH_CAPTURE pure-module tests.
// Node built-in runner (node --test). Synthetic fixtures only, zero DOM, zero window.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXACT_FRAME_RESEARCH_CAPTURE_VERSION, SPARSE_TIER_A_INDICES, JAW_SUPPORT_INDICES, JAW_SUPPORT_SIDE,
  extractSparseLandmarks, hasFullJawSupport, buildExactFrameResearchPackage, validateExactFrameResearchPackage,
  TELEMETRY_INVENTORY, DEFERRED_DERIVED_METRICS
} from './exact-frame-research-capture.mjs';

function full468(fn) {
  return Array.from({ length: 468 }, (_, i) => (fn ? fn(i) : { x: i / 468, y: i / 468, z: 0 }));
}

// 1 — frozen anatomical jaw-support side semantics (Part 6)
test('1: jaw support indices carry the frozen anatomical side mapping (172/149=RIGHT, 397/378=LEFT, 152=CENTER)', () => {
  assert.deepEqual(JAW_SUPPORT_INDICES.slice().sort(), [149, 152, 172, 378, 397]);
  assert.equal(JAW_SUPPORT_SIDE[172], 'RIGHT');
  assert.equal(JAW_SUPPORT_SIDE[149], 'RIGHT');
  assert.equal(JAW_SUPPORT_SIDE[152], 'CENTER');
  assert.equal(JAW_SUPPORT_SIDE[397], 'LEFT');
  assert.equal(JAW_SUPPORT_SIDE[378], 'LEFT');
});

// 2 — sparse extraction preserves index identity for every point, never invents a missing one
test('2: extractSparseLandmarks returns index-tagged points only for present, finite indices', () => {
  const lm = full468();
  const sparse = extractSparseLandmarks(lm, [172, 999, 152]); // 999 is out of range -- must be omitted, not invented
  assert.deepEqual(sparse.map((p) => p.index), [172, 152]);
  sparse.forEach((p) => assert.equal(typeof p.index, 'number'));
});
test('2b: a null/missing point at a requested index is omitted, never fabricated', () => {
  const lm = full468();
  lm[172] = null;
  const sparse = extractSparseLandmarks(lm, [172, 152]);
  assert.deepEqual(sparse.map((p) => p.index), [152]);
});
test('2c: extractSparseLandmarks returns null for a non-array input, never guesses', () => {
  assert.equal(extractSparseLandmarks(null), null);
  assert.equal(extractSparseLandmarks(undefined), null);
});
test('2d: the default sparse index set is ~34 points drawn only from the verified jaw/cheek/mouth rails', () => {
  assert.ok(SPARSE_TIER_A_INDICES.length >= 30 && SPARSE_TIER_A_INDICES.length <= 40);
  assert.equal(new Set(SPARSE_TIER_A_INDICES).size, SPARSE_TIER_A_INDICES.length, 'no duplicate indices');
});

// 3 — hasFullJawSupport
test('3: hasFullJawSupport is true only when all five jaw-support indices are present', () => {
  const lm = full468();
  const full = extractSparseLandmarks(lm);
  assert.equal(hasFullJawSupport(full), true);
  const partial = full.filter((p) => p.index !== 152);
  assert.equal(hasFullJawSupport(partial), false);
});

// 4 — Tier-B keyframes are NEVER reduced (Part 4)
test('4: buildExactFrameResearchPackage keeps Tier-B imageKeyframes landmarks2D as a full, untouched array', () => {
  const fullLm = full468();
  const pkg = buildExactFrameResearchPackage({
    manifest: { scannerSessionId: 's1' },
    imageKeyframes: [{ nativeTs: '123', coherenceStatus: 'VERIFIED_EXACT', landmarks2D: fullLm, dataUrl: 'x' }],
    geometryObs: []
  });
  assert.equal(pkg.imageKeyframes[0].landmarks2D.length, 468);
  assert.deepEqual(pkg.imageKeyframes[0].landmarks2D, fullLm);
});

// 5 — Tier-A geometryObs is reduced to the sparse subset, never a full 468-point array, in the
// DURABLE package (Part 5) -- the caller's own in-memory objects are never mutated either.
test('5: buildExactFrameResearchPackage reduces Tier-A geometryObs to sparseLandmarks2D and never mutates the input', () => {
  const fullLm = full468();
  const inputGeom = { scannerSessionId: 's1', observationId: 0, nativeTs: '999', yawDeg: 1, pitchDeg: -2, rollDeg: 3, landmarks2D: fullLm, currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION' };
  const before = JSON.parse(JSON.stringify(inputGeom));
  const pkg = buildExactFrameResearchPackage({ manifest: {}, geometryObs: [inputGeom], imageKeyframes: [] });
  assert.equal('landmarks2D' in pkg.geometryObs[0], false);
  assert.ok(Array.isArray(pkg.geometryObs[0].sparseLandmarks2D));
  assert.ok(pkg.geometryObs[0].sparseLandmarks2D.length < 468);
  assert.equal(pkg.geometryObs[0].coordinateSpace, 'CAPTURE_NORMALIZED');
  assert.deepEqual(inputGeom, before, 'the source geometryObs object must never be mutated');
});

// 6 — never joins on rawObservationId/observationId alone; scanSessionId + nativeTs travel through
test('6: exported geometryObs rows carry scanSessionId + nativeFrameTimestampNs alongside observationId', () => {
  const pkg = buildExactFrameResearchPackage({
    geometryObs: [{ scannerSessionId: 'scan_abc', observationId: 0, nativeTs: '42', landmarks2D: full468() }]
  });
  const row = pkg.geometryObs[0];
  assert.equal(row.scanSessionId, 'scan_abc');
  assert.equal(row.nativeFrameTimestampNs, '42');
  assert.equal(row.observationId, 0);
});

// 7 — numeric-string timestamps survive verbatim (matching the BI-1W hotfix convention)
test('7: numeric-string nativeTs survives buildExactFrameResearchPackage verbatim for both tiers', () => {
  const pkg = buildExactFrameResearchPackage({
    geometryObs: [{ scannerSessionId: 's', observationId: 0, nativeTs: '3416131619234578', landmarks2D: [] }],
    imageKeyframes: [{ nativeTs: '3416131619234578', coherenceStatus: 'VERIFIED_EXACT', landmarks2D: full468() }]
  });
  assert.equal(pkg.geometryObs[0].nativeFrameTimestampNs, '3416131619234578');
  assert.equal(pkg.imageKeyframes[0].nativeTs, '3416131619234578');
});

// 8 — coordinate-space metadata is always present and factual
test('8: every export declares coordinate-space metadata for landmarks2D, Tier-B intrinsics space, and faceLocal3D', () => {
  const pkg = buildExactFrameResearchPackage({});
  assert.match(pkg.coordinateSpaceMetadata.landmarks2D, /CAPTURE_NORMALIZED/);
  assert.match(pkg.coordinateSpaceMetadata.tierBImageIntrinsicsSpace, /IMAGE/);
  assert.match(pkg.coordinateSpaceMetadata.faceLocal3D, /NOT a metric depth scan/);
  assert.ok(pkg.coordinateSpaceMetadata.trackerCoordinateConvention.length > 0);
});

// 9 — validateExactFrameResearchPackage: fail-closed cases
test('9: validateExactFrameResearchPackage passes a well-formed package', () => {
  const pkg = buildExactFrameResearchPackage({
    manifest: {},
    geometryObs: [{ scannerSessionId: 's', observationId: 0, nativeTs: '1', landmarks2D: full468() }],
    imageKeyframes: [{ nativeTs: '2', coherenceStatus: 'VERIFIED_EXACT', landmarks2D: full468() }]
  });
  const v = validateExactFrameResearchPackage(pkg);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});
test('9b: validateExactFrameResearchPackage rejects a Tier-B keyframe with reduced/missing landmarks2D', () => {
  const pkg = { exactFrameResearchCaptureVersion: EXACT_FRAME_RESEARCH_CAPTURE_VERSION, imageKeyframes: [{ nativeTs: '1', coherenceStatus: 'VERIFIED_EXACT', landmarks2D: { kind: 'array', count: 468 } }], geometryObs: [] };
  const v = validateExactFrameResearchPackage(pkg);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /Tier-B geometry must never be reduced/.test(e)));
});
test('9c: validateExactFrameResearchPackage rejects a Tier-A row that still carries a full landmarks2D array', () => {
  const pkg = { exactFrameResearchCaptureVersion: EXACT_FRAME_RESEARCH_CAPTURE_VERSION, imageKeyframes: [], geometryObs: [{ nativeFrameTimestampNs: '1', coordinateSpace: 'CAPTURE_NORMALIZED', landmarks2D: full468(), sparseLandmarks2D: [] }] };
  const v = validateExactFrameResearchPackage(pkg);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /must not carry a full landmarks2D array/.test(e)));
});
test('9d: validateExactFrameResearchPackage rejects a sparse point missing its index', () => {
  const pkg = { exactFrameResearchCaptureVersion: EXACT_FRAME_RESEARCH_CAPTURE_VERSION, imageKeyframes: [], geometryObs: [{ nativeFrameTimestampNs: '1', coordinateSpace: 'CAPTURE_NORMALIZED', sparseLandmarks2D: [{ x: 1, y: 2 }] }] };
  const v = validateExactFrameResearchPackage(pkg);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /missing index/.test(e)));
});
test('9e: validateExactFrameResearchPackage rejects a wrong/missing version tag', () => {
  const v = validateExactFrameResearchPackage({ exactFrameResearchCaptureVersion: 'wrong' });
  assert.equal(v.ok, false);
});

// ---- BI-1Z0C Part 5/6/7 -- research observability -------------------------------------------
test('10: deviceMetadata is recorded once at the top level when supplied, and stays null (never fabricated) when not', () => {
  const withMeta = buildExactFrameResearchPackage({}, { deviceMetadata: { deviceModel: 'SM-S938U', appVersionName: '1.0' } });
  assert.equal(withMeta.deviceMetadata.deviceModel, 'SM-S938U');
  const withoutMeta = buildExactFrameResearchPackage({});
  assert.equal(withoutMeta.deviceMetadata, null);
});
test('11: lensFacing passes through on a Tier-B keyframe when supplied, and stays null when absent', () => {
  const withFacing = buildExactFrameResearchPackage({ imageKeyframes: [{ nativeTs: '1', coherenceStatus: 'VERIFIED_EXACT', landmarks2D: [], lensFacing: 'front' }] });
  assert.equal(withFacing.imageKeyframes[0].lensFacing, 'front');
  const withoutFacing = buildExactFrameResearchPackage({ imageKeyframes: [{ nativeTs: '1', coherenceStatus: 'VERIFIED_EXACT', landmarks2D: [] }] });
  assert.equal(withoutFacing.imageKeyframes[0].lensFacing, null);
});
test('12: distState/currentRatio (DIST-2 diagnostics) pass through on Tier-A rows when present, and stay null when absent -- never fabricated', () => {
  const withDist = buildExactFrameResearchPackage({ geometryObs: [{ scannerSessionId: 's', observationId: 0, nativeTs: '1', landmarks2D: [], distState: 'ok', currentRatio: 0.42 }] });
  assert.equal(withDist.geometryObs[0].distState, 'ok');
  assert.equal(withDist.geometryObs[0].currentRatio, 0.42);
  const withoutDist = buildExactFrameResearchPackage({ geometryObs: [{ scannerSessionId: 's', observationId: 0, nativeTs: '1', landmarks2D: [] }] });
  assert.equal(withoutDist.geometryObs[0].distState, null);
  assert.equal(withoutDist.geometryObs[0].currentRatio, null);
});
test('13: no confidence field is ever fabricated -- landmark/geometry confidence stay absent from the shaped output entirely, not set to a fake default', () => {
  const pkg = buildExactFrameResearchPackage({ geometryObs: [{ scannerSessionId: 's', observationId: 0, nativeTs: '1', landmarks2D: [] }] });
  assert.equal('landmarkConfidence' in pkg.geometryObs[0], false);
  assert.equal('geometryConfidence' in pkg.geometryObs[0], false);
});
test('14: packetFreshAtSample is recorded as the documented structural guarantee for every Tier-A row', () => {
  const pkg = buildExactFrameResearchPackage({ geometryObs: [{ scannerSessionId: 's', observationId: 0, nativeTs: '1', landmarks2D: [] }] });
  assert.equal(pkg.geometryObs[0].packetFreshAtSample, true);
});
test('15: TELEMETRY_INVENTORY classifies every requested field as PRESENT, ABSENT, or DERIVABLE, and never silently omits a category', () => {
  const requiredKeys = ['appVersion', 'deviceManufacturer', 'deviceModel', 'androidVersion', 'cameraIdSpecific', 'lensFacing',
    'cameraIntrinsics', 'focalLength', 'zoomRatio', 'exposureTime', 'isoSensitivity', 'aeState', 'afState',
    'sensorOrientation', 'imageRotationDegrees', 'imageMirrored', 'landmarkConfidence', 'geometryConfidence',
    'distState', 'distanceSignal', 'poseLockState', 'thermalState'];
  requiredKeys.forEach((k) => {
    assert.ok(k in TELEMETRY_INVENTORY, `missing telemetry classification for ${k}`);
    assert.match(TELEMETRY_INVENTORY[k], /^(PRESENT|ABSENT|DERIVABLE)/);
  });
});
test('16: DEFERRED_DERIVED_METRICS documents every Part 7 metric intentionally left uncomputed', () => {
  assert.ok(DEFERRED_DERIVED_METRICS.length >= 5);
  assert.ok(DEFERRED_DERIVED_METRICS.some((s) => /blur/.test(s)));
  assert.ok(DEFERRED_DERIVED_METRICS.some((s) => /angular velocity/.test(s)));
});
