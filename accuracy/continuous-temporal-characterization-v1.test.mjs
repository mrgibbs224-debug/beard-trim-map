// Stage BI-1Z1V -- synthetic tests for the continuous whole-scan temporal characterization module.
// Pure synthetic fixtures; no beard/neck/shirt classification anywhere in this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as C from './continuous-temporal-characterization-v1.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_SOURCE = readFileSync(join(HERE, 'continuous-temporal-characterization-v1.mjs'), 'utf8');

function owned(overrides = {}) {
  return Object.assign({ scanSessionId: 's1', provenance: 'WHOLE_SCAN_OWNED', phase: 'POSE_HOLD_FRONT', nativeFrameTimestampNs: '1000000000', coherenceStatus: 'VERIFIED_EXACT', yawDeg: 1, pitchDeg: 1, rollDeg: 0 }, overrides);
}
function shared(overrides = {}) {
  return Object.assign({ scanSessionId: 's1', provenance: 'BURST_SHARED', phase: 'TRANSITION_FRONT_TO_RIGHT45', nativeFrameTimestampNs: '2000000000', coherenceStatus: 'VERIFIED_EXACT', yawDeg: 5, pitchDeg: 1, rollDeg: 0, sourceBurstId: 'b1', sourceTransition: 'front_TO_right-three-quarter', sourceTemporalSampleIndex: 0 }, overrides);
}

// ==================================================================================================
// 1 -- frozen design hash
// ==================================================================================================
test('1. module records the exact frozen BI-1Z1U design SHA256', () => {
  assert.equal(C.BI1Z1U_DESIGN_SHA256, '8e405858f59c3ee5bf8f40f555bef75eeebd7f93dcff925bceb34aa0b2016663');
});
test('1b. design hash re-verification against the live artifact', () => {
  const buf = readFileSync('D:/MettleTemp/analysis/bi1z1u_continuous_temporal_characterization_design.json');
  assert.equal(createHash('sha256').update(buf).digest('hex'), C.BI1Z1U_DESIGN_SHA256);
});

// ==================================================================================================
// 2 -- authorized-scan restriction
// ==================================================================================================
test('2. assertAuthorizedScan accepts only the two BI-1Z1T post-fix scans', () => {
  assert.equal(C.assertAuthorizedScan('scan_mtzfzdjl_xpk2fe'), true);
  assert.equal(C.assertAuthorizedScan('scan_mtzg1jkw_ckvv0v'), true);
});
test('2b. assertAuthorizedScan rejects a historical (pre-fix or pre-BI-1Z1R) scan', () => {
  assert.throws(() => C.assertAuthorizedScan('scan_mtz6mhc9_3aoc5d'));
});

// ==================================================================================================
// 3 -- source separation
// ==================================================================================================
test('3. splitByProvenance never mixes WHOLE_SCAN_OWNED and BURST_SHARED', () => {
  const { owned: o, shared: s } = C.splitByProvenance([owned(), shared(), owned({ nativeFrameTimestampNs: '1100000000' })]);
  assert.equal(o.length, 2);
  assert.equal(s.length, 1);
  o.forEach(x => assert.equal(x.provenance, 'WHOLE_SCAN_OWNED'));
  s.forEach(x => assert.equal(x.provenance, 'BURST_SHARED'));
});

// ==================================================================================================
// 4 -- hold phase grouping
// ==================================================================================================
test('4. groupByPhase groups samples by their own phase label, never conflating two phases', () => {
  const map = C.groupByPhase([owned({ phase: 'POSE_HOLD_FRONT' }), owned({ phase: 'POSE_HOLD_RIGHT45' }), owned({ phase: 'POSE_HOLD_FRONT' })]);
  assert.equal(map.get('POSE_HOLD_FRONT').length, 2);
  assert.equal(map.get('POSE_HOLD_RIGHT45').length, 1);
});

// ==================================================================================================
// 5 -- transition phase grouping (reuses groupByPhase -- verify transition labels work identically)
// ==================================================================================================
test('5. groupByPhase works identically for TRANSITION_* labels', () => {
  const map = C.groupByPhase([shared({ phase: 'TRANSITION_FRONT_TO_RIGHT45' }), shared({ phase: 'TRANSITION_RIGHT45_TO_RIGHT_PROFILE' })]);
  assert.equal(map.size, 2);
});

// ==================================================================================================
// 6 -- DATA_INSUFFICIENT behavior / 7 -- single-sample phase handling
// ==================================================================================================
test('6. buildHoldPhaseMetrics returns DATA_INSUFFICIENT for zero samples, never a fabricated metric', () => {
  const r = C.buildHoldPhaseMetrics([], 'POSE_HOLD_FRONT');
  assert.equal(r.status, 'DATA_INSUFFICIENT');
  assert.equal(r.sampleCount, 0);
});
test('7. buildHoldPhaseMetrics returns DATA_INSUFFICIENT for exactly ONE sample -- never interpolates a pair', () => {
  const r = C.buildHoldPhaseMetrics([owned()], 'POSE_HOLD_FRONT');
  assert.equal(r.status, 'DATA_INSUFFICIENT');
  assert.equal(r.sampleCount, 1);
});
test('7b. buildHoldPhaseMetrics computes real metrics once >= 2 samples exist', () => {
  const samples = [owned({ nativeFrameTimestampNs: '1000000000', yawDeg: 1 }), owned({ nativeFrameTimestampNs: '1150000000', yawDeg: 2 })];
  const r = C.buildHoldPhaseMetrics(samples, 'POSE_HOLD_FRONT');
  assert.equal(r.status, 'OK');
  assert.ok(r.achievedCadenceHz > 0);
});

// ==================================================================================================
// 8 -- cadence statistics
// ==================================================================================================
test('8. computeIntervalStats never fabricates an interval from a missing timestamp pair', () => {
  const r = C.computeIntervalStats([owned({ nativeFrameTimestampNs: '1000000000' }), owned({ nativeFrameTimestampNs: null }), owned({ nativeFrameTimestampNs: '1300000000' })]);
  assert.equal(r.count, 0);
});
test('8b. computeIntervalStats computes achievedHz correctly from real monotonic timestamps', () => {
  const r = C.computeIntervalStats([owned({ nativeFrameTimestampNs: '1000000000' }), owned({ nativeFrameTimestampNs: '1142857000' })]);
  assert.ok(Math.abs(r.achievedHz - 7) < 0.1);
});

// ==================================================================================================
// 9 -- angular deltas
// ==================================================================================================
test('9. computeConsecutivePairDeltas computes |Δyaw|/|Δpitch|/|Δroll| and combined = |Δyaw|+|Δpitch|', () => {
  const r = C.computeConsecutivePairDeltas([owned({ yawDeg: 1, pitchDeg: 2, rollDeg: 0 }), owned({ yawDeg: 4, pitchDeg: 5, rollDeg: 1 })]);
  assert.equal(r.yaw[0], 3);
  assert.equal(r.pitch[0], 3);
  assert.equal(r.roll[0], 1);
  assert.equal(r.combined[0], 6);
});
test('9b. descriptiveStats never labels its output a threshold field name', () => {
  const r = C.descriptiveStats([1, 2, 3, 4, 5]);
  assert.equal(r.median, 3);
  assert.equal('threshold' in r, false);
  assert.equal('tolerance' in r, false);
});

// ==================================================================================================
// 10 -- settling bucket assignment
// ==================================================================================================
test('10. assignSettlingWindow places elapsed time into the correct bucket, in order', () => {
  assert.equal(C.assignSettlingWindow(100), '0-250ms');
  assert.equal(C.assignSettlingWindow(300), '250-500ms');
  assert.equal(C.assignSettlingWindow(700), '500-1000ms');
  assert.equal(C.assignSettlingWindow(1500), '1000-2000ms');
  assert.equal(C.assignSettlingWindow(5000), '>2000ms');
});

// ==================================================================================================
// 11 -- settling insufficient-data handling
// ==================================================================================================
test('11. buildSettlingWindowReport reports DATA_INSUFFICIENT for every window when no boundary timestamp is available', () => {
  const r = C.buildSettlingWindowReport([owned()], null);
  r.forEach(w => assert.equal(w.status, 'DATA_INSUFFICIENT'));
});
test('11b. buildSettlingWindowReport computes real per-window stats when data supports it', () => {
  const t0 = '1000000000';
  const holds = [owned({ nativeFrameTimestampNs: '1050000000', yawDeg: 1 }), owned({ nativeFrameTimestampNs: '1150000000', yawDeg: 2 })];
  const r = C.buildSettlingWindowReport(holds, t0);
  const w0 = r.find(w => w.window === '0-250ms');
  assert.equal(w0.status, 'OK');
});

// ==================================================================================================
// 12 -- motion-bin preservation
// ==================================================================================================
test('12. motionBinFor reuses the frozen 8/20-degree boundaries exactly, never redefined', () => {
  assert.equal(C.motionBinFor(8), 'SMALL');
  assert.equal(C.motionBinFor(8.1), 'MEDIUM');
  assert.equal(C.motionBinFor(20), 'MEDIUM');
  assert.equal(C.motionBinFor(20.1), 'LARGE');
});
test('12b. module never redefines the 8 or 20 degree motion-bin constants as its own tunable values', () => {
  assert.doesNotMatch(MODULE_SOURCE, /motionBinSmallMaxDeg\s*[:=]/);
  assert.doesNotMatch(MODULE_SOURCE, /motionBinMediumMaxDeg\s*[:=]/);
});

// ==================================================================================================
// 13 -- pose comparison (via buildHoldPhaseMetrics applied per pose)
// ==================================================================================================
test('13. hold-phase metrics can be computed independently per pose without cross-contamination', () => {
  const front = [owned({ phase: 'POSE_HOLD_FRONT', nativeFrameTimestampNs: '1000000000' }), owned({ phase: 'POSE_HOLD_FRONT', nativeFrameTimestampNs: '1150000000' })];
  const chinup = [owned({ phase: 'POSE_HOLD_CHINUP', nativeFrameTimestampNs: '9000000000' })];
  const frontResult = C.buildHoldPhaseMetrics(front, 'POSE_HOLD_FRONT');
  const chinupResult = C.buildHoldPhaseMetrics(chinup, 'POSE_HOLD_CHINUP');
  assert.equal(frontResult.status, 'OK');
  assert.equal(chinupResult.status, 'DATA_INSUFFICIENT');
});

// ==================================================================================================
// 14 -- hold-vs-transition comparison
// ==================================================================================================
test('14. classifyHoldVsTransitionSeparation returns DATA_INSUFFICIENT with too few samples', () => {
  const r = C.classifyHoldVsTransitionSeparation([owned()], [shared()]);
  assert.equal(r.state, 'DATA_INSUFFICIENT');
});
test('14b. classifyHoldVsTransitionSeparation detects clear separation when transition motion-rate is much higher', () => {
  const holds = [owned({ nativeFrameTimestampNs: '1000000000', yawDeg: 1 }), owned({ nativeFrameTimestampNs: '1150000000', yawDeg: 1.01 }), owned({ nativeFrameTimestampNs: '1300000000', yawDeg: 1.02 })];
  const transitions = [shared({ nativeFrameTimestampNs: '2000000000', yawDeg: 1 }), shared({ nativeFrameTimestampNs: '2150000000', yawDeg: 15 }), shared({ nativeFrameTimestampNs: '2300000000', yawDeg: 30 })];
  const r = C.classifyHoldVsTransitionSeparation(holds, transitions);
  assert.equal(r.state, 'CLEARLY_SEPARATED');
});

// ==================================================================================================
// 15 -- boundary continuity
// ==================================================================================================
test('15. characterizeBoundary flags CLEAN for a small gap and small angular jump', () => {
  const a = owned({ nativeFrameTimestampNs: '1000000000', yawDeg: 10 });
  const b = shared({ nativeFrameTimestampNs: '1100000000', yawDeg: 11 });
  const r = C.characterizeBoundary(a, b);
  assert.equal(r.flag, 'CLEAN');
});
test('15b. characterizeBoundary flags DISCONTINUITY for a large angular jump', () => {
  const a = owned({ nativeFrameTimestampNs: '1000000000', yawDeg: 0, pitchDeg: 0 });
  const b = shared({ nativeFrameTimestampNs: '1100000000', yawDeg: 30, pitchDeg: 0 });
  const r = C.characterizeBoundary(a, b);
  assert.equal(r.flag, 'DISCONTINUITY');
});
test('15c. characterizeBoundary flags GAP_PRESENT for a large timestamp gap with small angular jump', () => {
  const a = owned({ nativeFrameTimestampNs: '1000000000', yawDeg: 10 });
  const b = shared({ nativeFrameTimestampNs: '3000000000', yawDeg: 10.1 });
  const r = C.characterizeBoundary(a, b);
  assert.equal(r.flag, 'GAP_PRESENT');
});

// ==================================================================================================
// 16 -- duplicate identity handling
// ==================================================================================================
test('16. characterizeBoundary flags DUPLICATE_COLLAPSED for a zero-gap same-session boundary', () => {
  const a = owned({ nativeFrameTimestampNs: '1000000000' });
  const b = shared({ nativeFrameTimestampNs: '1000000000' });
  const r = C.characterizeBoundary(a, b);
  assert.equal(r.flag, 'DUPLICATE_COLLAPSED');
});

// ==================================================================================================
// 17 -- shared provenance resolution
// ==================================================================================================
test('17. resolveBurstSharedProvenance resolves a correctly-referencing BURST_SHARED entry', () => {
  const bursts = [{ burstId: 'b1', samples: [{ nativeFrameTimestampNs: '2000000000', coherenceStatus: 'VERIFIED_EXACT' }] }];
  const r = C.resolveBurstSharedProvenance(shared({ sourceBurstId: 'b1', sourceTemporalSampleIndex: 0, nativeFrameTimestampNs: '2000000000' }), bursts);
  assert.equal(r.resolved, true);
});

// ==================================================================================================
// 18 -- timestamp mismatch detection
// ==================================================================================================
test('18. resolveBurstSharedProvenance detects a timestamp mismatch as a data-integrity finding, never silently ignored', () => {
  const bursts = [{ burstId: 'b1', samples: [{ nativeFrameTimestampNs: '9999999999', coherenceStatus: 'VERIFIED_EXACT' }] }];
  const r = C.resolveBurstSharedProvenance(shared({ sourceBurstId: 'b1', sourceTemporalSampleIndex: 0, nativeFrameTimestampNs: '2000000000' }), bursts);
  assert.equal(r.resolved, false);
  assert.equal(r.reason, 'TIMESTAMP_MISMATCH');
});

// ==================================================================================================
// 19 -- coherence mismatch detection
// ==================================================================================================
test('19. resolveBurstSharedProvenance detects a coherence-status mismatch', () => {
  const bursts = [{ burstId: 'b1', samples: [{ nativeFrameTimestampNs: '2000000000', coherenceStatus: 'REJECTED_TIMEOUT' }] }];
  const r = C.resolveBurstSharedProvenance(shared({ sourceBurstId: 'b1', sourceTemporalSampleIndex: 0, nativeFrameTimestampNs: '2000000000' }), bursts);
  assert.equal(r.resolved, false);
  assert.equal(r.reason, 'COHERENCE_MISMATCH');
});
test('19b. auditSharedProvenance aggregates resolution failures without silently discarding any', () => {
  const bursts = [{ burstId: 'b1', samples: [{ nativeFrameTimestampNs: '2000000000', coherenceStatus: 'VERIFIED_EXACT' }] }];
  const samples = [shared({ sourceBurstId: 'b1', sourceTemporalSampleIndex: 0, nativeFrameTimestampNs: '2000000000' }), shared({ sourceBurstId: 'bMISSING', sourceTemporalSampleIndex: 0, wholeScanSampleId: 'x' })];
  const r = C.auditSharedProvenance(samples, bursts);
  assert.equal(r.resolvedCount, 1);
  assert.equal(r.resolutionFailureCount, 1);
  assert.equal(r.failures.length, 1);
});

// ==================================================================================================
// 20 -- no interpolation
// ==================================================================================================
test('20. module never interpolates or synthesizes a sample -- no interpolation function/call exists (comments disclaiming this are fine)', () => {
  assert.doesNotMatch(MODULE_SOURCE, /function\s+\w*interpolat/i);
  assert.doesNotMatch(MODULE_SOURCE, /\binterpolate\s*\(/i);
  assert.doesNotMatch(MODULE_SOURCE, /\bsynthesize\s*\(/i);
});

// ==================================================================================================
// 21 -- no threshold fitting
// ==================================================================================================
test('21. classifyAboveNoise uses a fixed, documented numerical epsilon, never a fitted/calibrated value', () => {
  const r = C.classifyAboveNoise([{ status: 'OK', phase: 'POSE_HOLD_FRONT', combinedDeltaStats: { median: 2 } }]);
  assert.equal(r.state, 'MOTION_MEASURABLE');
  assert.doesNotMatch(MODULE_SOURCE, /fit\(|calibrate\(/);
});

// ==================================================================================================
// 22 -- no V2 execution
// ==================================================================================================
test('22. auditV2Readiness never imports or calls the V2/V1 temporal-support instrument -- structural field-presence check only', () => {
  // A documentation attribution comment (e.g. "reused UNMODIFIED from accuracy/head-relative-
  // temporal-support-v1.mjs's own frozen definitions") is fine; an actual import statement is not.
  assert.doesNotMatch(MODULE_SOURCE, /import[^;]*head-relative-temporal-(support|measurement)/);
  const r = C.auditV2Readiness([{ faceLocal3D: new Array(468).fill({ x: 0, y: 0, z: 0 }), imageSpaceViewModelMatrix: new Array(16).fill(0), intrinsics: { fx: 1, fy: 1 }, imageBase64Jpeg: 'x', coherenceStatus: 'VERIFIED_EXACT' }]);
  assert.equal(r.outcome, 'READY_FOR_FUTURE_V2_EXPERIMENT_DESIGN');
});
test('22b. auditV2Readiness reports V2_INPUT_GAPS_IDENTIFIED with exact reasons when fields are missing', () => {
  const r = C.auditV2Readiness([{ coherenceStatus: 'VERIFIED_EXACT' }]);
  assert.equal(r.outcome, 'V2_INPUT_GAPS_IDENTIFIED');
  assert.ok(r.gaps.length > 0);
});

// ==================================================================================================
// 23 -- no GT
// ==================================================================================================
test('23. module never references ground-truth or IoU machinery', () => {
  assert.doesNotMatch(MODULE_SOURCE, /groundTruth/i);
  assert.doesNotMatch(MODULE_SOURCE, /\bIoU\b/);
});

// ==================================================================================================
// 24 -- no occupancy
// ==================================================================================================
test('24. module imports nothing from the beard-occupancy-field or proposal families', () => {
  assert.doesNotMatch(MODULE_SOURCE, /beard-occupancy-field/);
  assert.doesNotMatch(MODULE_SOURCE, /beard-proposal/);
});

// ==================================================================================================
// 25 -- no Hairness
// ==================================================================================================
test('25. module does not import hairness-core', () => {
  assert.doesNotMatch(MODULE_SOURCE, /hairness-core/);
});

// ==================================================================================================
// 26 -- no network
// ==================================================================================================
test('26. module has zero network calls', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\bfetch\s*\(/);
  assert.doesNotMatch(MODULE_SOURCE, /https?:\/\//);
});

// ==================================================================================================
// 27 -- production isolation
// ==================================================================================================
test('27. production isolation: index.html and worker.js are unchanged by this stage', () => {
  const ROOT = join(HERE, '..');
  const indexHash = createHash('sha256').update(readFileSync(join(ROOT, 'index.html'))).digest('hex');
  const workerHash = createHash('sha256').update(readFileSync(join(ROOT, 'worker.js'))).digest('hex');
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
test('27b. module never imports a DOM/browser/native-bridge global', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\bwindow\./);
  assert.doesNotMatch(MODULE_SOURCE, /BeardTrimAndroid/);
});
test('27c. module never assigns a beard/shirt/neckline semantic field', () => {
  assert.doesNotMatch(MODULE_SOURCE, /isBeard\s*[:=]/);
  assert.doesNotMatch(MODULE_SOURCE, /isShirt\s*[:=]/);
  assert.doesNotMatch(MODULE_SOURCE, /neckline\s*[:=]/i);
});
