// Stage BI-1Z1H.1 -- pure, testable coordinate-space reconciliation primitives. Determines the
// exact relationship among landmarks2D, faceLocal3D, imageSpaceViewModelMatrix,
// transformationMatrix, intrinsics, and the raw captured JPEG, using ONLY the semantics documented
// in the actual native source (android/app/src/main/java/com/beardtrimmap/app/
// ArCoreFaceMeshTracker.kt and SpatialKeyframe.kt) -- never inferred from field naming alone.
// Reuses a61ProjectPoint read-only from the frozen hairness-core-v1.mjs (the same, already-
// verified raw-image projection the recovered A61 Hairness pipeline has used successfully this
// whole project). Never optical flow, never GT, never V1/V2/V2.1/V2.2, never a motion classifier.
'use strict';
import { a61ProjectPoint } from './hairness-core-v1.mjs';
import { SPARSE_TIER_A_INDICES } from './exact-frame-research-capture.mjs';

export const PROJECTION_RECONCILIATION_VERSION = 'projection-reconciliation/1';

// ---- Part 2/3/4/5/6: documented source semantics (verbatim source references) -----------------
export const COORDINATE_SPACE_FINDINGS = Object.freeze({
  landmarks2D: {
    space: 'DISPLAY_ORIENTED_NDC_NORMALIZED',
    sourceRef: 'ArCoreFaceMeshTracker.kt lines 59-60 (camera.getProjectionMatrix/getViewMatrix), 104-114 (modelViewProjectionMatrix = projectionMatrix * viewMatrix * modelMatrix), 137-145 (Matrix.multiplyMV then NDC-to-[0,1] with Y-flip)',
    finding: 'landmarks2D = (modelViewProjectionMatrix * faceLocal3D_point), homogeneous-divided, mapped from NDC [-1,1] to [0,1] with a Y-flip. camera.getViewMatrix() is ARCore\'s DISPLAY-ORIENTED view (its own javadoc: equivalent to getDisplayOrientedPose().inverse()), and the projection matrix includes the app\'s own FOV/aspect and (per SpatialKeyframe.kt line 44) the front-camera mirror flip. This is the SAME space the on-screen face-mesh overlay uses -- NOT the raw camera/JPEG buffer\'s own pixel space.'
  },
  jpeg: {
    space: 'RAW_UNROTATED_UNMIRRORED_SENSOR_BUFFER',
    sourceRef: 'SpatialKeyframe.kt lines 24-27 (imageBase64Jpeg doc comment); ArCoreFaceMeshTracker.kt lines 253-270 (YuvJpegConverter.toNv21(image) from frame.acquireCameraImage(), re-encoded with no rotation/mirror step)',
    finding: 'The exported JPEG is the raw sensor-orientation YUV_420_888 buffer re-encoded to JPEG with NO rotation or mirroring applied. It may appear sideways relative to the on-screen portrait display -- documented as expected, not a bug. imageRotationDegrees=0/imageMirrored=false (SpatialKeyframe.kt lines 28-29) are the class\'s literal, never-overridden default values -- captureKeyframe() never sets them -- and they are accurate for this specific pipeline (the buffer genuinely has no rotation/mirror step applied), not a per-frame measurement from any API.'
  },
  intrinsics: {
    space: 'RAW_UNROTATED_IMAGE_SPACE_MATCHING_JPEG_EXACTLY',
    sourceRef: 'SpatialKeyframe.kt lines 36-39 (intrinsicsSpace doc comment); ArCoreFaceMeshTracker.kt lines 241-251 (camera.imageIntrinsics, NOT camera.textureIntrinsics)',
    finding: 'intrinsics come from Camera.getImageIntrinsics() -- explicitly documented as "unrotated CPU-image space, matching imageBase64Jpeg\'s own pixel buffer exactly," deliberately never Camera.getTextureIntrinsics() (GPU preview-texture space). Principal point (cx,cy) is expected to sit near the image center (320,240 for 640x480) for a well-behaved raw sensor calibration.'
  },
  imageSpaceViewModelMatrix: {
    space: 'RAW_UNROTATED_CAMERA_SPACE_SAME_FRAME_AS_JPEG_AND_INTRINSICS',
    sourceRef: 'ArCoreFaceMeshTracker.kt lines 24-32 (physicalViewMatrix doc comment), line 182 (camera.pose.inverse()), line 183 (physicalViewMatrix * modelMatrix); SpatialKeyframe.kt lines 47-53',
    finding: 'imageSpaceViewModelMatrix = camera.pose.inverse() * face.centerPose (model matrix). camera.pose is the PHYSICAL, image-oriented pose used by acquireCameraImage()/getImageIntrinsics() -- explicitly NOT camera.getViewMatrix() (display-oriented, rotated relative to the raw image by a multiple of 90 degrees, per ARCore\'s own javadoc as quoted in this same source comment). This is a pure rigid extrinsic transform (view*model only -- no projection folded in), which is exactly why BI-1Z1H measured its determinant at ~1.0 in every sample: it is a genuine rigid rotation+translation, not a perspective/FOV-inclusive matrix. It is DESIGNED to be combined with intrinsics via a real pinhole projection (a61ProjectPoint\'s fx*(Xcv/Zcv)+cx formula) to land on the RAW JPEG -- "something the projection-inclusive, display-oriented transformationMatrix cannot do" (SpatialKeyframe.kt line 52).',
    convention: 'Column-major 4x4 (Android android.opengl.Matrix convention, matching hairness-core-v1.mjs\'s a61MatMulVec: element(row,col) stored at index col*4+row), multiplication direction M*v (matrix times column vector), right-handed OpenGL-style coordinate system per ARCore\'s own documented convention. Homogeneous divide (perspective) is deliberately NOT part of this matrix -- it is applied separately by a61ProjectPoint via the pinhole intrinsics formula, matching how the recovered a61_segment.js pipeline has always used it.'
  },
  transformationMatrix: {
    space: 'RESOLVED_-_SAME_DISPLAY_ORIENTED_CHAIN_AS_LANDMARKS2D',
    sourceRef: 'ArCoreFaceMeshTracker.kt line 106 (tmpMatrix = viewMatrix * modelMatrix), line 114 (modelViewProjectionMatrix = projectionMatrix * tmpMatrix), line 164 and line 191 (transformationMatrix: modelViewProjectionMatrix.toList()); SpatialKeyframe.kt lines 43-45',
    finding: 'RESOLVED (BI-1Z1H left this UNKNOWN; this stage resolves it from source): transformationMatrix IS modelViewProjectionMatrix = projectionMatrix * viewMatrix * modelMatrix -- the IDENTICAL matrix chain used to compute landmarks2D, explicitly documented in SpatialKeyframe.kt as "includes the front-camera mirror flip baked into the projection step." Applying the SAME homogeneous-divide + NDC-to-[0,1] procedure used for landmarks2D (see projectViaTransformationMatrix below) to a faceLocal3D point via transformationMatrix should reproduce that same landmark\'s landmarks2D position closely (residual bounded only by the temporal stabilizer\'s smoothing, since landmarks2D is stabilizedLandmarks while faceLocal3D/transformationMatrix are the raw per-frame values) -- this is empirically verified in Part 1 of this stage\'s analysis, not merely asserted from the comment.',
    inverseRequiredForHeadRelativeStabilization: 'No -- transformationMatrix already includes the projection step and is therefore NOT the right matrix for a pure head-relative rigid transform (BI-1Z1H\'s cross-frame stabilization proof correctly used faceLocal3D directly instead, which needs no matrix at all since it is already canonical head-relative). transformationMatrix is relevant only to reproducing the DISPLAY-space landmarks2D overlay, not to raw-image projection or head-relative geometry.'
  },
  reconciliation: 'landmarks2D and (faceLocal3D + imageSpaceViewModelMatrix + intrinsics) are TWO DELIBERATELY DIFFERENT, independently valid coordinate systems for two different purposes -- not two measurements of the same space with a fixable rotation/mirror/scale error. BI-1Z1H\'s 100-260px residual is fully explained: it compared a raw-image-space projection (imageSpaceViewModelMatrix+intrinsics, matching the JPEG) against a display-space value (landmarks2D, matching the on-screen preview) that uses a genuinely different view matrix AND a different (FOV/aspect-inclusive) projection matrix -- not merely a rotated/mirrored copy of the same one. No single fixed affine correction (mirror/rotate/scale) can fully reconcile them, because the underlying projections differ in more than orientation (confirmed empirically in Part 7 of this stage\'s analysis, not merely inferred). The correct, already-validated transform chain for mapping a faceLocal3D anchor into the ACTUAL raw JPEG is: a61ProjectPoint(imageSpaceViewModelMatrix, intrinsics, faceLocal3D[idx]) -- exactly what the recovered a61_segment.js pipeline (and this project\'s own hairness-core-v1.mjs transcription of it) has used successfully throughout BI-1Z1B through BI-1Z1F. landmarks2D is not needed for, and is not the correct reference for, raw-JPEG patch extraction.'
});

// ---- broad anchor set (Part 8) -- reused verbatim from the existing, unit-tested module -------
export const BROAD_ANCHOR_SET = Object.freeze([
  ...SPARSE_TIER_A_INDICES,
  // upper-face anchors reused verbatim from hairness-core-v1.mjs's own (private) A61_LM table --
  // noseTip, noseBridge, foreheadCenter, eyeBottomL/R, browBottomL/R -- no new landmark index
  // invented, only added here so the "broad anatomically distributed subset" (Part 8) also spans
  // eyes/nose/forehead, not only jaw/cheek/mouth.
  1, 6, 151, 144, 373, 105, 334
].filter((v, i, arr) => arr.indexOf(v) === i).sort((a, b) => a - b));

// ---- matrix application (Part 5/7) -------------------------------------------------------------
function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function isFiniteVec3(p) { return !!p && isFiniteNum(p.x) && isFiniteNum(p.y) && isFiniteNum(p.z); }
/** Column-major 4x4 * homogeneous vec4, matching Android's android.opengl.Matrix convention
 *  (verified identical to hairness-core-v1.mjs's private a61MatMulVec formula). */
function matMulVec4(m, v) {
  const out = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) { let sum = 0; for (let col = 0; col < 4; col++) sum += m[col * 4 + row] * v[col]; out[row] = sum; }
  return out;
}
/** Mirrors ArCoreFaceMeshTracker.kt lines 137-145 EXACTLY: Matrix.multiplyMV then NDC[-1,1]->[0,1]
 *  with a Y-flip. This is the SAME procedure that produced landmarks2D itself, applied here to
 *  faceLocal3D via transformationMatrix -- used to empirically verify (not merely assert) that
 *  transformationMatrix is the landmarks2D-generating chain (Part 6 resolution). */
export function projectViaTransformationMatrix(transformationMatrix, p3) {
  if (!Array.isArray(transformationMatrix) || transformationMatrix.length !== 16 || !isFiniteVec3(p3)) return null;
  const pv = matMulVec4(transformationMatrix, [p3.x, p3.y, p3.z, 1.0]);
  const w = pv[3];
  if (!isFiniteNum(w) || w === 0) return null;
  return { x: (pv[0] / w + 1.0) / 2.0, y: 1.0 - (pv[1] / w + 1.0) / 2.0, z: pv[2] / w };
}
/** The already-validated raw-JPEG projection (reused, unmodified, from hairness-core-v1.mjs). */
export function projectViaImageSpaceViewModelMatrix(vmm, intrinsics, p3) {
  const proj = a61ProjectPoint(vmm, intrinsics, p3);
  return proj ? { x: proj.u, y: proj.v, z: proj.z } : null;
}

// ---- Part 7: candidate transform testing (systematic, source-justified only) -------------------
/** Every candidate corresponds to a real, plausible pipeline transformation (Part 7 constraint) --
 *  never an arbitrary fitted affine. `apply` takes a pixel-space {x,y} and the image {w,h}. */
export const CANDIDATE_TRANSFORMS = Object.freeze([
  { name: 'RAW', apply: (p) => p },
  { name: 'MIRROR_X', apply: (p, w) => ({ x: w - p.x, y: p.y }) },
  { name: 'INVERT_Y', apply: (p, w, h) => ({ x: p.x, y: h - p.y }) },
  { name: 'INVERT_XY', apply: (p, w, h) => ({ x: w - p.x, y: h - p.y }) },
  { name: 'ROTATE_90_CW', apply: (p, w, h) => ({ x: h - p.y, y: p.x }) },
  { name: 'ROTATE_90_CCW', apply: (p, w, h) => ({ x: p.y, y: w - p.x }) },
  { name: 'ROTATE_180', apply: (p, w, h) => ({ x: w - p.x, y: h - p.y }) }
]);

function euclidean(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

/** For one sample, projects `anchors` both ways and, for each candidate transform, computes the
 *  residual between the (candidate-transformed) raw-image projection and the recorded landmarks2D
 *  pixel position. Returns per-candidate mean/median residual across the given anchors. Never
 *  selects a transform by minimizing this residual for later use -- Part 7 explicitly forbids
 *  brute-force fitting; this function only REPORTS each named candidate's residual for inspection. */
export function testCandidateTransforms(sample, anchors = BROAD_ANCHOR_SET) {
  const w = sample.imageWidth, h = sample.imageHeight;
  if (!w || !h || !Array.isArray(sample.faceLocal3D) || !Array.isArray(sample.landmarks2D) || !sample.intrinsics || !sample.imageSpaceViewModelMatrix) return null;
  const results = {};
  CANDIDATE_TRANSFORMS.forEach(({ name, apply }) => {
    const residuals = [];
    anchors.forEach(idx => {
      const p3 = sample.faceLocal3D[idx], p2 = sample.landmarks2D[idx];
      if (!isFiniteVec3(p3) || !p2 || !isFiniteNum(p2.x) || !isFiniteNum(p2.y)) return;
      const raw = projectViaImageSpaceViewModelMatrix(sample.imageSpaceViewModelMatrix, sample.intrinsics, p3);
      if (!raw) return;
      const transformed = apply(raw, w, h);
      const recorded = { x: p2.x * w, y: p2.y * h };
      residuals.push(euclidean(transformed, recorded));
    });
    residuals.sort((a, b) => a - b);
    results[name] = {
      count: residuals.length,
      mean: residuals.length ? residuals.reduce((s, v) => s + v, 0) / residuals.length : null,
      median: residuals.length ? residuals[Math.floor(residuals.length / 2)] : null
    };
  });
  return results;
}

// ---- Part 8: multi-landmark residual structure (systematic x/y offset, scale, center trend) ----
export function residualStructure(sample, anchors = BROAD_ANCHOR_SET) {
  const w = sample.imageWidth, h = sample.imageHeight;
  if (!w || !h) return null;
  const points = [];
  anchors.forEach(idx => {
    const p3 = sample.faceLocal3D[idx], p2 = sample.landmarks2D[idx];
    if (!isFiniteVec3(p3) || !p2 || !isFiniteNum(p2.x) || !isFiniteNum(p2.y)) return;
    const raw = projectViaImageSpaceViewModelMatrix(sample.imageSpaceViewModelMatrix, sample.intrinsics, p3);
    if (!raw) return;
    const recorded = { x: p2.x * w, y: p2.y * h };
    const dx = raw.x - recorded.x, dy = raw.y - recorded.y;
    const distFromCenter = Math.hypot(recorded.x - w / 2, recorded.y - h / 2);
    points.push({ idx, dx, dy, residual: Math.hypot(dx, dy), distFromCenter });
  });
  if (!points.length) return null;
  const residuals = points.map(p => p.residual).sort((a, b) => a - b);
  const meanDx = points.reduce((s, p) => s + p.dx, 0) / points.length;
  const meanDy = points.reduce((s, p) => s + p.dy, 0) / points.length;
  // Pearson correlation between distance-from-center and residual magnitude -- a positive,
  // strong correlation indicates a center-correlated (non-fixed-offset) discrepancy, consistent
  // with two genuinely different projection matrices rather than a simple translation error.
  const n = points.length;
  const meanDist = points.reduce((s, p) => s + p.distFromCenter, 0) / n;
  const meanRes = points.reduce((s, p) => s + p.residual, 0) / n;
  let cov = 0, varDist = 0, varRes = 0;
  points.forEach(p => { cov += (p.distFromCenter - meanDist) * (p.residual - meanRes); varDist += (p.distFromCenter - meanDist) ** 2; varRes += (p.residual - meanRes) ** 2; });
  const centerCorrelation = (varDist > 0 && varRes > 0) ? cov / Math.sqrt(varDist * varRes) : null;
  return {
    count: n, mean: meanRes, median: residuals[Math.floor(n / 2)], p90: residuals[Math.min(n - 1, Math.ceil(0.9 * n) - 1)], max: residuals[n - 1],
    systematicMeanDx: meanDx, systematicMeanDy: meanDy, centerDistanceCorrelation: centerCorrelation
  };
}

// ---- Part 11: geometry-only face-shape plausibility (no GT, no image, pure geometry) -----------
/** A face-shaped point cloud should show: eyes/forehead anchors above the nose tip, nose tip above
 *  the mouth, mouth above the chin (image-y increases downward), and left/right cheek anchors
 *  roughly symmetric about the midline x. This is a GT-free, image-free sanity check that the raw
 *  imageSpaceViewModelMatrix+intrinsics projection produces an anatomically plausible layout, not
 *  a scrambled one. */
export function faceShapePlausibility(sample) {
  const vmm = sample.imageSpaceViewModelMatrix, intr = sample.intrinsics, fl = sample.faceLocal3D;
  if (!vmm || !intr || !Array.isArray(fl)) return null;
  const proj = idx => projectViaImageSpaceViewModelMatrix(vmm, intr, fl[idx]);
  const forehead = proj(151), nose = proj(1), mouth = proj(17), chin = proj(152);
  const cheekL = proj(454), cheekR = proj(234);
  if (![forehead, nose, mouth, chin, cheekL, cheekR].every(p => p && isFiniteNum(p.x) && isFiniteNum(p.y))) return { plausible: false, reason: 'PROJECTION_UNAVAILABLE' };
  const verticalOrderOk = forehead.y < nose.y && nose.y < mouth.y && mouth.y < chin.y;
  const midlineX = (cheekL.x + cheekR.x) / 2;
  const symmetrySpread = Math.abs(Math.abs(cheekL.x - midlineX) - Math.abs(cheekR.x - midlineX));
  const cheekSpan = Math.abs(cheekL.x - cheekR.x);
  const symmetryOk = cheekSpan > 0 && (symmetrySpread / cheekSpan) < 0.5;
  return { plausible: verticalOrderOk && symmetryOk, verticalOrderOk, symmetryOk, forehead, nose, mouth, chin, cheekL, cheekR, midlineX, symmetrySpread, cheekSpan };
}
