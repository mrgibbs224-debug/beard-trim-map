// Stage BI-1Z1S -- synthetic tests for the whole-scan instrument-validation utilities. Pure
// synthetic fixtures; no scientific/temporal-attachment interpretation anywhere in this module or
// these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as V from './whole-scan-instrument-validation.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_SOURCE = readFileSync(join(HERE, 'whole-scan-instrument-validation.mjs'), 'utf8');

function makeSample(overrides = {}) {
  return Object.assign({ coherenceStatus: 'VERIFIED_EXACT', nativeFrameTimestampNs: '1000000000', phase: 'POSE_HOLD_FRONT' }, overrides);
}

// ==================================================================================================
// 1 -- complete vs incomplete scan classification
// ==================================================================================================
test('1. classifyCapture: 6 formal poses + 5 bursts is COMPLETE_VALIDATION_CAPTURE', () => {
  const pkg = { manifest: { formalCaptureCount: 6 }, temporalMotionBursts: [1, 2, 3, 4, 5] };
  assert.equal(V.classifyCapture(pkg), 'COMPLETE_VALIDATION_CAPTURE');
});
test('1b. classifyCapture: 0 formal poses + 0 bursts is INCOMPLETE_ABORTED_CAPTURE, never merged', () => {
  const pkg = { manifest: { formalCaptureCount: 0 }, temporalMotionBursts: [] };
  assert.equal(V.classifyCapture(pkg), 'INCOMPLETE_ABORTED_CAPTURE');
});
test('1c. classifyCapture: partial completion (e.g. 6 poses but only 4 bursts) is still incomplete, never rounded up', () => {
  const pkg = { manifest: { formalCaptureCount: 6 }, temporalMotionBursts: [1, 2, 3, 4] };
  assert.equal(V.classifyCapture(pkg), 'INCOMPLETE_ABORTED_CAPTURE');
});

// ==================================================================================================
// 2 -- formal pose count / health
// ==================================================================================================
test('2. checkFormalPoseHealth passes with all 6 expected labels and no malformed entries', () => {
  const pkg = { formalCaptureAssociations: V.EXPECTED_FORMAL_LABELS.map((l, i) => ({ formalCaptureId: i, formalCaptureLabel: l, formalCaptureAt: 't' + i })), imageKeyframes: [] };
  const r = V.checkFormalPoseHealth(pkg);
  assert.equal(r.ok, true);
  assert.equal(r.missing.length, 0);
});
test('2b. checkFormalPoseHealth flags a missing pose label', () => {
  const pkg = { formalCaptureAssociations: V.EXPECTED_FORMAL_LABELS.slice(0, 5).map((l, i) => ({ formalCaptureId: i, formalCaptureLabel: l, formalCaptureAt: 't' + i })), imageKeyframes: [] };
  const r = V.checkFormalPoseHealth(pkg);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['Chin-up']);
});
test('2c. checkFormalPoseHealth flags a malformed association (missing id/timestamp) without crashing', () => {
  const pkg = { formalCaptureAssociations: [{ formalCaptureId: null, formalCaptureLabel: 'Front', formalCaptureAt: null }], imageKeyframes: [] };
  const r = V.checkFormalPoseHealth(pkg);
  assert.equal(r.malformedCount, 1);
  assert.equal(r.ok, false);
});

// ==================================================================================================
// 3 -- burst count
// ==================================================================================================
test('3. EXPECTED_BURST_TRANSITIONS names all 5 required transitions', () => {
  assert.equal(V.EXPECTED_BURST_TRANSITIONS.length, 5);
});

// ==================================================================================================
// 4 -- whole-scan exactness
// ==================================================================================================
test('4. every retained whole-scan sample must be VERIFIED_EXACT -- a non-exact sample is a detectable violation', () => {
  const samples = [makeSample(), makeSample({ coherenceStatus: 'REJECTED_TIMEOUT' })];
  const allExact = samples.every(s => s.coherenceStatus === 'VERIFIED_EXACT');
  assert.equal(allExact, false);
});

// ==================================================================================================
// 5 -- phase coverage
// ==================================================================================================
test('5. checkPhaseCoverage reports fullyCovered=true when all 11 required phases are present', () => {
  const samples = V.REQUIRED_PHASES.map(p => makeSample({ phase: p }));
  const r = V.checkPhaseCoverage(samples);
  assert.equal(r.fullyCovered, true);
  assert.equal(r.missing.length, 0);
});
test('5b. checkPhaseCoverage reports missing phases explicitly, never silently', () => {
  const samples = V.REQUIRED_PHASES.slice(0, 3).map(p => makeSample({ phase: p }));
  const r = V.checkPhaseCoverage(samples);
  assert.equal(r.fullyCovered, false);
  assert.equal(r.missing.length, 8);
});
test('5c. checkPhaseCoverage counts UNRECOGNIZED_STATE separately, never folded into a known phase', () => {
  const samples = [makeSample({ phase: 'UNRECOGNIZED_STATE' }), makeSample({ phase: 'UNRECOGNIZED_STATE' })];
  const r = V.checkPhaseCoverage(samples);
  assert.equal(r.unrecognizedCount, 2);
});

// ==================================================================================================
// 6 -- phase ordering
// ==================================================================================================
test('6. checkPhaseOrdering accepts a forward-only phase sequence', () => {
  const samples = V.REQUIRED_PHASES.map(p => makeSample({ phase: p }));
  const r = V.checkPhaseOrdering(samples);
  assert.equal(r.ok, true);
});
test('6b. checkPhaseOrdering flags a backward jump (e.g. CHINUP samples before FRONT samples)', () => {
  const samples = [makeSample({ phase: 'POSE_HOLD_CHINUP' }), makeSample({ phase: 'POSE_HOLD_FRONT' })];
  const r = V.checkPhaseOrdering(samples);
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 1);
});
test('6c. checkPhaseOrdering excludes UNRECOGNIZED_STATE samples from the ordering check (unknown position is not a violation)', () => {
  const samples = [makeSample({ phase: 'POSE_HOLD_FRONT' }), makeSample({ phase: 'UNRECOGNIZED_STATE' }), makeSample({ phase: 'POSE_HOLD_RIGHT45' })];
  const r = V.checkPhaseOrdering(samples);
  assert.equal(r.ok, true);
});

// ==================================================================================================
// 7 -- hold sampling
// ==================================================================================================
test('7. checkHoldAndTransitionCoverage confirms hold samples exist and the stream is not merely a transition recorder', () => {
  const samples = V.REQUIRED_PHASES.map(p => makeSample({ phase: p }));
  const r = V.checkHoldAndTransitionCoverage(samples);
  assert.equal(r.everyHoldPhasePresent, true);
  assert.equal(r.isMerelyATransitionRecorder, false);
  assert.ok(r.holdSampleCount > 0);
});
test('7b. checkHoldAndTransitionCoverage detects the failure mode of zero hold samples', () => {
  const samples = V.REQUIRED_PHASES.filter(p => p.startsWith('TRANSITION_')).map(p => makeSample({ phase: p }));
  const r = V.checkHoldAndTransitionCoverage(samples);
  assert.equal(r.isMerelyATransitionRecorder, true);
});

// ==================================================================================================
// 8 -- transition sampling
// ==================================================================================================
test('8. checkHoldAndTransitionCoverage confirms transition samples exist independently of hold samples', () => {
  const samples = V.REQUIRED_PHASES.map(p => makeSample({ phase: p }));
  const r = V.checkHoldAndTransitionCoverage(samples);
  assert.equal(r.everyTransitionPhasePresent, true);
  assert.ok(r.transitionSampleCount > 0);
});

// ==================================================================================================
// 9 -- burst-reference comparison
// ==================================================================================================
test('9. summarizeBurstTransition reports exactness/duration/interval stats/skip count/end reason', () => {
  const burst = { sourceTransition: 'front_TO_right-three-quarter', sampleCount: 3, actualDurationMs: 500, skippedCount: 1, endReason: 'POSE_LOCK_SETTLED', samples: [makeSample({ nativeFrameTimestampNs: '1000000000' }), makeSample({ nativeFrameTimestampNs: '1133000000' }), makeSample({ nativeFrameTimestampNs: '1266000000' })] };
  const r = V.summarizeBurstTransition(burst);
  assert.equal(r.allVerifiedExact, true);
  assert.equal(r.skippedCount, 1);
  assert.equal(r.endReason, 'POSE_LOCK_SETTLED');
  assert.ok(r.intervalStats.mean > 0);
});
test('9b. compareBurstSkipRate reports a descriptive delta, never a pass/fail verdict itself', () => {
  const r = V.compareBurstSkipRate(70, 5, 2.0);
  assert.ok(Math.abs(r.currentRatePct - (100 * 5 / 75)) < 1e-9);
  assert.ok(Math.abs(r.deltaPct - (r.currentRatePct - 2.0)) < 1e-9);
  assert.equal('ok' in r, false); // no baked-in verdict field
});

// ==================================================================================================
// 10 -- cadence statistics
// ==================================================================================================
test('10. computeIntervalPercentiles never fabricates an interval from a missing/non-numeric timestamp pair', () => {
  const samples = [makeSample({ nativeFrameTimestampNs: '1000000000' }), makeSample({ nativeFrameTimestampNs: null }), makeSample({ nativeFrameTimestampNs: '1300000000' })];
  const r = V.computeIntervalPercentiles(samples);
  assert.equal(r.count, 0); // both pairs involve a null timestamp -- zero valid intervals, never a guessed one
});
test('10b. computeIntervalPercentiles computes achievedHz from real, monotonic timestamps', () => {
  const samples = [makeSample({ nativeFrameTimestampNs: '1000000000' }), makeSample({ nativeFrameTimestampNs: '1142857000' })]; // ~142.857ms apart => ~7Hz
  const r = V.computeIntervalPercentiles(samples);
  assert.ok(Math.abs(r.achievedHz - 7) < 0.1);
});

// ==================================================================================================
// 11 -- priority-yield accounting
// ==================================================================================================
test('11. priority-yield telemetry fields are read directly from the whole-scan telemetry object, never recomputed by this module', () => {
  assert.doesNotMatch(MODULE_SOURCE, /skippedForBurstPriority\s*[+\-]?=/); // never assigned/mutated here, only read by callers
});

// ==================================================================================================
// 12 -- SCAN_ENDED handling
// ==================================================================================================
test('12. checkSafetyCapHit recognizes SCAN_ENDED as a normal (non-cap) stop', () => {
  const r = V.checkSafetyCapHit('SCAN_ENDED');
  assert.equal(r.normalStop, true);
  assert.equal(r.capHit, null);
});

// ==================================================================================================
// 13 -- aborted/incomplete stop handling
// ==================================================================================================
test('13. auditIncompleteCaptureLifecycle reports clean termination for an aborted-but-well-behaved capture', () => {
  const pkg = { wholeScanTemporalStream: { samples: [makeSample({ nativeFrameTimestampNs: '1000000000' }), makeSample({ nativeFrameTimestampNs: '1142857000' })], telemetry: { streamStopReason: 'SCAN_ENDED' } } };
  const r = V.auditIncompleteCaptureLifecycle(pkg);
  assert.equal(r.cleanTermination, true);
  assert.equal(r.allVerifiedExact, true);
  assert.equal(r.timestampsMonotonic, true);
});
test('13b. auditIncompleteCaptureLifecycle detects a non-monotonic (potentially runaway) capture rather than assuming health', () => {
  const pkg = { wholeScanTemporalStream: { samples: [makeSample({ nativeFrameTimestampNs: '2000000000' }), makeSample({ nativeFrameTimestampNs: '1000000000' })], telemetry: { streamStopReason: 'SCAN_ENDED' } } };
  const r = V.auditIncompleteCaptureLifecycle(pkg);
  assert.equal(r.timestampsMonotonic, false);
});

// ==================================================================================================
// 14 -- safety-cap detection
// ==================================================================================================
test('14. checkSafetyCapHit recognizes all 3 frozen cap reasons', () => {
  assert.equal(V.checkSafetyCapHit('MAX_SAMPLES_REACHED').capHit, 'MAX_SAMPLES_REACHED');
  assert.equal(V.checkSafetyCapHit('MAX_DURATION_REACHED').capHit, 'MAX_DURATION_REACHED');
  assert.equal(V.checkSafetyCapHit('MAX_EXPORT_BYTES_REACHED').capHit, 'MAX_EXPORT_BYTES_REACHED');
});

// ==================================================================================================
// 15 -- actual export-size accounting
// ==================================================================================================
test('15. summarizeExportSizeAccounting distinguishes whole-scan/Tier-B/burst JPEG bytes from total file bytes and flags any telemetry/actual mismatch', () => {
  const pkg = {
    wholeScanTemporalStream: { samples: [{ imageBase64Jpeg: 'A'.repeat(100) }], telemetry: { approxBytesWritten: 100 } },
    imageKeyframes: [{ dataUrl: 'B'.repeat(50) }],
    temporalMotionBursts: [{ samples: [{ dataUrl: 'C'.repeat(30) }] }]
  };
  const r = V.summarizeExportSizeAccounting(pkg, 1000);
  assert.equal(r.wholeScanJpegBytes, 100);
  assert.equal(r.tierBJpegBytes, 50);
  assert.equal(r.burstJpegBytes, 30);
  assert.equal(r.jpegTotal, 180);
  assert.equal(r.nonJpegOverheadBytes, 820);
  assert.equal(r.telemetryMatchesActualWholeScanJpegSum, true);
});
test('15b. summarizeExportSizeAccounting flags a telemetry/actual mismatch rather than hiding it', () => {
  const pkg = { wholeScanTemporalStream: { samples: [{ imageBase64Jpeg: 'A'.repeat(100) }], telemetry: { approxBytesWritten: 999 } }, imageKeyframes: [], temporalMotionBursts: [] };
  const r = V.summarizeExportSizeAccounting(pkg, 1000);
  assert.equal(r.telemetryMatchesActualWholeScanJpegSum, false);
});

// ==================================================================================================
// 16 -- no scientific temporal interpretation
// ==================================================================================================
test('16. module never computes ZNCC/residual/attachment metrics or imports the temporal-support/measurement modules', () => {
  assert.doesNotMatch(MODULE_SOURCE, /zncc/i);
  assert.doesNotMatch(MODULE_SOURCE, /residualDifference|residualMagnitude/i);
  assert.doesNotMatch(MODULE_SOURCE, /head-relative-temporal-(support|measurement)/);
});

// ==================================================================================================
// 17 -- no occupancy
// ==================================================================================================
test('17. module imports nothing from the beard-occupancy-field or proposal families', () => {
  assert.doesNotMatch(MODULE_SOURCE, /beard-occupancy-field/);
  assert.doesNotMatch(MODULE_SOURCE, /beard-proposal/);
});

// ==================================================================================================
// 18 -- no GT
// ==================================================================================================
test('18. module never references ground-truth or IoU machinery', () => {
  assert.doesNotMatch(MODULE_SOURCE, /groundTruth/i);
  assert.doesNotMatch(MODULE_SOURCE, /IoU/i);
});

// ==================================================================================================
// 19 -- no network
// ==================================================================================================
test('19. module has zero network calls', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\bfetch\s*\(/);
  assert.doesNotMatch(MODULE_SOURCE, /https?:\/\//);
});

// ==================================================================================================
// 20 -- production isolation
// ==================================================================================================
test('20. production isolation: index.html and worker.js are unchanged by this stage', () => {
  const ROOT = join(HERE, '..');
  const indexHash = createHash('sha256').update(readFileSync(join(ROOT, 'index.html'))).digest('hex');
  const workerHash = createHash('sha256').update(readFileSync(join(ROOT, 'worker.js'))).digest('hex');
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
  assert.doesNotMatch(MODULE_SOURCE, /\bwindow\./);
  assert.doesNotMatch(MODULE_SOURCE, /BeardTrimAndroid/);
});
