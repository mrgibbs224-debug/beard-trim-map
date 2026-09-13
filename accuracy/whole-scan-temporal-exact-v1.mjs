// Stage BI-1Z1R (original) / BI-1Z1T (burst-priority isolation + shared-transition-frame reuse) --
// pure, testable mirror of index.html's WHOLE_SCAN_TEMPORAL_EXACT_V1 research capture logic
// (lifecycle gating, phase derivation, cadence throttling, priority arbitration, frame-registry
// deduplication, safety caps, telemetry, /3 schema extension). This file has no DOM/native-bridge/
// browser dependency and is the canonical, unit-tested source of truth; index.html's copy must be
// kept in sync by hand, the same convention BI-1Z1G established for
// accuracy/temporal-exact-frame-burst.mjs. Never imports V1/V2/V2.1/V2.2/GT/BS1/occupancy -- this
// is a pure capture-instrument module. Implements the frozen BI-1Z1Q design
// (D:\MettleTemp\analysis\bi1z1q_continuous_whole_scan_temporal_design.json, SHA256
// c06d4f6adff5a157eb151c6f16b99a3cea77969fb0b1612081787da0feff203a). The existing
// TEMPORAL_EXACT_FRAME_BURST_V1 recorder (accuracy/temporal-exact-frame-burst.mjs) is NOT modified
// or imported for mutation here -- only its isResearchCaptureAllowed() gating concept is mirrored
// (same two-flag contract), and this module's own functions never read or write burst recorder
// state.
//
// BI-1Z1T root-cause fix: BI-1Z1S's physical validation found the burst reference channel's own
// skip rate rose from a historical 0.0-2.9% baseline to 6.7-7.4% once whole-scan was active. Root
// cause: whole-scan's own in-flight native request could occupy the shared native single-in-flight
// resource for the DURATION of its round trip (observed ~14-30ms capture latency), and any burst
// request that began during that window -- even one frame later, not necessarily the same tick --
// collided and was rejected, because burst has no reciprocal check of whole-scan's in-flight state
// (an honestly-disclosed BI-1Z1R limitation). Rather than build a fragile bidirectional mutex, the
// fix is structural: whole-scan is now FORBIDDEN from issuing ANY independent exact-frame request
// for the ENTIRE duration a temporal burst is active (isBurstActive()), not merely avoiding a
// same-tick collision. Since this check is a synchronous read of the burst recorder's own already-
// public `currentBurst` state, performed immediately before any request would be issued, and JS is
// single-threaded, there is no race window: whole-scan can never begin a request while a burst is
// open, full stop. Transition-phase timeline coverage is instead reconstructed AFTER THE FACT from
// the burst recorder's own already-captured samples (BURST_SHARED provenance, zero new native
// requests, zero duplicated JPEG/geometry payloads -- see buildBurstSharedSample/
// assembleWholeScanTimeline below).
'use strict';

export const WHOLE_SCAN_MODULE_VERSION = 'whole-scan-temporal-exact-v1/2';
export const BI1Z1Q_DESIGN_SHA256 = 'c06d4f6adff5a157eb151c6f16b99a3cea77969fb0b1612081787da0feff203a';
export const PACKAGE_SCHEMA_VERSION_V2 = 'exact-frame-research-capture/2';
export const PACKAGE_SCHEMA_VERSION_V3 = 'exact-frame-research-capture/3';

// ---- Part 13 (BI-1Z1T) -- every logical whole-scan sample discloses its acquisition source -----
export const WHOLE_SCAN_PROVENANCE = Object.freeze(['WHOLE_SCAN_OWNED', 'BURST_SHARED']);

// ---- Part 5/6 -- cadence + safety caps (frozen, research starting values) -------------------------
export const WHOLE_SCAN_PARAMETERS = Object.freeze({
  targetIntervalMs: 1000 / 7,      // 7Hz nominal -- deliberately conservative, never 30/60fps
  maxSamples: 700,                 // Part 14 -- frozen safety cap
  maxDurationMs: 180000,           // Part 14 -- frozen safety cap (3 minutes)
  maxApproxExportBytes: 62914560   // Part 14 -- frozen safety cap (~60MB, 60*1024*1024)
});

// ---- Part 20/1 -- research gating (same two-flag contract as the burst recorder) ------------------
/** Fails closed on any exception. Mirrors accuracy/temporal-exact-frame-burst.mjs's
 *  isResearchCaptureAllowed() contract exactly (same two independent gates) rather than importing
 *  it, so this module has zero dependency on the burst module's internals. */
export function isWholeScanCaptureAllowed(researchCaptureFlag, isResearchBuildFn) {
  try {
    return researchCaptureFlag === true && typeof isResearchBuildFn === 'function' && isResearchBuildFn() === true;
  } catch (_e) { return false; }
}

// ---- Part 3 -- lifecycle: one deterministic evaluation, fail-closed on anything unrecognized ------
export const LIFECYCLE_SCREENS = Object.freeze(['SCANNER', 'SETTINGS', 'REVIEW', 'IDLE']);
/** Evaluates whether the whole-scan stream SHOULD be active right now, from explicit signals only.
 *  Called every tick; the caller compares this to its own current running state to decide whether
 *  to start, continue, or stop. Any unrecognized/missing signal defaults to the inactive branch
 *  (fail-closed), never to "keep running." */
export function shouldWholeScanBeActive(signals) {
  const s = signals || {};
  if (s.scanAborted === true) return { active: false, reason: 'SCAN_ABORTED' };
  if (!isWholeScanCaptureAllowed(s.researchCaptureFlag, s.isResearchBuildFn)) return { active: false, reason: 'RESEARCH_NOT_ALLOWED' };
  if (s.appForeground !== true) return { active: false, reason: 'APP_BACKGROUNDED' };
  if (s.cameraLive !== true) return { active: false, reason: 'CAMERA_NOT_LIVE' };
  if (s.scanSessionActive !== true) return { active: false, reason: 'SCAN_NOT_ACTIVE' };
  if (s.screen !== 'SCANNER') return { active: false, reason: s.screen === 'REVIEW' ? 'REVIEW_SCREEN' : (s.screen === 'SETTINGS' ? 'SETTINGS_OPEN' : 'NOT_ON_SCANNER_SCREEN') };
  return { active: true, reason: null };
}

// ---- Part 4 -- phase vocabulary, derived ONLY from scanner state-machine information ---------------
export const PHASE_VOCABULARY = Object.freeze([
  'POSE_HOLD_FRONT', 'TRANSITION_FRONT_TO_RIGHT45',
  'POSE_HOLD_RIGHT45', 'TRANSITION_RIGHT45_TO_RIGHT_PROFILE',
  'POSE_HOLD_RIGHT_PROFILE', 'TRANSITION_RIGHT_PROFILE_TO_LEFT45',
  'POSE_HOLD_LEFT45', 'TRANSITION_LEFT45_TO_LEFT_PROFILE',
  'POSE_HOLD_LEFT_PROFILE', 'TRANSITION_LEFT_PROFILE_TO_CHINUP',
  'POSE_HOLD_CHINUP', 'UNRECOGNIZED_STATE'
]);
// PRE_FIRST_POSE_ALIGNMENT and FINAL_SETTLE (BI-1Z1Q's optional phases) are deliberately NOT
// implemented: the current scanner state machine exposes no deterministic state distinct from
// POSE_HOLD_FRONT (before the first formal capture) or POSE_HOLD_CHINUP (after the last), so
// samples in those windows are honestly labeled with the nearest known hold phase rather than a
// guessed, unimplementable "alignment" or "settle" state.
const STEP_ID_TO_PHASE_SUFFIX = Object.freeze({
  'front': 'FRONT', 'right-three-quarter': 'RIGHT45', 'right-profile': 'RIGHT_PROFILE',
  'left-three-quarter': 'LEFT45', 'left-profile': 'LEFT_PROFILE', 'chin-up': 'CHINUP'
});
/** Derives phase from scanner state-machine signals ONLY -- never image appearance. `hasActiveBurst`
 *  and `transitionFromStepId`/`transitionToStepId` mirror the SAME signal the existing burst
 *  recorder already derives from step-advance events (Part 3 of BI-1Z1G) -- this module reads that
 *  signal, it does not recompute or alter it. */
export function phaseForState({ currentStepId, hasActiveBurst, transitionFromStepId, transitionToStepId }) {
  if (hasActiveBurst) {
    const from = STEP_ID_TO_PHASE_SUFFIX[transitionFromStepId], to = STEP_ID_TO_PHASE_SUFFIX[transitionToStepId];
    if (!from || !to) return 'UNRECOGNIZED_STATE';
    return 'TRANSITION_' + from + '_TO_' + to;
  }
  const suffix = STEP_ID_TO_PHASE_SUFFIX[currentStepId];
  return suffix ? 'POSE_HOLD_' + suffix : 'UNRECOGNIZED_STATE';
}

// ---- Part 5 -- cadence throttling, timestamp-based, never an assumed fixed FPS --------------------
export function shouldSampleNow(lastSampleAtMs, nowMs, params = WHOLE_SCAN_PARAMETERS) {
  return (nowMs - (lastSampleAtMs || 0)) >= params.targetIntervalMs;
}

// ---- Part 2/7/8 (BI-1Z1T) -- hard burst-active veto FIRST, then single-in-flight arbitration -----
export const SKIP_REASONS = Object.freeze(['WHOLE_SCAN_SUPPRESSED_FOR_BURST', 'SKIPPED_SINGLE_IN_FLIGHT', 'SKIPPED_FORMAL_PRIORITY']);
/** Whether a temporal burst is currently open. Reads (never writes) the burst recorder's own
 *  already-public `currentBurst` field -- a synchronous check performed immediately before any
 *  request would be issued, which is what makes the invariant race-free in a single-threaded JS
 *  runtime: nothing else can run between this check and the request call it gates. */
export function isBurstActive(burstRecorderLike) {
  return !!(burstRecorderLike && burstRecorderLike.currentBurst);
}
/** Priority order (BI-1Z1T): (0) HARD VETO -- if a temporal burst is active, whole-scan may issue
 *  ZERO independent requests, full stop, no exceptions, checked before anything else; (1)
 *  scanner/runtime is implicit in the caller only invoking this on an already-scheduled tick, (2)
 *  formal capture / Tier-B, (3) whole-scan's own re-entrancy guard. The former "SKIPPED_BURST_
 *  PRIORITY" pre-check of the burst recorder's in-flight flag is now REDUNDANT and removed: that
 *  flag can only ever be true while currentBurst is also set, so the burst-active veto above
 *  strictly subsumes it, and the previous race (whole-scan's own in-flight window outlasting a
 *  single tick and colliding with a LATER burst request) can no longer occur because whole-scan
 *  never starts a request during any part of an open burst, not merely the same tick. Never
 *  queues -- a skip is just a skip, counted, never retried aggressively. */
export function wholeScanSampleDecision(context, nowMs, params = WHOLE_SCAN_PARAMETERS) {
  const c = context || {};
  if (c.burstActive) return { sample: false, skipReason: 'WHOLE_SCAN_SUPPRESSED_FOR_BURST' };
  if (c.wholeScanRequestInFlight) return { sample: false, skipReason: 'SKIPPED_SINGLE_IN_FLIGHT' };
  if (c.formalRequestInFlight) return { sample: false, skipReason: 'SKIPPED_FORMAL_PRIORITY' };
  if (!shouldSampleNow(c.lastSampleAtMs, nowMs, params)) return { sample: false, skipReason: null }; // not due yet -- not a priority-driven skip
  return { sample: true, skipReason: null };
}

// ---- Part 9 -- exact-frame acceptance (identical bar to the burst recorder's own) -----------------
export function isAcceptableWholeScanSample(res) {
  return !!res && res.coherenceStatus === 'VERIFIED_EXACT';
}

// ---- Part 9/10 -- frame identity + registry-based deduplication -----------------------------------
export function makeFrameRegistryKey(scanSessionId, nativeFrameTimestampNs) {
  return scanSessionId + '#' + nativeFrameTimestampNs;
}
export function createFrameRegistry() { return { frames: new Map() }; }
/** Registers ONE role for the physical frame identified by `key`. If a frame with this exact
 *  identity is already registered (e.g. it was already captured as a FORMAL_KEYFRAME or a BURST
 *  sample), `payloadBuilderFn` is NEVER invoked a second time -- the existing heavy payload
 *  (JPEG etc.) is reused and only the role label list grows. This is the entire dedup mechanism:
 *  one frame identity, multiple role labels, one stored payload. */
export function registerFrame(registry, key, payloadBuilderFn, role) {
  let entry = registry.frames.get(key);
  if (!entry) {
    entry = { key, payload: payloadBuilderFn(), roleLabels: [] };
    registry.frames.set(key, entry);
  }
  if (!entry.roleLabels.includes(role)) entry.roleLabels.push(role);
  return entry;
}
export const FRAME_ROLE_LABELS = Object.freeze(['WHOLE_SCAN', 'BURST', 'FORMAL_KEYFRAME']);

// ---- Part 11 -- the whole-scan sample contract, missing metadata always null/UNKNOWN --------------
/** Builds one logical whole-scan sample record. `res` is the SAME structurally-VERIFIED_EXACT
 *  object the burst recorder's own requestSpatialKeyframeAsync() resolves -- every image/geometry
 *  field is read from this ONE object, never joined from a second source. Missing fields are
 *  explicitly null, never fabricated (Part 9's explicit instruction). */
export function buildWholeScanSample(spec) {
  const { scanSessionId, wholeScanSampleId, res, phase, scannerStepAtTrigger, observedPoseRegion,
    lensFacing, distContext, packetFreshnessMs, researchSampleTriggerTimestampNs, roleLabels } = spec;
  return {
    scanSessionId, wholeScanSampleId,
    nativeFrameTimestampNs: res.nativeFrameTimestampNs,
    coherenceStatus: res.coherenceStatus,
    phase, scannerStepAtTrigger, observedPoseRegion,
    yawDeg: typeof res.poseYawDeg === 'number' ? -res.poseYawDeg : null,
    pitchDeg: typeof res.posePitchDeg === 'number' ? res.posePitchDeg : null,
    rollDeg: typeof res.poseRollDeg === 'number' ? res.poseRollDeg : null,
    landmarks2D: res.landmarks2D || null, faceLocal3D: res.faceLocal3D || null,
    imageSpaceViewModelMatrix: res.imageSpaceViewModelMatrix || null, transformationMatrix: res.transformationMatrix || null,
    intrinsics: { fx: res.intrinsicsFx, fy: res.intrinsicsFy, cx: res.intrinsicsCx, cy: res.intrinsicsCy, imageWidth: res.intrinsicsImageWidth, imageHeight: res.intrinsicsImageHeight, space: res.intrinsicsSpace },
    imageBase64Jpeg: res.imageBase64Jpeg || null, imageWidth: res.imageWidth || null, imageHeight: res.imageHeight || null,
    lensFacing: lensFacing || null,
    imageRotationDegrees: typeof res.imageRotationDegrees === 'number' ? res.imageRotationDegrees : null,
    imageMirrored: typeof res.imageMirrored === 'boolean' ? res.imageMirrored : null,
    displayRotationDegrees: typeof res.displayRotationDegrees === 'number' ? res.displayRotationDegrees : null,
    sensorOrientationDegrees: typeof res.sensorOrientationDegrees === 'number' ? res.sensorOrientationDegrees : null,
    distStateAtTrigger: distContext ? (distContext.distState ?? null) : null,
    packetFreshnessMs: typeof packetFreshnessMs === 'number' ? packetFreshnessMs : null,
    captureLatencyMs: typeof res.captureLatencyMs === 'number' ? res.captureLatencyMs : null,
    researchSampleTriggerTimestampNs: researchSampleTriggerTimestampNs || null,
    roleLabels: Array.isArray(roleLabels) ? roleLabels.slice() : ['WHOLE_SCAN'],
    provenance: 'WHOLE_SCAN_OWNED'
  };
}

// ---- Part 3/6/13 (BI-1Z1T) -- BURST_SHARED timeline entries: zero new requests, zero duplicated
// heavy payloads. The heavy payload (JPEG/landmarks2D/faceLocal3D/matrices/intrinsics) is NEVER
// copied here -- it remains solely in temporalMotionBursts[].samples[], the single source of
// truth; a consumer resolves a BURST_SHARED entry's payload via sourceBurstId +
// sourceTemporalSampleIndex (or the shared scanSessionId+nativeFrameTimestampNs identity) ---------
/** Builds ONE lightweight BURST_SHARED whole-scan timeline entry from an already-captured burst
 *  sample -- no camera request, no JPEG re-encoding, no second heavy payload. `phase` is derived
 *  the SAME way a live TRANSITION_* phase would be (via the burst's own sourceTransition), never
 *  guessed independently. */
export function buildBurstSharedSample({ scanSessionId, wholeScanSampleId, burstId, sourceTransition, temporalSampleIndex, burstSample, phase }) {
  return {
    scanSessionId, wholeScanSampleId,
    nativeFrameTimestampNs: burstSample.nativeFrameTimestampNs,
    coherenceStatus: burstSample.coherenceStatus,
    phase,
    observedPoseRegion: burstSample.observedPoseRegion ?? null,
    yawDeg: typeof burstSample.yawDeg === 'number' ? burstSample.yawDeg : null,
    pitchDeg: typeof burstSample.pitchDeg === 'number' ? burstSample.pitchDeg : null,
    rollDeg: typeof burstSample.rollDeg === 'number' ? burstSample.rollDeg : null,
    provenance: 'BURST_SHARED',
    sourceBurstId: burstId, sourceTransition, sourceTemporalSampleIndex: temporalSampleIndex,
    roleLabels: ['WHOLE_SCAN', 'TEMPORAL_BURST']
  };
}
/** Maps EVERY sample of EVERY closed burst into one BURST_SHARED entry -- all of them, since they
 *  are already-captured, zero-additional-cost data (Part 3: "populate transition-phase whole-scan
 *  entries using the already-retained burst samples", read as maximizing coverage at zero cost,
 *  not subsampling). `phaseForTransition(sourceTransition)` is the caller's existing
 *  phaseForState()-equivalent transition-label mapping, injected so this function never needs its
 *  own copy of that logic. */
export function buildAllBurstSharedSamplesForTimeline(bursts, scanSessionId, phaseForTransition, sampleIdFactory) {
  const out = [];
  (bursts || []).forEach(burst => {
    const phase = phaseForTransition(burst.sourceTransition);
    (burst.samples || []).forEach((s, i) => {
      out.push(buildBurstSharedSample({
        scanSessionId, wholeScanSampleId: sampleIdFactory(burst.burstId, i), burstId: burst.burstId,
        sourceTransition: burst.sourceTransition, temporalSampleIndex: i, burstSample: s, phase
      }));
    });
  });
  return out;
}

// ---- Part 5/6 (BI-1Z1T) -- chronological timeline assembly with duplicate-identity collapse -----
/** Merges WHOLE_SCAN_OWNED (hold) and BURST_SHARED (transition) entries into ONE chronological
 *  timeline, sorted by nativeFrameTimestampNs (never ordinal position), with any duplicate
 *  physical-frame identity (scanSessionId+nativeFrameTimestampNs) collapsed to a single entry
 *  whose roleLabels are the union of every occurrence's labels -- structurally, this should never
 *  actually fire post-fix (whole-scan and burst can no longer capture the same frame, since
 *  whole-scan is silent for the entire duration a burst is open), but the collapse is still
 *  performed defensively rather than assumed. Returns orderingOk=false (never silently) if, after
 *  collapsing, timestamps are not strictly non-decreasing -- this should not happen by
 *  construction of the sort, but is verified rather than assumed. */
export function assembleWholeScanTimeline(ownedSamples, sharedSamples) {
  const all = [...(ownedSamples || []), ...(sharedSamples || [])];
  const byIdentity = new Map();
  all.forEach(s => {
    const key = s.scanSessionId + '#' + s.nativeFrameTimestampNs;
    const existing = byIdentity.get(key);
    if (!existing) { byIdentity.set(key, Object.assign({}, s, { roleLabels: (s.roleLabels || []).slice() })); return; }
    (s.roleLabels || []).forEach(r => { if (!existing.roleLabels.includes(r)) existing.roleLabels.push(r); });
  });
  const merged = [...byIdentity.values()];
  merged.sort((a, b) => {
    try { const d = BigInt(a.nativeFrameTimestampNs) - BigInt(b.nativeFrameTimestampNs); return d < 0n ? -1 : d > 0n ? 1 : 0; }
    catch (_e) { return 0; }
  });
  let orderingOk = true;
  for (let i = 1; i < merged.length; i++) {
    try { if (BigInt(merged[i].nativeFrameTimestampNs) < BigInt(merged[i - 1].nativeFrameTimestampNs)) orderingOk = false; }
    catch (_e) { orderingOk = false; }
  }
  return { timeline: merged, orderingOk, duplicateIdentityCount: all.length - merged.length };
}

// ---- Part 14 (BI-1Z1T) -- honest, structurally-computed dedup savings, never a promised estimate -
/** For every BURST_SHARED entry, looks up its source burst sample's own imageBase64Jpeg length --
 *  the number of bytes that WOULD have been written a second time had this frame instead been
 *  independently captured as WHOLE_SCAN_OWNED. Purely descriptive; never used to alter behavior. */
export function computeDedupSavings(sharedSamples, burstsById) {
  let bytesSaved = 0;
  (sharedSamples || []).forEach(s => {
    const burst = burstsById.get(s.sourceBurstId);
    const src = burst && burst.samples && burst.samples[s.sourceTemporalSampleIndex];
    if (src && typeof src.dataUrl === 'string') bytesSaved += src.dataUrl.length;
  });
  return { deduplicatedPayloadCount: (sharedSamples || []).length, deduplicatedApproxBytesSaved: bytesSaved };
}

// ---- Part 9 (BI-1Z1T) -- the hard invariant, verified rather than assumed -------------------------
export function verifyNoRequestDuringBurst(telemetry) {
  return (telemetry && telemetry.wholeScanIndependentRequestsDuringBurst) === 0;
}

// ---- Part 14 -- safety caps, whole-scan-only, never touching burst/formal recorder state -----------
/** `state`: { sampleCount, startedAtMs, approxBytesWritten }. Checked in a fixed order; returns the
 *  FIRST cap breached, or null while under all three. Purely reads its own `state` argument --
 *  structurally incapable of reading or mutating the burst/formal recorders, which are never
 *  imported here. */
export function checkSafetyCaps(state, nowMs, params = WHOLE_SCAN_PARAMETERS) {
  const s = state || {};
  if ((s.sampleCount || 0) >= params.maxSamples) return 'MAX_SAMPLES_REACHED';
  const startedAtMs = typeof s.startedAtMs === 'number' ? s.startedAtMs : nowMs; // a legitimate startedAtMs of 0 must not be treated as "missing"
  if ((nowMs - startedAtMs) >= params.maxDurationMs) return 'MAX_DURATION_REACHED';
  if ((s.approxBytesWritten || 0) >= params.maxApproxExportBytes) return 'MAX_EXPORT_BYTES_REACHED';
  return null;
}
/** Descriptive-only analysis (Part 14's "report which cap would terminate first" requirement): at
 *  nominal cadence/size, computes which cap would be hit first, in seconds, given an assumed
 *  average bytes-per-sample. Never used to change a cap or a gating decision -- reporting only. */
export function projectedCapOrder(avgBytesPerSample, params = WHOLE_SCAN_PARAMETERS) {
  const sampleCapSeconds = params.maxSamples * (params.targetIntervalMs / 1000);
  const durationCapSeconds = params.maxDurationMs / 1000;
  const byteCapSamples = avgBytesPerSample > 0 ? params.maxApproxExportBytes / avgBytesPerSample : Infinity;
  const byteCapSeconds = byteCapSamples * (params.targetIntervalMs / 1000);
  const candidates = [
    { cap: 'MAX_SAMPLES_REACHED', atSeconds: sampleCapSeconds },
    { cap: 'MAX_DURATION_REACHED', atSeconds: durationCapSeconds },
    { cap: 'MAX_EXPORT_BYTES_REACHED', atSeconds: byteCapSeconds }
  ].sort((a, b) => a.atSeconds - b.atSeconds);
  return { firstCapToHit: candidates[0].cap, order: candidates };
}

// ---- Part 15 -- performance telemetry (thermal state UNKNOWN if unavailable, never fabricated) ----
export function buildWholeScanTelemetry(counters) {
  const c = counters || {};
  return {
    requestedSamples: c.requestedSamples || 0, retainedSamples: c.retainedSamples || 0,
    skippedSingleInFlight: c.skippedSingleInFlight || 0, skippedForBurstPriority: c.skippedForBurstPriority || 0,
    skippedForFormalPriority: c.skippedForFormalPriority || 0,
    captureLatencyMsDistribution: Array.isArray(c.captureLatencyMsSamples) ? c.captureLatencyMsSamples.slice() : [],
    meanCadenceHz: c.meanCadenceHz ?? null, intervalP50Ms: c.intervalP50Ms ?? null, intervalP90Ms: c.intervalP90Ms ?? null, intervalP95Ms: c.intervalP95Ms ?? null,
    largestGapMs: c.largestGapMs ?? null,
    formalKeyframeCollisionCount: c.formalKeyframeCollisionCount || 0, burstCollisionCount: c.burstCollisionCount || 0,
    wholeScanFrameCount: c.wholeScanFrameCount || 0, uniqueExactFrameCount: c.uniqueExactFrameCount || 0, sharedRoleFrameCount: c.sharedRoleFrameCount || 0,
    approxBytesWritten: c.approxBytesWritten || 0, streamStopReason: c.streamStopReason || null,
    thermalState: c.thermalState || 'UNKNOWN',
    // Part 8 (BI-1Z1T) -- additive telemetry for the burst-priority-isolation architecture.
    wholeScanOwnedSamples: c.wholeScanOwnedSamples || 0, sharedBurstSamples: c.sharedBurstSamples || 0,
    wholeScanIndependentRequestsDuringBurst: c.wholeScanIndependentRequestsDuringBurst || 0,
    wholeScanSuppressedForBurst: c.wholeScanSuppressedForBurst || 0,
    deduplicatedPayloadCount: c.deduplicatedPayloadCount || 0, deduplicatedApproxBytesSaved: c.deduplicatedApproxBytesSaved || 0
  };
}

// ---- Part 16 -- degradation policy (whole-scan degrades first, nothing else is ever touched) ------
export function degradationDecision(consecutiveSkips, thresholds = { reduceAt: 5, stopAt: 15 }) {
  if (consecutiveSkips >= thresholds.stopAt) return { action: 'STOP', reason: 'EXCESSIVE_SKIP_STREAK' };
  if (consecutiveSkips >= thresholds.reduceAt) return { action: 'REDUCE_RATE', reason: 'ELEVATED_SKIP_STREAK' };
  return { action: 'CONTINUE', reason: null };
}

// ---- Part 2/17 -- schema versioning, additive-only, /1 and /2 reader compatibility preserved -------
/** /3 is used ONLY when the export actually contains whole-scan samples -- a burst-only (or
 *  whole-scan-disabled) session's export stays /2, byte-for-byte as before (Part 2's explicit
 *  "do not silently emit under /2" / "historical captures remain unchanged" requirements, read
 *  together: the RULE is version-follows-content, not a blanket bump). */
export function versionForExport(hasWholeScanSamples) {
  return hasWholeScanSamples ? PACKAGE_SCHEMA_VERSION_V3 : PACKAGE_SCHEMA_VERSION_V2;
}
/** Additive package-shape helper mirroring accuracy/temporal-exact-frame-burst.mjs's
 *  extendPackageWithTemporalBursts(): given an existing /2 package (unchanged fields) plus
 *  whole-scan samples/telemetry, returns the /3 package. temporalMotionBursts is passed through
 *  UNTOUCHED -- this function never reads or rewrites it. */
export function extendPackageWithWholeScanStream(existingV2Package, wholeScanSamples, telemetry) {
  if (!Array.isArray(wholeScanSamples) || wholeScanSamples.length === 0) return existingV2Package; // no whole-scan data -- stays /2
  return Object.assign({}, existingV2Package, {
    exactFrameResearchCaptureVersion: PACKAGE_SCHEMA_VERSION_V3,
    wholeScanTemporalStream: { samples: wholeScanSamples, telemetry }
  });
}
/** Reader-compatibility helper (Part 18): extracts the burst dataset identically regardless of
 *  package version -- a /1 package (no such field) yields [], a /2 or /3 package yields its own
 *  temporalMotionBursts array, completely independent of whether wholeScanTemporalStream is
 *  present. This is the function a future analysis stage should use so it never needs a
 *  version-specific code path for burst extraction. */
export function extractBurstDataset(pkg) {
  return (pkg && Array.isArray(pkg.temporalMotionBursts)) ? pkg.temporalMotionBursts : [];
}
