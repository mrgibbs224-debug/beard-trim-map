// Stage BI-1Z2B -- CORRECTED TEMPORAL SUBPHASE PHYSICAL ANALYSIS.
// Pure analysis functions over the 5 BI-1Z2A-authorized natural-scan research captures. Never
// pools scans, never fits a new numeric threshold from this data, never converts across clock
// domains. Analysis only -- no scanner/burst/whole-scan behavior, no thresholds, no V2/GT/
// occupancy/Hairness, no beard/shirt/neckline classification.

export const AUTHORIZED_SCAN_SESSION_IDS = Object.freeze([
  'scan_mtzxr228_7b50dm', 'scan_mtzxslrd_yxv72h', 'scan_mtzxt16l_tzqup3', 'scan_mtzxtevz_hp05uo', 'scan_mtzxtrhf_dlw7ge'
]);

export function assertAuthorizedScan(scanSessionId) {
  if (!AUTHORIZED_SCAN_SESSION_IDS.includes(scanSessionId)) {
    throw new Error('UNAUTHORIZED_SCAN_FOR_BI_1Z2B: ' + scanSessionId);
  }
}

export const PROFILE_STEP_IDS = Object.freeze(['right-profile', 'left-profile']);
export const CROSS_POSE_STEP_IDS = Object.freeze(['front', 'right-three-quarter', 'left-three-quarter', 'chin-up']);
export const NON_POSE_LOCK_CLOSE_REASONS = Object.freeze(['MAX_DURATION_REACHED', 'MAX_FRAMES_PER_BURST_REACHED', 'SUPERSEDED_BY_NEW_BURST', 'SCAN_ENDED']);

export function classifyCompleteness(pkg) {
  const formalCount = (pkg.formalCaptureAssociations || []).length;
  const burstCount = (pkg.temporalMotionBursts || []).length;
  const schema = pkg.exactFrameResearchCaptureVersion || null;
  const complete = formalCount === 6 && burstCount === 5 && schema === 'exact-frame-research-capture/3';
  return { complete, formalCount, burstCount, schema };
}

export function findBurstForStep(bursts, stepId) {
  return (bursts || []).find(b => (b.sourceTransition || '').split('_TO_')[1] === stepId) || null;
}

export function splitTimelineByProvenance(wholeScanSamples) {
  const owned = (wholeScanSamples || []).filter(s => s.provenance === 'WHOLE_SCAN_OWNED');
  const shared = (wholeScanSamples || []).filter(s => s.provenance === 'BURST_SHARED');
  return { owned, shared };
}

export function sharedSamplesForBurst(sharedSamples, burstId) {
  return (sharedSamples || []).filter(s => s.sourceBurstId === burstId).sort((a, b) => nativeCompare(a.nativeFrameTimestampNs, b.nativeFrameTimestampNs));
}

export function ownedSamplesForStep(ownedSamples, stepId) {
  return (ownedSamples || []).filter(s => s.scannerStepAtTrigger === stepId).sort((a, b) => nativeCompare(a.nativeFrameTimestampNs, b.nativeFrameTimestampNs));
}

function nativeCompare(a, b) {
  try { const d = BigInt(a) - BigInt(b); return d < 0n ? -1 : d > 0n ? 1 : 0; } catch (_e) { return 0; }
}

/** Clock-domain firewall (Part 2). Never converts between domains. Prefers native-frame
 * timestamps when both events carry a legitimate one; otherwise falls back to a shared
 * PERFORMANCE_NOW pair; otherwise reports unavailable rather than fabricating a number. */
export function deriveDuration(eventA, eventB) {
  const nsA = eventA && eventA.relatedNativeFrameTimestampNs;
  const nsB = eventB && eventB.relatedNativeFrameTimestampNs;
  if (nsA != null && nsB != null) {
    try {
      const ms = Number(BigInt(nsB) - BigInt(nsA)) / 1e6;
      if (Number.isFinite(ms)) return { status: 'AVAILABLE', domain: 'NATIVE_FRAME_TIMESTAMP_NS', ms };
    } catch (_e) { /* fall through */ }
  }
  const domA = eventA && eventA.jsClockDomain, domB = eventB && eventB.jsClockDomain;
  if (domA === 'PERFORMANCE_NOW' && domB === 'PERFORMANCE_NOW' && typeof eventA.jsTimestampMs === 'number' && typeof eventB.jsTimestampMs === 'number') {
    return { status: 'AVAILABLE', domain: 'PERFORMANCE_NOW', ms: eventB.jsTimestampMs - eventA.jsTimestampMs };
  }
  return { status: 'DURATION_UNAVAILABLE_CROSS_CLOCK', domain: null, ms: null };
}

/** Ready-dropout analysis (Part 7) -- counts, among BURST_SETTLE_TIMER_ACTIVE-classified shared
 * samples, how many show scannerReadyAtTrigger===false, honestly distinguishing "lockedAtMs is
 * sticky" from "readiness stayed continuously true" (BI-1Z1X.1 Correction 3). */
export function analyzeReadyDropouts(sharedSamplesForBurstInstance) {
  const settleSamples = sharedSamplesForBurstInstance.filter(s => s.temporalSubphase === 'BURST_SETTLE_TIMER_ACTIVE');
  const dropouts = settleSamples.filter(s => s.scannerReadyAtTrigger === false);
  return {
    burstSettleTimerActiveSampleCount: settleSamples.length,
    readyFalseWhileTimerActiveCount: dropouts.length,
    readyTrueWhileTimerActiveCount: settleSamples.length - dropouts.length,
    qualityOkAtTriggerValues: settleSamples.map(s => s.qualityOkAtTrigger),
    firstReadyTrueNativeTs: (sharedSamplesForBurstInstance.find(s => s.scannerReadyAtTrigger === true) || {}).nativeFrameTimestampNs || null
  };
}

/** POST_BURST_FORMAL_HOLD analysis (Part 8) -- the central new-visibility measurement. */
export function analyzePostBurstFormalHold(ownedSamplesForStepInstance) {
  const holdSamples = ownedSamplesForStepInstance.filter(s => s.temporalSubphase === 'POST_BURST_FORMAL_HOLD');
  if (!holdSamples.length) {
    return { sampleCount: 0, present: false };
  }
  const yaws = holdSamples.map(s => s.yawDeg).filter(v => typeof v === 'number');
  const pitches = holdSamples.map(s => s.pitchDeg).filter(v => typeof v === 'number');
  const formalHoldElapsed = holdSamples.map(s => s.formalHoldElapsedMsAtTrigger).filter(v => typeof v === 'number');
  const monotonicNonDecreasing = formalHoldElapsed.every((v, i) => i === 0 || v >= formalHoldElapsed[i - 1]);
  return {
    sampleCount: holdSamples.length,
    present: true,
    firstNativeTs: holdSamples[0].nativeFrameTimestampNs,
    lastNativeTs: holdSamples[holdSamples.length - 1].nativeFrameTimestampNs,
    yawRangeDeg: yaws.length ? [Math.min(...yaws), Math.max(...yaws)] : null,
    pitchRangeDeg: pitches.length ? [Math.min(...pitches), Math.max(...pitches)] : null,
    destinationRegionMatchedAtTriggerValues: holdSamples.map(s => s.destinationRegionMatchedAtTrigger),
    scannerReadyAtTriggerValues: holdSamples.map(s => s.scannerReadyAtTrigger),
    qualityOkAtTriggerValues: holdSamples.map(s => s.qualityOkAtTrigger),
    formalHoldElapsedMsAtTriggerSequence: formalHoldElapsed,
    formalHoldElapsedMonotonicNonDecreasing: monotonicNonDecreasing,
    formalCaptureStateAtTriggerValues: holdSamples.map(s => s.formalCaptureStateAtTrigger)
  };
}

/** Late-burst + post-burst combined coverage (Part 9). Merges by native timestamp -- the ONE
 * domain both provenances share -- never by ordinal alone. */
export function combineLateBurstAndPostBurst(sharedSamplesForBurstInstance, ownedSamplesForStepInstance) {
  const lateBurst = sharedSamplesForBurstInstance.filter(s => s.temporalSubphase === 'BURST_SETTLE_TIMER_ACTIVE');
  const postBurst = ownedSamplesForStepInstance.filter(s => s.temporalSubphase === 'POST_BURST_FORMAL_HOLD');
  const combined = [...lateBurst.map(s => ({ ...s, __source: 'LATE_BURST_SETTLE' })), ...postBurst.map(s => ({ ...s, __source: 'POST_BURST_FORMAL_HOLD' }))]
    .sort((a, b) => nativeCompare(a.nativeFrameTimestampNs, b.nativeFrameTimestampNs));
  let spanMs = null;
  if (combined.length >= 2) {
    try { spanMs = Number(BigInt(combined[combined.length - 1].nativeFrameTimestampNs) - BigInt(combined[0].nativeFrameTimestampNs)) / 1e6; } catch (_e) { spanMs = null; }
  }
  const regionMatches = combined.map(s => s.destinationRegionMatchedAtTrigger);
  const readyValues = combined.map(s => s.scannerReadyAtTrigger);
  return {
    observationCount: combined.length,
    lateBurstCount: lateBurst.length,
    postBurstCount: postBurst.length,
    timeSpanMs: spanMs,
    destinationRegionMatchedAtTriggerValues: regionMatches,
    scannerReadyAtTriggerValues: readyValues,
    orderedSourceSequence: combined.map(s => s.__source)
  };
}

/** Profile timing sufficiency classification (Part 10). Structural/qualitative -- does NOT fit
 * a numeric "enough samples" cutoff from this dataset (Part 9's explicit prohibition). */
export function classifyTimingSufficiency(burstEndReason, combinedCoverage) {
  if (burstEndReason == null) return 'DATA_INSUFFICIENT';
  if (burstEndReason !== 'POSE_LOCK_SETTLED') return 'TRUE_TEMPORAL_COVERAGE_GAP';
  if (!combinedCoverage || combinedCoverage.observationCount === 0) return 'TRUE_TEMPORAL_COVERAGE_GAP';
  const hasBoth = combinedCoverage.lateBurstCount > 0 && combinedCoverage.postBurstCount > 0;
  const hasMeasurableSpan = typeof combinedCoverage.timeSpanMs === 'number' && combinedCoverage.timeSpanMs > 0;
  if (hasBoth && hasMeasurableSpan) return 'CLEAR_EXISTING_TEMPORAL_COVERAGE';
  if (combinedCoverage.observationCount >= 1) return 'PARTIAL_EXISTING_TEMPORAL_COVERAGE';
  return 'TRUE_TEMPORAL_COVERAGE_GAP';
}

/** Mid-flight density-gap audit (Part 13) -- circumstantial only, never a fix, never a
 * physiology/causal claim. */
export function auditMidFlightDensityGap(burst) {
  if (!burst) return { evidenceOfBoundaryDrop: false, reason: 'NO_BURST' };
  const skipped = burst.skippedCount || 0;
  const lastSkipReason = burst.lastSkipReason || null;
  const evidenceOfBoundaryDrop = skipped > 0 && (lastSkipReason === 'REQUEST_REJECTED_OR_TIMEOUT');
  return { skippedCount: skipped, lastSkipReason, evidenceOfBoundaryDrop, note: 'Circumstantial only -- never treated as proof of physiology or scanner-timing behavior.' };
}

/** Event ordering integrity (Part 14) -- all comparisons within the native-timestamp domain
 * where a genuine association exists; never cross-domain. */
export function auditEventOrdering(events, burst) {
  const byType = {};
  events.forEach(e => { byType[e.eventType] = e; });
  const issues = [];
  const order = ['FIRST_TARGET_REGION_MATCH', 'FIRST_READY_TRUE', 'BURST_CLOSE'];
  for (let i = 1; i < order.length; i++) {
    const prev = byType[order[i - 1]], cur = byType[order[i]];
    if (prev && cur && prev.relatedNativeFrameTimestampNs != null && cur.relatedNativeFrameTimestampNs != null) {
      if (nativeCompare(prev.relatedNativeFrameTimestampNs, cur.relatedNativeFrameTimestampNs) > 0) {
        issues.push(order[i - 1] + ' occurs after ' + order[i]);
      }
    }
  }
  if (byType.BURST_CLOSE && byType.FORMAL_CAPTURED
      && byType.BURST_CLOSE.relatedNativeFrameTimestampNs != null && byType.FORMAL_CAPTURED.relatedNativeFrameTimestampNs != null) {
    if (nativeCompare(byType.BURST_CLOSE.relatedNativeFrameTimestampNs, byType.FORMAL_CAPTURED.relatedNativeFrameTimestampNs) > 0) {
      issues.push('BURST_CLOSE occurs after FORMAL_CAPTURED');
    }
  }
  return { noImpossibleOrder: issues.length === 0, issues };
}

/** State integrity audit (Part 15) -- verifies invariants of the corrected classifier contract
 * against real physical output, never repairs retroactively. */
export function auditStateIntegrity(samples) {
  const violations = [];
  samples.forEach(s => {
    if (s.temporalSubphase === 'POST_BURST_FORMAL_HOLD' && s.provenance !== 'WHOLE_SCAN_OWNED') {
      violations.push({ sample: s.wholeScanSampleId, issue: 'POST_BURST_FORMAL_HOLD on a non-owned sample' });
    }
    if (s.temporalSubphase === 'TARGET_REGION_MATCHED_NOT_READY' && s.destinationRegionMatchedAtTrigger !== true) {
      violations.push({ sample: s.wholeScanSampleId, issue: 'TARGET_REGION_MATCHED_NOT_READY without a true region match' });
    }
    if (s.temporalSubphase === 'BURST_SETTLE_TIMER_ACTIVE' && s.provenance === 'WHOLE_SCAN_OWNED' && s.burstActiveAtTrigger !== true) {
      violations.push({ sample: s.wholeScanSampleId, issue: 'BURST_SETTLE_TIMER_ACTIVE on an owned sample without an active burst' });
    }
  });
  return { violationCount: violations.length, violations };
}
