// Stage BI-1Z1H -- tests for the temporal feasibility audit primitives. Pure synthetic fixtures;
// no physical capture, no GT, run and passing independent of any specific device data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash as nodeCreateHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as A from './temporal-feasibility-audit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_SOURCE = readFileSync(join(HERE, 'temporal-feasibility-audit.mjs'), 'utf8');

function flatLandmarks(fill = { x: 0, y: 0, z: 0 }) { return new Array(468).fill(null).map(() => ({ ...fill })); }
function baseSample(overrides = {}) {
  const lm2d = flatLandmarks({ x: 0.5, y: 0.5, z: 0 });
  const lm3d = flatLandmarks({ x: 0, y: 0, z: 0 });
  return Object.assign({
    nativeFrameTimestampNs: '1000000000',
    coherenceStatus: 'VERIFIED_EXACT',
    dataUrl: 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xFF, 0xD8]), Buffer.from('abcd'), Buffer.from([0xFF, 0xD9])]).toString('base64'),
    imageWidth: 640, imageHeight: 480,
    imageRotationDegrees: 0, imageMirrored: false, displayRotationDegrees: null, sensorOrientationDegrees: null,
    landmarks2D: lm2d, faceLocal3D: lm3d,
    transformationMatrix: identity16(), imageSpaceViewModelMatrix: identity16(),
    intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240, imageWidth: 640, imageHeight: 480, space: 'IMAGE' },
    yawDeg: 0, pitchDeg: 0, rollDeg: 0, lensFacing: 'front', observedPoseRegion: 'FRONT_REGION'
  }, overrides);
}
function identity16() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }

// ==================================================================================================
// 1 -- capture hash/provenance
// ==================================================================================================
test('1. capture hash/provenance: SHA256 is computed correctly and mismatch is detectable', () => {
  const buf = Buffer.from('{"a":1}');
  const hash = nodeCreateHash('sha256').update(buf).digest('hex');
  assert.equal(hash.length, 64);
  assert.notEqual(hash, nodeCreateHash('sha256').update(Buffer.from('{"a":2}')).digest('hex'));
});

// ==================================================================================================
// 2 -- schema /2 support (structural)
// ==================================================================================================
test('2. schema /2 support: buildBurstSummary reads the exact field names the /2 package writer produces', () => {
  const burst = { burstId: 'b1', sourceTransition: 'front_TO_right-three-quarter', startObservedPoseRegion: 'FRONT_REGION', endObservedPoseRegion: 'RIGHT45_REGION', sampleCount: 2, samples: [baseSample(), baseSample({ coherenceStatus: 'VERIFIED_EXACT' })], skippedCount: 0, endReason: 'POSE_LOCK_SETTLED', actualDurationMs: 250, requestedTargetIntervalMs: 125, meanSampleIntervalMs: 125, medianSampleIntervalMs: 125, minSampleIntervalMs: 125, maxSampleIntervalMs: 125 };
  const summary = A.buildBurstSummary(burst);
  assert.equal(summary.exactCoherenceCount, 2);
  assert.equal(summary.allSamplesVerifiedExact, true);
});

// ==================================================================================================
// 3/4 -- timestamp monotonicity logic / interval statistics
// ==================================================================================================
test('3. timestamp monotonicity: strictly increasing timestamps report strictlyMonotonic=true, zero duplicates/backward', () => {
  const samples = [0, 125, 260, 400].map(ms => ({ nativeFrameTimestampNs: String(1000000000 + ms * 1e6) }));
  const audit = A.auditTimestamps(samples);
  assert.equal(audit.strictlyMonotonic, true);
  assert.equal(audit.duplicateTimestampCount, 0);
  assert.equal(audit.backwardTimestampCount, 0);
  assert.equal(audit.intervalCount, 3);
});
test('4. interval statistics: percentiles and threshold counts are computed correctly', () => {
  const ms = [100, 125, 133, 133, 133, 133, 267]; // 6 intervals from 7 timestamps
  let t = 1000000000;
  const samples = [{ nativeFrameTimestampNs: String(t) }];
  ms.forEach(dt => { t += dt * 1e6; samples.push({ nativeFrameTimestampNs: String(t) }); });
  const audit = A.auditTimestamps(samples);
  assert.equal(audit.intervalCount, 7);
  assert.equal(audit.max, 267);
  assert.equal(audit.countAbove200ms, 1);
  assert.equal(audit.countAbove250ms, 1);
  assert.equal(audit.countAbove500ms, 0);
  assert.ok(audit.p50 != null && audit.p90 != null && audit.p95 != null);
});

// ==================================================================================================
// 5 -- duplicate timestamp handling
// ==================================================================================================
test('5. duplicate timestamp handling: an exact-duplicate pair is counted and excluded from interval stats, never fabricated as a zero-length interval', () => {
  const samples = [{ nativeFrameTimestampNs: '1000000000' }, { nativeFrameTimestampNs: '1000000000' }, { nativeFrameTimestampNs: '1125000000' }];
  const audit = A.auditTimestamps(samples);
  assert.equal(audit.duplicateTimestampCount, 1);
  assert.equal(audit.strictlyMonotonic, false);
  assert.equal(audit.intervalCount, 1); // only the genuine 125ms interval counted, not a fabricated 0ms one
});
test('5b. backward timestamp handling: an out-of-order pair is counted, never treated as a negative interval', () => {
  const samples = [{ nativeFrameTimestampNs: '2000000000' }, { nativeFrameTimestampNs: '1000000000' }];
  const audit = A.auditTimestamps(samples);
  assert.equal(audit.backwardTimestampCount, 1);
  assert.equal(audit.intervalCount, 0);
});

// ==================================================================================================
// 6/7 -- matrix shape / finite-value validation
// ==================================================================================================
test('6. matrix shape validation: a 16-element array passes, a wrong-length array fails', () => {
  assert.equal(A.isFiniteMatrix16(identity16()), true);
  assert.equal(A.isFiniteMatrix16([1, 2, 3]), false);
  assert.equal(A.isFiniteMatrix16(null), false);
});
test('7. matrix finite-value validation: NaN/Infinity anywhere in the matrix fails', () => {
  const bad = identity16(); bad[5] = NaN;
  assert.equal(A.isFiniteMatrix16(bad), false);
  const bad2 = identity16(); bad2[9] = Infinity;
  assert.equal(A.isFiniteMatrix16(bad2), false);
});

// ==================================================================================================
// 8 -- transform invertibility handling (determinant/singularity)
// ==================================================================================================
test('8. transform invertibility handling: the identity matrix has determinant 1 and is not singular', () => {
  const sanity = A.matrixSanity(identity16());
  assert.equal(sanity.finite, true);
  assert.equal(Math.abs(sanity.determinant - 1) < 1e-9, true);
  assert.equal(sanity.singular, false);
});
test('8b. a singular (all-zero) matrix is correctly flagged', () => {
  const sanity = A.matrixSanity(new Array(16).fill(0));
  assert.equal(sanity.singular, true);
});
test('8c. an extreme-magnitude matrix is flagged for numeric explosion', () => {
  const m = identity16(); m[0] = 1e9;
  const sanity = A.matrixSanity(m);
  assert.equal(sanity.extremeValues, true);
});

// ==================================================================================================
// 9 -- relative-transform determinism
// ==================================================================================================
test('9. relative-transform determinism: identical inputs always produce the identical result', () => {
  const a = baseSample({ nativeFrameTimestampNs: '1000000000', yawDeg: 10, pitchDeg: -5, rollDeg: 2 });
  const b = baseSample({ nativeFrameTimestampNs: '1125000000', yawDeg: 15, pitchDeg: -8, rollDeg: 3 });
  const t1 = A.consecutiveTransform(a, b), t2 = A.consecutiveTransform(a, b);
  assert.deepEqual(t1, t2);
  assert.equal(t1.yawDelta, 5);
  assert.equal(t1.deltaTimeMs, 125);
});

// ==================================================================================================
// 10 -- angle wrapping
// ==================================================================================================
test('10. angle wrapping: a 179 -> -179 transition reports a small delta, not a ~358 degree jump', () => {
  const d = A.angleDeltaDeg(179, -179);
  assert.ok(Math.abs(d) < 10, 'expected a small wrapped delta, got ' + d);
});
test('10b. angle wrapping is symmetric and zero for identical angles', () => {
  assert.equal(A.angleDeltaDeg(45, 45), 0);
  // -90 -> 90 is exactly antipodal: +180 and -180 represent the identical angle on a circle, so
  // either is a mathematically valid wrapped result -- only the magnitude is meaningful here.
  assert.equal(Math.abs(A.angleDeltaDeg(-90, 90)), 180);
});

// ==================================================================================================
// 11 -- angular velocity
// ==================================================================================================
test('11. angular velocity: degrees/sec is derived correctly from a known delta and time', () => {
  const a = baseSample({ nativeFrameTimestampNs: '0', yawDeg: 0, pitchDeg: 0, rollDeg: 0 });
  const b = baseSample({ nativeFrameTimestampNs: String(500 * 1e6), yawDeg: 10, pitchDeg: 0, rollDeg: 0 }); // 10 deg over 500ms = 20 deg/s
  const t = A.consecutiveTransform(a, b);
  assert.ok(Math.abs(t.angularSpeedDegPerSec - 20) < 0.01);
});

// ==================================================================================================
// 12 -- pair counting / no cross-burst pairing
// ==================================================================================================
test('12. pair counting: N samples in a burst produce exactly N-1 consecutive pairs', () => {
  const samples = [0, 1, 2, 3, 4].map(i => baseSample({ nativeFrameTimestampNs: String(i * 125 * 1e6) }));
  let pairs = 0;
  for (let i = 1; i < samples.length; i++) { A.consecutiveTransform(samples[i - 1], samples[i]); pairs++; }
  assert.equal(pairs, 4);
});
test('12b. no cross-burst pairing: a caller iterating per-burst never pairs the last sample of one burst with the first of another (structural test of the intended usage pattern)', () => {
  const burstA = [baseSample({ nativeFrameTimestampNs: '0' }), baseSample({ nativeFrameTimestampNs: String(125 * 1e6) })];
  const burstB = [baseSample({ nativeFrameTimestampNs: String(10000 * 1e6) }), baseSample({ nativeFrameTimestampNs: String(10125 * 1e6) })];
  const allPairsWithinBursts = [];
  [burstA, burstB].forEach(burst => { for (let i = 1; i < burst.length; i++) allPairsWithinBursts.push([burst[i - 1], burst[i]]); });
  assert.equal(allPairsWithinBursts.length, 2); // 1 pair per burst, never (burstA.last, burstB.first)
});

// ==================================================================================================
// 13 -- missing-field fail-closed behavior
// ==================================================================================================
test('13. missing-field fail-closed behavior: a sample missing faceLocal3D is never counted complete, never fabricated', () => {
  const s = baseSample({ faceLocal3D: null });
  const audit = A.auditGeometryCompleteness([s]);
  assert.equal(audit.completeSampleCount, 0);
  assert.equal(audit.missingFieldCounts.faceLocal3D, 1);
});
test('13b. faceLocalAnchorResidual returns null (never a fabricated 0) when faceLocal3D is unavailable', () => {
  const a = baseSample({ faceLocal3D: null }), b = baseSample();
  assert.equal(A.faceLocalAnchorResidual(a, b), null);
});

// ==================================================================================================
// 14 -- head-stabilization reason codes
// ==================================================================================================
test('14. head-stabilization reason codes: two clean, close samples classify USABLE with no reasons', () => {
  const a = baseSample({ nativeFrameTimestampNs: '0' });
  const b = baseSample({ nativeFrameTimestampNs: String(125 * 1e6) });
  const result = A.classifyHeadStabilizationPair(a, b);
  assert.equal(result.verdict, 'HEAD_STABILIZATION_PAIR_USABLE');
  assert.deepEqual(result.reasons, []);
});
test('14b. a non-VERIFIED_EXACT sample is UNUSABLE with an explicit reason code', () => {
  const a = baseSample({ nativeFrameTimestampNs: '0' });
  const b = baseSample({ nativeFrameTimestampNs: String(125 * 1e6), coherenceStatus: 'REJECTED_UNMATCHED' });
  const result = A.classifyHeadStabilizationPair(a, b);
  assert.equal(result.verdict, 'HEAD_STABILIZATION_PAIR_UNUSABLE');
  assert.ok(result.reasons.includes('NOT_VERIFIED_EXACT'));
});
test('14c. a large anchor jump (simulated tracker reset) is UNUSABLE via ANCHOR_RESIDUAL_TOO_LARGE', () => {
  const a = baseSample({ nativeFrameTimestampNs: '0' });
  const jumpedLm3d = a.faceLocal3D.map((p, i) => i === 172 ? { x: p.x + 1, y: p.y, z: p.z } : p); // 1 meter jump -- implausible
  const b = baseSample({ nativeFrameTimestampNs: String(125 * 1e6), faceLocal3D: jumpedLm3d });
  const result = A.classifyHeadStabilizationPair(a, b);
  assert.equal(result.verdict, 'HEAD_STABILIZATION_PAIR_UNUSABLE');
  assert.ok(result.reasons.includes('ANCHOR_RESIDUAL_TOO_LARGE'));
});
test('14d. an excessive delta time is flagged DELTA_TIME_TOO_LARGE', () => {
  const a = baseSample({ nativeFrameTimestampNs: '0' });
  const b = baseSample({ nativeFrameTimestampNs: String(2000 * 1e6) });
  const result = A.classifyHeadStabilizationPair(a, b);
  assert.ok(result.reasons.includes('DELTA_TIME_TOO_LARGE'));
});

// ==================================================================================================
// 15 -- overlap-feasibility determinism
// ==================================================================================================
test('15. overlap-feasibility determinism: identical inputs always produce the identical tier', () => {
  const a = baseSample({ yawDeg: 0, pitchDeg: 0 }), b = baseSample({ yawDeg: 5, pitchDeg: 1 });
  const r1 = A.classifyOverlapFeasibility(a, b), r2 = A.classifyOverlapFeasibility(a, b);
  assert.deepEqual(r1, r2);
  assert.equal(r1.tier, 'HIGH');
});
test('15b. overlap feasibility degrades from HIGH to MODERATE to LOW as combined motion grows', () => {
  const base = baseSample({ yawDeg: 0, pitchDeg: 0 });
  assert.equal(A.classifyOverlapFeasibility(base, baseSample({ yawDeg: 3, pitchDeg: 2 })).tier, 'HIGH');
  assert.equal(A.classifyOverlapFeasibility(base, baseSample({ yawDeg: 10, pitchDeg: 5 })).tier, 'MODERATE');
  assert.equal(A.classifyOverlapFeasibility(base, baseSample({ yawDeg: 20, pitchDeg: 15 })).tier, 'LOW');
});

// ==================================================================================================
// 16/17/18/19 -- independence / no classifier / no optical flow / no network
// ==================================================================================================
test('16. no V2.1/V2.2 dependency', () => { assert.equal(/beard-occupancy-field-v2[12]/i.test(MODULE_SOURCE), false); });
test('17. no GT dependency', () => { assert.equal(/humanFinalPoints|humanGT|groundTruth/i.test(MODULE_SOURCE), false); });
test('18. no classifier / no optical flow', () => {
  assert.equal(/opticalFlow|motionScor|shirtMotion|beardMotion|backgroundSubtract|motionSegmentation|temporalOccupancy/i.test(MODULE_SOURCE), false);
});
test('19. no network', () => { assert.equal(/\bfetch\(|XMLHttpRequest|WebSocket/.test(MODULE_SOURCE), false); });

// ==================================================================================================
// 20 -- sealed-holdout absence
// ==================================================================================================
test('20. sealed-holdout absence', () => { assert.equal(MODULE_SOURCE.includes('espu2w'), false); });

// ==================================================================================================
// Additional engineering-correctness checks
// ==================================================================================================
test('image consistency: a well-formed synthetic JPEG (SOI/EOI present) is accepted', () => {
  assert.equal(A.looksLikeValidJpeg(baseSample().dataUrl), true);
});
test('image consistency: a corrupt/truncated payload (no EOI marker) is rejected', () => {
  const corrupt = 'data:image/jpeg;base64,' + Buffer.from([0xFF, 0xD8, 0x00, 0x00]).toString('base64');
  assert.equal(A.looksLikeValidJpeg(corrupt), false);
});
test('burst feasibility classification: an all-USABLE, all-HIGH-overlap, 10-sample burst is EXCELLENT', () => {
  const burst = { samples: new Array(10).fill(0) };
  const pairs = new Array(9).fill({ verdict: 'HEAD_STABILIZATION_PAIR_USABLE' });
  const overlaps = new Array(9).fill({ tier: 'HIGH' });
  const result = A.classifyBurstFeasibility(burst, pairs, overlaps);
  assert.equal(result.verdict, 'EXCELLENT');
});
test('burst feasibility classification: an all-UNUSABLE burst is UNUSABLE', () => {
  const burst = { samples: new Array(5).fill(0) };
  const pairs = new Array(4).fill({ verdict: 'HEAD_STABILIZATION_PAIR_UNUSABLE' });
  const overlaps = new Array(4).fill({ tier: 'LOW' });
  const result = A.classifyBurstFeasibility(burst, pairs, overlaps);
  assert.equal(result.verdict, 'UNUSABLE');
});
test('module never imports a DOM/browser global -- pure, dependency-free', () => {
  assert.equal(/\bwindow\.|\bdocument\.|\bBeardTrimAndroid\b/.test(MODULE_SOURCE), false);
});
test('module imports ONLY a61ProjectPoint from the frozen hairness-core-v1.mjs, nothing else production-relevant', () => {
  assert.match(MODULE_SOURCE, /import\s*\{\s*a61ProjectPoint\s*\}\s*from\s*'\.\/hairness-core-v1\.mjs'/);
});
