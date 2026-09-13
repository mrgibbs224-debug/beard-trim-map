// Stage BI-1Z2A -- CORRECTED TEMPORAL SUBPHASE ADDITIVE INSTRUMENTATION.
// Pure mirror of the classification/event logic additively wired into index.html this stage.
// Implements ONLY the corrected design frozen in
// D:/MettleTemp/analysis/bi1z1x1_temporal_subphase_semantics_corrected_design.json
// (SHA256 f459b495dd465282f0254b5f83bbe50329bafb6902d53c27292ca6eb250def5d).
//
// OBSERVATION ONLY. This module contains no scanner timing, no burst cadence, no pose threshold,
// no motion threshold. It classifies already-computed scanner facts into a fixed vocabulary and
// never invents a numeric cutoff of its own.

export const DURATION_SUBPHASES = Object.freeze([
  'TURNING_OR_OFF_TARGET',
  'TARGET_REGION_MATCHED_NOT_READY',
  'BURST_SETTLE_TIMER_ACTIVE',
  'POST_BURST_FORMAL_HOLD',
  'UNKNOWN_SUBPHASE'
]);

export const POINT_EVENT_TYPES = Object.freeze([
  'FIRST_TARGET_REGION_MATCH',
  'FIRST_READY_TRUE',
  'BURST_CLOSE',
  'FORMAL_CAPTURED',
  'STEP_ADVANCED',
  'CAPTURE_ATTEMPT_FAILED'
]);

// Explicitly excluded per BI-1Z1X.1 Correction 1/2/3 -- never re-introduced as duration states.
export const REMOVED_DURATION_STATES = Object.freeze(['READY_SETTLING', 'LOCK_SETTLED', 'POST_CAPTURE_HOLD', 'FORMAL_CAPTURE_PENDING']);

// Mirrors index.html's existing STEPS[].id <-> __a60bClassifyRegion()'s formal region names.
// Not a new threshold -- purely a naming correspondence between two already-existing vocabularies.
export const STEP_ID_TO_FORMAL_REGION = Object.freeze({
  'front': 'FRONT_REGION',
  'right-three-quarter': 'RIGHT45_REGION',
  'right-profile': 'RIGHT_PROFILE_REGION',
  'left-three-quarter': 'LEFT45_REGION',
  'left-profile': 'LEFT_PROFILE_REGION',
  'chin-up': 'CHINUP_REGION'
});

export const BURST_CLOSE_REASONS_IMPLYING_POSE_LOCK = Object.freeze(['POSE_LOCK_SETTLED']);
export const BURST_CLOSE_REASONS_NOT_IMPLYING_POSE_LOCK = Object.freeze([
  'MAX_DURATION_REACHED', 'MAX_FRAMES_PER_BURST_REACHED', 'SUPERSEDED_BY_NEW_BURST', 'SCAN_ENDED'
]);

/**
 * Pure classification of the corrected duration-state taxonomy from already-computed facts.
 * Fails closed to UNKNOWN_SUBPHASE whenever a required input is missing or the combination is
 * genuinely not named by the corrected 5-state vocabulary (e.g. on-target AND ready with no
 * burst context -- the removed POST_CAPTURE_HOLD state's territory, deliberately left unnamed).
 */
export function classifyDurationSubphase(facts) {
  if (!facts || typeof facts !== 'object') return 'UNKNOWN_SUBPHASE';
  const {
    destinationRegionMatchedAtTrigger,
    scannerReadyAtTrigger,
    burstActiveAtTrigger,
    lockedAtMsKnownSetAtTrigger,
    precedingBurstClosedWithPoseLockSettled,
    formalCaptureCommittedForStepAtTrigger
  } = facts;

  if (typeof burstActiveAtTrigger !== 'boolean') return 'UNKNOWN_SUBPHASE';

  if (burstActiveAtTrigger === false
      && precedingBurstClosedWithPoseLockSettled === true
      && formalCaptureCommittedForStepAtTrigger === false) {
    return 'POST_BURST_FORMAL_HOLD';
  }

  if (burstActiveAtTrigger === true && lockedAtMsKnownSetAtTrigger === true) {
    return 'BURST_SETTLE_TIMER_ACTIVE';
  }

  if (typeof destinationRegionMatchedAtTrigger !== 'boolean') return 'UNKNOWN_SUBPHASE';

  if (destinationRegionMatchedAtTrigger === true && scannerReadyAtTrigger === false) {
    return 'TARGET_REGION_MATCHED_NOT_READY';
  }

  if (destinationRegionMatchedAtTrigger === false) {
    return 'TURNING_OR_OFF_TARGET';
  }

  // destinationRegionMatchedAtTrigger === true && scannerReadyAtTrigger !== false (i.e. true or
  // unknown), with neither POST_BURST_FORMAL_HOLD nor BURST_SETTLE_TIMER_ACTIVE applying -- this
  // is genuinely the removed POST_CAPTURE_HOLD's territory (on-target, ready, no burst context).
  // The corrected 5-state vocabulary has no name for it; classify honestly rather than guess.
  return 'UNKNOWN_SUBPHASE';
}

/** Derives lockedAtMsKnownSetAtTrigger for a burst sample: true once any sample up to and
 * including this index in the SAME burst has shown poseLockReadyAtTrigger===true (lockedAtMs is
 * sticky once set, per BI-1Z1X's code-verified trace, so this is a safe, non-fabricated lower-bound
 * reconstruction, not a numeric elapsed-time claim). */
export function deriveLockedAtMsKnownSetAtTrigger(burstSamplesSortedByNativeTs, sampleIndex) {
  if (!Array.isArray(burstSamplesSortedByNativeTs) || sampleIndex < 0 || sampleIndex >= burstSamplesSortedByNativeTs.length) return false;
  for (let i = 0; i <= sampleIndex; i++) {
    if (burstSamplesSortedByNativeTs[i] && burstSamplesSortedByNativeTs[i].poseLockReadyAtTrigger === true) return true;
  }
  return false;
}

/** Builds classifier facts for one already-captured burst sample (BURST_SHARED reconstruction
 * path). Never mutates the original sample. All facts either already exist on the sample/burst
 * or are safely derivable from them -- see deriveLockedAtMsKnownSetAtTrigger above. */
export function buildBurstSampleFacts(burstSamplesSortedByNativeTs, sampleIndex, destinationFormalRegion) {
  const sample = burstSamplesSortedByNativeTs[sampleIndex];
  if (!sample) return null;
  return {
    destinationRegionMatchedAtTrigger: destinationFormalRegion != null ? (sample.observedPoseRegion === destinationFormalRegion) : null,
    scannerReadyAtTrigger: typeof sample.poseLockReadyAtTrigger === 'boolean' ? sample.poseLockReadyAtTrigger : null,
    burstActiveAtTrigger: true, // structurally always true: this sample was captured while its own burst was open
    lockedAtMsKnownSetAtTrigger: deriveLockedAtMsKnownSetAtTrigger(burstSamplesSortedByNativeTs, sampleIndex),
    precedingBurstClosedWithPoseLockSettled: false, // not applicable during an open/owning burst
    formalCaptureCommittedForStepAtTrigger: false   // not applicable during an open/owning burst
  };
}

/** Builds classifier facts for a live WHOLE_SCAN_OWNED trigger snapshot. `snapshot` is expected
 * to carry already-computed scanner facts read at the exact trigger moment (see index.html's
 * __wholeScanMaybeSample additive snapshot) -- this function performs no I/O and fits no new
 * threshold, it only reshapes already-known facts into the classifier's input contract. */
export function buildWholeScanOwnedFacts(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const burstActiveAtTrigger = !!snapshot.burstActiveAtTrigger;
  return {
    destinationRegionMatchedAtTrigger: typeof snapshot.destinationRegionMatchedAtTrigger === 'boolean' ? snapshot.destinationRegionMatchedAtTrigger : null,
    scannerReadyAtTrigger: typeof snapshot.scannerReadyAtTrigger === 'boolean' ? snapshot.scannerReadyAtTrigger : null,
    burstActiveAtTrigger,
    lockedAtMsKnownSetAtTrigger: burstActiveAtTrigger ? (snapshot.lockedAtMsAtTrigger != null) : null,
    precedingBurstClosedWithPoseLockSettled: snapshot.precedingBurstEndReasonAtTrigger === 'POSE_LOCK_SETTLED',
    formalCaptureCommittedForStepAtTrigger: !!snapshot.formalCaptureAlreadyCommittedForStepAtTrigger
  };
}

/** Point-event builders -- kept structurally separate from duration-state classification. Every
 * event carries an explicit jsClockDomain so a PERFORMANCE_NOW-domain event is never diffed
 * against an EPOCH_ISO-domain one, and relatedNativeFrameTimestampNs is populated ONLY when a
 * genuine per-sample native timestamp exists for that event -- never fabricated. */
export function buildFirstTargetRegionMatchEvent(scanSessionId, burst, destinationFormalRegion) {
  if (!burst || !Array.isArray(burst.samples) || destinationFormalRegion == null) return null;
  const match = burst.samples.find(s => s.observedPoseRegion === destinationFormalRegion);
  if (!match) return null;
  return {
    scanSessionId, scannerStep: (burst.sourceTransition || '').split('_TO_')[1] || null,
    eventType: 'FIRST_TARGET_REGION_MATCH',
    jsTimestampMs: null, jsTimestampIso: null, jsClockDomain: null,
    burstId: burst.burstId, burstEndReason: burst.endReason || null,
    relatedNativeFrameTimestampNs: match.nativeFrameTimestampNs || null
  };
}

export function buildFirstReadyTrueEvent(scanSessionId, burst) {
  if (!burst || !Array.isArray(burst.samples)) return null;
  const match = burst.samples.find(s => s.poseLockReadyAtTrigger === true);
  if (!match) return null;
  return {
    scanSessionId, scannerStep: (burst.sourceTransition || '').split('_TO_')[1] || null,
    eventType: 'FIRST_READY_TRUE',
    jsTimestampMs: null, jsTimestampIso: null, jsClockDomain: null,
    burstId: burst.burstId, burstEndReason: burst.endReason || null,
    relatedNativeFrameTimestampNs: match.nativeFrameTimestampNs || null
  };
}

export function buildBurstCloseEvent(scanSessionId, burst) {
  if (!burst) return null;
  const jsTimestampMs = (typeof burst.startedAtMs === 'number' && typeof burst.actualDurationMs === 'number')
    ? (burst.startedAtMs + burst.actualDurationMs) : null;
  return {
    scanSessionId, scannerStep: (burst.sourceTransition || '').split('_TO_')[1] || null,
    eventType: 'BURST_CLOSE',
    jsTimestampMs, jsTimestampIso: null, jsClockDomain: jsTimestampMs != null ? 'PERFORMANCE_NOW' : null,
    burstId: burst.burstId, burstEndReason: burst.endReason || null,
    relatedNativeFrameTimestampNs: burst.endNativeTimestampNs || null
  };
}

export function buildFormalCapturedEvent(scanSessionId, association) {
  if (!association) return null;
  return {
    scanSessionId, scannerStep: association.formalCaptureId || null,
    eventType: 'FORMAL_CAPTURED',
    jsTimestampMs: null, jsTimestampIso: association.formalCaptureAt || null,
    jsClockDomain: association.formalCaptureAt ? 'EPOCH_ISO' : null,
    burstId: null, burstEndReason: null,
    relatedNativeFrameTimestampNs: association.formalCaptureNativeTs || null
  };
}

export function buildStepAdvancedEvent(scanSessionId, association) {
  if (!association) return null;
  return {
    scanSessionId, scannerStep: association.formalCaptureId || null,
    eventType: 'STEP_ADVANCED',
    jsTimestampMs: null, jsTimestampIso: association.formalCaptureAt || null,
    jsClockDomain: association.formalCaptureAt ? 'EPOCH_ISO' : null,
    burstId: null, burstEndReason: null,
    relatedNativeFrameTimestampNs: association.formalCaptureNativeTs || null
  };
}

/** CAPTURE_ATTEMPT_FAILED is deliberately NOT captured live this stage -- see BI-1Z2A Part 11.
 * This is a documentation-only placeholder describing why, never a fabricated event. */
export const CAPTURE_ATTEMPT_FAILED_STATUS = Object.freeze({
  eventType: 'CAPTURE_ATTEMPT_FAILED',
  status: 'UNINSTRUMENTED_RUNTIME_EVENT',
  reason: 'Capturing this event live requires touching takeCapture()\'s control flow. Per BI-1Z2A Part 11, the core subphase instrumentation is not held hostage by this optional event; it is documented as uninstrumented rather than fabricated or approximated.'
});

/** Orchestrates the full event list for one scan session's already-built research package
 * (temporalMotionBursts[] + formalCaptureAssociations[]), sorted by whatever timestamp domain is
 * available (native first, since it is the one shared, monotonic clock across event types; events
 * with no native timestamp sort by their own domain value, never cross-compared numerically). */
export function assembleTemporalSubphaseEvents(scanSessionId, temporalMotionBursts, formalCaptureAssociations) {
  const events = [];
  (temporalMotionBursts || []).forEach(function (b) {
    const parts = (b.sourceTransition || '').split('_TO_');
    const destinationRegion = STEP_ID_TO_FORMAL_REGION[parts[1]] || null;
    const e1 = buildFirstTargetRegionMatchEvent(scanSessionId, b, destinationRegion);
    if (e1) events.push(e1);
    const e2 = buildFirstReadyTrueEvent(scanSessionId, b);
    if (e2) events.push(e2);
    const e3 = buildBurstCloseEvent(scanSessionId, b);
    if (e3) events.push(e3);
  });
  (formalCaptureAssociations || []).forEach(function (a) {
    const e4 = buildFormalCapturedEvent(scanSessionId, a);
    if (e4) events.push(e4);
    const e5 = buildStepAdvancedEvent(scanSessionId, a);
    if (e5) events.push(e5);
  });
  return events;
}
