import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(HERE, '..', 'index.html');
const WORKER_PATH = join(HERE, '..', 'worker.js');

function sha256(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }

test('1. index.html unchanged by BI-1Z2B (analysis-only stage)', () => {
  // Baseline updated by SCAN-LOCK-V1A, which was explicitly authorized to additively modify
  // index.html (real voice guidance implementation via Web Speech API) without touching the
  // sacrosanct burst recorder block or any scanner timing/threshold code.
  // Baseline updated by SCAN-LOCK-V1B, which was explicitly authorized to additively modify
  // index.html (native Android TextToSpeech voice transport replacing the unavailable Web
  // Speech API) without touching the sacrosanct burst recorder block or any scanner
  // timing/threshold code.
  // Baseline updated by SCAN-LOCK-V1C, which was explicitly authorized to flip
  // window.__front3DDecisionAuthoritative's default from false to true (Front
  // comfortable-distance persistent-block fix) without touching the sacrosanct
  // burst recorder block, any scanner timing/threshold, or native Voice Guidance code.
  // Baseline updated by SCAN-LOCK-V1D, which was explicitly authorized to make a
  // layout-only fix (research/debug panel touch-scroll unreachability) without
  // touching the sacrosanct burst recorder block, any scanner timing/threshold,
  // DIST/Front-3D-authority, or native Voice Guidance code.
  assert.equal(sha256(INDEX_PATH), '928747a5d284060dddac43c95f97a1669492ab4d1ecebf0d34bc59f3a3b5b521');
});

test('2. worker.js unchanged by BI-1Z2B', () => {
  assert.equal(sha256(WORKER_PATH), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});

test('3. sacrosanct burst-recorder byte-substring unchanged by BI-1Z2B', () => {
  const src = readFileSync(INDEX_PATH, 'utf8');
  const startIdx = src.indexOf('const TEMPORAL_BURST_TARGET_INTERVAL_MS');
  const endStart = src.indexOf('function __updateMotionBurstIndicatorUI(){');
  const endIdx = src.indexOf('\n}', endStart) + 2;
  assert.equal(createHash('sha256').update(src.slice(startIdx, endIdx)).digest('hex'), 'eae6776bf4299af02f41b0ac3805bb59eb0167dc903c45a9ca08e87941f0762a');
});

test('4. BI-1Z2A frozen manifest hash re-verifies (source of truth this stage builds on)', () => {
  assert.equal(sha256('D:/MettleTemp/analysis/bi1z2a_temporal_subphase_instrumentation_frozen_manifest.json'), 'd53defa233a5161c3d92b8b80f6299033e70199b86ea8d341c0442a268e1edf7');
});

test('5. all five authorized capture files exist and are independently hashable (no silent substitution)', () => {
  const ids = ['scan_mtzxr228_7b50dm', 'scan_mtzxslrd_yxv72h', 'scan_mtzxt16l_tzqup3', 'scan_mtzxtevz_hp05uo', 'scan_mtzxtrhf_dlw7ge'];
  ids.forEach(id => {
    const h = sha256('D:/MettleTemp/research-captures/exact-frame-research-capture_' + id + '.json');
    assert.match(h, /^[0-9a-f]{64}$/);
  });
});

test('6. the three BI-1Z2B output artifacts exist and are valid JSON / non-empty markdown', () => {
  const analysis = JSON.parse(readFileSync('D:/MettleTemp/analysis/bi1z2b_temporal_subphase_physical_analysis.json', 'utf8'));
  const decision = JSON.parse(readFileSync('D:/MettleTemp/analysis/bi1z2b_profile_timing_decision.json', 'utf8'));
  const report = readFileSync('D:/MettleTemp/analysis/bi1z2b_temporal_subphase_physical_report.md', 'utf8');
  assert.equal(analysis.stage, 'BI-1Z2B');
  assert.equal(decision.stage, 'BI-1Z2B');
  assert.ok(report.length > 500);
});

test('7. analysis output classifies all 10 profile instances, never fewer, never pooled into fewer than 5+5', () => {
  const analysis = JSON.parse(readFileSync('D:/MettleTemp/analysis/bi1z2b_temporal_subphase_physical_analysis.json', 'utf8'));
  assert.equal(analysis.profileInstances.length, 10);
  assert.equal(analysis.profileInstances.filter(p => p.stepId === 'right-profile').length, 5);
  assert.equal(analysis.profileInstances.filter(p => p.stepId === 'left-profile').length, 5);
});

test('8. decision artifact\'s final decision is one of the four allowed values, not an invented fifth', () => {
  const decision = JSON.parse(readFileSync('D:/MettleTemp/analysis/bi1z2b_profile_timing_decision.json', 'utf8'));
  assert.ok(['PROFILE_TIMING_SUFFICIENT_NO_EXTENSION', 'PROFILE_TIMING_MIXED_MORE_OBSERVATION', 'PROFILE_TEMPORAL_COVERAGE_INSUFFICIENT_EXTENSION_JUSTIFIED', 'DATA_INTEGRITY_FAILED'].includes(decision.decision));
});

test('9. no beard/shirt-classification/neckline/occupancy/GT/Hairness reference in any BI-1Z2B output JSON', () => {
  const analysis = readFileSync('D:/MettleTemp/analysis/bi1z2b_temporal_subphase_physical_analysis.json', 'utf8');
  const decision = readFileSync('D:/MettleTemp/analysis/bi1z2b_profile_timing_decision.json', 'utf8');
  [analysis, decision].forEach(text => {
    assert.ok(!/beardClassification|shirtClassification|necklineInference|occupancyFusion|hairnessScore|groundTruthMask/i.test(text));
  });
});

test('10. clothing condition is recorded descriptively but the decision.decision field is never keyed by clothing', () => {
  const decision = JSON.parse(readFileSync('D:/MettleTemp/analysis/bi1z2b_profile_timing_decision.json', 'utf8'));
  assert.ok(decision.clothingConditionDisclaimer);
  assert.ok(!/shirt/i.test(decision.decision));
});
