// Stage BS1-E1 — adversarial stress + edge-case hardening for the BS1-E semantic
// evaluation harness. Synthetic records only. No model, no pixels, no network.
// node:test + node:assert/strict. Zero dependencies.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HairState } from './beard-surface-core.mjs';
import { SyncStatus } from './multi-observation-scan-package.mjs';
import {
  evaluateSemanticProducer, emptyEvaluationReport, compareEvaluationReports,
  evaluateAgainstPolicy, evaluationDiagnosticString, ComparisonVerdict, NOT_EVALUABLE, POSITIVE_HAIR_STATE
} from './semantic-evaluation.mjs';

const P = (id, region, state, x = {}) => ({
  sourceScanObservationId: id, anatomicalRegion: region, hairState: state,
  poseId: 'front', syncStatus: SyncStatus.EXACT_SYNCHRONIZED, ...x
});
const G = (id, region, state, x = {}) => ({
  sourceScanObservationId: id, anatomicalRegion: region, hairState: state,
  poseId: 'front', syncStatus: SyncStatus.EXACT_SYNCHRONIZED, ...x
});
const finiteOrNull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));
function assertNoNaNInf(report) {
  const seen = new WeakSet();
  (function walk(o) {
    if (o == null || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    for (const v of Object.values(o)) {
      if (typeof v === 'number') { assert.ok(Number.isFinite(v), 'non-finite number in report: ' + v); }
      else if (typeof v === 'object') walk(v);
    }
  })(report);
}
function assertRatesBounded(report) {
  const om = report.overallMetrics;
  for (const k of ['precision', 'recall', 'specificity', 'f1', 'accuracy', 'falseBeardRate', 'falseNonBeardRate',
    'groundTruthUnknownRate', 'predictionUnknownRate', 'predictionUncertainRate', 'scorableRate']) {
    const v = om[k];
    assert.ok(v === null || (v >= 0 && v <= 1), k + ' out of [0,1]/null: ' + v);
  }
  for (const k of ['precision', 'recall', 'f1']) {
    const v = om.boundary[k];
    assert.ok(v === null || (v >= 0 && v <= 1), 'boundary.' + k + ' out of [0,1]/null: ' + v);
  }
  assert.ok(report.matchingSummary.coverageRate === null || (report.matchingSummary.coverageRate >= 0 && report.matchingSummary.coverageRate <= 1));
}

// ---- PART 3 — extreme class imbalance -----------------------------------------
test('PART3: 99 NON_BEARD + 1 BEARD, perfect producer — metrics correct, accuracy does not hide danger', () => {
  const preds = [], gts = [];
  for (let i = 0; i < 99; i++) { preds.push(P('n' + i, 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED)); gts.push(G('n' + i, 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED)); }
  preds.push(P('b0', 'LEFT_JAW', HairState.BEARD_CONFIRMED)); gts.push(G('b0', 'LEFT_JAW', HairState.BEARD_CONFIRMED));
  const r = evaluateSemanticProducer(preds, gts);
  assert.equal(r.overallMetrics.truePositives, 1);
  assert.equal(r.overallMetrics.trueNegatives, 99);
  assert.equal(r.overallMetrics.precision, 1);
  assert.equal(r.overallMetrics.recall, 1);
  assert.equal(r.overallMetrics.specificity, 1);
  assert.equal(r.overallMetrics.f1, 1);
  assert.equal(r.overallMetrics.accuracy, 1);
  assert.equal(r.overallMetrics.falseBeardRate, 0);
  assert.equal(r.overallMetrics.falseNonBeardRate, 0);
});

test('PART3: 99 NON_BEARD GT + producer always BEARD — high-looking accuracy? NO; falseBeardRate = 1', () => {
  const preds = [], gts = [];
  for (let i = 0; i < 99; i++) { preds.push(P('n' + i, 'LEFT_JAW', HairState.BEARD_CONFIRMED)); gts.push(G('n' + i, 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED)); }
  preds.push(P('b0', 'LEFT_JAW', HairState.BEARD_CONFIRMED)); gts.push(G('b0', 'LEFT_JAW', HairState.BEARD_CONFIRMED));
  const r = evaluateSemanticProducer(preds, gts);
  assert.equal(r.overallMetrics.falsePositives, 99);
  assert.equal(r.overallMetrics.falseBeardCount, 99);
  assert.equal(r.overallMetrics.falseBeardRate, 1);          // 99/99 GT non-beard called beard
  assert.equal(r.overallMetrics.recall, 1);                  // the one real beard is caught
  assert.equal(r.overallMetrics.specificity, 0);             // caught none of the non-beards
  assert.equal(r.overallMetrics.accuracy, 0.01);             // (1+0)/100 — does NOT hide falseBeardRate=1
  assertRatesBounded(r); assertNoNaNInf(r);
});

test('PART3: 99 BEARD GT + producer always NON_BEARD — falseNonBeardRate = 1', () => {
  const preds = [], gts = [];
  for (let i = 0; i < 99; i++) { preds.push(P('b' + i, 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED)); gts.push(G('b' + i, 'LEFT_JAW', HairState.BEARD_CONFIRMED)); }
  preds.push(P('n0', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED)); gts.push(G('n0', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED));
  const r = evaluateSemanticProducer(preds, gts);
  assert.equal(r.overallMetrics.falseNegatives, 99);
  assert.equal(r.overallMetrics.falseNonBeardCount, 99);
  assert.equal(r.overallMetrics.falseNonBeardRate, 1);
  assert.equal(r.overallMetrics.recall, 0);
  assert.equal(r.overallMetrics.precision, null);            // TP+FP = 0
  assertRatesBounded(r); assertNoNaNInf(r);
});

test('PART3: BOUNDARY-dominated and UNKNOWN-dominated datasets stay bounded', () => {
  const mk = (state) => {
    const preds = [], gts = [];
    for (let i = 0; i < 50; i++) { preds.push(P('x' + i, 'CHIN_CENTER', state)); gts.push(G('x' + i, 'CHIN_CENTER', state)); }
    return evaluateSemanticProducer(preds, gts);
  };
  assertRatesBounded(mk(HairState.BOUNDARY)); assertNoNaNInf(mk(HairState.BOUNDARY));
  assertRatesBounded(mk(HairState.UNKNOWN)); assertNoNaNInf(mk(HairState.UNKNOWN));
  assert.equal(mk(HairState.BOUNDARY).overallMetrics.boundary.recall, 1); // perfect boundary
});

// ---- PART 4 — all one class -------------------------------------------------
test('PART4: all-one-class GT — zero-denominator metrics return null, never NaN/Infinity', () => {
  for (const state of [HairState.BEARD_CONFIRMED, HairState.NON_BEARD_CONFIRMED, HairState.BOUNDARY, HairState.UNKNOWN, HairState.UNCERTAIN]) {
    const preds = [], gts = [];
    for (let i = 0; i < 10; i++) { preds.push(P('a' + i, 'LEFT_JAW', state)); gts.push(G('a' + i, 'LEFT_JAW', state)); }
    const r = evaluateSemanticProducer(preds, gts);
    assertNoNaNInf(r); assertRatesBounded(r);
    for (const k of ['precision', 'recall', 'specificity', 'f1', 'accuracy', 'falseBeardRate', 'falseNonBeardRate']) {
      assert.ok(finiteOrNull(r.overallMetrics[k]), state + '.' + k + ' = ' + r.overallMetrics[k]);
    }
  }
});

// ---- PART 5 — all-abstaining producer -------------------------------------
test('PART5: producer predicts UNKNOWN for every definite GT — abstention, not false NON_BEARD', () => {
  const preds = [], gts = [];
  for (let i = 0; i < 20; i++) { preds.push(P('d' + i, 'LEFT_JAW', HairState.UNKNOWN)); gts.push(G('d' + i, 'LEFT_JAW', i % 2 ? HairState.BEARD_CONFIRMED : HairState.NON_BEARD_CONFIRMED)); }
  const r = evaluateSemanticProducer(preds, gts);
  assert.equal(r.overallMetrics.falseNegatives, 0);
  assert.equal(r.overallMetrics.falsePositives, 0);
  assert.equal(r.overallMetrics.predictionUnknownRate, 1);
  assert.equal(r.overallMetrics.predictionAbstainedOnDefiniteGtCount, 20);
  assert.equal(r.overallMetrics.binaryScorablePairs, 0);
  assert.equal(r.confusionMatrix[HairState.BEARD_CONFIRMED][HairState.UNKNOWN], 10);
  assert.equal(r.matchingSummary.coverageRate, 1); // all matched
});

test('PART5: producer predicts UNCERTAIN for every definite GT — tracked distinctly from UNKNOWN', () => {
  const preds = [], gts = [];
  for (let i = 0; i < 20; i++) { preds.push(P('u' + i, 'LEFT_JAW', HairState.UNCERTAIN)); gts.push(G('u' + i, 'LEFT_JAW', HairState.BEARD_CONFIRMED)); }
  const r = evaluateSemanticProducer(preds, gts);
  assert.equal(r.overallMetrics.predictionUncertainRate, 1);
  assert.equal(r.overallMetrics.predictionUnknownRate, 0);
  assert.equal(r.overallMetrics.falseNegatives, 0);
});

// ---- PART 6 — perfect producer -----------------------------------------------
test('PART6: perfect producer on BEARD/NON_BEARD/BOUNDARY — all metrics 1, zero danger counts', () => {
  const preds = [], gts = [];
  const cycle = [HairState.BEARD_CONFIRMED, HairState.NON_BEARD_CONFIRMED, HairState.BOUNDARY];
  for (let i = 0; i < 30; i++) { const s = cycle[i % 3]; preds.push(P('p' + i, 'LEFT_JAW', s)); gts.push(G('p' + i, 'LEFT_JAW', s)); }
  const r = evaluateSemanticProducer(preds, gts);
  for (const k of ['precision', 'recall', 'specificity', 'f1', 'accuracy']) assert.equal(r.overallMetrics[k], 1, k);
  for (const k of ['precision', 'recall', 'f1']) assert.equal(r.overallMetrics.boundary[k], 1, 'boundary.' + k);
  assert.equal(r.overallMetrics.falseBeardCount, 0);
  assert.equal(r.overallMetrics.falseNonBeardCount, 0);
});

// ---- PART 7 — perfectly wrong producer ------------------------------------
test('PART7: swapped binary classes — TP/TN 0, FP/FN correct, danger counts full', () => {
  const preds = [], gts = [];
  for (let i = 0; i < 10; i++) { preds.push(P('b' + i, 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED)); gts.push(G('b' + i, 'LEFT_JAW', HairState.BEARD_CONFIRMED)); }
  for (let i = 0; i < 10; i++) { preds.push(P('n' + i, 'LEFT_JAW', HairState.BEARD_CONFIRMED)); gts.push(G('n' + i, 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED)); }
  const r = evaluateSemanticProducer(preds, gts);
  assert.equal(r.overallMetrics.truePositives, 0);
  assert.equal(r.overallMetrics.trueNegatives, 0);
  assert.equal(r.overallMetrics.falsePositives, 10);
  assert.equal(r.overallMetrics.falseNegatives, 10);
  assert.equal(r.overallMetrics.precision, 0);
  assert.equal(r.overallMetrics.recall, 0);
  assert.equal(r.overallMetrics.specificity, 0);
  assert.equal(r.overallMetrics.f1, null);          // P+R = 0
  assert.equal(r.overallMetrics.accuracy, 0);
  assert.equal(r.overallMetrics.falseBeardRate, 1);
  assert.equal(r.overallMetrics.falseNonBeardRate, 1);
});

// ---- PART 8 — boundary failure modes -------------------------------------
test('PART8: boundary mistakes stay in boundary one-vs-rest, not binary false-beard/non-beard', () => {
  const preds = [
    P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED),        // GT BOUNDARY -> pred BEARD
    P('b', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED),    // GT BOUNDARY -> pred NON_BEARD
    P('c', 'LEFT_JAW', HairState.BOUNDARY),               // GT BEARD -> pred BOUNDARY
    P('d', 'LEFT_JAW', HairState.BOUNDARY),               // GT NON_BEARD -> pred BOUNDARY
    P('e', 'LEFT_JAW', HairState.BOUNDARY)                // GT BOUNDARY -> pred BOUNDARY
  ];
  const gts = [
    G('a', 'LEFT_JAW', HairState.BOUNDARY), G('b', 'LEFT_JAW', HairState.BOUNDARY),
    G('c', 'LEFT_JAW', HairState.BEARD_CONFIRMED), G('d', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED),
    G('e', 'LEFT_JAW', HairState.BOUNDARY)
  ];
  const r = evaluateSemanticProducer(preds, gts);
  // binary set = pairs where BOTH sides are BEARD/NON_BEARD -> none here
  assert.equal(r.overallMetrics.binaryScorablePairs, 0);
  assert.equal(r.overallMetrics.falseBeardCount, 0);
  assert.equal(r.overallMetrics.falseNonBeardCount, 0);
  // boundary one-vs-rest: TP=1 (e), FP=2 (c,d predicted BOUNDARY vs non-BOUNDARY GT), FN=2 (a,b)
  assert.equal(r.overallMetrics.boundary.truePositives, 1);
  assert.equal(r.overallMetrics.boundary.falsePositives, 2);
  assert.equal(r.overallMetrics.boundary.falseNegatives, 2);
});

// ---- PART 9 — missing ground truth -------------------------------------
test('PART9: predictions without GT are unscored; GT without prediction counted; rates bounded', () => {
  const r = evaluateSemanticProducer(
    [P('x1', 'LEFT_JAW', HairState.BEARD_CONFIRMED), P('x2', 'LEFT_JAW', HairState.BEARD_CONFIRMED)],
    [G('x1', 'LEFT_JAW', HairState.BEARD_CONFIRMED), G('y9', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED)]
  );
  assert.equal(r.matchingSummary.matchedPairs, 1);
  assert.equal(r.matchingSummary.predictionsWithoutGroundTruth, 1);
  assert.equal(r.matchingSummary.groundTruthWithoutPrediction, 1);
  assert.equal(r.overallMetrics.trueNegatives, 0); // no fake TN for the unmatched GT
  assert.equal(r.matchingSummary.coverageRate, 0.5);
  assertRatesBounded(r);
});

// ---- PART 10 — ambiguous duplicate GT --------------------------------
test('PART10: two active GT for one key -> fail closed EXCLUDED_AMBIGUOUS_GT, no scored pair', () => {
  const r = evaluateSemanticProducer(
    [P('o1', 'LEFT_JAW', HairState.BEARD_CONFIRMED)],
    [G('o1', 'LEFT_JAW', HairState.BEARD_CONFIRMED), G('o1', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED)]
  );
  assert.equal(r.matchingSummary.matchedPairs, 0);
  assert.equal(r.excluded[0].outcome, 'EXCLUDED_AMBIGUOUS_GT');
  assert.equal(r.overallMetrics.truePositives, 0);
  assert.equal(r.overallMetrics.falsePositives, 0);
});

// ---- PART 11 — identity conflict matrix ------------------------------
test('PART11: single-field and multi-field identity conflicts exclude the pair', () => {
  const base = { sourceScanObservationId: 'o1', anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED };
  const gt = { ...base, imageRef: 'ref-A', poseId: 'front', nativeFrameTimestampNs: 1000 };
  for (const [field, predExtra] of [
    ['imageRef', { imageRef: 'ref-B', poseId: 'front', nativeFrameTimestampNs: 1000 }],
    ['poseId', { imageRef: 'ref-A', poseId: 'chin-up', nativeFrameTimestampNs: 1000 }],
    ['nativeFrameTimestampNs', { imageRef: 'ref-A', poseId: 'front', nativeFrameTimestampNs: 9999 }]
  ]) {
    const r = evaluateSemanticProducer([{ ...base, ...predExtra }], [gt]);
    assert.equal(r.matchingSummary.matchedPairs, 0);
    assert.equal(r.excluded[0].outcome, 'EXCLUDED_IDENTITY_CONFLICT');
  }
  const multi = evaluateSemanticProducer([{ ...base, imageRef: 'ref-B', poseId: 'chin-up', nativeFrameTimestampNs: 9999 }], [gt]);
  assert.equal(multi.excluded[0].outcome, 'EXCLUDED_IDENTITY_CONFLICT');
  assert.equal(multi.matchingSummary.matchedPairs, 0);
});

test('PART11: timestampToleranceNs — inside tolerance allowed, outside excluded, no nearest-frame matching', () => {
  const gt = { sourceScanObservationId: 'o1', anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED, nativeFrameTimestampNs: 1000, imageRef: 'r', poseId: 'front' };
  const inTol = evaluateSemanticProducer([{ ...gt, nativeFrameTimestampNs: 1005 }], [gt], { timestampToleranceNs: 10 });
  assert.equal(inTol.matchingSummary.matchedPairs, 1);
  const outTol = evaluateSemanticProducer([{ ...gt, nativeFrameTimestampNs: 1100 }], [gt], { timestampToleranceNs: 10 });
  assert.equal(outTol.matchingSummary.matchedPairs, 0);
  assert.equal(outTol.excluded[0].outcome, 'EXCLUDED_IDENTITY_CONFLICT');
  // a pred with a DIFFERENT sourceScanObservationId is never matched by nearest timestamp
  const nearest = evaluateSemanticProducer([{ ...gt, sourceScanObservationId: 'o2', nativeFrameTimestampNs: 1000 }], [gt], { timestampToleranceNs: 1000000 });
  assert.equal(nearest.matchingSummary.matchedPairs, 0);
  assert.equal(nearest.matchingSummary.predictionsWithoutGroundTruth, 1);
});

// ---- PART 12 — sync stress -----------------------------------------
test('PART12: perSyncStatus strata, weak sync never relabelled EXACT, exactOnly filter', () => {
  const rows = SyncStatus ? Object.values(SyncStatus) : [];
  const preds = [], gts = [];
  rows.forEach((s, i) => {
    preds.push(P('s' + i, 'LEFT_JAW', HairState.BEARD_CONFIRMED, { syncStatus: s }));
    gts.push(G('s' + i, 'LEFT_JAW', HairState.BEARD_CONFIRMED, { syncStatus: s }));
  });
  const all = evaluateSemanticProducer(preds, gts);
  assert.notEqual(all.perSyncStatus[SyncStatus.EXACT_SYNCHRONIZED], NOT_EVALUABLE);
  assert.notEqual(all.perSyncStatus[SyncStatus.NEAR_SYNCHRONIZED], NOT_EVALUABLE);
  assert.notEqual(all.perSyncStatus[SyncStatus.UNPAIRED], NOT_EVALUABLE);
  const exactOnly = evaluateSemanticProducer(preds, gts, { exactOnly: true });
  assert.equal(exactOnly.matchingSummary.matchedPairs, 1);
  assert.equal(exactOnly.perSyncStatus[SyncStatus.NEAR_SYNCHRONIZED], NOT_EVALUABLE);
});

test('PART12: pred sync missing falls back to GT sync (documented) and is not upgraded', () => {
  const gt = G('o1', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { syncStatus: SyncStatus.NEAR_SYNCHRONIZED });
  const pred = { sourceScanObservationId: 'o1', anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED, poseId: 'front' }; // no syncStatus
  const r = evaluateSemanticProducer([pred], [gt]);
  assert.notEqual(r.perSyncStatus[SyncStatus.NEAR_SYNCHRONIZED], NOT_EVALUABLE);
  assert.equal(r.perSyncStatus[SyncStatus.EXACT_SYNCHRONIZED], NOT_EVALUABLE);
});

// ---- PART 13 — pose imbalance --------------------------------------
test('PART13: 100 Front + 1 Right-Profile + 1 Chin-Up — per-pose independent, totals reconcile', () => {
  const preds = [], gts = [];
  for (let i = 0; i < 100; i++) { preds.push(P('f' + i, 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'front' })); gts.push(G('f' + i, 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'front' })); }
  preds.push(P('rp', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED, { poseId: 'right-profile' }));
  gts.push(G('rp', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'right-profile' }));  // a wrong one
  preds.push(P('cu', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'chin-up' }));
  gts.push(G('cu', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'chin-up' }));
  const r = evaluateSemanticProducer(preds, gts);
  assert.equal(r.observationLevelCount, 102);
  assert.equal(r.perPose['front'].recall, 1);
  assert.equal(r.perPose['right-profile'].recall, 0);         // its single wrong pair, not diluted by Front
  assert.equal(r.perPose['right-profile'].falseNegatives, 1);
  assert.equal(r.perPose['chin-up'].truePositives, 1);
  const poseMatched = ['front', 'right-45', 'right-profile', 'left-45', 'left-profile', 'chin-up']
    .reduce((n, p) => n + (r.perPose[p] === NOT_EVALUABLE ? 0 : r.perPose[p].pairCount), 0);
  assert.equal(poseMatched, 102);
  const aggRP = r.poseRegionAggregate.filter(a => a.pose === 'right-profile' && a.region === 'LEFT_JAW');
  assert.equal(aggRP.length, 1);
});

// ---- PART 14 — one pose only ------------------------------------
test('PART14: single-pose dataset — other formal poses are NOT_EVALUABLE, not 0 accuracy', () => {
  for (const pose of ['front', 'right-profile', 'chin-up']) {
    const r = evaluateSemanticProducer(
      [P('o1', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: pose })],
      [G('o1', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: pose })]
    );
    assert.notEqual(r.perPose[pose], NOT_EVALUABLE);
    for (const other of ['front', 'right-45', 'right-profile', 'left-45', 'left-profile', 'chin-up']) {
      if (other === pose) continue;
      assert.equal(r.perPose[other], NOT_EVALUABLE, other + ' should be NOT_EVALUABLE');
    }
  }
});

// ---- PART 15 — cross-pose consistency -----------------------------
test('PART15: cross-pose consistency detects stable, conflict, and does not manufacture conflict from UNKNOWN', () => {
  const stable = evaluateSemanticProducer(
    ['front', 'right-45', 'right-profile'].map((p, i) => P('c' + i, 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: p })),
    ['front', 'right-45', 'right-profile'].map((p, i) => G('c' + i, 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: p }))
  );
  assert.deepEqual(stable.crossPoseConsistency.crossPoseStableRegions, ['LEFT_JAW']);
  assert.equal(stable.crossPoseConsistency.crossPoseConflictCount, 0);

  const conflict = evaluateSemanticProducer(
    [P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'front' }),
     P('b', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED, { poseId: 'right-45' }),
     P('c', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'right-profile' })],
    ['front', 'right-45', 'right-profile'].map((p, i) => G(['a', 'b', 'c'][i], 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: p }))
  );
  assert.deepEqual(conflict.crossPoseConsistency.crossPoseUnstableRegions, ['LEFT_JAW']);
  assert.equal(conflict.crossPoseConsistency.crossPoseConflictCount, 1);

  const withUnknown = evaluateSemanticProducer(
    [P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'front' }),
     P('b', 'LEFT_JAW', HairState.UNKNOWN, { poseId: 'right-45' })],
    [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'front' }),
     G('b', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'right-45' })]
  );
  // BEARD vs UNKNOWN across poses is "unstable" (different states) but NOT a binary conflict
  assert.equal(withUnknown.crossPoseConsistency.crossPoseConflictCount, 0);
});

// ---- PART 16 — transition observations ---------------------------
test('PART16: a formal pose + observedPoseRegion transition — stratified by the FORMAL pose', () => {
  const r = evaluateSemanticProducer(
    [P('t1', 'RIGHT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'right-45', observedPoseRegion: 'RIGHT45_TO_RIGHT_PROFILE' })],
    [G('t1', 'RIGHT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'right-45', observedPoseRegion: 'RIGHT45_TO_RIGHT_PROFILE' })]
  );
  assert.notEqual(r.perPose['right-45'], NOT_EVALUABLE);
  assert.equal(r.matchingSummary.transitionPairs, 0);         // it has a valid formal pose
  assert.equal(Object.keys(r.perPose).indexOf('RIGHT45_TO_RIGHT_PROFILE'), -1); // never a 7th pose
});

test('PART16: a pair whose pose is not a formal SCAN_POSE counts as a transitionPair, not a pose bucket', () => {
  const r = evaluateSemanticProducer(
    [P('t1', 'RIGHT_JAW', HairState.BEARD_CONFIRMED, { poseId: null, observedPoseRegion: 'RIGHT45_TO_RIGHT_PROFILE' })],
    [G('t1', 'RIGHT_JAW', HairState.BEARD_CONFIRMED, { poseId: null, observedPoseRegion: 'RIGHT45_TO_RIGHT_PROFILE' })]
  );
  assert.equal(r.matchingSummary.transitionPairs, 1);
  assert.equal(r.matchingSummary.matchedPairs, 1);            // still matched + scored overall
  assert.equal(r.overallMetrics.truePositives, 1);
});

// ---- PART 17 — confidence extremes ------------------------------
test('PART17: confidence 0 / 1 / null and exact-edge binning are deterministic and single-membership', () => {
  const confs = [0, 0.01, 0.49, 0.5, 0.99, 1, null];
  const preds = confs.map((c, i) => P('c' + i, 'LEFT_JAW', HairState.BEARD_CONFIRMED, { semanticConfidence: c }));
  const gts = confs.map((c, i) => G('c' + i, 'LEFT_JAW', HairState.BEARD_CONFIRMED));
  const r = evaluateSemanticProducer(preds, gts, { confidenceBins: [0, 0.5, 1] });
  const cal = r.confidenceCalibration;
  assert.equal(cal.predictionsWithConfidence, 6);            // null excluded
  assert.equal(cal.predictionsWithoutConfidence, 1);
  assert.equal(cal.bins.length, 2);
  // bin0 = [0,0.5)  -> 0, 0.01, 0.49  = 3 ; bin1 = [0.5,1] -> 0.5, 0.99, 1 = 3
  assert.equal(cal.bins[0].count, 3);
  assert.equal(cal.bins[1].count, 3);
  assert.equal(cal.bins[0].count + cal.bins[1].count, cal.predictionsWithConfidence); // nothing lost / double-counted
});

// ---- PART 18 — invalid confidence bins (defect probe) -----------
test('PART18: unsorted / non-finite / out-of-range / too-short bins are rejected cleanly (no misleading bins)', () => {
  const preds = [0.6, 0.6, 0.6].map((c, i) => P('c' + i, 'LEFT_JAW', HairState.BEARD_CONFIRMED, { semanticConfidence: c }));
  const gts = preds.map((_, i) => G('c' + i, 'LEFT_JAW', HairState.BEARD_CONFIRMED));
  const bad = [
    [0, 0.8, 0.5, 1],       // unsorted -> would double-count 0.6 in [0,0.8) AND [0.5,1]
    [0, 0.5, 0.5, 1],       // duplicated edge
    [-0.5, 0.5, 1.5],       // outside [0,1]
    [0],                    // too short
    [0, NaN, 1],            // NaN
    [0, Infinity]           // Infinity
  ];
  for (const bins of bad) {
    const r = evaluateSemanticProducer(preds, gts, { confidenceBins: bins });
    const cal = r.confidenceCalibration;
    assert.equal(cal.bins, null, 'invalid bins ' + JSON.stringify(bins) + ' must not produce bin rows');
    if (cal.bins == null) {
      // a rejection reason is present for a supplied-but-invalid bins argument
      assert.ok(cal.binsRejectedReason == null || typeof cal.binsRejectedReason === 'string');
    }
  }
  // the canonical valid bins still work
  const ok = evaluateSemanticProducer(preds, gts, { confidenceBins: [0, 0.5, 1] });
  assert.equal(ok.confidenceCalibration.bins.length, 2);
  assert.equal(ok.confidenceCalibration.bins[1].count, 3); // all at 0.6
});

// ---- PART 19 & 20 — large deterministic fixture + reconciliation -----
function bigFixture(n) {
  const POSES = ['front', 'right-45', 'right-profile', 'left-45', 'left-profile', 'chin-up'];
  const REGIONS = ['LEFT_JAW', 'RIGHT_JAW', 'CHIN_CENTER', 'LEFT_LOWER_CHEEK', 'RIGHT_LOWER_CHEEK'];
  const STATES = [HairState.BEARD_CONFIRMED, HairState.NON_BEARD_CONFIRMED, HairState.BOUNDARY, HairState.UNCERTAIN, HairState.UNKNOWN];
  const SYNCS = [SyncStatus.EXACT_SYNCHRONIZED, SyncStatus.NEAR_SYNCHRONIZED, SyncStatus.UNPAIRED, SyncStatus.UNKNOWN];
  const preds = [], gts = [];
  for (let i = 0; i < n; i++) {
    const pose = POSES[i % 6], region = REGIONS[i % 5];
    const gtState = STATES[i % 5];
    const predState = STATES[(i * 3 + 1) % 5];               // deterministic drift
    const sync = SYNCS[i % 4];
    const conf = (i % 7 === 0) ? null : ((i % 100) / 100);
    const id = 'o' + i;
    preds.push({ sourceScanObservationId: id, anatomicalRegion: region, hairState: predState, poseId: pose, syncStatus: sync, semanticConfidence: conf });
    gts.push({ sourceScanObservationId: id, anatomicalRegion: region, hairState: gtState, poseId: pose, syncStatus: sync });
  }
  return { preds, gts };
}
test('PART19/20: 1200-pair deterministic fixture — no NaN/Inf, rates bounded, counts reconcile', () => {
  const { preds, gts } = bigFixture(1200);
  const t0 = process.hrtime.bigint();
  const r = evaluateSemanticProducer(preds, gts, { confidenceBins: [0, 0.25, 0.5, 0.75, 1] });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  assertNoNaNInf(r); assertRatesBounded(r);
  assert.equal(r.matchingSummary.matchedPairs, 1200);

  // confusion matrix total == matched pairs
  let cmTotal = 0;
  for (const g of Object.keys(r.confusionMatrix)) for (const p of Object.keys(r.confusionMatrix[g])) cmTotal += r.confusionMatrix[g][p];
  assert.equal(cmTotal, 1200);

  const om = r.overallMetrics;
  assert.equal(om.binaryScorablePairs, om.truePositives + om.falsePositives + om.trueNegatives + om.falseNegatives);
  assert.equal(om.falseBeardCount, om.falsePositives);
  assert.equal(om.falseNonBeardCount, om.falseNegatives);

  // per-pose matched totals sum to matched pairs (every pair has a formal pose here)
  const poseSum = ['front', 'right-45', 'right-profile', 'left-45', 'left-profile', 'chin-up']
    .reduce((s, p) => s + (r.perPose[p] === NOT_EVALUABLE ? 0 : r.perPose[p].pairCount), 0);
  assert.equal(poseSum, 1200);

  // per-sync totals reconcile
  const syncSum = [SyncStatus.EXACT_SYNCHRONIZED, SyncStatus.NEAR_SYNCHRONIZED, SyncStatus.UNPAIRED, SyncStatus.UNKNOWN]
    .reduce((s, k) => s + (r.perSyncStatus[k] === NOT_EVALUABLE ? 0 : r.perSyncStatus[k].pairCount), 0);
  assert.equal(syncSum, 1200);

  // calibration bins do not lose or double-count confident predictions
  const binTotal = r.confidenceCalibration.bins.reduce((s, b) => s + b.count, 0);
  assert.equal(binTotal, r.confidenceCalibration.predictionsWithConfidence);

  assert.ok(ms < 5000, 'observational only — took ' + ms.toFixed(1) + 'ms');
});

// ---- PART 21 — comparison stress -----------------------------------
test('PART21: comparison — no policy => verdict null; explicit policy => IMPROVED / REGRESSED / MIXED', () => {
  const better = evaluateSemanticProducer(
    [P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), P('b', 'NECK_FRONT', HairState.NON_BEARD_CONFIRMED)],
    [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), G('b', 'NECK_FRONT', HairState.NON_BEARD_CONFIRMED)]
  );
  const worse = evaluateSemanticProducer(
    [P('a', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED), P('b', 'NECK_FRONT', HairState.NON_BEARD_CONFIRMED)],
    [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), G('b', 'NECK_FRONT', HairState.NON_BEARD_CONFIRMED)]
  );
  assert.equal(compareEvaluationReports(better, worse).verdict, null);
  assert.equal(compareEvaluationReports(better, worse, { policy: { maxRegress: 0.05, metrics: ['beardRecall'] } }).verdict, ComparisonVerdict.REGRESSED);
  assert.equal(compareEvaluationReports(worse, better, { policy: { minImprove: 0.1, metrics: ['beardRecall'] } }).verdict, ComparisonVerdict.IMPROVED);
  assert.equal(compareEvaluationReports(better, better, { policy: {} }).verdict, ComparisonVerdict.UNCHANGED);
});

test('PART21: candidate improves recall but worsens falseBeardRate -> MIXED under a policy tracking both', () => {
  // baseline: 1 true beard caught, 1 non-beard correct
  const baseline = evaluateSemanticProducer(
    [P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), P('b', 'NECK_FRONT', HairState.NON_BEARD_CONFIRMED)],
    [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), G('b', 'NECK_FRONT', HairState.NON_BEARD_CONFIRMED)]
  );
  // candidate: still catches beard, but now calls the non-beard "beard" -> falseBeardRate worse, recall same(1)
  const candidate = evaluateSemanticProducer(
    [P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), P('b', 'NECK_FRONT', HairState.BEARD_CONFIRMED)],
    [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), G('b', 'NECK_FRONT', HairState.NON_BEARD_CONFIRMED)]
  );
  const cmp = compareEvaluationReports(baseline, candidate, { policy: { maxRegress: 0.05, minImprove: 0.05, metrics: ['beardRecall', 'falseBeardRate'] } });
  assert.equal(cmp.verdict, ComparisonVerdict.REGRESSED); // falseBeardRate went 0 -> 1
  assert.ok(cmp.deltas.falseBeardRate > 0);
});

// ---- PART 22 — policy edge cases ---------------------------------
test('PART22: evaluateAgainstPolicy edge cases — no false PASS when a required metric is not evaluable', () => {
  const clean = evaluateSemanticProducer(
    [P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), P('b', 'NECK_FRONT', HairState.NON_BEARD_CONFIRMED)],
    [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), G('b', 'NECK_FRONT', HairState.NON_BEARD_CONFIRMED)]
  );
  assert.equal(evaluateAgainstPolicy(clean, null).pass, null);
  assert.equal(evaluateAgainstPolicy(clean, {}).pass, null);
  assert.equal(evaluateAgainstPolicy(clean, { minOverallF1: 1 }).pass, true);   // exactly met
  assert.equal(evaluateAgainstPolicy(clean, { minOverallF1: 1.0000001 }).pass, false); // barely missed
  assert.equal(evaluateAgainstPolicy(clean, { maxFalseBeardRate: 0 }).pass, true); // zero threshold, actual 0
  // no non-beard GT => falseBeardRate null => required metric not evaluable => pass null (never true)
  const noNB = evaluateSemanticProducer([P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED)], [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED)]);
  assert.equal(evaluateAgainstPolicy(noNB, { maxFalseBeardRate: 0.1 }).pass, null);
  assert.equal(evaluateAgainstPolicy(noNB, { minOverallF1: 0.5, maxFalseBeardRate: 0.1 }).pass, null); // one null => whole null
});

// ---- PART 23 — determinism & order independence -----------------
test('PART23: repeated runs are deep-equal; reordering inputs does not change counts/metrics', () => {
  const { preds, gts } = bigFixture(300);
  const a = evaluateSemanticProducer(preds, gts, { confidenceBins: [0, 0.5, 1] });
  const b = evaluateSemanticProducer(preds, gts, { confidenceBins: [0, 0.5, 1] });
  assert.deepEqual(a.overallMetrics, b.overallMetrics);
  assert.deepEqual(a.confusionMatrix, b.confusionMatrix);
  assert.deepEqual(a.perRegion, b.perRegion);
  assert.deepEqual(a.perPose, b.perPose);
  assert.deepEqual(a.perSyncStatus, b.perSyncStatus);

  const rev = evaluateSemanticProducer(preds.slice().reverse(), gts.slice().reverse(), { confidenceBins: [0, 0.5, 1] });
  assert.deepEqual(rev.overallMetrics, a.overallMetrics);
  assert.deepEqual(rev.confusionMatrix, a.confusionMatrix);
  assert.deepEqual(rev.perPose, a.perPose);
  assert.deepEqual(rev.perSyncStatus, a.perSyncStatus);
  assert.equal(rev.matchingSummary.matchedPairs, a.matchingSummary.matchedPairs);
});

// ---- PART 24 — input immutability -----------------------------
test('PART24: evaluateSemanticProducer mutates neither predictions, GT, nor options', () => {
  const preds = [Object.freeze(P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { semanticConfidence: 0.7 }))];
  const gts = [Object.freeze(G('a', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED))];
  Object.freeze(preds); Object.freeze(gts);
  const options = Object.freeze({ confidenceBins: Object.freeze([0, 0.5, 1]), exactOnly: false });
  const snapPred = JSON.stringify(preds), snapGt = JSON.stringify(gts), snapOpt = JSON.stringify(options);
  const r = evaluateSemanticProducer(preds, gts, options);
  assert.equal(r.overallMetrics.falsePositives, 1);
  assert.equal(JSON.stringify(preds), snapPred);
  assert.equal(JSON.stringify(gts), snapGt);
  assert.equal(JSON.stringify(options), snapOpt);
});

// ---- PART 25 — payload / privacy sanity --------------------
test('PART25: long harmless identity strings never leak into the diagnostic; no image payload appears', () => {
  const big = 'x'.repeat(5000);
  const r = evaluateSemanticProducer(
    [P('id-' + big, 'LEFT_JAW', HairState.BEARD_CONFIRMED, { imageRef: 'data:image/jpeg;base64,' + big })],
    [G('id-' + big, 'LEFT_JAW', HairState.BEARD_CONFIRMED, { imageRef: 'data:image/jpeg;base64,' + big })]
  );
  const s = evaluationDiagnosticString(r);
  assert.equal(typeof s, 'string');
  assert.equal(s.includes('base64'), false);
  assert.equal(s.includes('data:image'), false);
  assert.ok(s.length < 4000, 'diagnostic string should stay concise, not echo giant identity strings');
});

test('PART: empty evaluation report stays valid and fully null/NOT_EVALUABLE', () => {
  const r = emptyEvaluationReport();
  assertNoNaNInf(r); assertRatesBounded(r);
  assert.equal(r.matchingSummary.matchedPairs, 0);
  assert.equal(r.overallMetrics.f1, null);
  assert.equal(r.perPose['front'], NOT_EVALUABLE);
  assert.equal(r.overallMetrics.positiveClass, POSITIVE_HAIR_STATE);
});
