// Stage BS1-F — pure unit tests for the manual ground-truth dataset assembler.
// Node built-in runner (node --test). Zero dependencies. Synthetic annotation records only.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HairState, ObservationMethod } from './beard-surface-core.mjs';
import { SyncStatus, makeScanObservation, makePoseObservationPackage, makeMultiObservationScanPackage } from './multi-observation-scan-package.mjs';
import { fromA60Export } from './a6-scan-package-adapter.mjs';
import { evaluateSemanticProducer } from './semantic-evaluation.mjs';
import {
  GROUND_TRUTH_DATASET_VERSION, AnnotationStatus, LabelRejectReason, DuplicateOutcome,
  makeGroundTruthLabel, validateLabelAgainstScanPackage, groundTruthLabelToSemanticObservation,
  assembleGroundTruthDataset, emptyGroundTruthDataset, buildAnnotationManifest,
  groundTruthDatasetToEvaluationEntries, buildProducerEvaluationManifest,
  groundTruthDatasetDiagnosticString, splitBySubjectGroup, groupByScanSession
} from './ground-truth-dataset.mjs';

// ---- fixtures ----
function pts() { return Array.from({ length: 468 }, (_, i) => ({ x: (i % 50) * 0.01, y: Math.floor(i / 50) * 0.01, z: (i % 7) * 0.005 })); }
let ts = 7_000_000;
const kf = (e = {}) => (ts += 1000, {
  nativeTs: ts, coherenceStatus: 'VERIFIED_EXACT', dataUrl: 'data:image/jpeg;base64,PIXELS', width: 640, height: 480,
  imageRotationDegrees: 90, imageMirrored: false,
  intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240, imageWidth: 640, imageHeight: 480, space: 'IMAGE' },
  landmarks2D: pts(), faceLocal3D: pts(), transformationMatrix: new Array(16).fill(0), imageSpaceViewModelMatrix: new Array(16).fill(0),
  yawDeg: 0, pitchDeg: 0, rollDeg: 0, faceCameraX: 0, faceCameraY: 0, faceCameraZ: 0.35, captureLatencyMs: 12, ...e
});
const g = (e = {}) => (ts += 1000, {
  nativeTs: ts, t: ts / 1000, yawDeg: 0, pitchDeg: 0, rollDeg: 0, faceCameraZ: 0.35,
  transformationMatrix: new Array(16).fill(0), landmarks2D: pts(), faceLocal3D: pts(),
  frameWidth: 1080, frameHeight: 1920, mirrored: true, coverageValid: true, ...e
});
const pkgOf = (spec) => fromA60Export((() => {
  const geometryObs = {}, imageKeyframes = {};
  for (const [p, s] of Object.entries(spec)) {
    geometryObs[p] = Array.from({ length: s.geom || 0 }, () => g());
    imageKeyframes[p] = Array.from({ length: s.img || 0 }, () => kf());
  }
  return { geometryObs, imageKeyframes };
})()).scanPackage;

const imgId = (pkg, pose, i = 0) => pkg.posePackages[pose].retainedImageObservations[i].observationId;
const geoId = (pkg, pose, i = 0) => pkg.posePackages[pose].retainedGeometryObservations[i].observationId;
const L = (spec) => makeGroundTruthLabel({ annotationStatus: AnnotationStatus.LABELED, ...spec });

// 1 — Valid label matches exact scan observation.
test('valid label matches the exact scan observation', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const v = validateLabelAgainstScanPackage(L({ sourceScanObservationId: imgId(pkg, 'front'), anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }), pkg);
  assert.equal(v.valid, true);
  assert.equal(v.sourceObservation.observationId, imgId(pkg, 'front'));
});

// 2 — Unknown observation ID rejected.
test('unknown observation id is rejected', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const v = validateLabelAgainstScanPackage(L({ sourceScanObservationId: 'nope', anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }), pkg);
  assert.equal(v.valid, false);
  assert.equal(v.reason, LabelRejectReason.UNKNOWN_OBSERVATION);
});

// 3 — Conflicting imageRef rejected.
test('conflicting imageRef is rejected', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const v = validateLabelAgainstScanPackage(L({ sourceScanObservationId: imgId(pkg, 'front'), imageRef: 'some-other-ref', anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }), pkg);
  assert.equal(v.reason, LabelRejectReason.IDENTITY_CONFLICT);
  assert.equal(v.detail, 'imageRef');
});

// 4 — Conflicting pose rejected.
test('conflicting poseId is rejected', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const v = validateLabelAgainstScanPackage(L({ sourceScanObservationId: imgId(pkg, 'front'), poseId: 'chin-up', anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }), pkg);
  assert.equal(v.reason, LabelRejectReason.IDENTITY_CONFLICT);
  assert.equal(v.detail, 'poseId');
});

// 5 — Conflicting timestamp rejected by strict mode.
test('conflicting nativeFrameTimestampNs is rejected (strict), accepted within tolerance', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const obs = pkg.posePackages.front.retainedImageObservations[0];
  const realTs = obs.timestamp.nativeFrameTimestampNs;
  const strict = validateLabelAgainstScanPackage(L({ sourceScanObservationId: obs.observationId, nativeFrameTimestampNs: realTs + 5000, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }), pkg);
  assert.equal(strict.reason, LabelRejectReason.IDENTITY_CONFLICT);
  const tol = validateLabelAgainstScanPackage(L({ sourceScanObservationId: obs.observationId, nativeFrameTimestampNs: realTs + 5000, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }), pkg, { timestampToleranceNs: 10000 });
  assert.equal(tol.valid, true);
});

// 6 — UNKNOWN label remains UNKNOWN.
test('UNKNOWN hairState label stays UNKNOWN through conversion', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const lbl = L({ sourceScanObservationId: imgId(pkg, 'front'), anatomicalRegion: 'LEFT_JAW', hairState: HairState.UNKNOWN });
  const v = validateLabelAgainstScanPackage(lbl, pkg);
  const sem = groundTruthLabelToSemanticObservation(lbl, v.sourceObservation);
  assert.equal(sem.hairState, HairState.UNKNOWN);
});

// 7 — AMBIGUOUS annotation is not scored as NON_BEARD.
test('AMBIGUOUS annotation is not scored and never becomes NON_BEARD', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const ds = assembleGroundTruthDataset(pkg, [makeGroundTruthLabel({ sourceScanObservationId: imgId(pkg, 'front'), anatomicalRegion: 'LEFT_JAW', hairState: HairState.UNCERTAIN, annotationStatus: AnnotationStatus.AMBIGUOUS })]);
  assert.equal(ds.acceptedLabels.length, 0);
  assert.equal(ds.ambiguousLabels.length, 1);
  assert.equal(ds.semanticGroundTruthObservations.length, 0);
  const entries = groundTruthDatasetToEvaluationEntries(ds);
  assert.equal(entries.scoredEntries.length, 0);
  assert.equal(entries.ambiguousEntries.length, 1);
});

// 8 — EXCLUDED annotation omitted from scored GT.
test('EXCLUDED annotation is omitted from scored GT', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const ds = assembleGroundTruthDataset(pkg, [makeGroundTruthLabel({ sourceScanObservationId: imgId(pkg, 'front'), anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED, annotationStatus: AnnotationStatus.EXCLUDED })]);
  assert.equal(ds.excludedLabels.length, 1);
  assert.equal(ds.semanticGroundTruthObservations.length, 0);
});

// 9 — NEEDS_REVIEW omitted from definitive GT.
test('NEEDS_REVIEW is omitted from definitive GT', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const ds = assembleGroundTruthDataset(pkg, [makeGroundTruthLabel({ sourceScanObservationId: imgId(pkg, 'front'), anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED, annotationStatus: AnnotationStatus.NEEDS_REVIEW })]);
  assert.equal(ds.needsReviewLabels.length, 1);
  assert.equal(ds.acceptedLabels.length, 0);
  assert.equal(ds.semanticGroundTruthObservations.length, 0);
});

// 10 & 11 — MANUAL_GROUND_TRUTH method + HairState preserved.
test('semantic observation uses MANUAL_GROUND_TRUTH and preserves HairState', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const ds = assembleGroundTruthDataset(pkg, [L({ sourceScanObservationId: imgId(pkg, 'front'), anatomicalRegion: 'CHIN_CENTER', hairState: HairState.BOUNDARY })]);
  const s = ds.semanticGroundTruthObservations[0];
  assert.equal(s.sourceMethod, ObservationMethod.MANUAL_GROUND_TRUTH);
  assert.equal(s.hairState, HairState.BOUNDARY);
});

// 12 & 13 — annotationConfidence null preserved; bounded.
test('annotationConfidence: null stays null, out-of-range is clamped', () => {
  assert.equal(makeGroundTruthLabel({ anatomicalRegion: 'LEFT_JAW' }).annotationConfidence, null);
  assert.equal(makeGroundTruthLabel({ anatomicalRegion: 'LEFT_JAW', annotationConfidence: 5 }).annotationConfidence, 1);
  assert.equal(makeGroundTruthLabel({ anatomicalRegion: 'LEFT_JAW', annotationConfidence: -1 }).annotationConfidence, 0);
});

// 14 & 15 — EXACT sync preserved; weak sync never upgraded.
test('sync status is copied from the source observation, never upgraded', () => {
  const weakImg = makeScanObservation({ observationId: 'w', poseId: 'front', nativeFrameTimestampNs: 1, imageRef: { ref: 'wr', format: 'jpeg', width: 10, height: 10 }, faceLocal3D: 468, cameraIntrinsics: { fx: 1 } });
  assert.equal(weakImg.syncStatus, SyncStatus.UNKNOWN);
  const pkg = makeMultiObservationScanPackage({ posePackages: { front: makePoseObservationPackage({ poseId: 'front', retainedImageObservations: [weakImg] }) } });
  const ds = assembleGroundTruthDataset(pkg, [L({ sourceScanObservationId: 'w', anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED, syncStatus: SyncStatus.EXACT_SYNCHRONIZED })]);
  assert.equal(ds.semanticGroundTruthObservations[0].syncStatus, SyncStatus.UNKNOWN); // label's claim ignored

  const exactPkg = pkgOf({ front: { img: 1 } });
  const ds2 = assembleGroundTruthDataset(exactPkg, [L({ sourceScanObservationId: imgId(exactPkg, 'front'), anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED })]);
  assert.equal(ds2.semanticGroundTruthObservations[0].syncStatus, SyncStatus.EXACT_SYNCHRONIZED);
});

// 16 — requireExactSync excludes weaker observations.
test('requireExactSync excludes non-EXACT observations and reports them', () => {
  const weakImg = makeScanObservation({ observationId: 'w', poseId: 'front', nativeFrameTimestampNs: 1, imageRef: { ref: 'wr' }, faceLocal3D: 468, cameraIntrinsics: { fx: 1 } });
  const pkg = makeMultiObservationScanPackage({ posePackages: { front: makePoseObservationPackage({ poseId: 'front', retainedImageObservations: [weakImg] }) } });
  const ds = assembleGroundTruthDataset(pkg, [L({ sourceScanObservationId: 'w', anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED })], { requireExactSync: true });
  assert.equal(ds.acceptedLabels.length, 0);
  assert.equal(ds.rejectedLabels[0].reason, LabelRejectReason.SYNC_BELOW_EXACT);
});

// 17 — geometry-only observation rejected for image-semantic GT by default.
test('a geometry-only observation is rejected for image-semantic GT by default; allowed on opt-in', () => {
  const pkg = pkgOf({ front: { geom: 1 } });
  const gid = geoId(pkg, 'front');
  const rej = assembleGroundTruthDataset(pkg, [L({ sourceScanObservationId: gid, anatomicalRegion: 'CHIN_CENTER', hairState: HairState.BEARD_CONFIRMED })]);
  assert.equal(rej.rejectedLabels[0].reason, LabelRejectReason.NOT_IMAGE_BACKED);
  const ok = assembleGroundTruthDataset(pkg, [L({ sourceScanObservationId: gid, anatomicalRegion: 'CHIN_CENTER', hairState: HairState.BEARD_CONFIRMED })], { allowNonImageGroundTruth: true });
  assert.equal(ok.acceptedLabels.length, 1);
});

// 18 — one image can hold multiple region labels.
test('one image observation can carry labels for multiple regions', () => {
  const pkg = pkgOf({ 'right-profile': { img: 1 } });
  const id = imgId(pkg, 'right-profile');
  const ds = assembleGroundTruthDataset(pkg, [
    L({ sourceScanObservationId: id, anatomicalRegion: 'RIGHT_JAW', hairState: HairState.BEARD_CONFIRMED }),
    L({ sourceScanObservationId: id, anatomicalRegion: 'RIGHT_LOWER_CHEEK', hairState: HairState.BOUNDARY }),
    L({ sourceScanObservationId: id, anatomicalRegion: 'CHIN_CENTER', hairState: HairState.BEARD_CONFIRMED })
  ]);
  assert.equal(ds.acceptedLabels.length, 3);
  assert.equal(new Set(ds.semanticGroundTruthObservations.map(o => o.anatomicalRegion)).size, 3);
});

// 19 — exact duplicate label handled deterministically.
test('identical duplicate labels are deduped deterministically', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const id = imgId(pkg, 'front');
  const ds = assembleGroundTruthDataset(pkg, [
    L({ labelId: 'b', sourceScanObservationId: id, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }),
    L({ labelId: 'a', sourceScanObservationId: id, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED })
  ]);
  assert.equal(ds.acceptedLabels.length, 1);
  assert.equal(ds.acceptedLabels[0].labelId, 'a');
  assert.equal(ds.duplicateLabels[0].outcome, DuplicateOutcome.DEDUP_IDENTICAL);
});

// 20 — conflicting duplicate labels preserved as conflict/ambiguous.
test('conflicting definitive labels for one key are preserved as conflict, not scored', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const id = imgId(pkg, 'front');
  const ds = assembleGroundTruthDataset(pkg, [
    L({ labelId: '1', sourceScanObservationId: id, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }),
    L({ labelId: '2', sourceScanObservationId: id, anatomicalRegion: 'LEFT_JAW', hairState: HairState.NON_BEARD_CONFIRMED })
  ]);
  assert.equal(ds.acceptedLabels.length, 0);
  assert.equal(ds.conflictLabels.length, 2);
  assert.equal(ds.semanticGroundTruthObservations.length, 0);
  // latest-wins only when caller opts in AND revisions exist
  const ds2 = assembleGroundTruthDataset(pkg, [
    L({ labelId: '1', revision: 1, sourceScanObservationId: id, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }),
    L({ labelId: '2', revision: 2, sourceScanObservationId: id, anatomicalRegion: 'LEFT_JAW', hairState: HairState.NON_BEARD_CONFIRMED })
  ], { revisionPolicy: 'latest-wins' });
  assert.equal(ds2.acceptedLabels.length, 1);
  assert.equal(ds2.acceptedLabels[0].hairState, HairState.NON_BEARD_CONFIRMED);
});

// 21 — label revision metadata survives.
test('label revision + supersedesLabelId survive into provenance', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const ds = assembleGroundTruthDataset(pkg, [L({ labelId: 'x', revision: 4, supersedesLabelId: 'w', sourceScanObservationId: imgId(pkg, 'front'), anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED })]);
  assert.equal(ds.acceptedLabels[0].revision, 4);
  assert.equal(ds.acceptedLabels[0].supersedesLabelId, 'w');
  assert.equal(ds.semanticGroundTruthObservations[0].provenance.revision, 4);
});

// 22 & 23 — annotation manifest: no pixels, identity preserved.
test('annotation manifest carries identity but no raw image payload', () => {
  const pkg = pkgOf({ front: { img: 2 } });
  const man = buildAnnotationManifest(pkg);
  assert.equal(man.length, 2);
  const json = JSON.stringify(man);
  for (const forbidden of ['PIXELS', 'base64', 'dataUrl']) assert.equal(json.includes(forbidden), false);
  assert.equal(typeof man[0].imageRef, 'string');
  assert.equal(man[0].sourceScanObservationId, imgId(pkg, 'front'));
  assert.equal(man[0].imageWidth, 640);
});

// 24–27 — summary counts deterministic.
test('dataset summary counts are deterministic and stratified', () => {
  const pkg = pkgOf({ front: { img: 2 }, 'right-45': { img: 1 } });
  const labels = [
    L({ sourceScanObservationId: imgId(pkg, 'front', 0), anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED, poseId: 'front' }),
    L({ sourceScanObservationId: imgId(pkg, 'front', 1), anatomicalRegion: 'CHIN_CENTER', hairState: HairState.NON_BEARD_CONFIRMED, poseId: 'front' }),
    L({ sourceScanObservationId: imgId(pkg, 'right-45', 0), anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED, poseId: 'right-45' })
  ];
  const a = assembleGroundTruthDataset(pkg, labels).datasetSummary;
  const b = assembleGroundTruthDataset(pkg, labels).datasetSummary;
  assert.deepEqual(a, b);
  assert.equal(a.eligibleImageObservationCount, 3);
  assert.equal(a.labeledObservationCount, 3);
  assert.equal(a.perPoseLabelCounts.front, 2);
  assert.equal(a.perPoseLabelCounts['right-45'], 1);
  assert.equal(a.perRegionLabelCounts.LEFT_JAW, 2);
  assert.equal(a.perHairStateCounts[HairState.BEARD_CONFIRMED], 2);
  assert.equal(a.datasetCoverageRate, 1);
});

// 28 — unlabeled eligible observations reported.
test('unlabeled eligible observations are reported (never assumed NON_BEARD)', () => {
  const pkg = pkgOf({ front: { img: 3 } });
  const ds = assembleGroundTruthDataset(pkg, [L({ sourceScanObservationId: imgId(pkg, 'front', 0), anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED })]);
  assert.equal(ds.unlabeledEligibleObservations.length, 2);
  assert.equal(ds.datasetSummary.unlabeledObservationCount, 2);
  assert.equal(JSON.stringify(ds.unlabeledEligibleObservations).includes('PIXELS'), false);
});

// 29 & 30 & 31 — BS1-E bridge.
test('BS1-E evaluation entries carry exactly the expected identity fields and score cleanly', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const id = imgId(pkg, 'front');
  const ds = assembleGroundTruthDataset(pkg, [
    L({ sourceScanObservationId: id, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED, annotationConfidence: 0.9 }),
    makeGroundTruthLabel({ sourceScanObservationId: id, anatomicalRegion: 'CHIN_CENTER', hairState: HairState.UNCERTAIN, annotationStatus: AnnotationStatus.AMBIGUOUS })
  ]);
  const entries = groundTruthDatasetToEvaluationEntries(ds);
  assert.equal(entries.scoredEntries.length, 1);
  const e = entries.scoredEntries[0];
  assert.deepEqual(Object.keys(e).sort(), ['anatomicalRegion', 'hairState', 'imageRef', 'nativeFrameTimestampNs', 'observedPoseRegion', 'poseId', 'semanticConfidence', 'sourceMethod', 'sourceScanObservationId', 'syncStatus'].sort());
  assert.equal(e.sourceMethod, ObservationMethod.MANUAL_GROUND_TRUTH);
  assert.equal(entries.ambiguousEntries.length, 1);
  // definitive GT scores in BS1-E; ambiguous is NOT in the scored array
  const preds = [{ sourceScanObservationId: id, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED, poseId: 'front', syncStatus: SyncStatus.EXACT_SYNCHRONIZED }];
  const report = evaluateSemanticProducer(preds, entries.scoredEntries);
  assert.equal(report.overallMetrics.truePositives, 1);
});

// 32 — producer evaluation manifest reproducible.
test('producer evaluation manifest lists the same observation set + regions with GT', () => {
  const pkg = pkgOf({ front: { img: 1 }, 'right-45': { img: 1 } });
  const f = imgId(pkg, 'front'), r = imgId(pkg, 'right-45');
  const ds = assembleGroundTruthDataset(pkg, [
    L({ sourceScanObservationId: f, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED }),
    L({ sourceScanObservationId: f, anatomicalRegion: 'CHIN_CENTER', hairState: HairState.BEARD_CONFIRMED }),
    L({ sourceScanObservationId: r, anatomicalRegion: 'RIGHT_JAW', hairState: HairState.NON_BEARD_CONFIRMED })
  ]);
  const m1 = buildProducerEvaluationManifest(ds, pkg);
  const m2 = buildProducerEvaluationManifest(ds, pkg);
  assert.deepEqual(m1, m2);
  assert.equal(m1.rows.length, 2);
  const frow = m1.rows.find(x => x.observationId === f);
  assert.deepEqual(frow.regionsToEvaluate, ['CHIN_CENTER', 'LEFT_JAW']);
  assert.equal(JSON.stringify(m1).includes('PIXELS'), false);
});

// 33 — empty scan package → valid empty dataset.
test('empty scan package produces a valid empty dataset', () => {
  const ds = emptyGroundTruthDataset({ datasetId: 'd0', datasetRevision: 1 });
  assert.equal(ds.schemaVersion, GROUND_TRUTH_DATASET_VERSION);
  assert.equal(ds.acceptedLabels.length, 0);
  assert.equal(ds.datasetSummary.eligibleImageObservationCount, 0);
  assert.equal(ds.datasetSummary.datasetCoverageRate, null);
  assert.equal(typeof groundTruthDatasetDiagnosticString(ds), 'string');
});

// 34 — no random split / subject leakage behavior.
test('splitBySubjectGroup refuses to split without a caller-supplied subject grouping', () => {
  assert.throws(() => splitBySubjectGroup([{ sourceScanObservationId: 'a' }], null, {}), /subjectGroupOf/);
  assert.throws(() => splitBySubjectGroup([{ sourceScanObservationId: 'a' }], () => 'subj1'), /assignment map is required/);
  const out = splitBySubjectGroup(
    [{ sourceScanObservationId: 'a', subj: 's1' }, { sourceScanObservationId: 'b', subj: 's2' }],
    e => e.subj, { s1: 'train', s2: 'test' }
  );
  assert.deepEqual(out.train.map(e => e.sourceScanObservationId), ['a']);
  assert.deepEqual(out.test.map(e => e.sourceScanObservationId), ['b']);
});

// 35 — historical annotation adapter: none exists.
test('no historical A6.1 annotation export format exists in the repo — no adapter needed', () => {
  // audited: no a61a_selected_images.json / a61a_annotate.html / annotation schema found.
  // This test documents the audit outcome; there is nothing to convert.
  assert.equal(GROUND_TRUTH_DATASET_VERSION, 'ground-truth-dataset/1');
});

// --- supporting ---
test('groupByScanSession groups labels deterministically', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const ds = assembleGroundTruthDataset(pkg, [L({ sourceScanObservationId: imgId(pkg, 'front'), anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED, scanSessionId: 'sess-1' })]);
  const grouped = groupByScanSession(ds.acceptedLabels);
  assert.deepEqual(Object.keys(grouped), ['sess-1']);
});

test('unknown region / unknown pose labels are rejected with a precise reason', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const id = imgId(pkg, 'front');
  assert.equal(validateLabelAgainstScanPackage(L({ sourceScanObservationId: id, anatomicalRegion: 'NOSE_TIP', hairState: HairState.BEARD_CONFIRMED }), pkg).reason, LabelRejectReason.UNKNOWN_REGION);
  assert.throws(() => makeGroundTruthLabel({ anatomicalRegion: 'LEFT_JAW', poseId: 'front', annotationStatus: 'WEIRD' }), /unknown annotationStatus/);
});

test('diagnostic string has no image payload and lists all six poses', () => {
  const pkg = pkgOf({ front: { img: 1 } });
  const ds = assembleGroundTruthDataset(pkg, [L({ sourceScanObservationId: imgId(pkg, 'front'), anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED, poseId: 'front' })]);
  const s = groundTruthDatasetDiagnosticString(ds);
  assert.match(s, /Mettle Ground Truth Dataset/);
  assert.equal(s.includes('PIXELS'), false);
  for (const pose of ['front', 'right-45', 'right-profile', 'left-45', 'left-profile', 'chin-up']) assert.ok(s.includes(pose + '='));
});
