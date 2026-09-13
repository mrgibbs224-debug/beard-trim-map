// EXACT_FRAME_RESEARCH_CAPTURE — pure, tested reference implementation — PURE, ISOLATED
// Stage BI-1Z0B. Zero dependencies, zero I/O, zero DOM, zero window.
//
// PURPOSE
//   index.html's EXACT_FRAME_RESEARCH_CAPTURE runtime code (research-only, default OFF, gated
//   behind window.__EXACT_FRAME_RESEARCH_CAPTURE) has no module system and cannot import this
//   file directly -- its inline copy MIRRORS the two pure algorithms defined here (sparse-landmark
//   extraction and durable-package shaping) verbatim, the same "reproduced here so the tool stays
//   standalone" pattern already used by tools/annotation-workbench/annotation-workbench.cjs's
//   OVERLAY_GROUPS. This module is the canonical, unit-tested source of truth for that logic.
//
// WHAT THIS FIXES (BI-1Z0A root cause)
//   makeScanObservation (multi-observation-scan-package.mjs) always reduces landmarks2D to
//   {kind,count}; buildAnnotationManifest (BS1-F) then drops geometry entirely via its narrow
//   field whitelist. This module's export shape is a DELIBERATE PARALLEL research artifact that
//   never goes through either of those two reduction points -- Tier-B image-bearing keyframes
//   keep their FULL landmarks2D array untouched; Tier-A continuous samples are reduced only to
//   the sparse jaw/cheek/mouth-reference subset (to bound durable file size), never to count-only.
//
// WHAT THIS IS NOT
//   - Not a BS1-B/BS1-F/BS1-G replacement. Existing AnnotationBundle contracts are untouched.
//   - Not wired into any existing accuracy/ consumer. A future stage may choose to.

export const EXACT_FRAME_RESEARCH_CAPTURE_VERSION = 'exact-frame-research-capture/1';

// Verified index sets, reproduced verbatim from accuracy/annotation-overlay-data.mjs
// (JAW_CHIN_RAIL / CHEEK_RAIL_RIGHT / CHEEK_RAIL_LEFT / MOUTH_REFERENCE). No new landmark index
// is invented here -- same discipline as that module's own header comment.
export const JAW_CHIN_RAIL = Object.freeze([172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397]);
export const CHEEK_RAIL_RIGHT = Object.freeze([234, 116, 123, 205, 186]);
export const CHEEK_RAIL_LEFT = Object.freeze([454, 345, 352, 425, 410]);
export const MOUTH_REFERENCE = Object.freeze([61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]);
export const SPARSE_TIER_A_INDICES = Object.freeze(
  [...new Set([...JAW_CHIN_RAIL, ...CHEEK_RAIL_RIGHT, ...CHEEK_RAIL_LEFT, ...MOUTH_REFERENCE])].sort((a, b) => a - b)
);

// Frozen anatomical jaw/chin support-point side semantics (Part 6) -- matches index.html's
// PERSON_ANATOMY_SIDES (personRight.jawAngle=172, personLeft.jawAngle=397). 172/149 = anatomical
// RIGHT, 397/378 = anatomical LEFT, 152 = CENTER. Never inferred from variable names.
export const JAW_SUPPORT_INDICES = Object.freeze([172, 149, 152, 378, 397]);
export const JAW_SUPPORT_SIDE = Object.freeze({ 172: 'RIGHT', 149: 'RIGHT', 152: 'CENTER', 378: 'LEFT', 397: 'LEFT' });

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Extract a sparse, INDEXED landmark subset from a full (or partial) landmarks2D array.
 * Never invents a missing point -- a missing/invalid index is simply omitted (index order
 * preserved, ascending). Every returned point carries its own `index` (Part 6: never serialize a
 * coordinate without the index it represents) plus its frozen anatomicalSide when known.
 */
export function extractSparseLandmarks(landmarks2D, indices = SPARSE_TIER_A_INDICES) {
  if (!Array.isArray(landmarks2D)) return null;
  const out = [];
  for (const i of indices) {
    const p = landmarks2D[i];
    if (p && isFiniteNum(p.x) && isFiniteNum(p.y)) {
      out.push({ index: i, x: p.x, y: p.y, z: isFiniteNum(p.z) ? p.z : null, anatomicalSide: JAW_SUPPORT_SIDE[i] || null });
    }
  }
  return out;
}

/** True iff every one of the 5 frozen jaw-support indices is present in a sparse extraction. */
export function hasFullJawSupport(sparsePoints) {
  if (!Array.isArray(sparsePoints)) return false;
  const present = new Set(sparsePoints.map((p) => p.index));
  return JAW_SUPPORT_INDICES.every((i) => present.has(i));
}

// Coordinate-space / tracker-convention documentation, persisted verbatim into every export
// (Part 7/8) -- factual, sourced statements about the ALREADY-EXISTING pipeline (BI-1Z0/BI-1Z0A
// findings), never a new guess about orientation.
export const COORDINATE_SPACE_METADATA = Object.freeze({
  landmarks2D: 'CAPTURE_NORMALIZED (0..1); convert to IMAGE pixels via x*imageWidth, y*imageHeight -- see accuracy/landmark-coordinate-conversion.mjs',
  tierBImageIntrinsicsSpace: 'IMAGE (raw unrotated/unmirrored JPEG pixel buffer, Camera.getImageIntrinsics())',
  faceLocal3D: 'ARCore AugmentedFace face-local (center-pose-relative); units meters (ARCore estimate); axes x=personLeft/y=up/z=forwardOutOfFace; NOT a metric depth scan, NOT user-facing millimeters',
  trackerCoordinateConvention: 'landmarks2D/faceLocal3D/transformationMatrix originate directly from the native ARCore/MLKit packet for that exact frame; Tier-B imageRotationDegrees/imageMirrored/intrinsics originate from the SAME ARCore Frame acquireCameraImage() call -- no separate sensor-orientation transform is applied by the recorder.'
});

// BI-1Z0C Part 5/6/7 — research observability inventory. Classified PRESENT (already flows
// through the existing pipeline), DERIVABLE (cheaply computed from data already available, no new
// dependency), or ABSENT (would require new native machinery beyond "cheap to obtain", or the
// underlying capability does not exist in this app at all -- e.g. no zoom control, no Camera2
// CaptureResult plumbing, no PowerManager thermal listener). Nothing classified ABSENT is ever
// fabricated; the field is simply omitted rather than set to a fake value. This constant is
// documentation, consulted by the report, not machine-enforced.
export const TELEMETRY_INVENTORY = Object.freeze({
  appVersion: 'PRESENT (BuildConfig.VERSION_NAME/VERSION_CODE, once per export)',
  buildIdentifier: 'PRESENT (BuildConfig.TRACKING_BRIDGE_VERSION, once per export)',
  deviceManufacturer: 'PRESENT (android.os.Build.MANUFACTURER, once per export)',
  deviceModel: 'PRESENT (android.os.Build.MODEL, once per export)',
  androidVersion: 'PRESENT (android.os.Build.VERSION.RELEASE/SDK_INT, once per export)',
  cameraIdSpecific: 'ABSENT (CameraCapabilityInspector census exists but is not cross-referenced to "which ID is active this session" anywhere existing; would need new plumbing)',
  lensFacing: 'DERIVABLE (from the JS scanner\'s own currentFacingMode, already known at capture time -- no new native code)',
  sourceImageResolution: 'PRESENT (Tier-B width/height; Tier-A frameWidth/frameHeight already existed pre-BI-1Z0C)',
  cameraIntrinsics: 'PRESENT (Tier-B fx/fy/cx/cy/imageWidth/imageHeight/space, unchanged since BI-1Z0B)',
  focalLength: 'ABSENT (no physical sensor size is exposed alongside intrinsics; deriving true focal length in mm would need new Camera2 characteristics plumbing)',
  zoomRatio: 'ABSENT (this scanner has no zoom control at all)',
  exposureTime: 'ABSENT (no Camera2 CaptureResult plumbing exists in this pipeline)',
  isoSensitivity: 'ABSENT (same reason)',
  aeState: 'ABSENT (same reason)',
  afState: 'ABSENT (same reason)',
  sensorOrientation: 'ABSENT (not separately tracked; see trackerCoordinateConvention for what IS proven)',
  displayRotation: 'ABSENT (not separately tracked from imageRotationDegrees)',
  imageRotationDegrees: 'PRESENT (Tier-B, unchanged since BI-1Z0B)',
  imageMirrored: 'PRESENT (Tier-B, unchanged since BI-1Z0B)',
  nativeCameraTimestamp: 'PRESENT (nativeTs / nativeFrameTimestampNs)',
  captureLatencyMs: 'PRESENT (Tier-B, unchanged since BI-1Z0B)',
  packetFreshnessAtSample: 'PRESENT (structural guarantee: __a60bScannerTick already requires isNativePacketFresh() before a sample is ever retained -- every persisted Tier-A row was fresh by construction, documented explicitly rather than re-measured)',
  yawPitchRoll: 'PRESENT',
  landmarkConfidence: 'ABSENT (not exposed by ARCore AugmentedFace or the MLKit path used here)',
  geometryConfidence: 'ABSENT (same reason)',
  stableFrames: 'PRESENT (Tier-A, unchanged since BI-1Z0B)',
  qualityOkReason: 'PRESENT (Tier-A, unchanged since BI-1Z0B)',
  readyFormalPose: 'PRESENT (Tier-A, unchanged since BI-1Z0B)',
  currentScannerStep: 'PRESENT',
  observedPoseRegion: 'PRESENT',
  distState: 'PRESENT (DIST-2 diagnostic already computed on every Tier-A sample; BI-1Z0C now passes it through into the durable export)',
  distanceSignal: 'PRESENT (currentRatio, same DIST-2 diagnostic; passed through alongside distState)',
  poseLockState: 'ABSENT (no such concept was found anywhere in the scanner/pose-classifier code)',
  thermalState: 'ABSENT (no PowerManager thermal-status listener exists anywhere in this app)'
});

// Part 7 -- diagnostics intentionally NOT stored (derivable later from what IS captured), to
// avoid bloating the artifact. Listed for documentation/report purposes only.
export const DEFERRED_DERIVED_METRICS = Object.freeze([
  'image blur score (derivable later from the Tier-B JPEG bytes)',
  'highlight clipping / shadow-underexposure score (derivable later from the Tier-B JPEG bytes)',
  'head angular velocity (derivable later from consecutive Tier-A yaw/pitch/roll + nativeFrameTimestampNs)',
  'landmark velocity (derivable later from consecutive Tier-A sparseLandmarks2D + nativeFrameTimestampNs)',
  'frame-gap statistics / dropped-sample timing (derivable later from the full Tier-A nativeFrameTimestampNs sequence)',
  'return-to-start geometry difference (derivable later by comparing Tier-A samples at matching pose/region across a closed-loop motion)'
]);

/**
 * Pure package-shaping function (no DOM, no Blob, no window, never mutates its input). Takes the
 * SAME shape as window.__scannerSpatialRecorder's in-memory state and produces the durable
 * research export object: Tier-B keyframes kept FULL/untouched (Part 4 -- never reduced); Tier-A
 * geometryObs reduced to the sparse jaw/cheek/mouth-reference subset (Part 5) to bound the
 * durable file's size while the live in-session capture itself stays full-fidelity in memory.
 * `deviceMetadata` (Part 5, optional) is recorded ONCE at the top level, not repeated per sample.
 */
export function buildExactFrameResearchPackage(
  { manifest = null, geometryObs = [], imageKeyframes = [], formalCaptureAssociations = [] } = {},
  options = {}
) {
  return Object.freeze({
    exactFrameResearchCaptureVersion: EXACT_FRAME_RESEARCH_CAPTURE_VERSION,
    createdAt: options.createdAt || null,
    deviceMetadata: options.deviceMetadata || null, // PRESENT when the native bridge supplied it; null, never fabricated, otherwise
    manifest,
    coordinateSpaceMetadata: COORDINATE_SPACE_METADATA,
    jawSupportSide: JAW_SUPPORT_SIDE,
    imageKeyframes: Object.freeze(imageKeyframes.map((k) => Object.freeze({ ...k, lensFacing: k.lensFacing ?? null }))), // full, untouched + optional pass-through
    geometryObs: Object.freeze(geometryObs.map((g) => Object.freeze({
      scanSessionId: g.scannerSessionId ?? null, observationId: g.observationId ?? null, nativeFrameTimestampNs: g.nativeTs ?? null,
      currentScannerStep: g.currentScannerStep ?? null, observedPoseRegion: g.observedPoseRegion ?? null,
      yawDeg: g.yawDeg ?? null, pitchDeg: g.pitchDeg ?? null, rollDeg: g.rollDeg ?? null,
      coordinateSpace: 'CAPTURE_NORMALIZED',
      sparseLandmarks2D: extractSparseLandmarks(g.landmarks2D),
      qualityOk: typeof g.qualityOk === 'boolean' ? g.qualityOk : null, qualityReason: g.qualityReason ?? null,
      stableFrames: g.stableFrames ?? null, readyFormalPose: typeof g.readyFormalPose === 'boolean' ? g.readyFormalPose : null,
      // BI-1Z0C Part 6 -- DIST state / distance signal, already computed on the source sample
      // (DIST-2 diagnostics); passed through only when actually present, never invented.
      distState: g.distState ?? null, currentRatio: typeof g.currentRatio === 'number' ? g.currentRatio : null,
      packetFreshAtSample: true // structural guarantee -- see TELEMETRY_INVENTORY.packetFreshnessAtSample
    }))),
    formalCaptureAssociations: Object.freeze(formalCaptureAssociations.map((a) => Object.freeze({ ...a })))
  });
}

/** Fail-closed validation of a built package (never repairs). Returns { ok, errors }. */
export function validateExactFrameResearchPackage(pkg) {
  const errors = [];
  if (!pkg || pkg.exactFrameResearchCaptureVersion !== EXACT_FRAME_RESEARCH_CAPTURE_VERSION) {
    errors.push('missing or wrong exactFrameResearchCaptureVersion');
    return { ok: false, errors };
  }
  (pkg.imageKeyframes || []).forEach((k, i) => {
    if (!Array.isArray(k.landmarks2D)) errors.push(`imageKeyframes[${i}] landmarks2D is not a full array -- Tier-B geometry must never be reduced`);
    if (k.coherenceStatus !== 'VERIFIED_EXACT') errors.push(`imageKeyframes[${i}] coherenceStatus is not VERIFIED_EXACT`);
    if (k.nativeTs == null) errors.push(`imageKeyframes[${i}] missing nativeTs (frame identity)`);
  });
  (pkg.geometryObs || []).forEach((g, i) => {
    if (Array.isArray(g.landmarks2D)) errors.push(`geometryObs[${i}] must not carry a full landmarks2D array in the durable export -- use sparseLandmarks2D`);
    if (!Array.isArray(g.sparseLandmarks2D)) errors.push(`geometryObs[${i}] missing sparseLandmarks2D`);
    else g.sparseLandmarks2D.forEach((p, j) => {
      if (typeof p.index !== 'number') errors.push(`geometryObs[${i}].sparseLandmarks2D[${j}] missing index -- never serialize a coordinate without its landmark index`);
    });
    if (g.coordinateSpace !== 'CAPTURE_NORMALIZED') errors.push(`geometryObs[${i}] missing/incorrect coordinateSpace declaration`);
    if (g.nativeFrameTimestampNs == null) errors.push(`geometryObs[${i}] missing nativeFrameTimestampNs (frame identity)`);
  });
  return { ok: errors.length === 0, errors };
}
