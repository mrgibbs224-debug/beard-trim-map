// Stage BI-1Z1G -- pure, testable mirror of index.html's TEMPORAL_EXACT_FRAME_BURST_V1 research
// capture logic (burst lifecycle, cadence throttling, interval statistics, feasibility metrics,
// sample/package shape). This file has no DOM/native-bridge/browser dependency and is the
// canonical, unit-tested source of truth; index.html's copy must be kept in sync by hand if either
// ever changes -- the same convention BI-1Z0B established for
// accuracy/exact-frame-research-capture.mjs. Never imports V1/V2/V2.1/V2.2/GT/BS1 -- this is a
// pure capture-instrument module, independent of any beard-occupancy research output (Part 12).
'use strict';

export const TEMPORAL_BURST_MODULE_VERSION = 'temporal-exact-frame-burst/1';
export const PACKAGE_SCHEMA_VERSION = 'exact-frame-research-capture/2';

// Part 4/5/15 -- research starting values, not accuracy thresholds.
export const TEMPORAL_BURST_PARAMETERS = Object.freeze({
  targetIntervalMs: 125,          // ~8fps target (Part 4)
  maxBurstDurationMs: 2500,       // Part 5 -- bounded local window, never continuous recording
  settleTailMs: 400,              // short settle after pose-lock before closing the burst
  maxFramesPerBurst: 24,          // Part 15
  maxBurstsPerScan: 8,            // Part 15
  maxTotalFramesPerExport: 160    // Part 15
});

/** Part 2 -- research feature gating: BOTH the existing user-facing R&D toggle AND an independent
 *  isResearchBuild() check must be true. Fails closed on any exception. */
export function isResearchCaptureAllowed(researchCaptureFlag, isResearchBuildFn) {
  try {
    return researchCaptureFlag === true && typeof isResearchBuildFn === 'function' && isResearchBuildFn() === true;
  } catch (_e) { return false; }
}

/** Part 4 -- timestamp/elapsed-time throttling, never an assumed fixed FPS. Deterministic: same
 *  (currentBurst.lastSampleAtMs, nowMs) always yields the same answer. */
export function shouldSampleNow(currentBurst, nowMs, params = TEMPORAL_BURST_PARAMETERS) {
  if (!currentBurst) return false;
  return (nowMs - currentBurst.lastSampleAtMs) >= params.targetIntervalMs;
}

/** Part 15 -- graceful, non-throwing cap check (never crashes, never silently drops the whole
 *  package -- see finalizeBurst/buildPackage below, which always preserve already-captured data). */
export function canStartNewBurst(recorderState, params = TEMPORAL_BURST_PARAMETERS) {
  return recorderState.bursts.length < params.maxBurstsPerScan && recorderState.totalFramesCaptured < params.maxTotalFramesPerExport;
}

/** Part 10 -- burst identity. Same id-shape convention as index.html's copy (timestamp + random
 *  suffix) -- not cryptographically unique, but collision-astronomically-unlikely within one scan
 *  session, exactly like every other session/burst id already used throughout this codebase
 *  (scannerSessionId, requestId, etc.). */
export function makeBurstId(nowMs = Date.now(), rand = Math.random()) {
  return 'burst_' + nowMs.toString(36) + '_' + rand.toString(36).slice(2, 8);
}

export function createBurst(burstId, transitionLabel, startPoseRegion, nowMs) {
  return {
    burstId, sourceTransition: transitionLabel, startObservedPoseRegion: startPoseRegion, endObservedPoseRegion: null,
    startNativeTimestampNs: null, endNativeTimestampNs: null, samples: [], lastSampleAtMs: 0, lockedAtMs: null,
    startedAtMs: nowMs, endReason: null, skippedCount: 0, lastSkipReason: null
  };
}

/** Part 5/9/11 -- returns the end reason once any bound is crossed, or null while the burst should
 *  keep collecting. Checked in a fixed, deterministic order (duration -> settle -> frame count). */
export function shouldEndBurst(burst, nowMs, params = TEMPORAL_BURST_PARAMETERS) {
  if (!burst) return null;
  if ((nowMs - burst.startedAtMs) >= params.maxBurstDurationMs) return 'MAX_DURATION_REACHED';
  if (burst.lockedAtMs != null && (nowMs - burst.lockedAtMs) >= params.settleTailMs) return 'POSE_LOCK_SETTLED';
  if (burst.samples.length >= params.maxFramesPerBurst) return 'MAX_FRAMES_PER_BURST_REACHED';
  return null;
}

/** Part 7/9 -- timestamp-monotonicity-safe interval statistics. A non-monotonic or non-numeric
 *  pair contributes NO interval (never a fabricated/negative one) -- it is silently excluded from
 *  the statistic, not clamped to zero. */
export function computeIntervalStats(samples) {
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
  return {
    mean: intervals.length ? intervals.reduce((s, v) => s + v, 0) / intervals.length : null,
    median: intervals.length ? intervals[Math.floor(intervals.length / 2)] : null,
    min: intervals.length ? intervals[0] : null,
    max: intervals.length ? intervals[intervals.length - 1] : null,
    count: intervals.length
  };
}

/** Part 10 -- finalizes a burst's own summary fields from its already-collected samples. Never
 *  reads GT, never reads V2.1/V2.2 output. */
export function finalizeBurst(burst, reason, nowMs, endPoseRegionGuess = null) {
  burst.endReason = reason;
  burst.endObservedPoseRegion = (burst.samples.length ? burst.samples[burst.samples.length - 1].observedPoseRegion : null) || endPoseRegionGuess || null;
  burst.startNativeTimestampNs = burst.samples.length ? burst.samples[0].nativeFrameTimestampNs : null;
  burst.endNativeTimestampNs = burst.samples.length ? burst.samples[burst.samples.length - 1].nativeFrameTimestampNs : null;
  const stats = computeIntervalStats(burst.samples);
  burst.actualDurationMs = nowMs - burst.startedAtMs;
  burst.sampleCount = burst.samples.length;
  burst.requestedTargetIntervalMs = TEMPORAL_BURST_PARAMETERS.targetIntervalMs;
  burst.meanSampleIntervalMs = stats.mean; burst.medianSampleIntervalMs = stats.median;
  burst.minSampleIntervalMs = stats.min; burst.maxSampleIntervalMs = stats.max;
  return burst;
}

/** Part 6 -- a candidate native keyframe result is acceptable ONLY if VERIFIED_EXACT. Never
 *  silently downgraded to a "close enough" join. */
export function isAcceptableSample(res) {
  return !!res && res.coherenceStatus === 'VERIFIED_EXACT';
}

/** Part 7/8/9/13 -- builds one temporal sample record from a single native keyframe result `res`
 *  (the SAME structurally-VERIFIED_EXACT object Tier-B's own requestSpatialKeyframeAsync()
 *  resolves) plus the trigger-time context snapshot. Every image/geometry field below (landmarks2D,
 *  faceLocal3D, transformationMatrix, imageSpaceViewModelMatrix, intrinsics, yaw/pitch/roll,
 *  rotation/mirror metadata) is read from this ONE `res` object -- never joined from a second,
 *  merely-nearby source (Part 6). Rotation/mirror/display/sensor fields are explicitly null, never
 *  fabricated, when `res` does not actually provide them (Part 8/21). */
export function buildTemporalSample(spec) {
  const { scanSessionId, res, burstId, sampleIndex, transitionLabel, region, currentScannerStep, lensFacing, triggerSnapshot } = spec;
  return {
    scanSessionId,
    nativeFrameTimestampNs: res.nativeFrameTimestampNs,
    rawObservationId: null, // Part 9 -- honestly null; no native raw-observation id exists in this codebase's tracking-packet contract
    temporalBurstId: burstId,
    temporalSampleIndex: sampleIndex,
    burstTransitionLabel: transitionLabel,
    coherenceStatus: res.coherenceStatus,
    dataUrl: res.imageBase64Jpeg || null, imageWidth: res.imageWidth || null, imageHeight: res.imageHeight || null,
    imageRotationDegrees: typeof res.imageRotationDegrees === 'number' ? res.imageRotationDegrees : null,
    imageMirrored: typeof res.imageMirrored === 'boolean' ? res.imageMirrored : null,
    displayRotationDegrees: typeof res.displayRotationDegrees === 'number' ? res.displayRotationDegrees : null,
    sensorOrientationDegrees: typeof res.sensorOrientationDegrees === 'number' ? res.sensorOrientationDegrees : null,
    landmarks2D: res.landmarks2D || null,
    faceLocal3D: res.faceLocal3D || null,
    transformationMatrix: res.transformationMatrix || null,
    imageSpaceViewModelMatrix: res.imageSpaceViewModelMatrix || null,
    intrinsics: { fx: res.intrinsicsFx, fy: res.intrinsicsFy, cx: res.intrinsicsCx, cy: res.intrinsicsCy, imageWidth: res.intrinsicsImageWidth, imageHeight: res.intrinsicsImageHeight, space: res.intrinsicsSpace },
    yawDeg: typeof res.poseYawDeg === 'number' ? -res.poseYawDeg : null, // sign convention matches Tier-B exactly
    pitchDeg: typeof res.posePitchDeg === 'number' ? res.posePitchDeg : null,
    rollDeg: res.poseRollDeg,
    observedPoseRegion: region, currentScannerStep, lensFacing,
    distStateAtTrigger: triggerSnapshot ? triggerSnapshot.distState : null,
    currentRatioAtTrigger: triggerSnapshot ? triggerSnapshot.currentRatio : null,
    tooFarAtTrigger: triggerSnapshot ? triggerSnapshot.tooFar : null,
    tooCloseAtTrigger: triggerSnapshot ? triggerSnapshot.tooClose : null,
    qualityOkAtTrigger: triggerSnapshot ? triggerSnapshot.qualityOk : null,
    qualityReasonAtTrigger: triggerSnapshot ? triggerSnapshot.qualityReason : null,
    poseLockReadyAtTrigger: triggerSnapshot ? triggerSnapshot.poseLockReady : null,
    captureLatencyMs: res.captureLatencyMs,
    packetFreshAtCapture: true
  };
}

/** Part 17/18 -- capture-quality/feasibility diagnostics ONLY. No motion classification, no
 *  optical flow, no beard/shirt scoring (Part 11). */
export function buildFeasibilityMetricsForBurst(burst, params = TEMPORAL_BURST_PARAMETERS) {
  const samples = burst.samples;
  let minYaw = Infinity, maxYaw = -Infinity, minPitch = Infinity, maxPitch = -Infinity, intrinsicsCount = 0, fullLandmarksCount = 0, consecutiveTransformPairs = 0;
  const widths = new Set(), heights = new Set();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (typeof s.yawDeg === 'number') { if (s.yawDeg < minYaw) minYaw = s.yawDeg; if (s.yawDeg > maxYaw) maxYaw = s.yawDeg; }
    if (typeof s.pitchDeg === 'number') { if (s.pitchDeg < minPitch) minPitch = s.pitchDeg; if (s.pitchDeg > maxPitch) maxPitch = s.pitchDeg; }
    if (s.intrinsics && Number.isFinite(s.intrinsics.fx) && Number.isFinite(s.intrinsics.fy)) intrinsicsCount++;
    if (Array.isArray(s.faceLocal3D) && s.faceLocal3D.length === 468) fullLandmarksCount++;
    if (s.imageWidth) widths.add(s.imageWidth);
    if (s.imageHeight) heights.add(s.imageHeight);
    if (i > 0 && s.transformationMatrix && samples[i - 1].transformationMatrix) consecutiveTransformPairs++;
  }
  return {
    burstId: burst.burstId, sourceTransition: burst.sourceTransition, endReason: burst.endReason,
    requestedSampleRateHz: 1000 / params.targetIntervalMs,
    achievedSampleRateHz: burst.meanSampleIntervalMs ? 1000 / burst.meanSampleIntervalMs : null,
    sampleIntervalStatsMs: { mean: burst.meanSampleIntervalMs, median: burst.medianSampleIntervalMs, min: burst.minSampleIntervalMs, max: burst.maxSampleIntervalMs },
    exactCoherenceCount: samples.length, // structural: only VERIFIED_EXACT samples are ever pushed (Part 6)
    skippedSampleCount: burst.skippedCount, lastSkipReason: burst.lastSkipReason,
    yawRangeDeg: samples.length ? (maxYaw - minYaw) : null, pitchRangeDeg: samples.length ? (maxPitch - minPitch) : null,
    imageDimensionsConsistent: widths.size <= 1 && heights.size <= 1,
    intrinsicsAvailableCount: intrinsicsCount, fullLandmarksAvailableCount: fullLandmarksCount,
    consecutiveHeadTransformPairsAvailable: consecutiveTransformPairs,
    hasReturnTowardStartTransition: /_TO_/.test(burst.sourceTransition || '')
  };
}

/** Part 14 -- additive package-shape helper: given the EXISTING /1 package fields (unchanged) plus
 *  the new bursts, returns the /2 package. Used only to document/verify the additive contract in
 *  tests; index.html builds the real package inline in __buildExactFrameResearchPackage(). */
export function extendPackageWithTemporalBursts(existingV1Package, bursts, feasibilityMetrics) {
  return Object.assign({}, existingV1Package, {
    exactFrameResearchCaptureVersion: PACKAGE_SCHEMA_VERSION,
    temporalMotionBursts: bursts,
    temporalCaptureFeasibilityMetrics: feasibilityMetrics
  });
}
