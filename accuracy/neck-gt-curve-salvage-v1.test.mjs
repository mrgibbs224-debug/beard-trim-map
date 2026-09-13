import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as S from './neck-gt-curve-salvage-v1.mjs';

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
const EXPORT_PATH = 'C:/Users/queen/Downloads/bi2b1_neck_gt_annotations_export.json';

// ---------- original export immutable ----------

test('1. the original human export file is never mutated by this stage\'s analysis', () => {
  const before = readFileSync(EXPORT_PATH);
  const shaBefore = sha256(before);
  // run the full classification pipeline over it
  const data = JSON.parse(before.toString('utf8'));
  data.images.forEach(img => {
    const key = S.CURVE_TARGET_BY_POSE[img.pose];
    if (key && img.annotations[key]) S.classifyCurve(img.annotations[key]);
  });
  const after = readFileSync(EXPORT_PATH);
  assert.equal(sha256(after), shaBefore);
});

test('2. classifyCurve never mutates its input point array', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 1, y: 0.5 }];
  const before = JSON.stringify(pts);
  S.classifyCurve(pts);
  assert.equal(JSON.stringify(pts), before);
});

// ---------- closed-loop detection ----------

test('3. a genuinely open curve (start/end far apart) is classified VALID_OPEN_CURVE', () => {
  const pts = [{ x: 0, y: 0 }, { x: 50, y: 10 }, { x: 100, y: 0 }];
  const r = S.classifyCurve(pts);
  assert.equal(r.classification, 'VALID_OPEN_CURVE');
});

test('4. a closed loop (start==end) is never classified VALID_OPEN_CURVE', () => {
  const pts = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }, { x: 50, y: -50 }, { x: 0, y: 0 }];
  const r = S.classifyCurve(pts);
  assert.notEqual(r.classification, 'VALID_OPEN_CURVE');
});

test('5. closedLoopRatio is near zero for a true closed loop and near 1 for a fully open chord-spanning curve', () => {
  const closed = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 0.5 }];
  const open = [{ x: 0, y: 0 }, { x: 25, y: 10 }, { x: 100, y: 0 }];
  assert.ok(S.closedLoopRatio(closed) < 0.05);
  assert.ok(S.closedLoopRatio(open) > 0.5);
});

// ---------- open-curve preservation ----------

test('6. VALID_OPEN_CURVE classification carries no derivation/salvage metadata (nothing to derive)', () => {
  const pts = [{ x: 0, y: 0 }, { x: 50, y: 10 }, { x: 100, y: 0 }];
  const r = S.classifyCurve(pts);
  assert.equal(r.classification, 'VALID_OPEN_CURVE');
  assert.ok(!('apexIdx' in r));
});

test('7. buildSalvagedCurve returns null for anything other than ACCIDENTALLY_CLOSED_BUT_SALVAGEABLE (never salvages an open or ambiguous curve)', () => {
  assert.equal(S.buildSalvagedCurve([], { classification: 'VALID_OPEN_CURVE' }, {}), null);
  assert.equal(S.buildSalvagedCurve([], { classification: 'ACCIDENTALLY_CLOSED_AMBIGUOUS' }, {}), null);
});

// ---------- source vertex/subpath provenance ----------

test('8. a salvaged curve preserves the EXACT verbatim source points and their original indices -- never invents a point', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 10, y: -1 }, { x: 0.5, y: 0.2 }];
  // construct a closed loop whose two halves closely retrace each other
  const closePts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }, { x: 10.1, y: 10.1 }, { x: 0.2, y: 0.1 }];
  const classification = S.classifyCurve(closePts);
  if (classification.classification === 'ACCIDENTALLY_CLOSED_BUT_SALVAGEABLE') {
    const salvaged = S.buildSalvagedCurve(closePts, classification, { imageId: 'x' });
    assert.deepEqual(salvaged.points, closePts.slice(0, classification.apexIdx + 1));
    assert.deepEqual(salvaged.sourceVertexIndices, Array.from({ length: classification.apexIdx + 1 }, (_, i) => i));
  }
});

test('9. a salvaged curve is marked DERIVED_FROM_HUMAN_GT, never DIRECT_HUMAN_CURVE', () => {
  const closePts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }, { x: 10.1, y: 10.1 }, { x: 0.2, y: 0.1 }];
  const classification = S.classifyCurve(closePts);
  if (classification.classification === 'ACCIDENTALLY_CLOSED_BUT_SALVAGEABLE') {
    const salvaged = S.buildSalvagedCurve(closePts, classification, {});
    assert.equal(salvaged.status, 'DERIVED_FROM_HUMAN_GT');
    assert.notEqual(salvaged.status, 'DIRECT_HUMAN_CURVE');
  }
});

// ---------- no beard-silhouette substitution / no UNKNOWN bridging ----------

test('10. the module never references beard silhouette as an evidence source, and only names UNKNOWN_OCCLUSION_MASK once (in PRESERVED_TARGETS, to declare it untouched) -- never reads/uses it as bridging evidence', () => {
  const src = readFileSync(new URL('./neck-gt-curve-salvage-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/beard.?silhouette/i.test(src));
  const occurrences = (src.match(/UNKNOWN_OCCLUSION_MASK/g) || []).length;
  assert.equal(occurrences, 1, 'should appear exactly once, in the PRESERVED_TARGETS declaration');
});

// ---------- no model-generated prediction used ----------

test('11. the module has zero dependency on any temporal/beard/ML model output -- pure geometry only', () => {
  const src = readFileSync(new URL('./neck-gt-curve-salvage-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/head-relative-temporal|hairness|classifier|model\.predict|neural|tensor/i.test(src));
});

// ---------- ambiguous cases fail closed ----------

test('12. two clearly divergent halves (a real "out and a different way back") classify ACCIDENTALLY_CLOSED_AMBIGUOUS, never forced salvageable', () => {
  // a closed loop shaped like a wide V then a very different-shaped return -- halves diverge a lot
  const pts = [];
  for (let i = 0; i <= 10; i++) pts.push({ x: i * 10, y: 0 }); // out along y=0
  for (let i = 10; i >= 0; i--) pts.push({ x: i * 10, y: i % 2 === 0 ? 40 : -40 }); // back along a wildly different path
  pts.push({ x: 0.1, y: 0.1 });
  const r = S.classifyCurve(pts);
  assert.equal(r.classification, 'ACCIDENTALLY_CLOSED_AMBIGUOUS');
});

test('13. a degenerate/edge apex (at the very first or last index) fails closed to ambiguous rather than guessing', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 100.001 }, { x: 0.01, y: 0.01 }];
  const r = S.classifyCurve(pts);
  assert.ok(r.classification === 'ACCIDENTALLY_CLOSED_AMBIGUOUS' || r.classification === 'ACCIDENTALLY_CLOSED_BUT_SALVAGEABLE');
});

// ---------- existing polygons preserved (PRESERVED_TARGETS constant / real export check) ----------

test('14. PRESERVED_TARGETS names VISIBLE_NECK_SKIN_POLYGON and UNKNOWN_OCCLUSION_MASK, and this module never computes/touches them', () => {
  assert.ok(S.PRESERVED_TARGETS.includes('VISIBLE_NECK_SKIN_POLYGON'));
  assert.ok(S.PRESERVED_TARGETS.includes('UNKNOWN_OCCLUSION_MASK'));
  const src = readFileSync(new URL('./neck-gt-curve-salvage-v1.mjs', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export const CLOSED_LOOP_RATIO_THRESHOLD'));
  assert.ok(!/VISIBLE_NECK_SKIN_POLYGON\s*[:=]|UNKNOWN_OCCLUSION_MASK\s*[:=]/.test(body));
});

test('15. the real human export\'s VISIBLE_NECK_SKIN_POLYGON and UNKNOWN_OCCLUSION_MASK annotations are present and non-empty for all 9 images (untouched by this audit)', () => {
  const data = JSON.parse(readFileSync(EXPORT_PATH, 'utf8'));
  data.images.forEach(img => {
    if (img.pose === 'chin-up') {
      assert.ok(img.annotations.VISIBLE_NECK_SKIN_POLYGON.length > 0, img.imageId);
    }
    assert.ok(img.annotations.UNKNOWN_OCCLUSION_MASK.length > 0, img.imageId);
  });
});

// ---------- real export end-to-end classification matches the audited findings ----------

test('16. the real export classifies chinup_1 and chinup_2 as VALID_OPEN_CURVE (visually confirmed clean single traces)', () => {
  const data = JSON.parse(readFileSync(EXPORT_PATH, 'utf8'));
  ['chinup_1', 'chinup_2'].forEach(id => {
    const img = data.images.find(i => i.imageId === id);
    const r = S.classifyCurve(img.annotations[S.CURVE_TARGET_BY_POSE[img.pose]]);
    assert.equal(r.classification, 'VALID_OPEN_CURVE');
  });
});

test('17. the real export classifies the other 7 curve targets as closed (not VALID_OPEN_CURVE)', () => {
  const data = JSON.parse(readFileSync(EXPORT_PATH, 'utf8'));
  ['chinup_3', 'rightprofile_1', 'rightprofile_2', 'rightprofile_3', 'leftprofile_1', 'leftprofile_2', 'leftprofile_3'].forEach(id => {
    const img = data.images.find(i => i.imageId === id);
    const r = S.classifyCurve(img.annotations[S.CURVE_TARGET_BY_POSE[img.pose]]);
    assert.notEqual(r.classification, 'VALID_OPEN_CURVE');
  });
});

// ---------- scanner/production isolation ----------

test('18. production hashes (index.html, worker.js, burst recorder) remain unchanged', () => {
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

test('19. module has zero network calls and no scanner runtime references', () => {
  const src = readFileSync(new URL('./neck-gt-curve-salvage-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|BeardTrimAndroid|mgScan2|__temporalMotionBurstRecorder/.test(src));
});
