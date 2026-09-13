// Stage BI-1Z1S -- pure, testable instrument-validation utilities for WHOLE_SCAN_TEMPORAL_EXACT_V1
// physical captures. This module performs STRUCTURAL/QUALITY validation ONLY -- it never
// interprets beard motion, neck motion, or any temporal attachment behavior, never runs
// HEAD_RELATIVE_TEMPORAL_MEASUREMENT_V2, never touches occupancy, never loads GT. It consumes an
// already-parsed exact-frame-research-capture package (v2 or v3 shape) and reports objective,
// descriptive facts about capture completeness, exactness, phase coverage, cadence, and safety-cap
// behavior -- nothing more.
'use strict';

export const WHOLE_SCAN_INSTRUMENT_VALIDATION_VERSION = 'whole-scan-instrument-validation/1';

export const REQUIRED_PHASES = Object.freeze([
  'POSE_HOLD_FRONT', 'TRANSITION_FRONT_TO_RIGHT45',
  'POSE_HOLD_RIGHT45', 'TRANSITION_RIGHT45_TO_RIGHT_PROFILE',
  'POSE_HOLD_RIGHT_PROFILE', 'TRANSITION_RIGHT_PROFILE_TO_LEFT45',
  'POSE_HOLD_LEFT45', 'TRANSITION_LEFT45_TO_LEFT_PROFILE',
  'POSE_HOLD_LEFT_PROFILE', 'TRANSITION_LEFT_PROFILE_TO_CHINUP',
  'POSE_HOLD_CHINUP'
]);
export const EXPECTED_FORMAL_LABELS = Object.freeze(['Front', 'Right 3/4', 'Right profile', 'Left 3/4', 'Left profile', 'Chin-up']);
export const EXPECTED_BURST_TRANSITIONS = Object.freeze(['front_TO_right-three-quarter', 'right-three-quarter_TO_right-profile', 'right-profile_TO_left-three-quarter', 'left-three-quarter_TO_left-profile', 'left-profile_TO_chin-up']);

// ---- Part 1 -- complete vs. incomplete classification, never combined --------------------------
export const CAPTURE_CLASSIFICATIONS = Object.freeze(['COMPLETE_VALIDATION_CAPTURE', 'INCOMPLETE_ABORTED_CAPTURE']);
/** A capture counts as complete ONLY when it reached all 6 formal poses AND all 5 burst
 *  transitions -- anything short of that (0 formal poses and 0 bursts included) is classified
 *  incomplete/aborted, never averaged or merged into a "complete" pool. */
export function classifyCapture(pkg) {
  const formalCount = pkg?.manifest?.formalCaptureCount ?? 0;
  const burstCount = Array.isArray(pkg?.temporalMotionBursts) ? pkg.temporalMotionBursts.length : 0;
  const complete = formalCount === 6 && burstCount === 5;
  return complete ? 'COMPLETE_VALIDATION_CAPTURE' : 'INCOMPLETE_ABORTED_CAPTURE';
}

// ---- Part 3 -- formal capture health (never inferred from completion count alone) ---------------
export function checkFormalPoseHealth(pkg, expectedLabels = EXPECTED_FORMAL_LABELS) {
  const associations = Array.isArray(pkg?.formalCaptureAssociations) ? pkg.formalCaptureAssociations : [];
  const labelsSeen = new Set(associations.map(a => a.formalCaptureLabel));
  const missing = expectedLabels.filter(l => !labelsSeen.has(l));
  const malformed = associations.filter(a => a.formalCaptureId == null || a.formalCaptureAt == null);
  const formalTriggeredKeyframes = Array.isArray(pkg?.imageKeyframes) ? pkg.imageKeyframes.filter(k => k.triggerReason === 'FORMAL_POSE_REGION').length : 0;
  return {
    associationCount: associations.length, missing, malformedCount: malformed.length,
    formalTriggeredKeyframeCount: formalTriggeredKeyframes,
    ok: missing.length === 0 && malformed.length === 0 && associations.length === expectedLabels.length
  };
}

// ---- Part 4/5 -- cadence statistics, from raw native timestamps only, never assumed -------------
/** Computes interval statistics (mean/median/p50/p90/p95/min/max/largestGap) directly from a
 *  samples array's own nativeFrameTimestampNs -- a non-monotonic or non-numeric pair contributes
 *  NO interval (never fabricated), exactly mirroring accuracy/temporal-exact-frame-burst.mjs's
 *  own computeIntervalStats() convention. */
export function computeIntervalPercentiles(samples) {
  const intervals = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1].nativeFrameTimestampNs, b = samples[i].nativeFrameTimestampNs;
    if (a == null || b == null) continue;
    try {
      const dt = Number(BigInt(b) - BigInt(a)) / 1e6;
      if (Number.isFinite(dt) && dt >= 0) intervals.push(dt);
    } catch (_e) { /* non-numeric timestamp -- skip, never fabricate */ }
  }
  intervals.sort((x, y) => x - y);
  const pct = p => intervals.length ? intervals[Math.min(intervals.length - 1, Math.floor(p * intervals.length))] : null;
  return {
    count: intervals.length,
    mean: intervals.length ? intervals.reduce((s, v) => s + v, 0) / intervals.length : null,
    median: pct(0.5), p50: pct(0.5), p90: pct(0.9), p95: pct(0.95),
    min: intervals.length ? intervals[0] : null, max: intervals.length ? intervals[intervals.length - 1] : null,
    largestGap: intervals.length ? intervals[intervals.length - 1] : null,
    achievedHz: (intervals.length && intervals.reduce((s, v) => s + v, 0) > 0) ? 1000 / (intervals.reduce((s, v) => s + v, 0) / intervals.length) : null
  };
}

// ---- Part 4 -- burst-reference comparison (descriptive only, never a beard/attachment judgment) --
export function summarizeBurstTransition(burst) {
  const allExact = Array.isArray(burst.samples) && burst.samples.length > 0 && burst.samples.every(s => s.coherenceStatus === 'VERIFIED_EXACT');
  const stats = computeIntervalPercentiles(burst.samples || []);
  return {
    sourceTransition: burst.sourceTransition, sampleCount: burst.sampleCount ?? (burst.samples || []).length,
    allVerifiedExact: allExact, actualDurationMs: burst.actualDurationMs ?? null,
    intervalStats: stats, skippedCount: burst.skippedCount ?? 0, endReason: burst.endReason ?? null
  };
}
/** Descriptive-only comparison of a "current" skip-rate against a "historical" baseline rate --
 *  never a beard/attachment judgment, purely a capture-instrument health signal. Reports the
 *  delta; assigns no pass/fail verdict itself (that remains a human/report-level judgment call). */
export function compareBurstSkipRate(currentTotalSamples, currentTotalSkipped, historicalSkipRatePct) {
  const currentTotal = currentTotalSamples + currentTotalSkipped;
  const currentRatePct = currentTotal > 0 ? (100 * currentTotalSkipped / currentTotal) : 0;
  return { currentRatePct, historicalSkipRatePct, deltaPct: currentRatePct - historicalSkipRatePct };
}

// ---- Part 7 -- phase coverage + ordering, never inferred from image appearance -------------------
export function checkPhaseCoverage(wholeScanSamples, requiredPhases = REQUIRED_PHASES) {
  const counts = {};
  wholeScanSamples.forEach(s => { counts[s.phase] = (counts[s.phase] || 0) + 1; });
  const missing = requiredPhases.filter(p => !counts[p]);
  return { counts, missing, unrecognizedCount: counts['UNRECOGNIZED_STATE'] || 0, fullyCovered: missing.length === 0 };
}
const PHASE_SEQUENCE_INDEX = Object.freeze(Object.fromEntries([
  'POSE_HOLD_FRONT', 'TRANSITION_FRONT_TO_RIGHT45', 'POSE_HOLD_RIGHT45', 'TRANSITION_RIGHT45_TO_RIGHT_PROFILE',
  'POSE_HOLD_RIGHT_PROFILE', 'TRANSITION_RIGHT_PROFILE_TO_LEFT45', 'POSE_HOLD_LEFT45', 'TRANSITION_LEFT45_TO_LEFT_PROFILE',
  'POSE_HOLD_LEFT_PROFILE', 'TRANSITION_LEFT_PROFILE_TO_CHINUP', 'POSE_HOLD_CHINUP'
].map((p, i) => [p, i])));
/** A capture's samples, in native-timestamp order, should visit phases in a NON-DECREASING
 *  sequence index (the scan always moves forward through the six-pose flow, never backward).
 *  UNRECOGNIZED_STATE samples are excluded from the ordering check (their position in the
 *  sequence is unknown by construction, not evidence of a backward jump). Returns every backward
 *  jump found, never silently ignored. */
export function checkPhaseOrdering(wholeScanSamplesInTimestampOrder) {
  const violations = [];
  let lastIdx = -1, lastPhase = null;
  wholeScanSamplesInTimestampOrder.forEach((s, i) => {
    const idx = PHASE_SEQUENCE_INDEX[s.phase];
    if (idx == null) return; // UNRECOGNIZED_STATE -- excluded, not a violation
    if (idx < lastIdx) violations.push({ sampleIndex: i, fromPhase: lastPhase, toPhase: s.phase });
    lastIdx = idx; lastPhase = s.phase;
  });
  return { violations, ok: violations.length === 0 };
}

// ---- Part 8/9 -- hold vs. transition sample presence, never merely a transition recorder --------
export function checkHoldAndTransitionCoverage(wholeScanSamples) {
  const holdPhases = REQUIRED_PHASES.filter(p => p.startsWith('POSE_HOLD_'));
  const transitionPhases = REQUIRED_PHASES.filter(p => p.startsWith('TRANSITION_'));
  const counts = {};
  wholeScanSamples.forEach(s => { counts[s.phase] = (counts[s.phase] || 0) + 1; });
  const holdSampleCount = holdPhases.reduce((s, p) => s + (counts[p] || 0), 0);
  const transitionSampleCount = transitionPhases.reduce((s, p) => s + (counts[p] || 0), 0);
  return {
    holdSampleCount, transitionSampleCount,
    everyHoldPhasePresent: holdPhases.every(p => counts[p] > 0),
    everyTransitionPhasePresent: transitionPhases.every(p => counts[p] > 0),
    isMerelyATransitionRecorder: holdSampleCount === 0 && transitionSampleCount > 0
  };
}

// ---- Part 12 -- safety-cap detection, from the recorded stop reason only -------------------------
export const SAFETY_CAP_STOP_REASONS = Object.freeze(['MAX_SAMPLES_REACHED', 'MAX_DURATION_REACHED', 'MAX_EXPORT_BYTES_REACHED']);
export function checkSafetyCapHit(streamStopReason) {
  return { capHit: SAFETY_CAP_STOP_REASONS.includes(streamStopReason) ? streamStopReason : null, normalStop: streamStopReason === 'SCAN_ENDED' };
}

// ---- Part 11 -- actual export-size accounting, per channel, never confusing registry bytes with
// the whole file -------------------------------------------------------------------------------
export function summarizeExportSizeAccounting(pkg, totalFileBytes) {
  const sumJpeg = (arr, field) => (arr || []).reduce((s, x) => s + ((x && x[field]) ? x[field].length : 0), 0);
  const wholeScanJpegBytes = sumJpeg(pkg?.wholeScanTemporalStream?.samples, 'imageBase64Jpeg');
  const tierBJpegBytes = sumJpeg(pkg?.imageKeyframes, 'dataUrl');
  const burstJpegBytes = (pkg?.temporalMotionBursts || []).reduce((s, b) => s + sumJpeg(b.samples, 'dataUrl'), 0);
  const jpegTotal = wholeScanJpegBytes + tierBJpegBytes + burstJpegBytes;
  return {
    totalFileBytes, wholeScanJpegBytes, tierBJpegBytes, burstJpegBytes, jpegTotal,
    nonJpegOverheadBytes: totalFileBytes - jpegTotal,
    wholeScanTelemetryApproxBytesWritten: pkg?.wholeScanTemporalStream?.telemetry?.approxBytesWritten ?? null,
    telemetryMatchesActualWholeScanJpegSum: pkg?.wholeScanTemporalStream?.telemetry?.approxBytesWritten === wholeScanJpegBytes
  };
}

// ---- Part 13 -- incomplete-capture lifecycle audit, never treated as a failed full scan ----------
export function auditIncompleteCaptureLifecycle(pkg) {
  const ws = pkg?.wholeScanTemporalStream;
  if (!ws) return { hadWholeScanStream: false };
  const allExact = ws.samples.every(s => s.coherenceStatus === 'VERIFIED_EXACT');
  let monotonic = true;
  for (let i = 1; i < ws.samples.length; i++) {
    try { if (BigInt(ws.samples[i].nativeFrameTimestampNs) <= BigInt(ws.samples[i - 1].nativeFrameTimestampNs)) monotonic = false; } catch (_e) { monotonic = false; }
  }
  return {
    hadWholeScanStream: true, sampleCount: ws.samples.length, allVerifiedExact: allExact, timestampsMonotonic: monotonic,
    streamStopReason: ws.telemetry?.streamStopReason ?? null,
    cleanTermination: ws.telemetry?.streamStopReason === 'SCAN_ENDED',
    phasesVisited: [...new Set(ws.samples.map(s => s.phase))]
  };
}
