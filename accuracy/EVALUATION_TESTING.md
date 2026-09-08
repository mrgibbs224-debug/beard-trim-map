# Semantic evaluation — metric definitions & edge-case contract (BS1-E / BS1-E1)

`accuracy/semantic-evaluation.mjs` scores a semantic **producer** (method
`SEMANTIC_SEGMENTATION`) against **manual ground truth** (method `MANUAL_GROUND_TRUTH`).
`accuracy/semantic-evaluation-stress.test.mjs` (BS1-E1) is the adversarial suite that pins
the behaviours below.

## Matching

- Identity key: `sourceScanObservationId + anatomicalRegion`. Optional strict verification of
  `imageRef`, `poseId`, `nativeFrameTimestampNs` (timestamp mismatch tolerated only within an
  explicit `timestampToleranceNs`). No array-index, nearest-image, or nearest-timestamp
  matching.
- A prediction with no GT → **not scored**, `matchingSummary.predictionsWithoutGroundTruth++`.
- A GT with no prediction → `matchingSummary.groundTruthWithoutPrediction++`; no producer
  prediction is fabricated.
- Two active GT rows for one key → every such prediction is `EXCLUDED_AMBIGUOUS_GT`; nothing
  is averaged and no first/last record is chosen. Any identity conflict → `EXCLUDED_IDENTITY_CONFLICT`.

## Positive class & the binary metrics

- Positive = `BEARD_CONFIRMED`; negative = `NON_BEARD_CONFIRMED`.
- `TP/FP/TN/FN`, `precision`, `recall`, `specificity`, `f1`, `accuracy` are computed **only
  over pairs where BOTH GT and prediction are definite** (`BEARD_CONFIRMED` /
  `NON_BEARD_CONFIRMED`). `binaryScorablePairs == TP + FP + TN + FN`.
- `BOUNDARY`, `UNCERTAIN`, `UNKNOWN` on either side are **never** folded into `TP/FP/TN/FN`.

## Danger-focused metrics (never hidden by accuracy)

- `falseBeardCount == FP` = GT `NON_BEARD_CONFIRMED`, prediction `BEARD_CONFIRMED`.
  `falseBeardRate = falseBeardCount / groundTruthNonBeardCount`.
- `falseNonBeardCount == FN` = GT `BEARD_CONFIRMED`, prediction `NON_BEARD_CONFIRMED`.
  `falseNonBeardRate = falseNonBeardCount / groundTruthBeardCount`.
- Under extreme class imbalance a high `accuracy` does **not** mask these — e.g. 99 non-beard
  GT + a producer that always says "beard" gives `accuracy 0.01`, `falseBeardRate 1`.

## Boundary metrics (separate)

- One-vs-rest over pairs whose GT is a real reference (`BEARD` / `NON_BEARD` / `BOUNDARY`):
  `boundary.truePositives / falsePositives / falseNegatives / precision / recall / f1`.
- A boundary mistake (`GT BOUNDARY → pred BEARD`, `GT BEARD → pred BOUNDARY`, …) stays in the
  boundary metrics and does **not** become a binary `falseBeard` / `falseNonBeard`.

## Abstention

- `predictionUnknownRate`, `predictionUncertainRate`, `predictionAbstainedOnDefiniteGtCount`.
- A producer predicting `UNKNOWN` (or `UNCERTAIN`) on a definite GT is an **abstention**, not a
  `false NON_BEARD`. Those predictions still appear in the confusion matrix.

## Zero-denominator behaviour

- Every rate/metric with a zero denominator returns **`null`** — never `NaN`, `Infinity`, or
  `-Infinity`. All-one-class datasets, empty datasets, and single-pose datasets all resolve to
  `null` / `NOT_EVALUABLE` rather than `0`.

## Stratification

- `perRegion` (keyed over `CORE_REGIONS ∪ observed`), `perPose` (`SCAN_POSES`), `perSyncStatus`
  (`EXACT_SYNCHRONIZED / NEAR_SYNCHRONIZED / UNPAIRED / UNKNOWN`). A stratum with no scorable
  pair is `NOT_EVALUABLE`, not `0 accuracy`.
- Sync is taken from the **prediction**, falling back to the **GT** when the prediction omits
  it; it is never upgraded. `exactOnly: true` restricts *matching* to `EXACT_SYNCHRONIZED`.
- Per-pose and per-sync `pairCount` totals reconcile to `matchedPairs` (for formal-pose /
  known-sync entries). Confusion-matrix cell total `== matchedPairs`.
- A pair whose `poseId` is not one of the six formal `SCAN_POSES` is a `transitionPairs`
  entry — it is still matched and scored overall, but never becomes a 7th pose bucket.

## Cross-pose consistency

- Diagnostic only, **not** GT accuracy. `crossPoseStableRegions` / `crossPoseUnstableRegions`
  / `crossPoseConflictCount` (a conflict is `BEARD` vs `NON_BEARD` across poses). `UNKNOWN` /
  `UNCERTAIN` across poses is "unstable" but is not counted as a binary conflict.

## Confidence calibration

- Caller-supplied `semanticConfidence` only; `null` is excluded from calibration-specific
  metrics. `meanConfidenceCorrect` / `meanConfidenceIncorrect` over the binary-scorable set.
- `confidenceBins` are **edges**: they must be a strictly-ascending array (length ≥ 2) of
  finite numbers in `[0,1]`. Bin `i` is `[bins[i], bins[i+1])`; the last bin is closed on the
  right. Every confident binary-scorable prediction belongs to exactly one bin (edge values
  `0`, `0.5`, `1` included). **BS1-E1 fix:** an invalid `bins` argument (unsorted, duplicated
  edge, out of `[0,1]`, too short, `NaN`, `Infinity`) is **rejected cleanly** — `bins: null`
  plus a `binsRejectedReason` string — rather than silently producing a double-counting or
  gapped calibration. A *missing* `bins` is not an error (`bins: null`, no reason).

## Comparison & policy

- `compareEvaluationReports(baseline, candidate)` → raw metric/per-region/per-pose deltas;
  `verdict` is `null` unless the caller supplies a `policy`. `verdictFrom` orients each metric
  (higher-is-better vs lower-is-better) and reports `IMPROVED / REGRESSED / MIXED / UNCHANGED /
  INSUFFICIENT_DATA`.
- `evaluateAgainstPolicy(report, policy)` gates only caller-supplied thresholds
  (`minOverallF1`, `minBeardRecall`, `maxFalseBeardRate`, `minBoundaryRecall`,
  `minScorableCoverage`). A required metric that is `null` (not evaluable) makes that check —
  and the overall `pass` — `null`; there is **no false `PASS`**. No Mettle production
  thresholds are baked in anywhere.

## Determinism & immutability

- The report is deterministic: repeated runs deep-equal, and reordering the input arrays does
  not change any count or metric.
- `evaluateSemanticProducer` mutates neither the prediction entries, the GT entries, nor the
  options/policy objects.

## Privacy

- The evaluator reads only `hairState` + identity/provenance fields. `evaluationDiagnosticString`
  never echoes giant identity strings and never contains `base64` / `data:image` / any image
  payload.
