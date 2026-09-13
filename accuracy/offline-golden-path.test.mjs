// Stage BS1-X — offline golden-path END-TO-END integration harness.
//
// One deterministic flow through the REAL BS1-A..H contract shapes:
//
//   synthetic CURRENT-A6-shaped export
//     -> fromA6Exports            (BS1-C adapter -> BS1-B MultiObservationScanPackage)
//     -> projectBeardSurface      (BS1-C geometry projection -> BS1-A PersonalizedBeardSurface)
//     -> buildAnnotationManifest  (BS1-F)
//     -> buildAnnotationBundle    (BS1-G, caller resolver supplies the synthetic image bytes)
//     -> annotation-workbench.cjs (BS1-H core: validate / label / export)
//     -> assembleGroundTruthDataset (BS1-F)
//     -> semantic surface         (BS1-D observations + BS1-A buildBeardSurface, MANUAL_GROUND_TRUTH)
//     -> evaluateSemanticProducer (BS1-E, synthetic SEMANTIC_SEGMENTATION predictions)
//
// SYNTHETIC / NOT USER DATA. No model, no segmentation, no pixel processing, no real facial
// images, no network, no persistence, no runtime/app integration. node:test + node:assert/strict.
// Zero dependencies. This stage is integration-test-only: it modifies no existing module.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBeardSurface, HairState, ObservationMethod } from './beard-surface-core.mjs';
import { SyncStatus, ObservationPayloadKind } from './multi-observation-scan-package.mjs';
import { fromA60Export, fromA60BExport, fromA6Exports } from './a6-scan-package-adapter.mjs';
import { SUPPORTED_REGIONS, UNSUPPORTED_REGIONS } from './beard-anatomy-map.mjs';
import { projectBeardSurface } from './scan-package-to-beard-surface.mjs';
import {
  makeSemanticHairObservation, semanticObservationsToSurfaceObservations
} from './semantic-hair-evidence.mjs';
import { ImageResolveStatus } from './semantic-image-evidence.mjs';
import { evaluateSemanticProducer, evaluationDiagnosticString } from './semantic-evaluation.mjs';
import {
  buildAnnotationManifest, makeGroundTruthLabel, assembleGroundTruthDataset,
  groundTruthDatasetToEvaluationEntries, groundTruthDatasetDiagnosticString
} from './ground-truth-dataset.mjs';
import {
  buildAnnotationBundle, stripRawImages, annotationBundleDiagnosticString
} from './annotation-bundle.mjs';
import AWB from '../tools/annotation-workbench/annotation-workbench.cjs';

// ---------------------------------------------------------------------------
// SYNTHETIC fixture. A distinctive raw-image marker is traced through the pipeline;
// past the annotation-bundle / workbench-display boundary it must never reappear.
// ---------------------------------------------------------------------------
const MARK = 'SYNTHETIC_IMAGE_PAYLOAD_DO_NOT_LEAK';
const payload = (tag) => 'data:image/png;base64,' + MARK + ':' + tag; // NOT a real image

const pts = () => Array.from({ length: 468 }, (_, i) => ({
  x: (i % 50) * 0.01, y: Math.floor(i / 50) * 0.01, z: (i % 7) * 0.005
}));

function buildGoldenA6() {
  let ts = 1_000_000;
  const geom = (extra = {}) => (ts += 1000, {
    nativeTs: ts, t: ts / 1000, yawDeg: 0, pitchDeg: 0, rollDeg: 0,
    faceCameraX: 0, faceCameraY: 0, faceCameraZ: 0.35, transformationMatrix: new Array(16).fill(0),
    landmarks2D: pts(), faceLocal3D: pts(), frameWidth: 1080, frameHeight: 1920,
    mirrored: true, coverageValid: true, ...extra
  });
  const kf = (extra = {}) => (ts += 1000, {
    nativeTs: ts, coherenceStatus: 'VERIFIED_EXACT', rejectReason: null,
    dataUrl: payload('kf' + ts), width: 64, height: 48, imageRotationDegrees: 90, imageMirrored: false,
    intrinsics: { fx: 500, fy: 500, cx: 32, cy: 24, imageWidth: 64, imageHeight: 48, space: 'IMAGE' },
    landmarks2D: pts(), faceLocal3D: pts(), transformationMatrix: new Array(16).fill(0),
    imageSpaceViewModelMatrix: new Array(16).fill(0), yawDeg: 0, pitchDeg: 0, rollDeg: 0,
    faceCameraX: 0, faceCameraY: 0, faceCameraZ: 0.35, captureLatencyMs: 12, ...extra
  });

  // A6.0 per-pose export — several hidden observations behind each visible pose.
  const a60 = {
    geometryObs: {
      'front': [geom({ yawDeg: 0 }), geom({ yawDeg: 1 }), geom({ yawDeg: -1 })],
      'right-45': [geom({ yawDeg: 26 }), geom({ yawDeg: 28 })],
      'right-profile': [geom({ yawDeg: 48 })],
      'chin-up': [geom({ pitchDeg: -28 })]
    },
    imageKeyframes: {
      'front': [kf({ yawDeg: 0 }), kf({ yawDeg: 0.5 })],
      'right-45': [kf({ yawDeg: 27 })],
      'right-profile': [kf({ yawDeg: 49 })],
      'chin-up': [kf({ pitchDeg: -27 })]
    }
  };

  // A6.0B flat export — one transition observation (Scanner step + measured band).
  const a60b = {
    manifest: { schemaVersion: 1, scannerSessionId: 'synthetic-session', startedAt: 0 },
    geometryObs: [{
      ...geom({ yawDeg: 38 }),
      scannerSessionId: 'synthetic-session', observationId: 0,
      currentScannerStep: 'right-three-quarter',        // Scanner vocab -> canonical right-45
      observedPoseRegion: 'RIGHT45_TO_RIGHT_PROFILE',   // transition band
      qualityOk: true, qualityReason: 'ok', stableFrames: 6, readyFormalPose: false,
      retentionReason: 'POSE_DELTA'
    }],
    imageKeyframes: [], formalCaptureAssociations: []
  };

  return { a60, a60b, _SYNTHETIC: 'SYNTHETIC — NOT USER DATA' };
}

// Strict-identity image resolver over the synthetic payloads, keyed by observationId.
function makeResolver(scanPackage) {
  const byId = new Map();
  for (const p of Object.values(scanPackage.posePackages)) {
    for (const o of p.retainedImageObservations) byId.set(o.observationId, o);
  }
  return (key) => {
    const o = byId.get(key.sourceScanObservationId);
    if (!o) return { status: ImageResolveStatus.NOT_FOUND };
    return {
      status: ImageResolveStatus.RESOLVED,
      payload: payload(o.observationId),
      format: 'data-url',
      width: 64, height: 48, rotationDegrees: 90, mirrored: false,
      intrinsics: { fx: 500, fy: 500, cx: 32, cy: 24, imageWidth: 64, imageHeight: 48, space: 'IMAGE' },
      coherenceStatus: o.coherenceStatus || 'VERIFIED_EXACT', landmarkCount: 468,
      imageRef: key.imageRef, nativeFrameTimestampNs: key.nativeFrameTimestampNs,
      poseId: key.poseId, scanSessionId: key.scanSessionId
    };
  };
}

// The one deterministic golden pipeline. Returns every stage artifact.
function runGoldenPipeline() {
  const { a60, a60b } = buildGoldenA6();

  const { scanPackage } = fromA6Exports({ a60, a60b });
  const projection = projectBeardSurface(scanPackage);

  // Caller composes the region-request list from the geometry-supported regions.
  const manifest = buildAnnotationManifest(scanPackage).map(r => ({
    ...r, regionsToAnnotate: r.supportedGeometryRegions.slice()
  }));

  const bundle = buildAnnotationBundle(manifest, makeResolver(scanPackage), {
    bundleId: 'golden-1', datasetId: 'golden-ds', datasetRevision: 1, createdAt: 0
  });

  // BS1-H workbench core.
  const validated = AWB.validateBundle(bundle);
  let state = AWB.initAnnotationState(validated.bundle);
  const idOf = (pose, i = 0) => scanPackage.posePackages[pose].retainedImageObservations[i].observationId;
  const fId = idOf('front'), r45Id = idOf('right-45'), rpId = idOf('right-profile'), cuId = idOf('chin-up');
  const L = (id, region, hs, as) => { state = AWB.setRegionLabel(state, id, region, { hairState: hs, annotationStatus: as }); };
  // BOUNDARY / UNCERTAIN are written directly into state rather than through AWB.setRegionLabel:
  // BI-1E added an interactive labelability gate to setRegionLabel that restricts a specific
  // EXPERIMENT's region set to {BEARD_CONFIRMED, NON_BEARD_CONFIRMED, UNKNOWN} for regions
  // lacking a reliable spatial definition. That is a workbench-UI safety policy for that
  // experiment, not a constraint on what the underlying BS1-F HairState schema permits — this
  // pipeline test exists specifically to prove BOUNDARY/UNCERTAIN GT flows correctly all the way
  // to confusion-matrix scoring (see PART10b and the BOUNDARY.BOUNDARY assertion below), so it
  // writes those two states directly, bypassing that UI-specific gate on purpose.
  const Ldirect = (id, region, hs, as) => {
    state = { ...state, byEntry: { ...state.byEntry, [id]: { ...state.byEntry[id], [region]: { hairState: hs, annotationStatus: as, annotationConfidence: null, notes: '' } } } };
  };
  L(fId, 'LEFT_JAW', 'BEARD_CONFIRMED', 'LABELED');
  L(fId, 'RIGHT_JAW', 'NON_BEARD_CONFIRMED', 'LABELED');
  Ldirect(fId, 'CHIN_CENTER', 'BOUNDARY', 'LABELED');
  L(r45Id, 'LEFT_JAW', 'BEARD_CONFIRMED', 'LABELED');
  L(r45Id, 'CHIN_CENTER', 'BEARD_CONFIRMED', 'LABELED');
  L(rpId, 'RIGHT_JAW', 'BEARD_CONFIRMED', 'LABELED');
  Ldirect(cuId, 'CHIN_CENTER', 'UNCERTAIN', 'NEEDS_REVIEW');
  // Every other requested region on every entry stays UNKNOWN / UNKNOWN on purpose.
  const exportObj = AWB.buildExport(validated.bundle, state, {});

  const labels = AWB.groundTruthLabelsForBS1F(exportObj).map(makeGroundTruthLabel);
  const dataset = assembleGroundTruthDataset(scanPackage, labels);
  const evalEntries = groundTruthDatasetToEvaluationEntries(dataset);

  // BS1-D semantic observations + BS1-A fusion (geometry surface + accepted MANUAL_GROUND_TRUTH).
  const semanticSurfaceObs = semanticObservationsToSurfaceObservations(dataset.semanticGroundTruthObservations);
  const combinedSurface = buildBeardSurface(
    [...projection.surfaceObservations, ...semanticSurfaceObs],
    { toleranceNormalized: 0.05 }
  );

  // BS1-E synthetic SEMANTIC_SEGMENTATION producer over the SAME identities as the scored GT.
  const scored = evalEntries.scoredEntries;
  const pick = (id, region) => scored.find(e => e.sourceScanObservationId === id && e.anatomicalRegion === region);
  const pred = (e, hs, conf) => ({
    sourceScanObservationId: e.sourceScanObservationId, anatomicalRegion: e.anatomicalRegion,
    hairState: hs, poseId: e.poseId, syncStatus: e.syncStatus, imageRef: e.imageRef,
    nativeFrameTimestampNs: e.nativeFrameTimestampNs, semanticConfidence: conf,
    sourceMethod: ObservationMethod.SEMANTIC_SEGMENTATION
  });
  const predictions = [
    pred(pick(fId, 'LEFT_JAW'), 'BEARD_CONFIRMED', 0.90),       // correct beard      -> TP
    pred(pick(fId, 'RIGHT_JAW'), 'NON_BEARD_CONFIRMED', 0.80),  // correct non-beard  -> TN
    pred(pick(fId, 'CHIN_CENTER'), 'BOUNDARY', 0.40),           // correct boundary   -> boundary TP
    pred(pick(r45Id, 'LEFT_JAW'), 'NON_BEARD_CONFIRMED', 0.55), // INTENTIONALLY WRONG -> FN
    pred(pick(r45Id, 'CHIN_CENTER'), 'BEARD_CONFIRMED', 0.70),  // correct beard      -> TP
    pred(pick(rpId, 'RIGHT_JAW'), 'UNKNOWN', null)              // abstention on definite GT
  ];
  const report = evaluateSemanticProducer(predictions, scored, { confidenceBins: [0, 0.5, 1] });

  return {
    a60, a60b, scanPackage, projection, manifest, bundle, validated, state, exportObj,
    labels, dataset, evalEntries, semanticSurfaceObs, combinedSurface, predictions, report,
    ids: { fId, r45Id, rpId, cuId }
  };
}

const G = runGoldenPipeline();

// ===========================================================================
// PART 3 — the golden pipeline runs end to end without throwing.
// ===========================================================================
test('PART3: the full offline golden pipeline runs deterministically without error', () => {
  assert.ok(G.scanPackage && G.projection && G.bundle && G.exportObj && G.dataset && G.report);
  assert.equal(G.report.schemaVersion, 'semantic-evaluation/1');
});

// ===========================================================================
// PART 4 — A6 ingest (BS1-C adapter -> BS1-B package)
// ===========================================================================
test('PART4: A6 ingest — pose ids converted, exact keyframes, geometry-only survives, transition kept', () => {
  const pp = G.scanPackage.posePackages;
  assert.deepEqual(Object.keys(pp).sort(), ['chin-up', 'front', 'right-45', 'right-profile']);
  assert.ok(String(G.scanPackage.sourceArchitectureVersion).includes('A6'));

  // right-three-quarter (A6.0B) -> canonical right-45, merged under the formal pose package.
  assert.equal(pp['right-45'].retainedGeometryObservations.length, 3); // 2 from A6.0 + 1 from A6.0B
  const trans = pp['right-45'].retainedGeometryObservations.find(o => o.observedPoseRegion === 'RIGHT45_TO_RIGHT_PROFILE');
  assert.ok(trans, 'transition observation is retained');
  assert.equal(trans.poseId, 'right-45');

  // Front image keyframes are all exact-synchronized.
  const fk = pp['front'].retainedImageObservations;
  assert.equal(fk.length, 2);
  assert.ok(fk.every(k => k.syncStatus === SyncStatus.EXACT_SYNCHRONIZED));
  assert.ok(fk.every(k => k.coherenceStatus === 'VERIFIED_EXACT'));

  // Geometry-only observations are not promoted to image observations.
  assert.ok(pp['front'].retainedGeometryObservations.some(o => o.payloadKind === ObservationPayloadKind.GEOMETRY_ONLY));
  assert.equal(pp['front'].retainedGeometryObservations.length, 3);
});

test('PART4b: fromA60Export and fromA60BExport are individually usable', () => {
  const only0 = fromA60Export(G.a60);
  assert.ok(Object.keys(only0.scanPackage.posePackages).length >= 4);
  const only0b = fromA60BExport(G.a60b);
  assert.ok(only0b.scanPackage.posePackages['right-45']);
  assert.equal(
    only0b.scanPackage.posePackages['right-45'].retainedGeometryObservations[0].observedPoseRegion,
    'RIGHT45_TO_RIGHT_PROFILE'
  );
});

// ===========================================================================
// PART 15 — multi-observation invariant: "six poses != six photos"
// ===========================================================================
test('PART15: one visible Front pose carries multiple hidden observations', () => {
  const f = G.scanPackage.posePackages['front'];
  assert.equal(f.retainedGeometryObservations.length, 3);
  assert.equal(f.retainedImageObservations.length, 2);
  assert.equal(f.retainedGeometryObservations.length + f.retainedImageObservations.length, 5);
});

// ===========================================================================
// PART 5 — geometry projection (BS1-C -> BS1-A surface)
// ===========================================================================
test('PART5: geometry projection — supported regions only, no fabricated neck/under-jaw 3D', () => {
  const observed = new Set(G.projection.surfaceObservations.map(o => o.region));
  assert.ok(observed.size > 0);
  for (const r of observed) assert.ok(SUPPORTED_REGIONS.includes(r), r + ' is a supported region');

  // The personalized surface exposes exactly the supported regions — nothing invented.
  assert.deepEqual(
    Object.keys(G.projection.personalizedBeardSurface.regions).sort(),
    [...SUPPORTED_REGIONS].sort()
  );
  for (const bad of ['NECK_FRONT', 'UNDER_JAW_CENTER', 'CHIN_NECK_TRANSITION', 'LEFT_SIDEBURN', 'UNDER_CHIN']) {
    assert.ok(!(bad in G.projection.personalizedBeardSurface.regions), bad + ' is not materialized');
    assert.ok(G.projection.unsupportedRegions.includes(bad), bad + ' is reported unsupported');
    assert.ok(UNSUPPORTED_REGIONS.includes(bad));
  }

  // Every surface position lives in canonical face-local space.
  assert.ok(G.projection.surfaceObservations.every(o => o.space === 'CANONICAL_FACE_LOCAL'));
  assert.ok(G.projection.surfaceObservations.every(o => o.method === ObservationMethod.LANDMARK_GEOMETRY));
});

test('PART5b: multi-pose geometry drives multi-view support; image refs survive projection', () => {
  const rj = G.projection.personalizedBeardSurface.regions.RIGHT_JAW;
  assert.equal(rj.multiViewSupported, true);
  for (const p of ['front', 'right-45', 'right-profile', 'chin-up']) {
    assert.ok(rj.provenance.poses.includes(p), 'RIGHT_JAW provenance includes ' + p);
  }
  assert.equal(rj.semanticSupported, false); // geometry-only projection
  assert.equal(
    typeof G.projection.scanPackage.posePackages['front'].retainedImageObservations[0].imageRef.ref,
    'string'
  );
});

// ===========================================================================
// PART 6 — annotation manifest (BS1-F)
// ===========================================================================
test('PART6: annotation manifest — image-backed rows only, identity matches, no pixels', () => {
  assert.equal(G.manifest.length, 5); // 2 front + 1 right-45 + 1 right-profile + 1 chin-up keyframes
  const json = JSON.stringify(G.manifest);
  for (const bad of [MARK, 'base64', 'dataUrl', 'data:image']) assert.ok(!json.includes(bad), 'manifest free of ' + bad);

  const obs0 = G.scanPackage.posePackages['front'].retainedImageObservations[0];
  const row0 = G.manifest.find(r => r.sourceScanObservationId === obs0.observationId);
  assert.ok(row0);
  assert.equal(row0.imageRef, obs0.imageRef.ref);
  assert.equal(row0.nativeFrameTimestampNs, obs0.timestamp.nativeFrameTimestampNs);
  assert.equal(row0.poseId, 'front');
  assert.equal(row0.syncStatus, SyncStatus.EXACT_SYNCHRONIZED);
  assert.ok(row0.regionsToAnnotate.length >= 2 && row0.regionsToAnnotate.includes('LEFT_JAW'));
});

// ===========================================================================
// PART 7 — annotation bundle (BS1-G)
// ===========================================================================
test('PART7: AnnotationBundle — resolved images enter, payload ONLY here, metadata survives', () => {
  assert.equal(G.bundle.entries.length, 5);
  assert.equal(G.bundle.missingEntries.length, 0);
  assert.equal(G.bundle.rejectedEntries.length, 0);
  assert.equal(G.bundle.rawImageStorageScope, 'LOCAL_ANNOTATION_BUNDLE');
  assert.ok(G.bundle.entries.every(e => typeof e.rawImagePayload === 'string' && e.rawImagePayload.includes(MARK)));

  const row0 = G.manifest[0];
  const e0 = G.bundle.entries.find(e => e.sourceScanObservationId === row0.sourceScanObservationId);
  assert.equal(e0.imageRef, row0.imageRef);
  assert.equal(e0.nativeFrameTimestampNs, row0.nativeFrameTimestampNs);
  assert.equal(e0.poseId, row0.poseId);
  assert.equal(e0.syncStatus, SyncStatus.EXACT_SYNCHRONIZED);
  assert.equal(e0.rotationDegrees, 90);
  assert.equal(e0.mirrored, false);
  assert.equal(e0.intrinsics.space, 'IMAGE');
  assert.equal(e0.coherenceStatus, 'VERIFIED_EXACT');
});

// ===========================================================================
// PART 8 — workbench annotation / export core (BS1-H)
// ===========================================================================
test('PART8: workbench export — MANUAL_GROUND_TRUTH, identity preserved, no pixels, UNKNOWN != NON_BEARD', () => {
  assert.equal(AWB.validateBundle(G.bundle).ok, true);
  assert.equal(G.exportObj.sourceMethod, 'MANUAL_GROUND_TRUTH');
  assert.ok(G.exportObj.labels.every(l => l.sourceMethod === 'MANUAL_GROUND_TRUTH'));

  const json = JSON.stringify(G.exportObj);
  for (const bad of [MARK, 'base64', 'data:image']) assert.ok(!json.includes(bad), 'export free of ' + bad);

  const unfinished = G.exportObj.labels.filter(l => l.annotationStatus === 'UNKNOWN');
  assert.ok(unfinished.length >= 1);
  assert.ok(unfinished.every(l => l.hairState === 'UNKNOWN'), 'unfinished regions never default to NON_BEARD_CONFIRMED');

  const wl = G.exportObj.labels.find(l => l.sourceScanObservationId === G.ids.fId && l.anatomicalRegion === 'LEFT_JAW');
  const obs0 = G.scanPackage.posePackages['front'].retainedImageObservations[0];
  assert.equal(wl.imageRef, obs0.imageRef.ref);
  assert.equal(wl.nativeFrameTimestampNs, obs0.timestamp.nativeFrameTimestampNs);
  assert.equal(wl.hairState, 'BEARD_CONFIRMED');
  assert.equal(wl.annotationStatus, 'LABELED');
});

// ===========================================================================
// PART 9 — ground-truth dataset (BS1-F)
// ===========================================================================
test('PART9: GroundTruthDataset — definitive accepted, NEEDS_REVIEW fail-closed, identity agrees, no bytes', () => {
  assert.equal(G.dataset.acceptedLabels.length, 6);
  assert.equal(G.dataset.needsReviewLabels.length, 1);
  assert.equal(G.dataset.rejectedLabels.length, 0);
  assert.equal(G.dataset.ambiguousLabels.length, 0);
  assert.equal(G.dataset.conflictLabels.length, 0);
  assert.equal(G.dataset.semanticGroundTruthObservations.length, 6);
  assert.ok(G.dataset.acceptedLabels.every(l => l.sourceMethod === 'MANUAL_GROUND_TRUTH'));

  const json = JSON.stringify(G.dataset);
  for (const bad of [MARK, 'base64', 'data:image']) assert.ok(!json.includes(bad), 'dataset free of ' + bad);

  const acc = G.dataset.acceptedLabels.find(l => l.anatomicalRegion === 'LEFT_JAW' && l.sourceScanObservationId === G.ids.fId);
  const obs0 = G.scanPackage.posePackages['front'].retainedImageObservations[0];
  assert.equal(acc.imageRef, obs0.imageRef.ref);
  assert.equal(acc.nativeFrameTimestampNs, obs0.timestamp.nativeFrameTimestampNs);
  assert.equal(acc.hairState, 'BEARD_CONFIRMED');
});

// ===========================================================================
// PART 10 — semantic surface (BS1-D observations + BS1-A fusion)
// ===========================================================================
test('PART10: fused region reports geometry AND semantic; MANUAL_GROUND_TRUTH is counted (BS1-D1)', () => {
  const lj = G.combinedSurface.regions.LEFT_JAW;
  assert.equal(lj.semanticSupported, true);
  assert.ok(lj.geometryCoverage > 0);
  assert.ok(lj.provenance.methods.includes(ObservationMethod.LANDMARK_GEOMETRY));
  assert.ok(lj.provenance.methods.includes(ObservationMethod.MANUAL_GROUND_TRUTH));
  assert.ok(lj.provenance.semanticCount >= 1);
  assert.equal(lj.hairState, HairState.BEARD_CONFIRMED); // consistent MANUAL_GROUND_TRUTH beard labels
});

test('PART10b: conflicting semantic labels across poses collapse the region to BOUNDARY', () => {
  // RIGHT_JAW: front NON_BEARD_CONFIRMED vs right-profile BEARD_CONFIRMED (both accepted GT).
  assert.equal(G.combinedSurface.regions.RIGHT_JAW.hairState, HairState.BOUNDARY);

  // and directly at the BS1-D -> BS1-A seam with a minimal synthetic pair:
  const sem = (region, hs, pose) => makeSemanticHairObservation({
    observationId: 's:' + region + ':' + pose, sourceScanObservationId: 'x:' + pose,
    imageRef: 'imgref:' + pose, poseId: pose, nativeFrameTimestampNs: 1,
    anatomicalRegion: region, hairState: hs, sourceMethod: ObservationMethod.MANUAL_GROUND_TRUTH,
    syncStatus: SyncStatus.EXACT_SYNCHRONIZED, synthetic: true
  });
  const surf = buildBeardSurface(semanticObservationsToSurfaceObservations([
    sem('LEFT_JAW', HairState.BEARD_CONFIRMED, 'front'),
    sem('LEFT_JAW', HairState.NON_BEARD_CONFIRMED, 'right-45')
  ]));
  assert.equal(surf.regions.LEFT_JAW.hairState, HairState.BOUNDARY);
});

// ===========================================================================
// PART 12 — BS1-E evaluation with EXACT mathematically expected counts
// ===========================================================================
test('PART12: BS1-E evaluation — exact expected confusion matrix and metrics', () => {
  const r = G.report;

  assert.equal(r.matchingSummary.predictionEntries, 6);
  assert.equal(r.matchingSummary.groundTruthEntries, 6);
  assert.equal(r.matchingSummary.matchedPairs, 6);
  assert.equal(r.matchingSummary.predictionsWithoutGroundTruth, 0);
  assert.equal(r.matchingSummary.groundTruthWithoutPrediction, 0);
  assert.equal(r.matchingSummary.excludedCount, 0);
  assert.equal(r.matchingSummary.transitionPairs, 0);

  const om = r.overallMetrics;
  assert.equal(om.pairCount, 6);
  assert.equal(om.binaryScorablePairs, 4);
  assert.equal(om.truePositives, 2);
  assert.equal(om.falsePositives, 0);
  assert.equal(om.trueNegatives, 1);
  assert.equal(om.falseNegatives, 1);
  assert.equal(om.precision, 1);
  assert.equal(om.recall, 0.6667);
  assert.equal(om.specificity, 1);
  assert.equal(om.f1, 0.8);
  assert.equal(om.accuracy, 0.75);

  // danger-focused
  assert.equal(om.falseBeardCount, 0);
  assert.equal(om.falseBeardRate, 0);
  assert.equal(om.falseNonBeardCount, 1);
  assert.equal(om.falseNonBeardRate, 0.25);       // 1 FN / 4 matched beard GT
  assert.equal(om.groundTruthBeardCount, 4);
  assert.equal(om.groundTruthNonBeardCount, 1);
  assert.equal(om.groundTruthBoundaryCount, 1);

  // boundary metrics separate from binary
  assert.equal(om.boundary.truePositives, 1);
  assert.equal(om.boundary.falsePositives, 0);
  assert.equal(om.boundary.falseNegatives, 0);
  assert.equal(om.boundary.f1, 1);

  // abstention
  assert.equal(om.predictionAbstainedOnDefiniteGtCount, 1);
  assert.equal(om.predictionUnknownRate, 0.1667);
  assert.equal(om.predictionUncertainRate, 0);

  // confusion matrix reconciles to matched pairs
  let cm = 0;
  for (const gk of Object.keys(r.confusionMatrix)) for (const pk of Object.keys(r.confusionMatrix[gk])) cm += r.confusionMatrix[gk][pk];
  assert.equal(cm, 6);
  assert.equal(r.confusionMatrix.BEARD_CONFIRMED.BEARD_CONFIRMED, 2);
  assert.equal(r.confusionMatrix.BEARD_CONFIRMED.NON_BEARD_CONFIRMED, 1);
  assert.equal(r.confusionMatrix.BEARD_CONFIRMED.UNKNOWN, 1);
  assert.equal(r.confusionMatrix.NON_BEARD_CONFIRMED.NON_BEARD_CONFIRMED, 1);
  assert.equal(r.confusionMatrix.BOUNDARY.BOUNDARY, 1);
});

test('PART12b: BS1-E stratification — per-pose, per-region, per-sync exactly as expected', () => {
  const r = G.report;

  assert.equal(r.perPose['front'].pairCount, 3);
  assert.equal(r.perPose['front'].binaryScorablePairs, 2);
  assert.equal(r.perPose['front'].accuracy, 1);
  assert.equal(r.perPose['right-45'].pairCount, 2);
  assert.equal(r.perPose['right-45'].falseNegatives, 1);
  assert.equal(r.perPose['right-45'].recall, 0.5);
  // right-profile's only pair is an abstention -> no scorable pair -> NOT_EVALUABLE
  assert.equal(r.perPose['right-profile'], 'NOT_EVALUABLE');
  assert.equal(r.perPose['left-45'], 'NOT_EVALUABLE');

  assert.equal(r.perRegion['LEFT_JAW'].truePositives, 1);
  assert.equal(r.perRegion['LEFT_JAW'].falseNegatives, 1);
  assert.equal(r.perRegion['RIGHT_JAW'].trueNegatives, 1);
  assert.equal(r.perRegion['CHIN_CENTER'].boundary.truePositives, 1);
  assert.equal(r.perRegion['NECK_FRONT'], 'NOT_EVALUABLE');
  assert.equal(r.perRegion['CHIN_LEFT'], 'NOT_EVALUABLE');

  assert.equal(r.perSyncStatus[SyncStatus.EXACT_SYNCHRONIZED].pairCount, 6);
  assert.equal(r.perSyncStatus[SyncStatus.EXACT_SYNCHRONIZED].binaryScorablePairs, 4);
  assert.equal(r.perSyncStatus['NEAR_SYNCHRONIZED'], 'NOT_EVALUABLE');

  // confidence calibration is populated and never NaN/Infinity
  const cal = r.confidenceCalibration;
  assert.ok(cal && typeof cal === 'object');
  assert.equal(cal.binsRejectedReason, undefined); // [0,0.5,1] is a valid edge array
  for (const v of [cal.meanConfidenceCorrect, cal.meanConfidenceIncorrect]) {
    if (v !== null) assert.ok(Number.isFinite(v));
  }
});

// ===========================================================================
// PART 13 — privacy invariant: the raw-image marker stops at the bundle/display boundary
// ===========================================================================
test('PART13: SYNTHETIC_IMAGE_PAYLOAD_DO_NOT_LEAK never appears downstream of the bundle', () => {
  // present where it is allowed
  assert.ok(JSON.stringify(G.a60).includes(MARK), 'A6 synthetic keyframe carries the payload');
  assert.ok(JSON.stringify(G.bundle.entries).includes(MARK), 'AnnotationBundle carries the payload');
  assert.ok(JSON.stringify(AWB.validateBundle(G.bundle).bundle.entries).includes(MARK), 'workbench-loaded bundle can display it');

  // absent everywhere past the boundary
  const downstream = {
    'workbench export': G.exportObj,
    'GroundTruthDataset': G.dataset,
    'semantic GT observations': G.dataset.semanticGroundTruthObservations,
    'semantic surface observations': G.semanticSurfaceObs,
    'combined beard surface': G.combinedSurface,
    'BS1-E report': G.report,
    'BS1-E predictions': G.predictions
  };
  for (const [name, obj] of Object.entries(downstream)) {
    assert.ok(!JSON.stringify(obj).includes(MARK), name + ' must not carry the raw-image marker');
  }
  for (const s of [
    evaluationDiagnosticString(G.report),
    groundTruthDatasetDiagnosticString(G.dataset),
    annotationBundleDiagnosticString(G.bundle)
  ]) {
    assert.equal(typeof s, 'string');
    assert.ok(!s.includes(MARK));
    assert.ok(!s.includes('base64'));
    assert.ok(!s.includes('data:image'));
  }
});

// ===========================================================================
// PART 14 — identity round-trip: A6 fixture -> ... -> BS1-E, unchanged
// ===========================================================================
test('PART14: exact keyframe identity is byte-for-byte stable across every hop', () => {
  const obs = G.scanPackage.posePackages['front'].retainedImageObservations[0];
  const id = {
    sourceScanObservationId: obs.observationId,
    imageRef: obs.imageRef.ref,
    nativeFrameTimestampNs: obs.timestamp.nativeFrameTimestampNs,
    poseId: obs.poseId
  };

  const hops = {
    'manifest row': G.manifest.find(r => r.sourceScanObservationId === id.sourceScanObservationId),
    'bundle entry': G.bundle.entries.find(e => e.sourceScanObservationId === id.sourceScanObservationId),
    'workbench label': G.exportObj.labels.find(l => l.sourceScanObservationId === id.sourceScanObservationId && l.anatomicalRegion === 'LEFT_JAW'),
    'accepted GT label': G.dataset.acceptedLabels.find(l => l.sourceScanObservationId === id.sourceScanObservationId && l.anatomicalRegion === 'LEFT_JAW'),
    'BS1-E scored entry': G.evalEntries.scoredEntries.find(e => e.sourceScanObservationId === id.sourceScanObservationId && e.anatomicalRegion === 'LEFT_JAW'),
    'BS1-E prediction': G.predictions.find(p => p.sourceScanObservationId === id.sourceScanObservationId && p.anatomicalRegion === 'LEFT_JAW')
  };
  for (const [name, x] of Object.entries(hops)) {
    assert.ok(x, name + ' exists');
    assert.equal(x.sourceScanObservationId, id.sourceScanObservationId, name + ' obsId');
    assert.equal(x.imageRef, id.imageRef, name + ' imageRef');
    assert.equal(x.nativeFrameTimestampNs, id.nativeFrameTimestampNs, name + ' timestamp');
    assert.equal(x.poseId, id.poseId, name + ' poseId');
  }
  assert.equal(hops['BS1-E scored entry'].syncStatus, SyncStatus.EXACT_SYNCHRONIZED);
});

// ===========================================================================
// PART 16 — fail-closed: a tampered GT label is excluded end to end
// ===========================================================================
test('PART16: a GT label with a conflicting timestamp is rejected by BS1-F and never scored by BS1-E', () => {
  const good = G.exportObj.labels.find(l => l.annotationStatus === 'LABELED' && l.anatomicalRegion === 'LEFT_JAW');
  const tampered = makeGroundTruthLabel({ ...good, nativeFrameTimestampNs: good.nativeFrameTimestampNs + 987654 });

  const ds = assembleGroundTruthDataset(G.scanPackage, [tampered]);
  assert.equal(ds.acceptedLabels.length, 0);
  assert.equal(ds.rejectedLabels.length, 1);
  assert.equal(ds.rejectedLabels[0].reason, 'IDENTITY_CONFLICT');
  assert.equal(ds.semanticGroundTruthObservations.length, 0);

  const entries = groundTruthDatasetToEvaluationEntries(ds);
  assert.equal(entries.scoredEntries.length, 0);

  const r = evaluateSemanticProducer([{
    sourceScanObservationId: good.sourceScanObservationId, anatomicalRegion: good.anatomicalRegion,
    hairState: HairState.BEARD_CONFIRMED, poseId: good.poseId, syncStatus: SyncStatus.EXACT_SYNCHRONIZED
  }], entries.scoredEntries);
  assert.equal(r.matchingSummary.matchedPairs, 0);
  assert.equal(r.matchingSummary.predictionsWithoutGroundTruth, 1);
});

// ===========================================================================
// PART 17 — stripRawImages: payload gone, identity kept, not renderable
// ===========================================================================
test('PART17: stripRawImages removes every payload but preserves identity and marks non-renderable', () => {
  const stripped = stripRawImages(G.bundle);
  assert.equal(stripped.noPixelManifest, true);
  assert.ok(!JSON.stringify(stripped).includes(MARK));
  assert.ok(stripped.entries.every(e => e.rawImagePayload === null && e.rawImagePayloadStripped === true));

  for (let i = 0; i < stripped.entries.length; i++) {
    assert.equal(stripped.entries[i].sourceScanObservationId, G.bundle.entries[i].sourceScanObservationId);
    assert.equal(stripped.entries[i].imageRef, G.bundle.entries[i].imageRef);
    assert.equal(stripped.entries[i].nativeFrameTimestampNs, G.bundle.entries[i].nativeFrameTimestampNs);
  }
  assert.equal(AWB.imageRenderable(G.bundle.entries[0]), true);
  assert.equal(AWB.imageRenderable(stripped.entries[0]), false);
});

// ===========================================================================
// PART 18 — determinism: repeat the whole pipeline, compare the data sections
// ===========================================================================
test('PART18: the whole golden pipeline is deterministic across repeat runs', () => {
  const a = runGoldenPipeline();
  const b = runGoldenPipeline();

  const digest = (X) => ({
    poses: Object.keys(X.scanPackage.posePackages).sort(),
    frontGeom: X.scanPackage.posePackages['front'].retainedGeometryObservations.length,
    frontImg: X.scanPackage.posePackages['front'].retainedImageObservations.length,
    r45Geom: X.scanPackage.posePackages['right-45'].retainedGeometryObservations.length,
    surfaceObs: X.projection.surfaceObservations.length,
    surfaceRegions: Object.keys(X.projection.personalizedBeardSurface.regions).sort(),
    manifestLen: X.manifest.length,
    bundleEntries: X.bundle.entries.length,
    exportLabels: X.exportObj.labels.length,
    accepted: X.dataset.acceptedLabels.length,
    needsReview: X.dataset.needsReviewLabels.length,
    rejected: X.dataset.rejectedLabels.length,
    semGT: X.dataset.semanticGroundTruthObservations.length,
    scored: X.evalEntries.scoredEntries.length,
    combined: Object.fromEntries(Object.entries(X.combinedSurface.regions).map(([k, v]) => [k, v.hairState])),
    report: X.report
  });

  assert.deepEqual(digest(a), digest(b));
  assert.deepEqual(a.report, G.report);
});
