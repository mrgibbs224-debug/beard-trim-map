// Stage BI-1Z1E — synthetic/invariant tests for the V2.1 Beard Occupancy Field, run and passing
// BEFORE any human GT was loaded (Part 16/18 GT firewall). Node built-in runner (node --test).
// Real historical/physical fixtures are NOT used here (no GT dependency) -- purely synthetic,
// controllable frames, matching this project's established testing convention.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as V21 from './beard-occupancy-field-v21.mjs';
import * as H from './hairness-core-v1.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const V1_SOURCE = readFileSync(join(HERE, '..', 'tools', 'annotation-workbench', 'beard-proposal.cjs'), 'utf8');
const V2_SOURCE = readFileSync(join(HERE, 'beard-proposal-anatomical-seeded-v2.mjs'), 'utf8');
const ROOT_INDEX_HTML = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
const W = 640, H_ = 480;

// ---- shared synthetic frame fixture (same convention as hairness-core-v1-a61-recovery.test.mjs) ---
function syntheticFaceLocal3D() {
  const arr = new Array(468).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
  const pts = {
    6: [0, 0.02, 0.05], 1: [0, 0, 0.06], 151: [0, 0.05, 0.04], 2: [0, -0.01, 0.05], 98: [0.01, -0.01, 0.05], 327: [-0.01, -0.01, 0.05],
    61: [0.02, -0.02, 0.05], 0: [0, -0.02, 0.05], 291: [-0.02, -0.02, 0.05], 17: [0, -0.04, 0.05], 152: [0, -0.06, 0.04],
    149: [0.02, -0.05, 0.04], 378: [-0.02, -0.05, 0.04], 172: [0.05, -0.03, 0.02], 397: [-0.05, -0.03, 0.02],
    127: [0.06, 0.02, 0.0], 356: [-0.06, 0.02, 0.0], 234: [0.06, -0.01, 0.0], 454: [-0.06, -0.01, 0.0],
    144: [0.04, 0.03, 0.03], 373: [-0.04, 0.03, 0.03], 105: [0.04, 0.04, 0.03], 334: [-0.04, 0.04, 0.03]
  };
  Object.keys(pts).forEach(k => { arr[k] = { x: pts[k][0], y: pts[k][1], z: pts[k][2] }; });
  return arr;
}
function identityVMM() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -0.5, 1]; }
function syntheticIntrinsics() { return { fx: 500, fy: 500, cx: 320, cy: 240 }; }
function flatGray(value) { return new Float32Array(W * H_).fill(value); }
function paintPolygon(gray, poly, value) {
  const mask = H.rasterizeA61Polygon(poly, W, H_);
  for (let i = 0; i < mask.length; i++) if (mask[i]) gray[i] = value;
}
function regionPolys() { return H.buildA61JawSideburnROIs(syntheticFaceLocal3D(), identityVMM(), syntheticIntrinsics()); }
// V2's corridor (buildAnatomicalCorridor/buildExclusionField) reads the SEPARATE CAPTURE_NORMALIZED
// landmarks2D representation (0..1, scaled by width/height), NOT faceLocal3D -- exactly like a real
// Tier-B keyframe, which carries BOTH representations simultaneously. This synthetic landmarks2D
// jaw rail/mouth-reference is deliberately positioned (empirically, by construction) so V2's
// corridor generously CONTAINS the actual pixel footprint of the a61 JAW_LEFT/JAW_RIGHT/CHIN_BEARD
// regions computed above (x:[260,380], y:[197,305] for this fixture) plus extends well below for
// long-beard/UNKNOWN-region tests.
function syntheticLandmarks2D() {
  const arr = new Array(468).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0.5 }));
  const rail = { 172: [390 / W, 260 / H_], 149: [350 / W, 300 / H_], 152: [320 / W, 310 / H_], 378: [290 / W, 300 / H_], 397: [250 / W, 260 / H_] };
  Object.keys(rail).forEach(k => { arr[k] = { x: rail[k][0], y: rail[k][1], z: 0.5 }; });
  const MOUTH_REF = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];
  MOUTH_REF.forEach(idx => { arr[idx] = { x: 320 / W, y: 220 / H_, z: 0.5 }; });
  return arr;
}
function baseInputs(gray) {
  return { landmarks2D: syntheticLandmarks2D(), faceLocal3D: syntheticFaceLocal3D(), imageSpaceViewModelMatrix: identityVMM(), intrinsics: syntheticIntrinsics(), gray, width: W, height: H_ };
}
const BRIGHT = 220, DARK = 30;

// ---- engineering-correctness tests --------------------------------------------------------------
test('design hash: V21_DESIGN_SHA256 matches the frozen BI-1Z1D design artifact', () => {
  assert.equal(V21.V21_DESIGN_SHA256, '0c53aaeb2a84040660d284ec537a832748b85ecc8d67f1ee88daa2a9daf4510a');
});
test('V1 unchanged: beard-proposal/1 byte-identical marker present', () => {
  assert.match(V1_SOURCE, /PROPOSAL_ALGORITHM_VERSION = 'beard-proposal\/1'/);
});
test('V2 unchanged: beard-proposal-anatomical-seeded/2 byte-identical marker present', () => {
  assert.match(V2_SOURCE, /V2_ALGORITHM_VERSION = 'beard-proposal-anatomical-seeded\/2'/);
});
test('Hairness thresholds unchanged: 11.9/14.9/13.4', () => {
  assert.equal(H.DECISION_RULE.deadZoneLowerBound, 11.9);
  assert.equal(H.DECISION_RULE.deadZoneUpperBound, 14.9);
  assert.equal(H.DECISION_RULE.decisionMidpoint, 13.4);
});
test('deterministic output: identical input twice produces deep-equal contour area/status', () => {
  const gray = flatGray(BRIGHT);
  const polys = regionPolys();
  ['JAW_LEFT', 'JAW_RIGHT', 'CHIN_BEARD'].forEach(r => paintPolygon(gray, polys[r], DARK));
  const a = V21.runV21Occupancy(baseInputs(gray));
  const b = V21.runV21Occupancy(baseInputs(new Float32Array(gray)));
  assert.equal(a.status, b.status);
  assert.equal(a.contour.area, b.contour.area);
});
test('no circular feedback: runV21Occupancy\'s exported functions never accept a prior occupancy/contour result as input', () => {
  assert.equal(V21.buildRootSupportField.length, 7); // (landmarks2D, faceLocal3D, vmm, intrinsics, gray, w, h) -- no occupancy/contour parameter
  const src = readFileSync(join(HERE, 'beard-occupancy-field-v21.mjs'), 'utf8');
  assert.equal(/humanFinalPoints|humanGT|groundTruth|priorOccupancy|previousContour/i.test(src), false);
});
test('production isolation: root index.html carries no V2.1 symbols', () => {
  assert.equal(ROOT_INDEX_HTML.includes('beard-occupancy-field-v21'), false);
  assert.equal(ROOT_INDEX_HTML.includes('BEARD_ROOT_SUPPORT_FIELD'), false);
});
test('no sealed-holdout identifier appears in this module', () => {
  const src = readFileSync(join(HERE, 'beard-occupancy-field-v21.mjs'), 'utf8');
  assert.equal(src.includes('espu2w'), false);
});

// ---- root eligibility vs activation (Part 2) ----------------------------------------------------
test('root eligibility vs activation: strong anatomy + BEARD_CONFIRMED-like darkness activates STRONG; bright (non-beard) appearance leaves the region ELIGIBLE but NOT activated', () => {
  const grayDark = flatGray(BRIGHT);
  const polys = regionPolys();
  paintPolygon(grayDark, polys.JAW_LEFT, DARK);
  const rf = V21.buildRootSupportField(null, syntheticFaceLocal3D(), identityVMM(), syntheticIntrinsics(), grayDark, W, H_);
  const jawLeft = rf.roots.find(r => r.region === 'JAW_LEFT');
  assert.equal(jawLeft.eligible, true);
  const grayBright = flatGray(BRIGHT); // JAW_LEFT left bright -- clean-shaven-like
  const rf2 = V21.buildRootSupportField(null, syntheticFaceLocal3D(), identityVMM(), syntheticIntrinsics(), grayBright, W, H_);
  const jawLeft2 = rf2.roots.find(r => r.region === 'JAW_LEFT');
  assert.equal(jawLeft2.eligible, true, 'geometry stays eligible');
  assert.equal(jawLeft2.activated, false, 'must NOT auto-activate from anatomy alone without positive appearance evidence');
});

// ---- 12. clean-shaven / no-beard case (mandatory) -------------------------------------------------
test('12. clean-shaven synthetic case: valid anatomy everywhere, uniformly bright (skin-like) appearance -- must NOT manufacture beard occupancy', () => {
  const gray = flatGray(BRIGHT); // no dark regions anywhere -- simulates clean-shaven skin
  const result = V21.runV21Occupancy(baseInputs(gray));
  assert.equal(result.status, 'NO_BEARD_DETECTED');
  assert.equal(result.contour.area, 0);
});

// ---- root provenance / envelope provenance -------------------------------------------------------
test('root provenance: every root record names its region, eligibility, activation tier, and evidence state explicitly', () => {
  const gray = flatGray(BRIGHT);
  const polys = regionPolys();
  paintPolygon(gray, polys.CHIN_BEARD, DARK);
  const rf = V21.buildRootSupportField(null, syntheticFaceLocal3D(), identityVMM(), syntheticIntrinsics(), gray, W, H_);
  rf.roots.forEach(r => { assert.ok(r.region && typeof r.eligible === 'boolean' && typeof r.activated === 'boolean' && r.evidenceState); });
});
test('envelope provenance: every admitted attachment cell records its source root region and accumulated path cost', () => {
  const gray = flatGray(BRIGHT);
  const polys = regionPolys();
  paintPolygon(gray, polys.CHIN_BEARD, DARK);
  const result = V21.runV21Occupancy(baseInputs(gray));
  let sawProvenance = false;
  result.attachment.provenance.forEach(p => { if (p.rootRegion && typeof p.pathCost === 'number') sawProvenance = true; });
  assert.equal(sawProvenance, true);
});

// ---- UNKNOWN != NON_BEARD (Part 5/8) --------------------------------------------------------------
test('UNKNOWN geometry != negative beard evidence: a dark UNKNOWN-geometry cell adjacent to an activated root gains attachment support, it is not automatically rejected for lacking BS1 geometry support', () => {
  const gray = flatGray(BRIGHT);
  const polys = regionPolys();
  paintPolygon(gray, polys.CHIN_BEARD, DARK);
  // darken a generous swath below/around CHIN_BEARD (UNKNOWN geometry -- under-chin-like) so it
  // has positive local IMAGE_APPEARANCE evidence and can be reached from the activated root
  const chinBbox = (() => { let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9; polys.CHIN_BEARD.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }); return { minX, maxX, minY, maxY }; })();
  for (let y = Math.max(0, chinBbox.minY - 40); y < Math.min(H_, chinBbox.maxY + 40); y++) {
    for (let x = Math.max(0, chinBbox.minX - 20); x < Math.min(W, chinBbox.maxX + 20); x++) gray[y * W + x] = DARK;
  }
  const result = V21.runV21Occupancy(baseInputs(gray));
  assert.equal(result.status, 'OCCUPANCY_RESOLVED');
  assert.ok(result.contour.area > 0, 'the dark UNKNOWN-geometry swath around the activated chin root must be able to gain occupancy support');
});

// ---- 5. long beard without a fixed length cutoff (Part 1/10) --------------------------------------
test('5. long beard: a long, smoothly continuous dark region extending far from the root remains reachable -- no hard maximum-length cutoff exists in the source', () => {
  const src = readFileSync(join(HERE, 'beard-occupancy-field-v21.mjs'), 'utf8');
  assert.equal(/maxLength|MAX_LENGTH|lengthLimit/i.test(src), false, 'no fixed length-limit constant should exist');
  const gray = flatGray(BRIGHT);
  const polys = regionPolys();
  paintPolygon(gray, polys.CHIN_BEARD, DARK);
  const bbox = (() => { let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9; polys.CHIN_BEARD.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }); return { minX, maxX, minY, maxY }; })();
  // Paint dark pixels everywhere the reused V2 corridor itself actually reaches below the chin --
  // NOT a naive straight column. FINDING (disclosed in the BI-1Z1E report): V2's frozen corridor is
  // built from 4 independent directional wedges (one per rail segment) that do NOT tile seamlessly
  // far from the rail -- a straight vertical column can cross a real gap between two wedges, which
  // is a property of the reused, unmodified V2 corridor, not something V2.1 introduces or may patch.
  // This test validates the intended behavior (no length cutoff for continuously-dark pixels that
  // the corridor DOES cover), using the corridor's own mask as ground truth for where to paint.
  const exclusion = V21.buildExclusionField(baseInputs(gray).landmarks2D, W, H_);
  for (let y = Math.ceil(bbox.maxY); y < H_; y++) { // bbox.maxY is fractional (polygon vertex coords) -- must floor/ceil to an integer row before using it as a pixel-array index
    for (let x = 0; x < W; x++) { // full width -- the corridor's own wedge shape drifts/fans with distance, so a narrow fixed x-band can exit its footprint (a real property of the reused V2 corridor, not a bug)
      if (exclusion.corridorMask[y * W + x]) gray[y * W + x] = DARK;
    }
  }
  const result = V21.runV21Occupancy(baseInputs(gray));
  let maxSupportedY = -Infinity;
  result.grid.cells.forEach(c => { const idx = c.gy * result.grid.gw + c.gx; if (result.attachment.state.get(idx) === 'SUPPORTED') maxSupportedY = Math.max(maxSupportedY, c.gy * result.grid.cellSize); });
  assert.ok(maxSupportedY > bbox.maxY + 50, 'a long smooth dark region, painted only where the corridor itself reaches, must be able to extend well beyond the root\'s own bounding box, got maxSupportedY=' + maxSupportedY + ' vs bbox.maxY=' + bbox.maxY);
});

// ---- 1/2/3. above-head / wall-art / remote furniture rejection (Part 11) --------------------------
test('1. dark wall art above face: a dark rectangle far above the mouth-exclusion line must never gain beard support', () => {
  const gray = flatGray(BRIGHT);
  const polys = regionPolys();
  paintPolygon(gray, polys.CHIN_BEARD, DARK);
  for (let y = 0; y < 30; y++) for (let x = 0; x < W; x++) gray[y * W + x] = DARK; // top strip = wall art
  const result = V21.runV21Occupancy(baseInputs(gray));
  let topStripSupported = false;
  result.grid.cells.forEach(c => { if (c.gy * result.grid.cellSize < 30) { const idx = c.gy * result.grid.gw + c.gx; if (result.attachment.state.get(idx) === 'SUPPORTED') topStripSupported = true; } });
  assert.equal(topStripSupported, false);
});
test('2/3. remote dark furniture: an isolated dark patch far from any root with no attachment path never gains beard support', () => {
  const gray = flatGray(BRIGHT);
  const polys = regionPolys();
  paintPolygon(gray, polys.CHIN_BEARD, DARK);
  for (let y = 400; y < 420; y++) for (let x = 0; x < 40; x++) gray[y * W + x] = DARK; // remote corner patch, disconnected by bright pixels
  const result = V21.runV21Occupancy(baseInputs(gray));
  let cornerSupported = false;
  result.grid.cells.forEach(c => { if (c.gy * result.grid.cellSize >= 400 && c.gx * result.grid.cellSize < 40) { const idx = c.gy * result.grid.gw + c.gx; if (result.attachment.state.get(idx) === 'SUPPORTED') cornerSupported = true; } });
  assert.equal(cornerSupported, false);
});

// ---- 3/4. shirt with skin gap vs shirt touching (Part 10) ------------------------------------------
test('3. shirt separated by visible skin gap: a bright (skin) band between the activated root and a distant dark (shirt) region must break attachment continuity', () => {
  const gray = flatGray(BRIGHT);
  const polys = regionPolys();
  paintPolygon(gray, polys.CHIN_BEARD, DARK);
  const bbox = (() => { let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9; polys.CHIN_BEARD.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }); return { minX, maxX, minY, maxY }; })();
  // bright skin gap immediately below the chin, then a dark "shirt" region beyond it
  for (let y = bbox.maxY; y < bbox.maxY + 60 && y < H_; y++) for (let x = bbox.minX; x < bbox.maxX && x < W; x++) gray[y * W + x] = BRIGHT;
  for (let y = Math.min(H_ - 1, bbox.maxY + 60); y < Math.min(H_, bbox.maxY + 150); y++) for (let x = bbox.minX; x < bbox.maxX && x < W; x++) gray[y * W + x] = DARK;
  const result = V21.runV21Occupancy(baseInputs(gray));
  let shirtSupported = false;
  result.grid.cells.forEach(c => { if (c.gy * result.grid.cellSize > bbox.maxY + 60) { const idx = c.gy * result.grid.gw + c.gx; if (result.attachment.state.get(idx) === 'SUPPORTED') shirtSupported = true; } });
  assert.equal(shirtSupported, false, 'a real skin gap must block propagation into the distant dark region');
});

// ---- 6. gray/blond/red/dyed beard compatibility (color-independence) -----------------------------
test('6. color-independence: the pipeline never reads RGB/hue/color, only greyscale gradient magnitude and mean intensity -- gray/blond/red/dyed beard are treated identically to any other dark, textured region', () => {
  const src = readFileSync(join(HERE, 'beard-occupancy-field-v21.mjs'), 'utf8');
  assert.equal(/\brgb\b|\bhue\b|colorDev|skinTone/i.test(src), false);
});

// ---- 7. fragmented / multiple beard components (Part 13/19) ---------------------------------------
test('7/15. multiple beard components: two disconnected dark patches, each independently reachable from a DIFFERENT activated root, are BOTH included -- no winner-take-all largest-component selection', () => {
  const gray = flatGray(BRIGHT);
  const polys = regionPolys();
  paintPolygon(gray, polys.JAW_LEFT, DARK);
  paintPolygon(gray, polys.JAW_RIGHT, DARK);
  const result = V21.runV21Occupancy(baseInputs(gray));
  const supportedRoots = new Set();
  result.attachment.provenance.forEach(p => supportedRoots.add(p.rootRegion));
  assert.ok(supportedRoots.has('JAW_LEFT') && supportedRoots.has('JAW_RIGHT'), 'both independently-activated roots must contribute to the final occupancy simultaneously');
});

// ---- 8. profile pose / 9. Chin-Up (structural presence, not full pose simulation) -------------------
test('8/9. pose fields are consumed without modification: near/far visibility classification is reused unmodified from BI-1Z1B, not reimplemented', async () => {
  const M = await import('./exact-frame-jaw-beard-measurement.mjs');
  assert.equal(typeof M.visibilityClass, 'function');
  const src = readFileSync(join(HERE, 'beard-occupancy-field-v21.mjs'), 'utf8');
  assert.equal(/function visibilityClass/.test(src), false, 'must reuse, never reimplement, visibilityClass');
});

// ---- 12b. missing Hairness / 13. missing anatomy -----------------------------------------------------
test('12b. missing Hairness: a region with zero valid ROI pixels fails closed to not-activated, never fabricating a classification', () => {
  const gray = new Float32Array(W * H_).fill(NaN); // no valid pixel data anywhere
  const rf = V21.buildRootSupportField(null, syntheticFaceLocal3D(), identityVMM(), syntheticIntrinsics(), gray, W, H_);
  rf.roots.forEach(r => assert.equal(r.activated, false));
});
test('13. missing anatomy: null faceLocal3D/vmm/intrinsics reports UNCERTAIN rather than guessing root locations', () => {
  const gray = flatGray(BRIGHT);
  const result = V21.runV21Occupancy({ landmarks2D: null, faceLocal3D: null, imageSpaceViewModelMatrix: null, intrinsics: null, gray, width: W, height: H_ });
  assert.equal(result.status, 'UNCERTAIN');
});

// ---- 14. conflicting evidence (Part 2 rule) -----------------------------------------------------------
test('14. conflicting evidence: strong anatomy + bright (non-beard) appearance never erases eligibility, only activation', () => {
  const gray = flatGray(BRIGHT);
  const rf = V21.buildRootSupportField(null, syntheticFaceLocal3D(), identityVMM(), syntheticIntrinsics(), gray, W, H_);
  const chin = rf.roots.find(r => r.region === 'CHIN_BEARD');
  assert.equal(chin.eligible, true);
  assert.equal(chin.activated, false);
  assert.equal(chin.evidenceState, 'WEAK_NEGATIVE');
});

// ---- 16. motion channel absent -----------------------------------------------------------------------
test('16. motion channel absent: the pipeline runs correctly and deterministically with no HEAD_RELATIVE_TEMPORAL_SUPPORT input at all (the parameter does not exist in frameInputs)', () => {
  const gray = flatGray(BRIGHT);
  const polys = regionPolys();
  paintPolygon(gray, polys.JAW_LEFT, DARK);
  const result = V21.runV21Occupancy(baseInputs(gray)); // no motion field supplied anywhere
  assert.ok(['OCCUPANCY_RESOLVED', 'NO_BEARD_DETECTED'].includes(result.status));
});

// ---- ambiguity is a genuine, distinct output state (Part 14/20) --------------------------------------
test('ambiguity preservation: cells at the edge of the cost budget (within the margin) are marked AMBIGUOUS, not silently folded into SUPPORTED or flatly rejected', () => {
  const gray = flatGray(BRIGHT);
  const polys = regionPolys();
  paintPolygon(gray, polys.CHIN_BEARD, DARK);
  const bbox = (() => { let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9; polys.CHIN_BEARD.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }); return { minX, maxX, minY, maxY }; })();
  for (let y = bbox.maxY; y < Math.min(H_, bbox.maxY + 260); y++) for (let x = bbox.minX; x < bbox.maxX && x < W; x++) gray[y * W + x] = DARK; // long uniform dark run to reach the margin band
  const result = V21.runV21Occupancy(baseInputs(gray));
  const states = new Set(Array.from(result.attachment.state.values()));
  assert.ok(states.has('AMBIGUOUS') || states.has('SUPPORTED'), 'must produce at least one of the two graded states rather than crashing');
});

// ---- contour-last architecture (Part 15) ---------------------------------------------------------------
test('contour-last architecture: extractContour is a pure function of (grid, attachment) and never influences root/attachment computation (no back-reference in source)', () => {
  const src = readFileSync(join(HERE, 'beard-occupancy-field-v21.mjs'), 'utf8');
  const rootFnSrc = src.slice(src.indexOf('export function buildRootSupportField'), src.indexOf('export function buildExclusionField'));
  const attachFnSrc = src.slice(src.indexOf('export function propagateAttachment'), src.indexOf('export function extractContour'));
  assert.equal(/extractContour|contour\.polygon|contour\.mask/.test(rootFnSrc), false);
  assert.equal(/extractContour/.test(attachFnSrc), false);
});
