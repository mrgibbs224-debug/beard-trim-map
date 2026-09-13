// Stage BI-2C -- CONSERVATIVE PERSONALIZED NECK SCAFFOLD V1.
// Implements the first sparse, evidence-labeled neck-support geometry recommended (design-only)
// in BI-2B2. Reuses the existing validated jaw rail verbatim -- never re-solves jaw geometry.
// Every emitted element/point carries an explicit authority class; nothing is ever promoted to
// DIRECT_TRACKED without a genuinely tracked source. Fails closed (UNKNOWN/terminated) rather
// than guessing wherever supporting evidence does not exist.

import { JAW_SUPPORT_RAIL_V1, JAW_CHIN_RAIL, CURRENT_LOCKED_SCANNER_SCAN_IDS } from './submental-neck-evidence-characterization-v1.mjs';

export const SCAFFOLD_VERSION = 'sparse-neck-scaffold-v1';

// Reused verbatim from the already-validated BI-2A module -- this module never redefines or
// independently re-derives jaw geometry.
export { JAW_SUPPORT_RAIL_V1, JAW_CHIN_RAIL, CURRENT_LOCKED_SCANNER_SCAN_IDS };

export const AUTHORITY_CLASSES = Object.freeze([
  'DIRECT_TRACKED', 'DIRECT_MULTIVIEW_IMAGE', 'TEMPORAL_SUPPORT',
  'POSE_CONDITIONED_INFERENCE', 'ANATOMICAL_PRIOR', 'UNKNOWN'
]);

// ---------- coordinate helpers (rotation-normalization, shared logic with BI-2B2) ----------

export function rotatePointBack(p, rotationDeg, origW, origH) {
  const rotW = (rotationDeg === 90 || rotationDeg === 270) ? origH : origW;
  const rotH = (rotationDeg === 90 || rotationDeg === 270) ? origW : origH;
  const cx = rotW / 2, cy = rotH / 2;
  const dx = p.x - cx, dy = p.y - cy;
  const rad = (-rotationDeg) * Math.PI / 180;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  return { x: rx + origW / 2, y: ry + origH / 2 };
}

export function curveToRaw(curveDisplay, rotationDeg, origW, origH) {
  return curveDisplay.map(p => rotatePointBack(p, rotationDeg, origW, origH));
}

export function landmarkPx(landmarks2D, idx, width, height) {
  const p = landmarks2D[idx];
  return { x: p.x * width, y: p.y * height };
}

export function polygonCentroid(pts) {
  let x = 0, y = 0;
  pts.forEach(p => { x += p.x; y += p.y; });
  return { x: x / pts.length, y: y / pts.length };
}

export function polygonBounds(pts) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function offsetFromPoint(pointRaw, anchorRaw) {
  return { dx: pointRaw.x - anchorRaw.x, dy: pointRaw.y - anchorRaw.y };
}

export function applyOffset(anchorRaw, offset) {
  return { x: anchorRaw.x + offset.dx, y: anchorRaw.y + offset.dy };
}

/** Averages a list of {dx,dy} offsets (or offset-arrays for a curve) element-wise. Used ONLY to
 * build the cross-session PERSONALIZED template for a single user's own repeated scans -- never
 * used to build a population/universal template, and never used to fabricate an offset when no
 * GT-bearing session contributed one. */
export function averageOffsetCurves(offsetCurves) {
  if (!offsetCurves.length) return null;
  const len = offsetCurves[0].length;
  if (!offsetCurves.every(c => c.length === len)) return null; // fail closed: cannot average curves of differing point counts
  const out = [];
  for (let i = 0; i < len; i++) {
    let dx = 0, dy = 0;
    offsetCurves.forEach(c => { dx += c[i].dx; dy += c[i].dy; });
    out.push({ dx: dx / offsetCurves.length, dy: dy / offsetCurves.length });
  }
  return out;
}

// ---------- deformation model (Part 11) ----------
// Minimum viable per-region blend model: headBlendFactor in [0,1] is the fraction of the
// element's motion that follows the head-relative anchor (tracked landmark) per frame; the
// remainder is treated as anchored to the element's own static image-plane position. This is a
// documented CONSTANT per region (not fit/optimized against any dataset), chosen to be ordered
// consistently with the two real, disclosed pieces of evidence available: (1) the BI-2A finding
// that geometry anchored directly to the tracked jaw rail is near-rigid, and (2) the BI-2B2
// temporal finding that, in a hold-phase/low-motion regime, NECK_CANDIDATE (mean
// safeResidualRatioV2 1.340) was less static-dominated than CLOTHING_CONTROL (1.736). Per BI-2B2
// Part 9, these ratios are used here ONLY as directional, qualitative support for an ordering of
// blend strength -- never as a fitted numeric threshold and never to classify new geometry.
export const DEFORMATION_PARAMS = Object.freeze({
  CHIN_NECK_TRANSITION_RAIL: {
    headBlendFactor: 0.6,
    evidenceBasis: 'TEMPORAL_SUPPORT (qualitative, non-fitted): BI-2B2 measured NECK_CANDIDATE as the least static-favoring of the two real (non-reference) families (mean ratio 1.340 vs CLOTHING_CONTROL 1.736); a moderate-high (not full, not fitted) blend reflects real-but-partial, hold-phase-only support.',
    fitted: false
  },
  UNDER_JAW_LATERAL_RAIL: {
    headBlendFactor: 0.8,
    evidenceBasis: 'ANATOMICAL_PRIOR: no temporal measurement exists for this family. Anchored close to the directly-tracked jaw rail (landmarks 172/397 region per side), so a high default (still short of fully rigid 1.0) reflects anatomical proximity to a near-rigid tracked structure, not a measurement.',
    fitted: false
  },
  NECK_CLOTHING_SAFETY_MARGIN: {
    headBlendFactor: 0.15,
    evidenceBasis: 'TEMPORAL_SUPPORT (qualitative, non-fitted): BI-2B2 measured CLOTHING_CONTROL as the most static-favoring family (93% of pairs, mean ratio 1.736) -- the lowest head-coupling of any component, directly and disclosedly reflecting that measured separation without converting it into a runtime classifier threshold.',
    fitted: false
  },
  MANDIBULAR_ANGLE_CONNECTOR: {
    headBlendFactor: null,
    evidenceBasis: 'No positive evidence exists (BI-2B2: LARGE_UNKNOWN). No deformation confidence is assigned; if emitted at all this element is topology-only and must not be used as a trim/measurement authority.',
    fitted: false
  }
});

// ---------- scaffold element builders ----------

/** Builds the CHIN_NECK_TRANSITION_RAIL for one session. If ownGtCurveRaw is provided (this
 * session directly contributed Chin-Up GT), the rail is the verbatim human curve
 * (DIRECT_MULTIVIEW_IMAGE). Otherwise it is reconstructed by applying the cross-session
 * personalized offset template to this session's OWN tracked landmark 152 position
 * (POSE_CONDITIONED_INFERENCE) -- never a population/universal template, never fabricated from
 * nothing. */
export function buildTransitionRail({ sessionId, ownGtCurveRaw, personalizedOffsetTemplate, anchorLandmark152Raw, anchorLandmark152FaceLocal3D, sourceEvidence }) {
  const hasOwnGt = Array.isArray(ownGtCurveRaw) && ownGtCurveRaw.length > 1;
  const points = hasOwnGt ? ownGtCurveRaw : (personalizedOffsetTemplate ? personalizedOffsetTemplate.map(o => applyOffset(anchorLandmark152Raw, o)) : null);
  if (!points) {
    return { anatomicalRegion: 'CHIN_TO_NECK_TRANSITION', side: 'CENTER', supportType: 'CHIN_NECK_TRANSITION_RAIL', authorityClass: 'UNKNOWN', status: 'NO_SUPPORT_NO_TEMPLATE', points: null };
  }
  return {
    scaffoldVersion: SCAFFOLD_VERSION,
    anatomicalRegion: 'CHIN_TO_NECK_TRANSITION',
    side: 'CENTER',
    supportType: 'CHIN_NECK_TRANSITION_RAIL',
    position: { points, coordinateSpace: 'RAW_JPEG_PIXEL_2D' },
    anchor: { landmark: 152, rawPx: anchorLandmark152Raw, faceLocal3D: anchorLandmark152FaceLocal3D || null, authorityClass: 'DIRECT_TRACKED' },
    authorityClass: hasOwnGt ? 'DIRECT_MULTIVIEW_IMAGE' : 'POSE_CONDITIONED_INFERENCE',
    confidence: hasOwnGt ? 0.85 : 0.45,
    visibilityState: hasOwnGt ? 'DIRECTLY_VISIBLE' : 'IMAGE_ONLY_SUPPORTED',
    poseCondition: 'CHINUP',
    sourceEvidence: sourceEvidence || [],
    deformationBehavior: DEFORMATION_PARAMS.CHIN_NECK_TRANSITION_RAIL,
    limitations: hasOwnGt
      ? ['boundary below/lateral to the GT curve remains UNKNOWN_OCCLUSION_MASK per the source annotation', 'derived from a single annotated pose (Chin-Up) only']
      : ['this session did NOT contribute its own Chin-Up neck GT curve -- reconstructed from the cross-session personalized template anchored to this session\'s own landmark 152; lower confidence than a directly-annotated session'],
    excludedFromAnatomicalClaims: ['beard edge', 'natural neckline', 'trim line', 'outer beard silhouette']
  };
}

/** Builds one side's UNDER_JAW_LATERAL_RAIL for one session, following the same own-GT-vs-
 * personalized-template pattern as the transition rail. */
export function buildLateralRail({ sessionId, side, ownGtCurveRaw, personalizedOffsetTemplate, anchorLandmarkIdx, anchorLandmarkRaw, anchorLandmarkFaceLocal3D, sourceEvidence }) {
  const hasOwnGt = Array.isArray(ownGtCurveRaw) && ownGtCurveRaw.length > 1;
  const points = hasOwnGt ? ownGtCurveRaw : (personalizedOffsetTemplate ? personalizedOffsetTemplate.map(o => applyOffset(anchorLandmarkRaw, o)) : null);
  if (!points) {
    return { anatomicalRegion: side === 'RIGHT' ? 'RIGHT_UNDER_JAW' : 'LEFT_UNDER_JAW', side, supportType: 'UNDER_JAW_LATERAL_RAIL', authorityClass: 'UNKNOWN', status: 'NO_SUPPORT_NO_TEMPLATE', points: null };
  }
  return {
    scaffoldVersion: SCAFFOLD_VERSION,
    anatomicalRegion: side === 'RIGHT' ? 'RIGHT_UNDER_JAW' : 'LEFT_UNDER_JAW',
    side,
    supportType: 'UNDER_JAW_LATERAL_RAIL',
    position: { points, coordinateSpace: 'RAW_JPEG_PIXEL_2D' },
    anchor: { landmark: anchorLandmarkIdx, rawPx: anchorLandmarkRaw, faceLocal3D: anchorLandmarkFaceLocal3D || null, authorityClass: 'DIRECT_TRACKED' },
    authorityClass: hasOwnGt ? 'DIRECT_MULTIVIEW_IMAGE' : 'POSE_CONDITIONED_INFERENCE',
    confidence: hasOwnGt ? 0.8 : 0.4,
    visibilityState: hasOwnGt ? 'PARTIALLY_VISIBLE' : 'IMAGE_ONLY_SUPPORTED',
    poseCondition: side === 'RIGHT' ? 'RIGHT_PROFILE' : 'LEFT_PROFILE',
    sourceEvidence: sourceEvidence || [],
    deformationBehavior: DEFORMATION_PARAMS.UNDER_JAW_LATERAL_RAIL,
    limitations: hasOwnGt
      ? ['single-pose (profile) evidence only -- no temporal support was measured for this family this stage']
      : [`this session did NOT contribute its own ${side}-profile under-jaw GT curve -- reconstructed from the cross-session personalized template`],
    doesNotExtendInto: ['dense beard occlusion region', 'the mandibular-angle underside (see mandibular-angle connector policy)']
  };
}

/** Mandibular-angle handling: BI-2B2 found both mandibular-angle-underside regions LARGE_UNKNOWN.
 * Per instruction, discontinuity is preferred over fake certainty. This function is provided for
 * topology completeness but returns a terminated/UNKNOWN result UNLESS forceEmitWeakConnector is
 * explicitly set, in which case it returns a minimal, clearly ANATOMICAL_PRIOR-labeled stub -- it
 * never returns anything resembling DIRECT_TRACKED or DIRECT_MULTIVIEW_IMAGE. */
export function buildMandibularAngleConnector({ side, railEndpointRaw, forceEmitWeakConnector = false }) {
  if (!forceEmitWeakConnector) {
    return { anatomicalRegion: side === 'RIGHT' ? 'RIGHT_MANDIBULAR_ANGLE_UNDERSIDE' : 'LEFT_MANDIBULAR_ANGLE_UNDERSIDE', side, supportType: 'MANDIBULAR_ANGLE_CONNECTOR', authorityClass: 'UNKNOWN', status: 'TERMINATED_NO_SUPPORT', points: null };
  }
  return {
    scaffoldVersion: SCAFFOLD_VERSION,
    anatomicalRegion: side === 'RIGHT' ? 'RIGHT_MANDIBULAR_ANGLE_UNDERSIDE' : 'LEFT_MANDIBULAR_ANGLE_UNDERSIDE',
    side,
    supportType: 'MANDIBULAR_ANGLE_CONNECTOR',
    position: { points: [railEndpointRaw], coordinateSpace: 'RAW_JPEG_PIXEL_2D' },
    authorityClass: 'ANATOMICAL_PRIOR',
    confidence: 0.1,
    visibilityState: 'UNKNOWN',
    poseCondition: side === 'RIGHT' ? 'RIGHT_PROFILE' : 'LEFT_PROFILE',
    deformationBehavior: DEFORMATION_PARAMS.MANDIBULAR_ANGLE_CONNECTOR,
    limitations: ['LARGE_UNKNOWN region per BI-2B2 -- this is a topology-only stub, never an authoritative geometry or trim/measurement surface'],
    isTopologyStubOnly: true
  };
}

/** NECK_CLOTHING_SAFETY_MARGIN: an exclusion boundary, NOT a positive anatomical claim. Per Part 8,
 * this must NEVER promote the human GT polygon's own closing edge (a drawing-tool artifact) into
 * anatomy -- it is deliberately placed an additional, disclosed margin below/beyond the polygon's
 * own extent. */
export function buildClothingSafetyMargin({ sessionId, ownPolygonBoundsRaw, personalizedMarginOffsetTemplate, anchorLandmark152Raw, sourceEvidence, marginFactor = 0.6 }) {
  let marginPointRaw;
  let hasOwnGt = !!ownPolygonBoundsRaw;
  if (ownPolygonBoundsRaw) {
    const polyHeight = ownPolygonBoundsRaw.maxY - ownPolygonBoundsRaw.minY;
    marginPointRaw = { x: (ownPolygonBoundsRaw.minX + ownPolygonBoundsRaw.maxX) / 2, y: ownPolygonBoundsRaw.maxY + polyHeight * marginFactor };
  } else if (personalizedMarginOffsetTemplate) {
    marginPointRaw = applyOffset(anchorLandmark152Raw, personalizedMarginOffsetTemplate);
  } else {
    return { anatomicalRegion: 'UPPER_CENTRAL_NECK', side: 'CENTER', supportType: 'NECK_CLOTHING_SAFETY_MARGIN', authorityClass: 'UNKNOWN', status: 'NO_SUPPORT_NO_TEMPLATE', points: null };
  }
  return {
    scaffoldVersion: SCAFFOLD_VERSION,
    anatomicalRegion: 'UPPER_CENTRAL_NECK',
    side: 'CENTER',
    supportType: 'NECK_CLOTHING_SAFETY_MARGIN',
    position: { points: [marginPointRaw], coordinateSpace: 'RAW_JPEG_PIXEL_2D' },
    anchor: { landmark: 152, rawPx: anchorLandmark152Raw, authorityClass: 'DIRECT_TRACKED' },
    authorityClass: hasOwnGt ? 'TEMPORAL_SUPPORT' : 'POSE_CONDITIONED_INFERENCE',
    confidence: hasOwnGt ? 0.55 : 0.3,
    visibilityState: 'IMAGE_ONLY_SUPPORTED',
    poseCondition: 'CHINUP',
    sourceEvidence: sourceEvidence || [],
    deformationBehavior: DEFORMATION_PARAMS.NECK_CLOTHING_SAFETY_MARGIN,
    isExclusionBoundaryNotPositiveAnatomy: true,
    explicitNote: 'This margin is placed BEYOND the human GT polygon\'s own closing edge (which is only a drawing-tool convenience, never treated here as an anatomical boundary). It exists to prevent scaffold expansion into clothing/collar/clavicle/shoulder/chest, per the clothing firewall.',
    limitations: ['coarse, single-scan-family-derived margin -- not a precise clothing-detection boundary', 'should be re-validated per-user during any future calibration stage']
  };
}

/** Assembles one session's full scaffold from its already-built elements. Never pools sessions
 * together -- callers must call this once per session and keep results as a per-session array. */
export function assembleSessionScaffold({ sessionId, transitionRail, rightLateralRail, leftLateralRail, clothingMargin, rightMandibularConnector, leftMandibularConnector }) {
  return {
    scaffoldVersion: SCAFFOLD_VERSION,
    scanSessionId: sessionId,
    elements: {
      CHIN_NECK_TRANSITION_RAIL: transitionRail,
      RIGHT_UNDER_JAW_LATERAL_RAIL: rightLateralRail,
      LEFT_UNDER_JAW_LATERAL_RAIL: leftLateralRail,
      NECK_CLOTHING_SAFETY_MARGIN: clothingMargin,
      RIGHT_MANDIBULAR_ANGLE_CONNECTOR: rightMandibularConnector,
      LEFT_MANDIBULAR_ANGLE_CONNECTOR: leftMandibularConnector
    },
    jawRailReused: { JAW_SUPPORT_RAIL_V1, note: 'reused verbatim from accuracy/submental-neck-evidence-characterization-v1.mjs -- never re-solved' }
  };
}
