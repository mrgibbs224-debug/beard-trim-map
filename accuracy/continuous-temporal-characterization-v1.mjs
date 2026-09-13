// Stage BI-1Z1V -- pure, read-only characterization of the validated WHOLE_SCAN_TEMPORAL_EXACT_V1
// instrument's own measurement space. Implements the frozen BI-1Z1U design
// (D:\MettleTemp\analysis\bi1z1u_continuous_temporal_characterization_design.json, SHA256
// 8e405858f59c3ee5bf8f40f555bef75eeebd7f93dcff925bceb34aa0b2016663). This module NEVER modifies
// capture files, scanner state, recorder behavior, V2, occupancy, Hairness, or GT -- it only reads
// an already-exported package's wholeScanTemporalStream + temporalMotionBursts and computes
// descriptive statistics. No semantic beard/shirt/neck field is ever produced. No numeric value
// here is a threshold or tolerance -- every descriptive baseline is explicitly labeled
// DESCRIPTIVE_TEMPORAL_BASELINE_ONLY.
'use strict';

export const CONTINUOUS_TEMPORAL_CHARACTERIZATION_V1_VERSION = 'continuous-temporal-characterization-v1/1';
export const BI1Z1U_DESIGN_SHA256 = '8e405858f59c3ee5bf8f40f555bef75eeebd7f93dcff925bceb34aa0b2016663';
// Part 0/17 (BI-1Z1V) -- ONLY these two scans are authorized as the primary characterization pool.
export const AUTHORIZED_SCAN_SESSION_IDS = Object.freeze(['scan_mtzfzdjl_xpk2fe', 'scan_mtzg1jkw_ckvv0v']);

export const HOLD_PHASES = Object.freeze(['POSE_HOLD_FRONT', 'POSE_HOLD_RIGHT45', 'POSE_HOLD_RIGHT_PROFILE', 'POSE_HOLD_LEFT45', 'POSE_HOLD_LEFT_PROFILE', 'POSE_HOLD_CHINUP']);
export const TRANSITION_PHASES = Object.freeze(['TRANSITION_FRONT_TO_RIGHT45', 'TRANSITION_RIGHT45_TO_RIGHT_PROFILE', 'TRANSITION_RIGHT_PROFILE_TO_LEFT45', 'TRANSITION_LEFT45_TO_LEFT_PROFILE', 'TRANSITION_LEFT_PROFILE_TO_CHINUP']);
export const SETTLING_WINDOWS = Object.freeze([
  { label: '0-250ms', minMs: 0, maxMs: 250 }, { label: '250-500ms', minMs: 250, maxMs: 500 },
  { label: '500-1000ms', minMs: 500, maxMs: 1000 }, { label: '1000-2000ms', minMs: 1000, maxMs: 2000 },
  { label: '>2000ms', minMs: 2000, maxMs: Infinity }
]);
// Part 10 -- reused UNMODIFIED from accuracy/head-relative-temporal-support-v1.mjs's own frozen
// motion-bin boundaries (small max 8 degrees, medium max 20 degrees). Never redefined here.
export function motionBinFor(combinedDeg) {
  if (combinedDeg <= 8) return 'SMALL';
  if (combinedDeg <= 20) return 'MEDIUM';
  return 'LARGE';
}

function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }
export function assertAuthorizedScan(scanSessionId) {
  if (!AUTHORIZED_SCAN_SESSION_IDS.includes(scanSessionId)) {
    throw new Error('Scan ' + scanSessionId + ' is not in the authorized BI-1Z1V characterization pool -- historical scans may only be referenced descriptively, never silently pooled.');
  }
  return true;
}

// ---- Part 2 -- source separation, never silently pooled ------------------------------------------
export function splitByProvenance(samples) {
  return { owned: samples.filter(s => s.provenance === 'WHOLE_SCAN_OWNED'), shared: samples.filter(s => s.provenance === 'BURST_SHARED') };
}
export function groupByPhase(samples) {
  const map = new Map();
  samples.forEach(s => { if (!map.has(s.phase)) map.set(s.phase, []); map.get(s.phase).push(s); });
  return map;
}
function sortByTimestamp(samples) {
  return [...samples].sort((a, b) => { try { const d = BigInt(a.nativeFrameTimestampNs) - BigInt(b.nativeFrameTimestampNs); return d < 0n ? -1 : d > 0n ? 1 : 0; } catch (_e) { return 0; } });
}

// ---- Part 15 -- shared-frame provenance resolution, exact agreement required ---------------------
export function resolveBurstSharedProvenance(sample, temporalMotionBursts) {
  if (sample.provenance !== 'BURST_SHARED') return null;
  const burst = (temporalMotionBursts || []).find(b => b.burstId === sample.sourceBurstId);
  if (!burst) return { resolved: false, reason: 'BURST_ID_NOT_FOUND', timestampMatch: false, coherenceMatch: false };
  const src = (burst.samples || [])[sample.sourceTemporalSampleIndex];
  if (!src) return { resolved: false, reason: 'SAMPLE_INDEX_NOT_FOUND', timestampMatch: false, coherenceMatch: false };
  const timestampMatch = src.nativeFrameTimestampNs === sample.nativeFrameTimestampNs;
  const coherenceMatch = src.coherenceStatus === sample.coherenceStatus;
  return { resolved: timestampMatch && coherenceMatch, reason: (!timestampMatch ? 'TIMESTAMP_MISMATCH' : !coherenceMatch ? 'COHERENCE_MISMATCH' : null), timestampMatch, coherenceMatch, sourceSample: src };
}
/** For analysis purposes ONLY (never re-exported), joins a BURST_SHARED entry's geometry-heavy
 *  fields from its resolved source burst sample -- fails closed (returns the sample unenriched,
 *  never fabricated) if resolution fails. */
export function resolveFullSample(sample, temporalMotionBursts) {
  if (sample.provenance === 'WHOLE_SCAN_OWNED') return sample;
  const res = resolveBurstSharedProvenance(sample, temporalMotionBursts);
  if (!res || !res.resolved) return sample;
  return Object.assign({}, sample, res.sourceSample, { provenance: sample.provenance, phase: sample.phase, nativeFrameTimestampNs: sample.nativeFrameTimestampNs });
}
export function auditSharedProvenance(sharedSamples, temporalMotionBursts) {
  let resolvedCount = 0, resolutionFailureCount = 0, timestampMismatchCount = 0, coherenceMismatchCount = 0;
  const failures = [];
  sharedSamples.forEach(s => {
    const r = resolveBurstSharedProvenance(s, temporalMotionBursts);
    if (r && r.resolved) { resolvedCount++; return; }
    resolutionFailureCount++;
    if (r && r.reason === 'TIMESTAMP_MISMATCH') timestampMismatchCount++;
    if (r && r.reason === 'COHERENCE_MISMATCH') coherenceMismatchCount++;
    failures.push({ wholeScanSampleId: s.wholeScanSampleId, reason: r ? r.reason : 'NULL_RESULT' });
  });
  return { resolvedCount, resolutionFailureCount, timestampMismatchCount, coherenceMismatchCount, failures };
}

// ---- interval/cadence statistics (mirrors accuracy/whole-scan-instrument-validation.mjs's own
// convention -- never fabricates an interval from a missing/non-numeric timestamp pair) ------------
export function computeIntervalStats(samplesSortedByTime) {
  const intervals = [];
  for (let i = 1; i < samplesSortedByTime.length; i++) {
    const a = samplesSortedByTime[i - 1].nativeFrameTimestampNs, b = samplesSortedByTime[i].nativeFrameTimestampNs;
    if (a == null || b == null) continue;
    try { const dt = Number(BigInt(b) - BigInt(a)) / 1e6; if (Number.isFinite(dt) && dt >= 0) intervals.push(dt); } catch (_e) { /* skip, never fabricate */ }
  }
  intervals.sort((x, y) => x - y);
  const pct = p => intervals.length ? intervals[Math.min(intervals.length - 1, Math.floor(p * intervals.length))] : null;
  return {
    count: intervals.length, mean: intervals.length ? intervals.reduce((s, v) => s + v, 0) / intervals.length : null,
    p50: pct(0.5), p90: pct(0.9), p95: pct(0.95), max: intervals.length ? intervals[intervals.length - 1] : null,
    achievedHz: intervals.length ? 1000 / (intervals.reduce((s, v) => s + v, 0) / intervals.length) : null
  };
}

// ---- angular-delta consecutive-pair distributions (combined = |Δyaw|+|Δpitch|, the SAME
// convention motionBin() already uses -- never a new definition) -----------------------------------
export function computeConsecutivePairDeltas(samplesSortedByTime) {
  const yaw = [], pitch = [], roll = [], combined = [], transformMag = [], landmarkMag = [];
  for (let i = 1; i < samplesSortedByTime.length; i++) {
    const a = samplesSortedByTime[i - 1], b = samplesSortedByTime[i];
    const dy = (isFiniteNum(a.yawDeg) && isFiniteNum(b.yawDeg)) ? Math.abs(a.yawDeg - b.yawDeg) : null;
    const dp = (isFiniteNum(a.pitchDeg) && isFiniteNum(b.pitchDeg)) ? Math.abs(a.pitchDeg - b.pitchDeg) : null;
    const dr = (isFiniteNum(a.rollDeg) && isFiniteNum(b.rollDeg)) ? Math.abs(a.rollDeg - b.rollDeg) : null;
    if (dy != null) yaw.push(dy);
    if (dp != null) pitch.push(dp);
    if (dr != null) roll.push(dr);
    if (dy != null && dp != null) combined.push(dy + dp);
    const tm = transformDeltaMagnitude(a, b); if (tm != null) transformMag.push(tm);
    const lm = landmarkMotionMagnitude(a, b); if (lm != null) landmarkMag.push(lm);
  }
  return { yaw, pitch, roll, combined, transformMag, landmarkMag };
}
export function transformDeltaMagnitude(a, b, field = 'imageSpaceViewModelMatrix') {
  if (!Array.isArray(a[field]) || !Array.isArray(b[field]) || a[field].length !== 16 || b[field].length !== 16) return null;
  let sumSq = 0; for (let i = 0; i < 16; i++) { const d = a[field][i] - b[field][i]; sumSq += d * d; }
  return Math.sqrt(sumSq);
}
export function landmarkMotionMagnitude(a, b) {
  if (!Array.isArray(a.landmarks2D) || !Array.isArray(b.landmarks2D) || a.landmarks2D.length !== b.landmarks2D.length || a.landmarks2D.length === 0) return null;
  let sum = 0, n = 0;
  for (let i = 0; i < a.landmarks2D.length; i++) {
    const pa = a.landmarks2D[i], pb = b.landmarks2D[i];
    if (!pa || !pb) continue;
    sum += Math.hypot(pa.x - pb.x, pa.y - pb.y); n++;
  }
  return n ? sum / n : null;
}
export function descriptiveStats(values) {
  if (!values.length) return { count: 0, median: null, p75: null, p90: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const pct = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { count: sorted.length, median: pct(0.5), p75: pct(0.75), p90: pct(0.9), p95: pct(0.95), max: sorted[sorted.length - 1] };
}

// ---- Part 3 -- hold-phase metrics, DATA_INSUFFICIENT below 2 samples, never interpolated ----------
export function buildHoldPhaseMetrics(ownedSamples, phase) {
  const phaseSamples = sortByTimestamp(ownedSamples.filter(s => s.phase === phase));
  if (phaseSamples.length < 2) return { phase, sampleCount: phaseSamples.length, status: 'DATA_INSUFFICIENT' };
  const interval = computeIntervalStats(phaseSamples);
  const deltas = computeConsecutivePairDeltas(phaseSamples);
  const first = phaseSamples[0].nativeFrameTimestampNs, last = phaseSamples[phaseSamples.length - 1].nativeFrameTimestampNs;
  let durationMs = null; try { durationMs = Number(BigInt(last) - BigInt(first)) / 1e6; } catch (_e) { /* leave null */ }
  return {
    phase, sampleCount: phaseSamples.length, status: 'OK', durationMs,
    achievedCadenceHz: interval.achievedHz, p50IntervalMs: interval.p50, p90IntervalMs: interval.p90, p95IntervalMs: interval.p95,
    largestWithinPhaseGapMs: interval.max,
    yawDeltaStats: descriptiveStats(deltas.yaw), pitchDeltaStats: descriptiveStats(deltas.pitch), rollDeltaStats: descriptiveStats(deltas.roll),
    combinedDeltaStats: descriptiveStats(deltas.combined), transformDeltaStats: descriptiveStats(deltas.transformMag), landmarkMotionStats: descriptiveStats(deltas.landmarkMag)
  };
}

// ---- Part 4 -- profile-hold sparsity, causal attribution WITHOUT changing the scanner -------------
export function characterizeProfileHoldSparsity(ownedSamples, sharedSamples, phase, precedingTransitionPhase, followingTransitionPhase) {
  const phaseSamples = sortByTimestamp(ownedSamples.filter(s => s.phase === phase));
  const precedingTransition = sortByTimestamp(sharedSamples.filter(s => s.phase === precedingTransitionPhase));
  const followingTransition = sortByTimestamp(sharedSamples.filter(s => s.phase === followingTransitionPhase));
  const isSingleSample = phaseSamples.length === 1;
  let holdDurationMs = null;
  if (phaseSamples.length >= 2) { try { holdDurationMs = Number(BigInt(phaseSamples[phaseSamples.length - 1].nativeFrameTimestampNs) - BigInt(phaseSamples[0].nativeFrameTimestampNs)) / 1e6; } catch (_e) { /* leave null */ } }
  let timeToNextAdvanceMs = null;
  if (phaseSamples.length && followingTransition.length) { try { timeToNextAdvanceMs = Number(BigInt(followingTransition[0].nativeFrameTimestampNs) - BigInt(phaseSamples[phaseSamples.length - 1].nativeFrameTimestampNs)) / 1e6; } catch (_e) { /* leave null */ } }
  let cause = 'UNKNOWN';
  if (phaseSamples.length === 0) cause = 'MISSING_DATA';
  else if (isSingleSample && timeToNextAdvanceMs != null && timeToNextAdvanceMs < 300) cause = 'GENUINELY_SHORT_HOLD_DURATION';
  else if (isSingleSample) cause = 'SAMPLING_YIELD_OR_LIFECYCLE_TRANSITION';
  return { phase, sampleCount: phaseSamples.length, isSingleSample, holdDurationMs, timeToNextAdvanceMs, likelyCause: cause };
}

// ---- Part 6 -- above-noise classification, descriptive only, no fitted semantic threshold ---------
export const ABOVE_NOISE_STATES = Object.freeze(['MOTION_MEASURABLE', 'MOTION_NEAR_NOISE_FLOOR', 'DATA_INSUFFICIENT', 'MIXED_BY_POSE']);
/** Purely descriptive: a phase's median combined angular delta is compared against a small,
 *  DOCUMENTED numerical epsilon (0.05deg, near the practical resolution floor of a yaw/pitch
 *  estimate) -- never a fitted or calibrated semantic threshold. */
export function classifyAboveNoise(holdPhaseMetricsList, epsilonDeg = 0.05) {
  const usable = holdPhaseMetricsList.filter(m => m.status === 'OK');
  if (!usable.length) return { state: 'DATA_INSUFFICIENT', basis: 'no hold phase had >= 2 samples' };
  const measurable = usable.filter(m => m.combinedDeltaStats.median != null && m.combinedDeltaStats.median > epsilonDeg);
  const nearFloor = usable.filter(m => m.combinedDeltaStats.median != null && m.combinedDeltaStats.median <= epsilonDeg);
  if (measurable.length === usable.length) return { state: 'MOTION_MEASURABLE', basis: usable.length + '/' + usable.length + ' usable phases show median combined delta > ' + epsilonDeg + 'deg' };
  if (nearFloor.length === usable.length) return { state: 'MOTION_NEAR_NOISE_FLOOR', basis: usable.length + '/' + usable.length + ' usable phases at/below ' + epsilonDeg + 'deg' };
  return { state: 'MIXED_BY_POSE', basis: measurable.length + '/' + usable.length + ' usable phases measurable, remainder near noise floor', measurablePhases: measurable.map(m => m.phase), nearFloorPhases: nearFloor.map(m => m.phase) };
}

// ---- Part 7/8 -- settling windows + trend, no assumed monotonic decay -----------------------------
export function assignSettlingWindow(elapsedMs) {
  const w = SETTLING_WINDOWS.find(w => elapsedMs >= w.minMs && elapsedMs < w.maxMs);
  return w ? w.label : null;
}
/** `holdSamples` must be sorted by timestamp already; `transitionEndTimestampNs` is the boundary
 *  (the shared transition's own last sample timestamp immediately preceding this hold). */
export function buildSettlingWindowReport(holdSamplesSorted, transitionEndTimestampNs) {
  if (transitionEndTimestampNs == null || !holdSamplesSorted.length) return SETTLING_WINDOWS.map(w => ({ window: w.label, status: 'DATA_INSUFFICIENT' }));
  let t0; try { t0 = BigInt(transitionEndTimestampNs); } catch (_e) { return SETTLING_WINDOWS.map(w => ({ window: w.label, status: 'DATA_INSUFFICIENT' })); }
  const withElapsed = holdSamplesSorted.map(s => { let elapsedMs = null; try { elapsedMs = Number(BigInt(s.nativeFrameTimestampNs) - t0) / 1e6; } catch (_e) { /* leave null */ } return { s, elapsedMs }; }).filter(x => x.elapsedMs != null && x.elapsedMs >= 0);
  return SETTLING_WINDOWS.map(w => {
    const inWindow = withElapsed.filter(x => x.elapsedMs >= w.minMs && x.elapsedMs < w.maxMs).map(x => x.s);
    if (inWindow.length < 1) return { window: w.label, sampleCount: 0, status: 'DATA_INSUFFICIENT' };
    const sortedInWindow = sortByTimestamp(inWindow);
    const deltas = computeConsecutivePairDeltas(sortedInWindow);
    return {
      window: w.label, sampleCount: inWindow.length, usablePairCount: deltas.combined.length,
      status: deltas.combined.length ? 'OK' : 'DATA_INSUFFICIENT',
      meanAbsYawDelta: deltas.yaw.length ? deltas.yaw.reduce((s, v) => s + v, 0) / deltas.yaw.length : null,
      meanAbsPitchDelta: deltas.pitch.length ? deltas.pitch.reduce((s, v) => s + v, 0) / deltas.pitch.length : null,
      meanAbsRollDelta: deltas.roll.length ? deltas.roll.reduce((s, v) => s + v, 0) / deltas.roll.length : null,
      meanCombinedDelta: deltas.combined.length ? deltas.combined.reduce((s, v) => s + v, 0) / deltas.combined.length : null
    };
  });
}
export const SETTLING_TRENDS = Object.freeze(['DECREASING', 'FLAT', 'INCREASING', 'DATA_INSUFFICIENT']);
/** Descriptive-only trend: compares the first vs. last USABLE window's meanCombinedDelta. No
 *  model fit, no significance threshold, no production output. */
export function classifySettlingTrend(settlingWindowReport) {
  const usable = settlingWindowReport.filter(w => w.status === 'OK' && w.meanCombinedDelta != null);
  if (usable.length < 2) return { trend: 'DATA_INSUFFICIENT', basis: 'fewer than 2 usable settling windows' };
  const first = usable[0].meanCombinedDelta, last = usable[usable.length - 1].meanCombinedDelta;
  const relChange = first > 0 ? (last - first) / first : null;
  if (relChange == null) return { trend: 'DATA_INSUFFICIENT', basis: 'first usable window has zero motion, cannot compute relative change' };
  if (relChange < -0.2) return { trend: 'DECREASING', basis: 'relative change ' + relChange.toFixed(3) };
  if (relChange > 0.2) return { trend: 'INCREASING', basis: 'relative change ' + relChange.toFixed(3) };
  return { trend: 'FLAT', basis: 'relative change ' + relChange.toFixed(3) };
}

// ---- Part 9 -- transition characterization (BURST_SHARED only, resolved to full geometry) ---------
export function buildTransitionMetrics(sharedSamplesResolved, phase) {
  const phaseSamples = sortByTimestamp(sharedSamplesResolved.filter(s => s.phase === phase));
  if (phaseSamples.length < 2) return { phase, sampleCount: phaseSamples.length, status: 'DATA_INSUFFICIENT' };
  const interval = computeIntervalStats(phaseSamples);
  const deltas = computeConsecutivePairDeltas(phaseSamples);
  const first = phaseSamples[0].nativeFrameTimestampNs, last = phaseSamples[phaseSamples.length - 1].nativeFrameTimestampNs;
  let durationMs = null; try { durationMs = Number(BigInt(last) - BigInt(first)) / 1e6; } catch (_e) { /* leave null */ }
  const motionBinCounts = {};
  deltas.combined.forEach(c => { const bin = motionBinFor(c); motionBinCounts[bin] = (motionBinCounts[bin] || 0) + 1; });
  return {
    phase, sampleCount: phaseSamples.length, status: 'OK', durationMs, achievedCadenceHz: interval.achievedHz,
    yawDeltaStats: descriptiveStats(deltas.yaw), pitchDeltaStats: descriptiveStats(deltas.pitch), rollDeltaStats: descriptiveStats(deltas.roll),
    combinedDeltaStats: descriptiveStats(deltas.combined), maxPairwiseAngularStepDeg: deltas.combined.length ? Math.max(...deltas.combined) : null,
    motionBinCounts, transformDeltaStats: descriptiveStats(deltas.transformMag)
  };
}

// ---- Part 10 -- motion-bin coverage, reused unmodified -------------------------------------------
export function tallyMotionBins(samplesSortedByTime) {
  const deltas = computeConsecutivePairDeltas(sortByTimestamp(samplesSortedByTime));
  const counts = { SMALL: 0, MEDIUM: 0, LARGE: 0 };
  deltas.combined.forEach(c => { counts[motionBinFor(c)]++; });
  return counts;
}

// ---- Part 13 -- hold-vs-transition regime separation, physical descriptors only -------------------
export const REGIME_SEPARATION_STATES = Object.freeze(['CLEARLY_SEPARATED', 'PARTIALLY_OVERLAPPING', 'HEAVILY_OVERLAPPING', 'DATA_INSUFFICIENT']);
/** Compares combined-angular-change-PER-SECOND between hold and transition regimes (never raw
 *  per-sample delta alone, since cadence differs structurally between the two sources). */
export function classifyHoldVsTransitionSeparation(ownedSamplesSorted, sharedSamplesSorted) {
  function ratesPerSecond(samples) {
    const deltas = computeConsecutivePairDeltas(samples);
    const rates = [];
    for (let i = 1; i < samples.length; i++) {
      try {
        const dtMs = Number(BigInt(samples[i].nativeFrameTimestampNs) - BigInt(samples[i - 1].nativeFrameTimestampNs)) / 1e6;
        if (dtMs > 0 && i - 1 < deltas.combined.length) rates.push(deltas.combined[i - 1] / (dtMs / 1000));
      } catch (_e) { /* skip */ }
    }
    return rates;
  }
  const holdRates = ratesPerSecond(ownedSamplesSorted), transitionRates = ratesPerSecond(sharedSamplesSorted);
  if (holdRates.length < 2 || transitionRates.length < 2) return { state: 'DATA_INSUFFICIENT', holdRateStats: descriptiveStats(holdRates), transitionRateStats: descriptiveStats(transitionRates) };
  const holdStats = descriptiveStats(holdRates), transitionStats = descriptiveStats(transitionRates);
  const overlap = !(holdStats.p90 < transitionStats.median) ? 'HEAVY' : (holdStats.median < transitionStats.p90 && holdStats.p90 >= transitionStats.median) ? 'PARTIAL' : 'NONE';
  const state = overlap === 'NONE' ? 'CLEARLY_SEPARATED' : overlap === 'PARTIAL' ? 'PARTIALLY_OVERLAPPING' : 'HEAVILY_OVERLAPPING';
  return { state, holdRateStats: holdStats, transitionRateStats: transitionStats };
}

// ---- Part 14 -- boundary continuity, discontinuities reported, never hidden -----------------------
export const BOUNDARY_FLAGS = Object.freeze(['CLEAN', 'GAP_PRESENT', 'DUPLICATE_COLLAPSED', 'DISCONTINUITY', 'DATA_INSUFFICIENT']);
export function characterizeBoundary(lastPreBoundarySample, firstPostBoundarySample, gapThresholdMs = 1000, jumpThresholdDeg = 15) {
  if (!lastPreBoundarySample || !firstPostBoundarySample) return { flag: 'DATA_INSUFFICIENT' };
  let timestampGapMs = null;
  try { timestampGapMs = Number(BigInt(firstPostBoundarySample.nativeFrameTimestampNs) - BigInt(lastPreBoundarySample.nativeFrameTimestampNs)) / 1e6; } catch (_e) { return { flag: 'DATA_INSUFFICIENT' }; }
  if (timestampGapMs === 0 && lastPreBoundarySample.scanSessionId === firstPostBoundarySample.scanSessionId) return { flag: 'DUPLICATE_COLLAPSED', timestampGapMs };
  const yawJump = (isFiniteNum(lastPreBoundarySample.yawDeg) && isFiniteNum(firstPostBoundarySample.yawDeg)) ? Math.abs(lastPreBoundarySample.yawDeg - firstPostBoundarySample.yawDeg) : null;
  const pitchJump = (isFiniteNum(lastPreBoundarySample.pitchDeg) && isFiniteNum(firstPostBoundarySample.pitchDeg)) ? Math.abs(lastPreBoundarySample.pitchDeg - firstPostBoundarySample.pitchDeg) : null;
  const rollJump = (isFiniteNum(lastPreBoundarySample.rollDeg) && isFiniteNum(firstPostBoundarySample.rollDeg)) ? Math.abs(lastPreBoundarySample.rollDeg - firstPostBoundarySample.rollDeg) : null;
  const combinedJump = (yawJump != null && pitchJump != null) ? yawJump + pitchJump : null;
  const transformJump = transformDeltaMagnitude(lastPreBoundarySample, firstPostBoundarySample);
  let flag = 'CLEAN';
  if (timestampGapMs > gapThresholdMs) flag = 'GAP_PRESENT';
  if (combinedJump != null && combinedJump > jumpThresholdDeg) flag = 'DISCONTINUITY';
  return { flag, timestampGapMs, yawJump, pitchJump, rollJump, combinedJump, transformJump };
}

// ---- Part 17 -- future V2 structural-readiness audit (design-check only, never executes V2) -------
export function auditV2Readiness(ownedSamples) {
  const gaps = [];
  const withFace = ownedSamples.filter(s => Array.isArray(s.faceLocal3D) && s.faceLocal3D.length === 468);
  const withMatrix = ownedSamples.filter(s => Array.isArray(s.imageSpaceViewModelMatrix) && s.imageSpaceViewModelMatrix.length === 16);
  const withIntrinsics = ownedSamples.filter(s => s.intrinsics && isFiniteNum(s.intrinsics.fx) && isFiniteNum(s.intrinsics.fy));
  const withImage = ownedSamples.filter(s => typeof s.imageBase64Jpeg === 'string' && s.imageBase64Jpeg.length > 0);
  const withExact = ownedSamples.filter(s => s.coherenceStatus === 'VERIFIED_EXACT');
  if (withFace.length !== ownedSamples.length) gaps.push('faceLocal3D missing on ' + (ownedSamples.length - withFace.length) + '/' + ownedSamples.length + ' owned samples');
  if (withMatrix.length !== ownedSamples.length) gaps.push('imageSpaceViewModelMatrix missing on ' + (ownedSamples.length - withMatrix.length) + '/' + ownedSamples.length);
  if (withIntrinsics.length !== ownedSamples.length) gaps.push('intrinsics missing on ' + (ownedSamples.length - withIntrinsics.length) + '/' + ownedSamples.length);
  if (withImage.length !== ownedSamples.length) gaps.push('imageBase64Jpeg missing on ' + (ownedSamples.length - withImage.length) + '/' + ownedSamples.length);
  if (withExact.length !== ownedSamples.length) gaps.push('non-VERIFIED_EXACT samples present: ' + (ownedSamples.length - withExact.length));
  return { outcome: gaps.length === 0 ? 'READY_FOR_FUTURE_V2_EXPERIMENT_DESIGN' : 'V2_INPUT_GAPS_IDENTIFIED', gaps, sampleCount: ownedSamples.length };
}

// ---- Part 18 -- future neck/submental usefulness (descriptive-only, no anatomy claim) -------------
export const NECK_FEASIBILITY_STATES = Object.freeze(['POTENTIALLY_USEFUL', 'LIMITED', 'DATA_INSUFFICIENT']);
export function assessNeckFeasibilitySignal(settlingTrendResult, holdPhaseMetricsList, chinUpMetrics) {
  const usableHolds = holdPhaseMetricsList.filter(m => m.status === 'OK').length;
  if (usableHolds === 0) return { state: 'DATA_INSUFFICIENT', basis: 'no usable hold phase' };
  if (settlingTrendResult.trend !== 'DATA_INSUFFICIENT' && chinUpMetrics && chinUpMetrics.status === 'OK') return { state: 'POTENTIALLY_USEFUL', basis: 'a settling trend was computable and chin-up hold data exists' };
  return { state: 'LIMITED', basis: 'settling trend or chin-up hold data insufficient in this two-scan dataset' };
}
