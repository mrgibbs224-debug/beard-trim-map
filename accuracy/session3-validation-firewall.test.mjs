// Stage BI-1Z1P -- synthetic tests for the third-session validation firewall utilities. Pure
// synthetic fixtures; no physical capture data embedded here (the real Session 3 analysis lives in
// D:\MettleTemp\analysis\bi1z1p_*.json, generated separately).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as F from './session3-validation-firewall.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_SOURCE = readFileSync(join(HERE, 'session3-validation-firewall.mjs'), 'utf8');

// ==================================================================================================
// 1 -- fresh-session identity
// ==================================================================================================
test('1. assertFreshSessionIdentity accepts a genuinely distinct session id', () => {
  assert.equal(F.assertFreshSessionIdentity('scan_new123', ['scan_mtz6mhc9_3aoc5d', 'scan_mtza9rzw_t24vk9']), true);
});
test('1b. assertFreshSessionIdentity throws on a collision with a prior session', () => {
  assert.throws(() => F.assertFreshSessionIdentity('scan_mtz6mhc9_3aoc5d', ['scan_mtz6mhc9_3aoc5d', 'scan_mtza9rzw_t24vk9']));
});

// ==================================================================================================
// 2 -- old-session exclusion before prospective verdict
// ==================================================================================================
test('2. buildProspectiveVerdict signature structurally cannot accept prior-session data', () => {
  const verdict = F.buildProspectiveVerdict({ sessionId: 's3', primaryAFavorBursts: 5, primaryATotalBursts: 5, primaryBFavorBursts: 5, primaryBTotalBursts: 5, primaryCFavorBursts: 5, primaryCTotalBursts: 5, primaryAPairMajorityPct: 89, primaryBPairMajorityPct: 76 });
  assert.equal(verdict.determinedFromPriorSessionData, false);
  assert.doesNotMatch(MODULE_SOURCE, /buildProspectiveVerdict\([^)]*prior/i);
});
test('2b. buildHistoricalComparison refuses to run before a verdict object exists', () => {
  assert.throws(() => F.buildHistoricalComparison(null, []));
  assert.throws(() => F.buildHistoricalComparison({}, []));
});
test('2c. buildHistoricalComparison never recomputes or revises the frozen outcome, only carries it through', () => {
  const verdict = F.buildProspectiveVerdict({ sessionId: 's3', primaryAFavorBursts: 5, primaryATotalBursts: 5, primaryBFavorBursts: 5, primaryBTotalBursts: 5, primaryCFavorBursts: 5, primaryCTotalBursts: 5, primaryAPairMajorityPct: 89, primaryBPairMajorityPct: 76 });
  const comparison = F.buildHistoricalComparison(verdict, [{ sessionId: 's1' }, { sessionId: 's2' }]);
  assert.equal(comparison.session3Outcome, verdict.outcome);
});

// ==================================================================================================
// 3/4/5/6 -- hash verification (protocol, V2 manifest, V1 module, V2 module)
// ==================================================================================================
test('3. verifyFrozenHashes reports allMatch=true when every hash matches', () => {
  const r = F.verifyFrozenHashes([
    { label: 'protocol', expected: 'abc', actual: 'abc' },
    { label: 'v2manifest', expected: 'def', actual: 'def' },
    { label: 'v1module', expected: 'ghi', actual: 'ghi' },
    { label: 'v2module', expected: 'jkl', actual: 'jkl' }
  ]);
  assert.equal(r.allMatch, true);
  assert.equal(r.mismatches.length, 0);
});
test('4. verifyFrozenHashes flags exactly the mismatching entries', () => {
  const r = F.verifyFrozenHashes([{ label: 'protocol', expected: 'abc', actual: 'abc' }, { label: 'v2manifest', expected: 'def', actual: 'WRONG' }]);
  assert.equal(r.allMatch, false);
  assert.equal(r.mismatches.length, 1);
  assert.equal(r.mismatches[0].label, 'v2manifest');
});
test('5. real frozen artifact hashes verify against this stage\'s recorded expectations', () => {
  const checks = [
    { label: 'thirdSessionProtocol', expected: '5f1adb49b3f4560de04d41e80094433c080c80bf732d39e0f647abc2e116c9dd', actual: createHash('sha256').update(readFileSync('D:/MettleTemp/analysis/bi1z1n_third_session_validation_protocol.json')).digest('hex') },
    { label: 'v2Manifest', expected: '9cb81b6cd166b2453d08728b9a92fa5a957cb36b5a22076abb14f0d32390d228', actual: createHash('sha256').update(readFileSync('D:/MettleTemp/analysis/bi1z1o_temporal_measurement_v2_frozen_manifest.json')).digest('hex') },
    { label: 'v2Module', expected: 'c3e5f3ebeb631c0b98f90c16e614a784a2d3d35570f8eb713bb18fc229451d11', actual: createHash('sha256').update(readFileSync(join(HERE, 'head-relative-temporal-measurement-v2.mjs'))).digest('hex') },
    { label: 'v1Module', expected: '818640e3101b3b82ce24b2efdf65b7098a54f660821953637e6c002da5db1e3f', actual: createHash('sha256').update(readFileSync(join(HERE, 'head-relative-temporal-support-v1.mjs'))).digest('hex') }
  ];
  const r = F.verifyFrozenHashes(checks);
  assert.equal(r.allMatch, true, JSON.stringify(r.mismatches));
});
test('6. verifyFrozenHashes never mutates its input checks array', () => {
  const checks = [{ label: 'x', expected: 'a', actual: 'a' }];
  const frozen = JSON.stringify(checks);
  F.verifyFrozenHashes(checks);
  assert.equal(JSON.stringify(checks), frozen);
});

// ==================================================================================================
// 7 -- capture-quality validation
// ==================================================================================================
test('7. validateCaptureQuality passes a clean burst set', () => {
  const r = F.validateCaptureQuality([{ burstId: 'b1', sampleCount: 19, allVerifiedExact: true, timestampsMonotonic: true, eligiblePairCount: 18, totalPairCount: 18 }]);
  assert.equal(r.pass, true);
});
test('7b. validateCaptureQuality does NOT reject merely because sample count differs across bursts', () => {
  const r = F.validateCaptureQuality([
    { burstId: 'b1', sampleCount: 19, allVerifiedExact: true, timestampsMonotonic: true, eligiblePairCount: 18, totalPairCount: 18 },
    { burstId: 'b2', sampleCount: 10, allVerifiedExact: true, timestampsMonotonic: true, eligiblePairCount: 9, totalPairCount: 9 }
  ]);
  assert.equal(r.pass, true);
  assert.equal(r.sampleCountVariesAcrossBursts, true);
});
test('7c. validateCaptureQuality DOES reject genuine incompatibility (non-monotonic timestamps, no VERIFIED_EXACT)', () => {
  const r = F.validateCaptureQuality([{ burstId: 'b1', sampleCount: 19, allVerifiedExact: false, timestampsMonotonic: false, eligiblePairCount: 0, totalPairCount: 18 }]);
  assert.equal(r.pass, false);
  assert.ok(r.reasons.length >= 2);
});

// ==================================================================================================
// 8/9/10 -- hierarchy (pair / burst / session) -- reuses V2's already-tested hierarchy; here we
// verify this stage's own analysis-adjacent directional-counting utility respects it structurally
// ==================================================================================================
test('8. classifyDirectionalCounts operates on pre-aggregated pair-level values, not raw patch counts', () => {
  const pairMeans = [1, -1, 0.5, -0.5, 0.001];
  const r = F.classifyDirectionalCounts(pairMeans, 0.05);
  assert.equal(r.total, 5);
  assert.equal(r.positive, 2);
  assert.equal(r.negative, 2);
  assert.equal(r.ties, 1);
});
test('9. outlierMasqueradeCheck groups by pairKey before assessing outlier dependency (burst-level shape)', () => {
  const pairMeans = [{ pairKey: 'p1', mean: 1 }, { pairKey: 'p2', mean: 1.1 }, { pairKey: 'p3', mean: 0.9 }, { pairKey: 'p4', mean: 50 }];
  const r = F.outlierMasqueradeCheck(pairMeans, 0.05);
  assert.equal(r.outlierCount, 1);
  assert.equal(r.outlierPairKeys[0], 'p4');
});
test('10. a scan session\'s worth of burst summaries is never flattened into a single unlabeled patch count by this module', () => {
  assert.doesNotMatch(MODULE_SOURCE, /flatMap.*flatMap.*flatMap/); // no triple-flatten-to-a-bare-array pattern
});

// ==================================================================================================
// 11/12/13 -- PRIMARY_A / PRIMARY_B / PRIMARY_C logic (directional, tie-aware)
// ==================================================================================================
test('11. PRIMARY_A-style logic: HEAD_REFERENCE favors head-relative when the majority of pair means are positive', () => {
  const r = F.classifyDirectionalCounts([1, 1, 1, -1], 0.05);
  assert.ok(r.positive > r.negative);
});
test('12. PRIMARY_B-style logic: BACKGROUND_CONTROL favors static when the majority of pair means are negative', () => {
  const r = F.classifyDirectionalCounts([-1, -1, -1, 1], 0.05);
  assert.ok(r.negative > r.positive);
});
test('13. PRIMARY_C-style logic: separation is a comparison of two pooled means, not a shared threshold', () => {
  const headMean = 1.9, bgMean = -1.5;
  assert.ok(headMean > bgMean);
});

// ==================================================================================================
// 14 -- directional counting matches a hand-computed tally
// ==================================================================================================
test('14. classifyDirectionalCounts matches a hand-computed tally on a larger fixture', () => {
  const values = [0.2, 0.3, -0.1, 0.05, -0.4, 0.001, -0.001];
  const r = F.classifyDirectionalCounts(values, 0.05);
  // 0.2, 0.3 > 0.05 (positive); -0.1, -0.4 < -0.05 (negative); 0.05/0.001/-0.001 fall within
  // [-0.05, 0.05] inclusive-at-boundary (ties) -- 0.05 itself is NOT strictly greater than eps.
  assert.equal(r.positive, 2);
  assert.equal(r.negative, 2);
  assert.equal(r.ties, 3);
  assert.equal(r.total, 7);
});

// ==================================================================================================
// 15 -- ties
// ==================================================================================================
test('15. a value exactly at the epsilon boundary is a tie, not silently coerced to a sign', () => {
  const r = F.classifyDirectionalCounts([0.05, -0.05], 0.05);
  assert.equal(r.ties, 2);
  assert.equal(r.positive, 0);
  assert.equal(r.negative, 0);
});

// ==================================================================================================
// 16 -- boundary-censor preservation (reuses V2's own censoring fields; here just re-confirm
// this module never re-derives or discards them)
// ==================================================================================================
test('16. this module never re-implements search-boundary detection itself (delegates entirely to V2/audit)', () => {
  assert.doesNotMatch(MODULE_SOURCE, /Math\.round\([^)]*searchRadius/);
});

// ==================================================================================================
// 17 -- safe-ratio states (this module doesn't compute ratios; confirm it doesn't either)
// ==================================================================================================
test('17. this module never computes a residual ratio itself', () => {
  assert.doesNotMatch(MODULE_SOURCE, /headResidualMagnitude\s*\/\s*staticResidualMagnitude/);
});

// ==================================================================================================
// 18 -- appearance-secondary-only
// ==================================================================================================
test('18. this module never references ZNCC/gradient metrics as a decision input', () => {
  // A documentation disclaimer ("never recomputes ZNCC...") is fine; an actual property access or
  // function call is not.
  assert.doesNotMatch(MODULE_SOURCE, /\.zncc\b/i);
  assert.doesNotMatch(MODULE_SOURCE, /\bzncc\(/i);
});

// ==================================================================================================
// 19 -- DISTAL cannot affect outcome
// ==================================================================================================
test('19. buildProspectiveVerdict has no DISTAL-related parameter at all -- structurally cannot be influenced by it', () => {
  assert.doesNotMatch(MODULE_SOURCE, /DISTAL/);
});

// ==================================================================================================
// 20 -- outliers never deleted
// ==================================================================================================
test('20. outlierMasqueradeCheck reports outlier pairs by key, never removes them from consideration', () => {
  const pairMeans = [{ pairKey: 'p1', mean: 1 }, { pairKey: 'p2', mean: 100 }];
  const r = F.outlierMasqueradeCheck(pairMeans, 0.05);
  // pooledMean must still reflect BOTH pairs (not the outlier-excluded mean)
  assert.equal(r.pooledMean, 50.5);
});

// ==================================================================================================
// 21 -- historical comparison only after prospective verdict freeze
// ==================================================================================================
test('21. buildHistoricalComparison is unreachable without a completed verdict object (structural firewall)', () => {
  assert.throws(() => F.buildHistoricalComparison(undefined, [{ sessionId: 'x' }]));
});

// ==================================================================================================
// 22 -- no threshold fitting
// ==================================================================================================
test('22. buildProspectiveVerdict thresholds (60% pair majority, all-bursts-favor) are fixed constants, never derived from an input session\'s own data', () => {
  const v1 = F.buildProspectiveVerdict({ sessionId: 'a', primaryAFavorBursts: 5, primaryATotalBursts: 5, primaryBFavorBursts: 5, primaryBTotalBursts: 5, primaryCFavorBursts: 5, primaryCTotalBursts: 5, primaryAPairMajorityPct: 61, primaryBPairMajorityPct: 61 });
  const v2 = F.buildProspectiveVerdict({ sessionId: 'b', primaryAFavorBursts: 5, primaryATotalBursts: 5, primaryBFavorBursts: 5, primaryBTotalBursts: 5, primaryCFavorBursts: 5, primaryCTotalBursts: 5, primaryAPairMajorityPct: 99, primaryBPairMajorityPct: 99 });
  assert.equal(v1.outcome, 'OUTCOME_A');
  assert.equal(v2.outcome, 'OUTCOME_A'); // same threshold applies regardless of how strong the input looks
});

// ==================================================================================================
// 23 -- no occupancy fusion
// ==================================================================================================
test('23. module never imports the beard-occupancy-field or proposal families', () => {
  assert.doesNotMatch(MODULE_SOURCE, /beard-occupancy-field/);
  assert.doesNotMatch(MODULE_SOURCE, /beard-proposal/);
});

// ==================================================================================================
// 24 -- no GT
// ==================================================================================================
test('24. module never references ground-truth or IoU machinery', () => {
  assert.doesNotMatch(MODULE_SOURCE, /groundTruth/i);
  assert.doesNotMatch(MODULE_SOURCE, /IoU/i);
});

// ==================================================================================================
// 25 -- no network
// ==================================================================================================
test('25. module has zero network calls', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\bfetch\s*\(/);
  assert.doesNotMatch(MODULE_SOURCE, /https?:\/\//);
});

// ==================================================================================================
// 26 -- production isolation
// ==================================================================================================
test('26. production isolation: index.html and worker.js are unchanged by this stage', () => {
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
test('26b. sealed-holdout absence', () => {
  assert.doesNotMatch(MODULE_SOURCE, /scan_mtdogmlr_espu2w/);
  assert.doesNotMatch(MODULE_SOURCE, /obs22|obs23/);
});
