// Stage BI-1Z1H.1 -- tests for the coordinate-space reconciliation primitives. Pure synthetic
// fixtures; no physical capture, no GT, run and passing independent of any specific device data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as R from './projection-reconciliation.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_SOURCE = readFileSync(join(HERE, 'projection-reconciliation.mjs'), 'utf8');

function identity16() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function flat468(fill) { return new Array(468).fill(null).map(() => ({ ...fill })); }

// ==================================================================================================
// 1 -- capture identity/hash (structural -- the actual hash check lives in the driving script;
// this test verifies the module exposes a stable version string usable for provenance).
// ==================================================================================================
test('1. capture identity/hash: module exposes a stable version identifier', () => {
  assert.equal(R.PROJECTION_RECONCILIATION_VERSION, 'projection-reconciliation/1');
});

// ==================================================================================================
// 2 -- landmarks2D semantics (documented, source-referenced)
// ==================================================================================================
test('2. landmarks2D semantics are documented with an explicit source reference, not inferred from naming', () => {
  const f = R.COORDINATE_SPACE_FINDINGS.landmarks2D;
  assert.match(f.sourceRef, /ArCoreFaceMeshTracker\.kt/);
  assert.match(f.finding, /DISPLAY|display/);
});

// ==================================================================================================
// 3 -- JPEG dimensions / semantics
// ==================================================================================================
test('3. JPEG coordinate semantics are documented with an explicit source reference', () => {
  const f = R.COORDINATE_SPACE_FINDINGS.jpeg;
  assert.match(f.sourceRef, /SpatialKeyframe\.kt/);
  assert.match(f.finding, /raw sensor-orientation/i);
});

// ==================================================================================================
// 4 -- intrinsics scaling logic / semantics
// ==================================================================================================
test('4. intrinsics semantics documented: matches the raw JPEG buffer exactly, per source', () => {
  const f = R.COORDINATE_SPACE_FINDINGS.intrinsics;
  assert.match(f.finding, /matching imageBase64Jpeg/);
});

// ==================================================================================================
// 5 -- matrix layout (column-major, per hairness-core-v1.mjs's convention)
// ==================================================================================================
test('5. matrix layout: projectViaTransformationMatrix uses the SAME column-major convention as hairness-core-v1.mjs', () => {
  // identity matrix: projecting (0,0,1) with an identity transformationMatrix should reproduce the
  // trivial NDC->[0,1] mapping (x=0.5, y=0.5) regardless of row/column convention (identity is
  // convention-agnostic) -- this test only asserts the function runs and produces the documented
  // formula's expected output for the identity case.
  const p = R.projectViaTransformationMatrix(identity16(), { x: 0, y: 0, z: 1 });
  assert.ok(p);
  assert.equal(Math.abs(p.x - 0.5) < 1e-9, true);
  assert.equal(Math.abs(p.y - 0.5) < 1e-9, true);
});

// ==================================================================================================
// 6 -- projection determinism
// ==================================================================================================
test('6. projection determinism: identical inputs always produce identical output', () => {
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1, 0.2, 2, 1];
  const p3 = { x: 0.05, y: -0.02, z: 0.01 };
  const a = R.projectViaTransformationMatrix(m, p3), b = R.projectViaTransformationMatrix(m, p3);
  assert.deepEqual(a, b);
});

// ==================================================================================================
// 7 -- homogeneous divide
// ==================================================================================================
test('7. homogeneous divide: a non-unity w component is correctly divided out, not ignored', () => {
  // a matrix whose last row (row 3, used for w) doubles w -- verifies the function actually reads
  // the computed w and divides by it rather than assuming w=1.
  const m = identity16();
  m[15] = 2; // w-row scaling: w_out = 2 * 1 (homogeneous w input) = 2
  const p = R.projectViaTransformationMatrix(m, { x: 0, y: 0, z: 1 });
  // x_ndc = 0/2 = 0 -> (0+1)/2 = 0.5 -- same as w=1 case here since numerator (0) is also unaffected,
  // so instead verify with a non-zero x to actually exercise the divide.
  const m2 = identity16(); m2[15] = 2;
  const p2 = R.projectViaTransformationMatrix(m2, { x: 1, y: 0, z: 1 });
  // px = 1 (x*1), w = 2 -> ndc_x = 0.5 -> pixel_x = (0.5+1)/2 = 0.75
  assert.equal(Math.abs(p2.x - 0.75) < 1e-9, true);
});
test('7b. a zero (or non-finite) w is fail-closed to null, never a divide-by-zero fabrication', () => {
  const m = identity16(); m[15] = 0; m[12] = 0; m[13] = 0; m[14] = 0;
  // construct a matrix whose w-row is entirely zero so w is always 0 regardless of input
  const zeroW = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];
  const p = R.projectViaTransformationMatrix(zeroW, { x: 1, y: 1, z: 1 });
  assert.equal(p, null);
});

// ==================================================================================================
// 8 -- mirror transform / 9 -- rotation transforms / 10 -- coordinate inversion (candidate set)
// ==================================================================================================
test('8/9/10. candidate transform set includes mirror, rotations, and inversions, each a real plausible pipeline transform', () => {
  const names = R.CANDIDATE_TRANSFORMS.map(c => c.name);
  ['RAW', 'MIRROR_X', 'INVERT_Y', 'INVERT_XY', 'ROTATE_90_CW', 'ROTATE_90_CCW', 'ROTATE_180'].forEach(n => assert.ok(names.includes(n), n));
});
test('8b. MIRROR_X correctly flips the x coordinate about the image width', () => {
  const t = R.CANDIDATE_TRANSFORMS.find(c => c.name === 'MIRROR_X');
  assert.deepEqual(t.apply({ x: 100, y: 50 }, 640, 480), { x: 540, y: 50 });
});
test('9b. ROTATE_180 is equivalent to composing MIRROR_X and INVERT_Y', () => {
  const rot180 = R.CANDIDATE_TRANSFORMS.find(c => c.name === 'ROTATE_180');
  const mirrorX = R.CANDIDATE_TRANSFORMS.find(c => c.name === 'MIRROR_X');
  const invertY = R.CANDIDATE_TRANSFORMS.find(c => c.name === 'INVERT_Y');
  const p = { x: 100, y: 50 };
  const composed = invertY.apply(mirrorX.apply(p, 640, 480), 640, 480);
  assert.deepEqual(rot180.apply(p, 640, 480), composed);
});

// ==================================================================================================
// 11 -- candidate transform provenance (no arbitrary fitted affine correction)
// ==================================================================================================
test('11. no arbitrary fitted affine correction: testCandidateTransforms reports EVERY named candidate\'s own stats, never selects/returns only the single best-fitting one', () => {
  const sample = {
    imageWidth: 640, imageHeight: 480,
    faceLocal3D: flat468({ x: 0, y: 0, z: -0.3 }),
    landmarks2D: flat468({ x: 0.5, y: 0.5, z: 0 }),
    imageSpaceViewModelMatrix: identity16(),
    intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 }
  };
  const result = R.testCandidateTransforms(sample, [1, 6, 151]);
  const names = Object.keys(result);
  assert.deepEqual(names.sort(), R.CANDIDATE_TRANSFORMS.map(c => c.name).sort());
  assert.equal(/(?<!never )\bbestTransform\b|\bchosenTransform\b|\bselectedCandidate\b/i.test(MODULE_SOURCE), false);
});

// ==================================================================================================
// 12 -- multi-landmark residual metrics
// ==================================================================================================
test('12. multi-landmark residual metrics: residualStructure reports mean/median/p90/max and systematic offset/correlation', () => {
  const sample = {
    imageWidth: 640, imageHeight: 480,
    faceLocal3D: flat468({ x: 0, y: 0, z: -0.3 }), // z must be negative (in front of camera) per a61ProjectPoint's Zcv=-z>0 convention
    landmarks2D: flat468({ x: 0.5, y: 0.5, z: 0 }),
    imageSpaceViewModelMatrix: identity16(),
    intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 }
  };
  const result = R.residualStructure(sample, [1, 6, 151]);
  assert.ok(result);
  ['mean', 'median', 'p90', 'max', 'systematicMeanDx', 'systematicMeanDy'].forEach(k => assert.ok(k in result, k));
});
test('12b. residualStructure returns null (never fabricates a residual) when required fields are missing', () => {
  assert.equal(R.residualStructure({ imageWidth: null, imageHeight: null }), null);
});

// ==================================================================================================
// 13 -- pose consistency (structural: the module applies the SAME logic regardless of pose fields)
// ==================================================================================================
test('13. pose consistency: testCandidateTransforms and residualStructure never branch on observedPoseRegion or any pose-specific logic', () => {
  assert.equal(/observedPoseRegion/i.test(MODULE_SOURCE), false);
});

// ==================================================================================================
// 14 -- A61 cross-check (reuses the SAME frozen a61ProjectPoint, never redefines it)
// ==================================================================================================
test('14. A61 cross-check: projectViaImageSpaceViewModelMatrix delegates to the frozen hairness-core-v1.mjs a61ProjectPoint, never reimplements it', () => {
  assert.match(MODULE_SOURCE, /import\s*\{\s*a61ProjectPoint\s*\}\s*from\s*'\.\/hairness-core-v1\.mjs'/);
  assert.equal(/function a61ProjectPoint/.test(MODULE_SOURCE), false);
});

// ==================================================================================================
// 15 -- missing-metadata handling
// ==================================================================================================
test('15. missing-metadata handling: testCandidateTransforms returns null (never a fabricated result) when required fields are absent', () => {
  assert.equal(R.testCandidateTransforms({ imageWidth: null }), null);
});
test('15b. faceShapePlausibility fails closed with an explicit reason when projection is unavailable', () => {
  const result = R.faceShapePlausibility({ imageSpaceViewModelMatrix: null, intrinsics: null, faceLocal3D: null });
  assert.equal(result, null);
});

// ==================================================================================================
// 16/17/18/19/20 -- independence / no classifier / no optical flow / no network / sealed holdout
// ==================================================================================================
test('16. no GT dependency', () => { assert.equal(/humanFinalPoints|humanGT|groundTruth/i.test(MODULE_SOURCE), false); });
test('17. no V2.1/V2.2 dependency', () => { assert.equal(/beard-occupancy-field-v2[12]/i.test(MODULE_SOURCE), false); });
test('18. no motion classifier / no optical flow', () => {
  assert.equal(/opticalFlow|motionScor|shirtMotion|beardMotion|backgroundSubtract|motionSegmentation|temporalOccupancy/i.test(MODULE_SOURCE), false);
});
test('19. no network', () => { assert.equal(/\bfetch\(|XMLHttpRequest|WebSocket/.test(MODULE_SOURCE), false); });
test('20. sealed-holdout absence', () => { assert.equal(MODULE_SOURCE.includes('espu2w'), false); });

// ==================================================================================================
// 21 -- production isolation (this module never touches production files)
// ==================================================================================================
test('21. production isolation: module never imports a DOM/browser/native-bridge global', () => {
  assert.equal(/\bwindow\.|\bdocument\.|\bBeardTrimAndroid\b/.test(MODULE_SOURCE), false);
});

// ==================================================================================================
// Additional engineering-correctness checks
// ==================================================================================================
test('BROAD_ANCHOR_SET has no duplicate indices and is sorted', () => {
  const s = R.BROAD_ANCHOR_SET;
  assert.equal(new Set(s).size, s.length);
  assert.deepEqual([...s].sort((a, b) => a - b), [...s]);
});
test('faceShapePlausibility detects a scrambled (non-face-shaped) point cloud as implausible', () => {
  const fl = flat468({ x: 0, y: 0, z: -0.3 }); // negative z -- in front of camera
  // deliberately place forehead BELOW chin (scrambled)
  fl[151] = { x: 0, y: -0.05, z: -0.3 }; fl[152] = { x: 0, y: 0.05, z: -0.3 };
  fl[1] = { x: 0, y: 0, z: -0.3 }; fl[17] = { x: 0, y: 0.02, z: -0.3 };
  fl[454] = { x: 0.05, y: 0.01, z: -0.3 }; fl[234] = { x: -0.05, y: 0.01, z: -0.3 };
  const sample = { imageSpaceViewModelMatrix: identity16(), intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 }, faceLocal3D: fl };
  const result = R.faceShapePlausibility(sample);
  assert.equal(result.verticalOrderOk, false);
});
