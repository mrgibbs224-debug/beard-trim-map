// A6 recorder exports → BS1-B MultiObservationScanPackage — PURE ADAPTER
// Stage BS1-C. Isolated under accuracy/. Zero runtime imports, zero dependencies.
//
// PURPOSE
//   Turn the JSON/object shapes produced by the CURRENT index.html spatial-observation
//   recorders — A6.0 `window.__spatialObservationRecorder.export()` and A6.0B
//   `window.__scannerSpatialRecorder.export()` — into a BS1-B MultiObservationScanPackage,
//   using only BS1-B factory functions. Nothing here reimplements the BS1-B model, and
//   nothing here runs in the app (no import of index.html, no `window`, no recorder call).
//
// VERIFIED SOURCE SHAPES (index.html)
//   A6.0 export():  { geometryObs: {POSE:[g,...]}, imageKeyframes: {POSE:[k,...]} }   (per-pose)
//     g = { nativeTs, t, yawDeg, pitchDeg, rollDeg, faceCameraX/Y/Z,
//           transformationMatrix|null, landmarks2D([{x,y,z}]|null),
//           faceLocal3D([{x,y,z}]|null), frameWidth, frameHeight, mirrored, coverageValid }
//     k = { nativeTs, coherenceStatus('VERIFIED_EXACT'|'REJECTED_UNMATCHED'), rejectReason,
//           dataUrl(base64|null), width, height, imageRotationDegrees, imageMirrored,
//           intrinsics{fx,fy,cx,cy,imageWidth,imageHeight,space:'IMAGE'}, landmarks2D,
//           faceLocal3D, transformationMatrix, imageSpaceViewModelMatrix, yawDeg, pitchDeg,
//           rollDeg, faceCameraX/Y/Z, captureLatencyMs }
//   A6.0B export(): { manifest, geometryObs:[g2,...], imageKeyframes:[k2,...],
//                     formalCaptureAssociations:[...] }   (flat, session-scoped)
//     g2 = g + { scannerSessionId, observationId, currentScannerStep, observedPoseRegion,
//                qualityOk, qualityReason, stableFrames, readyFormalPose, retentionReason }
//     k2 = k + { scannerSessionId, observationId, observedPoseRegion, currentScannerStep,
//                triggerRegion, triggerReason, triggerObservationId }   (only VERIFIED_EXACT stored)
//
// RAW IMAGES: the base64 `dataUrl` is NEVER copied into the model. `imageRef` is a synthetic
// handle plus shape metadata; `byteLength` records the payload size only.

import {
  makeScanObservation,
  makePoseObservationPackage,
  makeMultiObservationScanPackage,
  makeSynchronizedPair,
  filterValidObservations,
  SourceTier,
  RetentionStatus,
  RejectionReason,
  RawImageLifecycle
} from './multi-observation-scan-package.mjs';
import { SCAN_POSES } from './beard-surface-core.mjs';

export const ADAPTER_VERSION = 'a6-scan-package-adapter/1';

// ---------------------------------------------------------------------------
// Pose-ID adapter (Stage BS1-C Part 2). One canonical vocabulary = BS1-A SCAN_POSES
// (identical to A60_POSES). Explicit table only — no fuzzy matching. Unknown → 'UNKNOWN'.
// ---------------------------------------------------------------------------
export const CANONICAL_POSES = SCAN_POSES; // ['front','right-45','right-profile','left-45','left-profile','chin-up']
export const UNKNOWN_POSE = 'UNKNOWN';

export const POSE_ID_MAP = Object.freeze({
  // A60 vocabulary (already canonical)
  'front': 'front',
  'right-45': 'right-45',
  'right-profile': 'right-profile',
  'left-45': 'left-45',
  'left-profile': 'left-profile',
  'chin-up': 'chin-up',
  // Scanner STEPS[] vocabulary
  'right-three-quarter': 'right-45',
  'left-three-quarter': 'left-45'
});

/** Map any A60 / Scanner pose id to the canonical id. Unknown ids fail closed. */
export function toCanonicalPose(id) {
  if (typeof id !== 'string') return UNKNOWN_POSE;
  return Object.prototype.hasOwnProperty.call(POSE_ID_MAP, id) ? POSE_ID_MAP[id] : UNKNOWN_POSE;
}

const SCANNER_STEP_FOR_CANONICAL = Object.freeze({
  'front': 'front',
  'right-45': 'right-three-quarter',
  'right-profile': 'right-profile',
  'left-45': 'left-three-quarter',
  'left-profile': 'left-profile',
  'chin-up': 'chin-up'
});
/** Canonical id → Scanner STEPS[] id (for provenance display). Unknown → 'UNKNOWN'. */
export function toScannerStepId(canonical) {
  return SCANNER_STEP_FOR_CANONICAL[canonical] || UNKNOWN_POSE;
}

// ---------------------------------------------------------------------------
// SOURCE-A6 DEFAULTS / TEST FIXTURES — verified index.html constants, reproduced here as
// adapter configuration ONLY. They are NOT production thresholds and this module changes
// no A6 constant.
// ---------------------------------------------------------------------------
export const SOURCE_A6_DEFAULTS = Object.freeze({
  geometryPerPose: 40,      // A60_GEOMETRY_CAP_PER_POSE
  imagePerPose: 8,          // A60_IMAGE_CAP_PER_POSE
  sessionGeometry: 200,     // A60B_TIER_A_CAP
  sessionImage: 40,         // A60B_TIER_B_CAP
  imagePerRegion: 3,        // A60B_TIER_B_PER_REGION_CAP
  poseDeltaDeg: 4,          // A60B_POSE_DELTA_DEG
  distanceDeltaM: 0.015,    // A60B_DISTANCE_DELTA_M
  timeSampleMs: 600,        // A60B_TIME_SAMPLE_MS
  redundantTimeMs: 100      // A60B_REDUNDANT_TIME_MS
});

const CAPS_FROM_DEFAULTS = Object.freeze({
  geometryPerPose: SOURCE_A6_DEFAULTS.geometryPerPose,
  imagePerPose: SOURCE_A6_DEFAULTS.imagePerPose,
  sessionGeometry: SOURCE_A6_DEFAULTS.sessionGeometry,
  sessionImage: SOURCE_A6_DEFAULTS.sessionImage,
  imagePerRegion: SOURCE_A6_DEFAULTS.imagePerRegion
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const asObject = (x) => (typeof x === 'string' ? JSON.parse(x) : x);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v) => (Array.isArray(v) ? v : null);

// BI-1C: real A6.0/A6.0B exports serialize the native frame timestamp (nativeTs) as a decimal
// STRING, not a JS number -- confirmed against a real 29-image / 100-geometry session, where
// every other numeric field (yawDeg, faceCameraZ, width, height, ...) stays a plain number.
// Every downstream consumer of ScanObservation.timestamp.nativeFrameTimestampNs already expects
// a plain finite number (annotation-overlay-data.mjs even throws otherwise), so normalisation
// happens once, here, at ingest -- nothing downstream changes shape. A numeric string is
// accepted ONLY when it is a syntactically clean, unsigned-or-signed decimal integer (no
// whitespace, no decimal point) AND Number.isSafeInteger() confirms it round-trips exactly as a
// JS number; anything else (malformed, non-integer, unsafe magnitude, empty, whitespace-padded)
// is rejected to null rather than silently truncated -- fail-closed, matching this file's
// existing num()/arr() philosophy. Deliberately narrower than `num()` itself: only the two
// nativeTs call sites below use this, so every other field's existing string-rejecting behavior
// is completely unchanged.
const INTEGER_STRING_RE = /^-?\d+$/;
function numOrIntegerString(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  if (!INTEGER_STRING_RE.test(v)) return null; // rejects whitespace, decimals, empty, non-digits
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

function geomMeta(e, recorder, poseKey, index, retainRawPoints) {
  const m = {
    sourceRecorder: recorder,
    sourcePoseKey: poseKey ?? null,
    sourceIndex: index,
    frameWidth: e.frameWidth ?? null,
    frameHeight: e.frameHeight ?? null,
    mirrored: e.mirrored ?? null,
    coverageValid: e.coverageValid ?? null,
    scannerSessionId: e.scannerSessionId ?? null,
    sourceObservationId: e.observationId ?? null,
    currentScannerStep: e.currentScannerStep ?? null,
    retentionReason: e.retentionReason ?? null,
    qualityOk: typeof e.qualityOk === 'boolean' ? e.qualityOk : null,
    qualityReason: e.qualityReason ?? null,
    stableFrames: num(e.stableFrames),
    readyFormalPose: typeof e.readyFormalPose === 'boolean' ? e.readyFormalPose : null
  };
  if (retainRawPoints) {
    if (arr(e.faceLocal3D)) m.faceLocal3DPoints = e.faceLocal3D;
    if (arr(e.landmarks2D)) m.landmarks2DPoints = e.landmarks2D;
  }
  return m;
}

function imageMeta(e, recorder, poseKey, index, retainRawPoints) {
  const m = {
    sourceRecorder: recorder,
    sourcePoseKey: poseKey ?? null,
    sourceIndex: index,
    rejectReason: e.rejectReason ?? null,
    captureLatencyMs: num(e.captureLatencyMs),
    scannerSessionId: e.scannerSessionId ?? null,
    sourceObservationId: e.observationId ?? null,
    currentScannerStep: e.currentScannerStep ?? null,
    triggerRegion: e.triggerRegion ?? null,
    triggerReason: e.triggerReason ?? null,
    triggerObservationId: e.triggerObservationId ?? null
  };
  if (retainRawPoints) {
    if (arr(e.faceLocal3D)) m.faceLocal3DPoints = e.faceLocal3D;
    if (arr(e.landmarks2D)) m.landmarks2DPoints = e.landmarks2D;
  }
  return m;
}

function ingestGeometry(e, { recorder, poseKey, canonicalPose, observedPoseRegion, index, retainRawPoints }) {
  return makeScanObservation({
    observationId: `${recorder === 'A6.0B' ? 'a60b' : 'a60'}:${poseKey ?? canonicalPose}:g:${index}`,
    poseId: canonicalPose,
    observedPoseRegion: observedPoseRegion ?? null,
    nativeFrameTimestampNs: numOrIntegerString(e.nativeTs),
    monotonicMs: num(e.t),
    landmarks2D: arr(e.landmarks2D) || null,
    faceLocal3D: arr(e.faceLocal3D) || null,
    transformationMatrix: arr(e.transformationMatrix),
    yawDeg: num(e.yawDeg), pitchDeg: num(e.pitchDeg), rollDeg: num(e.rollDeg),
    distanceMetric: (num(e.faceCameraZ) != null || num(e.faceCameraX) != null)
      ? { faceCameraX: num(e.faceCameraX), faceCameraY: num(e.faceCameraY), faceCameraZ: num(e.faceCameraZ) }
      : null,
    sourceTier: SourceTier.TIER_A_GEOMETRY,
    nativeSpatialKeyframe: false,
    coherenceStatus: null,
    rawImageLifecycle: RawImageLifecycle.TRANSIENT,
    metadata: geomMeta(e, recorder, poseKey, index, retainRawPoints)
  });
}

function ingestImageKeyframe(e, { recorder, poseKey, canonicalPose, observedPoseRegion, index, retainRawPoints }) {
  const hasImageShape = (typeof e.dataUrl === 'string') || num(e.width) != null || num(e.height) != null;
  const ref = `${recorder === 'A6.0B' ? 'a60b' : 'a60'}:${poseKey ?? canonicalPose}:img:${index}` +
    (numOrIntegerString(e.nativeTs) != null ? `:ts${e.nativeTs}` : '');
  const coherence = e.coherenceStatus || 'REJECTED_UNMATCHED';
  return makeScanObservation({
    observationId: `${recorder === 'A6.0B' ? 'a60b' : 'a60'}:${poseKey ?? canonicalPose}:img:${index}`,
    poseId: canonicalPose,
    observedPoseRegion: observedPoseRegion ?? null,
    nativeFrameTimestampNs: numOrIntegerString(e.nativeTs),
    monotonicMs: null,
    imageRef: hasImageShape ? {
      ref,
      format: 'jpeg',
      width: num(e.width),
      height: num(e.height),
      rotationDegrees: num(e.imageRotationDegrees),
      mirrored: typeof e.imageMirrored === 'boolean' ? e.imageMirrored : null,
      byteLength: typeof e.dataUrl === 'string' ? e.dataUrl.length : null
    } : null,
    landmarks2D: arr(e.landmarks2D) || null,
    faceLocal3D: arr(e.faceLocal3D) || null,
    cameraIntrinsics: (e.intrinsics && typeof e.intrinsics === 'object') ? { ...e.intrinsics } : null,
    transformationMatrix: arr(e.transformationMatrix),
    imageSpaceViewModelMatrix: arr(e.imageSpaceViewModelMatrix),
    yawDeg: num(e.yawDeg), pitchDeg: num(e.pitchDeg), rollDeg: num(e.rollDeg),
    distanceMetric: (num(e.faceCameraZ) != null || num(e.faceCameraX) != null)
      ? { faceCameraX: num(e.faceCameraX), faceCameraY: num(e.faceCameraY), faceCameraZ: num(e.faceCameraZ) }
      : null,
    sourceTier: SourceTier.TIER_B_IMAGE_KEYFRAME,
    nativeSpatialKeyframe: true,
    coherenceStatus: coherence,
    imageQuality: null,          // A6 exposes no sharpness metric — stays unknown
    rawImageLifecycle: RawImageLifecycle.TRANSIENT,
    metadata: imageMeta(e, recorder, poseKey, index, retainRawPoints)
  });
}

/** Partition ingested observations into retained / rejected, preserving provenance. */
function partition(geometryObs, imageObs) {
  const validGeom = new Set(filterValidObservations(geometryObs));
  const validImg = new Set(filterValidObservations(imageObs));

  const retainedGeometry = [];
  const retainedImage = [];
  const rejected = [];

  for (const g of geometryObs) {
    if (validGeom.has(g)) retainedGeometry.push(mark(g, RetentionStatus.RETAINED, null));
    else rejected.push(mark(g, RetentionStatus.REJECTED, RejectionReason.MISSING_GEOMETRY));
  }
  for (const k of imageObs) {
    if (!validImg.has(k)) { rejected.push(mark(k, RetentionStatus.REJECTED, RejectionReason.MISSING_IMAGE)); continue; }
    if (k.coherenceStatus === 'VERIFIED_EXACT') retainedImage.push(mark(k, RetentionStatus.RETAINED, null));
    else rejected.push(mark(k, RetentionStatus.REJECTED, RejectionReason.SYNC_UNCERTAIN)); // REJECTED_UNMATCHED etc.
  }
  return { retainedGeometry, retainedImage, rejected };
}
function mark(o, retentionStatus, rejectionReason) {
  return Object.freeze({ ...o, retentionStatus, rejectionReason });
}

/** EXACT self-pairs for retained VERIFIED_EXACT keyframes that carry their own geometry. */
function exactSelfPairs(retainedImage) {
  const pairs = [];
  for (const k of retainedImage) {
    const hasGeometry = !!(k.faceLocal3D || k.landmarks2D || k.transformationMatrix || k.imageSpaceViewModelMatrix);
    if (k.nativeSpatialKeyframe && k.coherenceStatus === 'VERIFIED_EXACT' && hasGeometry) {
      pairs.push(makeSynchronizedPair(k, k));
    }
  }
  return pairs;
}

function buildPosePackages(byPose) {
  const posePackages = {};
  for (const [canonicalPose, streams] of Object.entries(byPose)) {
    const { retainedGeometry, retainedImage, rejected } = partition(streams.geometry, streams.image);
    posePackages[canonicalPose] = makePoseObservationPackage({
      poseId: canonicalPose,
      candidateGeometryObservations: streams.geometry,
      candidateImageObservations: streams.image,
      retainedGeometryObservations: retainedGeometry,
      retainedImageObservations: retainedImage,
      synchronizedObservationPairs: exactSelfPairs(retainedImage),
      rejectedObservations: rejected,
      caps: CAPS_FROM_DEFAULTS,
      diversityThresholds: { yawDeltaDeg: SOURCE_A6_DEFAULTS.poseDeltaDeg, pitchDeltaDeg: SOURCE_A6_DEFAULTS.poseDeltaDeg }
    });
  }
  return posePackages;
}

// ---------------------------------------------------------------------------
// Public adapters
// ---------------------------------------------------------------------------

/** A6.0 per-pose export → MultiObservationScanPackage. */
export function fromA60Export(a60Export, options = {}) {
  const { retainRawPoints = true, scanSessionId = null, createdAt = null } = options;
  const src = asObject(a60Export) || {};
  const geometryObs = src.geometryObs || {};
  const imageKeyframes = src.imageKeyframes || {};

  const byPose = {};
  const unmappedPoseKeys = [];
  const ensure = (p) => (byPose[p] || (byPose[p] = { geometry: [], image: [] }));

  for (const poseKey of Object.keys(geometryObs)) {
    const canonical = toCanonicalPose(poseKey);
    if (canonical === UNKNOWN_POSE) { unmappedPoseKeys.push(poseKey); continue; }
    (geometryObs[poseKey] || []).forEach((e, i) =>
      ensure(canonical).geometry.push(ingestGeometry(e, { recorder: 'A6.0', poseKey, canonicalPose: canonical, observedPoseRegion: null, index: i, retainRawPoints })));
  }
  for (const poseKey of Object.keys(imageKeyframes)) {
    const canonical = toCanonicalPose(poseKey);
    if (canonical === UNKNOWN_POSE) { if (!unmappedPoseKeys.includes(poseKey)) unmappedPoseKeys.push(poseKey); continue; }
    (imageKeyframes[poseKey] || []).forEach((e, i) =>
      ensure(canonical).image.push(ingestImageKeyframe(e, { recorder: 'A6.0', poseKey, canonicalPose: canonical, observedPoseRegion: null, index: i, retainRawPoints })));
  }

  const pkg = makeMultiObservationScanPackage({
    scanSessionId, createdAt,
    sourceArchitectureVersion: 'A6.0',
    posePackages: buildPosePackages(byPose),
    caps: CAPS_FROM_DEFAULTS
  });
  return Object.freeze({ scanPackage: pkg, unmappedPoseKeys: Object.freeze(unmappedPoseKeys) });
}

/** A6.0B flat session export → MultiObservationScanPackage. */
export function fromA60BExport(a60bExport, options = {}) {
  const { retainRawPoints = true } = options;
  const src = asObject(a60bExport) || {};
  const manifest = src.manifest || {};
  const geometryObs = arr(src.geometryObs) || [];
  const imageKeyframes = arr(src.imageKeyframes) || [];

  const byPose = {};
  const skippedUnmappedStep = [];
  const ensure = (p) => (byPose[p] || (byPose[p] = { geometry: [], image: [] }));

  geometryObs.forEach((e, i) => {
    const canonical = toCanonicalPose(e.currentScannerStep);
    if (canonical === UNKNOWN_POSE) { skippedUnmappedStep.push({ kind: 'geometry', index: i, currentScannerStep: e.currentScannerStep ?? null }); return; }
    ensure(canonical).geometry.push(ingestGeometry(e, {
      recorder: 'A6.0B', poseKey: null, canonicalPose: canonical, observedPoseRegion: e.observedPoseRegion ?? null, index: i, retainRawPoints
    }));
  });
  imageKeyframes.forEach((e, i) => {
    const canonical = toCanonicalPose(e.currentScannerStep);
    if (canonical === UNKNOWN_POSE) { skippedUnmappedStep.push({ kind: 'image', index: i, currentScannerStep: e.currentScannerStep ?? null }); return; }
    ensure(canonical).image.push(ingestImageKeyframe(e, {
      recorder: 'A6.0B', poseKey: null, canonicalPose: canonical, observedPoseRegion: e.observedPoseRegion ?? null, index: i, retainRawPoints
    }));
  });

  const pkg = makeMultiObservationScanPackage({
    scanSessionId: manifest.scannerSessionId ?? null,
    createdAt: manifest.startedAt ?? null,
    sourceArchitectureVersion: 'A6.0B',
    posePackages: buildPosePackages(byPose),
    caps: CAPS_FROM_DEFAULTS
  });
  return Object.freeze({ scanPackage: pkg, skippedUnmappedStep: Object.freeze(skippedUnmappedStep), sourceManifest: Object.freeze({ ...manifest }) });
}

/** Merge an A6.0 export and an A6.0B export into one MultiObservationScanPackage. */
export function fromA6Exports({ a60 = null, a60b = null } = {}, options = {}) {
  const a = a60 != null ? fromA60Export(a60, options) : null;
  const b = a60b != null ? fromA60BExport(a60b, options) : null;

  const merged = {};
  const collect = (result) => {
    if (!result) return;
    for (const [pose, p] of Object.entries(result.scanPackage.posePackages)) {
      const acc = merged[pose] || (merged[pose] = {
        candidateGeometryObservations: [], candidateImageObservations: [],
        retainedGeometryObservations: [], retainedImageObservations: [],
        synchronizedObservationPairs: [], rejectedObservations: []
      });
      acc.candidateGeometryObservations.push(...p.candidateGeometryObservations);
      acc.candidateImageObservations.push(...p.candidateImageObservations);
      acc.retainedGeometryObservations.push(...p.retainedGeometryObservations);
      acc.retainedImageObservations.push(...p.retainedImageObservations);
      acc.synchronizedObservationPairs.push(...p.synchronizedObservationPairs);
      acc.rejectedObservations.push(...p.rejectedObservations);
    }
  };
  collect(a); collect(b);

  const posePackages = {};
  for (const [pose, acc] of Object.entries(merged)) {
    posePackages[pose] = makePoseObservationPackage({
      poseId: pose,
      ...acc,
      caps: CAPS_FROM_DEFAULTS,
      diversityThresholds: { yawDeltaDeg: SOURCE_A6_DEFAULTS.poseDeltaDeg, pitchDeltaDeg: SOURCE_A6_DEFAULTS.poseDeltaDeg }
    });
  }

  const pkg = makeMultiObservationScanPackage({
    scanSessionId: (b && b.sourceManifest && b.sourceManifest.scannerSessionId) || options.scanSessionId || null,
    createdAt: options.createdAt || null,
    sourceArchitectureVersion: 'A6.0 / A6.0A / A6.0B',
    posePackages,
    caps: CAPS_FROM_DEFAULTS
  });
  return Object.freeze({
    scanPackage: pkg,
    unmappedPoseKeys: a ? a.unmappedPoseKeys : Object.freeze([]),
    skippedUnmappedStep: b ? b.skippedUnmappedStep : Object.freeze([])
  });
}
