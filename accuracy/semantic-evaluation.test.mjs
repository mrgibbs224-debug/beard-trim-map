// Stage BS1-E — pure unit tests for the semantic producer evaluation harness.
// Node built-in runner (node --test). Zero dependencies. Synthetic fixtures only.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HairState, ObservationMethod } from './beard-surface-core.mjs';
import { SyncStatus } from './multi-observation-scan-package.mjs';
import {
  SEMANTIC_EVALUATION_VERSION, POSITIVE_HAIR_STATE, NOT_EVALUABLE, ComparisonVerdict,
  evaluateSemanticProducer, emptyEvaluationReport, broadcastGroundTruth,
  compareEvaluationReports, evaluateAgainstPolicy, evaluationDiagnosticString
} from './semantic-evaluation.mjs';

const P = (obsId, region, state, extra = {}) => ({
  sourceScanObservationId: obsId, anatomicalRegion: region, hairState: state,
  sourceMethod: ObservationMethod.SEMANTIC_SEGMENTATION, poseId: 'front', syncStatus: SyncStatus.EXACT_SYNCHRONIZED, ...extra
});
const G = (obsId, region, state, extra = {}) => ({
  sourceScanObservationId: obsId, anatomicalRegion: region, hairState: state,
  sourceMethod: ObservationMethod.MANUAL_GROUND_TRUTH, poseId: 'front', syncStatus: SyncStatus.EXACT_SYNCHRONIZED, ...extra
});

// 1 — Exact prediction/GT identity matches.
test('exact sourceScanObservationId + region identity matches', () => {
  const r = evaluateSemanticProducer([P('o1', 'LEFT_JAW', HairState.BEARD_CONFIRMED)], [G('o1', 'LEFT_JAW', HairState.BEARD_CONFIRMED)]);
  assert.equal(r.matchingSummary.matchedPairs, 1);
  assert.equal(r.overallMetrics.truePositives, 1);
});

// 2 — Unknown observation reference stays unmatched.
test('a prediction with no GT is unmatched, not scored', () => {
  const r = evaluateSemanticProducer([P('oX', 'LEFT_JAW', HairState.BEARD_CONFIRMED)], [G('o1', 'LEFT_JAW', HairState.BEARD_CONFIRMED)]);
  assert.equal(r.matchingSummary.matchedPairs, 0);
  assert.equal(r.matchingSummary.predictionsWithoutGroundTruth, 1);
  assert.equal(r.overallMetrics.truePositives, 0);
});

// 3 — Conflicting identity metadata fails closed.
test('conflicting imageRef / poseId / timestamp is excluded', () => {
  const r = evaluateSemanticProducer(
    [P('o1', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { imageRef: 'kf-A' })],
    [G('o1', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { imageRef: 'kf-B' })]
  );
  assert.equal(r.matchingSummary.matchedPairs, 0);
  assert.equal(r.excluded[0].outcome, 'EXCLUDED_IDENTITY_CONFLICT');
  assert.equal(r.excluded[0].detail, 'imageRef');
});

// 4 — Missing GT excluded from scoring.
test('predictions with no GT do not enter any metric', () => {
  const r = evaluateSemanticProducer([P('a', 'CHIN_CENTER', HairState.NON_BEARD_CONFIRMED)], []);
  assert.equal(r.overallMetrics.pairCount, 0);
  assert.equal(r.overallMetrics.accuracy, null);
});

// 5 — UNKNOWN GT is not converted to NON_BEARD.
test('UNKNOWN ground truth is excluded from binary scoring, not treated as NON_BEARD', () => {
  const r = evaluateSemanticProducer(
    [P('o1', 'LEFT_JAW', HairState.BEARD_CONFIRMED)],
    [G('o1', 'LEFT_JAW', HairState.UNKNOWN)]
  );
  assert.equal(r.matchingSummary.matchedPairs, 1);
  assert.equal(r.overallMetrics.binaryScorablePairs, 0);
  assert.equal(r.overallMetrics.falsePositives, 0);       // not a false beard
  assert.equal(r.matchingSummary.groundTruthUnknownExcludedFromBinary, 1);
  assert.equal(r.confusionMatrix[HairState.UNKNOWN][HairState.BEARD_CONFIRMED], 1); // still in matrix
});

// 6 — Perfect BEARD prediction gives precision/recall/F1 = 1.
test('perfect beard prediction → precision = recall = F1 = 1', () => {
  const preds = [P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), P('b', 'RIGHT_JAW', HairState.BEARD_CONFIRMED)];
  const gts = [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), G('b', 'RIGHT_JAW', HairState.BEARD_CONFIRMED)];
  const r = evaluateSemanticProducer(preds, gts);
  assert.equal(r.overallMetrics.precision, 1);
  assert.equal(r.overallMetrics.recall, 1);
  assert.equal(r.overallMetrics.f1, 1);
});

// 7 — False beard increments falseBeard.
test('GT NON_BEARD + pred BEARD → falseBeardCount', () => {
  const r = evaluateSemanticProducer([P('a', 'NECK_FRONT', HairState.BEARD_CONFIRMED)], [G('a', 'NECK_FRONT', HairState.NON_BEARD_CONFIRMED)]);
  assert.equal(r.overallMetrics.falseBeardCount, 1);
  assert.equal(r.overallMetrics.falsePositives, 1);
  assert.equal(r.overallMetrics.falseBeardRate, 1); // 1 / 1 GT non-beard
});

// 8 — False non-beard increments falseNonBeard.
test('GT BEARD + pred NON_BEARD → falseNonBeardCount', () => {
  const r = evaluateSemanticProducer([P('a', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED)], [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED)]);
  assert.equal(r.overallMetrics.falseNonBeardCount, 1);
  assert.equal(r.overallMetrics.falseNegatives, 1);
});

// 9 — Zero-denominator metric returns null / not-evaluable.
test('zero-denominator metrics return null, never NaN/Infinity', () => {
  const r = evaluateSemanticProducer([P('a', 'LEFT_JAW', HairState.UNKNOWN)], [G('a', 'LEFT_JAW', HairState.UNKNOWN)]);
  for (const v of [r.overallMetrics.precision, r.overallMetrics.recall, r.overallMetrics.f1, r.overallMetrics.accuracy, r.overallMetrics.specificity]) {
    assert.ok(v === null || (Number.isFinite(v)));
    assert.notEqual(v, Infinity);
  }
});

// 10 — BOUNDARY precision/recall/F1 computed separately.
test('BOUNDARY is scored one-vs-rest, separate from beard metrics', () => {
  const preds = [P('a', 'CHIN_CENTER', HairState.BOUNDARY), P('b', 'LEFT_JAW', HairState.BOUNDARY), P('c', 'RIGHT_JAW', HairState.BEARD_CONFIRMED)];
  const gts = [G('a', 'CHIN_CENTER', HairState.BOUNDARY), G('b', 'LEFT_JAW', HairState.BEARD_CONFIRMED), G('c', 'RIGHT_JAW', HairState.BOUNDARY)];
  const r = evaluateSemanticProducer(preds, gts);
  assert.equal(r.overallMetrics.boundary.truePositives, 1);
  assert.equal(r.overallMetrics.boundary.falsePositives, 1);
  assert.equal(r.overallMetrics.boundary.falseNegatives, 1);
  assert.equal(r.overallMetrics.boundary.precision, 0.5);
  assert.equal(r.overallMetrics.boundary.recall, 0.5);
});

// 11 — UNKNOWN prediction is abstention, not false NON_BEARD.
test('UNKNOWN prediction on a BEARD GT is abstention, not a false non-beard', () => {
  const r = evaluateSemanticProducer([P('a', 'LEFT_JAW', HairState.UNKNOWN)], [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED)]);
  assert.equal(r.overallMetrics.falseNegatives, 0);
  assert.equal(r.overallMetrics.predictionAbstainedOnDefiniteGtCount, 1);
  assert.equal(r.overallMetrics.predictionUnknownRate, 1);
});

// 12 — UNCERTAIN prediction tracked separately.
test('UNCERTAIN prediction is tracked separately from UNKNOWN', () => {
  const r = evaluateSemanticProducer([P('a', 'LEFT_JAW', HairState.UNCERTAIN)], [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED)]);
  assert.equal(r.overallMetrics.predictionUncertainRate, 1);
  assert.equal(r.overallMetrics.predictionUnknownRate, 0);
  assert.equal(r.overallMetrics.falseNegatives, 0);
});

// 13 — Per-region counts deterministic.
test('per-region metrics are deterministic', () => {
  const preds = [P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), P('b', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED)];
  const gts = [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), G('b', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED)];
  const a = evaluateSemanticProducer(preds, gts).perRegion.LEFT_JAW;
  const b = evaluateSemanticProducer(preds, gts).perRegion.LEFT_JAW;
  assert.deepEqual(a, b);
  assert.equal(a.truePositives, 1);
  assert.equal(a.trueNegatives, 1);
});

// 14 — Per-pose counts deterministic.
test('per-pose metrics are deterministic and keyed by formal pose', () => {
  const preds = [P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'right-45' })];
  const gts = [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'right-45' })];
  const r = evaluateSemanticProducer(preds, gts);
  assert.notEqual(r.perPose['right-45'], NOT_EVALUABLE);
  assert.equal(r.perPose['right-45'].truePositives, 1);
  assert.equal(r.perPose['front'], NOT_EVALUABLE);
});

// 15 — EXACT-only mode excludes weaker sync.
test('exactOnly mode excludes non-EXACT evidence', () => {
  const r = evaluateSemanticProducer(
    [P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { syncStatus: SyncStatus.NEAR_SYNCHRONIZED })],
    [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { syncStatus: SyncStatus.NEAR_SYNCHRONIZED })],
    { exactOnly: true }
  );
  assert.equal(r.matchingSummary.matchedPairs, 0);
  assert.equal(r.excluded[0].outcome, 'EXCLUDED_SYNC_BELOW_EXACT');
});

// 16 — Weak sync is never relabelled EXACT.
test('per-sync stratification keeps weak sync in its own bucket', () => {
  const r = evaluateSemanticProducer(
    [P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { syncStatus: SyncStatus.UNPAIRED })],
    [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { syncStatus: SyncStatus.UNPAIRED })]
  );
  assert.notEqual(r.perSyncStatus[SyncStatus.UNPAIRED], NOT_EVALUABLE);
  assert.equal(r.perSyncStatus[SyncStatus.EXACT_SYNCHRONIZED], NOT_EVALUABLE);
});

// 17 & 18 — Eight observations stay eight evaluations; one pose-region aggregate.
test('eight observations for one pose-region → 8 observation rows + 1 aggregate', () => {
  const preds = [], gts = [];
  for (let i = 0; i < 8; i++) {
    preds.push(P(`o${i}`, 'RIGHT_JAW', i === 0 ? HairState.NON_BEARD_CONFIRMED : HairState.BEARD_CONFIRMED));
    gts.push(G(`o${i}`, 'RIGHT_JAW', HairState.BEARD_CONFIRMED));
  }
  const r = evaluateSemanticProducer(preds, gts);
  assert.equal(r.observationLevelCount, 8);
  const agg = r.poseRegionAggregate.filter(a => a.region === 'RIGHT_JAW' && a.pose === 'front');
  assert.equal(agg.length, 1);
  assert.equal(agg[0].observationCount, 8);
  assert.equal(agg[0].aggregatePredictedState, HairState.BEARD_CONFIRMED); // 7 of 8
  assert.equal(agg[0].aggregateCorrect, true);
});

// 19 & 20 — Cross-pose consistency detects agreement and conflict.
test('cross-pose consistency detects agreement', () => {
  const preds = [
    P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'front' }),
    P('b', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'right-45' })
  ];
  const gts = [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'front' }), G('b', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'right-45' })];
  const r = evaluateSemanticProducer(preds, gts);
  assert.deepEqual(r.crossPoseConsistency.crossPoseStableRegions, ['LEFT_JAW']);
  assert.equal(r.crossPoseConsistency.crossPoseAgreementRate, 1);
});
test('cross-pose consistency detects conflict', () => {
  const preds = [
    P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'front' }),
    P('b', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED, { poseId: 'right-45' })
  ];
  const gts = [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'front' }), G('b', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { poseId: 'right-45' })];
  const r = evaluateSemanticProducer(preds, gts);
  assert.deepEqual(r.crossPoseConsistency.crossPoseUnstableRegions, ['LEFT_JAW']);
  assert.equal(r.crossPoseConsistency.crossPoseConflictCount, 1);
});

// 21 — Confidence null excluded from calibration.
test('null confidence is excluded from calibration', () => {
  const r = evaluateSemanticProducer(
    [P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED)], // no semanticConfidence
    [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED)]
  );
  assert.equal(r.confidenceCalibration.predictionsWithConfidence, 0);
  assert.equal(r.confidenceCalibration.predictionsWithoutConfidence, 1);
  assert.equal(r.confidenceCalibration.meanConfidenceCorrect, null);
});

// 22 & 23 — Confidence bins deterministic; correct/incorrect means.
test('confidence bins and correct/incorrect means are computed', () => {
  const preds = [
    P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { semanticConfidence: 0.9 }),  // correct
    P('b', 'RIGHT_JAW', HairState.BEARD_CONFIRMED, { semanticConfidence: 0.6 })  // incorrect
  ];
  const gts = [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), G('b', 'RIGHT_JAW', HairState.NON_BEARD_CONFIRMED)];
  const r = evaluateSemanticProducer(preds, gts, { confidenceBins: [0, 0.5, 1] });
  assert.equal(r.confidenceCalibration.meanConfidenceCorrect, 0.9);
  assert.equal(r.confidenceCalibration.meanConfidenceIncorrect, 0.6);
  assert.equal(r.confidenceCalibration.bins.length, 2);
  assert.equal(r.confidenceCalibration.bins[1].count, 2); // both ≥ 0.5
  assert.equal(r.confidenceCalibration.bins[1].accuracy, 0.5);
});

// 24 & 25 — Compare returns raw deltas; no policy → no winner.
test('compareEvaluationReports returns raw deltas and no verdict without a policy', () => {
  // baseline: one false beard + one true beard → precision 0.5, recall 1, F1 ~0.667
  const base = evaluateSemanticProducer(
    [P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), P('b', 'RIGHT_JAW', HairState.BEARD_CONFIRMED)],
    [G('a', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED), G('b', 'RIGHT_JAW', HairState.BEARD_CONFIRMED)]
  );
  // candidate: both correct → F1 1
  const cand = evaluateSemanticProducer(
    [P('a', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED), P('b', 'RIGHT_JAW', HairState.BEARD_CONFIRMED)],
    [G('a', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED), G('b', 'RIGHT_JAW', HairState.BEARD_CONFIRMED)]
  );
  const cmp = compareEvaluationReports(base, cand);
  assert.equal(cmp.verdict, null);
  assert.equal(cmp.policyApplied, false);
  assert.equal(typeof cmp.deltas.overallF1, 'number');
  assert.ok(cmp.deltas.overallF1 > 0 && cmp.deltas.overallF1 <= 1);
});

// 26 — Caller policy can detect regression.
test('a caller-supplied comparison policy can report REGRESSED / IMPROVED', () => {
  const good = evaluateSemanticProducer([P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED)], [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED)]);
  const bad = evaluateSemanticProducer([P('a', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED)], [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED)]);
  const regressed = compareEvaluationReports(good, bad, { policy: { maxRegress: 0.05, metrics: ['beardRecall'] } });
  assert.equal(regressed.verdict, ComparisonVerdict.REGRESSED);
  const improved = compareEvaluationReports(bad, good, { policy: { minImprove: 0.1, metrics: ['beardRecall'] } });
  assert.equal(improved.verdict, ComparisonVerdict.IMPROVED);
});

// 27 — Unsupported / no-GT region reports NOT_EVALUABLE.
test('a region with no scorable GT reports NOT_EVALUABLE, not zero accuracy', () => {
  const r = evaluateSemanticProducer([P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED)], [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED)]);
  assert.equal(r.perRegion.UNDER_JAW_CENTER, NOT_EVALUABLE);
  assert.equal(r.perRegion.NECK_FRONT, NOT_EVALUABLE);
});

// 28 — Empty evaluation report is valid.
test('empty evaluation report is valid', () => {
  const r = emptyEvaluationReport({ producerMetadata: { producerId: 'none' } });
  assert.equal(r.schemaVersion, SEMANTIC_EVALUATION_VERSION);
  assert.equal(r.matchingSummary.matchedPairs, 0);
  assert.equal(r.overallMetrics.f1, null);
  assert.equal(r.perRegion.LEFT_JAW, NOT_EVALUABLE);
});

// 29 — Diagnostic output contains no raw image payload.
test('diagnostic string is text with no image payload', () => {
  const r = evaluateSemanticProducer(
    [P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { imageRef: 'data:image/jpeg;base64,PIXELS' })],
    [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED, { imageRef: 'data:image/jpeg;base64,PIXELS' })]
  );
  const s = evaluationDiagnosticString(r);
  assert.equal(typeof s, 'string');
  assert.equal(s.includes('PIXELS'), false);
  assert.equal(s.includes('base64'), false);
  assert.match(s, /Mettle Semantic Evaluation/);
});

// 30 & 31 — MANUAL_GROUND_TRUTH accepted as GT; SEMANTIC_SEGMENTATION as producer.
test('MANUAL_GROUND_TRUTH is the reference; SEMANTIC_SEGMENTATION is the producer', () => {
  const r = evaluateSemanticProducer(
    [{ sourceScanObservationId: 'a', anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED, sourceMethod: ObservationMethod.SEMANTIC_SEGMENTATION }],
    [{ sourceScanObservationId: 'a', anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED, sourceMethod: ObservationMethod.MANUAL_GROUND_TRUTH }]
  );
  assert.equal(r.groundTruthMetadata.referenceMethod, ObservationMethod.MANUAL_GROUND_TRUTH);
  assert.equal(r.overallMetrics.truePositives, 1);
  assert.equal(r.overallMetrics.positiveClass, POSITIVE_HAIR_STATE);
});

// --- supporting ---
test('evaluateAgainstPolicy: no policy → no pass/fail', () => {
  // one beard + one non-beard, both correct → f1 1, falseBeardRate 0 (both defined)
  const r = evaluateSemanticProducer(
    [P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), P('b', 'NECK_FRONT', HairState.NON_BEARD_CONFIRMED)],
    [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED), G('b', 'NECK_FRONT', HairState.NON_BEARD_CONFIRMED)]
  );
  assert.equal(evaluateAgainstPolicy(r, null).pass, null);
  const gate = evaluateAgainstPolicy(r, { minOverallF1: 0.8, maxFalseBeardRate: 0.1 });
  assert.equal(gate.pass, true);
  const strict = evaluateAgainstPolicy(r, { minBeardRecall: 0.5, minOverallF1: 2 });
  assert.equal(strict.pass, false);
  // a metric that is genuinely not evaluable yields pass:null, never a false pass
  const rNoNonBeard = evaluateSemanticProducer([P('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED)], [G('a', 'LEFT_JAW', HairState.BEARD_CONFIRMED)]);
  assert.equal(evaluateAgainstPolicy(rNoNonBeard, { maxFalseBeardRate: 0.1 }).pass, null);
});

test('broadcastGroundTruth expands pose-region GT to observation keys only on explicit opt-in', () => {
  const preds = [P('o1', 'LEFT_JAW', HairState.BEARD_CONFIRMED), P('o2', 'LEFT_JAW', HairState.BEARD_CONFIRMED)];
  const gt = broadcastGroundTruth([{ poseId: 'front', anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }], preds);
  assert.equal(gt.length, 2);
  assert.deepEqual(gt.map(g => g.sourceScanObservationId).sort(), ['o1', 'o2']);
  const r = evaluateSemanticProducer(preds, gt);
  assert.equal(r.overallMetrics.recall, 1);
});

test('ambiguous GT (two GT rows for one key) is excluded', () => {
  const r = evaluateSemanticProducer(
    [P('o1', 'LEFT_JAW', HairState.BEARD_CONFIRMED)],
    [G('o1', 'LEFT_JAW', HairState.BEARD_CONFIRMED), G('o1', 'LEFT_JAW', HairState.NON_BEARD_CONFIRMED)]
  );
  assert.equal(r.matchingSummary.matchedPairs, 0);
  assert.equal(r.excluded[0].outcome, 'EXCLUDED_AMBIGUOUS_GT');
});

test('confusion matrix keeps all five HairState rows and columns', () => {
  const r = evaluateSemanticProducer([P('a', 'LEFT_JAW', HairState.UNCERTAIN)], [G('a', 'LEFT_JAW', HairState.BOUNDARY)]);
  assert.equal(Object.keys(r.confusionMatrix).length, 5);
  assert.equal(r.confusionMatrix[HairState.BOUNDARY][HairState.UNCERTAIN], 1);
  assert.ok(HairState.UNKNOWN in r.confusionMatrix);
});
