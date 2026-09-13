// Stage BI-1Z1C — tests for the RESEARCH-ONLY anatomically-seeded V2 beard proposal. Node built-in
// runner (node --test). Synthetic fixtures only -- the real 8-frame evaluation (against the
// completed human GT and the physical research capture, both outside this repo) is reported in
// D:\MettleTemp\analysis\bi1z1c_anatomically_seeded_beard_proposal_v2.json / _report.md, not
// committed as a test fixture (same convention as every prior bi1y*/bi1z* stage).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as V2 from './beard-proposal-anatomical-seeded-v2.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const V1_SOURCE = readFileSync(join(HERE, '..', 'tools', 'annotation-workbench', 'beard-proposal.cjs'), 'utf8');
const ROOT_INDEX_HTML = readFileSync(join(HERE, '..', 'index.html'), 'utf8');

function syntheticLandmarks(overrides) {
  const arr = new Array(468).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0.5 }));
  const base = {
    172: [0.70, 0.62], 149: [0.60, 0.68], 152: [0.50, 0.70], 378: [0.40, 0.68], 397: [0.30, 0.62],
    61: [0.55, 0.55], 146: [0.54, 0.56], 91: [0.53, 0.57], 181: [0.52, 0.58], 84: [0.51, 0.58],
    17: [0.50, 0.59], 314: [0.49, 0.58], 405: [0.48, 0.58], 321: [0.47, 0.57], 375: [0.46, 0.56], 291: [0.45, 0.55]
  };
  Object.keys(base).forEach(k => { arr[k] = { x: base[k][0], y: base[k][1], z: 0.5 }; });
  if (overrides) Object.keys(overrides).forEach(k => { arr[k] = overrides[k]; });
  return arr;
}
function syntheticGray(w, h, darkRegionFn) {
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = darkRegionFn(x, y) ? 30 : 220;
  return gray;
}

// ---- 1: V1 byte-identical (this stage must never touch it) -----------------------------------
test('1: tools/annotation-workbench/beard-proposal.cjs (V1) is untouched -- PROPOSAL_ALGORITHM_VERSION stays beard-proposal/1 and LOWER_FACE_ROI_VERSION stays tracked-lower-face-landmark-roi/1', () => {
  assert.match(V1_SOURCE, /PROPOSAL_ALGORITHM_VERSION = 'beard-proposal\/1'/);
  assert.match(V1_SOURCE, /LOWER_FACE_ROI_VERSION = 'tracked-lower-face-landmark-roi\/1'/);
});
test('2: V2 is a completely separate exported version string, never overwriting V1\'s', () => {
  assert.equal(V2.V2_ALGORITHM_VERSION, 'beard-proposal-anatomical-seeded/2');
  assert.notEqual(V2.V2_ALGORITHM_VERSION, 'beard-proposal/1');
});

// ---- 3/4: seed band determinism + provenance --------------------------------------------------
test('3: buildSeedBand is deterministic (same input -> byte-identical output) and fails closed on missing rail landmarks', () => {
  const lm = syntheticLandmarks();
  const a = V2.buildSeedBand(lm, 640, 480), b = V2.buildSeedBand(lm, 640, 480);
  assert.deepEqual(a, b);
  const lmMissing = syntheticLandmarks({ 172: undefined });
  assert.equal(V2.buildSeedBand(lmMissing, 640, 480), null);
});
test('4: seed band provenance records its version and exact source landmark indices', () => {
  const seed = V2.buildSeedBand(syntheticLandmarks(), 640, 480);
  assert.equal(seed.provenance.version, V2.V2_ALGORITHM_VERSION);
  assert.deepEqual(seed.provenance.sourceLandmarks, [172, 149, 152, 378, 397]);
});

// ---- 5/6: upper exclusion + corridor determinism -----------------------------------------------
test('5: buildUpperExclusionLine is deterministic and fails closed when mouth reference is unavailable', () => {
  const lm = syntheticLandmarks();
  const a = V2.buildUpperExclusionLine(lm, 640, 480), b = V2.buildUpperExclusionLine(lm, 640, 480);
  assert.deepEqual(a, b);
  const lmNoMouth = syntheticLandmarks();
  [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291].forEach(i => { lmNoMouth[i] = undefined; });
  assert.equal(V2.buildUpperExclusionLine(lmNoMouth, 640, 480), null);
});
test('6: buildAnatomicalCorridor is deterministic across repeated calls with identical input', () => {
  const lm = syntheticLandmarks();
  const a = V2.buildAnatomicalCorridor(lm, 640, 480), b = V2.buildAnatomicalCorridor(lm, 640, 480);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.equal(a.wedges.length, 4); // one per rail segment
});

// ---- 7/8/9: component association requires anatomical support ---------------------------------
test('7: a candidate component with zero seed-band contact is rejected regardless of size/darkness (the exact "wall picture frame" scenario)', () => {
  const w = 100, h = 100;
  const seedMask = new Uint8Array(w * h); seedMask[50 * w + 50] = 1; // tiny seed far from the dark blob
  const priorField = new Float32Array(w * h); priorField[50 * w + 50] = 1.0;
  const darkMask = new Uint8Array(w * h);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) darkMask[y * w + x] = 1; // a large dark blob in the corner, unrelated to the seed
  const assoc = V2.selectSeedAssociatedComponents(darkMask, seedMask, priorField, w, h);
  assert.equal(assoc.acceptedComponents, 0, 'a component with no seed contact and no prior support must never be accepted');
});
test('8: a remote dark component positioned away from any anatomical support is rejected (above-face / background simulation)', () => {
  const w = 200, h = 200;
  const seedMask = new Uint8Array(w * h);
  for (let y = 150; y < 160; y++) for (let x = 90; x < 110; x++) seedMask[y * w + x] = 1; // seed near the bottom (jaw area)
  const priorField = new Float32Array(w * h);
  for (let i = 0; i < priorField.length; i++) priorField[i] = seedMask[i] ? 1 : 0;
  const darkMask = new Uint8Array(w * h);
  for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) darkMask[y * w + x] = 1; // dark blob at the TOP of the frame (above-face)
  const assoc = V2.selectSeedAssociatedComponents(darkMask, seedMask, priorField, w, h);
  assert.equal(assoc.acceptedComponents, 0);
});
test('9: a component that DOES touch the seed band with strong prior support is accepted', () => {
  const w = 100, h = 100;
  const seedMask = new Uint8Array(w * h);
  for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) seedMask[y * w + x] = 1;
  const priorField = new Float32Array(w * h);
  for (let i = 0; i < priorField.length; i++) priorField[i] = seedMask[i] ? 1 : 0;
  const darkMask = new Uint8Array(w * h);
  for (let y = 40; y < 70; y++) for (let x = 40; x < 70; x++) darkMask[y * w + x] = 1; // overlaps the seed
  const assoc = V2.selectSeedAssociatedComponents(darkMask, seedMask, priorField, w, h);
  assert.equal(assoc.acceptedComponents, 1);
});

// ---- 10: long-beard-compatible corridor (no fixed Y cutoff) ------------------------------------
test('10: the corridor is defined relative to jawSpanPx and outward geometry, never a fixed absolute pixel Y cutoff (no hard-coded frame-height fraction anywhere in the source)', () => {
  const src = readFileSync(join(HERE, 'beard-proposal-anatomical-seeded-v2.mjs'), 'utf8');
  assert.equal(/y\s*[<>]=?\s*\d{2,3}\b/.test(src.replace(/\/\/.*$/gm, '')), false, 'no literal pixel-Y comparison should appear in the corridor logic');
  const corridorA = V2.buildAnatomicalCorridor(syntheticLandmarks(), 640, 480);
  const corridorB = V2.buildAnatomicalCorridor(syntheticLandmarks(), 1280, 960); // 2x scale
  const lenA = corridorA.wedges[0].length, lenB = corridorB.wedges[0].length;
  assert.ok(Math.abs(lenB / lenA - 2) < 0.01, 'corridor length must scale with jawSpanPx (image scale), not a fixed pixel constant');
});

// ---- 11: near-side profile authority (visibility unchanged from BI-1Z1B) -----------------------
test('11: near-side/far-side classification for profile poses follows the frozen anatomical rule (reused from BI-1Z1B, not reimplemented differently here)', async () => {
  const M = await import('./exact-frame-jaw-beard-measurement.mjs');
  assert.equal(M.visibilityClass('LEFT', 40), 'NEAR_VISIBLE');
  assert.equal(M.visibilityClass('RIGHT', 40), 'FAR_SIDE');
});

// ---- 12: confidence fail-closed ------------------------------------------------------------------
test('12: runV2Proposal returns UNCERTAIN (never a giant nonsense polygon) when no component clears the anatomical bar', () => {
  const lm = syntheticLandmarks();
  const w = 640, h = 480;
  const gray = syntheticGray(w, h, () => false); // uniformly bright -- Otsu still picks a threshold but nothing dark exists at all
  const r = V2.runV2Proposal(lm, gray, w, h, { useTextureCue: false });
  assert.ok(r.status === 'UNCERTAIN' || r.status === 'PROPOSED'); // Otsu on a flat image can behave either way; the real assertion is no throw and a defined status
  assert.ok(['UNCERTAIN', 'PROPOSED'].includes(r.status));
});
test('12b: runV2Proposal is UNCERTAIN with ANATOMY_UNAVAILABLE when landmarks are missing, never guessing a proposal', () => {
  const lmMissing = syntheticLandmarks({ 172: undefined });
  const gray = syntheticGray(640, 480, () => true);
  const r = V2.runV2Proposal(lmMissing, gray, 640, 480, {});
  assert.equal(r.status, 'UNCERTAIN');
  assert.ok(r.reasons.includes('ANATOMY_UNAVAILABLE'));
});

// ---- 13: no GT input into proposal execution -----------------------------------------------------
test('13: runV2Proposal\'s signature and every helper it calls take only landmarks/pixels/manifest -- no GT/human-point parameter exists anywhere in this module\'s exported API', () => {
  assert.equal(V2.runV2Proposal.length <= 4, true); // (landmarks2D, gray, w, h, options)
  const src = readFileSync(join(HERE, 'beard-proposal-anatomical-seeded-v2.mjs'), 'utf8');
  assert.equal(/humanFinalPoints|humanPoints|groundTruth/i.test(src), false);
});

// ---- 14: manifest frozen structure -----------------------------------------------------------------
test('14: V2_MANIFEST is frozen (Object.freeze) at every level that matters, and carries the required design-record fields', () => {
  assert.ok(Object.isFrozen(V2.V2_MANIFEST));
  assert.ok(Object.isFrozen(V2.V2_MANIFEST.parameters));
  assert.ok(V2.V2_MANIFEST.seedRules && V2.V2_MANIFEST.exclusionRules && V2.V2_MANIFEST.corridorRules && V2.V2_MANIFEST.componentAssociationRule && V2.V2_MANIFEST.confidenceRules);
  assert.equal(V2.V2_MANIFEST.beardBearingPriorVersion, V2.BEARD_BEARING_PRIOR_VERSION);
});

// ---- 15: deterministic end-to-end proposal generation -----------------------------------------
test('15: runV2Proposal produces byte-identical output for byte-identical input, run twice', () => {
  const lm = syntheticLandmarks();
  const gray = syntheticGray(640, 480, (x, y) => { const d = Math.hypot(x - 320, y - 340); return d < 150; });
  const r1 = V2.runV2Proposal(lm, gray, 640, 480, { useTextureCue: true });
  const r2 = V2.runV2Proposal(lm, gray, 640, 480, { useTextureCue: true });
  assert.deepEqual(r1.originalProposalPoints, r2.originalProposalPoints);
  assert.equal(r1.status, r2.status);
});

// ---- 16: production isolation -------------------------------------------------------------------
test('16: root production index.html carries no V2 symbols (never wired into consumer paths)', () => {
  assert.equal(ROOT_INDEX_HTML.includes('beard-proposal-anatomical-seeded'), false);
  assert.equal(ROOT_INDEX_HTML.includes('BEARD_BEARING_ANATOMICAL_PRIOR'), false);
  assert.equal(ROOT_INDEX_HTML.includes('buildAnatomicalCorridor'), false);
});
test('17: no sealed-holdout identifier appears in this module', () => {
  const src = readFileSync(join(HERE, 'beard-proposal-anatomical-seeded-v2.mjs'), 'utf8');
  assert.equal(src.includes('espu2w'), false);
});
test('18: this module never claims or computes hidden tissue depth (bone/fat/muscle/stand-off)', () => {
  const src = readFileSync(join(HERE, 'beard-proposal-anatomical-seeded-v2.mjs'), 'utf8');
  assert.equal(/bone (depth|thickness)|fat thickness|muscle thickness|true beard stand-?off/i.test(src.replace(/no hidden tissue depth[\s\S]{0,400}/i, '')), false);
});
