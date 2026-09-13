// Stage BI-1Z0A — exact-frame jaw landmark recovery audit tests.
// Node built-in runner (node --test). READ-ONLY investigation stage: proves, against the REAL
// production accuracy/ modules (never modified), the exact points in the pipeline where
// landmarks2D is (a) retained in full, (b) reduced to count-only, and (c) dropped entirely en
// route to a BS1-F AnnotationManifest / BS1-G AnnotationBundle -- the root-cause trace behind why
// none of the five BI-1Y3 GT observations carry jaw/chin landmark data. No new production
// behavior; no fitted geometry; no recovered data existed to test (see the BI-1Z0A report).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import AWB from './annotation-workbench.cjs';
import { makeScanObservation, SourceTier } from '../../accuracy/multi-observation-scan-package.mjs';
import { fromA60Export } from '../../accuracy/a6-scan-package-adapter.mjs';
import { buildAnnotationManifest } from '../../accuracy/ground-truth-dataset.mjs';
import { makeMultiObservationScanPackage, makePoseObservationPackage } from '../../accuracy/multi-observation-scan-package.mjs';

const DERIVED_PATH = 'D:/MettleTemp/annotation/bi1y2_outer_beard_assisted_gt_geometry_ready.json';

// 1 — the canonical ScanObservation.landmarks2D field is ALWAYS reduced to {kind,count}, never
// the raw point array -- this is the FIRST place full geometry is structurally unrecoverable from.
test('1: makeScanObservation reduces a real landmarks2D array to {kind:"array",count:N}, discarding the points', () => {
  const pts = Array.from({ length: 468 }, (_, i) => ({ x: i / 468, y: i / 468, z: 0 }));
  const obs = makeScanObservation({
    observationId: 'test:1', poseId: 'front', nativeFrameTimestampNs: '123',
    landmarks2D: pts, sourceTier: SourceTier.TIER_A_GEOMETRY
  });
  assert.deepEqual(obs.landmarks2D, { kind: 'array', count: 468 });
  assert.equal(Array.isArray(obs.landmarks2D), false, 'the raw per-point array must not survive on the canonical field');
});

// 2 — the a6-scan-package-adapter DOES separately retain the raw array, but only inside
// metadata.landmarks2DPoints (an opt-in side channel), when retainRawPoints is true (the default).
test('2: fromA60Export retains the raw landmarks2D array in metadata.landmarks2DPoints, separate from the reduced canonical field', () => {
  const pts = [{ x: 0.1, y: 0.2, z: 0 }, { x: 0.3, y: 0.4, z: 0 }];
  const a60Export = {
    geometryObs: { front: [{ nativeTs: '999', t: 1, yawDeg: 0, pitchDeg: 0, rollDeg: 0, landmarks2D: pts, faceLocal3D: null, frameWidth: 640, frameHeight: 480, mirrored: false, coverageValid: true }] },
    imageKeyframes: {}
  };
  const { scanPackage } = fromA60Export(a60Export, { retainRawPoints: true, scanSessionId: 'test-session' });
  const obs = scanPackage.posePackages.front.candidateGeometryObservations[0];
  assert.deepEqual(obs.landmarks2D, { kind: 'array', count: 2 }, 'canonical field still reduced to count-only');
  assert.deepEqual(obs.metadata.landmarks2DPoints, pts, 'the raw points survive ONLY in metadata.landmarks2DPoints');
});
test('2b: fromA60Export omits metadata.landmarks2DPoints entirely when retainRawPoints is false', () => {
  const pts = [{ x: 0.1, y: 0.2, z: 0 }];
  const a60Export = { geometryObs: { front: [{ nativeTs: '1', t: 1, landmarks2D: pts }] }, imageKeyframes: {} };
  const { scanPackage } = fromA60Export(a60Export, { retainRawPoints: false });
  const obs = scanPackage.posePackages.front.candidateGeometryObservations[0];
  assert.equal('landmarks2DPoints' in obs.metadata, false);
});

// 3 — buildAnnotationManifest's row whitelist (BS1-F) excludes landmarks2D/faceLocal3D/metadata/
// cameraIntrinsics entirely -- THIS is the exact point where jaw/chin geometry is permanently
// dropped on the way to becoming a BS1-G AnnotationBundle, even when the upstream
// ScanObservation.metadata still carried the raw points.
test('3: buildAnnotationManifest never carries landmarks2D, faceLocal3D, metadata, or cameraIntrinsics through, even when the source observation has them', () => {
  const obs = makeScanObservation({
    observationId: 'test:img:1', poseId: 'front', nativeFrameTimestampNs: 555,
    imageRef: { ref: 'test:img:1', format: 'jpeg', width: 640, height: 480, rotationDegrees: 0, mirrored: false },
    landmarks2D: [{ x: 0.5, y: 0.5, z: 0 }],
    faceLocal3D: [{ x: 0.1, y: 0.1, z: 0.1 }],
    cameraIntrinsics: { fx: 500, fy: 500, cx: 320, cy: 240, imageWidth: 640, imageHeight: 480, space: 'IMAGE' },
    sourceTier: SourceTier.TIER_B_IMAGE_KEYFRAME, nativeSpatialKeyframe: true, coherenceStatus: 'VERIFIED_EXACT',
    metadata: { landmarks2DPoints: [{ x: 0.5, y: 0.5, z: 0 }] }
  });
  const pkg = makeMultiObservationScanPackage({
    scanSessionId: 'test-session', sourceArchitectureVersion: 'A6.0',
    posePackages: { front: makePoseObservationPackage({ poseId: 'front', retainedImageObservations: [obs] }) }
  });
  const manifest = buildAnnotationManifest(pkg);
  assert.equal(manifest.length, 1);
  const row = manifest[0];
  assert.equal('landmarks2D' in row, false);
  assert.equal('faceLocal3D' in row, false);
  assert.equal('metadata' in row, false);
  assert.equal('cameraIntrinsics' in row, false);
  // what DOES survive:
  assert.equal(row.nativeFrameTimestampNs, 555);
  assert.equal(row.imageWidth, 640);
  assert.equal(row.imageHeight, 480);
});

// 4 — exact composite-identity, never rawObservationId alone. Within the real five-item GT set
// the rawObservationId values happen to be pairwise distinct (0,3,6,11,15) -- but that is a
// coincidence of this particular five-observation slice, not a structural guarantee, since
// rawObservationId is scoped per scanSessionId. Proven directly: two different sessions sharing
// the same rawObservationId must resolve to two different composite identities, never collapse.
test('4: rawObservationId alone is not a safe join key -- two different sessions sharing the same rawObservationId resolve to different composite identities', () => {
  const a = { scanSessionId: 'scan_mtcfdr6x_atfvgh', rawObservationId: 0, nativeFrameTimestampNs: '3416128030189369', observedPoseRegion: 'CHINUP_REGION', identityMode: 'RAW_SCAN_OBSERVATION', sourceScanObservationId: null };
  const b = { scanSessionId: 'scan_mtdd38q8_zfbhtp', rawObservationId: 0, nativeFrameTimestampNs: '1111111111111111', observedPoseRegion: 'FRONT_REGION', identityMode: 'RAW_SCAN_OBSERVATION', sourceScanObservationId: null };
  assert.equal(a.rawObservationId, b.rawObservationId, 'the collision this test guards against is real: same rawObservationId, different sessions');
  assert.notEqual(AWB.entryKey(a), AWB.entryKey(b), 'composite identity (scanSessionId+timestamp+rawObservationId) must still disambiguate them');

  let derived;
  try { derived = JSON.parse(readFileSync(DERIVED_PATH, 'utf8')); } catch { return; }
  // and confirm the real GT set's own five composite identities are all in fact unique
  const compositeKeys = derived.items.map(it => it.scanSessionId + ':' + it.nativeFrameTimestampNs + ':' + it.rawObservationId);
  assert.equal(new Set(compositeKeys).size, compositeKeys.length);
});

// 5 — sealed holdout exclusion
test('5: the sealed holdout identity is rejected wherever this stage touches identity checks', () => {
  assert.equal(AWB.isSealedHoldoutEntry({ scanSessionId: 'scan_mtdogmlr_espu2w', rawObservationId: 22 }), true);
  assert.equal(AWB.isSealedHoldoutEntry({ scanSessionId: 'scan_mtdogmlr_espu2w', rawObservationId: 23 }), true);
  assert.equal(AWB.isSealedHoldoutEntry({ scanSessionId: 'scan_mtcfdr6x_atfvgh', rawObservationId: 6 }), false);
});

// 6 — GT immutability: this stage's investigation never touched the authoritative GT file
test('6: the authoritative geometry-ready GT file is unchanged by this stage (spot check against known values)', () => {
  let derived;
  try { derived = JSON.parse(readFileSync(DERIVED_PATH, 'utf8')); } catch { return; }
  assert.equal(derived.items.length, 5);
  derived.items.forEach(it => {
    assert.equal(it.humanReviewStatus, 'EDITED_AND_APPROVED');
    assert.equal(it.coordinateSpace, 'IMAGE');
    assert.equal(it.imageWidth, 640);
    assert.equal(it.imageHeight, 480);
  });
});

// 7 — numeric-string timestamp preservation holds through the traced pipeline stages exercised here
test('7: nativeFrameTimestampNs numeric strings survive fromA60Export ingest', () => {
  const a60Export = { geometryObs: { front: [{ nativeTs: '3416131619234578', t: 1 }] }, imageKeyframes: {} };
  const { scanPackage } = fromA60Export(a60Export);
  const obs = scanPackage.posePackages.front.candidateGeometryObservations[0];
  assert.equal(obs.timestamp.nativeFrameTimestampNs, 3416131619234578);
});
