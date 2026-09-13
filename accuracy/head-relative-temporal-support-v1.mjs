// Stage BI-1Z1J -- HEAD_RELATIVE_TEMPORAL_SUPPORT_V1 patch experiment. Implements the frozen
// BI-1Z1I design (D:\MettleTemp\analysis\bi1z1i_head_relative_temporal_support_v1_design.json,
// SHA256 246aa40f52eeadb3990e34f9efeabbc1c2ff706cc7e996bd326d8fbe9fea7f9a). Measures descriptive,
// uncalibrated temporal-appearance distributions ONLY -- never a beard/shirt classifier, never a
// probability/confidence field, never V1/V2/V2.1/V2.2 input, never GT. Reuses, unmodified:
// accuracy/hairness-core-v1.mjs (a61ProjectPoint), accuracy/beard-anatomy-map.mjs (BS1 anchors),
// accuracy/exact-frame-research-capture.mjs (verified landmark index sets),
// accuracy/exact-frame-jaw-beard-measurement.mjs (outwardJawNormal, visibilityClass),
// accuracy/temporal-feasibility-audit.mjs (pair-eligibility classifiers, angle math).
'use strict';
import { a61ProjectPoint } from './hairness-core-v1.mjs';
import { anatomyMapEntry } from './beard-anatomy-map.mjs';
import { JAW_SUPPORT_INDICES, JAW_SUPPORT_SIDE, MOUTH_REFERENCE } from './exact-frame-research-capture.mjs';
import { outwardJawNormal, visibilityClass } from './exact-frame-jaw-beard-measurement.mjs';
import { angleDeltaDeg, isFiniteMatrix16, auditGeometryCompleteness, classifyHeadStabilizationPair, classifyOverlapFeasibility } from './temporal-feasibility-audit.mjs';

export const HEAD_RELATIVE_TEMPORAL_SUPPORT_V1_VERSION = 'head-relative-temporal-support-v1/1';
export const BI1Z1I_DESIGN_SHA256 = '246aa40f52eeadb3990e34f9efeabbc1c2ff706cc7e996bd326d8fbe9fea7f9a';

// ---- FROZEN PARAMETERS (Part 4/8/15 -- fixed before any physical result is examined) -----------
export const PARAMETERS = Object.freeze({
  patchWidthFactor: 0.10, minPatchSizePx: 10, maxPatchSizePx: 80,
  searchRadiusFactor: 0.5, minSearchRadiusPx: 4, maxSearchRadiusPx: 24,
  distalDistanceFactors: Object.freeze([1, 2, 3]),
  // NOTE: an initial draft reused V2.2's backgroundOuterBoundFactor=4.0 / torso factors [3,4.5,6]
  // without re-deriving them for this stage's own geometry. V2.2's 4.0x was calibrated for an
  // attachment-GRAPH reachability bound (a different purpose, a different scale target); in this
  // 640x480 frame, with a real tracked face typically spanning jawSpanPx~130-160px, 4.0x (520-
  // 640px) exceeds the image diagonal entirely -- NO pixel in the frame ever qualified as
  // "background," and 3x-6x below the chin always fell outside the 480px-tall frame, so
  // BACKGROUND_CONTROL/TORSO_CONTROL_CANDIDATE silently produced zero candidates on every real
  // sample. Caught via non-GT geometric smoke-testing (jawSpanPx/frame-size arithmetic only, no
  // appearance or beard/shirt data) before this manifest was frozen; corrected to values that
  // actually fit a 640x480 frame with this capture's real face scale.
  backgroundOuterBoundFactor: 1.5,
  torsoDistanceFactors: Object.freeze([1.0, 1.5, 2.0]),
  motionBinSmallMaxDeg: 8, motionBinMediumMaxDeg: 20
});

function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function isFiniteVec3(p) { return !!p && isFiniteNum(p.x) && isFiniteNum(p.y) && isFiniteNum(p.z); }

// ---- rigid-transform matrix inverse (Part: back-projection for untracked candidates) -----------
// Column-major 4x4, index = col*4+row (the ONE verified convention in this codebase --
// hairness-core-v1.mjs's a61MatMulVec / BI-1Z1H.1's COORDINATE_SPACE_FINDINGS). vmm is a pure
// rigid rotation+translation (BI-1Z1H.1 measured determinant~=1.0 in every real sample), so its
// inverse is the exact analytic rigid inverse (R^T, -R^T*T) -- not a general cofactor inverse.
function invertRigidVmm(m) {
  const R = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]];
  const T = [m[12], m[13], m[14]];
  const Rt = [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]];
  const Tinv = [-(Rt[0][0] * T[0] + Rt[0][1] * T[1] + Rt[0][2] * T[2]), -(Rt[1][0] * T[0] + Rt[1][1] * T[1] + Rt[1][2] * T[2]), -(Rt[2][0] * T[0] + Rt[2][1] * T[1] + Rt[2][2] * T[2])];
  return [Rt[0][0], Rt[1][0], Rt[2][0], 0, Rt[0][1], Rt[1][1], Rt[2][1], 0, Rt[0][2], Rt[1][2], Rt[2][2], 0, Tinv[0], Tinv[1], Tinv[2], 1];
}
function matMulVec4(m, v) {
  const out = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) { let sum = 0; for (let col = 0; col < 4; col++) sum += m[col * 4 + row] * v[col]; out[row] = sum; }
  return out;
}
/** Inverse of a61ProjectPoint: given a RAW pixel (u,v) and an ASSUMED positive depth (Zcv), and
 *  this frame's own vmm+intrinsics, recovers the head-relative faceLocal3D point that would
 *  project there. Used ONLY to give untracked candidates (DISTAL/BACKGROUND/TORSO) a synthetic,
 *  honestly-disclosed "as if rigidly head-attached" 3D anchor for the H_HEAD_RELATIVE hypothesis
 *  -- never presented as real tracked anatomy or a true depth estimate. */
export function backProjectToFaceLocal(u, v, assumedZcv, vmm, intrinsics) {
  const Xcv = (u - intrinsics.cx) * assumedZcv / intrinsics.fx;
  const Ycv = (v - intrinsics.cy) * assumedZcv / intrinsics.fy;
  const camSpace = [Xcv, -Ycv, -assumedZcv, 1]; // inverts a61ProjectPoint's Xcv=cs[0],Ycv=-cs[1],Zcv=-cs[2]
  const vmmInv = invertRigidVmm(vmm);
  const fl = matMulVec4(vmmInv, camSpace);
  return { x: fl[0], y: fl[1], z: fl[2] };
}

// ---- raw-image-space rail/interior geometry (Part 1 -- NEVER landmarks2D) -----------------------
/** Builds the SAME {index, side, x, y} shape outwardJawNormal() expects, but in RAW IMAGE pixel
 *  space via the authoritative a61ProjectPoint chain -- never via landmarks2D/jawRailImagePoints
 *  (which are display-space). outwardJawNormal itself is reused completely unmodified; only its
 *  INPUT coordinate space differs from its original (display-space) caller. */
export function rawRailPoints(faceLocal3D, vmm, intrinsics) {
  return JAW_SUPPORT_INDICES.map(idx => {
    if (!isValidLandmarkArray(faceLocal3D) || !isFiniteVec3(faceLocal3D[idx])) return null;
    const proj = a61ProjectPoint(vmm, intrinsics, faceLocal3D[idx]);
    return proj ? { index: idx, side: JAW_SUPPORT_SIDE[idx], x: proj.u, y: proj.v, z: proj.z } : null;
  });
}
export function rawFaceInteriorReference(faceLocal3D, vmm, intrinsics) {
  let sx = 0, sy = 0, n = 0;
  MOUTH_REFERENCE.forEach(idx => {
    if (!isValidLandmarkArray(faceLocal3D) || !isFiniteVec3(faceLocal3D[idx])) return;
    const proj = a61ProjectPoint(vmm, intrinsics, faceLocal3D[idx]);
    if (proj) { sx += proj.u; sy += proj.v; n++; }
  });
  return n ? { x: sx / n, y: sy / n, sourceCount: n } : null;
}
function isValidLandmarkArray(arr) { return Array.isArray(arr) && arr.length === 468; }
export function rawJawSpanPx(faceLocal3D, vmm, intrinsics) {
  const rail = rawRailPoints(faceLocal3D, vmm, intrinsics);
  if (!rail[0] || !rail[4]) return null;
  return Math.hypot(rail[0].x - rail[4].x, rail[0].y - rail[4].y);
}

// ---- Part 3 -- patch family / anchor definitions -------------------------------------------------
export const HEAD_REFERENCE_INDICES = Object.freeze([6, 151, 144, 373, 105, 334]);
export const ROOT_ANCHOR_INDICES = Object.freeze([172, 149, 152, 378, 397]);
// BS1-supported lower-cheek primaryIndex points, read-only reference (not importing beard-anatomy-
// map's full region-support machinery -- only its already-verified primaryIndex values).
const LEFT_LOWER_CHEEK_PRIMARY = anatomyMapEntry('LEFT_LOWER_CHEEK');
const RIGHT_LOWER_CHEEK_PRIMARY = anatomyMapEntry('RIGHT_LOWER_CHEEK');
export function rootAnchorList() {
  const list = ROOT_ANCHOR_INDICES.map(idx => ({ index: idx, side: JAW_SUPPORT_SIDE[idx] || 'CENTER', region: null }));
  if (LEFT_LOWER_CHEEK_PRIMARY) list.push({ index: LEFT_LOWER_CHEEK_PRIMARY.primaryIndex, side: 'LEFT', region: 'LEFT_LOWER_CHEEK' });
  if (RIGHT_LOWER_CHEEK_PRIMARY) list.push({ index: RIGHT_LOWER_CHEEK_PRIMARY.primaryIndex, side: 'RIGHT', region: 'RIGHT_LOWER_CHEEK' });
  return list;
}

/** Builds every candidate for every one of the 5 patch families for ONE sample, in raw image
 *  pixel space, via the authoritative chain only. Each candidate carries: id, family, rawPosA
 *  {x,y}, a real OR synthetic head-relative 3D anchor (for H_HEAD_RELATIVE prediction), and
 *  honest provenance tags. */
export function buildCandidatesForSample(sample, manifest = PARAMETERS) {
  const { faceLocal3D, imageSpaceViewModelMatrix: vmm, intrinsics, imageWidth: w, imageHeight: h } = sample;
  if (!isValidLandmarkArray(faceLocal3D) || !isFiniteMatrix16(vmm) || !intrinsics || !w || !h) return null;
  const jawSpanPx = rawJawSpanPx(faceLocal3D, vmm, intrinsics);
  if (!(jawSpanPx > 0)) return null;
  const railPoints = rawRailPoints(faceLocal3D, vmm, intrinsics);
  const interior = rawFaceInteriorReference(faceLocal3D, vmm, intrinsics);
  const chinProj = a61ProjectPoint(vmm, intrinsics, faceLocal3D[152]);
  const candidates = [];

  // A. HEAD_REFERENCE -- real tracked 3D anchors
  HEAD_REFERENCE_INDICES.forEach(idx => {
    if (!isFiniteVec3(faceLocal3D[idx])) return;
    const proj = a61ProjectPoint(vmm, intrinsics, faceLocal3D[idx]);
    if (!proj) return;
    candidates.push({ id: 'HEAD_REFERENCE_' + idx, family: 'HEAD_REFERENCE', anatomicalIndex: idx, anatomicalSide: null, region: null, rawPosA: { x: proj.u, y: proj.v }, trackedFaceLocal3D: faceLocal3D[idx], provenanceTags: ['TRACKED_3D_SUPPORTED'], usesRollCorrection: false });
  });

  // B. BEARD_ROOT_CANDIDATE -- real tracked 3D anchors (jaw rail + BS1 lower-cheek)
  rootAnchorList().forEach(a => {
    if (!isFiniteVec3(faceLocal3D[a.index])) return;
    const proj = a61ProjectPoint(vmm, intrinsics, faceLocal3D[a.index]);
    if (!proj) return;
    candidates.push({ id: 'BEARD_ROOT_' + a.index, family: 'BEARD_ROOT_CANDIDATE', anatomicalIndex: a.index, anatomicalSide: a.side, region: a.region, rawPosA: { x: proj.u, y: proj.v }, trackedFaceLocal3D: faceLocal3D[a.index], provenanceTags: ['TRACKED_3D_SUPPORTED'], usesRollCorrection: true });
  });

  // C. DISTAL_LOWER_FACE_ENVELOPE_CANDIDATE -- image-space ray from each root anchor, synthetic 3D anchor via back-projection
  const railIdxOf = idx => JAW_SUPPORT_INDICES.indexOf(idx);
  ROOT_ANCHOR_INDICES.forEach(idx => {
    const railIdx = railIdxOf(idx);
    const normal = outwardJawNormal(railPoints, railIdx, interior); // REUSED UNMODIFIED, fed raw-image-space input
    const rootProj = a61ProjectPoint(vmm, intrinsics, faceLocal3D[idx]);
    if (!normal || !rootProj) return;
    manifest.distalDistanceFactors.forEach(factor => {
      const rawPosA = { x: rootProj.u + normal.x * factor * jawSpanPx, y: rootProj.v + normal.y * factor * jawSpanPx };
      if (rawPosA.x < 0 || rawPosA.x >= w || rawPosA.y < 0 || rawPosA.y >= h) return; // out of bounds this frame -- not offered as a candidate at all
      const synthetic3D = backProjectToFaceLocal(rawPosA.x, rawPosA.y, rootProj.z, vmm, intrinsics);
      candidates.push({ id: 'DISTAL_' + idx + '_x' + factor, family: 'DISTAL_LOWER_FACE_ENVELOPE_CANDIDATE', anatomicalIndex: idx, anatomicalSide: JAW_SUPPORT_SIDE[idx] || 'CENTER', region: null, rawPosA, trackedFaceLocal3D: synthetic3D, provenanceTags: ['DERIVED_FROM_ROOT_RAY', 'IMAGE_SPACE_CANDIDATE', 'GEOMETRY_UNKNOWN'], usesRollCorrection: true });
    });
  });

  // D. BACKGROUND_CONTROL -- frame corners/edge-midpoints beyond the outer bound. margin is
  // adaptive (not a fixed 4px) -- a candidate placed closer to the edge than half its own patch
  // size plus the search radius can never be extracted at all (OUT_OF_BOUNDS by construction),
  // caught via geometric smoke-testing before this manifest was frozen, not via any appearance data.
  if (chinProj) {
    const provisionalPatchSizePx = computePatchSizePx(jawSpanPx, manifest);
    const margin = Math.ceil(provisionalPatchSizePx / 2 + computeSearchRadiusPx(provisionalPatchSizePx, manifest) + 2);
    const corners = [{ x: margin, y: margin }, { x: w - margin, y: margin }, { x: margin, y: h - margin }, { x: w - margin, y: h - margin }, { x: w / 2, y: margin }];
    corners.forEach((c, i) => {
      const distFromAnyRail = Math.min(...railPoints.filter(Boolean).map(r => Math.hypot(r.x - c.x, r.y - c.y)));
      if (!(distFromAnyRail > manifest.backgroundOuterBoundFactor * jawSpanPx)) return; // too close to tracked head -- not offered
      const synthetic3D = backProjectToFaceLocal(c.x, c.y, chinProj.z, vmm, intrinsics);
      candidates.push({ id: 'BACKGROUND_' + i, family: 'BACKGROUND_CONTROL', anatomicalIndex: null, anatomicalSide: null, region: null, rawPosA: c, trackedFaceLocal3D: synthetic3D, provenanceTags: ['PRIOR'], usesRollCorrection: false });
    });
  }

  // E. TORSO_CONTROL_CANDIDATE -- below-chin image-space points at multiple jawSpan-scaled distances
  if (chinProj) {
    manifest.torsoDistanceFactors.forEach((factor, i) => {
      const rawPosA = { x: chinProj.u, y: chinProj.v + factor * jawSpanPx };
      if (rawPosA.y < 0 || rawPosA.y >= h || rawPosA.x < 0 || rawPosA.x >= w) return;
      const synthetic3D = backProjectToFaceLocal(rawPosA.x, rawPosA.y, chinProj.z, vmm, intrinsics);
      candidates.push({ id: 'TORSO_x' + factor, family: 'TORSO_CONTROL_CANDIDATE', anatomicalIndex: null, anatomicalSide: null, region: null, rawPosA, trackedFaceLocal3D: synthetic3D, provenanceTags: ['PRIOR'], usesRollCorrection: false });
    });
  }

  const patchSizePx = computePatchSizePx(jawSpanPx, manifest);
  candidates.forEach(c => { c._patchSizePx = patchSizePx; });
  return { candidates, jawSpanPx, patchSizePx };
}

// ---- Part 4/8 -- scale ------------------------------------------------------------------------
export function computePatchSizePx(jawSpanPx, manifest = PARAMETERS) {
  return Math.max(manifest.minPatchSizePx, Math.min(manifest.maxPatchSizePx, manifest.patchWidthFactor * jawSpanPx));
}
export function computeSearchRadiusPx(patchSizePx, manifest = PARAMETERS) {
  return Math.max(manifest.minSearchRadiusPx, Math.min(manifest.maxSearchRadiusPx, manifest.searchRadiusFactor * patchSizePx));
}

// ---- Part 5 -- deterministic grayscale patch extraction ----------------------------------------
/** Bilinear interpolation, TOP-LEFT pixel-center convention (pixel (x,y)'s value is sampled at
 *  integer coordinate (x,y); a query at a non-integer coordinate interpolates its 4 neighbors).
 *  Never wraps/clamps at the border -- returns null if any of the 4 neighbors is out of bounds
 *  (Part 5/15: PATCH_UNUSABLE, never a silent clamp). */
function bilinearSample(gray, w, h, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = x0 + 1, y1 = y0 + 1;
  if (x0 < 0 || y0 < 0 || x1 > w - 1 || y1 > h - 1) return null;
  const fx = x - x0, fy = y - y0;
  const v00 = gray[y0 * w + x0], v10 = gray[y0 * w + x1], v01 = gray[y1 * w + x0], v11 = gray[y1 * w + x1];
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}
/** Extracts a patchSizePx x patchSizePx grayscale patch centered at `center`, rotated by
 *  `rotationDeg` (clockwise, raw image coordinates), via bilinear interpolation. Returns
 *  {values:Float64Array, unusable:false} or {unusable:true, reason}. Grid points are sampled at
 *  integer offsets from -floor(size/2) to +ceil(size/2)-1 in the ROTATED local frame, then mapped
 *  back to raw coordinates before sampling -- documented rounding: patchSizePx is rounded to the
 *  nearest integer once per sample (Math.round), never re-rounded per pixel. */
export function extractPatch(gray, w, h, center, patchSizePx, rotationDeg = 0) {
  const size = Math.round(patchSizePx);
  if (!(size >= 2)) return { unusable: true, reason: 'PATCH_SIZE_TOO_SMALL' };
  if (!isFiniteNum(center.x) || !isFiniteNum(center.y)) return { unusable: true, reason: 'GEOMETRY_MISSING' };
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const half0 = -Math.floor(size / 2), half1 = Math.ceil(size / 2) - 1;
  const values = new Float64Array(size * size);
  let idx = 0;
  for (let ly = half0; ly <= half1; ly++) {
    for (let lx = half0; lx <= half1; lx++) {
      const rx = center.x + (lx * cos - ly * sin);
      const ry = center.y + (lx * sin + ly * cos);
      const v = bilinearSample(gray, w, h, rx, ry);
      if (v == null) return { unusable: true, reason: 'OUT_OF_BOUNDS' };
      values[idx++] = v;
    }
  }
  return { unusable: false, values, size };
}

// ---- Part 7 -- appearance metrics ---------------------------------------------------------------
function mean(arr) { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i]; return s / arr.length; }
/** Zero-mean normalized cross-correlation. Returns null (METRIC_DEGENERATE) rather than fabricating
 *  a value on a constant (zero-variance) patch, where ZNCC is mathematically undefined (0/0). */
export function zncc(a, b) {
  if (a.length !== b.length || a.length === 0) return null;
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { const xa = a[i] - ma, xb = b[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}
export function normalizedSad(a, b) {
  if (a.length !== b.length || a.length === 0) return null;
  let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / (a.length * 255);
}
export function normalizedSsd(a, b) {
  if (a.length !== b.length || a.length === 0) return null;
  let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return s / (a.length * 255 * 255);
}
/** Sobel-gradient-magnitude field of a size*size patch (values assumed row-major), then ZNCC on
 *  the gradient fields -- illumination-robust (Part 9): a flat/smooth brightness shift contributes
 *  near-zero gradient change. */
export function sobelGradientMagnitude(values, size) {
  const out = new Float64Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const gx = (v => v)(sample(x + 1, y) - sample(x - 1, y));
    const gy = sample(x, y + 1) - sample(x, y - 1);
    out[y * size + x] = Math.hypot(gx, gy);
  }
  function sample(x, y) { const cx = Math.max(0, Math.min(size - 1, x)), cy = Math.max(0, Math.min(size - 1, y)); return values[cy * size + cx]; }
  return out;
}
export function gradientZncc(a, aSize, b, bSize) {
  if (aSize !== bSize) return null;
  return zncc(sobelGradientMagnitude(a, aSize), sobelGradientMagnitude(b, bSize));
}

// ---- Part 8 -- local translation search ---------------------------------------------------------
/** Searches integer-pixel translations within +/-searchRadiusPx of `predictedCenter` for the
 *  offset maximizing ZNCC against `referencePatch` (extracted at frame A). Returns the best score,
 *  best (dx,dy) relative to predictedCenter, and residual magnitude. Never penalizes a nonzero
 *  residual -- it is reported descriptively (Part 8's explicit instruction). */
export function localTranslationSearch(grayB, w, h, predictedCenter, rotationDeg, patchSizePx, referencePatch, searchRadiusPx) {
  const r = Math.round(searchRadiusPx);
  let best = null;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const center = { x: predictedCenter.x + dx, y: predictedCenter.y + dy };
      const candidate = extractPatch(grayB, w, h, center, patchSizePx, rotationDeg);
      if (candidate.unusable) continue;
      const score = zncc(referencePatch.values, candidate.values);
      if (score == null) continue;
      if (!best || score > best.score) best = { score, dx, dy, gradScore: gradientZncc(referencePatch.values, referencePatch.size, candidate.values, candidate.size), sad: normalizedSad(referencePatch.values, candidate.values), ssd: normalizedSsd(referencePatch.values, candidate.values) };
    }
  }
  if (!best) return { unusable: true, reason: 'METRIC_DEGENERATE' };
  return { unusable: false, bestZncc: best.score, bestGradientZncc: best.gradScore, bestSad: best.sad, bestSsd: best.ssd, bestResidualDx: best.dx, bestResidualDy: best.dy, bestResidualMagnitude: Math.hypot(best.dx, best.dy) };
}

// ---- Part 15/16 -- quality states, motion bins, visibility ---------------------------------------
export const QUALITY_STATES = Object.freeze(['PATCH_USABLE', 'PATCH_UNUSABLE', 'PAIR_INELIGIBLE', 'LOW_TEXTURE', 'METRIC_DEGENERATE', 'OUT_OF_BOUNDS', 'GEOMETRY_MISSING']);
export function motionBin(combinedDeg, manifest = PARAMETERS) {
  if (combinedDeg <= manifest.motionBinSmallMaxDeg) return 'SMALL';
  if (combinedDeg <= manifest.motionBinMediumMaxDeg) return 'MEDIUM';
  return 'LARGE';
}
export function isLowTexture(values, minStdDev = 3) {
  const m = mean(values); let variance = 0; for (let i = 0; i < values.length; i++) variance += (values[i] - m) ** 2; variance /= values.length;
  return Math.sqrt(variance) < minStdDev;
}

// ---- Part 6 -- roll-corrected local frame (ROOT/DISTAL only, per BI-1Z1I scopeOfApplication) ----
function rollCorrectionDeg(sampleA, sampleB, usesRollCorrection) {
  if (!usesRollCorrection) return 0;
  if (!isFiniteNum(sampleA.rollDeg) || !isFiniteNum(sampleB.rollDeg)) return 0;
  return -angleDeltaDeg(sampleA.rollDeg, sampleB.rollDeg); // counter-rotate the frame-B extraction by the roll DELTA
}

// ---- Part 9 -- full per-candidate, per-hypothesis evaluation for one pair -----------------------
/** Evaluates ONE candidate across BOTH H_HEAD_RELATIVE and H_STATIC_IMAGE hypotheses for one
 *  consecutive pair (sampleA, sampleB). Every family is treated with the IDENTICAL procedure
 *  (Part 0's explicit anti-circularity clarification) -- only the candidate's own PREDICTION
 *  differs by construction (real tracked 3D for A/B families, synthetic back-projected 3D for
 *  C/D/E), never the evaluation logic itself. */
export function evaluateCandidatePair(candA, grayA, grayB, w, h, sampleA, sampleB, manifest = PARAMETERS) {
  const patchSizePx = candA._patchSizePx;
  const searchRadiusPx = computeSearchRadiusPx(patchSizePx, manifest);
  const referencePatch = extractPatch(grayA, w, h, candA.rawPosA, patchSizePx, 0);
  if (referencePatch.unusable) return { id: candA.id, family: candA.family, qualityState: 'PATCH_UNUSABLE', reason: referencePatch.reason };
  if (isLowTexture(referencePatch.values)) return { id: candA.id, family: candA.family, qualityState: 'LOW_TEXTURE' };

  const rollDelta = rollCorrectionDeg(sampleA, sampleB, candA.usesRollCorrection);

  // H_HEAD_RELATIVE: reproject the (real or synthetic) 3D anchor through frame B's own vmm/intrinsics
  const projB = a61ProjectPoint(sampleB.imageSpaceViewModelMatrix, sampleB.intrinsics, candA.trackedFaceLocal3D);
  const headPredicted = projB ? { x: projB.u, y: projB.v } : null;
  // H_STATIC_IMAGE: identical raw pixel position, no motion, no rotation
  const staticPredicted = { x: candA.rawPosA.x, y: candA.rawPosA.y };

  const headResult = headPredicted ? localTranslationSearch(grayB, w, h, headPredicted, rollDelta, patchSizePx, referencePatch, searchRadiusPx) : { unusable: true, reason: 'GEOMETRY_MISSING' };
  const staticResult = localTranslationSearch(grayB, w, h, staticPredicted, 0, patchSizePx, referencePatch, searchRadiusPx);

  return {
    id: candA.id, family: candA.family, anatomicalIndex: candA.anatomicalIndex, anatomicalSide: candA.anatomicalSide, region: candA.region,
    provenanceTags: candA.provenanceTags, qualityState: 'PATCH_USABLE', patchSizePx, searchRadiusPx,
    rawImageCenterA: candA.rawPosA, headPredictedCenterB: headPredicted, staticPredictedCenterB: staticPredicted,
    headHypothesis: headResult.unusable ? { unusable: true, reason: headResult.reason } : { unusable: false, zncc: headResult.bestZncc, gradientZncc: headResult.bestGradientZncc, sad: headResult.bestSad, ssd: headResult.bestSsd, bestResidualDx: headResult.bestResidualDx, bestResidualDy: headResult.bestResidualDy, bestResidualMagnitude: headResult.bestResidualMagnitude },
    staticHypothesis: staticResult.unusable ? { unusable: true, reason: staticResult.reason } : { unusable: false, zncc: staticResult.bestZncc, gradientZncc: staticResult.bestGradientZncc, sad: staticResult.bestSad, ssd: staticResult.bestSsd, bestResidualDx: staticResult.bestResidualDx, bestResidualDy: staticResult.bestResidualDy, bestResidualMagnitude: staticResult.bestResidualMagnitude },
    znccHeadMinusStatic: (!headResult.unusable && !staticResult.unusable) ? headResult.bestZncc - staticResult.bestZncc : null,
    gradientZnccHeadMinusStatic: (!headResult.unusable && !staticResult.unusable) ? headResult.bestGradientZncc - staticResult.bestGradientZncc : null,
    residualMagHeadMinusStatic: (!headResult.unusable && !staticResult.unusable) ? headResult.bestResidualMagnitude - staticResult.bestResidualMagnitude : null
  };
}

// ---- Part 6/12 -- pair eligibility (reuses temporal-feasibility-audit.mjs unmodified) -----------
export function pairEligibility(sampleA, sampleB) {
  const reasons = [];
  if (sampleA.coherenceStatus !== 'VERIFIED_EXACT' || sampleB.coherenceStatus !== 'VERIFIED_EXACT') reasons.push('NOT_VERIFIED_EXACT');
  const geomA = auditGeometryCompleteness([sampleA]), geomB = auditGeometryCompleteness([sampleB]);
  if (geomA.completeSampleCount === 0) reasons.push('SAMPLE_A_GEOMETRY_INCOMPLETE');
  if (geomB.completeSampleCount === 0) reasons.push('SAMPLE_B_GEOMETRY_INCOMPLETE');
  const stabilization = classifyHeadStabilizationPair(sampleA, sampleB);
  if (stabilization.verdict === 'HEAD_STABILIZATION_PAIR_UNUSABLE') reasons.push('HEAD_STABILIZATION_UNUSABLE');
  const overlap = classifyOverlapFeasibility(sampleA, sampleB);
  if (overlap.tier === 'LOW') reasons.push('LOW_OVERLAP_FEASIBILITY');
  return { eligible: reasons.length === 0, reasons, stabilization, overlap };
}
