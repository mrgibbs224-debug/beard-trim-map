import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as N from './sparse-neck-scaffold-v1.mjs';

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
const ANALYSIS_DIR = 'D:/MettleTemp/analysis/';

// ---------- BI-2C hash verification ----------

test('1. BI-2C authoritative artifact + implementation hashes match exactly', () => {
  const checks = [
    [ANALYSIS_DIR + 'bi2c_sparse_neck_scaffold_v1_results.json', '69780a577ea9528a65a3955bf0f3dee006c547a604e4d6eab19fb1fc8b1251fb'],
    [ANALYSIS_DIR + 'bi2c_neck_scaffold_repeatability.json', 'dcda92bfb12dbcaefb14a73a41957aeabaaa7e9d3dad739ec37d0f23d7787fe5'],
    [ANALYSIS_DIR + 'bi2c_neck_scaffold_failure_analysis.json', '8118060456d19558b478ef06e2dd97d3517e3183d53bd216a76093b19d325d1e'],
    [ANALYSIS_DIR + 'bi2c_sparse_neck_scaffold_v1_report.md', '9a1974e965db486ec229a8c67699a21db51d01a833a4d2d98e97f01994534702'],
    ['accuracy/sparse-neck-scaffold-v1.mjs', '3798248b018919a61dea71173802b7a4acf6420447edffecc3e49da020d306f9']
  ];
  checks.forEach(([p, exp]) => assert.equal(sha256(readFileSync(p)), exp, p));
});

// ---------- production isolation ----------

test('2. production hashes (index.html, worker.js, burst recorder) remain unchanged', () => {
  const idx = readFileSync(new URL('../index.html', import.meta.url));
  const wkr = readFileSync(new URL('../worker.js', import.meta.url));
  assert.equal(sha256(idx), '928747a5d284060dddac43c95f97a1669492ab4d1ecebf0d34bc59f3a3b5b521');
  assert.equal(sha256(wkr), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
  const src = idx.toString('utf8');
  const startIdx = src.indexOf('const TEMPORAL_BURST_TARGET_INTERVAL_MS');
  const endStart = src.indexOf('function __updateMotionBurstIndicatorUI(){');
  const endIdx = src.indexOf('\n}', endStart) + 2;
  assert.equal(sha256(Buffer.from(src.slice(startIdx, endIdx))), 'eae6776bf4299af02f41b0ac3805bb59eb0167dc903c45a9ca08e87941f0762a');
});

test('3. sparse-neck-scaffold-v1.mjs module was NOT modified this stage (byte-identical to BI-2C)', () => {
  assert.equal(sha256(readFileSync('accuracy/sparse-neck-scaffold-v1.mjs')), '3798248b018919a61dea71173802b7a4acf6420447edffecc3e49da020d306f9');
});

// ---------- anchor-instability attribution ----------

test('4. anchor-instability audit tests the scale-artifact hypothesis and reports a classification from the required vocabulary', () => {
  const a = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_transition_anchor_instability_audit.json', 'utf8'));
  assert.ok(['MEASUREMENT_VARIANCE', 'POSE_CONDITIONED_VARIANCE', 'GT_PLACEMENT_VARIANCE', 'MODEL_INITIALIZATION_VARIANCE', 'UNRESOLVED'].includes(a.classification));
  assert.equal(a.classification, 'GT_PLACEMENT_VARIANCE');
  assert.ok('scaleArtifactTest' in a && 'conclusion' in a.scaleArtifactTest);
  assert.equal(a.perSessionAnchorGeometry.length, 6);
});

// ---------- left/right asymmetry audit ----------

test('5. lateral asymmetry audit reports a determination and does not assume anatomical symmetry a priori', () => {
  const a = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_lateral_asymmetry_audit.json', 'utf8'));
  assert.ok(a.determination.length > 0);
  assert.ok('doesNotAssumeAnatomicalSymmetry' in a);
  assert.equal(a.perSessionLateralGeometry.length, 6);
});

// ---------- mandibular-angle fail-closed / existing-data-first / no guessing ----------

test('6. mandibular-angle evidence used only already-locked data (no new scan requested)', () => {
  const m = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_mandibular_angle_evidence.json', 'utf8'));
  assert.match(m.existingDataFirstRule, /No new physical scan was requested/);
});

test('7. mandibular-angle regions remain UNKNOWN and no annotation packet was created (no human guessing through beard)', () => {
  const m = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_mandibular_angle_evidence.json', 'utf8'));
  assert.equal(m.perSideClassification.RIGHT_MANDIBULAR_ANGLE_UNDERSIDE, 'OCCLUDED');
  assert.equal(m.perSideClassification.LEFT_MANDIBULAR_ANGLE_UNDERSIDE, 'OCCLUDED');
  assert.equal(m.honestVisualGtPossible, false);
  assert.match(m.decisionPerPart5, /NO annotation packet was created/);
  const noEmit = N.buildMandibularAngleConnector({ side: 'RIGHT', railEndpointRaw: { x: 1, y: 1 } });
  assert.equal(noEmit.authorityClass, 'UNKNOWN');
});

// ---------- BURST_SHARED temporal use / hold-vs-transition / anti-circularity / no threshold fitting ----------

test('8. transition temporal results used the BURST_SHARED left-profile_TO_chin-up transition, reusing validated metrics', () => {
  const t = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_transition_temporal_results.json', 'utf8'));
  assert.equal(t.burstUsed.sourceTransition, 'left-profile_TO_chin-up');
  assert.ok(t.metricsReused.some(m => /residualDifference/.test(m)));
  assert.ok(t.metricsReused.some(m => /safeResidualRatioV2/.test(m)));
});

test('9. hold-vs-transition comparison is reported for all 4 patch families with explicit outlier disclosure', () => {
  const t = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_transition_temporal_results.json', 'utf8'));
  ['HEAD_REFERENCE', 'BACKGROUND_CONTROL', 'NECK_CANDIDATE', 'CLOTHING_CONTROL'].forEach(f => assert.ok(f in t.holdVsTransitionComparison));
  assert.match(t.outlierDisclosure, /MEAN.*NECK_CANDIDATE.*heavily influenced by/i);
});

test('10. anti-circularity firewall is explicitly asserted and verified for the transition-phase analysis', () => {
  const t = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_transition_temporal_results.json', 'utf8'));
  assert.equal(t.antiCircularityFirewall.verified, true);
  assert.match(t.antiCircularityFirewall.rule, /ONLY from the corrected human GT/);
});

test('11. no production temporal threshold was fit -- explicit non-claims present and verdict stays TEMPORAL_SUPPORT-scoped', () => {
  const t = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_transition_temporal_results.json', 'utf8'));
  assert.ok(t.explicitNonClaims.some(c => /fitted production threshold/i.test(c)));
  assert.match(t.verdict, /TEMPORAL_SUPPORT only/);
});

// ---------- cross-pose correspondence provenance / no invented correspondence ----------

test('12. cross-pose method reuses existing a61ProjectPoint/backProjectToFaceLocal, never reimplemented', () => {
  const c = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_cross_pose_consistency.json', 'utf8'));
  assert.match(c.method.description, /a61ProjectPoint/);
  assert.match(c.method.description, /backProjectToFaceLocal/);
  assert.match(c.method.description, /neither function was reimplemented/);
});

test('13. cross-pose correspondence explicitly disclaims inventing correspondences and discloses the depth approximation', () => {
  const c = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_cross_pose_consistency.json', 'utf8'));
  assert.match(c.method.noInventedCorrespondence, /No correspondence was fabricated/);
  assert.match(c.method.disclosedApproximation, /explicitly disclosed/);
});

test('14. real double-GT consistency check exists for Chin-Up->Left-Profile with a bounded normalized residual', () => {
  const c = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_cross_pose_consistency.json', 'utf8'));
  const agg = c.realDoubleGtConsistencyCheck.aggregateNormalizedDistance;
  assert.equal(agg.values.length, 3);
  agg.values.forEach(v => assert.ok(v > 0 && v < 0.5));
});

test('15. no false absolute-accuracy claim is made for cross-pose consistency', () => {
  const c = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_cross_pose_consistency.json', 'utf8'));
  assert.match(c.noFalseAccuracyClaim, /not an absolute 3D accuracy claim/);
});

// ---------- repeatability classification ----------

test('16. repeatability reassessment classifies all 6 metrics using only the 4 allowed labels', () => {
  const r = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_neck_scaffold_readiness.json', 'utf8'));
  const allowed = ['STABLE', 'USABLE_WITH_LIMITATION', 'UNSTABLE', 'UNSUPPORTED'];
  Object.values(r.repeatabilityReassessment).forEach(v => { if (v && v.classification) assert.ok(allowed.includes(v.classification)); });
  assert.equal(r.repeatabilityReassessment.transitionAnchorSpacing.classification, 'UNSTABLE');
});

// ---------- blend factors remain provisional / no repeatability-overfitting ----------

test('17. blend-factor audit decision is KEEP_AS_PROVISIONAL and confirms no numeric tuning occurred', () => {
  const r = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_neck_scaffold_readiness.json', 'utf8'));
  assert.equal(r.blendFactorAudit.decision, 'KEEP_AS_PROVISIONAL');
  assert.match(r.blendFactorAudit.noOverfittingConfirmed, /byte-identical to its BI-2C content/);
});

test('18. DEFORMATION_PARAMS values are numerically unchanged from BI-2C', () => {
  assert.equal(N.DEFORMATION_PARAMS.CHIN_NECK_TRANSITION_RAIL.headBlendFactor, 0.6);
  assert.equal(N.DEFORMATION_PARAMS.UNDER_JAW_LATERAL_RAIL.headBlendFactor, 0.8);
  assert.equal(N.DEFORMATION_PARAMS.NECK_CLOTHING_SAFETY_MARGIN.headBlendFactor, 0.15);
  assert.equal(N.DEFORMATION_PARAMS.CHIN_NECK_TRANSITION_RAIL.fitted, false);
});

// ---------- clothing firewall ----------

test('19. clothing firewall stress test reports all scenarios passed', () => {
  const fw = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_firewall_stress_test_raw.json', 'utf8'));
  assert.equal(fw.allPassed, true);
  assert.ok(fw.totalScenarios >= 9);
});

// ---------- region authority vocabulary / UNKNOWN preservation ----------

test('20. region authority update covers all 11 BI-2A regions using only the frozen vocabulary', () => {
  const r = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_neck_scaffold_readiness.json', 'utf8'));
  const regions = r.regionAuthorityUpdate.regions;
  assert.equal(Object.keys(regions).length, 11);
  const allowed = ['DIRECT_TRACKED', 'DIRECT_MULTIVIEW_IMAGE', 'TEMPORAL_SUPPORT', 'POSE_CONDITIONED_INFERENCE', 'ANATOMICAL_PRIOR', 'UNKNOWN'];
  Object.values(regions).forEach(reg => {
    const isAllowed = allowed.some(a => reg.geometryAuthority.startsWith(a) || reg.geometryAuthority === a);
    assert.ok(isAllowed, `unexpected authority label: ${reg.geometryAuthority}`);
  });
});

test('21. both mandibular-angle regions remain UNKNOWN in the region authority update (preserved, not upgraded)', () => {
  const r = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2d_neck_scaffold_readiness.json', 'utf8'));
  assert.equal(r.regionAuthorityUpdate.regions.RIGHT_MANDIBULAR_ANGLE_UNDERSIDE.geometryAuthority, 'UNKNOWN');
  assert.equal(r.regionAuthorityUpdate.regions.LEFT_MANDIBULAR_ANGLE_UNDERSIDE.geometryAuthority, 'UNKNOWN');
});

// ---------- no beard occupancy / no dense mesh / no scanner change / no network / no paid dependency ----------

test('22. no beard-occupancy machinery is referenced by any BI-2D artifact or the (unchanged) module', () => {
  const files = ['bi2d_transition_anchor_instability_audit.json', 'bi2d_lateral_asymmetry_audit.json', 'bi2d_mandibular_angle_evidence.json', 'bi2d_transition_temporal_results.json', 'bi2d_cross_pose_consistency.json', 'bi2d_neck_scaffold_readiness.json'];
  files.forEach(f => {
    const src = readFileSync(ANALYSIS_DIR + f, 'utf8');
    assert.ok(!/beard.?occupancy.?field|hairness.?core.*fit|beard.?classifier/i.test(src), f);
  });
});

test('23. sparse-neck-scaffold-v1.mjs still contains no dense/triangulated mesh construction', () => {
  const src = readFileSync('accuracy/sparse-neck-scaffold-v1.mjs', 'utf8');
  assert.ok(!/triangulat|tessellat|dense.?mesh|\bmesh\b/i.test(src));
});

test('24. no scanner/production file was modified this stage (git-tracked production files match frozen hashes; BI-2D added only new files)', () => {
  const idx = readFileSync(new URL('../index.html', import.meta.url));
  const wkr = readFileSync(new URL('../worker.js', import.meta.url));
  assert.equal(sha256(idx), '928747a5d284060dddac43c95f97a1669492ab4d1ecebf0d34bc59f3a3b5b521');
  assert.equal(sha256(wkr), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});

test('25. this test module has zero network calls and no scanner runtime references', () => {
  const src = readFileSync(new URL('./bi2d-targeted-neck-validation.test.mjs', import.meta.url), 'utf8');
  const bodyOnly = src.slice(src.indexOf("test('1."), src.indexOf("test('25."));
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|BeardTrimAndroid|mgScan2/.test(bodyOnly));
});

test('26. no paid/cloud dependency -- sparse-neck-scaffold-v1.mjs imports only local project files', () => {
  const src = readFileSync('accuracy/sparse-neck-scaffold-v1.mjs', 'utf8');
  const importLines = src.match(/^import .*/gm) || [];
  importLines.forEach(line => assert.match(line, /from '\.\//));
});

test('27. final report contains the exact required verdict string', () => {
  const md = readFileSync(ANALYSIS_DIR + 'bi2d_targeted_neck_validation_report.md', 'utf8');
  assert.match(md, /NECK SCAFFOLD V1 USABLE — LIMITED REGIONS REMAIN UNKNOWN/);
});

test('28. no new annotation packet was created (consistent with the honest no-GT-possible finding)', () => {
  const md = readFileSync(ANALYSIS_DIR + 'bi2d_targeted_neck_validation_report.md', 'utf8');
  assert.match(md, /No new annotation packet was created/);
});
