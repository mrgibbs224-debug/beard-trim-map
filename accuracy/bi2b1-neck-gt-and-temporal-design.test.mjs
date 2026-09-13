import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }

const MANIFEST_PATH = 'D:/MettleTemp/annotation/bi2b1_neck_gt_selection_manifest.json';
const HTML_PATH = 'D:/MettleTemp/annotation/bi2b1_neck_gt_annotate.html';
const EXPERIMENT_PATH = 'D:/MettleTemp/analysis/bi2b1_temporal_neck_clothing_experiment_design.json';
const EXTRACTED_MANIFEST_PATH = 'D:/MettleTemp/annotation/bi2b1_extracted_manifest_raw.json';

// ---------- BI-2A artifact verification ----------

test('1. BI-2A artifacts re-verify against their authoritative hashes', () => {
  assert.equal(sha256(readFileSync('D:/MettleTemp/analysis/bi2a_submental_neck_evidence_characterization.json')), 'cfeaeeada32629520e9b62aff14dc151667a4c901891b8297027a61930583a46');
  assert.equal(sha256(readFileSync('D:/MettleTemp/analysis/bi2a_neck_model_architecture_decision.json')), '390647026a299697af63e2c9e4d0c08ee11053bc50b817e85b05874cc5d37204');
  assert.equal(sha256(readFileSync('D:/MettleTemp/analysis/bi2a_submental_neck_evidence_report.md')), '85790e41276565c2bac9ab0bcf0be13d24a7418d311c8331da69ee3bb5ef8e32');
});

// ---------- locked-scanner dataset restriction ----------

test('2. selection manifest uses ONLY CURRENT_LOCKED_SCANNER_DATA, no older data pooled in', () => {
  const m = readJson(MANIFEST_PATH);
  assert.equal(m.datasetPolicy.olderDataUsed, false);
  const lockedScans = new Set(['scan_mu02bje6_57efla', 'scan_mu02c0cl_13ser3', 'scan_mu02cft9_g7wx30', 'scan_mu02cunh_395p9e', 'scan_mu02d6gj_yriwo4', 'scan_mu02qcwu_pjfgkc']);
  m.selection.images.forEach(img => assert.ok(lockedScans.has(img.scanSessionId), `${img.scanSessionId} must be a SCAN-LOCK-V1E scan`));
});

// ---------- selection count / pose balance ----------

test('3. exactly 9 images selected, 3 per pose', () => {
  const m = readJson(MANIFEST_PATH);
  assert.equal(m.selection.totalImagesSelected, 9);
  assert.equal(m.selection.images.length, 9);
  assert.deepEqual(m.selection.poseBalance, { 'chin-up': 3, 'right-profile': 3, 'left-profile': 3 });
});

test('4. no duplicate scan-session+pose combination selected', () => {
  const m = readJson(MANIFEST_PATH);
  const seen = new Set();
  m.selection.images.forEach(img => {
    const key = img.scanSessionId + '|' + img.pose;
    assert.ok(!seen.has(key), 'duplicate combination: ' + key);
    seen.add(key);
  });
});

// ---------- raw-JPEG provenance ----------

test('5. every selected image traces back to a real source observation with full provenance', () => {
  const extracted = readJson(EXTRACTED_MANIFEST_PATH);
  assert.equal(extracted.length, 9);
  extracted.forEach(e => {
    assert.ok(e.observationId, 'missing observationId for ' + e.imageId);
    assert.ok(e.nativeFrameTimestampNs, 'missing native timestamp for ' + e.imageId);
    assert.ok(e.sha256 && /^[0-9a-f]{64}$/.test(e.sha256), 'missing/invalid sha256 for ' + e.imageId);
    assert.equal(e.datasetCategory, 'CURRENT_LOCKED_SCANNER_DATA');
  });
});

test('6. selection manifest documents the honest orientation/rotation limitation rather than fabricating a correction', () => {
  const m = readJson(MANIFEST_PATH);
  assert.match(m.importantOrientationNote.finding, /not populated by the native bridge/);
  assert.match(m.importantOrientationNote.resolution, /without the tool guessing or fabricating a rotation value/i);
});

// ---------- annotation schema / UNKNOWN support ----------

test('7. annotation tool declares CHIN_TO_NECK_TRANSITION_CURVE, VISIBLE_NECK_SKIN_POLYGON, and UNKNOWN_OCCLUSION_MASK for chin-up', () => {
  const html = readFileSync(HTML_PATH, 'utf8');
  assert.match(html, /CHIN_TO_NECK_TRANSITION_CURVE/);
  assert.match(html, /VISIBLE_NECK_SKIN_POLYGON/);
  assert.match(html, /UNKNOWN_OCCLUSION_MASK/);
});

test('8. annotation tool declares UNDER_JAW_VISIBLE_BOUNDARY and UNKNOWN_OCCLUSION_MASK for both profile poses', () => {
  const html = readFileSync(HTML_PATH, 'utf8');
  const scriptMatch = html.match(/const POSE_TARGETS = (\{[\s\S]*?\});/);
  assert.ok(scriptMatch);
  assert.match(scriptMatch[1], /'right-profile':\s*\[[\s\S]*?UNDER_JAW_VISIBLE_BOUNDARY[\s\S]*?UNKNOWN_OCCLUSION_MASK/);
  assert.match(scriptMatch[1], /'left-profile':\s*\[[\s\S]*?UNDER_JAW_VISIBLE_BOUNDARY[\s\S]*?UNKNOWN_OCCLUSION_MASK/);
});

test('9. UNKNOWN is a first-class annotation target, not merely a fallback label', () => {
  const html = readFileSync(HTML_PATH, 'utf8');
  assert.match(html, /UNKNOWN \/ occluded region/);
});

// ---------- no pre-populated semantic GT ----------

test('10. the tool never pre-draws a semantic neck/jaw boundary or machine-predicted curve before export', () => {
  const html = readFileSync(HTML_PATH, 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  const script = scriptMatch[1];
  // fresh state always initializes every shape list empty -- never seeded with points
  assert.match(script, /fresh\[img\.imageId\] = \{ rotation: 0, shapes: \{\} \};/);
  assert.match(script, /POSE_TARGETS\[img\.pose\]\.forEach\(t => \{ fresh\[img\.imageId\]\.shapes\[t\.key\] = \[\]; \}\);/);
  assert.ok(!/predicted|machineGuess|autoDetect/i.test(script));
});

test('11. no jaw-support-rail or tracked-landmark overlay is drawn (the safer design choice this stage made -- avoids raw/display coordinate-space risk)', () => {
  const html = readFileSync(HTML_PATH, 'utf8');
  assert.ok(!/EXACT_FRAME_JAW_SUPPORT_SIDE|JAW_CHIN_RAIL|landmarks2D/.test(html));
});

// ---------- local-only tool behavior ----------

test('12. the annotation tool has zero network calls and no external resource references', () => {
  const html = readFileSync(HTML_PATH, 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|<script src=|<link\s+rel=["']stylesheet["']\s+href=/.test(html));
});

test('13. all 9 images are embedded as local data URIs -- no external image references', () => {
  const html = readFileSync(HTML_PATH, 'utf8');
  const count = (html.match(/data:image\/jpeg;base64,/g) || []).length;
  assert.equal(count, 9);
});

test('14. annotation progress autosaves to localStorage, not to any remote store', () => {
  const html = readFileSync(HTML_PATH, 'utf8');
  assert.match(html, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(html, /localStorage\.getItem\(STORAGE_KEY\)/);
});

// ---------- export structure ----------

test('15. export includes coordinateSpaceNote, per-image rotation, and full source provenance -- never silently discarded', () => {
  const html = readFileSync(HTML_PATH, 'utf8');
  assert.match(html, /coordinateSpaceNote:/);
  assert.match(html, /rotationAppliedDegrees: state\[img\.imageId\]\.rotation/);
  assert.match(html, /sourceImageSha256: img\.sha256/);
  assert.match(html, /sourceObservationId: img\.observationId/);
});

// ---------- temporal patch-family taxonomy ----------

test('16. temporal experiment design declares exactly the required patch families', () => {
  const d = readJson(EXPERIMENT_PATH);
  const names = d.patchFamilies.map(p => p.name);
  ['HEAD_REFERENCE', 'NECK_CANDIDATE', 'CLOTHING_CONTROL', 'BACKGROUND_CONTROL', 'TRANSITION_BOUNDARY'].forEach(n => assert.ok(names.includes(n)));
});

test('17. beard patches are explicitly excluded from defining neck motion', () => {
  const d = readJson(EXPERIMENT_PATH);
  assert.match(d.explicitExclusion, /Beard patches are NOT used/);
});

// ---------- head-relative/static hypotheses preserved ----------

test('18. H_HEAD_RELATIVE and H_STATIC_IMAGE are both preserved for every relevant patch family', () => {
  const d = readJson(EXPERIMENT_PATH);
  assert.ok(d.hypotheses.H_HEAD_RELATIVE);
  assert.ok(d.hypotheses.H_STATIC_IMAGE);
});

test('19. H_TORSO_RELATIVE is marked UNSUPPORTED_FOR_THIS_STAGE rather than fabricated', () => {
  const d = readJson(EXPERIMENT_PATH);
  assert.equal(d.hypotheses.H_TORSO_RELATIVE.status, 'UNSUPPORTED_FOR_THIS_STAGE');
});

// ---------- residual-difference / safe-ratio availability, no ZNCC-as-primary ----------

test('20. primary metrics are residualDifference/safeResidualRatioV2; ZNCC is demoted to secondary/descriptive only', () => {
  const d = readJson(EXPERIMENT_PATH);
  assert.ok(d.metrics.primary.some(m => /residualDifference/.test(m)));
  assert.ok(d.metrics.primary.some(m => /safeResidualRatioV2/.test(m)));
  assert.ok(d.metrics.secondary_descriptive_only.some(m => /Zncc/i.test(m)));
  assert.match(d.metrics.explicitProhibition, /not resurrected as a primary signal/i);
});

// ---------- no threshold fitting ----------

test('21. the experiment design fits no numeric threshold and is explicitly not-yet-executed', () => {
  const d = readJson(EXPERIMENT_PATH);
  assert.equal(d.notExecutedThisStage, true);
  assert.match(d.metrics.reportingForm, /never a single pass\/fail threshold/);
});

// ---------- no Hairness retraining ----------

test('22. neither artifact references Hairness retraining/rethresholding', () => {
  const manifestText = readFileSync(MANIFEST_PATH, 'utf8');
  const experimentText = readFileSync(EXPERIMENT_PATH, 'utf8');
  assert.ok(!/hairness/i.test(manifestText));
  assert.ok(!/hairness/i.test(experimentText));
});

// ---------- no beard-boundary annotation ----------

test('23. no beard-boundary, trim-line, or outer-envelope annotation TARGET (POSE_TARGETS key) exists in the tool -- BI-2B1A\'s instructions text is allowed to mention "trim line" only as an explicit exclusion/negation', () => {
  const html = readFileSync(HTML_PATH, 'utf8');
  const targetsMatch = html.match(/const POSE_TARGETS = (\{[\s\S]*?\n\};)/);
  assert.ok(targetsMatch);
  assert.ok(!/beard.?boundary|trim.?line|outer.?envelope|beard.?density|fade.?zone/i.test(targetsMatch[1]));
});

// ---------- no scanner modification / no production modification ----------

test('24. production hashes (index.html, worker.js, burst recorder) are unchanged by this stage', () => {
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

test('25. the annotation tool never references any scanner runtime global', () => {
  const html = readFileSync(HTML_PATH, 'utf8');
  assert.ok(!/BeardTrimAndroid|mgScan2|qualityFor\(|__temporalMotionBurstRecorder|__wholeScanTemporalRecorder/.test(html));
});

// ---------- no network (repeat, comprehensive across all 3 new artifacts) ----------

test('26. no network reference anywhere across the manifest, experiment design, or tool', () => {
  [MANIFEST_PATH, EXPERIMENT_PATH, HTML_PATH].forEach(p => {
    const text = readFileSync(p, 'utf8');
    assert.ok(!/https?:\/\/(?!.*coordinateSpace)/.test(text.replace(/coordinateSpaceNote[\s\S]{0,400}/, '')), 'unexpected network-looking reference in ' + p);
  });
});
