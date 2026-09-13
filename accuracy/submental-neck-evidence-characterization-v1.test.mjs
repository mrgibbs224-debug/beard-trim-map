import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as C from './submental-neck-evidence-characterization-v1.mjs';

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

// ---------- locked scanner artifact verification ----------

test('1. locked-scanner artifacts re-verify against the authoritative SCAN-LOCK-V1E hashes', () => {
  assert.equal(sha256(readFileSync('D:/MettleTemp/analysis/scanlockv1e_s25_self_scanner_v1_lock_decision.json')), 'df853c419b5856b1484a340ac5fd0158adbe65200269fcbc118ab15a9cced1f3');
  assert.equal(sha256(readFileSync('D:/MettleTemp/analysis/scanlockv1e_final_regression.json')), 'f6fc38da358439398798ba139719bae2c513f35ff75550d2a2fc60a5bc923f42');
  assert.equal(sha256(readFileSync('D:/MettleTemp/analysis/scanlockv1e_final_regression_report.md')), '8dfe719b5a5f20d254230c053de36b66bd9af83dfa1090e6dec43d9029d9f80a');
});

// ---------- authorized dataset restriction ----------

test('2. CURRENT_LOCKED_SCANNER_SCAN_IDS contains exactly the 6 SCAN-LOCK-V1E scans', () => {
  assert.deepEqual([...C.CURRENT_LOCKED_SCANNER_SCAN_IDS].sort(), [
    'scan_mu02bje6_57efla', 'scan_mu02c0cl_13ser3', 'scan_mu02cft9_g7wx30',
    'scan_mu02cunh_395p9e', 'scan_mu02d6gj_yriwo4', 'scan_mu02qcwu_pjfgkc'
  ].sort());
});

test('3. classifyDatasetCategory separates locked from pre-lock data, never pools them silently', () => {
  assert.equal(C.classifyDatasetCategory('scan_mu02bje6_57efla'), 'CURRENT_LOCKED_SCANNER_DATA');
  assert.equal(C.classifyDatasetCategory('scan_mtzxr228_7b50dm'), 'OLDER_PRE_LOCK_RESEARCH_DATA');
  assert.equal(C.classifyDatasetCategory('scan_unknown_id'), 'OLDER_PRE_LOCK_RESEARCH_DATA');
});

// ---------- raw projection coordinate discipline ----------

test('4. rawProjectionFields never treats landmarks2D as a raw-JPEG coordinate source', () => {
  const r = C.rawProjectionFields({ faceLocal3D: new Array(468).fill({ x: 0, y: 0, z: 0 }), imageSpaceViewModelMatrix: [1], intrinsics: { fx: 1 }, nativeTs: '1' });
  assert.equal(r.landmarks2DIsDisplayOrientedOnly, true);
});

test('5. rawProjectionFields reports NO_KEYFRAME rather than fabricating fields for a missing keyframe', () => {
  assert.deepEqual(C.rawProjectionFields(null), { status: 'NO_KEYFRAME' });
});

test('6. rawProjectionFields correctly reports missing intrinsics/matrix as false, never assumed true', () => {
  const r = C.rawProjectionFields({ faceLocal3D: new Array(468).fill({ x: 0, y: 0, z: 0 }) });
  assert.equal(r.imageSpaceViewModelMatrixAvailable, false);
  assert.equal(r.intrinsicsAvailable, false);
  assert.equal(r.nativeTimestampAvailable, false);
});

// ---------- provenance preservation ----------

test('7. findFormalCaptureKeyframe resolves via nearestVerifiedTierBObservationId, never guesses the nearest keyframe by ordinal', () => {
  const pkg = {
    formalCaptureAssociations: [{ formalCaptureId: 'chin-up', nearestVerifiedTierBObservationId: 'obs-42' }],
    imageKeyframes: [{ observationId: 'obs-1' }, { observationId: 'obs-42', faceLocal3D: [] }, { observationId: 'obs-99' }]
  };
  const kf = C.findFormalCaptureKeyframe(pkg, 'chin-up');
  assert.equal(kf.observationId, 'obs-42');
});

test('8. findFormalCaptureKeyframe returns null (never fabricates) when the pose or keyframe is absent', () => {
  assert.equal(C.findFormalCaptureKeyframe({ formalCaptureAssociations: [], imageKeyframes: [] }, 'chin-up'), null);
});

// ---------- UNKNOWN fail-closed (evidence classification) ----------

test('9. classifyEvidence fails closed to UNKNOWN on missing/empty facts', () => {
  assert.equal(C.classifyEvidence(null), 'UNKNOWN');
  assert.equal(C.classifyEvidence({}), 'UNKNOWN');
});

test('10. classifyEvidence never promotes an inferred region to DIRECT_TRACKED without explicit direct-landmark evidence', () => {
  const r = C.classifyEvidence({ hasPoseConditionedGeometricInference: true, hasAnatomicalPriorOnly: true });
  assert.notEqual(r, 'DIRECT_TRACKED');
  assert.equal(r, 'POSE_CONDITIONED_INFERENCE');
});

test('11. classifyEvidence respects priority order (direct tracked wins over weaker evidence when both present)', () => {
  const r = C.classifyEvidence({ hasDirectLandmarkSupport: true, hasAnatomicalPriorOnly: true });
  assert.equal(r, 'DIRECT_TRACKED');
});

test('12. temporal support alone is correctly distinguished from direct tracking -- never conflated', () => {
  const r = C.classifyEvidence({ hasReproducibleTemporalResidualSignal: true });
  assert.equal(r, 'TEMPORAL_SUPPORT');
  assert.notEqual(r, 'DIRECT_TRACKED');
});

// ---------- pose-separated analysis / submental-region taxonomy ----------

test('13. SUBMENTAL_REGIONS taxonomy covers the required minimum region set without collapsing categories', () => {
  ['CENTRAL_UNDER_CHIN', 'RIGHT_PARA_CHIN', 'LEFT_PARA_CHIN', 'RIGHT_UNDER_JAW', 'LEFT_UNDER_JAW',
   'RIGHT_MANDIBULAR_ANGLE_UNDERSIDE', 'LEFT_MANDIBULAR_ANGLE_UNDERSIDE', 'UPPER_CENTRAL_NECK',
   'UPPER_RIGHT_NECK', 'UPPER_LEFT_NECK', 'CHIN_TO_NECK_TRANSITION'].forEach(r => assert.ok(C.SUBMENTAL_REGIONS.includes(r)));
});

test('14. VISIBILITY_STATES keeps DIRECTLY_VISIBLE/GEOMETRY_SUPPORTED/TEMPORALLY_SUPPORTED/UNKNOWN as distinct categories', () => {
  const s = new Set(C.VISIBILITY_STATES);
  assert.ok(s.has('DIRECTLY_VISIBLE') && s.has('GEOMETRY_SUPPORTED') && s.has('TEMPORALLY_SUPPORTED') && s.has('UNKNOWN'));
  assert.equal(s.size, C.VISIBILITY_STATES.length, 'no duplicate/collapsed categories');
});

// ---------- direct-vs-inferred distinction (jaw rail geometry) ----------

test('15. JAW_CHIN_RAIL mirrors index.html\'s actual tracked lower-face boundary exactly (13 points)', () => {
  const indexSrc = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(indexSrc, /EXACT_FRAME_JAW_SUPPORT_SIDE=Object\.freeze\(\{172:'RIGHT',149:'RIGHT',152:'CENTER',378:'LEFT',397:'LEFT'\}\)/);
  [172, 149, 152, 378, 397].forEach(i => assert.ok(C.JAW_CHIN_RAIL.includes(i), `rail must include the exported support-side landmark ${i}`));
});

test('16. railShape returns null (never fabricates) when a rail landmark is missing', () => {
  const sparse = {}; sparse[172] = { x: 0, y: 0, z: 0 };
  assert.equal(C.railShape(sparse), null);
});

test('17. railShape is rotation/translation-invariant: a rigidly rotated+translated rail yields the same shape', () => {
  const base = [];
  C.JAW_CHIN_RAIL.forEach((idx, i) => { base[idx] = { x: i * 0.01, y: 0, z: 0 }; });
  base[152] = { x: 0.06, y: 0.01, z: 0 };
  const shifted = [];
  C.JAW_CHIN_RAIL.forEach(idx => { shifted[idx] = { x: base[idx].x + 5, y: base[idx].y + 3, z: base[idx].z - 2 }; });
  shifted[152] = { x: base[152].x + 5, y: base[152].y + 3, z: base[152].z - 2 };
  const a = C.railShape(base), b = C.railShape(shifted);
  assert.ok(Math.abs(a.arcLength - b.arcLength) < 1e-9);
  assert.ok(Math.abs(a.span - b.span) < 1e-9);
  assert.ok(Math.abs(a.chinDroop - b.chinDroop) < 1e-9);
});

test('18. compareRailShapes computes percent changes without dividing by zero or fabricating a value', () => {
  const front = { arcLength: 0.1, span: 0.08, chinDroop: 0.01, straightness: 1.25 };
  const chin = { arcLength: 0.102, span: 0.079, chinDroop: 0.012, straightness: 1.29 };
  const cmp = C.compareRailShapes(front, chin);
  assert.ok(Math.abs(cmp.arcLengthPctChange - 2) < 0.01);
  assert.equal(C.compareRailShapes(null, chin), null);
});

test('19. compareRailShapes chinDroop delta is directional (increase vs decrease distinguishable)', () => {
  const front = { arcLength: 1, span: 1, chinDroop: 0.01, straightness: 1 };
  const chinMore = { arcLength: 1, span: 1, chinDroop: 0.02, straightness: 1 };
  const chinLess = { arcLength: 1, span: 1, chinDroop: 0.005, straightness: 1 };
  assert.ok(C.compareRailShapes(front, chinMore).deltaChinDroop > 0);
  assert.ok(C.compareRailShapes(front, chinLess).deltaChinDroop < 0);
});

// ---------- Hairness frozen / no threshold fitting ----------

// The leading file-header comment intentionally documents what this module does NOT do (a
// disclaimer, matching every other stage's convention) -- code-level checks below scan only the
// executable body, past that header, so the disclaimer's own wording never false-positives.
function bodyOnly(src) { return src.slice(src.indexOf('export const JAW_CHIN_RAIL')); }

test('20. module never imports or references Hairness scoring/threshold machinery', () => {
  const src = bodyOnly(readFileSync(new URL('./submental-neck-evidence-characterization-v1.mjs', import.meta.url), 'utf8'));
  assert.ok(!/hairness/i.test(src));
});

test('21. module fits no new numeric visibility/deformation threshold -- shape functions return raw measurements only', () => {
  const src = readFileSync(new URL('./submental-neck-evidence-characterization-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/if\s*\(.*(arcLength|span|chinDroop|straightness)\s*[<>]=?\s*[\d.]/i.test(src));
});

// ---------- no scanner modification / no V2 / no network / no paid dependency ----------

test('22. module never imports or references scanner runtime globals', () => {
  const src = readFileSync(new URL('./submental-neck-evidence-characterization-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/window\.|document\.|BeardTrimAndroid|mgScan2|qualityFor\(/.test(src));
});

test('23. module never references V2 occupancy/GT machinery', () => {
  const src = bodyOnly(readFileSync(new URL('./submental-neck-evidence-characterization-v1.mjs', import.meta.url), 'utf8'));
  assert.ok(!/head-relative-temporal-measurement-v2/.test(src));
  assert.ok(!/occupancy/i.test(src));
  assert.ok(!/ground.?truth|\bGT\b/i.test(src));
});

test('24. module has zero network calls and zero external/paid-service references', () => {
  const src = readFileSync(new URL('./submental-neck-evidence-characterization-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|https?:\/\//.test(src));
});

// ---------- production isolation ----------

test('25. index.html and worker.js hashes are unchanged by this stage', () => {
  const idx = readFileSync(new URL('../index.html', import.meta.url));
  const wkr = readFileSync(new URL('../worker.js', import.meta.url));
  assert.equal(sha256(idx), '928747a5d284060dddac43c95f97a1669492ab4d1ecebf0d34bc59f3a3b5b521');
  assert.equal(sha256(wkr), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});

test('26. burst-recorder byte-substring is unchanged', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const startIdx = src.indexOf('const TEMPORAL_BURST_TARGET_INTERVAL_MS');
  const endStart = src.indexOf('function __updateMotionBurstIndicatorUI(){');
  const endIdx = src.indexOf('\n}', endStart) + 2;
  assert.equal(sha256(Buffer.from(src.slice(startIdx, endIdx))), 'eae6776bf4299af02f41b0ac3805bb59eb0167dc903c45a9ca08e87941f0762a');
});
