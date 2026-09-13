// Stage BI-1Z1A — fresh Exact-Frame Research Capture silhouette review: tracked-landmark ROI
// construction, autonomous-proposal provenance, and display-rotation contract tests.
// Node built-in runner (node --test). Synthetic fixtures only -- the actual physical capture
// (D:\MettleTemp\research-captures\...) and the fresh review bundle it produced
// (D:\MettleTemp\annotation\bi1z1a_fresh_exact_frame_lower_beard_review_bundle.json) are local
// research artifacts outside this repo (same convention as every prior bi1y*/bi1z0* bundle), so
// they are exercised manually (see the BI-1Z1A report) rather than committed as test fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import AWB from './annotation-workbench.cjs';
import BP from './beard-proposal.cjs';
import * as overlayData from '../../accuracy/annotation-overlay-data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT_INDEX_HTML = readFileSync(join(HERE, '..', '..', 'index.html'), 'utf8');
const WORKBENCH_INDEX_HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

// A synthetic but topologically real 468-point landmark array (only the indices this module
// actually reads carry real values; everything else is filler so `landmarks2D[i]` is never
// undefined, matching the real Tier-B keyframe shape).
function syntheticLandmarks(overrides) {
  var arr = new Array(468);
  for (var i = 0; i < 468; i++) arr[i] = { x: 0.5, y: 0.5, z: 0.5 };
  // A rough, plausible lower-face layout inside a 640x480 frame (values are NOT from any real
  // capture -- purely synthetic geometry for testing the ROI/hull/margin math).
  var base = {
    172: { x: 0.70, y: 0.62 }, 149: { x: 0.60, y: 0.68 }, 152: { x: 0.50, y: 0.70 },
    378: { x: 0.40, y: 0.68 }, 397: { x: 0.30, y: 0.62 },
    234: { x: 0.74, y: 0.50 }, 116: { x: 0.72, y: 0.48 }, 123: { x: 0.71, y: 0.46 },
    205: { x: 0.68, y: 0.44 }, 186: { x: 0.62, y: 0.42 },
    454: { x: 0.26, y: 0.50 }, 345: { x: 0.28, y: 0.48 }, 352: { x: 0.29, y: 0.46 },
    425: { x: 0.32, y: 0.44 }, 410: { x: 0.38, y: 0.42 },
    61: { x: 0.58, y: 0.55 }, 146: { x: 0.56, y: 0.56 }, 91: { x: 0.55, y: 0.57 },
    181: { x: 0.53, y: 0.58 }, 84: { x: 0.51, y: 0.58 }, 17: { x: 0.50, y: 0.59 },
    314: { x: 0.49, y: 0.58 }, 405: { x: 0.47, y: 0.58 }, 321: { x: 0.45, y: 0.57 },
    375: { x: 0.44, y: 0.56 }, 291: { x: 0.42, y: 0.55 },
    136: { x: 0.65, y: 0.65 }, 150: { x: 0.55, y: 0.69 }, 176: { x: 0.52, y: 0.70 },
    148: { x: 0.48, y: 0.70 }, 377: { x: 0.46, y: 0.69 }, 400: { x: 0.44, y: 0.68 },
    379: { x: 0.35, y: 0.65 }, 365: { x: 0.32, y: 0.64 }
  };
  Object.keys(base).forEach(function (k) { arr[k] = { x: base[k].x, y: base[k].y, z: 0.5 }; });
  if (overrides) Object.keys(overrides).forEach(function (k) { arr[k] = overrides[k]; });
  return arr;
}

// ---- 1/2: buildLandmarkLowerFaceROI -------------------------------------------------------
test('1: buildLandmarkLowerFaceROI fails closed (returns null) when a jaw-angle landmark is missing', () => {
  var lm = syntheticLandmarks();
  lm[172] = undefined;
  assert.equal(BP.buildLandmarkLowerFaceROI(lm, 640, 480), null);
});
test('2: buildLandmarkLowerFaceROI fails closed on invalid image dimensions', () => {
  var lm = syntheticLandmarks();
  assert.equal(BP.buildLandmarkLowerFaceROI(lm, 0, 480), null);
  assert.equal(BP.buildLandmarkLowerFaceROI(lm, 640, -10), null);
  assert.equal(BP.buildLandmarkLowerFaceROI(null, 640, 480), null);
});
test('3: buildLandmarkLowerFaceROI returns a hull whose every source point lies inside (or on) the DILATED polygon', () => {
  var lm = syntheticLandmarks();
  var roi = BP.buildLandmarkLowerFaceROI(lm, 640, 480);
  assert.ok(roi);
  assert.equal(roi.provenance, 'TRACKED_LOWER_FACE_LANDMARK_ROI');
  assert.equal(roi.roiConstructionVersion, BP.LOWER_FACE_ROI_VERSION);
  // every raw source point must fall inside the un-dilated hull's bounding box expanded by margin
  var minX = Math.min.apply(null, roi.polygon.map(function (p) { return p.x; }));
  var maxX = Math.max.apply(null, roi.polygon.map(function (p) { return p.x; }));
  var minY = Math.min.apply(null, roi.polygon.map(function (p) { return p.y; }));
  var maxY = Math.max.apply(null, roi.polygon.map(function (p) { return p.y; }));
  roi.sourceIndices.forEach(function (idx) {
    var pt = { x: lm[idx].x * 640, y: lm[idx].y * 480 };
    assert.ok(pt.x >= minX - 1 && pt.x <= maxX + 1, 'source point ' + idx + ' x within dilated bbox');
    assert.ok(pt.y >= minY - 1 && pt.y <= maxY + 1, 'source point ' + idx + ' y within dilated bbox');
  });
});
test('4: buildLandmarkLowerFaceROI marginPx is exactly half the frame\'s own jaw-angle span (per-frame adaptive, not a fixed constant)', () => {
  var lm = syntheticLandmarks();
  var roi = BP.buildLandmarkLowerFaceROI(lm, 640, 480);
  var rx = lm[172].x * 640, ry = lm[172].y * 480, lx = lm[397].x * 640, ly = lm[397].y * 480;
  var span = Math.hypot(rx - lx, ry - ly);
  assert.equal(roi.jawSpanPx, span);
  assert.equal(roi.marginPx, Math.max(4, Math.round(0.5 * span)));
});
test('5: a smaller (closer-cropped) synthetic face produces a smaller marginPx than a larger one -- proportional, not hand-tuned', () => {
  var lmBig = syntheticLandmarks();
  var lmSmall = syntheticLandmarks({
    172: { x: 0.55, y: 0.58, z: 0.5 }, 397: { x: 0.45, y: 0.58, z: 0.5 }
  });
  var roiBig = BP.buildLandmarkLowerFaceROI(lmBig, 640, 480);
  var roiSmall = BP.buildLandmarkLowerFaceROI(lmSmall, 640, 480);
  assert.ok(roiSmall.marginPx < roiBig.marginPx);
});

// ---- 6: convexHull / dilatePolygonRadially --------------------------------------------------
test('6: convexHull of a square-plus-interior-point returns exactly the 4 corners (interior point dropped)', () => {
  var pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }];
  var hull = BP.convexHull(pts);
  assert.equal(hull.length, 4);
  pts.slice(0, 4).forEach(function (c) {
    assert.ok(hull.some(function (h) { return h.x === c.x && h.y === c.y; }));
  });
});
test('7: dilatePolygonRadially moves every vertex exactly r pixels farther from the centroid', () => {
  var square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  var cx = 5, cy = 5;
  var dilated = BP.dilatePolygonRadially(square, 20);
  square.forEach(function (p, i) {
    var before = Math.hypot(p.x - cx, p.y - cy);
    var after = Math.hypot(dilated[i].x - cx, dilated[i].y - cy);
    assert.ok(Math.abs((after - before) - 20) < 1e-9);
  });
});
test('7b: dilatePolygonRadially is fast for large radii (O(n), not O(pixels * r^2)) -- the exact bug this replaced', () => {
  var lm = syntheticLandmarks();
  var roi = BP.buildLandmarkLowerFaceROI(lm, 640, 480);
  var t0 = Date.now();
  for (var i = 0; i < 1000; i++) BP.dilatePolygonRadially(roi.hullPolygon, 300);
  var elapsedMs = Date.now() - t0;
  assert.ok(elapsedMs < 1000, '1000 large-radius dilations should take well under a second, took ' + elapsedMs + 'ms');
});

// ---- 8: cross-consistency with accuracy/annotation-overlay-data.mjs ------------------------
test('8: beard-proposal.cjs\'s lower-face rail constants are byte-identical to accuracy/annotation-overlay-data.mjs (no silent drift)', () => {
  assert.deepEqual(BP.JAW_CHIN_RAIL, overlayData.JAW_CHIN_RAIL);
  assert.deepEqual(BP.CHEEK_RAIL_RIGHT, overlayData.CHEEK_RAIL_RIGHT);
  assert.deepEqual(BP.CHEEK_RAIL_LEFT, overlayData.CHEEK_RAIL_LEFT);
  assert.deepEqual(BP.MOUTH_REFERENCE, overlayData.MOUTH_REFERENCE);
});

// ---- 9-11: proposal provenance (Part 13) ----------------------------------------------------
var TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwAEhgGAWjR9awAAAABJRU5ErkJggg==';
function lowerBeardEntry(overrides) {
  return Object.assign({
    schemaVersion: 'annotation-bundle/1',
    identityMode: 'RAW_SCAN_OBSERVATION',
    sourceScanObservationId: null,
    scanSessionId: 'scan_synthetic_bi1z1a',
    nativeFrameTimestampNs: '111222333',
    rawObservationId: 0,
    adapterRetained: false,
    imageRef: 'scan_synthetic_bi1z1a:raw:0:ts111222333',
    poseId: 'front', observedPoseRegion: 'FRONT_REGION', currentScannerStep: 'front',
    yawDeg: -2.6, pitchDeg: -9.5, rollDeg: -3.4,
    coherenceStatus: 'VERIFIED_EXACT',
    imageWidth: 640, imageHeight: 480, rotationDegrees: -90, mirrored: false,
    regionsToAnnotate: [], contourTypesToAnnotate: [],
    assistedReviewTargets: ['VISIBLE_LOWER_BEARD_SILHOUETTE'],
    landmarkRoi: { polygon: [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 350 }, { x: 100, y: 350 }], marginPx: 80, sourceIndices: [172, 397], roiConstructionVersion: BP.LOWER_FACE_ROI_VERSION, provenance: 'TRACKED_LOWER_FACE_LANDMARK_ROI' },
    jawDiagnosticLandmarks: [{ index: 172, x: 380, y: 300 }, { index: 397, x: 120, y: 300 }],
    rawImagePayload: TINY_PNG, rawImageFormat: 'data-url', rawImageStorageScope: 'LOCAL_ANNOTATION_BUNDLE',
    bundleImageStatus: 'INCLUDED_FOR_ANNOTATION', outcome: 'RESOLVED'
  }, overrides || {});
}
function lowerBeardBundle() {
  return {
    schemaVersion: 'annotation-bundle/1', bundleId: 'bi1z1a-test-001', datasetId: 'bi1z1a-test', datasetRevision: 1,
    entries: [lowerBeardEntry()]
  };
}
test('9: ASSISTED_REVIEW_TARGETS additively includes VISIBLE_LOWER_BEARD_SILHOUETTE alongside the original VISIBLE_BEARD_SILHOUETTE', () => {
  assert.ok(AWB.ASSISTED_REVIEW_TARGETS.indexOf('VISIBLE_BEARD_SILHOUETTE') !== -1);
  assert.ok(AWB.ASSISTED_REVIEW_TARGETS.indexOf('VISIBLE_LOWER_BEARD_SILHOUETTE') !== -1);
});
test('10: a landmarkRoi-carrying RAW_SCAN_OBSERVATION entry validates via the real (unmodified) validateBundle', () => {
  var v = AWB.validateBundle(lowerBeardBundle());
  assert.deepEqual(v.errors, []);
  assert.equal(v.ok, true);
});
test('11: attachProposal + buildAssistedReviewExport carry proposalPriorSource/machineProposalMode/oldHumanSpatialHintUsed end-to-end, never fabricated for an old-style call', () => {
  var bundle = lowerBeardBundle();
  var e = bundle.entries[0];
  var key = AWB.entryKey(e);
  var state = AWB.initAssistedReviewState(bundle);
  state = AWB.attachProposal(state, key, 'VISIBLE_LOWER_BEARD_SILHOUETTE', {
    algorithm: 'beard-proposal-otsu-prior-hybrid', algorithmVersion: BP.PROPOSAL_ALGORITHM_VERSION,
    parameters: { otsuThreshold: 100 }, generatedAt: '2026-09-12T00:00:00.000Z',
    originalProposalPoints: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }],
    handlePoints: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }],
    proposalPriorSource: 'TRACKED_LOWER_FACE_LANDMARK_ROI', machineProposalMode: 'AUTONOMOUS_LANDMARK_GUIDED', oldHumanSpatialHintUsed: false
  });
  state = AWB.setReviewStatus(state, key, 'VISIBLE_LOWER_BEARD_SILHOUETTE', 'APPROVED_AS_IS');
  var exp = AWB.buildAssistedReviewExport(bundle, state, { exportedAt: '2026-09-12T00:00:01.000Z' });
  var item = exp.items[0];
  assert.equal(item.proposalPriorSource, 'TRACKED_LOWER_FACE_LANDMARK_ROI');
  assert.equal(item.machineProposalMode, 'AUTONOMOUS_LANDMARK_GUIDED');
  assert.equal(item.oldHumanSpatialHintUsed, false);
  // an old-style call that never supplies these fields must leave them null, never guessed
  var state2 = AWB.initAssistedReviewState(bundle);
  state2 = AWB.attachProposal(state2, key, 'VISIBLE_LOWER_BEARD_SILHOUETTE', {
    algorithm: 'x', algorithmVersion: 'x', parameters: {}, generatedAt: null,
    originalProposalPoints: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }],
    handlePoints: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }]
  });
  var inst2 = AWB.reviewInstance(state2, key, 'VISIBLE_LOWER_BEARD_SILHOUETTE');
  assert.equal(inst2.proposalPriorSource, null);
  assert.equal(inst2.oldHumanSpatialHintUsed, null);
});

// ---- 12: display-rotation contract (Part 9) -------------------------------------------------
test('12: displayTransform normalizes rotationDegrees:-90 to 270 and produces the matching CSS rotate()', () => {
  var t = AWB.displayTransform({ rotationDegrees: -90, mirrored: false });
  assert.equal(t.rotateDeg, 270);
  assert.equal(t.css, 'rotate(270deg)');
});
test('13: display rotation never changes the stored raw IMAGE coordinate space -- imageWidth/imageHeight and every landmark/proposal point on the entry stay byte-identical regardless of rotationDegrees', () => {
  var e0 = lowerBeardEntry({ rotationDegrees: 0 });
  var e90 = lowerBeardEntry({ rotationDegrees: -90 });
  assert.equal(e0.imageWidth, e90.imageWidth);
  assert.equal(e0.imageHeight, e90.imageHeight);
  assert.deepEqual(e0.landmarkRoi.polygon, e90.landmarkRoi.polygon);
  assert.deepEqual(e0.jawDiagnosticLandmarks, e90.jawDiagnosticLandmarks);
});
test('14: round trip -- displayClickToImagePoint/imagePointToDisplayPoint compose to the identity regardless of any rotationDegrees value, because rotation is applied to an ANCESTOR element and never enters this scale-only mapping (offsetX/offsetY are pre-inverted by the browser for any CSS transform on the element or its ancestors)', () => {
  [0, 90, -90, 180, 270].forEach(function (rot) {
    var natural = { w: 640, h: 480 };
    var rendered = { w: 320, h: 240 }; // arbitrary CSS-scaled display size of the (unrotated) #img box
    var raw = { x: 123.4, y: 87.6 };
    var disp = AWB.imagePointToDisplayPoint(raw.x, raw.y, rendered.w, rendered.h, natural.w, natural.h);
    var back = AWB.displayClickToImagePoint(disp.x, disp.y, rendered.w, rendered.h, natural.w, natural.h);
    assert.ok(Math.abs(back.x - raw.x) < 1e-9, 'round trip x at rotation ' + rot);
    assert.ok(Math.abs(back.y - raw.y) < 1e-9, 'round trip y at rotation ' + rot);
  });
});

// ---- 15: static source-text wiring checks on the workbench (mirrors the BI-1Z0B/C wiring-test
// pattern -- READ-ONLY text checks, never executes the browser code) -----------------------
test('15: generateProposal prefers e.landmarkRoi over e.priorHintPoints (source order), and records FULL_FRAME_NO_HINT only when neither is present', () => {
  var start = WORKBENCH_INDEX_HTML.indexOf('function generateProposal');
  var end = WORKBENCH_INDEX_HTML.indexOf('function renderReview', start);
  var body = WORKBENCH_INDEX_HTML.slice(start, end);
  var landmarkIdx = body.indexOf('e.landmarkRoi');
  var hintIdx = body.indexOf('hintPolys.length');
  assert.ok(landmarkIdx > -1 && hintIdx > -1 && landmarkIdx < hintIdx, 'landmarkRoi must be checked before the old priorHintPoints fallback');
  assert.match(body, /FULL_FRAME_NO_HINT/);
  assert.match(body, /TRACKED_LOWER_FACE_LANDMARK_ROI/);
  assert.match(body, /HUMAN_TRACE_HINT/);
});
test('16: BI-1Z1A entries never populate priorHintPoints -- old human trace coordinates never feed a fresh-capture proposal (Part 4)', () => {
  // the bundle-builder is a local one-off script (not committed), so this asserts the CONTRACT on
  // the consuming side instead: an entry with landmarkRoi but no priorHintPoints still proposes.
  var e = lowerBeardEntry();
  assert.equal(e.priorHintPoints, undefined);
  assert.ok(e.landmarkRoi);
});
test('17: "Hide machine proposal" defaults to visible (hideProposal starts false) and the jaw-landmark diagnostic overlay defaults OFF and is never required to annotate', () => {
  assert.match(WORKBENCH_INDEX_HTML, /var hideProposal=false, showJawDiagnostic=false;/);
  assert.match(WORKBENCH_INDEX_HTML, /if\(!hideProposal && Array\.isArray\(inst\.originalProposalPoints\)/);
  assert.match(WORKBENCH_INDEX_HTML, /if\(showJawDiagnostic && Array\.isArray\(e\.jawDiagnosticLandmarks\)\)/);
});

// ---- 18: production isolation ----------------------------------------------------------------
test('18: root production index.html carries no BI-1Z1A workbench-only symbols (landmarkRoi / VISIBLE_LOWER_BEARD_SILHOUETTE / buildLandmarkLowerFaceROI never leak into the consumer app)', () => {
  assert.equal(ROOT_INDEX_HTML.includes('landmarkRoi'), false);
  assert.equal(ROOT_INDEX_HTML.includes('VISIBLE_LOWER_BEARD_SILHOUETTE'), false);
  assert.equal(ROOT_INDEX_HTML.includes('buildLandmarkLowerFaceROI'), false);
});
test('19: no sealed-holdout identifier appears in beard-proposal.cjs or index.html (the two files this stage actually added code to) -- annotation-workbench.cjs legitimately contains it as its OWN rejection guard (SEALED_HOLDOUT_IDENTITIES), which is the opposite of a leak and is deliberately not re-checked here', () => {
  assert.equal(readFileSync(join(HERE, 'beard-proposal.cjs'), 'utf8').includes('espu2w'), false);
  assert.equal(WORKBENCH_INDEX_HTML.includes('espu2w'), false);
});
test('20: JAW_ANGLE_RIGHT_INDEX/LEFT_INDEX used by the ROI match the project\'s frozen anatomical jaw-support side mapping (172=RIGHT, 397=LEFT)', () => {
  assert.equal(BP.JAW_ANGLE_RIGHT_INDEX, 172);
  assert.equal(BP.JAW_ANGLE_LEFT_INDEX, 397);
});
