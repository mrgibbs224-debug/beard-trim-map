// Synchronized MULTI-OBSERVATION Scan Package — FOUNDATION
// Stage BS1-B. Pure ES module. Node-testable. Zero runtime dependencies.
//
// WHAT THIS IS
//   A clean, isolated model for the scan evidence Mettle can retain BEHIND each of the six
//   user-visible poses. The user still performs six simple captures; behind each one the app
//   can already collect many hidden synchronized image + geometry observations (see the
//   existing A6.0 / A6.0A / A6.0B "Spatial Observation Capture" infrastructure in index.html).
//   BS1-B wraps that existing evidence in a stable package contract so BS1-C can fuse it into
//   the BS1-A Personalized Beard Surface.
//
// WHAT THIS IS NOT (BS1-B scope guards)
//   - It does NOT interpret beard pixels. No segmentation, no model, no boundaries, no
//     HairState inference. Images here are opaque evidence payloads / references for later.
//   - It is NOT wired to anything: not index.html Scanner capture, not the A6 runtime, not
//     requestSpatialKeyframeAsync, not ArCoreFaceMeshTracker / NativeTrackingCoordinator,
//     not ML Kit / camera / Live Map / registeredPointMapper, not the BS1-A runtime, not the
//     UI, not storage. `worker.js` bundles only *.html; nothing imports this file.
//   - It wires NO persistence and adds NO raw-image persistence. It only defines lifecycle
//     STATES for a future privacy-friendly policy.
//   - It changes no A6 production constant. It mirrors the verified A6 caps as defaults and
//     keeps them configurable so a later architecture may exceed 8 images per pose.
//
// SHARED VOCABULARY
//   Scan-pose ids, coordinate spaces, observation kinds/methods, HairState and the numeric
//   helpers are imported from the sibling BS1-A foundation `./beard-surface-core.mjs` (itself
//   a pure module that imports nothing from the app). BS1-B does not redefine them and does
//   not create a competing Beard Surface model.

import {
  SCAN_POSES,
  CoordinateSpace,
  ObservationKind,
  ObservationMethod,
  HairState,
  median,
  clamp01OrNull
} from './beard-surface-core.mjs';

export const SCHEMA_VERSION = 'multi-observation-scan-package/1';

/** The index.html capture infrastructure this contract is shaped around. */
export const SOURCE_ARCHITECTURE_VERSION = 'A6.0 / A6.0A / A6.0B';

/**
 * Verified A6 caps (index.html): A60_GEOMETRY_CAP_PER_POSE = 40, A60_IMAGE_CAP_PER_POSE = 8;
 * A6.0B session-wide A60B_TIER_A_CAP = 200 geometry, A60B_TIER_B_CAP = 40 images,
 * A60B_TIER_B_PER_REGION_CAP = 3. These are DEFAULTS only — every cap in this module is a
 * caller-supplied argument, so the schema is not hard-wired to 8 images or to six photographs.
 */
export const A6_DEFAULT_CAPS = Object.freeze({
  geometryPerPose: 40,
  imagePerPose: 8,
  sessionGeometry: 200,
  sessionImage: 40,
  imagePerRegion: 3
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Image <-> geometry synchronization evidence. */
export const SyncStatus = Object.freeze({
  // Image and geometry come from the identical native frame (A6.0A structural guarantee:
  // coherenceStatus === 'VERIFIED_EXACT', frame.acquireCameraImage() valid only on the
  // current ARCore Frame).
  EXACT_SYNCHRONIZED: 'EXACT_SYNCHRONIZED',
  // Paired by timestamp proximity within a caller-supplied tolerance — not proven identical.
  NEAR_SYNCHRONIZED: 'NEAR_SYNCHRONIZED',
  // Explicitly not paired (geometry-only, image-only, or a rejected pairing). No image ever
  // silently inherits geometry from another frame.
  UNPAIRED: 'UNPAIRED',
  UNKNOWN: 'UNKNOWN'
});

/** Where a retained observation sits in the candidate -> retained lifecycle. */
export const RetentionStatus = Object.freeze({
  CANDIDATE: 'CANDIDATE',
  RETAINED: 'RETAINED',
  REJECTED: 'REJECTED'
});

/** Why a candidate was not retained. Provenance is preserved regardless. */
export const RejectionReason = Object.freeze({
  LOW_IMAGE_QUALITY: 'LOW_IMAGE_QUALITY',
  LOW_TRACKING_QUALITY: 'LOW_TRACKING_QUALITY',
  POSE_OUTSIDE_WINDOW: 'POSE_OUTSIDE_WINDOW',
  TOO_REDUNDANT: 'TOO_REDUNDANT',
  CAP_REACHED: 'CAP_REACHED',
  MISSING_GEOMETRY: 'MISSING_GEOMETRY',
  MISSING_IMAGE: 'MISSING_IMAGE',
  SYNC_UNCERTAIN: 'SYNC_UNCERTAIN',
  UNKNOWN_REASON: 'UNKNOWN_REASON'
});

/** A6 tier that produced the observation. */
export const SourceTier = Object.freeze({
  TIER_A_GEOMETRY: 'TIER_A_GEOMETRY',
  TIER_B_IMAGE_KEYFRAME: 'TIER_B_IMAGE_KEYFRAME',
  UNKNOWN: 'UNKNOWN'
});

/** What payload an observation actually carries. */
export const ObservationPayloadKind = Object.freeze({
  GEOMETRY_ONLY: 'GEOMETRY_ONLY',
  IMAGE_AND_GEOMETRY: 'IMAGE_AND_GEOMETRY',
  IMAGE_INCOMPLETE_METADATA: 'IMAGE_INCOMPLETE_METADATA',
  UNKNOWN: 'UNKNOWN'
});

/**
 * Raw-image lifecycle states for a FUTURE privacy-friendly policy. BS1-B defines the states
 * only — it persists nothing and deletes nothing. Default is TRANSIENT.
 * Intended flow: capture image evidence -> extract geometry / semantic / boundary / confidence
 * evidence -> retain the derived Personalized Beard Surface -> raw images become
 * ELIGIBLE_FOR_DISCARD unless an explicit future feature keeps them.
 */
export const RawImageLifecycle = Object.freeze({
  TRANSIENT: 'TRANSIENT',
  RETAINED_FOR_SCAN_PROCESSING: 'RETAINED_FOR_SCAN_PROCESSING',
  DERIVED_DATA_EXTRACTED: 'DERIVED_DATA_EXTRACTED',
  ELIGIBLE_FOR_DISCARD: 'ELIGIBLE_FOR_DISCARD',
  PERSISTED_BY_EXPLICIT_FEATURE: 'PERSISTED_BY_EXPLICIT_FEATURE'
});

/** Coordinate space the packaged geometry is expressed in (matches A6 face-local evidence). */
export const PACKAGE_GEOMETRY_SPACE = CoordinateSpace.CANONICAL_FACE_LOCAL;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function round4(x) { return isNum(x) ? Math.round(x * 1e4) / 1e4 : x; }
function frozenArr(a) { return Object.freeze([...(a || [])]); }

// ---------------------------------------------------------------------------
// Observation quality — explicit components, never a mysterious single score.
// A6 supplies tracking / pose / distance / coherence evidence but NO image
// sharpness metric, so `sharpness` defaults to null (UNKNOWN) and is never faked.
// ---------------------------------------------------------------------------
export const OBSERVATION_QUALITY_KEYS = Object.freeze([
  'sharpness', 'trackingConfidence', 'poseWindowQuality',
  'distanceQuality', 'landmarkCoverage', 'registrationQuality', 'syncQuality'
]);

export function makeObservationQuality(parts = {}) {
  const out = {};
  for (const k of OBSERVATION_QUALITY_KEYS) out[k] = clamp01OrNull(parts[k]);
  out.combined = combineObservationQuality(out);
  return Object.freeze(out);
}

/** Conservative: the minimum of every PRESENT component; null when nothing is known. */
export function combineObservationQuality(parts = {}) {
  const present = OBSERVATION_QUALITY_KEYS
    .map(k => clamp01OrNull(parts[k]))
    .filter(v => v != null);
  return present.length ? round4(Math.min(...present)) : null;
}

// ---------------------------------------------------------------------------
// ScanObservation — one exact hidden observation behind a visible pose.
// Fields Mettle's A6 cannot currently produce are nullable / UNKNOWN, never faked.
// Image bytes are NEVER stored here; `imageRef` is an opaque handle + shape metadata.
// ---------------------------------------------------------------------------
export function makeScanObservation(spec = {}) {
  const {
    observationId = null,
    poseId = null,                 // formal visible pose (SCAN_POSES) or null for pure transition
    observedPoseRegion = null,     // A6.0B region label string (e.g. 'RIGHT45_TO_RIGHT_PROFILE') or null
    nativeFrameTimestampNs = null, // ARCore frame timestamp (ns) — the exact time evidence
    monotonicMs = null,            // performance.now()-style wall-ish ms
    imageRef = null,               // { ref, format, width, height, rotationDegrees, mirrored, byteLength? } | null
    landmarks2D = null,            // array | count | null
    faceLocal3D = null,            // array | count | null
    faceLocal3DSpace = PACKAGE_GEOMETRY_SPACE,
    yawDeg = null, pitchDeg = null, rollDeg = null,
    cameraIntrinsics = null,       // { fx, fy, cx, cy, imageWidth, imageHeight, space } | null
    transformationMatrix = null,   // number[16] | null   (production MVP matrix)
    imageSpaceViewModelMatrix = null, // number[16] | null (A6.0A image-space camera transform)
    distanceMetric = null,         // { faceCameraZ } | null  — NOT metres of depth, ARCore face-local
    trackingQuality = null,        // makeObservationQuality parts | null
    imageQuality = null,           // makeObservationQuality parts | null
    poseQuality = null,            // makeObservationQuality parts | null
    sourceTier = SourceTier.UNKNOWN,
    nativeSpatialKeyframe = false, // true when produced by the requestSpatialKeyframe native path
    coherenceStatus = null,        // raw A6 string: 'VERIFIED_EXACT' | 'REJECTED_UNMATCHED' | null
    payloadKind = null,            // auto-derived when null
    retentionStatus = RetentionStatus.CANDIDATE,
    rejectionReason = null,
    rawImageLifecycle = RawImageLifecycle.TRANSIENT,
    hairState = HairState.UNKNOWN, // BS1-B never infers this
    metadata = null
  } = spec;

  if (poseId != null && !SCAN_POSES.includes(poseId)) {
    throw new Error(`makeScanObservation: unknown poseId "${poseId}"`);
  }
  if (!Object.values(SourceTier).includes(sourceTier)) {
    throw new Error(`makeScanObservation: unknown sourceTier "${sourceTier}"`);
  }
  if (!Object.values(RetentionStatus).includes(retentionStatus)) {
    throw new Error(`makeScanObservation: unknown retentionStatus "${retentionStatus}"`);
  }
  if (rejectionReason != null && !Object.values(RejectionReason).includes(rejectionReason)) {
    throw new Error(`makeScanObservation: unknown rejectionReason "${rejectionReason}"`);
  }
  if (!Object.values(RawImageLifecycle).includes(rawImageLifecycle)) {
    throw new Error(`makeScanObservation: unknown rawImageLifecycle "${rawImageLifecycle}"`);
  }
  if (hairState !== HairState.UNKNOWN && !Object.values(HairState).includes(hairState)) {
    throw new Error(`makeScanObservation: unknown hairState "${hairState}"`);
  }

  const hasImage = !!(imageRef && (imageRef.ref != null));
  const geomCount = countOf(landmarks2D) + countOf(faceLocal3D);
  const hasGeometry = geomCount > 0 || Array.isArray(transformationMatrix) || Array.isArray(imageSpaceViewModelMatrix);
  const hasFullImageMeta = hasImage && !!cameraIntrinsics && (Array.isArray(landmarks2D) || Array.isArray(faceLocal3D) || isNum(landmarks2D) || isNum(faceLocal3D));

  let derivedPayloadKind = payloadKind;
  if (derivedPayloadKind == null) {
    if (hasImage && hasGeometry && hasFullImageMeta) derivedPayloadKind = ObservationPayloadKind.IMAGE_AND_GEOMETRY;
    else if (hasImage && hasGeometry) derivedPayloadKind = ObservationPayloadKind.IMAGE_AND_GEOMETRY;
    else if (hasImage) derivedPayloadKind = ObservationPayloadKind.IMAGE_INCOMPLETE_METADATA;
    else if (hasGeometry) derivedPayloadKind = ObservationPayloadKind.GEOMETRY_ONLY;
    else derivedPayloadKind = ObservationPayloadKind.UNKNOWN;
  }

  const obs = {
    observationId,
    poseId,
    observedPoseRegion,
    timestamp: Object.freeze({ nativeFrameTimestampNs, monotonicMs }),
    imageRef: imageRef ? Object.freeze({
      ref: imageRef.ref,
      format: imageRef.format ?? null,
      width: imageRef.width ?? null,
      height: imageRef.height ?? null,
      rotationDegrees: imageRef.rotationDegrees ?? null,
      mirrored: imageRef.mirrored ?? null,
      byteLength: imageRef.byteLength ?? null
    }) : null,
    landmarks2D: normaliseGeom(landmarks2D),
    faceLocal3D: normaliseGeom(faceLocal3D),
    faceLocal3DSpace,
    yawDeg, pitchDeg, rollDeg,
    cameraIntrinsics: cameraIntrinsics ? Object.freeze({ ...cameraIntrinsics }) : null,
    transformationMatrix: Array.isArray(transformationMatrix) ? frozenArr(transformationMatrix) : null,
    imageSpaceViewModelMatrix: Array.isArray(imageSpaceViewModelMatrix) ? frozenArr(imageSpaceViewModelMatrix) : null,
    distanceMetric: distanceMetric ? Object.freeze({ ...distanceMetric }) : null,
    trackingQuality: trackingQuality ? makeObservationQuality(trackingQuality) : null,
    imageQuality: imageQuality ? makeObservationQuality(imageQuality) : null,
    poseQuality: poseQuality ? makeObservationQuality(poseQuality) : null,
    sourceTier,
    sourceKind: ObservationMethod.LANDMARK_GEOMETRY, // never a semantic method in BS1-B
    observationKind: hasGeometry ? ObservationKind.DIRECT_GEOMETRY
      : hasImage ? ObservationKind.UNKNOWN : ObservationKind.UNKNOWN,
    nativeSpatialKeyframe: !!nativeSpatialKeyframe,
    coherenceStatus,
    payloadKind: derivedPayloadKind,
    retentionStatus,
    rejectionReason,
    rawImageLifecycle,
    hairState,
    metadata: metadata ? Object.freeze({ ...metadata }) : null
  };
  obs.syncStatus = deriveSelfSyncStatus(obs);
  return Object.freeze(obs);
}

function countOf(g) { return Array.isArray(g) ? g.length : (isNum(g) ? g : 0); }
function normaliseGeom(g) {
  if (Array.isArray(g)) return Object.freeze({ kind: 'array', count: g.length });
  if (isNum(g)) return Object.freeze({ kind: 'count', count: g });
  return null;
}

/**
 * Self-synchronization: what a single observation can claim on its own.
 *  - A native spatial keyframe whose coherenceStatus is 'VERIFIED_EXACT' and which carries its
 *    own bundled geometry -> EXACT_SYNCHRONIZED (A6.0A structural guarantee).
 *  - A geometry-only observation -> UNPAIRED (there is no image to pair).
 *  - An image with 'REJECTED_UNMATCHED' or no bundled geometry -> UNPAIRED.
 *  - Otherwise UNKNOWN.
 */
export function deriveSelfSyncStatus(obs) {
  const hasImage = !!(obs.imageRef && obs.imageRef.ref != null);
  const hasGeometry = !!(obs.landmarks2D || obs.faceLocal3D || obs.transformationMatrix || obs.imageSpaceViewModelMatrix);
  if (!hasImage && hasGeometry) return SyncStatus.UNPAIRED;
  if (hasImage && obs.coherenceStatus === 'REJECTED_UNMATCHED') return SyncStatus.UNPAIRED;
  if (hasImage && obs.nativeSpatialKeyframe && obs.coherenceStatus === 'VERIFIED_EXACT' && hasGeometry) {
    return SyncStatus.EXACT_SYNCHRONIZED;
  }
  if (hasImage && !hasGeometry) return SyncStatus.UNPAIRED;
  return SyncStatus.UNKNOWN;
}

// ---------------------------------------------------------------------------
// Synchronized pair — an explicit link between one image observation and one
// geometry observation, preserving BOTH source ids/timestamps.
// ---------------------------------------------------------------------------
export function makeSynchronizedPair(imageObs, geometryObs, opts = {}) {
  const { toleranceNs = null } = opts;
  if (!imageObs || !geometryObs) throw new Error('makeSynchronizedPair: both observations are required');

  const imgTs = imageObs.timestamp?.nativeFrameTimestampNs ?? null;
  const geoTs = geometryObs.timestamp?.nativeFrameTimestampNs ?? null;
  const deltaNs = (isNum(imgTs) && isNum(geoTs)) ? Math.abs(imgTs - geoTs) : null;

  let status;
  if (imageObs.nativeSpatialKeyframe && imageObs.coherenceStatus === 'VERIFIED_EXACT' &&
      imageObs === geometryObs) {
    // The keyframe carries its own geometry — the pair IS one observation.
    status = SyncStatus.EXACT_SYNCHRONIZED;
  } else if (isNum(imgTs) && isNum(geoTs) && deltaNs === 0) {
    status = SyncStatus.EXACT_SYNCHRONIZED;
  } else if (deltaNs != null && isNum(toleranceNs) && deltaNs <= toleranceNs) {
    status = SyncStatus.NEAR_SYNCHRONIZED;
  } else if (deltaNs != null) {
    status = SyncStatus.UNPAIRED;
  } else {
    status = SyncStatus.UNKNOWN;
  }

  return Object.freeze({
    syncStatus: status,
    deltaNs,
    toleranceNs: isNum(toleranceNs) ? toleranceNs : null,
    image: Object.freeze({
      observationId: imageObs.observationId,
      nativeFrameTimestampNs: imgTs,
      coherenceStatus: imageObs.coherenceStatus ?? null,
      nativeSpatialKeyframe: !!imageObs.nativeSpatialKeyframe
    }),
    geometry: Object.freeze({
      observationId: geometryObs.observationId,
      nativeFrameTimestampNs: geoTs,
      sourceTier: geometryObs.sourceTier
    })
  });
}

// ---------------------------------------------------------------------------
// Diversity — spans + independent-view count. Caller supplies thresholds where
// A6 has not fixed one. No CV, no optical flow, no image-similarity metric.
// ---------------------------------------------------------------------------
export function diversitySummary(observations, opts = {}) {
  const { yawDeltaDeg = null, pitchDeltaDeg = null } = opts;
  const obs = (observations || []).filter(Boolean);

  const yaws = obs.map(o => o.yawDeg).filter(isNum);
  const pitches = obs.map(o => o.pitchDeg).filter(isNum);
  const rolls = obs.map(o => o.rollDeg).filter(isNum);
  const dists = obs.map(o => o.distanceMetric?.faceCameraZ).filter(isNum);
  const times = obs.map(o => o.timestamp?.monotonicMs).filter(isNum);

  const span = (a) => (a.length >= 2 ? round4(Math.max(...a) - Math.min(...a)) : (a.length === 1 ? 0 : null));

  let independentViewCount = null;
  if (isNum(yawDeltaDeg) || isNum(pitchDeltaDeg)) {
    const kept = [];
    for (const o of obs) {
      if (!isNum(o.yawDeg) && !isNum(o.pitchDeg)) continue;
      const distinct = kept.every(k => {
        const dy = (isNum(o.yawDeg) && isNum(k.yawDeg)) ? Math.abs(o.yawDeg - k.yawDeg) : Infinity;
        const dp = (isNum(o.pitchDeg) && isNum(k.pitchDeg)) ? Math.abs(o.pitchDeg - k.pitchDeg) : Infinity;
        const yawFar = isNum(yawDeltaDeg) ? dy >= yawDeltaDeg : false;
        const pitchFar = isNum(pitchDeltaDeg) ? dp >= pitchDeltaDeg : false;
        return yawFar || pitchFar;
      });
      if (distinct) kept.push(o);
    }
    independentViewCount = kept.length;
  }

  return Object.freeze({
    count: obs.length,
    yawSpanDeg: span(yaws),
    pitchSpanDeg: span(pitches),
    rollSpanDeg: span(rolls),
    distanceSpan: span(dists),
    timeSpanMs: span(times),
    independentViewCount,
    thresholdsSupplied: isNum(yawDeltaDeg) || isNum(pitchDeltaDeg)
  });
}

// ---------------------------------------------------------------------------
// Deterministic retention primitives. Isolated foundation logic — this does NOT
// replace Scanner capture. Degrades gracefully when quality fields are absent.
// ---------------------------------------------------------------------------

/** Drop observations with neither image nor geometry, or with no usable timestamp. */
export function filterValidObservations(observations) {
  return (observations || []).filter(o => {
    if (!o) return false;
    const hasImage = !!(o.imageRef && o.imageRef.ref != null);
    const hasGeometry = !!(o.landmarks2D || o.faceLocal3D || o.transformationMatrix || o.imageSpaceViewModelMatrix);
    const hasTime = isNum(o.timestamp?.nativeFrameTimestampNs) || isNum(o.timestamp?.monotonicMs);
    return (hasImage || hasGeometry) && hasTime;
  });
}

const SYNC_RANK = {
  [SyncStatus.EXACT_SYNCHRONIZED]: 0,
  [SyncStatus.NEAR_SYNCHRONIZED]: 1,
  [SyncStatus.UNPAIRED]: 2,
  [SyncStatus.UNKNOWN]: 3
};

function bestQuality(o) {
  const vals = [o.trackingQuality?.combined, o.imageQuality?.combined, o.poseQuality?.combined]
    .filter(v => typeof v === 'number');
  return vals.length ? Math.min(...vals) : null; // conservative; null when nothing known
}

/**
 * Deterministic ranking: (1) better sync, (2) higher conservative quality (unknown sorts
 * last), (3) earlier native timestamp, (4) lower observationId. Stable and total.
 */
export function rankObservations(observations) {
  return (observations || []).slice().sort((a, b) => {
    const sr = (SYNC_RANK[a.syncStatus] ?? 9) - (SYNC_RANK[b.syncStatus] ?? 9);
    if (sr !== 0) return sr;
    const qa = bestQuality(a), qb = bestQuality(b);
    const qav = qa == null ? -1 : qa, qbv = qb == null ? -1 : qb;
    if (qbv !== qav) return qbv - qav;
    const ta = a.timestamp?.nativeFrameTimestampNs, tb = b.timestamp?.nativeFrameTimestampNs;
    const tav = isNum(ta) ? ta : Infinity, tbv = isNum(tb) ? tb : Infinity;
    if (tav !== tbv) return tav - tbv;
    return String(a.observationId) < String(b.observationId) ? -1
      : String(a.observationId) > String(b.observationId) ? 1 : 0;
  });
}

/**
 * Greedy retention over ranked observations. Records an explicit RejectionReason for every
 * observation that is not retained; provenance is never dropped.
 *
 * options:
 *   maxRetained         : hard cap (CAP_REACHED)
 *   minYawSeparationDeg  : viewpoint spacing vs already-retained (TOO_REDUNDANT)
 *   minPitchSeparationDeg: viewpoint spacing vs already-retained (TOO_REDUNDANT)
 *   minQuality           : conservative-quality floor (LOW_TRACKING_QUALITY) — only applied
 *                          when a quality value exists; unknown quality is NOT rejected here
 *   requireSync          : if true, UNPAIRED/UNKNOWN sync is rejected (SYNC_UNCERTAIN)
 */
export function selectRetained(observations, options = {}) {
  const {
    maxRetained = null,
    minYawSeparationDeg = null,
    minPitchSeparationDeg = null,
    minQuality = null,
    requireSync = false
  } = options;

  const ranked = rankObservations(filterValidObservations(observations));
  const retained = [];
  const rejected = [];

  for (const o of ranked) {
    if (requireSync && (o.syncStatus === SyncStatus.UNPAIRED || o.syncStatus === SyncStatus.UNKNOWN)) {
      rejected.push(withReject(o, RejectionReason.SYNC_UNCERTAIN));
      continue;
    }
    const q = bestQuality(o);
    if (isNum(minQuality) && q != null && q < minQuality) {
      rejected.push(withReject(o, RejectionReason.LOW_TRACKING_QUALITY));
      continue;
    }
    if (isNum(maxRetained) && retained.length >= maxRetained) {
      rejected.push(withReject(o, RejectionReason.CAP_REACHED));
      continue;
    }
    const tooClose = retained.some(r => {
      const dy = (isNum(o.yawDeg) && isNum(r.yawDeg)) ? Math.abs(o.yawDeg - r.yawDeg) : Infinity;
      const dp = (isNum(o.pitchDeg) && isNum(r.pitchDeg)) ? Math.abs(o.pitchDeg - r.pitchDeg) : Infinity;
      const yawClose = isNum(minYawSeparationDeg) ? dy < minYawSeparationDeg : false;
      const pitchClose = isNum(minPitchSeparationDeg) ? dp < minPitchSeparationDeg : false;
      // redundant only if it fails EVERY supplied separation dimension
      if (isNum(minYawSeparationDeg) && isNum(minPitchSeparationDeg)) return yawClose && pitchClose;
      return yawClose || pitchClose;
    });
    if (tooClose) {
      rejected.push(withReject(o, RejectionReason.TOO_REDUNDANT));
      continue;
    }
    retained.push(o);
  }

  return {
    retained: retained.map(o => setStatus(o, RetentionStatus.RETAINED, null)),
    rejected
  };
}

function withReject(o, reason) { return setStatus(o, RetentionStatus.REJECTED, reason); }
function setStatus(o, retentionStatus, rejectionReason) {
  return Object.freeze({ ...o, retentionStatus, rejectionReason });
}

// ---------------------------------------------------------------------------
// Per-pose package
// ---------------------------------------------------------------------------
export function makePoseObservationPackage(spec = {}) {
  const {
    poseId,
    candidateGeometryObservations = [],
    candidateImageObservations = [],
    retainedGeometryObservations = [],
    retainedImageObservations = [],
    synchronizedObservationPairs = [],
    rejectedObservations = [],
    caps = A6_DEFAULT_CAPS,
    diversityThresholds = {}
  } = spec;

  if (!SCAN_POSES.includes(poseId)) throw new Error(`makePoseObservationPackage: unknown poseId "${poseId}"`);

  const pkg = {
    poseId,
    candidateGeometryObservations: frozenArr(candidateGeometryObservations),
    candidateImageObservations: frozenArr(candidateImageObservations),
    retainedGeometryObservations: frozenArr(retainedGeometryObservations),
    retainedImageObservations: frozenArr(retainedImageObservations),
    synchronizedObservationPairs: frozenArr(synchronizedObservationPairs),
    rejectedObservations: frozenArr(rejectedObservations),
    caps: Object.freeze({ ...A6_DEFAULT_CAPS, ...caps })
  };
  pkg.selectionSummary = poseSelectionSummary(pkg);
  pkg.qualitySummary = poseQualitySummary(pkg);
  pkg.diversitySummary = diversitySummary(
    [...pkg.retainedGeometryObservations, ...pkg.retainedImageObservations],
    diversityThresholds
  );
  return Object.freeze(pkg);
}

function poseSelectionSummary(pkg) {
  const allRetained = [...pkg.retainedGeometryObservations, ...pkg.retainedImageObservations];
  return Object.freeze({
    geometryCandidateCount: pkg.candidateGeometryObservations.length,
    geometryRetainedCount: pkg.retainedGeometryObservations.length,
    imageCandidateCount: pkg.candidateImageObservations.length,
    imageRetainedCount: pkg.retainedImageObservations.length,
    synchronizedPairCount: pkg.synchronizedObservationPairs.length,
    rejectedCount: pkg.rejectedObservations.length,
    geometryOnlyCount: allRetained.filter(o => o.payloadKind === ObservationPayloadKind.GEOMETRY_ONLY).length,
    imageBackedCount: allRetained.filter(o => o.payloadKind === ObservationPayloadKind.IMAGE_AND_GEOMETRY).length,
    imageIncompleteCount: allRetained.filter(o => o.payloadKind === ObservationPayloadKind.IMAGE_INCOMPLETE_METADATA).length,
    capReachedGeometry: pkg.retainedGeometryObservations.length >= pkg.caps.geometryPerPose,
    capReachedImage: pkg.retainedImageObservations.length >= pkg.caps.imagePerPose
  });
}

function poseQualitySummary(pkg) {
  const all = [...pkg.retainedGeometryObservations, ...pkg.retainedImageObservations];
  const known = all.map(bestQuality).filter(v => typeof v === 'number');
  const syncCounts = { exact: 0, near: 0, unpaired: 0, unknown: 0 };
  for (const p of pkg.synchronizedObservationPairs) {
    if (p.syncStatus === SyncStatus.EXACT_SYNCHRONIZED) syncCounts.exact++;
    else if (p.syncStatus === SyncStatus.NEAR_SYNCHRONIZED) syncCounts.near++;
    else if (p.syncStatus === SyncStatus.UNPAIRED) syncCounts.unpaired++;
    else syncCounts.unknown++;
  }
  return Object.freeze({
    qualityKnownCount: known.length,
    qualityUnknownCount: all.length - known.length,
    minKnownQuality: known.length ? round4(Math.min(...known)) : null,
    medianKnownQuality: known.length ? round4(median(known)) : null,
    syncExactCount: syncCounts.exact,
    syncNearCount: syncCounts.near,
    syncUnpairedCount: syncCounts.unpaired,
    syncUnknownCount: syncCounts.unknown
  });
}

// ---------------------------------------------------------------------------
// Top-level scan package
// ---------------------------------------------------------------------------
export function makeMultiObservationScanPackage(spec = {}) {
  const {
    schemaVersion = SCHEMA_VERSION,
    scanSessionId = null,
    createdAt = null,
    sourceArchitectureVersion = SOURCE_ARCHITECTURE_VERSION,
    posePackages = {},
    caps = A6_DEFAULT_CAPS
  } = spec;

  for (const pid of Object.keys(posePackages)) {
    if (!SCAN_POSES.includes(pid)) throw new Error(`makeMultiObservationScanPackage: unknown poseId "${pid}"`);
  }

  const pkg = {
    schemaVersion,
    scanSessionId,
    createdAt,
    sourceArchitectureVersion,
    caps: Object.freeze({ ...A6_DEFAULT_CAPS, ...caps }),
    posePackages: Object.freeze({ ...posePackages })
  };
  pkg.overallQualitySummary = overallSummary(pkg);
  return Object.freeze(pkg);
}

export function emptyScanPackage(spec = {}) {
  return makeMultiObservationScanPackage(spec);
}

function overallSummary(pkg) {
  const poses = Object.values(pkg.posePackages);
  let totalGeometry = 0, totalImages = 0, totalPairs = 0;
  let posesWithGeometry = 0, posesWithImages = 0, posesWithExactSync = 0;
  for (const p of poses) {
    const s = p.selectionSummary;
    totalGeometry += s.geometryRetainedCount;
    totalImages += s.imageRetainedCount;
    totalPairs += s.synchronizedPairCount;
    if (s.geometryRetainedCount > 0) posesWithGeometry++;
    if (s.imageRetainedCount > 0) posesWithImages++;
    if (p.qualitySummary.syncExactCount > 0) posesWithExactSync++;
  }
  return Object.freeze({
    schemaVersion: pkg.schemaVersion,
    poseCount: poses.length,
    posesWithGeometry,
    posesWithImages,
    posesWithExactSync,
    totalGeometryObservations: totalGeometry,
    totalImageObservations: totalImages,
    totalSynchronizedPairs: totalPairs,
    readyForBeardSurfaceProjection: 'NOT_EVALUATED'
  });
}

export function summarizeScanPackage(pkg) {
  const perPose = {};
  for (const [pid, p] of Object.entries(pkg.posePackages)) {
    perPose[pid] = Object.freeze({
      ...p.selectionSummary,
      ...p.qualitySummary,
      independentViewCount: p.diversitySummary.independentViewCount,
      yawSpanDeg: p.diversitySummary.yawSpanDeg
    });
  }
  return Object.freeze({ perPose: Object.freeze(perPose), overall: pkg.overallQualitySummary });
}

/** Concise deterministic development diagnostic. No image payloads, no per-frame logging. */
export function diagnosticString(pkg) {
  const lines = [`Mettle Multi-Observation Scan ${pkg.schemaVersion}`, ''];
  for (const pid of SCAN_POSES) {
    const p = pkg.posePackages[pid];
    if (!p) continue;
    const s = p.selectionSummary, d = p.diversitySummary, q = p.qualitySummary;
    lines.push(`${pid}:`);
    lines.push(`  geometry ${s.geometryRetainedCount}/${p.caps.geometryPerPose}`);
    lines.push(`  images ${s.imageRetainedCount}/${p.caps.imagePerPose}`);
    lines.push(`  exactSync ${q.syncExactCount}`);
    lines.push(`  yawSpan ${d.yawSpanDeg == null ? 'unknown' : d.yawSpanDeg + '°'}`);
    lines.push(`  rejected ${s.rejectedCount}`);
    lines.push('');
  }
  const o = pkg.overallQualitySummary;
  lines.push('overall:');
  lines.push(`  geometry=${o.totalGeometryObservations}`);
  lines.push(`  images=${o.totalImageObservations}`);
  lines.push(`  exactSync=${o.totalSynchronizedPairs === 0 ? 0 : sumExactSync(pkg)}`);
  lines.push(`  beardSurfaceProjection=${o.readyForBeardSurfaceProjection}`);
  return lines.join('\n');
}
function sumExactSync(pkg) {
  return Object.values(pkg.posePackages).reduce((n, p) => n + p.qualitySummary.syncExactCount, 0);
}

// ---------------------------------------------------------------------------
// Serialization / versioning
// ---------------------------------------------------------------------------
export function serialize(pkg) {
  return JSON.parse(JSON.stringify({ ...pkg, schemaVersion: pkg.schemaVersion || SCHEMA_VERSION }));
}
export function deserialize(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('deserialize: not an object');
  if (obj.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`deserialize: unsupported schemaVersion "${obj.schemaVersion}" (expected "${SCHEMA_VERSION}")`);
  }
  return makeMultiObservationScanPackage(obj);
}

// ---------------------------------------------------------------------------
// BS1-A adapter boundary (Part 16) — DOCUMENTATION ONLY. BS1-B wires nothing.
// A future BS1-C adapter consumes a MultiObservationScanPackage and emits BS1-A
// makeSurfaceObservation(...) records into a PersonalizedBeardSurface. No app
// runtime code is referenced here — only the sibling pure foundation vocabulary.
// ---------------------------------------------------------------------------
export function describeBS1AAdapterBoundary() {
  return Object.freeze({
    pipeline: 'MultiObservationScanPackage -> (BS1-C projection/fusion adapter) -> makeSurfaceObservation(...) -> PersonalizedBeardSurface',
    consumes: 'accuracy/multi-observation-scan-package.mjs',
    produces: 'accuracy/beard-surface-core.mjs :: makeSurfaceObservation / buildBeardSurface',
    fieldMapping: Object.freeze({
      region: 'DECIDED IN BS1-C — from anatomy landmark membership, not present in BS1-B',
      space: PACKAGE_GEOMETRY_SPACE,
      pose: 'ScanObservation.poseId (formal) — intermediate angles keep measured yaw/pitch/roll',
      method: ObservationMethod.LANDMARK_GEOMETRY,
      kind: 'ObservationKind.DIRECT_GEOMETRY for retained geometry; MULTI_VIEW_FUSED decided by BS1-C fusion',
      hairState: `${HairState.UNKNOWN} — BS1-B never infers hair; BS1-D introduces semantics`,
      confidenceComponents: Object.freeze([
        'geometryConfidence <- trackingQuality / poseQuality',
        'multiViewConfidence <- diversitySummary.independentViewCount',
        'registrationConfidence <- (future) registrationQuality',
        'coverageConfidence <- retained vs cap',
        'semanticConfidence <- null until BS1-D'
      ]),
      provenance: 'ScanObservation { poseId, observedPoseRegion, sourceTier, nativeSpatialKeyframe, coherenceStatus, syncStatus, retentionStatus, rejectionReason } survives conversion'
    }),
    guarantees: Object.freeze([
      'no competing Beard Surface model is defined here',
      'no hair semantics are produced',
      'no runtime app import',
      'no persistence'
    ])
  });
}
