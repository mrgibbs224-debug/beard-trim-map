// Stage BI-1Z1C.1 — tests for the recovered/transcribed HIGH_GRADIENT_FRACTION Hairness Core V1
// adapter. Node built-in runner (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './hairness-core-v1.mjs';

// ---- 1-2: source discovery / provenance --------------------------------------------------------
test('1: HAIRNESS_CORE_SOURCE records the exact discovered manifest path and SHA256', () => {
  assert.equal(H.HAIRNESS_CORE_SOURCE.path, 'D:\\MettleTemp\\annotation\\bi1m_frozen_hairness_core_v1.json');
  assert.equal(H.HAIRNESS_CORE_SOURCE.sha256, 'ef458c0d1e681119cab6272617d6d5afa805b61f75911f1e4608850bdce31766');
});
test('2: the config fingerprint is honestly marked unverifiable (missing ROI geometry source), never claimed as verified', () => {
  assert.equal(H.HAIRNESS_CORE_SOURCE.configFingerprintVerifiable, false);
});

// ---- 3: exact replication proof against the manifest's OWN real historical numbers -------------
test('3: deriveDecisionRuleFromSamples EXACTLY reproduces the frozen manifest\'s decisionMidpoint/deadZoneLowerBound/deadZoneUpperBound from its own historicalTrainingSamples -- the replication proof', () => {
  const r = H.deriveDecisionRuleFromSamples(
    H.DECISION_RULE.historicalTrainingSamples.upperCheekSkin_n5,
    H.DECISION_RULE.historicalTrainingSamples.lowerCheekBeard_n5
  );
  assert.ok(Math.abs(r.skinMean - 11.68) < 1e-9, 'upperCheekSkin_mean must reproduce 11.68 exactly');
  assert.ok(Math.abs(r.beardMean - 15.12) < 1e-9, 'lowerCheekBeard_mean must reproduce 15.12 exactly');
  assert.ok(Math.abs(r.midpoint - 13.4) < 1e-9, 'decisionMidpoint must reproduce 13.4 exactly');
  assert.ok(Math.abs(r.deadZoneLowerBound - 11.9) < 1e-9, 'deadZoneLowerBound must reproduce 11.9 exactly');
  assert.ok(Math.abs(r.deadZoneUpperBound - 14.9) < 1e-9, 'deadZoneUpperBound must reproduce 14.9 exactly');
});

// ---- 4: frozen thresholds unchanged -------------------------------------------------------------
test('4: DECISION_RULE constants are frozen and match the manifest verbatim (11.9/14.9/13.4)', () => {
  assert.ok(Object.isFrozen(H.DECISION_RULE));
  assert.equal(H.DECISION_RULE.deadZoneLowerBound, 11.9);
  assert.equal(H.DECISION_RULE.deadZoneUpperBound, 14.9);
  assert.equal(H.DECISION_RULE.decisionMidpoint, 13.4);
});

// ---- 5: classification boundary rule (verbatim) -----------------------------------------------
test('5: classifyHairness reproduces the exact frozen boundary rule, including the two dead-zone endpoints', () => {
  assert.equal(H.classifyHairness(11.8), 'NON_BEARD_CONFIRMED');
  assert.equal(H.classifyHairness(11.9), 'UNCERTAIN'); // "<= 14.9" and boundary "11.9 <=" both inclusive per the manifest
  assert.equal(H.classifyHairness(13.4), 'UNCERTAIN');
  assert.equal(H.classifyHairness(14.9), 'UNCERTAIN');
  assert.equal(H.classifyHairness(15.0), 'BEARD_CONFIRMED');
});

// ---- 6: Sobel/highGradientFraction formula fidelity via hand-calculable synthetic fixtures -----
test('6: sobelGradientMagnitude is zero on a perfectly flat image (no edges) and never touches border pixels', () => {
  const w = 10, h = 10;
  const gray = new Float32Array(w * h).fill(128);
  const grad = H.sobelGradientMagnitude(gray, w, h);
  assert.ok(Array.from(grad).every(v => v === 0));
});
test('7: sobelGradientMagnitude detects a known hard vertical edge with the exact hand-calculable Sobel magnitude', () => {
  const w = 6, h = 6;
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = x < 3 ? 0 : 255;
  const grad = H.sobelGradientMagnitude(gray, w, h);
  // at the edge column (x=2 or x=3, interior rows), Gx kernel sums to (255-0)*4 = 1020, Gy=0 (uniform vertically)
  const val = grad[3 * w + 2];
  assert.ok(Math.abs(val - 1020) < 1e-6, 'expected exact hand-calculated Sobel magnitude 1020, got ' + val);
});
test('8: highGradientFraction fails closed (null) when the ROI has zero valid interior pixels', () => {
  const w = 10, h = 10;
  const gray = new Float32Array(w * h).fill(100);
  const emptyRoi = new Uint8Array(w * h); // all zero
  assert.equal(H.highGradientFraction(gray, emptyRoi, w, h), null);
});
test('9: highGradientFraction never counts border pixels as valid, even if the ROI mask includes them', () => {
  const w = 5, h = 5;
  const gray = new Float32Array(w * h).fill(50);
  const roi = new Uint8Array(w * h).fill(1); // whole image, including border
  const r = H.highGradientFraction(gray, roi, w, h);
  assert.equal(r.validPixelCount, (w - 2) * (h - 2)); // only interior pixels counted
});
test('10: the adaptive threshold is exactly meanGradient + 1*stdGradient, recomputed from the ROI\'s own pixel statistics -- never a fixed global constant', () => {
  const w = 6, h = 6;
  const gray = new Float32Array(w * h);
  // left half flat (zero gradient), right half a hard edge column -> a controlled, non-uniform
  // gradient distribution within the ROI, so mean/std are both genuinely non-trivial.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = x < 3 ? 100 : (x === 3 ? 100 : 200);
  const roi = new Uint8Array(w * h).fill(1);
  const r = H.highGradientFraction(gray, roi, w, h);
  const expectedThreshold = r.meanGradient + r.stdGradient;
  assert.ok(Math.abs(r.threshold - expectedThreshold) < 1e-9);
  assert.ok(r.meanGradient > 0, 'this fixture must produce a genuinely non-zero mean gradient');
  // a flat image (zero gradient everywhere) must produce a different (zero) threshold, proving
  // the threshold is not a hard-coded constant shared across ROIs.
  const flat = new Float32Array(w * h).fill(100);
  const rFlat = H.highGradientFraction(flat, roi, w, h);
  assert.notEqual(r.threshold, rFlat.threshold);
});

// ---- 11: runHairnessCoreV1 end-to-end determinism ------------------------------------------------
test('11: runHairnessCoreV1 is deterministic for identical input and returns a classification consistent with classifyHairness', () => {
  const w = 30, h = 30;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) gray[i] = (i * 37) % 256;
  const roi = new Uint8Array(w * h).fill(1);
  const r1 = H.runHairnessCoreV1(gray, roi, w, h);
  const r2 = H.runHairnessCoreV1(gray, roi, w, h);
  assert.deepEqual(r1, r2);
  assert.equal(r1.classification, H.classifyHairness(r1.highGradientFraction));
});

// ---- 12: ROI geometry status is honestly documented, never silently glossed over -----------
// BI-1Z1C.2 UPDATE: a61_segment.js was recovered (see hairness-core-v1-a61-recovery.test.mjs) --
// this constant now records the RESOLUTION, not an ongoing absence, but must still name its source
// and never silently omit what remains unresolved (the CHEEK_SPLIT refinement).
test('12: the ROI geometry status is explicitly documented as a module-level constant, naming a61_segment.js and what remains unresolved, not buried or omitted', () => {
  assert.match(H.ROI_GEOMETRY_LIMITATION, /a61_segment\.js/);
  assert.match(H.ROI_GEOMETRY_LIMITATION, /RESOLVED/);
  assert.match(H.ROI_GEOMETRY_LIMITATION, /CHEEK_SPLIT/);
});
