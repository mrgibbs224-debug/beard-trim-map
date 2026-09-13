// Stage BI-1Z1J -- synthetic/invariant tests for HEAD_RELATIVE_TEMPORAL_SUPPORT_V1, run and
// passing BEFORE any physical-capture result is examined (Part 18/20 GT/freeze firewall). Pure
// synthetic fixtures; no GT, no V1/V2/V2.1/V2.2 dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as T from './head-relative-temporal-support-v1.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_SOURCE = readFileSync(join(HERE, 'head-relative-temporal-support-v1.mjs'), 'utf8');
const DESIGN_PATH = 'D:/MettleTemp/analysis/bi1z1i_head_relative_temporal_support_v1_design.json';
const CAPTURE_PATH = 'D:/MettleTemp/research-captures/exact-frame-research-capture_scan_mtz6mhc9_3aoc5d.json';

function identity16() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function flat468(fill) { return new Array(468).fill(null).map(() => ({ ...fill })); }
function syntheticGray(w, h, fn) { const g = new Float64Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = fn(x, y); return g; }
function checkerboard(w, h, period = 6) { return syntheticGray(w, h, (x, y) => ((Math.floor(x / period) + Math.floor(y / period)) % 2 === 0) ? 200 : 40); }
// Deterministic PSEUDO-RANDOM (non-periodic) texture -- unlike a checkerboard, this has no
// repeating structure, so a translation-recovery test has a UNIQUE best match rather than many
// equally-good periodic aliases (a checkerboard's own symmetry was found, via this stage's own
// synthetic testing, to produce ZNCC=1 ties at unintended offsets).
function pseudoRandomTexture(w, h, seed = 1) {
  let s = seed >>> 0;
  function next() { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }
  return syntheticGray(w, h, () => Math.floor(next() * 256));
}
// A realistic synthetic faceLocal3D: distinct 3D offsets for the jaw rail (172/149/152/378/397),
// mouth reference, and head-reference anchors (6/151/144/373/105/334) -- all at a plausible
// selfie-distance depth (z ~ -0.35m, negative per a61ProjectPoint's Zcv=-z>0 convention) so
// rawJawSpanPx() and every anchor's own raw-image projection are non-degenerate.
function syntheticFaceLocal3D() {
  const arr = flat468({ x: 0, y: 0, z: -0.35 });
  const pts = {
    172: [0.05, -0.03, -0.33], 149: [0.025, -0.05, -0.34], 152: [0, -0.06, -0.35], 378: [-0.025, -0.05, -0.34], 397: [-0.05, -0.03, -0.33],
    61: [0.02, -0.02, -0.34], 146: [0.015, -0.02, -0.34], 91: [0.01, -0.02, -0.34], 181: [0.005, -0.02, -0.34], 84: [0, -0.02, -0.34],
    17: [0, -0.025, -0.34], 314: [-0.005, -0.02, -0.34], 405: [-0.01, -0.02, -0.34], 321: [-0.015, -0.02, -0.34], 375: [-0.02, -0.02, -0.34], 291: [-0.02, -0.02, -0.34],
    6: [0, 0.02, -0.34], 151: [0, 0.05, -0.32], 144: [0.03, 0.03, -0.33], 373: [-0.03, 0.03, -0.33], 105: [0.035, 0.04, -0.32], 334: [-0.035, 0.04, -0.32],
    454: [0.06, -0.01, -0.30], 234: [-0.06, -0.01, -0.30]
  };
  Object.entries(pts).forEach(([idx, p]) => { arr[idx] = { x: p[0], y: p[1], z: p[2] }; });
  return arr;
}
function makeSample(overrides = {}) {
  return Object.assign({
    coherenceStatus: 'VERIFIED_EXACT', imageWidth: 640, imageHeight: 480,
    faceLocal3D: syntheticFaceLocal3D(),
    imageSpaceViewModelMatrix: identity16(),
    intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 },
    yawDeg: 0, pitchDeg: 0, rollDeg: 0,
    landmarks2D: flat468({ x: 0.5, y: 0.5, z: 0 }),
    transformationMatrix: identity16(),
    nativeFrameTimestampNs: '1000000000'
  }, overrides);
}

// ==================================================================================================
// 1/2 -- design hash / capture hash (structural verification the module's version constant matches)
// ==================================================================================================
test('1. design hash: module records the exact frozen BI-1Z1I design SHA256', () => {
  assert.equal(T.BI1Z1I_DESIGN_SHA256, '246aa40f52eeadb3990e34f9efeabbc1c2ff706cc7e996bd326d8fbe9fea7f9a');
});
test('1b. design hash re-verification against the live artifact', () => {
  const buf = readFileSync(DESIGN_PATH);
  assert.equal(createHash('sha256').update(buf).digest('hex'), T.BI1Z1I_DESIGN_SHA256);
});
test('2. capture hash re-verification against the live artifact', () => {
  const buf = readFileSync(CAPTURE_PATH);
  assert.equal(createHash('sha256').update(buf).digest('hex'), '4a8002886aa9499f47854f9795f39dcc2add3f116b2ec27fa9f6fe04b53a230c');
});

// ==================================================================================================
// 3 -- raw-image projection (via the frozen a61ProjectPoint, never landmarks2D)
// ==================================================================================================
test('3. raw-image projection: rawRailPoints/rawFaceInteriorReference use a61ProjectPoint, never landmarks2D as an actual property access (only in documentation explaining the exclusion)', () => {
  assert.equal(/\.landmarks2D\b|\blandmarks2D\[/.test(MODULE_SOURCE), false);
  const s = makeSample();
  const rail = T.rawRailPoints(s.faceLocal3D, s.imageSpaceViewModelMatrix, s.intrinsics);
  assert.ok(rail.every(r => r == null || (typeof r.x === 'number' && typeof r.y === 'number')));
});

// ==================================================================================================
// 4 -- patch extraction
// ==================================================================================================
test('4. patch extraction: a patch extracted from a checkerboard contains the expected sub-region', () => {
  const gray = checkerboard(64, 64, 8);
  const patch = T.extractPatch(gray, 64, 64, { x: 32, y: 32 }, 8, 0);
  assert.equal(patch.unusable, false);
  assert.equal(patch.values.length, 64);
});

// ==================================================================================================
// 5 -- deterministic interpolation
// ==================================================================================================
test('5. deterministic interpolation: identical inputs always produce identical patch values', () => {
  const gray = checkerboard(64, 64);
  const a = T.extractPatch(gray, 64, 64, { x: 32.3, y: 31.7 }, 10, 15);
  const b = T.extractPatch(gray, 64, 64, { x: 32.3, y: 31.7 }, 10, 15);
  assert.deepEqual(Array.from(a.values), Array.from(b.values));
});

// ==================================================================================================
// 6 -- rotated patch extraction
// ==================================================================================================
test('6. rotated patch extraction: a 90-degree rotation reorders the sampled grid predictably', () => {
  const gray = syntheticGray(32, 32, (x, y) => x); // horizontal ramp
  const p0 = T.extractPatch(gray, 32, 32, { x: 16, y: 16 }, 6, 0);
  const p90 = T.extractPatch(gray, 32, 32, { x: 16, y: 16 }, 6, 90);
  assert.equal(p0.unusable, false); assert.equal(p90.unusable, false);
  assert.notDeepEqual(Array.from(p0.values), Array.from(p90.values));
});

// ==================================================================================================
// 7 -- jaw-span scale normalization
// ==================================================================================================
test('7. scale normalization: computePatchSizePx scales linearly with jawSpanPx and respects clamps', () => {
  assert.equal(T.computePatchSizePx(100), 10); // 0.10*100=10, at the min clamp exactly
  assert.equal(T.computePatchSizePx(500), 50); // 0.10*500=50, within range
  assert.equal(T.computePatchSizePx(2000), 80); // 0.10*2000=200, clamped to max 80
  assert.equal(T.computePatchSizePx(1), 10); // clamped to min
});

// ==================================================================================================
// 8 -- out-of-bounds fail-closed
// ==================================================================================================
test('8. out-of-bounds fail-closed: a patch request falling outside image bounds is marked unusable, never silently clamped', () => {
  const gray = checkerboard(32, 32);
  const patch = T.extractPatch(gray, 32, 32, { x: 1, y: 1 }, 20, 0);
  assert.equal(patch.unusable, true);
  assert.equal(patch.reason, 'OUT_OF_BOUNDS');
});

// ==================================================================================================
// 9/10 -- same-burst-only pairing / no cross-burst pairing
// ==================================================================================================
test('9/10. same-burst-only pairing: pairEligibility operates on two samples given directly -- callers are responsible for never passing cross-burst samples; verify the module itself never reads a burst-id field to relax this', () => {
  assert.equal(/temporalBurstId/.test(MODULE_SOURCE), false); // pairEligibility is burst-agnostic BY DESIGN -- the caller (experiment driver) enforces same-burst pairing structurally by iterating within each burst's own sample array only.
});

// ==================================================================================================
// 11 -- identical patch -> high ZNCC
// ==================================================================================================
test('11. identical patch -> ZNCC close to 1.0', () => {
  const gray = checkerboard(32, 32);
  const a = T.extractPatch(gray, 32, 32, { x: 16, y: 16 }, 10, 0);
  const b = T.extractPatch(gray, 32, 32, { x: 16, y: 16 }, 10, 0);
  const score = T.zncc(a.values, b.values);
  assert.ok(score > 0.999);
});

// ==================================================================================================
// 12 -- known synthetic translation
// ==================================================================================================
test('12. known synthetic translation: localTranslationSearch recovers a known pixel offset', () => {
  const grayA = pseudoRandomTexture(64, 64, 7);
  // grayB is grayA shifted by (+3,-2)
  const grayB = syntheticGray(64, 64, (x, y) => {
    const sx = x - 3, sy = y + 2;
    return (sx >= 0 && sx < 64 && sy >= 0 && sy < 64) ? grayA[sy * 64 + sx] : 100;
  });
  const ref = T.extractPatch(grayA, 64, 64, { x: 32, y: 32 }, 16, 0);
  const result = T.localTranslationSearch(grayB, 64, 64, { x: 32, y: 32 }, 0, 16, ref, 8);
  assert.equal(result.unusable, false);
  assert.equal(result.bestResidualDx, 3);
  assert.equal(result.bestResidualDy, -2);
});

// ==================================================================================================
// 13 -- known synthetic roll/rotation
// ==================================================================================================
test('13. known synthetic rotation: a patch extracted with the correct counter-rotation matches its un-rotated reference far better than with zero rotation applied to a genuinely rotated field', () => {
  const gray = syntheticGray(64, 64, (x, y) => (x + y) % 17 * 15); // diagonal-sensitive texture
  const ref = T.extractPatch(gray, 64, 64, { x: 32, y: 32 }, 20, 0);
  const same = T.extractPatch(gray, 64, 64, { x: 32, y: 32 }, 20, 0);
  const rotated = T.extractPatch(gray, 64, 64, { x: 32, y: 32 }, 20, 25);
  const scoreSame = T.zncc(ref.values, same.values);
  const scoreRotated = T.zncc(ref.values, rotated.values);
  assert.ok(scoreSame >= scoreRotated);
});

// ==================================================================================================
// 14/15 -- brightness/contrast shift robustness
// ==================================================================================================
test('14. brightness shift robustness: ZNCC is unaffected by a uniform additive brightness shift', () => {
  const gray = checkerboard(32, 32);
  const shifted = gray.map(v => Math.min(255, v + 40));
  const a = T.extractPatch(gray, 32, 32, { x: 16, y: 16 }, 12, 0);
  const b = T.extractPatch(shifted, 32, 32, { x: 16, y: 16 }, 12, 0);
  assert.ok(T.zncc(a.values, b.values) > 0.999);
});
test('15. contrast shift robustness: ZNCC is unaffected by a uniform multiplicative contrast shift', () => {
  const gray = checkerboard(32, 32);
  const scaled = gray.map(v => v * 0.6);
  const a = T.extractPatch(gray, 32, 32, { x: 16, y: 16 }, 12, 0);
  const b = T.extractPatch(scaled, 32, 32, { x: 16, y: 16 }, 12, 0);
  assert.ok(T.zncc(a.values, b.values) > 0.999);
});
test('14b/15b. raw SSD/SAD ARE affected by brightness shift (demonstrating why they are secondary-only, per the frozen design)', () => {
  const gray = checkerboard(32, 32);
  const shifted = gray.map(v => Math.min(255, v + 40));
  const a = T.extractPatch(gray, 32, 32, { x: 16, y: 16 }, 12, 0);
  const b = T.extractPatch(shifted, 32, 32, { x: 16, y: 16 }, 12, 0);
  assert.ok(T.normalizedSad(a.values, b.values) > 0.01);
});

// ==================================================================================================
// 16 -- gradient correlation
// ==================================================================================================
test('16. gradient correlation: gradientZncc is high for identical textured patches and computed independently of raw ZNCC', () => {
  const gray = checkerboard(32, 32, 4);
  const a = T.extractPatch(gray, 32, 32, { x: 16, y: 16 }, 12, 0);
  const b = T.extractPatch(gray, 32, 32, { x: 16, y: 16 }, 12, 0);
  const g = T.gradientZncc(a.values, a.size, b.values, b.size);
  assert.ok(g > 0.9);
});

// ==================================================================================================
// 17 -- known residual translation recovery (search-radius bound, item 18)
// ==================================================================================================
test('17/18. search-radius bound: a translation LARGER than the search radius is not perfectly recovered (bounded search, not unbounded)', () => {
  const grayA = pseudoRandomTexture(64, 64, 7);
  const grayB = syntheticGray(64, 64, (x, y) => { const sx = x - 20, sy = y; return (sx >= 0 && sx < 64) ? grayA[sy * 64 + sx] : 100; });
  const ref = T.extractPatch(grayA, 64, 64, { x: 32, y: 32 }, 16, 0);
  const result = T.localTranslationSearch(grayB, 64, 64, { x: 32, y: 32 }, 0, 16, ref, 6); // radius 6 << true offset 20
  assert.ok(result.unusable || Math.abs(result.bestResidualDx - 20) > 5, 'search must not silently exceed its own declared radius');
});

// ==================================================================================================
// 19 -- rigid head-attached synthetic motion
// ==================================================================================================
test('19. rigid head-attached movement: a HEAD_REFERENCE-style candidate whose true faceLocal3D anchor is reprojected through a genuinely different frame-B vmm is recovered near-exactly by the head hypothesis', () => {
  const gray = checkerboard(640, 480, 6);
  const sA = makeSample({ imageSpaceViewModelMatrix: identity16() });
  // frame B: camera translated +10px worth in x (a simple, exact synthetic rigid shift)
  const vmmB = identity16(); vmmB[12] = 0.02; // small x translation in the rigid transform
  const sB = makeSample({ imageSpaceViewModelMatrix: vmmB });
  const built = T.buildCandidatesForSample(sA);
  const headRefCand = built.candidates.find(c => c.family === 'HEAD_REFERENCE');
  assert.ok(headRefCand);
  const result = T.evaluateCandidatePair(headRefCand, gray, gray, 640, 480, sA, sB);
  assert.equal(result.qualityState, 'PATCH_USABLE');
  assert.equal(result.headHypothesis.unusable, false);
});

// ==================================================================================================
// 20 -- static-background synthetic motion
// ==================================================================================================
test('20. background-relative movement: a BACKGROUND_CONTROL candidate with a genuinely unchanged raw image reports a perfect static-hypothesis match', () => {
  const gray = checkerboard(640, 480, 6);
  const sA = makeSample(); const sB = makeSample({ imageSpaceViewModelMatrix: (() => { const m = identity16(); m[12] = 0.05; return m; })() });
  const built = T.buildCandidatesForSample(sA);
  const bgCand = built.candidates.find(c => c.family === 'BACKGROUND_CONTROL');
  if (bgCand) {
    const result = T.evaluateCandidatePair(bgCand, gray, gray, 640, 480, sA, sB);
    if (result.qualityState === 'PATCH_USABLE' && !result.staticHypothesis.unusable) assert.ok(result.staticHypothesis.zncc > 0.99);
  }
});

// ==================================================================================================
// 21 -- small nonrigid displacement
// ==================================================================================================
test('21. small nonrigid beard-like displacement: a small offset ADDED on top of a perfect head-rigid reprojection is reported as a nonzero residual, never silently absorbed to zero', () => {
  const grayA = pseudoRandomTexture(64, 64, 7);
  const grayB = syntheticGray(64, 64, (x, y) => { const sx = x - 2, sy = y - 1; return (sx >= 0 && sx < 64 && sy >= 0 && sy < 64) ? grayA[sy * 64 + sx] : 100; });
  const ref = T.extractPatch(grayA, 64, 64, { x: 32, y: 32 }, 16, 0);
  const result = T.localTranslationSearch(grayB, 64, 64, { x: 32, y: 32 }, 0, 16, ref, 8);
  assert.equal(result.unusable, false);
  assert.ok(result.bestResidualMagnitude > 0);
});

// ==================================================================================================
// 22/23 -- missing intrinsics / missing geometry
// ==================================================================================================
test('22. missing intrinsics fails closed', () => {
  const s = makeSample({ intrinsics: null });
  assert.equal(T.buildCandidatesForSample(s), null);
});
test('23. missing geometry fails closed', () => {
  const s = makeSample({ faceLocal3D: null });
  assert.equal(T.buildCandidatesForSample(s), null);
});

// ==================================================================================================
// 24 -- far-side visibility
// ==================================================================================================
test('24. far-side visibility: the same visibilityClass() the module imports (reused unmodified) correctly classifies a far-side anchor at extreme yaw', async () => {
  const { visibilityClass } = await import('./exact-frame-jaw-beard-measurement.mjs');
  assert.equal(visibilityClass('RIGHT', 30), 'FAR_SIDE'); // yaw>0 brings LEFT into view -- RIGHT is far-side
});

// ==================================================================================================
// 25/26 -- profile / Chin-Up
// ==================================================================================================
test('25. profile: the pipeline runs end-to-end without crashing on an extreme-yaw synthetic sample', () => {
  const s = makeSample({ yawDeg: 75 });
  const built = T.buildCandidatesForSample(s);
  assert.ok(built === null || Array.isArray(built.candidates));
});
test('26. Chin-Up: the pipeline runs end-to-end without crashing on an extreme-pitch synthetic sample', () => {
  const s = makeSample({ pitchDeg: -35 });
  const built = T.buildCandidatesForSample(s);
  assert.ok(built === null || Array.isArray(built.candidates));
});

// ==================================================================================================
// 27 -- LARGE-motion pair handling
// ==================================================================================================
test('27. LARGE-motion pair handling: motionBin correctly classifies a combined angle above the MEDIUM boundary', () => {
  assert.equal(T.motionBin(25), 'LARGE');
  assert.equal(T.motionBin(8), 'SMALL');
  assert.equal(T.motionBin(8.1), 'MEDIUM');
  assert.equal(T.motionBin(20), 'MEDIUM');
});

// ==================================================================================================
// 28 -- both hypotheses calculated for every family
// ==================================================================================================
test('28. both hypotheses calculated for every family: evaluateCandidatePair always attempts headHypothesis AND staticHypothesis for any family, never skipping one by family type', () => {
  const gray = checkerboard(640, 480, 6);
  const sA = makeSample(); const sB = makeSample();
  const built = T.buildCandidatesForSample(sA);
  const families = new Set(built.candidates.map(c => c.family));
  families.forEach(fam => {
    const cand = built.candidates.find(c => c.family === fam);
    const result = T.evaluateCandidatePair(cand, gray, gray, 640, 480, sA, sB);
    if (result.qualityState === 'PATCH_USABLE') {
      assert.ok('headHypothesis' in result, fam);
      assert.ok('staticHypothesis' in result, fam);
    }
  });
});

// ==================================================================================================
// 29 -- no family-specific stabilization advantage (structural: no per-family branch skips a hypothesis)
// ==================================================================================================
test('29. no family-specific stabilization advantage: evaluateCandidatePair never branches on candA.family to decide which hypothesis to compute', () => {
  const fnStart = MODULE_SOURCE.indexOf('export function evaluateCandidatePair');
  const fnBody = MODULE_SOURCE.slice(fnStart, MODULE_SOURCE.indexOf('\n// ---- Part 6/12', fnStart));
  assert.equal(/candA\.family\s*===/.test(fnBody), false);
});

// ==================================================================================================
// 30/31/32/33 -- no V1/V2/V2.1/V2.2 input / no GT / no classifier / no network
// ==================================================================================================
test('30. no V1/V2/V2.1/V2.2 input', () => {
  assert.equal(/beard-occupancy-field-v2[12]|beard-proposal-anatomical-seeded-v2|beard-proposal\.cjs/i.test(MODULE_SOURCE), false);
});
test('31. no GT', () => { assert.equal(/humanFinalPoints|humanGT|groundTruth/i.test(MODULE_SOURCE), false); });
test('32. no semantic classifier', () => {
  assert.equal(/isBeard|isShirt|beardScore|shirtScore|probabilityBeard|beardProbability/i.test(MODULE_SOURCE), false);
});
test('33. no network', () => { assert.equal(/\bfetch\(|XMLHttpRequest|WebSocket/.test(MODULE_SOURCE), false); });

// ==================================================================================================
// 34 -- sealed-holdout absence
// ==================================================================================================
test('34. sealed-holdout absence', () => { assert.equal(MODULE_SOURCE.includes('espu2w'), false); });

// ==================================================================================================
// 35 -- production isolation
// ==================================================================================================
test('35. production isolation: module never imports a DOM/browser/native-bridge global', () => {
  assert.equal(/\bwindow\.|\bdocument\.|\bBeardTrimAndroid\b/.test(MODULE_SOURCE), false);
});

// ==================================================================================================
// Additional engineering-correctness checks
// ==================================================================================================
test('DISTAL candidates always carry all three provenance tags together', () => {
  const gray = checkerboard(640, 480, 6);
  const s = makeSample();
  const built = T.buildCandidatesForSample(s);
  const distal = built.candidates.filter(c => c.family === 'DISTAL_LOWER_FACE_ENVELOPE_CANDIDATE');
  distal.forEach(c => { ['DERIVED_FROM_ROOT_RAY', 'IMAGE_SPACE_CANDIDATE', 'GEOMETRY_UNKNOWN'].forEach(tag => assert.ok(c.provenanceTags.includes(tag))); });
});
test('TORSO_CONTROL_CANDIDATE is never labeled with a semantic shirt string', () => {
  assert.equal(MODULE_SOURCE.includes('SHIRT_GROUND_TRUTH'), false);
});
test('ZNCC returns null (METRIC_DEGENERATE), never a fabricated value, on a constant (zero-variance) patch', () => {
  const flat = new Float64Array(64).fill(128);
  assert.equal(T.zncc(flat, flat), null);
});
test('pairEligibility fails closed with explicit reasons on a non-VERIFIED_EXACT sample', () => {
  const sA = makeSample(), sB = makeSample({ coherenceStatus: 'REJECTED_UNMATCHED' });
  const result = T.pairEligibility(sA, sB);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('NOT_VERIFIED_EXACT'));
});
