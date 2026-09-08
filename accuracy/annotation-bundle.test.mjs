// Stage BS1-G — pure unit tests for the portable local annotation bundle.
// Node built-in runner (node --test). Zero dependencies. Tiny synthetic payloads only.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HairState, ObservationMethod } from './beard-surface-core.mjs';
import { SyncStatus } from './multi-observation-scan-package.mjs';
import { ImageResolveStatus } from './semantic-image-evidence.mjs';
import { fromA60Export } from './a6-scan-package-adapter.mjs';
import { buildAnnotationManifest, makeGroundTruthLabel, assembleGroundTruthDataset, groundTruthDatasetToEvaluationEntries } from './ground-truth-dataset.mjs';
import { evaluateSemanticProducer } from './semantic-evaluation.mjs';
import {
  ANNOTATION_BUNDLE_VERSION, RawImageStorageScope, RawImageFormat, EntryOutcome, BundleImageStatus,
  ANNOTATION_WORKBENCH_BOUNDARY,
  buildAnnotationBundle, stripRawImages, serializeAnnotationBundle, deserializeAnnotationBundle,
  annotationBundleDiagnosticString, groundTruthLabelTemplateForEntry, imageResolverKeyForRow
} from './annotation-bundle.mjs';

// ---- fixtures ----
const PAYLOAD = 'data:image/jpeg;base64,QUJDQUJDQUJDQUJD'; // tiny synthetic
const row = (o = {}) => ({
  sourceScanObservationId: 'o1', imageRef: 'a60:front:img:0:ts100', nativeFrameTimestampNs: 100,
  scanSessionId: 'sess-1', poseId: 'front', observedPoseRegion: 'FRONT_REGION',
  yawDeg: 0.5, pitchDeg: -0.2, rollDeg: 0.1, syncStatus: SyncStatus.EXACT_SYNCHRONIZED,
  imageWidth: 640, imageHeight: 480, sourceTier: 'TIER_B_IMAGE_KEYFRAME',
  supportedGeometryRegions: ['CHIN_CENTER', 'LEFT_JAW'], regionsToAnnotate: ['LEFT_JAW', 'CHIN_CENTER'],
  ...o
});
const okResolver = (extra = {}) => (key) => ({
  status: ImageResolveStatus.RESOLVED, payload: PAYLOAD, format: RawImageFormat.DATA_URL,
  width: 640, height: 480, rotationDegrees: 90, mirrored: false,
  intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240, imageWidth: 640, imageHeight: 480, space: 'IMAGE' },
  coherenceStatus: 'VERIFIED_EXACT', landmarkCount: 468,
  imageRef: key.imageRef, nativeFrameTimestampNs: key.nativeFrameTimestampNs, poseId: key.poseId, scanSessionId: key.scanSessionId,
  ...extra
});

// 1 — Exact manifest row + matching image resolves into a bundle entry.
test('exact manifest row + matching image resolves into a bundle entry', () => {
  const b = buildAnnotationBundle([row()], okResolver());
  assert.equal(b.entries.length, 1);
  assert.equal(b.entries[0].outcome, EntryOutcome.RESOLVED);
  assert.equal(b.entries[0].rawImagePayload, PAYLOAD);
  assert.equal(b.entries[0].sourceScanObservationId, 'o1');
  assert.equal(b.rawImageStorageScope, RawImageStorageScope.LOCAL_ANNOTATION_BUNDLE);
});

// 2 — Unknown image returns a missing result.
test('NOT_FOUND image is reported as missing', () => {
  const b = buildAnnotationBundle([row()], () => ({ status: ImageResolveStatus.NOT_FOUND, reason: 'gone' }));
  assert.equal(b.entries.length, 0);
  assert.equal(b.missingEntries.length, 1);
  assert.equal(b.missingEntries[0].outcome, EntryOutcome.MISSING_NOT_FOUND);
  assert.equal(b.missingEntries[0].rawImagePayload, null);
});

// 3 & 4 — EXPIRED / INVALID reported.
test('EXPIRED and INVALID images are reported distinctly', () => {
  assert.equal(buildAnnotationBundle([row()], () => ({ status: ImageResolveStatus.EXPIRED })).missingEntries[0].outcome, EntryOutcome.MISSING_EXPIRED);
  assert.equal(buildAnnotationBundle([row()], () => ({ status: ImageResolveStatus.INVALID })).missingEntries[0].outcome, EntryOutcome.MISSING_INVALID);
  assert.equal(buildAnnotationBundle([row()], () => { throw new Error('x'); }).missingEntries[0].outcome, EntryOutcome.MISSING_INVALID);
});

// 5 & 6 — requireAllImages behavior.
test('requireAllImages true marks the bundle not-ok; false keeps resolved entries', () => {
  const rows = [row({ sourceScanObservationId: 'a', imageRef: 'ra' }), row({ sourceScanObservationId: 'b', imageRef: 'rb' })];
  const resolver = (key) => key.sourceScanObservationId === 'a' ? okResolver()(key) : ({ status: ImageResolveStatus.NOT_FOUND });
  const strict = buildAnnotationBundle(rows, resolver, { requireAllImages: true });
  assert.equal(strict.buildOk, false);
  assert.equal(strict.complete, false);
  assert.equal(strict.entries.length, 1);
  assert.equal(strict.missingEntries.length, 1);
  const lax = buildAnnotationBundle(rows, resolver, { requireAllImages: false });
  assert.equal(lax.buildOk, true);
  assert.equal(lax.entries.length, 1);
  assert.equal(lax.missingEntries.length, 1); // still reported, never a blank image
});

// 7 & 8 — sync preserved; weak sync never upgraded.
test('sync status is carried from the manifest row and never upgraded', () => {
  const b = buildAnnotationBundle([row({ syncStatus: SyncStatus.NEAR_SYNCHRONIZED })], okResolver());
  assert.equal(b.entries[0].syncStatus, SyncStatus.NEAR_SYNCHRONIZED);
  // a resolver that "claims" EXACT cannot change the entry's sync
  const b2 = buildAnnotationBundle([row({ syncStatus: SyncStatus.UNPAIRED })], okResolver({ coherenceStatus: 'VERIFIED_EXACT' }));
  assert.equal(b2.entries[0].syncStatus, SyncStatus.UNPAIRED);
});

// 9 — requireExactSync excludes weaker entries.
test('requireExactSync rejects non-EXACT rows and reports them', () => {
  const b = buildAnnotationBundle([row({ syncStatus: SyncStatus.NEAR_SYNCHRONIZED })], okResolver(), { requireExactSync: true });
  assert.equal(b.entries.length, 0);
  assert.equal(b.rejectedEntries[0].outcome, EntryOutcome.REJECTED_SYNC_BELOW_EXACT);
});

// 10 — one image can request multiple regions.
test('one image entry can request multiple regions', () => {
  const b = buildAnnotationBundle([row({ regionsToAnnotate: ['RIGHT_JAW', 'RIGHT_LOWER_CHEEK', 'CHIN_CENTER'] })], okResolver());
  assert.deepEqual(b.entries[0].regionsToAnnotate, ['RIGHT_JAW', 'RIGHT_LOWER_CHEEK', 'CHIN_CENTER']);
});

// 11 — raw dataUrl/base64 survives serialization exactly.
test('raw payload survives serialize/deserialize byte-for-byte', () => {
  const b = buildAnnotationBundle([row()], okResolver());
  const wire = serializeAnnotationBundle(b);
  assert.equal(wire.entries[0].rawImagePayload, PAYLOAD);
  const back = deserializeAnnotationBundle(JSON.stringify(wire));
  assert.equal(back.entries[0].rawImagePayload, PAYLOAD);
  assert.equal(back.schemaVersion, ANNOTATION_BUNDLE_VERSION);
});

// 12 — raw payload never enters the no-pixel manifest.
test('stripRawImages removes payloads but keeps identity', () => {
  const b = buildAnnotationBundle([row()], okResolver());
  const noPix = stripRawImages(b);
  assert.equal(noPix.entries[0].rawImagePayload, null);
  assert.equal(noPix.entries[0].rawImagePayloadStripped, true);
  assert.equal(noPix.entries[0].sourceScanObservationId, 'o1');
  assert.equal(noPix.entries[0].imageRef, 'a60:front:img:0:ts100');
  assert.equal(noPix.entries[0].rotationDegrees, 90); // metadata retained
  assert.equal(noPix.noPixelManifest, true);
  assert.equal(JSON.stringify(noPix).includes('QUJD'), false);
});

// 13 — diagnostic string contains no raw payload.
test('diagnostic string never contains base64 / dataUrl / raw payload', () => {
  const b = buildAnnotationBundle([row(), row({ sourceScanObservationId: 'o2', imageRef: 'r2', poseId: 'right-45' })], okResolver());
  const s = annotationBundleDiagnosticString(b);
  assert.equal(typeof s, 'string');
  assert.match(s, /Mettle Annotation Bundle/);
  for (const bad of ['QUJD', 'base64', 'data:image', PAYLOAD]) assert.equal(s.includes(bad), false);
});

// 14 — foreign schema rejected.
test('deserialize rejects a foreign schemaVersion', () => {
  const b = serializeAnnotationBundle(buildAnnotationBundle([row()], okResolver()));
  assert.throws(() => deserializeAnnotationBundle(JSON.stringify({ ...b, schemaVersion: 'annotation-bundle/999' })), /unsupported schemaVersion/);
});

// 15 & 16 — invalid pose / sync rejected.
test('invalid pose and invalid sync rows are rejected with a precise outcome', () => {
  assert.equal(buildAnnotationBundle([row({ poseId: 'top-down' })], okResolver()).rejectedEntries[0].outcome, EntryOutcome.REJECTED_UNKNOWN_POSE);
  assert.equal(buildAnnotationBundle([row({ syncStatus: 'SORTA' })], okResolver()).rejectedEntries[0].outcome, EntryOutcome.REJECTED_UNKNOWN_SYNC);
});

// 17, 18, 19 — identity mismatch rejected.
test('resolver identity conflict (imageRef / timestamp / pose) is rejected', () => {
  assert.equal(buildAnnotationBundle([row()], okResolver({ imageRef: 'different-ref' })).rejectedEntries[0].outcomeDetail, 'imageRef');
  assert.equal(buildAnnotationBundle([row()], okResolver({ nativeFrameTimestampNs: 999999 })).rejectedEntries[0].outcomeDetail, 'nativeFrameTimestampNs');
  assert.equal(buildAnnotationBundle([row()], okResolver({ poseId: 'chin-up' })).rejectedEntries[0].outcomeDetail, 'poseId');
  // within an explicit tolerance the timestamp is accepted
  const tol = buildAnnotationBundle([row()], okResolver({ nativeFrameTimestampNs: 105 }), { timestampToleranceNs: 10 });
  assert.equal(tol.entries.length, 1);
});

// 20, 21, 22 — image metadata preserved.
test('rotation, mirroring and intrinsics metadata are preserved from the resolver', () => {
  const b = buildAnnotationBundle([row()], okResolver({ rotationDegrees: 270, mirrored: true }));
  assert.equal(b.entries[0].rotationDegrees, 270);
  assert.equal(b.entries[0].mirrored, true);
  assert.equal(b.entries[0].intrinsics.fx, 500);
  assert.equal(b.entries[0].intrinsics.space, 'IMAGE');
  assert.equal(b.entries[0].coherenceStatus, 'VERIFIED_EXACT');
});

// 23, 24, 25 — summary deterministic.
test('bundle summary and per-pose counts and payload bytes are deterministic', () => {
  const rows = [
    row({ sourceScanObservationId: 'a', imageRef: 'ra', poseId: 'front', regionsToAnnotate: ['LEFT_JAW'] }),
    row({ sourceScanObservationId: 'b', imageRef: 'rb', poseId: 'right-45', regionsToAnnotate: ['RIGHT_JAW', 'CHIN_CENTER'] })
  ];
  const a1 = buildAnnotationBundle(rows, okResolver()).summary;
  const a2 = buildAnnotationBundle(rows, okResolver()).summary;
  assert.deepEqual(a1, a2);
  assert.equal(a1.entryCount, 2);
  assert.equal(a1.perPoseCount.front, 1);
  assert.equal(a1.perPoseCount['right-45'], 1);
  assert.equal(a1.totalRegionsRequested, 3);
  assert.equal(a1.uniqueRegionsRequested, 3);
  assert.equal(a1.rawPayloadBytesApprox, PAYLOAD.length * 2);
});

// 26 & 27 — GT template.
test('groundTruthLabelTemplateForEntry preserves identity and claims no HairState', () => {
  const b = buildAnnotationBundle([row()], okResolver());
  const tpl = groundTruthLabelTemplateForEntry(b.entries[0], 'LEFT_JAW');
  assert.equal(tpl.sourceScanObservationId, 'o1');
  assert.equal(tpl.imageRef, 'a60:front:img:0:ts100');
  assert.equal(tpl.nativeFrameTimestampNs, 100);
  assert.equal(tpl.poseId, 'front');
  assert.equal(tpl.scanSessionId, 'sess-1');
  assert.equal(tpl.anatomicalRegion, 'LEFT_JAW');
  assert.equal(tpl.sourceMethod, ObservationMethod.MANUAL_GROUND_TRUTH);
  assert.equal(tpl.hairState, HairState.UNKNOWN);
  assert.equal(tpl.annotationStatus, 'UNKNOWN');
  // a human completes it, then BS1-F consumes it
  const completed = makeGroundTruthLabel({ ...tpl, hairState: HairState.BEARD_CONFIRMED, annotationStatus: 'LABELED' });
  assert.equal(completed.sourceScanObservationId, 'o1');
  assert.equal(completed.hairState, HairState.BEARD_CONFIRMED);
});

// 28 — empty manifest → valid empty bundle.
test('empty annotation manifest yields a valid empty bundle', () => {
  const b = buildAnnotationBundle([], okResolver(), { bundleId: 'b0' });
  assert.equal(b.schemaVersion, ANNOTATION_BUNDLE_VERSION);
  assert.equal(b.entries.length, 0);
  assert.equal(b.summary.entryCount, 0);
  assert.equal(b.complete, true);
  assert.equal(typeof annotationBundleDiagnosticString(b), 'string');
});

// 29 & 30 — BS1-F compatibility + BS1-E reachability.
test('a real BS1-F annotation manifest builds a bundle that round-trips into BS1-F and BS1-E', () => {
  const pkg = fromA60Export((() => {
    const geometryObs = {}, imageKeyframes = {};
    const p = Array.from({ length: 468 }, (_, i) => ({ x: (i % 50) * 0.01, y: Math.floor(i / 50) * 0.01, z: (i % 7) * 0.005 }));
    geometryObs.front = [];
    imageKeyframes.front = [{
      nativeTs: 5000, coherenceStatus: 'VERIFIED_EXACT', dataUrl: 'data:image/jpeg;base64,ZZZ', width: 640, height: 480,
      imageRotationDegrees: 90, imageMirrored: false,
      intrinsics: { fx: 1, fy: 1, cx: 1, cy: 1, imageWidth: 640, imageHeight: 480, space: 'IMAGE' },
      landmarks2D: p, faceLocal3D: p, transformationMatrix: new Array(16).fill(0), imageSpaceViewModelMatrix: new Array(16).fill(0),
      yawDeg: 0, pitchDeg: 0, rollDeg: 0, faceCameraZ: 0.35, captureLatencyMs: 10
    }];
    return { geometryObs, imageKeyframes };
  })()).scanPackage;

  const manifest = buildAnnotationManifest(pkg);
  assert.equal(manifest.length, 1);
  const obsId = manifest[0].sourceScanObservationId;

  const resolver = (key) => ({ status: ImageResolveStatus.RESOLVED, payload: 'data:image/jpeg;base64,ZZZ', format: RawImageFormat.DATA_URL, imageRef: key.imageRef, nativeFrameTimestampNs: key.nativeFrameTimestampNs, poseId: key.poseId });
  const bundle = buildAnnotationBundle(manifest, resolver);
  assert.equal(bundle.entries.length, 1);
  assert.equal(bundle.entries[0].sourceScanObservationId, obsId);

  // simulate a human completing the template, then run the BS1-F → BS1-E path
  const tpl = groundTruthLabelTemplateForEntry(bundle.entries[0], 'LEFT_JAW');
  const label = makeGroundTruthLabel({ ...tpl, hairState: HairState.BEARD_CONFIRMED, annotationStatus: 'LABELED' });
  const ds = assembleGroundTruthDataset(pkg, [label]);
  assert.equal(ds.acceptedLabels.length, 1);
  const entries = groundTruthDatasetToEvaluationEntries(ds);
  const report = evaluateSemanticProducer(
    [{ sourceScanObservationId: obsId, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED, poseId: 'front', syncStatus: SyncStatus.EXACT_SYNCHRONIZED }],
    entries.scoredEntries
  );
  assert.equal(report.overallMetrics.truePositives, 1);
});

// --- supporting ---
test('no resolver supplied → every row is a missing/invalid entry, no throw', () => {
  const b = buildAnnotationBundle([row()], null);
  assert.equal(b.entries.length, 0);
  assert.equal(b.missingEntries.length, 1);
  assert.equal(b.missingEntries[0].outcome, EntryOutcome.MISSING_INVALID);
});

test('imageResolverKeyForRow carries identity only, no pixels', () => {
  const k = imageResolverKeyForRow(row());
  assert.deepEqual(Object.keys(k).sort(), ['imageRef', 'nativeFrameTimestampNs', 'poseId', 'scanSessionId', 'sourceScanObservationId'].sort());
});

test('workbench boundary descriptor is plain data referencing no runtime app code', () => {
  const j = JSON.stringify(ANNOTATION_WORKBENCH_BOUNDARY);
  assert.match(ANNOTATION_WORKBENCH_BOUNDARY.pipeline, /AnnotationBundle.*evaluateSemanticProducer/);
  for (const bad of ['window', 'document', 'BeardTrimAndroid', 'index.html']) assert.equal(j.includes(bad), false);
});

test('resolved-without-payload is treated as missing, never a blank image', () => {
  const b = buildAnnotationBundle([row()], () => ({ status: ImageResolveStatus.RESOLVED, payload: '' }));
  assert.equal(b.entries.length, 0);
  assert.equal(b.missingEntries[0].outcome, EntryOutcome.MISSING_INVALID);
});
