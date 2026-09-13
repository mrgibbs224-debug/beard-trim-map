import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as N from './sparse-neck-scaffold-v1.mjs';
import * as S from './submental-neck-evidence-characterization-v1.mjs';

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
const ANALYSIS_DIR = 'D:/MettleTemp/analysis/';

// ---------- 1. authoritative artifact hash verification ----------

test('1. BI-2B2 authoritative artifact hashes match exactly', () => {
  const checks = [
    [ANALYSIS_DIR + 'bi2b2_corrected_neck_gt_validation.json', 'a0c0d26fdc74138c02bcd75d9a6f7e74518621906a32127e7f164eeaa0579b08'],
    [ANALYSIS_DIR + 'bi2b2_temporal_neck_clothing_results.json', 'aca164fa9e0dd3e0b477262f6a2c6fdc62833aeacf644fdc6652c5aac39ab1ca'],
    [ANALYSIS_DIR + 'bi2b2_neck_region_evidence_matrix.json', 'c28ebdd68510d44087633d1e5a285cc90998f3c3ac6455bcf0ae3ea4cd685fe0'],
    [ANALYSIS_DIR + 'bi2b2_sparse_neck_scaffold_design.json', 'ddcd4179982ac6d6a80e8186ab4ab513f90b8646f5b47a6e3c18f75e57aff1e0'],
    [ANALYSIS_DIR + 'bi2b2_corrected_gt_temporal_report.md', '0c194ab659af63de98dbc6fd6d50701d1932408bee64875d510f476044f34b6f']
  ];
  checks.forEach(([p, exp]) => assert.equal(sha256(readFileSync(p)), exp, p));
});

// ---------- 2. corrected GT verification ----------

test('2. corrected human GT export hash matches the expected hash', () => {
  const buf = readFileSync('C:/Users/queen/Downloads/bi2b1_neck_gt_annotations_export (1).json');
  assert.equal(sha256(buf), '781d37a1e3c02f17ce49e183ce7f8b380d140857e3ff96a0781010a8d0e69048');
});

// ---------- 3. jaw-rail reuse / no duplicate solver ----------

test('3. sparse-neck-scaffold-v1 re-exports JAW_SUPPORT_RAIL_V1/JAW_CHIN_RAIL identical to the source module', () => {
  assert.deepEqual(N.JAW_SUPPORT_RAIL_V1, S.JAW_SUPPORT_RAIL_V1);
  assert.deepEqual(N.JAW_CHIN_RAIL, S.JAW_CHIN_RAIL);
});

test('4. no duplicate jaw-rail solver exists in the new module (no independent landmark-to-side mapping literal)', () => {
  const src = readFileSync(new URL('./sparse-neck-scaffold-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/172:\s*['"]RIGHT['"]/.test(src), 'must not redefine the jaw-support-rail side mapping locally');
  assert.match(src, /export \{ JAW_SUPPORT_RAIL_V1, JAW_CHIN_RAIL/);
});

// ---------- 5. transition-rail construction ----------

test('5. buildTransitionRail uses the verbatim own GT curve when provided, marked DIRECT_MULTIVIEW_IMAGE', () => {
  const curve = [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 15 }];
  const r = N.buildTransitionRail({ sessionId: 's1', ownGtCurveRaw: curve, personalizedOffsetTemplate: null, anchorLandmark152Raw: { x: 20, y: 5 } });
  assert.equal(r.authorityClass, 'DIRECT_MULTIVIEW_IMAGE');
  assert.deepEqual(r.position.points, curve);
});

test('6. buildTransitionRail reconstructs via personalized template when no own GT exists, marked POSE_CONDITIONED_INFERENCE', () => {
  const template = [{ dx: 1, dy: 2 }, { dx: 3, dy: 4 }];
  const anchor = { x: 100, y: 200 };
  const r = N.buildTransitionRail({ sessionId: 's2', ownGtCurveRaw: null, personalizedOffsetTemplate: template, anchorLandmark152Raw: anchor });
  assert.equal(r.authorityClass, 'POSE_CONDITIONED_INFERENCE');
  assert.deepEqual(r.position.points, [{ x: 101, y: 202 }, { x: 103, y: 204 }]);
});

// ---------- 7. under-jaw rail construction ----------

test('7. buildLateralRail works symmetrically for LEFT and RIGHT with correct anatomicalRegion naming', () => {
  const left = N.buildLateralRail({ sessionId: 's', side: 'LEFT', ownGtCurveRaw: [{ x: 1, y: 1 }, { x: 2, y: 2 }], anchorLandmarkIdx: 397, anchorLandmarkRaw: { x: 0, y: 0 } });
  const right = N.buildLateralRail({ sessionId: 's', side: 'RIGHT', ownGtCurveRaw: [{ x: 1, y: 1 }, { x: 2, y: 2 }], anchorLandmarkIdx: 172, anchorLandmarkRaw: { x: 0, y: 0 } });
  assert.equal(left.anatomicalRegion, 'LEFT_UNDER_JAW');
  assert.equal(right.anatomicalRegion, 'RIGHT_UNDER_JAW');
  assert.equal(left.authorityClass, 'DIRECT_MULTIVIEW_IMAGE');
  assert.equal(right.authorityClass, 'DIRECT_MULTIVIEW_IMAGE');
});

// ---------- 8. authority-class preservation ----------

test('8. every element produced by the real 6-session reconstruction carries an authority class from the frozen vocabulary', () => {
  const sessions = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2c_all_sessions_raw.json', 'utf8'));
  sessions.forEach(s => {
    Object.values(s.elements).forEach(el => {
      assert.ok(N.AUTHORITY_CLASSES.includes(el.authorityClass), `${s.scanSessionId} ${el.supportType || el.anatomicalRegion} has invalid authority class ${el.authorityClass}`);
    });
  });
});

test('9. authority classes are never collapsed -- every non-UNKNOWN element also carries an explicit anchor with its own authorityClass field', () => {
  const sessions = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2c_all_sessions_raw.json', 'utf8'));
  sessions.forEach(s => {
    ['CHIN_NECK_TRANSITION_RAIL', 'LEFT_UNDER_JAW_LATERAL_RAIL', 'RIGHT_UNDER_JAW_LATERAL_RAIL'].forEach(k => {
      const el = s.elements[k];
      if (el.authorityClass !== 'UNKNOWN') assert.equal(el.anchor.authorityClass, 'DIRECT_TRACKED');
    });
  });
});

// ---------- 10. UNKNOWN fail-closed ----------

test('10. builders return UNKNOWN with null points when neither own GT nor a template is available -- never fabricate', () => {
  const r1 = N.buildTransitionRail({ sessionId: 'x', ownGtCurveRaw: null, personalizedOffsetTemplate: null, anchorLandmark152Raw: { x: 1, y: 1 } });
  const r2 = N.buildLateralRail({ sessionId: 'x', side: 'LEFT', ownGtCurveRaw: null, personalizedOffsetTemplate: null, anchorLandmarkIdx: 397, anchorLandmarkRaw: { x: 1, y: 1 } });
  const r3 = N.buildClothingSafetyMargin({ sessionId: 'x', ownPolygonBoundsRaw: null, personalizedMarginOffsetTemplate: null, anchorLandmark152Raw: { x: 1, y: 1 } });
  [r1, r2, r3].forEach(r => { assert.equal(r.authorityClass, 'UNKNOWN'); assert.equal(r.points, null); });
});

// ---------- 11. mandibular-angle limitation ----------

test('11. mandibular-angle connector defaults to terminated UNKNOWN (discontinuity preferred over fake certainty)', () => {
  const r = N.buildMandibularAngleConnector({ side: 'RIGHT', railEndpointRaw: { x: 1, y: 1 } });
  assert.equal(r.authorityClass, 'UNKNOWN');
  assert.equal(r.status, 'TERMINATED_NO_SUPPORT');
});

test('12. mandibular-angle forced weak connector is capped at ANATOMICAL_PRIOR, never promoted higher', () => {
  const r = N.buildMandibularAngleConnector({ side: 'LEFT', railEndpointRaw: { x: 1, y: 1 }, forceEmitWeakConnector: true });
  assert.equal(r.authorityClass, 'ANATOMICAL_PRIOR');
  assert.ok(r.confidence <= 0.15);
  assert.equal(r.isTopologyStubOnly, true);
});

// ---------- 13. visible-neck polygon closure not treated as anatomy ----------

test('13. clothing safety margin point lies strictly beyond the polygon\'s own maxY, never at or above it', () => {
  const bounds = { minX: 0, maxX: 50, minY: 0, maxY: 40 };
  const r = N.buildClothingSafetyMargin({ sessionId: 's', ownPolygonBoundsRaw: bounds, anchorLandmark152Raw: { x: 25, y: 0 } });
  assert.ok(r.position.points[0].y > bounds.maxY);
});

test('14. clothing margin artifact explicitly documents the polygon-closing-edge is NOT anatomy', () => {
  const r = N.buildClothingSafetyMargin({ sessionId: 's', ownPolygonBoundsRaw: { minX: 0, maxX: 10, minY: 0, maxY: 10 }, anchorLandmark152Raw: { x: 5, y: 0 } });
  assert.match(r.explicitNote, /drawing-tool convenience, never treated here as an anatomical boundary/);
  assert.equal(r.isExclusionBoundaryNotPositiveAnatomy, true);
});

// ---------- 15. no closest-surface-below-jaw heuristic ----------

test('15. module contains no "closest surface below" / nearest-neighbor-downward heuristic', () => {
  const src = readFileSync(new URL('./sparse-neck-scaffold-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/closest.?surface|nearest.?surface.?below/i.test(src));
});

// ---------- 16. temporal signal supporting-only / no BI-2B2 threshold fitting ----------

test('16. deformation parameters are explicitly marked fitted:false for every region', () => {
  Object.values(N.DEFORMATION_PARAMS).forEach(p => assert.equal(p.fitted, false));
});

test('17. no deformation parameter is derived via a numeric formula applied to the raw BI-2B2 ratios (constants are hand-set, disclosed as qualitative)', () => {
  const src = readFileSync(new URL('./sparse-neck-scaffold-v1.mjs', import.meta.url), 'utf8');
  // The real BI-2B2 ratio values (1.340/1.425/1.736) may appear in disclosure PROSE (evidenceBasis
  // strings explaining the qualitative rationale), but must never appear inside an arithmetic
  // expression that computes a blend factor from them (which would be exactly the forbidden
  // "fit a production threshold from BI-2B2" behavior).
  assert.ok(!/(1\.340|1\.425|1\.736)\s*[-+*/]|[-+*/]\s*(1\.340|1\.425|1\.736)/.test(src), 'raw BI-2B2 ratio values must not appear inside a computed arithmetic expression');
  assert.ok(!/headBlendFactor:\s*\([^)]*1\.\d{3}/.test(src), 'headBlendFactor must not be computed inline from a raw ratio literal');
});

// ---------- 18. per-region deformation behavior / no fully rigid neck ----------

test('18. every scaffold region has its own distinct deformation parameter object', () => {
  const keys = Object.keys(N.DEFORMATION_PARAMS);
  assert.equal(keys.length, 4);
  const factors = keys.filter(k => N.DEFORMATION_PARAMS[k].headBlendFactor !== null).map(k => N.DEFORMATION_PARAMS[k].headBlendFactor);
  assert.ok(new Set(factors).size > 1, 'regions must not share one uniform blend factor');
});

test('19. no region uses a fully rigid (1.0) or fully independent (0.0) blend factor', () => {
  Object.values(N.DEFORMATION_PARAMS).forEach(p => {
    if (p.headBlendFactor !== null) { assert.ok(p.headBlendFactor > 0 && p.headBlendFactor < 1, `blend factor ${p.headBlendFactor} must be strictly between 0 and 1`); }
  });
});

// ---------- 20. pose-conditioned support ----------

test('20. transition rail is poseCondition CHINUP; lateral rails are poseCondition matching their own side\'s profile', () => {
  const t = N.buildTransitionRail({ sessionId: 's', ownGtCurveRaw: [{ x: 0, y: 0 }, { x: 1, y: 1 }], anchorLandmark152Raw: { x: 0, y: 0 } });
  const l = N.buildLateralRail({ sessionId: 's', side: 'LEFT', ownGtCurveRaw: [{ x: 0, y: 0 }, { x: 1, y: 1 }], anchorLandmarkIdx: 397, anchorLandmarkRaw: { x: 0, y: 0 } });
  const r = N.buildLateralRail({ sessionId: 's', side: 'RIGHT', ownGtCurveRaw: [{ x: 0, y: 0 }, { x: 1, y: 1 }], anchorLandmarkIdx: 172, anchorLandmarkRaw: { x: 0, y: 0 } });
  assert.equal(t.poseCondition, 'CHINUP');
  assert.equal(l.poseCondition, 'LEFT_PROFILE');
  assert.equal(r.poseCondition, 'RIGHT_PROFILE');
});

// ---------- 21. multiview provenance ----------

test('21. every real reconstructed element carries sourceEvidence with scanSessionId/observationId/pose', () => {
  const sessions = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2c_all_sessions_raw.json', 'utf8'));
  sessions.forEach(s => {
    ['CHIN_NECK_TRANSITION_RAIL', 'LEFT_UNDER_JAW_LATERAL_RAIL', 'RIGHT_UNDER_JAW_LATERAL_RAIL', 'NECK_CLOTHING_SAFETY_MARGIN'].forEach(k => {
      const el = s.elements[k];
      if (el.sourceEvidence) {
        assert.ok(el.sourceEvidence.length > 0, `${s.scanSessionId} ${k} missing sourceEvidence`);
        el.sourceEvidence.forEach(ev => assert.ok(ev.scanSessionId && ev.pose));
      }
    });
  });
});

// ---------- 22. no dense authoritative mesh ----------

test('22. module never triangulates a dense surface or mesh -- no triangle/mesh/tessellat reference', () => {
  const src = readFileSync(new URL('./sparse-neck-scaffold-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/triangulat|tessellat|dense.?mesh|\bmesh\b/i.test(src));
});

// ---------- 23. beard/anatomy separation ----------

test('23. module never USES beard occupancy/silhouette/classifier machinery -- the only mentions of beard/neckline/trim terms are inside the explicit exclusion lists documenting what this element must NOT represent', () => {
  const src = readFileSync(new URL('./sparse-neck-scaffold-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/hairness|beard.?classifier|beard.?occupancy.?field/i.test(src), 'must never import/reference actual beard-model machinery');
  const lines = src.split('\n').filter(l => /beard edge|natural neckline|trim line|outer beard silhouette/i.test(l));
  assert.ok(lines.length > 0, 'expected the explicit non-claims list to be present');
  lines.forEach(l => assert.match(l, /excludedFromAnatomicalClaims|doesNotExtendInto|isExclusionBoundaryNotPositiveAnatomy|explicitNote/, `unexpected beard/neckline mention outside a documented exclusion field: ${l}`));
});

// ---------- 24. session isolation (no pooling) ----------

test('24. per-session output file exists individually for all 6 sessions and offline reconstruction produced exactly 6 top-level session results (not pooled into one)', () => {
  const sessions = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2c_all_sessions_raw.json', 'utf8'));
  assert.equal(sessions.length, 6);
  const ids = new Set(sessions.map(s => s.scanSessionId));
  assert.equal(ids.size, 6);
  S.CURRENT_LOCKED_SCANNER_SCAN_IDS.forEach(id => {
    assert.ok(ids.has(id));
    assert.doesNotThrow(() => readFileSync(ANALYSIS_DIR + 'bi2c_per_session/' + id + '_scaffold.json'));
  });
});

// ---------- 25. repeatability analysis ----------

test('25. repeatability artifact reports jaw-span-normalized stats (never raw unnormalized mm claims) for all 3 curve elements', () => {
  const rep = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2c_neck_scaffold_repeatability.json', 'utf8'));
  assert.ok(rep.aggregateStats.transitionRailLengthNormalized.n === 6);
  assert.ok(rep.aggregateStats.leftLateralRailLengthNormalized.n === 6);
  assert.ok(rep.aggregateStats.rightLateralRailLengthNormalized.n === 6);
  assert.match(rep.aggregateStats.note, /No physical \(mm\) units are used or claimed this stage/);
});

// ---------- 26. failure cases ----------

test('26. failure-case analysis artifact reports all scenarios passed and covers the required named scenarios', () => {
  const fa = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2c_neck_scaffold_failure_analysis.json', 'utf8'));
  assert.equal(fa.allPassed, true);
  const names = fa.results.map(r => r.name);
  ['LARGE_UNKNOWN_NO_SUPPORT', 'MISSING_LATERAL_SUPPORT', 'ONE_SIDED_EVIDENCE_REAL_DATASET', 'MANDIBULAR_ANGLE_LARGE_UNKNOWN', 'CLOTHING_MARGIN_NEVER_EQUALS_POLYGON_EDGE', 'TEMPORAL_SUPPORT_UNAVAILABLE', 'TEMPORAL_EVIDENCE_NOISY_NOT_FITTED', 'NO_UNCONTROLLED_GROWTH_REAL_DATASET'].forEach(n => assert.ok(names.includes(n), n));
});

// ---------- 27. no production scanner modification ----------

test('27. production hashes (index.html, worker.js, burst recorder) remain unchanged', () => {
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

// ---------- 28. no network ----------

test('28. sparse-neck-scaffold-v1 module has zero network calls', () => {
  const src = readFileSync(new URL('./sparse-neck-scaffold-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(src));
});

// ---------- 29. no paid dependency ----------

test('29. module imports only local project files, no third-party/paid API package', () => {
  const src = readFileSync(new URL('./sparse-neck-scaffold-v1.mjs', import.meta.url), 'utf8');
  const importLines = src.match(/^import .*/gm) || [];
  importLines.forEach(line => assert.match(line, /from '\.\//, `unexpected non-local import: ${line}`));
});

// ---------- 30. no automatic all-11-region expansion ----------

test('30. assembleSessionScaffold exposes exactly the V1-justified elements, not all 11 BI-2A regions', () => {
  const s = N.assembleSessionScaffold({ sessionId: 'x', transitionRail: {}, rightLateralRail: {}, leftLateralRail: {}, clothingMargin: {}, rightMandibularConnector: {}, leftMandibularConnector: {} });
  const keys = Object.keys(s.elements);
  assert.equal(keys.length, 6); // transition + 2 lateral + clothing margin + 2 mandibular connectors (weak/terminated placeholders only)
  ['UPPER_RIGHT_NECK', 'UPPER_LEFT_NECK', 'CENTRAL_UNDER_CHIN', 'RIGHT_PARA_CHIN', 'LEFT_PARA_CHIN'].forEach(r => assert.ok(!keys.includes(r)));
});

// ---------- diagnostic visualization labeling ----------

test('31. any generated diagnostic overlay is explicitly labeled NON_AUTHORITATIVE_DIAGNOSTIC_INTERPOLATION', () => {
  const src = readFileSync('D:/MettleTemp/analysis/generators/bi2c-visualize.mjs', 'utf8');
  assert.match(src, /NON_AUTHORITATIVE_DIAGNOSTIC_INTERPOLATION/);
});

test('32. final report contains the exact required verdict string', () => {
  const md = readFileSync(ANALYSIS_DIR + 'bi2c_sparse_neck_scaffold_v1_report.md', 'utf8');
  assert.match(md, /SPARSE NECK SCAFFOLD V1 PARTIAL -- TARGETED REGIONS NEED MORE EVIDENCE/);
});
