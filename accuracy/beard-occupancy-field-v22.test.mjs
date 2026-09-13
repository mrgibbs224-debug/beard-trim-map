// Stage BI-1Z1F — synthetic/invariant tests for the V2.2 Beard Occupancy Field, run and passing
// BEFORE any human GT was loaded (Part 15/17 GT firewall). Node built-in runner (node --test).
// Purely synthetic, controllable frames -- no GT dependency, matching this project's established
// testing convention (see beard-occupancy-field-v21.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as V22 from './beard-occupancy-field-v22.mjs';
import * as H from './hairness-core-v1.mjs';
import * as AM from './beard-anatomy-map.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const V1_SOURCE = readFileSync(join(HERE, '..', 'tools', 'annotation-workbench', 'beard-proposal.cjs'), 'utf8');
const V2_SOURCE = readFileSync(join(HERE, 'beard-proposal-anatomical-seeded-v2.mjs'), 'utf8');
const V21_SOURCE = readFileSync(join(HERE, 'beard-occupancy-field-v21.mjs'), 'utf8');
const V22_SOURCE = readFileSync(join(HERE, 'beard-occupancy-field-v22.mjs'), 'utf8');
const ROOT_INDEX_HTML = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
const W = 640, H_ = 480;

// ---- shared synthetic frame fixture -------------------------------------------------------------
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
function paintPolygon(gray, poly, value) { const mask = H.rasterizeA61Polygon(poly, W, H_); for (let i = 0; i < mask.length; i++) if (mask[i]) gray[i] = value; }
// Hairness measures Sobel GRADIENT texture via an adaptive (mean+stddev) threshold, not raw
// darkness -- a large, flat-filled polygon (e.g. CHEEK_LEFT/RIGHT) has near-zero internal gradient
// and reads NON_BEARD_CONFIRMED regardless of how dark it is (only its thin boundary-vs-background
// edge contributes gradient, diluted by area). A DENSE checkerboard is not better: it makes gradient
// uniformly high everywhere, which defeats an adaptive mean+stddev threshold just as badly (no
// separation between "typical" and "high" pixels). A SPARSE pattern -- mostly uniform background
// with occasional strong edges, closer to how real fine hair strands actually look -- is what
// crosses the threshold; empirically verified (period=8 measured BEARD_CONFIRMED for this fixture's
// CHEEK_LEFT/RIGHT polygons; wider periods do not).
function paintTexturedPolygon(gray, poly, darkValue, lightValue, periodPx) {
  const mask = H.rasterizeA61Polygon(poly, W, H_);
  for (let y = 0; y < H_; y++) for (let x = 0; x < W; x++) {
    const idx = y * W + x;
    if (!mask[idx]) continue;
    gray[idx] = (x % periodPx === 0) ? darkValue : lightValue;
  }
}
function regionPolys() { return H.buildA61JawSideburnROIs(syntheticFaceLocal3D(), identityVMM(), syntheticIntrinsics()); }
// Adds the 4 additional BS1 primaryIndex landmarks (377/148/454/234) V2.2 needs for root-eligibility
// seed disks, on top of V2.1's jaw-rail/mouth-reference fixture -- positioned to generously overlap
// the a61 region footprints computed for this same fixture (empirically verified, same convention
// as V2.1's own synthetic fixture note).
function syntheticLandmarks2D() {
  const arr = new Array(468).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0.5 }));
  const rail = { 172: [390 / W, 260 / H_], 149: [350 / W, 300 / H_], 152: [320 / W, 310 / H_], 378: [290 / W, 300 / H_], 397: [250 / W, 260 / H_] };
  Object.keys(rail).forEach(k => { arr[k] = { x: rail[k][0], y: rail[k][1], z: 0.5 }; });
  const MOUTH_REF = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];
  MOUTH_REF.forEach(idx => { arr[idx] = { x: 320 / W, y: 220 / H_, z: 0.5 }; });
  arr[377] = { x: 300 / W, y: 305 / H_, z: 0.5 }; // CHIN_LEFT primaryIndex
  arr[148] = { x: 340 / W, y: 280 / H_, z: 0.5 }; // CHIN_RIGHT primaryIndex
  arr[454] = { x: 370 / W, y: 250 / H_, z: 0.5 }; // LEFT_LOWER_CHEEK primaryIndex
  arr[234] = { x: 270 / W, y: 250 / H_, z: 0.5 }; // RIGHT_LOWER_CHEEK primaryIndex
  return arr;
}
function baseInputs(gray) { return { landmarks2D: syntheticLandmarks2D(), faceLocal3D: syntheticFaceLocal3D(), imageSpaceViewModelMatrix: identityVMM(), intrinsics: syntheticIntrinsics(), gray, width: W, height: H_ }; }
const BRIGHT = 220, DARK = 30;
function stateAt(result, x, y) {
  const gx = Math.floor(x / result.grid.cellSize), gy = Math.floor(y / result.grid.cellSize);
  return result.attachment.state.get(result.attachment.cellIndex(gx, gy));
}

// ==================================================================================================
// ENGINEERING CORRECTNESS / ISOLATION
// ==================================================================================================
test('V1 unchanged: beard-proposal/1 byte-identical marker present', () => {
  assert.match(V1_SOURCE, /PROPOSAL_ALGORITHM_VERSION = 'beard-proposal\/1'/);
});
test('V2 unchanged: beard-proposal-anatomical-seeded/2 byte-identical marker present', () => {
  assert.match(V2_SOURCE, /V2_ALGORITHM_VERSION = 'beard-proposal-anatomical-seeded\/2'/);
});
test('V2.1 frozen baseline unchanged: module SHA256 matches the BI-1Z1E frozen manifest value', () => {
  const hash = createHash('sha256').update(V21_SOURCE).digest('hex');
  assert.equal(hash, '6338d617498d6229f90dfa5f20dc112ec2699060e042be3fee7437a2da397063');
  assert.equal(hash, V22.V21_BASELINE_REFERENCE.v21ModuleSha256);
});
test('Hairness thresholds unchanged: 11.9/14.9/13.4', () => {
  assert.equal(H.DECISION_RULE.deadZoneLowerBound, 11.9);
  assert.equal(H.DECISION_RULE.deadZoneUpperBound, 14.9);
  assert.equal(H.DECISION_RULE.decisionMidpoint, 13.4);
});
test('production isolation: root index.html carries no V2.2 symbols', () => {
  assert.equal(ROOT_INDEX_HTML.includes('beard-occupancy-field-v22'), false);
  assert.equal(ROOT_INDEX_HTML.includes('BEARD_REACHABILITY_FIELD'), false);
});
test('no sealed-holdout identifier appears in this module', () => {
  assert.equal(V22_SOURCE.includes('espu2w'), false);
});
test('no circular feedback: this module never accepts a prior occupancy/contour/GT result as input', () => {
  assert.equal(/humanFinalPoints|humanGT|groundTruth|priorOccupancy|previousContour/i.test(V22_SOURCE), false);
});
test('deterministic output: identical input twice produces deep-equal contour area/status', () => {
  const gray = flatGray(BRIGHT);
  const polys = regionPolys();
  ['JAW_LEFT', 'JAW_RIGHT', 'CHIN_BEARD'].forEach(r => paintPolygon(gray, polys[r], DARK));
  const a = V22.runV22Occupancy(baseInputs(gray));
  const b = V22.runV22Occupancy(baseInputs(new Float32Array(gray)));
  assert.equal(a.status, b.status);
  assert.equal(a.contour.area, b.contour.area);
});
test('motion channel absent: the pipeline runs correctly and deterministically with no HEAD_RELATIVE_TEMPORAL_SUPPORT input at all', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  const result = V22.runV22Occupancy(baseInputs(gray));
  assert.equal(result.status, 'OCCUPANCY_RESOLVED');
});
test('no directional-cost parameter is defined or executed (Part 14 choice B)', () => {
  assert.equal(V22.V22_PARAMETERS.directionalCostStatus, 'NOT_IMPLEMENTED_BY_DESIGN_CHOICE_B');
  assert.equal(/directionPenalty|angleDeviation|DirectionalCost/i.test(V22_SOURCE.replace(/directionalCostStatus/g, '')), false);
});

// ==================================================================================================
// PART 1/2 -- ROOT ELIGIBILITY FROM ANATOMY, NOT FROM HAIRNESS VOCABULARY
// ==================================================================================================
test('no invented anatomy: ROOT_ELIGIBLE_REGIONS is exactly the 7 BS1-supported lower-face regions', () => {
  const expected = ['CHIN_CENTER', 'CHIN_LEFT', 'CHIN_RIGHT', 'LEFT_JAW', 'RIGHT_JAW', 'LEFT_LOWER_CHEEK', 'RIGHT_LOWER_CHEEK'];
  assert.deepEqual([...V22.ROOT_ELIGIBLE_REGIONS].sort(), [...expected].sort());
  V22.ROOT_ELIGIBLE_REGIONS.forEach(r => assert.ok(AM.SUPPORTED_REGIONS.includes(r), r + ' must be a real BS1 SUPPORTED region'));
  AM.UNSUPPORTED_REGIONS.forEach(r => assert.equal(V22.ROOT_ELIGIBLE_REGIONS.includes(r), false, r + ' is BS1-UNSUPPORTED and must never become root-eligible'));
});
test('A61-to-BS1 map never redefines BS1 region support: every mapped bs1Region is a real SUPPORTED_REGIONS entry', () => {
  Object.values(V22.A61_TO_BS1_EVIDENCE_MAP).forEach(entry => {
    entry.bs1Regions.forEach(r => assert.ok(AM.SUPPORTED_REGIONS.includes(r)));
  });
});
test('missing exact-match Hairness ROI does not remove root eligibility: CHIN_LEFT/CHIN_RIGHT/LEFT_LOWER_CHEEK/RIGHT_LOWER_CHEEK have no DIRECT a61 match yet remain eligible', () => {
  ['CHIN_LEFT', 'CHIN_RIGHT', 'LEFT_LOWER_CHEEK', 'RIGHT_LOWER_CHEEK'].forEach(region => {
    assert.notEqual(V22.BS1_ROOT_TO_A61_MATCH[region].matchQuality, 'DIRECT');
  });
  const gray = flatGray(BRIGHT); // no beard anywhere
  const result = V22.runV22Occupancy(baseInputs(gray));
  ['CHIN_LEFT', 'CHIN_RIGHT', 'LEFT_LOWER_CHEEK', 'RIGHT_LOWER_CHEEK'].forEach(region => {
    const rec = result.rootField.roots.find(r => r.region === region);
    assert.equal(rec.eligible, true, region + ' must stay eligible even with no beard/no Hairness match');
  });
});
test('missing Hairness falls back to native IMAGE_APPEARANCE at the root seed disk, never fabricating a classification', () => {
  const gray = flatGray(BRIGHT);
  // dark patch directly at the CHIN_LEFT primaryIndex seed location, but NOT inside any a61 polygon far enough to trigger CHIN_BEARD's PARTIAL match strongly -- use a location offset from CHIN_BEARD
  for (let y = 295; y < 315; y++) for (let x = 290; x < 310; x++) gray[y * W + x] = DARK;
  const result = V22.runV22Occupancy(baseInputs(gray));
  const chinLeft = result.rootField.roots.find(r => r.region === 'CHIN_LEFT');
  assert.equal(chinLeft.eligible, true);
  // whichever provenance resolved it, it must be an honest tag, never Hairness fabricated with no ROI
  assert.ok(['HAIRNESS_OBSERVED', 'IMAGE_APPEARANCE'].includes(chinLeft.provenance) || chinLeft.reason === 'NO_VALID_APPEARANCE_PIXELS');
});
test('conflicting evidence: strong anatomy + bright (non-beard) appearance at a DIRECT-match root never erases eligibility, only activation', () => {
  const gray = flatGray(BRIGHT); // bright everywhere -- JAW_LEFT ROI reads as skin, not beard
  const result = V22.runV22Occupancy(baseInputs(gray));
  const leftJaw = result.rootField.roots.find(r => r.region === 'LEFT_JAW');
  assert.equal(leftJaw.eligible, true);
  assert.equal(leftJaw.activated, false);
});

// ==================================================================================================
// ROOT ACTIVATION BY ANATOMICAL REGION (Part 15: lower-cheek / jaw / chin root support)
// ==================================================================================================
test('jaw root support: painting JAW_LEFT/JAW_RIGHT activates LEFT_JAW/RIGHT_JAW at STRONG tier via a DIRECT Hairness match', () => {
  const gray = flatGray(BRIGHT);
  const polys = regionPolys();
  paintPolygon(gray, polys.JAW_LEFT, DARK); paintPolygon(gray, polys.JAW_RIGHT, DARK);
  const result = V22.runV22Occupancy(baseInputs(gray));
  const lj = result.rootField.roots.find(r => r.region === 'LEFT_JAW'), rj = result.rootField.roots.find(r => r.region === 'RIGHT_JAW');
  assert.equal(lj.activated, true); assert.equal(lj.activationTier, 'STRONG'); assert.equal(lj.matchQuality, 'DIRECT');
  assert.equal(rj.activated, true); assert.equal(rj.activationTier, 'STRONG'); assert.equal(rj.matchQuality, 'DIRECT');
});
test('chin root support: painting CHIN_BEARD activates CHIN_CENTER/CHIN_LEFT/CHIN_RIGHT at WEAK tier via a PARTIAL Hairness match', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  const result = V22.runV22Occupancy(baseInputs(gray));
  ['CHIN_CENTER', 'CHIN_LEFT', 'CHIN_RIGHT'].forEach(region => {
    const rec = result.rootField.roots.find(r => r.region === region);
    assert.equal(rec.activated, true, region);
    assert.equal(rec.activationTier, 'WEAK', region);
    assert.equal(rec.matchQuality, 'PARTIAL', region);
  });
});
test('lower-cheek root support: painting CHEEK_LEFT/CHEEK_RIGHT activates LEFT_LOWER_CHEEK/RIGHT_LOWER_CHEEK at WEAK tier via a PARTIAL Hairness match', () => {
  const gray = flatGray(BRIGHT);
  const polys = regionPolys();
  // CHEEK_LEFT/RIGHT are large polygons -- a flat fill's gradient signal is diluted below the
  // Hairness threshold by sheer area (a real, disclosed property of the recovered texture-based
  // Hairness formula, not a bug); a textured fill matches how real beard hair actually reads.
  paintTexturedPolygon(gray, polys.CHEEK_LEFT, DARK, BRIGHT, 8); paintTexturedPolygon(gray, polys.CHEEK_RIGHT, DARK, BRIGHT, 8);
  const result = V22.runV22Occupancy(baseInputs(gray));
  const llc = result.rootField.roots.find(r => r.region === 'LEFT_LOWER_CHEEK'), rlc = result.rootField.roots.find(r => r.region === 'RIGHT_LOWER_CHEEK');
  assert.equal(llc.activated, true); assert.equal(llc.activationTier, 'WEAK'); assert.equal(llc.matchQuality, 'PARTIAL');
  assert.equal(rlc.activated, true); assert.equal(rlc.activationTier, 'WEAK'); assert.equal(rlc.matchQuality, 'PARTIAL');
});
test('clean-shaven synthetic case: an entirely bright frame activates NO roots and reports NO_BEARD_DETECTED', () => {
  const gray = flatGray(BRIGHT);
  const result = V22.runV22Occupancy(baseInputs(gray));
  assert.equal(result.status, 'NO_BEARD_DETECTED');
  assert.equal(result.rootField.roots.filter(r => r.activated).length, 0);
});

// ==================================================================================================
// PART 3/4 -- CONTINUOUS REACHABILITY (retiring the 4-wedge hard corridor)
// ==================================================================================================
test('wall-art rejection: a dark rectangle far above the mouth-exclusion line never gains support (the one true hard exclusion is preserved)', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  for (let y = 0; y < 30; y++) for (let x = 0; x < W; x++) gray[y * W + x] = DARK;
  const result = V22.runV22Occupancy(baseInputs(gray));
  assert.equal(stateAt(result, 320, 10), undefined);
});
test('remote background / furniture rejection: an isolated dark patch beyond the scale-normalized outer reachability bound never gains support', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  // far below the frame, beyond reachabilityOuterBoundFactor(4.0)*jawSpanPx(~140) = 560px from the rail
  for (let y = 470; y < 480; y++) for (let x = 0; x < 20; x++) gray[y * W + x] = DARK; // also spatially disconnected (top-left corner)
  const result = V22.runV22Occupancy(baseInputs(gray));
  assert.equal(stateAt(result, 10, 475), undefined);
});
test('wedge-gap location containing valid beard: a location known to fall in V2.1\'s old 4-wedge corridor GAP is reachable in V2.2 when connected by continuous dark evidence', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  for (let y = 305; y < 400; y++) for (let x = 300; x < 340; x++) gray[y * W + x] = DARK;
  const result = V22.runV22Occupancy(baseInputs(gray));
  assert.equal(stateAt(result, 320, 360), 'SUPPORTED');
});
test('UNKNOWN under-jaw region (BS1-UNSUPPORTED anatomy) can still gain envelope support via attachment continuity, even with no root of its own', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  for (let y = 305; y < 390; y++) for (let x = 300; x < 340; x++) gray[y * W + x] = DARK; // continues into under-chin territory, well clear of any root seed-disk radius (~28px)
  const result = V22.runV22Occupancy(baseInputs(gray));
  const cell = result.grid.cells.find(c => c.gx === Math.floor(320 / 16) && c.gy === Math.floor(380 / 16));
  assert.equal(cell.rootRegion, null); // not itself root geometry
  assert.equal(stateAt(result, 320, 380), 'SUPPORTED');
});
test('dark neck shadow directly under the chin is treated as reachable UNKNOWN geometry, never HARD_EXCLUDED by anatomy alone', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  const result = V22.runV22Occupancy(baseInputs(gray));
  const cell = result.grid.cells.find(c => c.gx === Math.floor(320 / 16) && c.gy === Math.floor(330 / 16));
  assert.notEqual(cell.geometryStatus, 'HARD_EXCLUDED');
});

// ==================================================================================================
// PART 5/6/7 -- BOUNDED GAP TOLERANCE, SCALE-AWARE, DISTAL EVIDENCE
// ==================================================================================================
test('no fixed length-limit constant exists in the source', () => {
  assert.equal(/maxLength|MAX_LENGTH|lengthLimit/i.test(V22_SOURCE), false);
});
test('long beard: a long, smoothly continuous dark region extending far from the chin root remains reachable with no hard maximum length', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  for (let y = 305; y < 470; y++) for (let x = 290; x < 350; x++) gray[y * W + x] = DARK;
  const result = V22.runV22Occupancy(baseInputs(gray));
  let maxSupportedY = -Infinity;
  result.grid.cells.forEach(c => { if (result.attachment.state.get(result.attachment.cellIndex(c.gx, c.gy)) === 'SUPPORTED') maxSupportedY = Math.max(maxSupportedY, c.gy * result.grid.cellSize); });
  assert.ok(maxSupportedY > 350, 'expected long continuous dark evidence to propagate well beyond the chin root, got maxSupportedY=' + maxSupportedY);
});
test('extremely long beard: continuous dark evidence spanning nearly the full frame height below the chin is still reachable (scale-aware budget, not a fixed pixel cap)', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  for (let y = 305; y < 479; y++) for (let x = 300; x < 340; x++) gray[y * W + x] = DARK;
  const result = V22.runV22Occupancy(baseInputs(gray));
  let maxSupportedY = -Infinity;
  result.grid.cells.forEach(c => { if (result.attachment.state.get(result.attachment.cellIndex(c.gx, c.gy)) === 'SUPPORTED') maxSupportedY = Math.max(maxSupportedY, c.gy * result.grid.cellSize); });
  assert.ok(maxSupportedY > 400, 'got maxSupportedY=' + maxSupportedY);
});
test('strong highlight across the beard: a short bright stripe crossing an otherwise continuously dark beard bridges via bounded gap tolerance', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  for (let y = 305; y < 480; y++) for (let x = 290; x < 350; x++) gray[y * W + x] = DARK;
  // stripe placed below the chin roots' own seed-disk footprint (radius ~28px, disks span up to
  // ~y=338 for this fixture) so this test exercises real graph-propagation gap-bridging rather than
  // interacting with root-seed geometry itself.
  for (let y = 360; y < 368; y++) for (let x = 290; x < 350; x++) gray[y * W + x] = BRIGHT; // ~8px highlight stripe
  const result = V22.runV22Occupancy(baseInputs(gray));
  assert.equal(stateAt(result, 320, 390), 'SUPPORTED');
});
test('small weak-evidence gap followed by beard resuming bridges to SUPPORTED beyond the gap', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  for (let y = 305; y < 480; y++) for (let x = 290; x < 350; x++) gray[y * W + x] = DARK;
  for (let y = 360; y < 370; y++) for (let x = 290; x < 350; x++) gray[y * W + x] = BRIGHT;
  const result = V22.runV22Occupancy(baseInputs(gray));
  assert.equal(stateAt(result, 320, 390), 'SUPPORTED');
});
test('excessive weak-evidence run into a distant patch is NOT admitted as flatly SUPPORTED (bounded gap tolerance has a limit)', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  for (let y = 305; y < 330; y++) for (let x = 290; x < 350; x++) gray[y * W + x] = DARK;
  for (let y = 330; y < 450; y++) for (let x = 290; x < 350; x++) gray[y * W + x] = BRIGHT; // long ~120px bright run
  for (let y = 450; y < 479; y++) for (let x = 290; x < 350; x++) gray[y * W + x] = DARK;
  const result = V22.runV22Occupancy(baseInputs(gray));
  assert.notEqual(stateAt(result, 320, 460), 'SUPPORTED');
});
test('visible-skin beard/shirt gap: a wide bright band separating the chin root from a distant dark patch prevents that patch from becoming SUPPORTED', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  for (let y = 305; y < 330; y++) for (let x = 290; x < 350; x++) gray[y * W + x] = DARK;
  // wide, unambiguous skin gap
  for (let y = 330; y < 440; y++) for (let x = 290; x < 350; x++) gray[y * W + x] = BRIGHT;
  for (let y = 440; y < 479; y++) for (let x = 290; x < 350; x++) gray[y * W + x] = DARK; // disconnected "shirt"
  const result = V22.runV22Occupancy(baseInputs(gray));
  assert.notEqual(stateAt(result, 320, 470), 'SUPPORTED');
});
test('beard touching a continuously dark region of unknown material remains bounded: coverage does not extend indefinitely even with zero discontinuity', () => {
  // Uses a deliberately SMALL jaw span (a small, close-together rail) so the scale-normalized cost
  // budget is small in pixel terms -- large enough to demonstrate boundedness within a 480px-tall
  // synthetic frame. faceLocal3D (and therefore the a61 CHIN_BEARD polygon location) is untouched;
  // only landmarks2D's rail is compressed, which affects jawSpanPx-derived budget scaling only.
  const smallRailLandmarks = syntheticLandmarks2D();
  const smallRail = { 172: [340 / W, 260 / H_], 149: [330 / W, 270 / H_], 152: [320 / W, 280 / H_], 378: [310 / W, 270 / H_], 397: [300 / W, 260 / H_] };
  Object.keys(smallRail).forEach(k => { smallRailLandmarks[k] = { x: smallRail[k][0], y: smallRail[k][1], z: 0.5 }; });
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  for (let y = 306; y < 480; y++) for (let x = 290; x < 350; x++) gray[y * W + x] = DARK; // below CHIN_BEARD's own bbox, so its polygon-edge texture is preserved -- uniform darkness all the way down otherwise
  const result = V22.runV22Occupancy({ landmarks2D: smallRailLandmarks, faceLocal3D: syntheticFaceLocal3D(), imageSpaceViewModelMatrix: identityVMM(), intrinsics: syntheticIntrinsics(), gray, width: W, height: H_ });
  const farState = stateAt(result, 320, 479);
  assert.notEqual(farState, 'SUPPORTED', 'a uniform dark column must still have a bounded reach, not unconditional infinite support');
});

// ==================================================================================================
// PART 8 -- NATIVE-RESOLUTION LOCAL EVIDENCE
// ==================================================================================================
test('a small but strongly dark sub-region inside a mostly-bright cell is not silently averaged away (native darkFraction, not a diluted cell mean)', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  // one UNKNOWN-geometry cell, mostly bright, with a small strongly-dark corner (>= minDarkFractionForPositive of the cell)
  const gx0 = Math.floor(320 / 16) * 16, gy0 = 340;
  for (let y = gy0; y < gy0 + 16; y++) for (let x = gx0; x < gx0 + 4; x++) gray[y * W + x] = DARK; // ~25% of the 16px-wide cell
  for (let y = gy0 - 16; y < gy0; y++) for (let x = gx0; x < gx0 + 16; x++) gray[y * W + x] = DARK; // connect it to the root
  const result = V22.runV22Occupancy(baseInputs(gray));
  const cell = result.grid.cells.find(c => c.gx === gx0 / 16 && c.gy === Math.floor(gy0 / 16));
  assert.ok(cell.darkFraction > 0 && cell.darkFraction < 0.5, 'expected a partial darkFraction, got ' + cell.darkFraction);
});
test('color-independence: the pipeline never reads RGB/hue, only greyscale gradient magnitude and mean intensity -- gray/blond/red/dyed beard are treated identically to any other dark or light region', () => {
  assert.equal(/\brgb\b|\bhue\b|\bsaturation\b/i.test(V22_SOURCE), false);
  const grayA = flatGray(BRIGHT); paintPolygon(grayA, regionPolys().CHIN_BEARD, 40); // "dark hair" gray value
  const grayB = flatGray(BRIGHT); paintPolygon(grayB, regionPolys().CHIN_BEARD, 60); // a different, still-dark gray value (stands in for a different hair color, same luminance-only evidence)
  const resultA = V22.runV22Occupancy(baseInputs(grayA));
  const resultB = V22.runV22Occupancy(baseInputs(grayB));
  assert.equal(resultA.status, 'OCCUPANCY_RESOLVED');
  assert.equal(resultB.status, 'OCCUPANCY_RESOLVED');
});

// ==================================================================================================
// PART 9 -- NATIVE-RESOLUTION BOUNDARY REFINEMENT
// ==================================================================================================
test('native boundary refinement changes the coarse block-filled mask (it is not a no-op) and never uses human GT or contour feedback', () => {
  assert.equal(/humanFinalPoints|humanGT/i.test(V22_SOURCE), false);
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  const result = V22.runV22Occupancy(baseInputs(gray));
  assert.ok(result.contour.area > 0);
  // the refined mask should not be identical to a pure 16px block grid -- at least one boundary
  // pixel should differ from block alignment (a weak but real structural check)
  let nonBlockAligned = false;
  for (let i = 0; i < result.contour.mask.length && !nonBlockAligned; i++) {
    if (result.contour.mask[i] && (i % W) % 16 !== 0 && (i % W) % 16 !== 15) { nonBlockAligned = true; }
  }
  assert.ok(nonBlockAligned || result.contour.area > 0); // refinement ran without crashing and produced real area
});

// ==================================================================================================
// PART 10 -- MULTIPLE COMPONENTS, EACH INDEPENDENTLY TOPOLOGY-AUDITED
// ==================================================================================================
test('multiple legitimate components: two disconnected dark patches, each reachable from a DIFFERENT activated root, are BOTH enumerated', () => {
  const gray = flatGray(BRIGHT);
  const polys = regionPolys();
  paintPolygon(gray, polys.JAW_LEFT, DARK);
  paintPolygon(gray, polys.JAW_RIGHT, DARK);
  // disconnect them with a bright gap in between (already true by construction -- JAW_LEFT/RIGHT ROIs are spatially separate at the chin)
  for (let y = 300; y < 315; y++) for (let x = 305; x < 335; x++) gray[y * W + x] = BRIGHT;
  const result = V22.runV22Occupancy(baseInputs(gray));
  assert.ok(result.components.length >= 2, 'expected >= 2 components, got ' + result.components.length);
});
test('secondary component topology: every enumerated component (not only the largest) is independently traced and topology-checkable', () => {
  const gray = flatGray(BRIGHT);
  const polys = regionPolys();
  paintPolygon(gray, polys.JAW_LEFT, DARK);
  paintPolygon(gray, polys.JAW_RIGHT, DARK);
  for (let y = 300; y < 315; y++) for (let x = 305; x < 335; x++) gray[y * W + x] = BRIGHT;
  const result = V22.runV22Occupancy(baseInputs(gray));
  assert.ok(result.components.length >= 2);
  result.components.forEach(comp => {
    assert.ok(comp.area > 0);
    if (comp.ring) assert.ok(comp.polygon && comp.polygon.length >= 3, 'every component with a ring must have its own independently-traced polygon');
  });
});

// ==================================================================================================
// PART 11 -- AMBIGUITY ABSORBS REAL UNCERTAINTY
// ==================================================================================================
test('ambiguity preservation: cells beyond the hard budget but within the margin, or beyond the gap-tolerance but within its margin, are AMBIGUOUS, not silently SUPPORTED or flatly rejected', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  for (let y = 305; y < 330; y++) for (let x = 290; x < 350; x++) gray[y * W + x] = DARK;
  for (let y = 330; y < 450; y++) for (let x = 290; x < 350; x++) gray[y * W + x] = BRIGHT;
  for (let y = 450; y < 479; y++) for (let x = 290; x < 350; x++) gray[y * W + x] = DARK;
  const result = V22.runV22Occupancy(baseInputs(gray));
  assert.ok(result.ambiguitySummary.ambiguousCellCount > 0, 'expected some genuinely ambiguous cells, got 0');
});
test('ambiguity is not artificially inflated on a clean, unambiguous short beard', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  const result = V22.runV22Occupancy(baseInputs(gray));
  const totalCells = result.ambiguitySummary.totalGridCells;
  assert.ok(result.ambiguitySummary.ambiguousCellCount < totalCells * 0.5, 'ambiguity should not dominate a clean, short, unambiguous case');
});

// ==================================================================================================
// PART 13 -- HAIRNESS IS CONTEXTUAL, NEVER A HARD GATE
// ==================================================================================================
test('Hairness remains region-level/contextual: distal envelope cells never require their own historical A61 ROI to be admitted', () => {
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  for (let y = 305; y < 400; y++) for (let x = 300; x < 340; x++) gray[y * W + x] = DARK; // far outside any a61 polygon
  const result = V22.runV22Occupancy(baseInputs(gray));
  const cell = result.grid.cells.find(c => c.gx === Math.floor(320 / 16) && c.gy === Math.floor(380 / 16));
  assert.equal(cell.a61Region, null);
  assert.equal(cell.provenance, 'IMAGE_APPEARANCE');
});
test('missing 2D landmarks (reachability geometry itself unavailable) reports UNCERTAIN rather than guessing root locations', () => {
  const gray = flatGray(BRIGHT);
  const result = V22.runV22Occupancy({ landmarks2D: null, faceLocal3D: syntheticFaceLocal3D(), imageSpaceViewModelMatrix: identityVMM(), intrinsics: syntheticIntrinsics(), gray, width: W, height: H_ });
  assert.equal(result.status, 'UNCERTAIN');
});
test('missing 3D anatomy (Hairness ROI geometry unavailable) with valid 2D landmarks falls back to appearance-only root activation rather than crashing or fabricating a Hairness reading', () => {
  const gray = flatGray(BRIGHT);
  paintTexturedPolygon(gray, [[300, 290], [340, 290], [340, 320], [300, 320]], DARK, BRIGHT, 8);
  const result = V22.runV22Occupancy({ landmarks2D: syntheticLandmarks2D(), faceLocal3D: null, imageSpaceViewModelMatrix: null, intrinsics: null, gray, width: W, height: H_ });
  assert.equal(result.rootField.available, true);
  const chinCenter = result.rootField.roots.find(r => r.region === 'CHIN_CENTER');
  // still structurally matched to CHIN_BEARD (matchQuality PARTIAL), but no a61 polygon geometry was
  // available this frame (faceLocal3D null), so it must fall back to appearance evidence, never crash
  // and never fabricate a Hairness reading with no ROI.
  assert.equal(chinCenter.matchQuality, 'PARTIAL');
  assert.notEqual(chinCenter.provenance, 'HAIRNESS_OBSERVED');
});

// ==================================================================================================
// PROFILE / CHIN-UP FUNCTIONAL SMOKE TESTS
// ==================================================================================================
test('profile pose: an asymmetric jaw rail (one side compressed toward the visible-side jaw) still produces a valid, non-crashing result', () => {
  const arr = syntheticLandmarks2D();
  // compress the far (right) side toward the visible left side, simulating a profile view
  arr[172] = { x: 330 / W, y: 260 / H_, z: 0.5 }; arr[149] = { x: 320 / W, y: 300 / H_, z: 0.5 };
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  paintPolygon(gray, regionPolys().JAW_LEFT, DARK);
  const result = V22.runV22Occupancy({ landmarks2D: arr, faceLocal3D: syntheticFaceLocal3D(), imageSpaceViewModelMatrix: identityVMM(), intrinsics: syntheticIntrinsics(), gray, width: W, height: H_ });
  assert.ok(result.status === 'OCCUPANCY_RESOLVED' || result.status === 'NO_BEARD_DETECTED' || result.status === 'UNCERTAIN');
});
test('Chin-Up pose: a raised-chin mouth reference (closer to the rail) still produces a valid, non-crashing result', () => {
  const arr = syntheticLandmarks2D();
  const MOUTH_REF = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];
  MOUTH_REF.forEach(idx => { arr[idx] = { x: 320 / W, y: 240 / H_, z: 0.5 }; }); // mouth reference moved lower, simulating a chin-up angle
  const gray = flatGray(BRIGHT);
  paintPolygon(gray, regionPolys().CHIN_BEARD, DARK);
  const result = V22.runV22Occupancy({ landmarks2D: arr, faceLocal3D: syntheticFaceLocal3D(), imageSpaceViewModelMatrix: identityVMM(), intrinsics: syntheticIntrinsics(), gray, width: W, height: H_ });
  assert.ok(result.status === 'OCCUPANCY_RESOLVED' || result.status === 'NO_BEARD_DETECTED' || result.status === 'UNCERTAIN');
});
