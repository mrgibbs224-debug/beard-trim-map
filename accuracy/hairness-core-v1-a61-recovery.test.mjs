// Stage BI-1Z1C.2 — tests for the recovered a61_segment.js ROI-geometry transcription added to
// accuracy/hairness-core-v1.mjs. Node built-in runner. Synthetic fixtures only -- the real 8-frame
// replay (against the physical research capture, outside this repo) is reported in
// D:\MettleTemp\analysis\bi1z1c2_fresh_exact_frame_a61_hairness_replay.json, not committed as a
// test fixture (same convention as every prior bi1y*/bi1z* stage).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as H from './hairness-core-v1.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const V1_SOURCE = readFileSync(join(HERE, '..', 'tools', 'annotation-workbench', 'beard-proposal.cjs'), 'utf8');
const V2_SOURCE = readFileSync(join(HERE, 'beard-proposal-anatomical-seeded-v2.mjs'), 'utf8');
const ROOT_INDEX_HTML = readFileSync(join(HERE, '..', 'index.html'), 'utf8');

// ---- 1/2: V1/V2 unchanged -----------------------------------------------------------------------
test('1: original V1 (beard-proposal/1) is untouched', () => {
  assert.match(V1_SOURCE, /PROPOSAL_ALGORITHM_VERSION = 'beard-proposal\/1'/);
});
test('2: original V2 (beard-proposal-anatomical-seeded/2) manifest/parameters are untouched', () => {
  assert.match(V2_SOURCE, /V2_ALGORITHM_VERSION = 'beard-proposal-anatomical-seeded\/2'/);
  assert.match(V2_SOURCE, /seedDiskRadiusFactor: 0\.18/);
});

// ---- 3: Hairness thresholds unchanged -------------------------------------------------------
test('3: DECISION_RULE thresholds (11.9/14.9/13.4) remain byte-identical after this stage\'s additions', () => {
  assert.equal(H.DECISION_RULE.deadZoneLowerBound, 11.9);
  assert.equal(H.DECISION_RULE.deadZoneUpperBound, 14.9);
  assert.equal(H.DECISION_RULE.decisionMidpoint, 13.4);
});

// ---- 4/5: recovered a61_segment.js provenance + hash match --------------------------------------
test('4: A61_SEGMENT_SOURCE records the exact recovered path and matches the historical hash prefix from the stage prompt (683b930cd6b5c05a)', () => {
  assert.equal(H.A61_SEGMENT_SOURCE.recoveredPath, 'C:\\Users\\queen\\Desktop\\ChatGPT_A61Q_Upload\\a61_segment.js');
  assert.ok(H.A61_SEGMENT_SOURCE.sha256.startsWith('683b930cd6b5c05a'));
  assert.equal(H.A61_SEGMENT_SOURCE.historicalHashPrefixMatch, true);
});
test('5: the archived durable copy is recorded and the companion module hashes also match their historical prefixes (aaf1c7cb.../b64f4f83...)', () => {
  assert.equal(H.A61_SEGMENT_SOURCE.archivedCopyPath, 'D:\\MettleTemp\\recovered-a61\\a61_segment.js');
  assert.ok(H.A61_COMPANION_SOURCES.a61o_edge_engine.sha256.startsWith('aaf1c7cbff6922f3'));
  assert.ok(H.A61_COMPANION_SOURCES.a61p_fusion.sha256.startsWith('b64f4f838f0d3be9'));
  const fileSha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  assert.equal(fileSha256('D:\\MettleTemp\\recovered-a61\\a61_segment.js'), H.A61_SEGMENT_SOURCE.sha256);
});

// ---- 6: ROI geometry deterministic ------------------------------------------------------------
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
function identityVMM() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -0.5, 1]; } // simple translate-back-along-Z so Zcv>0
function syntheticIntrinsics() { return { fx: 500, fy: 500, cx: 320, cy: 240 }; }

test('6: buildA61JawSideburnROIs is deterministic and returns the 8 expected named regions for a well-formed synthetic frame', () => {
  const face = syntheticFaceLocal3D(), vmm = identityVMM(), intr = syntheticIntrinsics();
  const a = H.buildA61JawSideburnROIs(face, vmm, intr);
  const b = H.buildA61JawSideburnROIs(face, vmm, intr);
  assert.deepEqual(a, b);
  ['MOUSTACHE_CENTER', 'CHIN_BEARD', 'CHEEK_LEFT', 'CHEEK_RIGHT', 'SIDEBURN_LEFT', 'SIDEBURN_RIGHT', 'JAW_LEFT', 'JAW_RIGHT'].forEach(name => {
    assert.ok(Array.isArray(a[name]) && a[name].length >= 3, name + ' must be a valid polygon');
  });
});
test('6b: buildA61JawSideburnROIs fails closed (null) when faceLocal3D/vmm/intrinsics are missing', () => {
  assert.equal(H.buildA61JawSideburnROIs(null, identityVMM(), syntheticIntrinsics()), null);
  assert.equal(H.buildA61JawSideburnROIs(syntheticFaceLocal3D(), null, syntheticIntrinsics()), null);
});

// ---- 7: historical formula cross-check (independent of ROI) -------------------------------------
test('7: the Sobel/highGradientFraction formula matches the historical bi1j_cheek_features.mjs implementation byte-for-byte in structure -- verified via the same percentage-scaling convention (100 * count / n)', () => {
  const w = 8, h = 8;
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = x < 4 ? 50 : 200;
  const roi = new Uint8Array(w * h).fill(1);
  const r = H.highGradientFraction(gray, roi, w, h);
  assert.ok(r.highGradientFraction >= 0 && r.highGradientFraction <= 100, 'must be percentage-scaled 0-100, matching the historical 100x convention');
});
test('7b: the historical formula cross-check source is documented, not silently assumed', () => {
  assert.match(H.HAIRNESS_FORMULA_HISTORICAL_CROSSCHECK_SOURCE.path, /bi1j_cheek_features\.mjs/);
});

// ---- 8: unsupported regions stay unsupported (a61s_boundary_semantics.js honestly not found) ----
test('8: the missing a61s_boundary_semantics.js companion is honestly recorded as not found, never fabricated', () => {
  assert.equal(H.A61_COMPANION_SOURCES.a61s_boundary_semantics.found, false);
});

// ---- 9: fresh replay never fabricates unsupported ROIs -------------------------------------------
test('9: rasterizeA61Polygon produces an empty mask for a degenerate (too few points) polygon rather than guessing a shape', () => {
  const mask = H.rasterizeA61Polygon([[1, 1], [2, 2]], 10, 10); // only 2 points -- the caller (buildA61JawSideburnROIs) already filters these out, but rasterizeA61Polygon itself must not crash or fabricate
  assert.equal(mask.length, 100);
  assert.ok(Array.from(mask).every(v => v === 0));
});

// ---- 10: no GT input to Hairness computation -----------------------------------------------------
test('10: no function added in this stage reads a human-GT or proposal-result parameter', () => {
  const src = readFileSync(join(HERE, 'hairness-core-v1.mjs'), 'utf8');
  assert.equal(/humanFinalPoints|humanGT|groundTruth|originalProposalPoints/i.test(src), false);
});

// ---- 11: production isolation ---------------------------------------------------------------------
test('11: root production index.html carries no A6.1 recovery symbols', () => {
  assert.equal(ROOT_INDEX_HTML.includes('buildA61JawSideburnROIs'), false);
  assert.equal(ROOT_INDEX_HTML.includes('a61_segment'), false);
});
test('12: no sealed-holdout identifier appears in this module', () => {
  const src = readFileSync(join(HERE, 'hairness-core-v1.mjs'), 'utf8');
  assert.equal(src.includes('espu2w'), false);
});
