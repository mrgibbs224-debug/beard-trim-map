// Stage BS1-H — pure unit tests for the local annotation workbench data core.
// Node built-in runner (node --test). Zero dependencies. Synthetic fixtures only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import AWB from './annotation-workbench.cjs';
import { HairState } from '../../accuracy/beard-surface-core.mjs';
import { SyncStatus } from '../../accuracy/multi-observation-scan-package.mjs';
import { fromA60Export } from '../../accuracy/a6-scan-package-adapter.mjs';
import { buildAnnotationManifest, makeGroundTruthLabel, assembleGroundTruthDataset, groundTruthDatasetToEvaluationEntries } from '../../accuracy/ground-truth-dataset.mjs';
import { evaluateSemanticProducer } from '../../accuracy/semantic-evaluation.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'synthetic-bundle.json'), 'utf8'));

const bundle = () => JSON.parse(JSON.stringify(FIXTURE));
const entryOf = (b, i) => b.entries[i];

// 1 — Valid AnnotationBundle loads.
test('a valid AnnotationBundle passes validation', () => {
  const v = AWB.validateBundle(bundle());
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
  assert.equal(v.bundle.entries.length, 2);
});

// 2 — Foreign schema rejected.
test('a foreign schemaVersion is rejected, not repaired', () => {
  const v = AWB.validateBundle({ ...bundle(), schemaVersion: 'annotation-bundle/999' });
  assert.equal(v.ok, false);
  assert.equal(v.bundle, null);
  assert.match(v.errors[0], /unsupported schemaVersion/);
});

// 3 — Missing raw image clearly reported.
test('an entry without a raw image payload is not renderable', () => {
  const b = bundle();
  b.entries[1].rawImagePayload = null;
  assert.equal(AWB.imageRenderable(b.entries[0]), true);
  assert.equal(AWB.imageRenderable(b.entries[1]), false);
});

// 4 & 5 — rotation/mirroring map to a display transform (no image edit).
test('rotation and mirroring metadata map to a CSS display transform', () => {
  assert.deepEqual(AWB.displayTransform({ rotationDegrees: 90, mirrored: false }), { rotateDeg: 90, mirrored: false, css: 'rotate(90deg)' });
  assert.deepEqual(AWB.displayTransform({ rotationDegrees: 270, mirrored: true }), { rotateDeg: 270, mirrored: true, css: 'scaleX(-1) rotate(270deg)' });
  assert.equal(AWB.displayTransform({}).css, 'rotate(0deg)');
});

// 6 — Multiple regions render for one image.
test('one entry carries multiple regions to annotate', () => {
  const b = bundle();
  assert.ok(entryOf(b, 0).regionsToAnnotate.length >= 2);
  const st = AWB.initAnnotationState(b);
  assert.equal(Object.keys(st.byEntry[entryOf(b, 0).sourceScanObservationId]).length, entryOf(b, 0).regionsToAnnotate.length);
});

// 7 & 8 — defaults are UNKNOWN / UNKNOWN, never NON_BEARD.
test('every unannotated region defaults to HairState.UNKNOWN + AnnotationStatus.UNKNOWN', () => {
  const d = AWB.defaultRegionLabel();
  assert.equal(d.hairState, 'UNKNOWN');
  assert.equal(d.annotationStatus, 'UNKNOWN');
  assert.equal(d.annotationConfidence, null);
  const st = AWB.initAnnotationState(bundle());
  for (const obs of Object.values(st.byEntry)) for (const l of Object.values(obs)) {
    assert.equal(l.hairState, 'UNKNOWN');
    assert.notEqual(l.hairState, 'NON_BEARD_CONFIRMED');
  }
});

// 9–14 — canonical HairState / AnnotationStatus values are preserved.
test('selected HairState and AnnotationStatus values are stored canonically', () => {
  const b = bundle();
  const id = entryOf(b, 0).sourceScanObservationId;
  const r = entryOf(b, 0).regionsToAnnotate[0];
  let st = AWB.initAnnotationState(b);
  for (const hs of ['BEARD_CONFIRMED', 'NON_BEARD_CONFIRMED', 'BOUNDARY', 'UNCERTAIN', 'UNKNOWN']) {
    st = AWB.setRegionLabel(st, id, r, { hairState: hs });
    assert.equal(st.byEntry[id][r].hairState, hs);
  }
  for (const as of ['LABELED', 'AMBIGUOUS', 'NEEDS_REVIEW', 'EXCLUDED', 'UNKNOWN']) {
    st = AWB.setRegionLabel(st, id, r, { annotationStatus: as });
    assert.equal(st.byEntry[id][r].annotationStatus, as);
  }
  assert.throws(() => AWB.setRegionLabel(st, id, r, { hairState: 'MAYBE' }), /invalid hairState/);
  assert.throws(() => AWB.setRegionLabel(st, id, r, { annotationStatus: 'YES' }), /invalid annotationStatus/);
});

// 15 & 16 — annotationConfidence null preserved / bounded.
test('annotationConfidence: blank stays null, out-of-range clamps', () => {
  assert.equal(AWB.clampConfidence(''), null);
  assert.equal(AWB.clampConfidence(null), null);
  assert.equal(AWB.clampConfidence(5), 1);
  assert.equal(AWB.clampConfidence(-2), 0);
  assert.equal(AWB.clampConfidence('0.4'), 0.4);
});

// 17 — Next/Previous navigation deterministic + clamped.
test('navigate clamps to [0, total-1] deterministically', () => {
  let st = AWB.initAnnotationState(bundle());
  st = AWB.navigate(st, -1, 2); assert.equal(st.position, 0);
  st = AWB.navigate(st, 1, 2); assert.equal(st.position, 1);
  st = AWB.navigate(st, 5, 2); assert.equal(st.position, 1);
});

// 18 — Progress counts deterministic; "completed" = all requested regions non-UNKNOWN status.
test('progress counts are deterministic and completed requires non-UNKNOWN status on every region', () => {
  const b = bundle();
  const e0 = entryOf(b, 0), id0 = e0.sourceScanObservationId;
  let st = AWB.initAnnotationState(b);
  let p = AWB.progressCounts(b, st);
  assert.equal(p.imagesCompleted, 0);
  assert.equal(p.regionsLabeled, 0);
  // label all of entry 0's regions LABELED
  for (const r of e0.regionsToAnnotate) st = AWB.setRegionLabel(st, id0, r, { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  p = AWB.progressCounts(b, st);
  assert.equal(p.imagesCompleted, 1);
  assert.equal(p.regionsLabeled, e0.regionsToAnnotate.length);
  assert.deepEqual(AWB.progressCounts(b, st), AWB.progressCounts(b, st));
});

// 19 — Autosave excludes rawImagePayload.
test('autosave payload contains labels/progress but NO raw image pixels', () => {
  const b = bundle();
  const st = AWB.initAnnotationState(b);
  const save = AWB.buildAutosavePayload(b, st);
  const json = JSON.stringify(save);
  for (const bad of ['rawImagePayload', 'base64', 'data:image', 'iVBOR']) assert.equal(json.includes(bad), false);
  assert.equal(save.bundleFingerprint, AWB.bundleFingerprint(b));
  assert.ok(Array.isArray(save.bundleIdentity.entryIds));
});

// 20 & 21 — restore requires a matching fingerprint; wrong bundle fails closed.
test('autosave restore reattaches on a matching fingerprint and fails closed otherwise', () => {
  const b = bundle();
  const e0 = entryOf(b, 0), id0 = e0.sourceScanObservationId, r0 = e0.regionsToAnnotate[0];
  let st = AWB.setRegionLabel(AWB.initAnnotationState(b), id0, r0, { hairState: 'BOUNDARY', annotationStatus: 'LABELED' });
  const save = AWB.buildAutosavePayload(b, st);

  const good = AWB.restoreFromAutosave(save, b);
  assert.equal(good.ok, true);
  assert.equal(good.state.byEntry[id0][r0].hairState, 'BOUNDARY');

  const otherBundle = bundle();
  otherBundle.bundleId = 'a-different-bundle';
  const bad = AWB.restoreFromAutosave(save, otherBundle);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'FINGERPRINT_MISMATCH');
  assert.equal(bad.state, null);
});

// 22 & 23 & 24 — export: no image payload, identity equals source, MANUAL_GROUND_TRUTH.
test('export preserves identity, uses MANUAL_GROUND_TRUTH, and carries no raw image', () => {
  const b = bundle();
  const e0 = entryOf(b, 0), id0 = e0.sourceScanObservationId;
  let st = AWB.initAnnotationState(b);
  st = AWB.setRegionLabel(st, id0, e0.regionsToAnnotate[0], { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED', annotationConfidence: 0.9 });
  const exp = AWB.buildExport(b, st);
  const json = JSON.stringify(exp);
  for (const bad of ['rawImagePayload', 'base64', 'data:image', 'iVBOR']) assert.equal(json.includes(bad), false);
  const l = exp.labels.find(x => x.sourceScanObservationId === id0 && x.anatomicalRegion === e0.regionsToAnnotate[0]);
  assert.equal(l.imageRef, e0.imageRef);
  assert.equal(l.nativeFrameTimestampNs, e0.nativeFrameTimestampNs);
  assert.equal(l.poseId, e0.poseId);
  assert.equal(l.syncStatus, e0.syncStatus);
  assert.equal(l.sourceMethod, AWB.MANUAL_GROUND_TRUTH);
  assert.equal(l.hairState, 'BEARD_CONFIRMED');
  assert.equal(AWB.validateExport(exp, b).ok, true);
});

// 25 — Unfinished UNKNOWN labels export without becoming NON_BEARD.
test('unfinished regions export as UNKNOWN / UNKNOWN, never NON_BEARD, and are not discarded', () => {
  const b = bundle();
  const exp = AWB.buildExport(b, AWB.initAnnotationState(b));
  const totalRequested = b.entries.reduce((n, e) => n + e.regionsToAnnotate.length, 0);
  assert.equal(exp.labels.length, totalRequested);
  assert.ok(exp.labels.every(l => l.hairState === 'UNKNOWN' && l.annotationStatus === 'UNKNOWN'));
  assert.equal(exp.summary.unknown, totalRequested);
});

// 26 — progress/diagnostic text has no raw payload (covered structurally; assert on JSON).
test('progress + autosave JSON never expose a payload', () => {
  const b = bundle();
  const st = AWB.initAnnotationState(b);
  assert.equal(JSON.stringify(AWB.progressCounts(b, st)).includes('data:image'), false);
});

// 27 — synthetic fixture is clearly marked.
test('the development fixture is clearly marked synthetic / not user data', () => {
  assert.match(JSON.stringify(FIXTURE._SYNTHETIC || FIXTURE.metadata || ''), /SYNTHETIC|NOT USER DATA/i);
  assert.equal(FIXTURE.schemaVersion, 'annotation-bundle/1');
});

// 28 & 29 — BS1-F can consume exported labels; BS1-E is reachable through BS1-F.
test('exported labels flow through BS1-F assembleGroundTruthDataset into BS1-E', () => {
  // real BS1-C/BS1-F scan package + its annotation manifest
  const p = Array.from({ length: 468 }, (_, i) => ({ x: (i % 50) * 0.01, y: Math.floor(i / 50) * 0.01, z: (i % 7) * 0.005 }));
  const pkg = fromA60Export({
    geometryObs: { front: [] },
    imageKeyframes: {
      front: [{
        nativeTs: 9000, coherenceStatus: 'VERIFIED_EXACT', dataUrl: 'data:image/png;base64,ZZZ', width: 64, height: 48,
        imageRotationDegrees: 90, imageMirrored: false,
        intrinsics: { fx: 1, fy: 1, cx: 1, cy: 1, imageWidth: 64, imageHeight: 48, space: 'IMAGE' },
        landmarks2D: p, faceLocal3D: p, transformationMatrix: new Array(16).fill(0), imageSpaceViewModelMatrix: new Array(16).fill(0),
        yawDeg: 0, pitchDeg: 0, rollDeg: 0, faceCameraZ: 0.35, captureLatencyMs: 10
      }]
    }
  }).scanPackage;
  const manifestRows = buildAnnotationManifest(pkg);
  const obsId = manifestRows[0].sourceScanObservationId;

  // a minimal AnnotationBundle the workbench would have loaded (BS1-G shape)
  const wbBundle = {
    schemaVersion: 'annotation-bundle/1', bundleId: 'wb-1', datasetId: 'ds-1', datasetRevision: 1,
    entries: [{
      sourceScanObservationId: obsId, imageRef: manifestRows[0].imageRef,
      nativeFrameTimestampNs: manifestRows[0].nativeFrameTimestampNs, scanSessionId: manifestRows[0].scanSessionId,
      poseId: 'front', observedPoseRegion: manifestRows[0].observedPoseRegion,
      syncStatus: manifestRows[0].syncStatus, rawImagePayload: 'data:image/png;base64,ZZZ',
      regionsToAnnotate: ['LEFT_JAW', 'CHIN_CENTER']
    }]
  };
  const v = AWB.validateBundle(wbBundle);
  assert.equal(v.ok, true);

  let st = AWB.initAnnotationState(wbBundle);
  st = AWB.setRegionLabel(st, obsId, 'LEFT_JAW', { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  st = AWB.setRegionLabel(st, obsId, 'CHIN_CENTER', { hairState: 'UNKNOWN', annotationStatus: 'NEEDS_REVIEW' });
  const exp = AWB.buildExport(wbBundle, st);

  const labels = AWB.groundTruthLabelsForBS1F(exp).map(makeGroundTruthLabel);
  const ds = assembleGroundTruthDataset(pkg, labels);
  assert.equal(ds.acceptedLabels.length, 1);       // only the LABELED LEFT_JAW label
  assert.equal(ds.needsReviewLabels.length, 1);     // CHIN_CENTER NEEDS_REVIEW is fail-closed
  const evalEntries = groundTruthDatasetToEvaluationEntries(ds);
  const report = evaluateSemanticProducer(
    [{ sourceScanObservationId: obsId, anatomicalRegion: 'LEFT_JAW', hairState: HairState.BEARD_CONFIRMED, poseId: 'front', syncStatus: SyncStatus.EXACT_SYNCHRONIZED }],
    evalEntries.scoredEntries
  );
  assert.equal(report.overallMetrics.truePositives, 1);
});
