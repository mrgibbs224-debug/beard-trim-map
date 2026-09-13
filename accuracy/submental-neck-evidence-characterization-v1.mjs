// Stage BI-2A -- LOCKED-SCANNER SUBMENTAL/NECK EVIDENCE CHARACTERIZATION.
// Pure, read-only research analysis functions over already-captured Exact-Frame Research Capture
// JSON. Does not touch, call, or depend on any scanner runtime code. No scanner timing, no DIST,
// no pose threshold, no burst/whole-scan recorder logic, no Voice Guidance, no V2/GT/occupancy/
// Hairness retraining. Analysis only.

// index.html's own tracked lower-face boundary (mirrors accuracy/annotation-overlay-data.mjs's
// JAW_CHIN_RAIL exactly, and index.html's EXACT_FRAME_JAW_SUPPORT_SIDE for the 5-point subset).
// This is the ACTUAL, code-verified boundary of directly-tracked FACE_SURFACE landmarks nearest
// the neck -- everything anatomically below/behind it is SUBMENTAL_SURFACE/NECK_SURFACE territory
// with NO direct landmark support.
export const JAW_CHIN_RAIL = Object.freeze([172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397]);
export const JAW_SUPPORT_RAIL_V1 = Object.freeze({ 172: 'RIGHT', 149: 'RIGHT', 152: 'CENTER', 378: 'LEFT', 397: 'LEFT' });

export const CURRENT_LOCKED_SCANNER_SCAN_IDS = Object.freeze([
  'scan_mu02bje6_57efla', 'scan_mu02c0cl_13ser3', 'scan_mu02cft9_g7wx30',
  'scan_mu02cunh_395p9e', 'scan_mu02d6gj_yriwo4', 'scan_mu02qcwu_pjfgkc'
]);

export function classifyDatasetCategory(scanSessionId) {
  return CURRENT_LOCKED_SCANNER_SCAN_IDS.includes(scanSessionId) ? 'CURRENT_LOCKED_SCANNER_DATA' : 'OLDER_PRE_LOCK_RESEARCH_DATA';
}

export const SUBMENTAL_REGIONS = Object.freeze([
  'CENTRAL_UNDER_CHIN', 'RIGHT_PARA_CHIN', 'LEFT_PARA_CHIN',
  'RIGHT_UNDER_JAW', 'LEFT_UNDER_JAW',
  'RIGHT_MANDIBULAR_ANGLE_UNDERSIDE', 'LEFT_MANDIBULAR_ANGLE_UNDERSIDE',
  'UPPER_CENTRAL_NECK', 'UPPER_RIGHT_NECK', 'UPPER_LEFT_NECK',
  'CHIN_TO_NECK_TRANSITION'
]);

export const VISIBILITY_STATES = Object.freeze([
  'DIRECTLY_VISIBLE', 'PARTIALLY_VISIBLE', 'OCCLUDED', 'OUT_OF_FRAME',
  'GEOMETRY_SUPPORTED', 'IMAGE_ONLY_SUPPORTED', 'TEMPORALLY_SUPPORTED', 'UNKNOWN'
]);

export const EVIDENCE_CLASSES = Object.freeze([
  'DIRECT_TRACKED', 'DIRECT_MULTIVIEW_IMAGE', 'TEMPORAL_SUPPORT',
  'POSE_CONDITIONED_INFERENCE', 'ANATOMICAL_PRIOR', 'UNKNOWN'
]);

/** Fail-closed classifier: never promotes an inferred/prior region to DIRECT_TRACKED. Requires
 * explicit, positive evidence for every non-UNKNOWN class -- absence of a contradiction is never
 * sufficient. */
export function classifyEvidence(facts) {
  if (!facts || typeof facts !== 'object') return 'UNKNOWN';
  if (facts.hasDirectLandmarkSupport === true) return 'DIRECT_TRACKED';
  if (facts.hasConsistentMultiviewImageCorrespondence === true) return 'DIRECT_MULTIVIEW_IMAGE';
  if (facts.hasReproducibleTemporalResidualSignal === true) return 'TEMPORAL_SUPPORT';
  if (facts.hasPoseConditionedGeometricInference === true) return 'POSE_CONDITIONED_INFERENCE';
  if (facts.hasAnatomicalPriorOnly === true) return 'ANATOMICAL_PRIOR';
  return 'UNKNOWN';
}

function dist3(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

function pointOnLineDistance(p, a, b) {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ap = { x: p.x - a.x, y: p.y - a.y, z: p.z - a.z };
  const abLen = Math.hypot(ab.x, ab.y, ab.z);
  if (abLen < 1e-9) return null;
  const cross = { x: ap.y * ab.z - ap.z * ab.y, y: ap.z * ab.x - ap.x * ab.z, z: ap.x * ab.y - ap.y * ab.x };
  return Math.hypot(cross.x, cross.y, cross.z) / abLen;
}

/** Rotation/translation-invariant shape descriptor of the tracked jaw-chin rail: internal arc
 * length, jaw-corner-to-jaw-corner span, and the chin center's perpendicular offset from the
 * jaw-corner line ("chin droop"). Used to distinguish near-rigid rail behavior from genuine
 * internal (non-rigid) reconfiguration across poses -- never claims anything about untracked
 * neck/submental skin, which this descriptor cannot see at all. */
export function railShape(faceLocal3D) {
  if (!Array.isArray(faceLocal3D)) return null;
  const pts = JAW_CHIN_RAIL.map(i => faceLocal3D[i]);
  if (pts.some(p => !p || typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.z !== 'number')) return null;
  let arcLength = 0;
  for (let i = 1; i < pts.length; i++) arcLength += dist3(pts[i - 1], pts[i]);
  const span = dist3(pts[0], pts[pts.length - 1]);
  const chinCenter = faceLocal3D[152];
  const chinDroop = pointOnLineDistance(chinCenter, pts[0], pts[pts.length - 1]);
  return { arcLength, span, chinDroop, straightness: span > 0 ? arcLength / span : null };
}

export function compareRailShapes(frontShape, chinShape) {
  if (!frontShape || !chinShape) return null;
  return {
    deltaArcLength: chinShape.arcLength - frontShape.arcLength,
    deltaSpan: chinShape.span - frontShape.span,
    deltaChinDroop: chinShape.chinDroop - frontShape.chinDroop,
    deltaStraightness: chinShape.straightness - frontShape.straightness,
    arcLengthPctChange: frontShape.arcLength > 0 ? ((chinShape.arcLength - frontShape.arcLength) / frontShape.arcLength) * 100 : null,
    spanPctChange: frontShape.span > 0 ? ((chinShape.span - frontShape.span) / frontShape.span) * 100 : null
  };
}

export function findFormalCaptureKeyframe(pkg, poseId) {
  const assoc = (pkg.formalCaptureAssociations || []).find(a => a.formalCaptureId === poseId);
  if (!assoc) return null;
  return (pkg.imageKeyframes || []).find(k => k.observationId === assoc.nearestVerifiedTierBObservationId) || null;
}

/** Never claims raw-JPEG pixel coordinates from display-oriented landmarks2D -- the coordinate
 * contract this stage must preserve (Part 2). Returns the correct raw-projection field set for a
 * keyframe, or an explicit unavailable status per field -- never fabricated. */
export function rawProjectionFields(keyframe) {
  if (!keyframe) return { status: 'NO_KEYFRAME' };
  return {
    status: 'OK',
    faceLocal3DAvailable: Array.isArray(keyframe.faceLocal3D) && keyframe.faceLocal3D.length === 468,
    imageSpaceViewModelMatrixAvailable: Array.isArray(keyframe.imageSpaceViewModelMatrix),
    intrinsicsAvailable: !!(keyframe.intrinsics && typeof keyframe.intrinsics.fx === 'number'),
    nativeTimestampAvailable: typeof keyframe.nativeTs === 'string',
    // Explicitly NOT a valid raw-JPEG-pixel source -- display-oriented only.
    landmarks2DIsDisplayOrientedOnly: true
  };
}
