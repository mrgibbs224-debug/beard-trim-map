// Stage BI-1Z1W -- pure, read-only audit of profile-hold phase-label semantics vs. actual physical
// motion late in the RIGHT45->RIGHT_PROFILE / LEFT45->LEFT_PROFILE transition bursts. Implements
// BI-1Z1W's analysis-only scope: no scanner timing change, no burst/whole-scan recorder change, no
// new pose threshold, no V2 execution, no beard/neck classification. Reuses the EXISTING,
// already-established observedPoseRegion classification (RIGHT_PROFILE_REGION/LEFT_PROFILE_REGION,
// computed by index.html's own __a60bClassifyRegion() and stored on every burst sample) -- never a
// new yaw cutoff. Consumes accuracy/continuous-temporal-characterization-v1.mjs's pure primitives
// unmodified for angular-delta computation.
'use strict';
import { computeConsecutivePairDeltas, descriptiveStats } from './continuous-temporal-characterization-v1.mjs';

export const PROFILE_PHASE_SEMANTICS_AUDIT_V1_VERSION = 'profile-phase-semantics-audit-v1/1';
export const BI1Z1V_CHARACTERIZATION_SHA256 = 'af17221af87c9a2f05ff7b03732a32be8b51e36e79868ae00d108c6caef271ca';
export const BI1Z1V_PHASE_METRICS_SHA256 = '2fb738b786ec862287acffd7a1e431228633e3d28690526d9968cafe184b5d55';
export const AUTHORIZED_SCAN_SESSION_IDS = Object.freeze(['scan_mtzfzdjl_xpk2fe', 'scan_mtzg1jkw_ckvv0v']);

export function assertAuthorizedScan(scanSessionId) {
  if (!AUTHORIZED_SCAN_SESSION_IDS.includes(scanSessionId)) throw new Error('Scan ' + scanSessionId + ' is not in the authorized BI-1Z1W pool.');
  return true;
}

// ---- Part 7 -- burst-end (POSE_LOCK_SETTLED) semantics, established from READING index.html's
// own source (never inferred from the name alone). Documented here as a frozen, verified fact
// record -- this module does not recompute it, it only reports what the source code says. --------
export const BURST_END_SEMANTICS = Object.freeze({
  sourceEvidence: {
    lockedAtMsSetBy: '__temporalBurstTick() calls rec.notePoseLock(nowMs) whenever the SAME `ready` boolean the scanner UI itself uses is true; notePoseLock sets currentBurst.lockedAtMs ONLY ONCE, on the first tick `ready` becomes true.',
    readyDefinition: 'ready = q.ok && stableFrames>=4 && (STEPS[currentStepIndex].id!==\'front\' || sessionCalibrated) -- raw pose-quality + 4-consecutive-stable-frame condition. Read directly from index.html\'s existing scanner loop.',
    burstCloseCondition: 'tickEndConditions() ends the burst with endReason=\'POSE_LOCK_SETTLED\' when (nowMs - lockedAtMs) >= TEMPORAL_BURST_SETTLE_TAIL_MS (400ms, frozen constant).',
    formalCaptureGate: 'takeCapture() fires only when ready AND mgScan2Ready() (mgScan2.state===\'locked\'||\'captured\'). mgScan2Ready() requires mgScan2.continuousReadyMs >= mgScan2HoldMs(), a SEPARATE continuous-hold timer that only accumulates while `ready` stays true.',
    mgScan2HoldMsByPose: { 'right-profile': 450, 'left-profile': 450, 'chin-up': 550, 'front_or_three-quarter': 800 }
  },
  meaning: 'POSE_LOCK_SETTLED means "raw pose-quality achieved and held stably for the burst\'s own fixed 400ms settle tail" -- it is NOT identical to "formal frame acquired" or "scanner step immediately advancing." It is closer to a superset of "hold condition satisfied" than to "capture-ready condition satisfied," because mgScan2\'s own hold-timer requirement can be LONGER (800ms for front/3-4, 550ms for chin-up) or nearly equal (450ms for profile poses) to the burst\'s fixed 400ms settle tail.',
  practicalConsequence: 'For PROFILE poses specifically, mgScan2HoldMs (450ms) is only 50ms longer than the burst settle tail (400ms) -- meaning the burst typically closes JUST BEFORE the formal capture fires, while for front/3-4 (800ms) and chin-up (550ms) the formal capture requirement is comfortably longer than the burst settle tail, leaving a genuine POST-BURST POSE_HOLD window before formal capture. This is the code-level root cause of the profile-hold sparsity BI-1Z1V observed.'
});

// ---- Part 8 -- phase-label coarseness ------------------------------------------------------------
/** A burst's tail is "already profile-aligned" if its FINAL sample (the one active at burst-close,
 *  i.e. the moment __wholeScanPhase() would still report TRANSITION_* because currentBurst is
 *  still non-null) already carries the EXISTING, unmodified observedPoseRegion classification for
 *  the destination profile region. Never a new threshold -- purely a read of the already-exported
 *  field. */
export function auditPhaseLabelCoarseness(burstSamplesSorted, destinationProfileRegion) {
  if (!burstSamplesSorted.length) return { confirmed: false, reason: 'DATA_INSUFFICIENT' };
  const last = burstSamplesSorted[burstSamplesSorted.length - 1];
  const alreadyAligned = last.observedPoseRegion === destinationProfileRegion;
  return {
    confirmed: alreadyAligned,
    reason: alreadyAligned ? 'PHASE_LABEL_COARSENESS_CONFIRMED' : 'LAST_BURST_SAMPLE_NOT_YET_PROFILE_ALIGNED',
    lastSampleRegion: last.observedPoseRegion, lastSampleTimestampNs: last.nativeFrameTimestampNs
  };
}

// ---- Part 4 -- late-window extraction + classification --------------------------------------------
export const LATE_WINDOWS_MS = Object.freeze([250, 500, 750, 1000]);
export function extractLateWindow(burstSamplesSorted, endTimestampNs, windowMs) {
  let endNs; try { endNs = BigInt(endTimestampNs); } catch (_e) { return []; }
  return burstSamplesSorted.filter(s => { try { const d = Number(endNs - BigInt(s.nativeFrameTimestampNs)) / 1e6; return d >= 0 && d <= windowMs; } catch (_e) { return false; } });
}
export const LATE_WINDOW_STATES = Object.freeze(['STILL_TURNING', 'SETTLING', 'LOW_MOTION_PROFILE_ALIGNED', 'DATA_INSUFFICIENT']);
/** Descriptive-only classification. `holdReferenceMedian` is an already-computed (BI-1Z1V-frozen)
 *  median combined-angular-delta from a genuine hold phase in the SAME scan, used only as a
 *  descriptive comparison anchor -- never a new fitted/tuned threshold. Region consistency uses
 *  the EXISTING observedPoseRegion field only. */
export function classifyLateWindowMotion(windowSamplesSorted, destinationProfileRegion, holdReferenceMedian) {
  if (windowSamplesSorted.length < 2) return { state: 'DATA_INSUFFICIENT', sampleCount: windowSamplesSorted.length };
  const deltas = computeConsecutivePairDeltas(windowSamplesSorted);
  const stats = descriptiveStats(deltas.combined);
  const regionCounts = {};
  windowSamplesSorted.forEach(s => { regionCounts[s.observedPoseRegion] = (regionCounts[s.observedPoseRegion] || 0) + 1; });
  const alignedCount = regionCounts[destinationProfileRegion] || 0;
  const majorityAligned = alignedCount >= Math.ceil(windowSamplesSorted.length / 2);
  let state;
  if (!majorityAligned) state = 'STILL_TURNING';
  else if (stats.median != null && holdReferenceMedian != null && stats.median <= holdReferenceMedian * 2) state = 'LOW_MOTION_PROFILE_ALIGNED';
  else state = 'SETTLING';
  return { state, sampleCount: windowSamplesSorted.length, pairCount: deltas.combined.length, medianCombinedDelta: stats.median, p90CombinedDelta: stats.p90, regionCounts, majorityAligned };
}

// ---- Part 6 -- formal-capture relationship ---------------------------------------------------------
export const FORMAL_CAPTURE_RELATIONSHIP_STATES = Object.freeze(['A_STILL_TURNING', 'B_SETTLING', 'C_LOW_MOTION_ALIGNED', 'D_INSUFFICIENT_METADATA']);
export function determineFormalCaptureRelationship(formalCaptureNativeTs, burstEndNativeTs, lastLateWindowClassification) {
  if (formalCaptureNativeTs == null || burstEndNativeTs == null || !lastLateWindowClassification) return { state: 'D_INSUFFICIENT_METADATA' };
  let gapMs; try { gapMs = Number(BigInt(formalCaptureNativeTs) - BigInt(burstEndNativeTs)) / 1e6; } catch (_e) { return { state: 'D_INSUFFICIENT_METADATA' }; }
  const map = { STILL_TURNING: 'A_STILL_TURNING', SETTLING: 'B_SETTLING', LOW_MOTION_PROFILE_ALIGNED: 'C_LOW_MOTION_ALIGNED', DATA_INSUFFICIENT: 'D_INSUFFICIENT_METADATA' };
  return { state: map[lastLateWindowClassification.state] || 'D_INSUFFICIENT_METADATA', formalCaptureAfterBurstEndMs: gapMs };
}

// ---- Part 9 -- provenance/identity preservation guard (structural, never rewrites) -----------------
export function assertBurstProvenancePreserved(originalBurstSample, analyzedSample) {
  return originalBurstSample.nativeFrameTimestampNs === analyzedSample.nativeFrameTimestampNs
    && originalBurstSample.coherenceStatus === analyzedSample.coherenceStatus;
}

// ---- Part 10 -- profile temporal-data sufficiency --------------------------------------------------
export const PROFILE_SUFFICIENCY_STATES = Object.freeze(['EXISTING_BURST_DATA_SUFFICIENT', 'PARTIALLY_SUFFICIENT', 'TRUE_PROFILE_HOLD_DATA_SPARSE', 'DATA_INSUFFICIENT']);
export function assessProfileSufficiency(lateWindowResults, coarsenessResult) {
  const usableWindows = lateWindowResults.filter(w => w.state !== 'DATA_INSUFFICIENT');
  if (!usableWindows.length) return { state: 'DATA_INSUFFICIENT', basis: 'no late window had >= 2 samples' };
  const alignedLowMotion = usableWindows.filter(w => w.state === 'LOW_MOTION_PROFILE_ALIGNED').length;
  if (coarsenessResult.confirmed && alignedLowMotion === usableWindows.length) return { state: 'EXISTING_BURST_DATA_SUFFICIENT', basis: 'burst tail is profile-aligned AND every usable late window classifies LOW_MOTION_PROFILE_ALIGNED' };
  if (coarsenessResult.confirmed && alignedLowMotion > 0) return { state: 'PARTIALLY_SUFFICIENT', basis: alignedLowMotion + '/' + usableWindows.length + ' usable late windows classify LOW_MOTION_PROFILE_ALIGNED' };
  return { state: 'TRUE_PROFILE_HOLD_DATA_SPARSE', basis: 'burst tail not confirmed profile-aligned and/or no late window shows low motion' };
}

// ---- Part 12 -- cross-pose quick check (reuses the same coarseness check for non-profile poses) --
export function auditCrossPoseCoarseness(transitionBurstSamplesSorted, destinationRegionLabel) {
  return auditPhaseLabelCoarseness(transitionBurstSamplesSorted, destinationRegionLabel);
}
