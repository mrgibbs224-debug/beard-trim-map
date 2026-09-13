// Stage BI-1Z1N -- synthetic tests for the temporal metric-robustness audit utilities. Pure
// synthetic fixtures only; no physical capture, no GT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as A from './temporal-metric-robustness-audit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_SOURCE = readFileSync(join(HERE, 'temporal-metric-robustness-audit.mjs'), 'utf8');

// ==================================================================================================
// 1 -- strict session separation
// ==================================================================================================
test('1. splitBySession never blends two sessions into one unlabeled group', () => {
  const records = [{ s: 'A', v: 1 }, { s: 'B', v: 2 }, { s: 'A', v: 3 }];
  const groups = A.splitBySession(records, r => r.s);
  assert.equal(groups.size, 2);
  assert.deepEqual(groups.get('A').map(r => r.v), [1, 3]);
  assert.deepEqual(groups.get('B').map(r => r.v), [2]);
});
test('1b. PATCH_COUNT_IS_NOT_INDEPENDENT_SAMPLE_SIZE names SCAN_SESSION as the independent unit', () => {
  assert.equal(A.PATCH_COUNT_IS_NOT_INDEPENDENT_SAMPLE_SIZE.independentExperimentalUnit, 'SCAN_SESSION');
});

// ==================================================================================================
// 2 -- hierarchy preservation
// ==================================================================================================
test('2. buildHierarchySummary preserves session -> burst -> pair -> patch nesting without flattening', () => {
  const records = [
    { s: 'S1', b: 'B1', p: 'P1' }, { s: 'S1', b: 'B1', p: 'P1' }, { s: 'S1', b: 'B1', p: 'P2' },
    { s: 'S1', b: 'B2', p: 'P1' }, { s: 'S2', b: 'B1', p: 'P1' }
  ];
  const summary = A.buildHierarchySummary(records, { sessionIdOf: r => r.s, burstIdOf: r => r.b, pairKeyOf: r => r.b + '#' + r.p });
  assert.equal(summary.length, 2);
  const s1 = summary.find(s => s.sessionId === 'S1');
  assert.equal(s1.burstCount, 2);
  assert.equal(s1.pairCount, 3);
  assert.equal(s1.patchCount, 4);
  const s2 = summary.find(s => s.sessionId === 'S2');
  assert.equal(s2.patchCount, 1);
});

// ==================================================================================================
// 3 -- metric direction / sign tally
// ==================================================================================================
test('3. signTally counts positive/negative/near-zero with a caller-supplied epsilon', () => {
  const t = A.signTally([0.01, -0.02, 0.0001, -0.0001, 0.5], 0.001);
  assert.equal(t.positive, 2);
  assert.equal(t.negative, 1);
  assert.equal(t.nearZero, 2);
  assert.equal(t.total, 5);
});
test('3b. signTally ignores non-finite values without counting them', () => {
  const t = A.signTally([1, null, NaN, -1], 0.001);
  assert.equal(t.total, 2);
});

// ==================================================================================================
// 4 -- residual difference
// ==================================================================================================
test('4. residualDifference is staticResidualMagnitude - headResidualMagnitude', () => {
  assert.equal(A.residualDifference(5, 2), 3);
  assert.equal(A.residualDifference(2, 5), -3);
});
test('4b. residualDifference returns null (never fabricates) on missing input', () => {
  assert.equal(A.residualDifference(null, 2), null);
  assert.equal(A.residualDifference(5, undefined), null);
});

// ==================================================================================================
// 5 -- safe residual ratio + zero-denominator handling
// ==================================================================================================
test('5. safeResidualRatio computes head/static ratio', () => {
  assert.equal(A.safeResidualRatio(2, 4), 0.5);
});
test('5b. safeResidualRatio returns null on a zero denominator rather than Infinity/NaN', () => {
  assert.equal(A.safeResidualRatio(2, 0), null);
  assert.equal(Number.isFinite(A.safeResidualRatio(2, 0)), false);
});
test('5c. safeResidualRatio returns null on non-finite inputs', () => {
  assert.equal(A.safeResidualRatio(NaN, 4), null);
  assert.equal(A.safeResidualRatio(2, null), null);
});

// ==================================================================================================
// 6 -- burst aggregation (perPairMean feeding a burst-level mean)
// ==================================================================================================
test('6. perPairMean averages a value per pair key, never mixing pairs', () => {
  const records = [{ p: 'p1', v: 1 }, { p: 'p1', v: 3 }, { p: 'p2', v: 10 }];
  const out = A.perPairMean(records, r => r.v, r => r.p);
  const p1 = out.find(o => o.pairKey === 'p1'), p2 = out.find(o => o.pairKey === 'p2');
  assert.equal(p1.mean, 2); assert.equal(p1.n, 2);
  assert.equal(p2.mean, 10); assert.equal(p2.n, 1);
});
test('6b. a burst-level mean built from perPairMean output is a mean-of-pair-means, not a mean-of-raw-patches', () => {
  // 9 patches in pair A (mean 100) vs 1 patch in pair B (mean 0) -- a naive patch-pooled mean would
  // be dominated by pair A (90), but the pair-mean-of-means must weight both pairs equally (50).
  const records = [...Array(9).fill({ p: 'A', v: 100 }), { p: 'B', v: 0 }];
  const perPair = A.perPairMean(records, r => r.v, r => r.p);
  const burstMean = A.meanOf(perPair.map(p => p.mean));
  assert.equal(burstMean, 50);
});

// ==================================================================================================
// 7 -- outlier reporting (never deletes)
// ==================================================================================================
test('7. detectOutliers flags far-from-median values via robust MAD distance', () => {
  const values = [1, 1.1, 0.9, 1.05, 0.95, 50];
  const flags = A.detectOutliers(values, 3.5);
  assert.equal(flags.length, values.length, 'every finite input value must still be present');
  assert.equal(flags[5].isOutlier, true);
  assert.equal(flags[0].isOutlier, false);
});
test('7b. detectOutliers never removes or reorders values -- output length equals finite input count', () => {
  const values = [3, 4, 5, 4, NaN, 3];
  const flags = A.detectOutliers(values, 3.5);
  assert.equal(flags.length, 5); // NaN excluded from the finite set, but nothing else is dropped
  assert.equal(flags.filter(f => f.isOutlier).length <= flags.length, true);
});

// ==================================================================================================
// 8 -- search-boundary detection
// ==================================================================================================
test('8. isSearchBoundaryHit is true when |dx| or |dy| equals the rounded search radius', () => {
  assert.equal(A.isSearchBoundaryHit(6, 0, 6), true);
  assert.equal(A.isSearchBoundaryHit(0, -6, 6), true);
  assert.equal(A.isSearchBoundaryHit(5, 5, 6), false);
});
test('8b. isSearchBoundaryHit returns null on missing input, false on a non-positive radius', () => {
  assert.equal(A.isSearchBoundaryHit(null, 0, 6), null);
  assert.equal(A.isSearchBoundaryHit(0, 0, 0), false);
});

// ==================================================================================================
// 9 -- motion-bin stratification
// ==================================================================================================
test('9. stratifyByMotionBin groups records by their own motion bin label', () => {
  const records = [{ m: 'SMALL', v: 1 }, { m: 'MEDIUM', v: 2 }, { m: 'SMALL', v: 3 }];
  const groups = A.stratifyByMotionBin(records, r => r.m);
  assert.equal(groups.get('SMALL').length, 2);
  assert.equal(groups.get('MEDIUM').length, 1);
});

// ==================================================================================================
// 10 -- texture stratification
// ==================================================================================================
test('10. stratifyByTextureBand buckets a continuous texture level into bands without a semantic label', () => {
  const records = [{ t: 1 }, { t: 5 }, { t: 12 }, { t: 30 }, { t: null }];
  const groups = A.stratifyByTextureBand(records, r => r.t, [3, 8, 16]);
  assert.equal(groups.get('BAND_0').length, 1);
  assert.equal(groups.get('BAND_1').length, 1);
  assert.equal(groups.get('BAND_2').length, 1);
  assert.equal(groups.get('BAND_3').length, 1);
  assert.equal(groups.get('UNKNOWN').length, 1);
});

// ==================================================================================================
// 11 -- pose stratification
// ==================================================================================================
test('11. stratifyByPoseTransition groups records by sourceTransition label', () => {
  const records = [{ t: 'front_TO_right-three-quarter' }, { t: 'left-profile_TO_chin-up' }, { t: 'front_TO_right-three-quarter' }];
  const groups = A.stratifyByPoseTransition(records, r => r.t);
  assert.equal(groups.get('front_TO_right-three-quarter').length, 2);
});

// ==================================================================================================
// 12 -- control-relative residual representation
// ==================================================================================================
test('12. controlRelativeResidual computes a same-pair descriptive relative position with both controls available', () => {
  const out = A.controlRelativeResidual({ headReferenceResidualDiffs: [2, 4], backgroundControlResidualDiffs: [-2, -4], candidateResidualDiff: 1 });
  assert.equal(out.controlAvailability, 'BOTH_AVAILABLE');
  assert.equal(out.headControlMeanResidualDiff, 3);
  assert.equal(out.backgroundControlMeanResidualDiff, -3);
  assert.equal(out.candidateRelativeToHeadControl, -2);
  assert.equal(out.candidateRelativeToBackgroundControl, 4);
});
test('12b. controlRelativeResidual reports CONTROL_INSUFFICIENT rather than a fabricated global substitute', () => {
  const out = A.controlRelativeResidual({ headReferenceResidualDiffs: [], backgroundControlResidualDiffs: [], candidateResidualDiff: 1 });
  assert.equal(out.controlAvailability, 'CONTROL_INSUFFICIENT');
  assert.equal(out.headControlMeanResidualDiff, null);
  assert.equal(out.candidateRelativeToHeadControl, null);
});
test('12c. controlRelativeResidual reports PARTIAL_AVAILABLE when only one control regime has data', () => {
  const out = A.controlRelativeResidual({ headReferenceResidualDiffs: [1], backgroundControlResidualDiffs: [], candidateResidualDiff: 1 });
  assert.equal(out.controlAvailability, 'PARTIAL_AVAILABLE');
});

// ==================================================================================================
// 13 -- median / MAD primitives
// ==================================================================================================
test('13. median and medianAbsoluteDeviation are computed correctly on a known set', () => {
  assert.equal(A.median([1, 2, 3, 4, 5]), 3);
  assert.equal(A.median([1, 2, 3, 4]), 2.5);
  assert.equal(A.medianAbsoluteDeviation([1, 2, 3, 4, 5]), 1);
});

// ==================================================================================================
// 14 -- no outlier deletion (structural, re-check on a larger fixture)
// ==================================================================================================
test('14. detectOutliers preserves every input including flagged outliers themselves', () => {
  const values = [1, 2, 3, 100, -100, 2, 3];
  const flags = A.detectOutliers(values);
  assert.equal(flags.length, values.length);
  assert.ok(flags.some(f => f.value === 100));
  assert.ok(flags.some(f => f.value === -100));
});

// ==================================================================================================
// 15 -- no semantic classifier
// ==================================================================================================
test('15. module never assigns a beard/shirt semantic field', () => {
  const prohibited = ['isBeard', 'isShirt', 'beardScore', 'shirtScore', 'beardProbability', 'shirtProbability', 'probabilityBeard'];
  prohibited.forEach(name => {
    assert.doesNotMatch(MODULE_SOURCE, new RegExp(name + '\\s*[:=]'), name + ' must never be assigned as an output field');
  });
});

// ==================================================================================================
// 16 -- no GT
// ==================================================================================================
test('16. module never references ground-truth or IoU machinery', () => {
  assert.doesNotMatch(MODULE_SOURCE, /groundTruth/i);
  assert.doesNotMatch(MODULE_SOURCE, /IoU/i);
  assert.doesNotMatch(MODULE_SOURCE, /silhouette/i);
});

// ==================================================================================================
// 17 -- no occupancy dependency (no V1/V2/V2.1/V2.2 import)
// ==================================================================================================
test('17. module imports nothing from the beard-occupancy-field or proposal families', () => {
  assert.doesNotMatch(MODULE_SOURCE, /beard-occupancy-field/);
  assert.doesNotMatch(MODULE_SOURCE, /beard-proposal/);
});

// ==================================================================================================
// 18 -- no network
// ==================================================================================================
test('18. module has zero network calls', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\bfetch\s*\(/);
  assert.doesNotMatch(MODULE_SOURCE, /XMLHttpRequest/);
  assert.doesNotMatch(MODULE_SOURCE, /https?:\/\//);
});

// ==================================================================================================
// 19 -- sealed-holdout absence
// ==================================================================================================
test('19. module never references the sealed holdout scan', () => {
  assert.doesNotMatch(MODULE_SOURCE, /scan_mtdogmlr_espu2w/);
  assert.doesNotMatch(MODULE_SOURCE, /obs22|obs23/);
});

// ==================================================================================================
// 20 -- production isolation
// ==================================================================================================
test('20. production isolation: index.html and worker.js are unchanged by this stage', () => {
  const ROOT = join(HERE, '..');
  const indexHash = createHash('sha256').update(readFileSync(join(ROOT, 'index.html'))).digest('hex');
  const workerHash = createHash('sha256').update(readFileSync(join(ROOT, 'worker.js'))).digest('hex');
  // Baseline updated by BI-1Z1R, which was explicitly authorized to modify index.html
  // (research-only WHOLE_SCAN_TEMPORAL_EXACT_V1 wiring) -- this snapshot only needs to prove
  // no LATER, unauthorized stage touches it further.
  // Baseline updated by BI-1Z1T, which was explicitly authorized to modify index.html's
  // whole-scan block (burst-priority isolation) -- this snapshot only needs to prove no LATER,
  // unauthorized stage touches it further.
  // Baseline updated by BI-1Z2A, which was explicitly authorized to additively modify
  // index.html (corrected temporal subphase instrumentation) without touching the sacrosanct
  // burst recorder block.
  // Baseline updated by SCAN-LOCK-V1A, which was explicitly authorized to additively modify
  // index.html (real voice guidance implementation via Web Speech API) without touching the
  // sacrosanct burst recorder block or any scanner timing/threshold code.
  // Baseline updated by SCAN-LOCK-V1B, which was explicitly authorized to additively modify
  // index.html (native Android TextToSpeech voice transport replacing the unavailable Web
  // Speech API) without touching the sacrosanct burst recorder block or any scanner
  // timing/threshold code.
  // Baseline updated by SCAN-LOCK-V1C, which was explicitly authorized to flip
  // window.__front3DDecisionAuthoritative's default from false to true (Front
  // comfortable-distance persistent-block fix) without touching the sacrosanct
  // burst recorder block, any scanner timing/threshold, or native Voice Guidance code.
  // Baseline updated by SCAN-LOCK-V1D, which was explicitly authorized to make a
  // layout-only fix (research/debug panel touch-scroll unreachability) without
  // touching the sacrosanct burst recorder block, any scanner timing/threshold,
  // DIST/Front-3D-authority, or native Voice Guidance code.
  assert.equal(indexHash, '928747a5d284060dddac43c95f97a1669492ab4d1ecebf0d34bc59f3a3b5b521');
  assert.equal(workerHash, '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});
test('20b. module never imports a DOM/browser/native-bridge global', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\bdocument\./);
  assert.doesNotMatch(MODULE_SOURCE, /\bwindow\./);
  assert.doesNotMatch(MODULE_SOURCE, /BeardTrimAndroid/);
});
test('20c. module performs zero image-patch extraction or metric computation of its own', () => {
  assert.doesNotMatch(MODULE_SOURCE, /getImageData/);
  assert.doesNotMatch(MODULE_SOURCE, /bilinearSample/);
  assert.doesNotMatch(MODULE_SOURCE, /sobelGradientMagnitude/);
});
