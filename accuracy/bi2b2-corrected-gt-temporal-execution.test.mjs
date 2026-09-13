import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as S from './neck-gt-curve-salvage-v1.mjs';
import { residualDifference } from './temporal-metric-robustness-audit.mjs';
import { safeResidualRatioV2 } from './head-relative-temporal-measurement-v2.mjs';

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
const CORRECTED_EXPORT_PATH = 'C:/Users/queen/Downloads/bi2b1_neck_gt_annotations_export (1).json';
const ANALYSIS_DIR = 'D:/MettleTemp/analysis/';

// ---------- corrected export identity and immutability ----------

test('1. corrected export SHA256 matches the user-supplied expected hash', () => {
  const buf = readFileSync(CORRECTED_EXPORT_PATH);
  assert.equal(sha256(buf), '781d37a1e3c02f17ce49e183ce7f8b380d140857e3ff96a0781010a8d0e69048');
});

test('2. corrected export is never mutated by re-running classifyCurve over it', () => {
  const before = readFileSync(CORRECTED_EXPORT_PATH);
  const shaBefore = sha256(before);
  const data = JSON.parse(before.toString('utf8'));
  data.images.forEach(img => { const k = S.CURVE_TARGET_BY_POSE[img.pose]; if (k) S.classifyCurve(img.annotations[k]); });
  assert.equal(sha256(readFileSync(CORRECTED_EXPORT_PATH)), shaBefore);
});

test('3. corrected export has 9 images with 3/3/3 pose balance', () => {
  const data = JSON.parse(readFileSync(CORRECTED_EXPORT_PATH, 'utf8'));
  assert.equal(data.images.length, 9);
  assert.equal(data.images.filter(i => i.pose === 'chin-up').length, 3);
  assert.equal(data.images.filter(i => i.pose === 'right-profile').length, 3);
  assert.equal(data.images.filter(i => i.pose === 'left-profile').length, 3);
});

// ---------- curve validity reversal ----------

test('4. ALL 9 curve targets in the corrected export classify VALID_OPEN_CURVE', () => {
  const data = JSON.parse(readFileSync(CORRECTED_EXPORT_PATH, 'utf8'));
  data.images.forEach(img => {
    const r = S.classifyCurve(img.annotations[S.CURVE_TARGET_BY_POSE[img.pose]]);
    assert.equal(r.classification, 'VALID_OPEN_CURVE', img.imageId);
  });
});

test('5. preserved targets (VISIBLE_NECK_SKIN_POLYGON, UNKNOWN_OCCLUSION_MASK) remain present and non-empty', () => {
  const data = JSON.parse(readFileSync(CORRECTED_EXPORT_PATH, 'utf8'));
  data.images.forEach(img => {
    if (img.pose === 'chin-up') assert.ok(img.annotations.VISIBLE_NECK_SKIN_POLYGON.length > 0, img.imageId);
    assert.ok(img.annotations.UNKNOWN_OCCLUSION_MASK.length > 0, img.imageId);
  });
});

// ---------- output artifact presence, hash stability, and internal consistency ----------

const ARTIFACTS = [
  'bi2b2_corrected_neck_gt_validation.json',
  'bi2b2_temporal_neck_clothing_results.json',
  'bi2b2_neck_region_evidence_matrix.json',
  'bi2b2_sparse_neck_scaffold_design.json',
  'bi2b2_corrected_gt_temporal_report.md'
];

ARTIFACTS.forEach((name, idx) => {
  test(`6.${idx + 1} output artifact ${name} exists and is non-empty`, () => {
    const buf = readFileSync(ANALYSIS_DIR + name);
    assert.ok(buf.length > 0);
  });
});

test('7. gt validation artifact reports ALL_9_VALID_OPEN_CURVE and no salvage performed', () => {
  const v = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2b2_corrected_neck_gt_validation.json', 'utf8'));
  assert.equal(v.curveGeometryValidation.result, 'ALL_9_VALID_OPEN_CURVE');
  assert.equal(v.humanGtTrustClassification.DERIVED_FROM_HUMAN_GT.length, 0);
  assert.equal(v.humanGtTrustClassification.DIRECT_HUMAN_CURVE.length, 9);
});

test('8. gt validation artifact records the corrected export hash matching the expected hash', () => {
  const v = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2b2_corrected_neck_gt_validation.json', 'utf8'));
  assert.equal(v.sourceExport.sha256, '781d37a1e3c02f17ce49e183ce7f8b380d140857e3ff96a0781010a8d0e69048');
  assert.equal(v.sourceExport.matchesUserSuppliedExpectedHash, true);
});

// ---------- anti-circularity firewall ----------

test('9. temporal results artifact explicitly asserts the anti-circularity firewall was verified', () => {
  const t = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2b2_temporal_neck_clothing_results.json', 'utf8'));
  assert.equal(t.antiCircularityFirewall.verified, true);
  assert.match(t.antiCircularityFirewall.rule, /ONLY from the corrected human GT/);
});

test('10. temporal results artifact contains no fake accuracy percentage / classifier claim', () => {
  const src = readFileSync(ANALYSIS_DIR + 'bi2b2_temporal_neck_clothing_results.json', 'utf8');
  assert.ok(!/classifier accuracy|segmentation accuracy|skin classifier accuracy/i.test(src.replace(/"explicitNonClaims"[\s\S]*?\]/, '')));
  const t = JSON.parse(src);
  assert.ok(t.explicitNonClaims.length >= 3);
});

test('11. H_TORSO_RELATIVE remains UNSUPPORTED_FOR_THIS_STAGE, never fabricated as supported', () => {
  const t = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2b2_temporal_neck_clothing_results.json', 'utf8'));
  assert.equal(t.hypothesesEvaluated.H_TORSO_RELATIVE, 'UNSUPPORTED_FOR_THIS_STAGE -- no honest torso reference exists in the current locked-scanner data; not fabricated');
});

test('12. scope limitation (hold-phase-only, no burst-shared transition frames) is explicitly disclosed', () => {
  const t = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2b2_temporal_neck_clothing_results.json', 'utf8'));
  assert.match(t.scopeAndLimitation.disclosedLimitation, /did NOT additionally incorporate BURST_SHARED/);
});

test('13. BACKGROUND_CONTROL tautology (ratio always 1.0 by construction) is explicitly disclosed, not presented as a finding', () => {
  const t = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2b2_temporal_neck_clothing_results.json', 'utf8'));
  assert.match(t.patchFamilies.BACKGROUND_CONTROL.note, /disclosed methodological tautology, not a finding/);
});

// ---------- reused metric functions produce the reported real numbers ----------

test('14. residualDifference and safeResidualRatioV2 are the actual imported, unmodified functions (not reimplemented)', () => {
  assert.equal(typeof residualDifference, 'function');
  assert.equal(typeof safeResidualRatioV2, 'function');
  assert.equal(residualDifference(10, 4), 6);
  assert.equal(residualDifference(NaN, 4), null);
  const r = safeResidualRatioV2(4, 10);
  assert.equal(r.state, 'AVAILABLE');
  assert.ok(Math.abs(r.ratio - 0.4) < 1e-9);
});

test('15. raw per-family measurement file exists and every family has AVAILABLE-state entries', () => {
  const raw = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2b2_temporal_family_summary.json', 'utf8'));
  ['HEAD_REFERENCE', 'BACKGROUND_CONTROL', 'NECK_CANDIDATE', 'CLOTHING_CONTROL'].forEach(fam => {
    assert.ok(raw[fam].safeResidualRatioV2.stateCounts.AVAILABLE > 0, fam);
  });
});

test('16. NECK_CANDIDATE and CLOTHING_CONTROL only draw from the 3 Chin-Up-GT-bearing scans', () => {
  const t = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2b2_temporal_neck_clothing_results.json', 'utf8'));
  assert.equal(t.patchFamilies.NECK_CANDIDATE.availableOnlyForScansWithChinUpGt.length, 3);
  assert.equal(t.patchFamilies.CLOTHING_CONTROL.availableOnlyForScansWithChinUpGt.length, 3);
});

// ---------- region evidence matrix ----------

test('17. region evidence matrix has exactly the 11 named regions carried from BI-2A, never collapsed to one score', () => {
  const m = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2b2_neck_region_evidence_matrix.json', 'utf8'));
  const names = Object.keys(m.regions);
  assert.equal(names.length, 11);
  ['CENTRAL_UNDER_CHIN', 'CHIN_TO_NECK_TRANSITION', 'RIGHT_MANDIBULAR_ANGLE_UNDERSIDE', 'LEFT_MANDIBULAR_ANGLE_UNDERSIDE'].forEach(n => assert.ok(names.includes(n)));
  names.forEach(n => {
    const r = m.regions[n];
    assert.ok('humanGtSupport' in r && 'trackedSupport' in r && 'multiviewSupport' in r && 'temporalSupport' in r && 'imageOnlySupport' in r && 'unknownExtent' in r && 'recommendedAuthority' in r, n);
  });
});

test('18. CHIN_TO_NECK_TRANSITION is identified as the highest-confidence region', () => {
  const m = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2b2_neck_region_evidence_matrix.json', 'utf8'));
  assert.equal(m.summary.highestConfidenceRegion, 'CHIN_TO_NECK_TRANSITION');
});

// ---------- scaffold design is recommendation-only ----------

test('19. scaffold design artifact explicitly states it is not implemented', () => {
  const d = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2b2_sparse_neck_scaffold_design.json', 'utf8'));
  assert.match(d.explicitNonImplementationNotice, /No scaffold code, mesh, or runtime logic was written/);
});

test('20. every scaffold support element has all required fields', () => {
  const d = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2b2_sparse_neck_scaffold_design.json', 'utf8'));
  const required = ['name', 'anatomicalPurpose', 'sourcePoses', 'evidenceClass', 'initMethod', 'directVsInferred', 'expectedDeformation', 'confidenceLimits', 'failureConditions', 'v1Safety'];
  d.supportElements.forEach(el => required.forEach(f => assert.ok(f in el, `${el.name} missing ${f}`)));
});

test('21. deformation model decision is D (per-region blend), not pure-rigid, and gives a data-based justification', () => {
  const d = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2b2_sparse_neck_scaffold_design.json', 'utf8'));
  assert.match(d.deformationModelDecision.decision, /^D:/);
  assert.match(d.deformationModelDecision.explicitlyRejectedPureRigid, /NOT chosen merely "for convenience"/);
});

test('22. clothing firewall design directly references this stage\'s own measured separation, not an arbitrary heuristic', () => {
  const d = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2b2_sparse_neck_scaffold_design.json', 'utf8'));
  assert.match(d.clothingFirewallDesign.rationale, /this stage's own measured CLOTHING_CONTROL vs NECK_CANDIDATE separation/);
});

test('23. beard/anatomy firewall reaffirms no beard-boundary GT or classifier output was used', () => {
  const d = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2b2_sparse_neck_scaffold_design.json', 'utf8'));
  assert.match(d.beardAnatomyFirewall.rule, /No neck-scaffold support element may be initialized.*using beard-boundary\/beard-classifier output/);
});

test('24. build-gate questions are all present and none silently skipped', () => {
  const d = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2b2_sparse_neck_scaffold_design.json', 'utf8'));
  assert.equal(d.buildGateQuestions.length, 7);
  d.buildGateQuestions.forEach(q => assert.ok(q.q && q.a));
});

// ---------- final report contains the exact verdict ----------

test('25. final markdown report contains the exact required verdict string', () => {
  const md = readFileSync(ANALYSIS_DIR + 'bi2b2_corrected_gt_temporal_report.md', 'utf8');
  assert.match(md, /NECK GT VALID -- TEMPORAL EVIDENCE PARTIAL -- BUILD CONSERVATIVE SCAFFOLD WITH LIMITATIONS/);
});

// ---------- production isolation ----------

test('26. production hashes (index.html, worker.js, burst recorder) remain unchanged', () => {
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

test('27. this test module has zero network calls and no scanner runtime references', () => {
  const src = readFileSync(new URL('./bi2b2-corrected-gt-temporal-execution.test.mjs', import.meta.url), 'utf8');
  const bodyOnly = src.slice(src.indexOf("test('1."), src.indexOf("test('27."));
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|BeardTrimAndroid|mgScan2/.test(bodyOnly));
});

test('28. prior BI-2A/BI-2B1/BI-2B1B artifact hashes remain unchanged (no retroactive edits)', () => {
  const files = [
    ['D:/MettleTemp/analysis/bi2a_submental_neck_evidence_characterization.json', 'cfeaeeada32629520e9b62aff14dc151667a4c901891b8297027a61930583a46'],
    ['D:/MettleTemp/analysis/bi2a_neck_model_architecture_decision.json', '390647026a299697af63e2c9e4d0c08ee11053bc50b817e85b05874cc5d37204'],
    ['D:/MettleTemp/annotation/bi2b1_neck_gt_selection_manifest.json', '368d81e121e607c145bd849b2f678f583013bd1f16b078a6d0ac97aaf7d2a5a6'],
    ['D:/MettleTemp/analysis/bi2b1_temporal_neck_clothing_experiment_design.json', 'f272455733cd4aa955093d793bae94d0f4dd72fc54ea6c74af686d8587d9ea45'],
    ['D:/MettleTemp/analysis/bi2b1b_gt_curve_salvage_audit.json', '95db434fff55f7fde1488d37e52ae50c93b7a417fa86ae9b277f00399f82c29e']
  ];
  files.forEach(([path, expected]) => assert.equal(sha256(readFileSync(path)), expected, path));
});
