// Stage BI-1Z1C.1 — RESEARCH-ONLY exact transcription of the frozen HIGH_GRADIENT_FRACTION
// Hairness feature/decision-rule, recovered from D:\MettleTemp\annotation\
// bi1m_frozen_hairness_core_v1.json (SHA256 recorded below). This is NOT a new model, NOT
// retraining, NOT retuning -- every threshold and formula step here is copied verbatim from that
// frozen manifest. Never wired into production; never invoked by the annotation workbench.
//
// HONEST LIMITATION (do not remove this comment): the manifest's ROI geometry
// (LEFT_JAW/RIGHT_JAW/LEFT_SIDEBURN/RIGHT_SIDEBURN polygons and the CHEEK_SPLIT axis-parametric
// split) is sourced from "a61_segment.js, unmodified" -- that file does not exist anywhere in this
// repository or under D:\MettleTemp (confirmed by exhaustive search this stage). This module
// therefore CANNOT regenerate the exact historical per-region ROI pixel geometry from scratch, and
// accepts a caller-supplied ROI mask instead. What IS exactly and provably transcribed: the
// Sobel-gradient / highGradientFraction FEATURE FORMULA, and the DECISION RULE (11.9/14.9
// thresholds derived from the manifest's own historicalTrainingSamples) -- see
// hairness-core-v1.test.mjs for the replication proof against those real historical numbers.
'use strict';

export const HAIRNESS_CORE_SOURCE = Object.freeze({
  path: 'D:\\MettleTemp\\annotation\\bi1m_frozen_hairness_core_v1.json',
  sha256: 'ef458c0d1e681119cab6272617d6d5afa805b61f75911f1e4608850bdce31766',
  manifestVersion: 'bi1m-frozen-hairness-core/1',
  configFingerprintSha256Recorded: 'dc3511f0684f1f7abb688f6f71b28232aaab06dfb6c6eca1e94efc39925fedbd',
  configFingerprintVerifiable: false,
  configFingerprintNote: 'The manifest\'s own configFingerprintSha256 hashes {featureName, gradientOperator, adaptiveThresholdRule, decisionMidpoint, deadZoneLower, deadZoneUpper, cheekGeometry, jawGeometry, sideburnGeometry, cheekSplitGeometry} in some specific serialization the manifest does not fully specify (field order, key naming, number formatting). Even though a61_segment.js WAS recovered (BI-1Z1C.2, see A61_SEGMENT_SOURCE) and its ROI construction is now available (buildA61JawSideburnROIs), the exact byte-for-byte serialization the original fingerprint hash was computed over is not documented -- reconstructing it would require guessing that format, which this module deliberately does not do. The feature/threshold portion (decisionMidpoint/deadZoneLower/deadZoneUpper) remains independently reproduced and verified via real historical numbers -- see DECISION_RULE and its replication test -- and the Sobel/highGradientFraction FORMULA is now also cross-checked byte-for-byte against the actual historical implementation (see HAIRNESS_FORMULA_HISTORICAL_CROSSCHECK_SOURCE).'
});

// ---- BI-1Z1C.2 UPDATE: a61_segment.js WAS RECOVERED (it lived on the user's Desktop, at
// C:\Users\queen\Desktop\ChatGPT_A61Q_Upload\a61_segment.js -- outside every location searched in
// BI-1Z1C.1). SHA256 683b930cd6b5c05a11bf95302a474420d571a40cc9b014bb6fd22a9f4ed8308c, matching
// the historical hash prefix exactly. A byte-identical read-only copy is archived at
// D:\MettleTemp\recovered-a61\a61_segment.js. Its `buildRoiPolygonsPx()` is transcribed below as
// buildA61JawSideburnROIs() -- NOT imported (the original requires 'sharp' and hardcodes a
// Windows path; this project's own standing pattern, followed by the historical bi1j_cheek_
// features.mjs itself, is to REPRODUCE frozen formulas rather than import them). The Sobel/
// highGradientFraction formula in THIS file was independently cross-checked against the actual
// historical implementation in bi1j_cheek_features.mjs (recovered from the real BI-1J/1K/1L/1M
// session, C:\Users\queen\AppData\Local\Temp\claude\...\af9c243d-dc5d-4b28-9ac6-7bd23ddea66f\
// scratchpad\bi1j_cheek_features.mjs) and matches byte-for-byte: same 3x3 Sobel kernel, same
// meanGrad/gradStd (population std) formula, same adaptiveThr=meanGrad+gradStd, and the same
// `100 * highGrad / gradVals.length` percentage scaling this adapter already used.
export const A61_SEGMENT_SOURCE = Object.freeze({
  recoveredPath: 'C:\\Users\\queen\\Desktop\\ChatGPT_A61Q_Upload\\a61_segment.js',
  archivedCopyPath: 'D:\\MettleTemp\\recovered-a61\\a61_segment.js',
  sha256: '683b930cd6b5c05a11bf95302a474420d571a40cc9b014bb6fd22a9f4ed8308c',
  historicalHashPrefixMatch: true
});
export const A61_COMPANION_SOURCES = Object.freeze({
  a61o_edge_engine: { archivedCopyPath: 'D:\\MettleTemp\\recovered-a61\\a61o_edge_engine.js', sha256: 'aaf1c7cbff6922f348b9a750f15750c33ee231828ed00c15fa4b589c316db257', historicalHashPrefixMatch: true },
  a61p_fusion: { archivedCopyPath: 'D:\\MettleTemp\\recovered-a61\\a61p_fusion.js', sha256: 'b64f4f838f0d3be926908f2c0fb099d07f79598d5e42f3644f1e310c3c2dc213', historicalHashPrefixMatch: true },
  a61s_boundary_semantics: { found: false, note: 'exhaustively searched (Desktop, its zip archive, all historical Claude Temp session scratchpads, Downloads, OneDrive Documents, D:\\MettleTemp) -- not found anywhere. Not required for the JAW/SIDEBURN/CHEEK ROI geometry recovered here.' }
});
export const HAIRNESS_FORMULA_HISTORICAL_CROSSCHECK_SOURCE = Object.freeze({
  path: 'C:\\Users\\queen\\AppData\\Local\\Temp\\claude\\D--Beard-map-app-main-beard-trim-map-main-beard-trim-map-main\\af9c243d-dc5d-4b28-9ac6-7bd23ddea66f\\scratchpad\\bi1j_cheek_features.mjs',
  note: 'the actual historical Sobel/highGradientFraction implementation (function computeAllFeatures, lines ~82-133) -- confirmed byte-for-byte equivalent to sobelGradientMagnitude/highGradientFraction below (same kernel, same mean+std threshold rule, same 100x percentage scaling). This is the missing end-to-end formula cross-check BI-1Z1C.1 could not perform.'
});

// ---- Historical ROI geometry, transcribed (not imported) from the recovered a61_segment.js ----
// Uses faceLocal3D (3D face-local landmarks) + imageSpaceViewModelMatrix + intrinsics to project
// each ROI's defining landmarks into 2D IMAGE pixels for THIS frame -- a materially different (and
// more precise, pose-correct) path than a flat landmarks2D*width/height scaling. Side (left/right)
// is resolved DYNAMICALLY from each point's own face-local X sign relative to the chin midline,
// exactly as the original does, rather than assuming a fixed index-to-side mapping.
const A61_LM = Object.freeze({
  noseBridge: 6, noseTip: 1, foreheadCenter: 151, underNose: Object.freeze([2, 98, 327]),
  upperLip: Object.freeze([61, 0, 291]), lowerLip: 17, chin: 152,
  jawNearChinL: 149, jawNearChinR: 378, jawCornerL: 172, jawCornerR: 397,
  faceOvalUpperSideL: 127, faceOvalUpperSideR: 356, cheekLatL: 234, cheekLatR: 454,
  eyeBottomL: 144, eyeBottomR: 373, browBottomL: 105, browBottomR: 334
});
function a61MatMulVec(m, v) {
  const out = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) { let sum = 0; for (let col = 0; col < 4; col++) sum += m[col * 4 + row] * v[col]; out[row] = sum; }
  return out;
}
/** Verbatim transcription of a61_segment.js's projectPoint(). */
export function a61ProjectPoint(vmm, intrinsics, p) {
  const camSpace = a61MatMulVec(vmm, [p.x, p.y, p.z, 1.0]);
  const Xcv = camSpace[0], Ycv = -camSpace[1], Zcv = -camSpace[2];
  if (Zcv <= 0) return null;
  return { u: intrinsics.fx * (Xcv / Zcv) + intrinsics.cx, v: intrinsics.fy * (Ycv / Zcv) + intrinsics.cy, z: Zcv };
}
/** Verbatim transcription of a61_segment.js's buildRoiPolygonsPx() -- returns {name: [[x,y],...]}
 *  in raw IMAGE pixels, or null if faceLocal3D/vmm/intrinsics are unavailable. */
export function buildA61JawSideburnROIs(faceLocal3D, vmm, intrinsics) {
  if (!faceLocal3D || !vmm || !intrinsics) return null;
  const midlineX = faceLocal3D[A61_LM.chin].x;
  const proj = idx => { const r = a61ProjectPoint(vmm, intrinsics, faceLocal3D[idx]); return r ? [r.u, r.v] : null; };
  const sideOf = idx => (faceLocal3D[idx].x - midlineX) >= 0 ? 'left' : 'right';
  const cheekLatSide = sideOf(A61_LM.cheekLatL);
  const L = cheekLatSide === 'left'
    ? { cheekLat: A61_LM.cheekLatL, jawCorner: A61_LM.jawCornerL, jawNearChin: A61_LM.jawNearChinL, faceOvalUpper: A61_LM.faceOvalUpperSideL, eyeBottom: A61_LM.eyeBottomL, browBottom: A61_LM.browBottomL }
    : { cheekLat: A61_LM.cheekLatR, jawCorner: A61_LM.jawCornerR, jawNearChin: A61_LM.jawNearChinR, faceOvalUpper: A61_LM.faceOvalUpperSideR, eyeBottom: A61_LM.eyeBottomR, browBottom: A61_LM.browBottomR };
  const R = cheekLatSide === 'left'
    ? { cheekLat: A61_LM.cheekLatR, jawCorner: A61_LM.jawCornerR, jawNearChin: A61_LM.jawNearChinR, faceOvalUpper: A61_LM.faceOvalUpperSideR, eyeBottom: A61_LM.eyeBottomR, browBottom: A61_LM.browBottomR }
    : { cheekLat: A61_LM.cheekLatL, jawCorner: A61_LM.jawCornerL, jawNearChin: A61_LM.jawNearChinL, faceOvalUpper: A61_LM.faceOvalUpperSideL, eyeBottom: A61_LM.eyeBottomL, browBottom: A61_LM.browBottomL };
  const polys = {};
  const add = (name, idxList) => { const pts = idxList.map(proj).filter(Boolean); if (pts.length >= 3) polys[name] = pts; };
  add('MOUSTACHE_CENTER', [A61_LM.underNose[0], A61_LM.underNose[1], A61_LM.underNose[2], A61_LM.upperLip[2], A61_LM.upperLip[1], A61_LM.upperLip[0]]);
  add('CHIN_BEARD', [A61_LM.lowerLip, L.jawNearChin, A61_LM.chin, R.jawNearChin]);
  add('CHEEK_LEFT', [L.eyeBottom, L.faceOvalUpper, L.cheekLat, L.jawNearChin, A61_LM.noseBridge]);
  add('CHEEK_RIGHT', [R.eyeBottom, R.faceOvalUpper, R.cheekLat, R.jawNearChin, A61_LM.noseBridge]);
  add('SIDEBURN_LEFT', [L.browBottom, L.faceOvalUpper, L.cheekLat]);
  add('SIDEBURN_RIGHT', [R.browBottom, R.faceOvalUpper, R.cheekLat]);
  add('JAW_LEFT', [L.cheekLat, L.jawCorner, L.jawNearChin]);
  add('JAW_RIGHT', [R.cheekLat, R.jawCorner, R.jawNearChin]);
  return polys;
}
/** Rasterizes an a61 polygon (array of [x,y] pairs) into a Uint8Array(w*h) mask, using the exact
 *  same point-in-polygon test as the original (verbatim transcription). */
export function rasterizeA61Polygon(poly, w, h) {
  const mask = new Uint8Array(w * h);
  function pointInPolygon(x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  poly.forEach(([x, y]) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; });
  minX = Math.max(0, Math.floor(minX)); maxX = Math.min(w - 1, Math.ceil(maxX));
  minY = Math.max(0, Math.floor(minY)); maxY = Math.min(h - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (pointInPolygon(x, y)) mask[y * w + x] = 1;
  return mask;
}

export const ROI_GEOMETRY_LIMITATION = 'RESOLVED (BI-1Z1C.2): a61_segment.js was recovered from C:\\Users\\queen\\Desktop\\ChatGPT_A61Q_Upload\\ (SHA256 683b930c... matching the historical prefix exactly) -- see A61_SEGMENT_SOURCE, buildA61JawSideburnROIs, and rasterizeA61Polygon above. The CHEEK_SPLIT axis-parametric upper/lower refinement (t=0.25 along eyeBottom->jawNearChin) described in the frozen manifest is a further refinement of CHEEK_LEFT/CHEEK_RIGHT documented there but not separately recovered as its own script -- it is not required for the JAW_LEFT/JAW_RIGHT/SIDEBURN_LEFT/SIDEBURN_RIGHT geometry this module exercises.';

// ---- Frozen decision rule (verbatim from the manifest's decisionRule block) -------------------
export const DECISION_RULE = Object.freeze({
  historicalTrainingSamples: Object.freeze({
    upperCheekSkin_n5: Object.freeze([11.2, 11.7, 13.7, 9.6, 12.2]),
    lowerCheekBeard_n5: Object.freeze([15.9, 15.9, 14.0, 13.9, 15.9])
  }),
  decisionMidpoint: 13.4,
  deadZoneLowerBound: 11.9,
  deadZoneUpperBound: 14.9,
  deadZoneHalfWidth: 1.5
});

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

/** Reproduces the manifest's own documented derivation ("training-derived midpoint ... with a
 *  +/-1.5 UNCERTAIN dead-zone") from raw sample arrays. Calling this with the manifest's own
 *  historicalTrainingSamples must reproduce decisionMidpoint/deadZoneLowerBound/
 *  deadZoneUpperBound EXACTLY -- this is the replication proof (see test file), performed against
 *  real historical numbers recorded in the frozen manifest, not synthetic data. */
export function deriveDecisionRuleFromSamples(upperCheekSkinSamples, lowerCheekBeardSamples) {
  const skinMean = mean(upperCheekSkinSamples);
  const beardMean = mean(lowerCheekBeardSamples);
  const midpoint = (skinMean + beardMean) / 2;
  return {
    skinMean, beardMean, midpoint,
    deadZoneLowerBound: midpoint - DECISION_RULE.deadZoneHalfWidth,
    deadZoneUpperBound: midpoint + DECISION_RULE.deadZoneHalfWidth
  };
}

/** Verbatim classification rule: "< 11.9 -> NON_BEARD_CONFIRMED; > 14.9 -> BEARD_CONFIRMED;
 *  11.9 <= x <= 14.9 -> UNCERTAIN". */
export function classifyHairness(highGradientFractionValue) {
  if (highGradientFractionValue < DECISION_RULE.deadZoneLowerBound) return 'NON_BEARD_CONFIRMED';
  if (highGradientFractionValue > DECISION_RULE.deadZoneUpperBound) return 'BEARD_CONFIRMED';
  return 'UNCERTAIN';
}

// ---- Frozen feature formula: real 3x3 Sobel gradient magnitude --------------------------------
/** Standard 3x3 Sobel operator, applied at every INTERIOR pixel (matching the manifest's own
 *  "valid interior pixel" language -- border pixels have no defined Sobel neighborhood and are
 *  never included). Returns a Float32Array the same size as `gray`; border pixels are 0 and are
 *  never counted as "valid" by highGradientFraction below. */
export function sobelGradientMagnitude(gray, w, h) {
  const out = new Float32Array(w * h);
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sx = 0, sy = 0, k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++, k++) {
        const v = gray[(y + dy) * w + (x + dx)];
        sx += v * gx[k]; sy += v * gy[k];
      }
      out[y * w + x] = Math.sqrt(sx * sx + sy * sy);
    }
  }
  return out;
}

/** Verbatim HIGH_GRADIENT_FRACTION feature, steps 1-5 of the manifest's definitionSteps:
 *  Sobel magnitude over valid interior ROI pixels -> mean+std -> adaptive threshold
 *  (meanGradient + 1*stdGradient, recomputed per-ROI, never a fixed global constant) ->
 *  fraction of valid pixels exceeding it. `roiMask` is a caller-supplied Uint8Array(w*h); a pixel
 *  is "valid" only if it is both inside the ROI AND an interior (non-border) pixel. Returns null
 *  (fails closed) if there are zero valid pixels -- never divides by zero, never fabricates a
 *  value. */
export function highGradientFraction(gray, roiMask, w, h) {
  const grad = sobelGradientMagnitude(gray, w, h);
  const validValues = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const idx = y * w + x;
    if (roiMask[idx]) validValues.push(grad[idx]);
  }
  const n = validValues.length;
  if (n === 0) return null;
  const meanGradient = validValues.reduce((a, b) => a + b, 0) / n;
  const variance = validValues.reduce((a, b) => a + (b - meanGradient) * (b - meanGradient), 0) / n;
  const stdGradient = Math.sqrt(variance);
  const threshold = meanGradient + stdGradient;
  let countAbove = 0;
  for (let i = 0; i < n; i++) if (validValues[i] > threshold) countAbove++;
  return { highGradientFraction: (countAbove / n) * 100, meanGradient, stdGradient, threshold, validPixelCount: n };
}

/** Convenience: compute highGradientFraction then classify in one call. Returns null (fails
 *  closed) if the ROI has zero valid pixels. */
export function runHairnessCoreV1(gray, roiMask, w, h) {
  const feature = highGradientFraction(gray, roiMask, w, h);
  if (!feature) return null;
  return Object.assign({ classification: classifyHairness(feature.highGradientFraction) }, feature);
}
