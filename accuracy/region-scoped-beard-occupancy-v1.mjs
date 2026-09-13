// Stage BI-2E -- CONSERVATIVE REGION-SCOPED BEARD OCCUPANCY FUSION V1.
// Reuses (never modifies) BeardEvidencePacketV1 (accuracy/beard-evidence-packet-v1.mjs),
// Hairness Core V1 (accuracy/hairness-core-v1.mjs, frozen decision rule), and the validated
// sparse neck scaffold (accuracy/sparse-neck-scaffold-v1.mjs). Never invents a second evidence
// contract, never retunes Hairness, never infers through UNKNOWN anatomy. This is the FIRST
// skin-surface beard-presence layer only -- no outer envelope, no trim intelligence.

import { EvidenceChannel, SupportStatus, makeEvidenceSignal, makeBeardEvidencePacket, A61_FROZEN_ROI_PROVENANCE, OUT_OF_CALIBRATION_ROI_EXPERIMENT_PROVENANCE } from './beard-evidence-packet-v1.mjs';
import { buildA61JawSideburnROIs, rasterizeA61Polygon, runHairnessCoreV1 } from './hairness-core-v1.mjs';
import { JAW_SUPPORT_RAIL_V1 } from './sparse-neck-scaffold-v1.mjs';

export const OCCUPANCY_V1_VERSION = 'region-scoped-beard-occupancy-v1';

// ---- Part 8: occupancy state vocabulary ---------------------------------------------------
// UNKNOWN_ANATOMY (the surface itself is unsupported) is intentionally NEVER conflated with
// UNCERTAIN (the surface is supported but presence can't be reliably decided).
export const OCCUPANCY_STATES = Object.freeze([
  'BEARD_OCCUPIED_SUPPORTED',
  'VISIBLE_SKIN_SUPPORTED',
  'UNCERTAIN',
  'UNKNOWN_ANATOMY',
  'OCCLUDED',
  'OUTSIDE_SUPPORTED_ANATOMY',
  'CLOTHING_EXCLUDED'
]);

// ---- Part 3/15: per-region eligibility, fixed BEFORE any per-session computation ------------
// JAW_SUPPORT sits on the A6.1 jaw/sideburn ROI Hairness Core V1 is actually calibrated on.
// CHIN_NECK_TRANSITION is anatomically supported (BI-2C/2D) but OUTSIDE that calibration ROI --
// its Hairness reading is descriptive-only, never authoritative, so its state is capped at
// UNCERTAIN. NECK_CLOTHING_MARGIN_AND_BELOW is a hard exclusion. Both mandibular-angle regions
// and both upper-neck regions remain UNKNOWN_ANATOMY, matching BI-2D exactly -- never upgraded.
export const REGION_ELIGIBILITY = Object.freeze({
  JAW_SUPPORT: 'CALIBRATED_HAIRNESS_ELIGIBLE',
  CHIN_NECK_TRANSITION_RAIL: 'SUPPORTED_ANATOMY_UNCALIBRATED_IMAGE_EVIDENCE',
  NECK_CLOTHING_MARGIN_AND_BELOW: 'CLOTHING_EXCLUDED_ZONE',
  RIGHT_MANDIBULAR_ANGLE_UNDERSIDE: 'UNKNOWN_ANATOMY_ZONE',
  LEFT_MANDIBULAR_ANGLE_UNDERSIDE: 'UNKNOWN_ANATOMY_ZONE',
  UPPER_RIGHT_NECK: 'UNKNOWN_ANATOMY_ZONE',
  UPPER_LEFT_NECK: 'UNKNOWN_ANATOMY_ZONE'
});

function classifyHairnessResultToOccupancy(classification) {
  if (classification === 'BEARD_CONFIRMED') return 'BEARD_OCCUPIED_SUPPORTED';
  if (classification === 'NON_BEARD_CONFIRMED') return 'VISIBLE_SKIN_SUPPORTED';
  return 'UNCERTAIN';
}

/** Builds a thin rasterized band polygon around an already-supported curve (e.g. the neck
 *  scaffold's own transition-rail points) -- never a guessed/expanded surface, only the curve's
 *  own immediate neighborhood at a small, fixed, disclosed half-width. */
export function buildCurveBandPolygon(points, halfWidthPx = 8) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const top = [], bottom = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x, dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len; // unit normal
    top.push([p.x + nx * halfWidthPx, p.y + ny * halfWidthPx]);
    bottom.push([p.x - nx * halfWidthPx, p.y - ny * halfWidthPx]);
  }
  return top.concat(bottom.reverse());
}

/** JAW_SUPPORT region occupancy -- the ONE region where Hairness Core V1's own calibration ROI
 *  applies directly. Returns null (not a guess) if the ROI/gray data is unavailable. */
export function classifyJawSupportOccupancy({ faceLocal3D, vmm, intrinsics, gray, w, h }) {
  const polys = buildA61JawSideburnROIs(faceLocal3D, vmm, intrinsics);
  if (!polys) return { occupancyState: 'OCCLUDED', reason: 'ROI_GEOMETRY_UNAVAILABLE', evidence: null };
  const results = {};
  for (const [name, poly] of Object.entries(polys)) {
    const mask = rasterizeA61Polygon(poly, w, h);
    const hr = runHairnessCoreV1(gray, mask, w, h);
    if (!hr) { results[name] = { occupancyState: 'OCCLUDED', reason: 'NO_VALID_ROI_PIXELS' }; continue; }
    results[name] = { occupancyState: classifyHairnessResultToOccupancy(hr.classification), hairness: hr };
  }
  return results;
}

/** CHIN_NECK_TRANSITION_RAIL occupancy -- anatomy IS supported (reused from the neck scaffold's
 *  own GT/inferred curve), but Hairness Core V1's calibration ROI does not cover this band, so
 *  its raw reading is preserved as DESCRIPTIVE evidence only and the resulting state is capped at
 *  UNCERTAIN -- it can NEVER read BEARD_OCCUPIED_SUPPORTED or VISIBLE_SKIN_SUPPORTED from this
 *  signal alone (Part 6: "a positive Hairness result must NOT upgrade an unsupported... region"
 *  -- generalized here to "must not upgrade an uncalibrated reading to authoritative"). */
export function classifyTransitionRegionOccupancy({ transitionRailPoints, gray, w, h }) {
  const poly = buildCurveBandPolygon(transitionRailPoints);
  if (!poly) return { occupancyState: 'OCCLUDED', reason: 'NO_RAIL_GEOMETRY' };
  const mask = rasterizeA61Polygon(poly, w, h);
  const hr = runHairnessCoreV1(gray, mask, w, h);
  if (!hr) return { occupancyState: 'OCCLUDED', reason: 'NO_VALID_ROI_PIXELS' };
  return { occupancyState: 'UNCERTAIN', reason: 'OUT_OF_CALIBRATION_ROI_CAPPED_AT_UNCERTAIN', descriptiveHairness: hr };
}

/** Builds the BeardEvidencePacketV1-wrapped occupancy element for one region, one session, one
 *  frame. Preserves full frame identity and never collapses provenance into one score. */
export function buildOccupancyElement({ scanSessionId, nativeFrameTimestampNs, rawObservationId, coherenceStatus, observedPoseRegion, anatomicalRegion, side, occupancyState, supportGeometryRef, sourceEvidenceSignals, visibility, poseSupport, confidence, limitations }) {
  const packet = makeBeardEvidencePacket({ scanSessionId, nativeFrameTimestampNs, rawObservationId, coherenceStatus, observedPoseRegion });
  return Object.freeze({
    version: OCCUPANCY_V1_VERSION,
    scanSessionId,
    anatomicalRegion,
    side,
    supportGeometryRef,
    occupancyState,
    sourceEvidence: Object.freeze((sourceEvidenceSignals || []).slice()),
    evidencePacket: packet,
    visibility: visibility ?? null,
    poseSupport: poseSupport ?? null,
    confidence: typeof confidence === 'number' && isFinite(confidence) ? confidence : null,
    limitations: Object.freeze((limitations || []).slice())
  });
}

/** Exclusion / unknown-anatomy elements never run any image analysis -- purely categorical,
 *  per the clothing and UNKNOWN firewalls. */
export function buildExclusionElement({ scanSessionId, anatomicalRegion, side, reason }) {
  return Object.freeze({ version: OCCUPANCY_V1_VERSION, scanSessionId, anatomicalRegion, side, occupancyState: 'CLOTHING_EXCLUDED', reason, supportGeometryRef: 'NECK_CLOTHING_SAFETY_MARGIN', sourceEvidence: Object.freeze([makeEvidenceSignal({ channel: EvidenceChannel.EXCLUSION_REGION, supportStatus: SupportStatus.PRIOR, source: 'sparse-neck-scaffold-v1.NECK_CLOTHING_SAFETY_MARGIN', limitations: ['exclusion aid only, never a positive beard boundary'] })]) });
}

export function buildUnknownAnatomyElement({ scanSessionId, anatomicalRegion, side, reason }) {
  return Object.freeze({ version: OCCUPANCY_V1_VERSION, scanSessionId, anatomicalRegion, side, occupancyState: 'UNKNOWN_ANATOMY', reason, supportGeometryRef: null, sourceEvidence: Object.freeze([makeEvidenceSignal({ channel: EvidenceChannel.UNKNOWN, supportStatus: SupportStatus.UNSUPPORTED, source: 'bi2d_neck_scaffold_readiness', limitations: ['anatomy itself unsupported -- no 3D skin attachment point is fabricated'] })]) });
}

export { JAW_SUPPORT_RAIL_V1 };
