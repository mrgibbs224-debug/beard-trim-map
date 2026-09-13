// Stage BI-1Z1H -- pure, testable analysis primitives for the temporal feasibility audit. Reads
// an already-captured TEMPORAL_EXACT_FRAME_BURST_V1 package (Stage BI-1Z1G) and computes capture-
// QUALITY diagnostics only: timestamp/cadence statistics, image/geometry completeness, matrix
// sanity, consecutive head-transform/local-motion metrics, tracked-anchor temporal stability, a
// geometry-only stabilization residual check, and overlap-feasibility/head-stabilization-pair
// classifications. Never optical flow, never motion/beard/shirt classification, never GT, never
// V1/V2/V2.1/V2.2 (Part 11/18 of this stage; verified by this module's own tests). Imports
// a61ProjectPoint read-only from the frozen accuracy/hairness-core-v1.mjs for the ONE well-
// evidenced matrix convention in this codebase (column-major 4x4, index = col*4+row, per
// hairness-core-v1.mjs's a61MatMulVec) -- never re-derives or guesses a different convention.
'use strict';
import { a61ProjectPoint } from './hairness-core-v1.mjs';

export const TEMPORAL_FEASIBILITY_AUDIT_VERSION = 'temporal-feasibility-audit/1';

// Jaw-rail / stable lower-face anchors already used throughout this project's exact-frame
// pipeline (JAW_SUPPORT_RAIL_ORDER, EXACT_FRAME_JAW_SUPPORT_SIDE) -- reused verbatim, not invented.
export const STABLE_LOWER_FACE_ANCHORS = Object.freeze([172, 149, 152, 378, 397]);

// ---- Part 3: timestamp/cadence -------------------------------------------------------------
function toBigIntNs(v) { try { return typeof v === 'bigint' ? v : BigInt(v); } catch (_e) { return null; } }

/** Diagnostics only, never pass/fail. Percentiles use nearest-rank on the sorted interval list. */
export function auditTimestamps(samples) {
  const nsList = samples.map(s => toBigIntNs(s.nativeFrameTimestampNs));
  let duplicates = 0, backward = 0, monotonic = true;
  const intervalsMs = [];
  for (let i = 1; i < nsList.length; i++) {
    const a = nsList[i - 1], b = nsList[i];
    if (a == null || b == null) continue;
    if (b === a) { duplicates++; monotonic = false; continue; }
    if (b < a) { backward++; monotonic = false; continue; }
    intervalsMs.push(Number(b - a) / 1e6);
  }
  const sorted = [...intervalsMs].sort((x, y) => x - y);
  const pct = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null;
  return {
    sampleCount: samples.length,
    strictlyMonotonic: monotonic,
    duplicateTimestampCount: duplicates,
    backwardTimestampCount: backward,
    intervalCount: intervalsMs.length,
    mean: intervalsMs.length ? intervalsMs.reduce((s, v) => s + v, 0) / intervalsMs.length : null,
    p50: pct(0.50), p90: pct(0.90), p95: pct(0.95),
    max: sorted.length ? sorted[sorted.length - 1] : null,
    min: sorted.length ? sorted[0] : null,
    countAbove200ms: intervalsMs.filter(v => v > 200).length,
    countAbove250ms: intervalsMs.filter(v => v > 250).length,
    countAbove500ms: intervalsMs.filter(v => v > 500).length,
    firstToLastDurationMs: (nsList.length && nsList[0] != null && nsList[nsList.length - 1] != null) ? Number(nsList[nsList.length - 1] - nsList[0]) / 1e6 : null
  };
}

// ---- Part 4: image consistency -------------------------------------------------------------
/** Lightweight JPEG structural check without a decode library: verifies the SOI (0xFFD8) and EOI
 *  (0xFFD9) markers are present at the expected ends of the decoded byte stream. This is a
 *  necessary, not sufficient, condition for "decodes successfully" -- an honest proxy given this
 *  project's pure-Node/no-canvas testing environment (the same constraint every prior stage in
 *  this project has worked under), not a claim of full JPEG validation. */
export function looksLikeValidJpeg(dataUrl) {
  if (typeof dataUrl !== 'string') return false;
  const m = dataUrl.match(/^data:image\/jpeg;base64,(.+)$/);
  if (!m) return false;
  let buf;
  try { buf = Buffer.from(m[1], 'base64'); } catch (_e) { return false; }
  if (buf.length < 4) return false;
  const soiOk = buf[0] === 0xFF && buf[1] === 0xD8;
  const eoiOk = buf[buf.length - 2] === 0xFF && buf[buf.length - 1] === 0xD9;
  return soiOk && eoiOk;
}

export function auditImageConsistency(samples) {
  const widths = new Set(), heights = new Set(), lensFacings = new Set();
  let missingImage = 0, corruptImage = 0, zeroLength = 0;
  let rotationAvailable = 0, mirroredAvailable = 0, displayRotationAvailable = 0, sensorOrientationAvailable = 0;
  samples.forEach(s => {
    if (!s.dataUrl) { missingImage++; return; }
    if (s.dataUrl.length === 0) { zeroLength++; return; }
    if (!looksLikeValidJpeg(s.dataUrl)) corruptImage++;
    if (s.imageWidth) widths.add(s.imageWidth);
    if (s.imageHeight) heights.add(s.imageHeight);
    if (s.lensFacing) lensFacings.add(s.lensFacing);
    if (typeof s.imageRotationDegrees === 'number') rotationAvailable++;
    if (typeof s.imageMirrored === 'boolean') mirroredAvailable++;
    if (typeof s.displayRotationDegrees === 'number') displayRotationAvailable++;
    if (typeof s.sensorOrientationDegrees === 'number') sensorOrientationAvailable++;
  });
  return {
    sampleCount: samples.length, missingImageCount: missingImage, zeroLengthCount: zeroLength, corruptImageCount: corruptImage,
    dimensionsConsistent: widths.size <= 1 && heights.size <= 1,
    observedWidths: [...widths], observedHeights: [...heights],
    lensFacingConsistent: lensFacings.size <= 1, observedLensFacings: [...lensFacings],
    orientationMetadataAvailability: {
      imageRotationDegrees: { availableCount: rotationAvailable, nullCount: samples.length - rotationAvailable },
      imageMirrored: { availableCount: mirroredAvailable, nullCount: samples.length - mirroredAvailable },
      displayRotationDegrees: { availableCount: displayRotationAvailable, nullCount: samples.length - displayRotationAvailable },
      sensorOrientationDegrees: { availableCount: sensorOrientationAvailable, nullCount: samples.length - sensorOrientationAvailable }
    }
  };
}

// ---- Part 5: geometry completeness ----------------------------------------------------------
function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function isFiniteVec3(p) { return !!p && isFiniteNum(p.x) && isFiniteNum(p.y) && isFiniteNum(p.z); }
function isValidLandmarkArray(arr) { return Array.isArray(arr) && arr.length === 468; }
export function isFiniteMatrix16(m) { return Array.isArray(m) && m.length === 16 && m.every(isFiniteNum); }

export function auditGeometryCompleteness(samples) {
  const missing = { landmarks2D: 0, faceLocal3D: 0, intrinsics: 0, imageSpaceViewModelMatrix: 0, transformationMatrix: 0, yawDeg: 0, pitchDeg: 0, rollDeg: 0 };
  const malformed = { landmarks2D: 0, faceLocal3D: 0, intrinsics: 0, imageSpaceViewModelMatrix: 0, transformationMatrix: 0 };
  let nonFiniteAngleCount = 0, completeSampleCount = 0, landmarkCountMismatch = 0;
  samples.forEach(s => {
    let complete = true;
    if (!isValidLandmarkArray(s.landmarks2D)) { missing.landmarks2D++; complete = false; if (Array.isArray(s.landmarks2D) && s.landmarks2D.length !== 468) landmarkCountMismatch++; }
    else if (!s.landmarks2D.every(p => p == null || isFiniteVec3(p))) { malformed.landmarks2D++; complete = false; }
    if (!isValidLandmarkArray(s.faceLocal3D)) { missing.faceLocal3D++; complete = false; if (Array.isArray(s.faceLocal3D) && s.faceLocal3D.length !== 468) landmarkCountMismatch++; }
    else if (!s.faceLocal3D.every(p => isFiniteVec3(p))) { malformed.faceLocal3D++; complete = false; }
    if (!s.intrinsics || !isFiniteNum(s.intrinsics.fx) || !isFiniteNum(s.intrinsics.fy) || !isFiniteNum(s.intrinsics.cx) || !isFiniteNum(s.intrinsics.cy)) { missing.intrinsics++; complete = false; }
    if (s.imageSpaceViewModelMatrix == null) { missing.imageSpaceViewModelMatrix++; complete = false; }
    else if (!isFiniteMatrix16(s.imageSpaceViewModelMatrix)) { malformed.imageSpaceViewModelMatrix++; complete = false; }
    if (s.transformationMatrix == null) { missing.transformationMatrix++; complete = false; }
    else if (!isFiniteMatrix16(s.transformationMatrix)) { malformed.transformationMatrix++; complete = false; }
    if (!isFiniteNum(s.yawDeg)) { missing.yawDeg++; nonFiniteAngleCount++; complete = false; }
    if (!isFiniteNum(s.pitchDeg)) { missing.pitchDeg++; nonFiniteAngleCount++; complete = false; }
    if (!isFiniteNum(s.rollDeg)) { missing.rollDeg++; nonFiniteAngleCount++; complete = false; }
    if (complete) completeSampleCount++;
  });
  return { sampleCount: samples.length, completeSampleCount, missingFieldCounts: missing, malformedFieldCounts: malformed, nonFiniteAngleCount, landmarkCountMismatchCount: landmarkCountMismatch };
}

// ---- Part 6: matrix sanity (column-major 4x4, index = col*4+row, per hairness-core-v1.mjs) --
function get(m, row, col) { return m[col * 4 + row]; }
/** Standard cofactor-expansion 4x4 determinant, reading the matrix via the SAME column-major
 *  convention as a61MatMulVec. */
export function determinant4x4(m) {
  const a = (r, c) => get(m, r, c);
  const det3 = (a1, a2, a3, b1, b2, b3, c1, c2, c3) => a1 * (b2 * c3 - b3 * c2) - a2 * (b1 * c3 - b3 * c1) + a3 * (b1 * c2 - b2 * c1);
  let det = 0;
  for (let col = 0; col < 4; col++) {
    const sign = (col % 2 === 0) ? 1 : -1;
    const minorCols = [0, 1, 2, 3].filter(c => c !== col);
    const minor = det3(
      a(1, minorCols[0]), a(1, minorCols[1]), a(1, minorCols[2]),
      a(2, minorCols[0]), a(2, minorCols[1]), a(2, minorCols[2]),
      a(3, minorCols[0]), a(3, minorCols[1]), a(3, minorCols[2])
    );
    det += sign * a(0, col) * minor;
  }
  return det;
}
export function matrixSanity(m, singularEps = 1e-9, explosionThreshold = 1e6) {
  if (!isFiniteMatrix16(m)) return { finite: false, determinant: null, singular: null, extremeValues: null };
  const det = determinant4x4(m);
  const maxAbs = Math.max(...m.map(Math.abs));
  return { finite: true, determinant: det, singular: Math.abs(det) < singularEps, extremeValues: maxAbs > explosionThreshold, maxAbsValue: maxAbs };
}

// ---- Part 7/8: consecutive transforms, local angular motion -------------------------------
/** Shortest signed angular difference in degrees, wrapped to (-180, 180] -- Part 20's "angle
 *  wrapping" requirement. A naive subtraction would misreport e.g. 179 -> -179 as a 358 deg jump. */
export function angleDeltaDeg(a, b) {
  let d = b - a;
  d = ((d + 180) % 360 + 360) % 360 - 180;
  return d;
}
export function consecutiveTransform(sampleA, sampleB) {
  const tsA = toBigIntNs(sampleA.nativeFrameTimestampNs), tsB = toBigIntNs(sampleB.nativeFrameTimestampNs);
  const deltaTimeMs = (tsA != null && tsB != null) ? Number(tsB - tsA) / 1e6 : null;
  const haveAngles = isFiniteNum(sampleA.yawDeg) && isFiniteNum(sampleB.yawDeg) && isFiniteNum(sampleA.pitchDeg) && isFiniteNum(sampleB.pitchDeg) && isFiniteNum(sampleA.rollDeg) && isFiniteNum(sampleB.rollDeg);
  const relativeTransformAvailable = !!(sampleA.imageSpaceViewModelMatrix && sampleB.imageSpaceViewModelMatrix && isFiniteMatrix16(sampleA.imageSpaceViewModelMatrix) && isFiniteMatrix16(sampleB.imageSpaceViewModelMatrix));
  const yawDelta = haveAngles ? angleDeltaDeg(sampleA.yawDeg, sampleB.yawDeg) : null;
  const pitchDelta = haveAngles ? angleDeltaDeg(sampleA.pitchDeg, sampleB.pitchDeg) : null;
  const rollDelta = haveAngles ? angleDeltaDeg(sampleA.rollDeg, sampleB.rollDeg) : null;
  const angularSpeedDegPerSec = (haveAngles && deltaTimeMs && deltaTimeMs > 0) ? Math.hypot(yawDelta, pitchDelta, rollDelta) / (deltaTimeMs / 1000) : null;
  return { deltaTimeMs, relativeTransformAvailable, yawDelta, pitchDelta, rollDelta, angularSpeedDegPerSec };
}

function percentileOf(sortedArr, p) { return sortedArr.length ? sortedArr[Math.min(sortedArr.length - 1, Math.ceil(p * sortedArr.length) - 1)] : null; }
export function summarizeAbsDistribution(values) {
  const abs = values.filter(isFiniteNum).map(Math.abs).sort((a, b) => a - b);
  return { median: percentileOf(abs, 0.5), p90: percentileOf(abs, 0.9), max: abs.length ? abs[abs.length - 1] : null, count: abs.length };
}

// ---- Part 9/11: tracked-anchor temporal stability + geometry-only stabilization residual ---
/** Per-anchor Euclidean residual (faceLocal3D units, meters per this pipeline's own documented
 *  convention) between consecutive samples -- a rigid anatomical landmark's HEAD-RELATIVE (already
 *  canonical, pose-invariant by construction) position should stay nearly constant frame-to-frame
 *  regardless of actual head rotation; a large residual signals a tracker jump/reset rather than
 *  real anatomy moving. This uses ONLY tracked landmarks -- no image evidence, no GT, no V2.1/V2.2. */
export function faceLocalAnchorResidual(sampleA, sampleB, anchors = STABLE_LOWER_FACE_ANCHORS) {
  if (!isValidLandmarkArray(sampleA.faceLocal3D) || !isValidLandmarkArray(sampleB.faceLocal3D)) return null;
  const residuals = {};
  anchors.forEach(idx => {
    const pa = sampleA.faceLocal3D[idx], pb = sampleB.faceLocal3D[idx];
    residuals[idx] = (isFiniteVec3(pa) && isFiniteVec3(pb)) ? Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z) : null;
  });
  const valid = Object.values(residuals).filter(isFiniteNum);
  return { residuals, meanResidual: valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null, maxResidual: valid.length ? Math.max(...valid) : null };
}

/** Intra-frame consistency: reproject a stable anchor's OWN faceLocal3D through its OWN frame's
 *  vmm+intrinsics and compare to the recorded landmarks2D pixel position for that same index --
 *  validates that vmm/intrinsics/faceLocal3D/landmarks2D are mutually coherent within one sample
 *  (Part 6/11), using the existing, frozen, unmodified a61ProjectPoint. */
export function intraFrameReprojectionResidualPx(sample, anchors = STABLE_LOWER_FACE_ANCHORS) {
  if (!isValidLandmarkArray(sample.faceLocal3D) || !isValidLandmarkArray(sample.landmarks2D) || !sample.intrinsics || !isFiniteMatrix16(sample.imageSpaceViewModelMatrix)) return null;
  const w = sample.imageWidth, h = sample.imageHeight;
  if (!w || !h) return null;
  const residuals = {};
  anchors.forEach(idx => {
    const p3 = sample.faceLocal3D[idx], p2 = sample.landmarks2D[idx];
    if (!isFiniteVec3(p3) || !p2 || !isFiniteNum(p2.x) || !isFiniteNum(p2.y)) { residuals[idx] = null; return; }
    const proj = a61ProjectPoint(sample.imageSpaceViewModelMatrix, sample.intrinsics, p3);
    if (!proj) { residuals[idx] = null; return; }
    residuals[idx] = Math.hypot(proj.u - p2.x * w, proj.v - p2.y * h);
  });
  const valid = Object.values(residuals).filter(isFiniteNum);
  return { residuals, meanResidualPx: valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null, maxResidualPx: valid.length ? Math.max(...valid) : null, validCount: valid.length };
}

// ---- Part 10: head-stabilization pair classification (reason-coded, not an accuracy claim) --
export const HEAD_STABILIZATION_PARAMETERS = Object.freeze({
  maxUsableAnchorResidualM: 0.006,   // ~6mm -- generous vs. ARCore's own reported face-tracking jitter
  degradedAnchorResidualM: 0.015,    // 6-15mm -- degraded but still usable with caution
  maxUsableDeltaTimeMs: 400,         // beyond this, treat as too sparse for a "consecutive" pair
  maxUsableAngularSpeedDegPerSec: 400 // extreme angular speed suggests a tracker glitch, not real motion
});
export function classifyHeadStabilizationPair(sampleA, sampleB, params = HEAD_STABILIZATION_PARAMETERS) {
  const reasons = [];
  if (sampleA.coherenceStatus !== 'VERIFIED_EXACT' || sampleB.coherenceStatus !== 'VERIFIED_EXACT') reasons.push('NOT_VERIFIED_EXACT');
  const geomA = auditGeometryCompleteness([sampleA]), geomB = auditGeometryCompleteness([sampleB]);
  if (geomA.completeSampleCount === 0) reasons.push('SAMPLE_A_GEOMETRY_INCOMPLETE');
  if (geomB.completeSampleCount === 0) reasons.push('SAMPLE_B_GEOMETRY_INCOMPLETE');
  const transform = consecutiveTransform(sampleA, sampleB);
  if (transform.deltaTimeMs == null || transform.deltaTimeMs <= 0) reasons.push('INVALID_DELTA_TIME');
  else if (transform.deltaTimeMs > params.maxUsableDeltaTimeMs) reasons.push('DELTA_TIME_TOO_LARGE');
  if (!transform.relativeTransformAvailable) reasons.push('RELATIVE_TRANSFORM_UNAVAILABLE');
  if (transform.angularSpeedDegPerSec != null && transform.angularSpeedDegPerSec > params.maxUsableAngularSpeedDegPerSec) reasons.push('ANGULAR_SPEED_IMPLAUSIBLE');
  const anchorResidual = faceLocalAnchorResidual(sampleA, sampleB);
  let residualTier = 'UNKNOWN';
  if (anchorResidual && anchorResidual.maxResidual != null) {
    if (anchorResidual.maxResidual <= params.maxUsableAnchorResidualM) residualTier = 'GOOD';
    else if (anchorResidual.maxResidual <= params.degradedAnchorResidualM) residualTier = 'DEGRADED';
    else { residualTier = 'BAD'; reasons.push('ANCHOR_RESIDUAL_TOO_LARGE'); }
  } else { reasons.push('ANCHOR_RESIDUAL_UNAVAILABLE'); }

  let verdict;
  if (reasons.some(r => ['NOT_VERIFIED_EXACT', 'SAMPLE_A_GEOMETRY_INCOMPLETE', 'SAMPLE_B_GEOMETRY_INCOMPLETE', 'INVALID_DELTA_TIME', 'RELATIVE_TRANSFORM_UNAVAILABLE', 'ANCHOR_RESIDUAL_TOO_LARGE', 'ANCHOR_RESIDUAL_UNAVAILABLE'].includes(r))) verdict = 'HEAD_STABILIZATION_PAIR_UNUSABLE';
  else if (reasons.length > 0 || residualTier === 'DEGRADED') verdict = 'HEAD_STABILIZATION_PAIR_DEGRADED';
  else verdict = 'HEAD_STABILIZATION_PAIR_USABLE';
  return { verdict, reasons, transform, anchorResidual, residualTier };
}

// ---- Part 12: overlap feasibility (geometry-only, no optical flow, no GT) ------------------
export const OVERLAP_FEASIBILITY_PARAMETERS = Object.freeze({
  highMaxCombinedDeg: 8,     // |dYaw|+|dPitch| <= this -> HIGH
  moderateMaxCombinedDeg: 20 // <= this -> MODERATE, else LOW
});
/** Rule: combined local yaw+pitch angular motion between consecutive frames is a geometry-only
 *  proxy for how much lower-face image content two adjacent frames plausibly still share (roll is
 *  excluded -- an in-plane rotation does not itself remove content from the frame the way yaw/
 *  pitch, which change the camera's viewing angle onto the 3D face surface, does). This is
 *  disclosed as a documented heuristic, not derived from or tuned against GT/optical flow. */
export function classifyOverlapFeasibility(sampleA, sampleB, params = OVERLAP_FEASIBILITY_PARAMETERS) {
  const t = consecutiveTransform(sampleA, sampleB);
  if (t.yawDelta == null || t.pitchDelta == null) return { tier: 'LOW', combinedDeg: null, reason: 'ANGLES_UNAVAILABLE' };
  const combined = Math.abs(t.yawDelta) + Math.abs(t.pitchDelta);
  const tier = combined <= params.highMaxCombinedDeg ? 'HIGH' : (combined <= params.moderateMaxCombinedDeg ? 'MODERATE' : 'LOW');
  return { tier, combinedDeg: combined, reason: 'COMBINED_YAW_PITCH_DELTA' };
}

// ---- Burst-level aggregation (Part 2/13) ---------------------------------------------------
export function buildBurstSummary(burst) {
  const allExact = burst.samples.every(s => s.coherenceStatus === 'VERIFIED_EXACT');
  return {
    burstId: burst.burstId, sourceTransition: burst.sourceTransition,
    startObservedPoseRegion: burst.startObservedPoseRegion, endObservedPoseRegion: burst.endObservedPoseRegion,
    sampleCount: burst.sampleCount, exactCoherenceCount: burst.samples.filter(s => s.coherenceStatus === 'VERIFIED_EXACT').length,
    allSamplesVerifiedExact: allExact,
    skippedCount: burst.skippedCount, stopReason: burst.endReason,
    actualDurationMs: burst.actualDurationMs, requestedTargetIntervalMs: burst.requestedTargetIntervalMs,
    meanSampleIntervalMs: burst.meanSampleIntervalMs, medianSampleIntervalMs: burst.medianSampleIntervalMs,
    minSampleIntervalMs: burst.minSampleIntervalMs, maxSampleIntervalMs: burst.maxSampleIntervalMs
  };
}

/** Part 13 -- burst verdict from capture-quality signals ONLY (never beard/shirt performance). */
export function classifyBurstFeasibility(burst, pairClassifications, overlapClassifications) {
  const n = burst.samples.length;
  if (n < 2) return { verdict: 'UNUSABLE', reason: 'FEWER_THAN_2_SAMPLES' };
  const usableFrac = pairClassifications.filter(p => p.verdict === 'HEAD_STABILIZATION_PAIR_USABLE').length / pairClassifications.length;
  const degradedFrac = pairClassifications.filter(p => p.verdict === 'HEAD_STABILIZATION_PAIR_DEGRADED').length / pairClassifications.length;
  const highOverlapFrac = overlapClassifications.filter(o => o.tier === 'HIGH').length / overlapClassifications.length;
  const lowOverlapFrac = overlapClassifications.filter(o => o.tier === 'LOW').length / overlapClassifications.length;
  let verdict;
  if (usableFrac >= 0.9 && highOverlapFrac >= 0.6 && n >= 8) verdict = 'EXCELLENT';
  else if (usableFrac >= 0.7 && lowOverlapFrac < 0.3) verdict = 'USABLE';
  else if (usableFrac >= 0.4 || degradedFrac >= 0.3) verdict = 'MARGINAL';
  else verdict = 'UNUSABLE';
  return { verdict, usableFrac, degradedFrac, highOverlapFrac, lowOverlapFrac, sampleCount: n };
}
