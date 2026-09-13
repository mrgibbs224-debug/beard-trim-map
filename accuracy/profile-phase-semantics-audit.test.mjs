// Stage BI-1Z1W -- synthetic tests for the profile phase-semantics audit module. Pure synthetic
// fixtures; no scanner timing/burst/whole-scan-recorder modification anywhere in this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as P from './profile-phase-semantics-audit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_SOURCE = readFileSync(join(HERE, 'profile-phase-semantics-audit.mjs'), 'utf8');

function sample(overrides = {}) {
  return Object.assign({ nativeFrameTimestampNs: '1000000000', coherenceStatus: 'VERIFIED_EXACT', observedPoseRegion: 'RIGHT45_REGION', yawDeg: 20, pitchDeg: 0, rollDeg: 0 }, overrides);
}

// ==================================================================================================
// 1 -- frozen characterization hashes
// ==================================================================================================
test('1. module records the exact frozen BI-1Z1V characterization/phase-metrics SHA256s', () => {
  assert.equal(P.BI1Z1V_CHARACTERIZATION_SHA256, 'af17221af87c9a2f05ff7b03732a32be8b51e36e79868ae00d108c6caef271ca');
  assert.equal(P.BI1Z1V_PHASE_METRICS_SHA256, '2fb738b786ec862287acffd7a1e431228633e3d28690526d9968cafe184b5d55');
});
test('1b. hash re-verification against the live artifacts', () => {
  assert.equal(createHash('sha256').update(readFileSync('D:/MettleTemp/analysis/bi1z1v_continuous_temporal_characterization.json')).digest('hex'), P.BI1Z1V_CHARACTERIZATION_SHA256);
  assert.equal(createHash('sha256').update(readFileSync('D:/MettleTemp/analysis/bi1z1v_continuous_temporal_phase_metrics.json')).digest('hex'), P.BI1Z1V_PHASE_METRICS_SHA256);
});

// ==================================================================================================
// 2 -- authorized scan restriction
// ==================================================================================================
test('2. assertAuthorizedScan accepts only the two BI-1Z1T post-fix scans', () => {
  assert.equal(P.assertAuthorizedScan('scan_mtzfzdjl_xpk2fe'), true);
  assert.throws(() => P.assertAuthorizedScan('scan_mtz6mhc9_3aoc5d'));
});

// ==================================================================================================
// 3 -- timestamp ordering / 4 -- profile-transition extraction
// ==================================================================================================
test('3. extractLateWindow selects only samples within the trailing window, ordered by timestamp', () => {
  const samples = [sample({ nativeFrameTimestampNs: '1000000000' }), sample({ nativeFrameTimestampNs: '1200000000' }), sample({ nativeFrameTimestampNs: '1400000000' })];
  const r = P.extractLateWindow(samples, '1400000000', 250);
  assert.equal(r.length, 2); // 1200 and 1400 are within 250ms of 1400; 1000 is 400ms before, excluded
});
test('4. extractLateWindow returns empty for an unparseable end timestamp, never throws', () => {
  assert.deepEqual(P.extractLateWindow([sample()], 'not-a-number', 250), []);
});

// ==================================================================================================
// 5 -- formal-capture association
// ==================================================================================================
test('5. determineFormalCaptureRelationship maps a LOW_MOTION_PROFILE_ALIGNED late window to C_LOW_MOTION_ALIGNED', () => {
  const r = P.determineFormalCaptureRelationship('1500000000', '1400000000', { state: 'LOW_MOTION_PROFILE_ALIGNED' });
  assert.equal(r.state, 'C_LOW_MOTION_ALIGNED');
  assert.ok(Math.abs(r.formalCaptureAfterBurstEndMs - 100) < 1e-6);
});
test('5b. determineFormalCaptureRelationship returns D_INSUFFICIENT_METADATA when any input is missing', () => {
  assert.equal(P.determineFormalCaptureRelationship(null, '1400000000', { state: 'SETTLING' }).state, 'D_INSUFFICIENT_METADATA');
});

// ==================================================================================================
// 6 -- late-window assignment
// ==================================================================================================
test('6. classifyLateWindowMotion returns DATA_INSUFFICIENT for fewer than 2 samples', () => {
  const r = P.classifyLateWindowMotion([sample()], 'RIGHT_PROFILE_REGION', 1.0);
  assert.equal(r.state, 'DATA_INSUFFICIENT');
});
test('6b. classifyLateWindowMotion returns STILL_TURNING when the majority of samples are not yet in the destination region', () => {
  const samples = [sample({ observedPoseRegion: 'RIGHT45_TO_RIGHT_PROFILE', yawDeg: 30 }), sample({ observedPoseRegion: 'RIGHT45_TO_RIGHT_PROFILE', yawDeg: 35 })];
  const r = P.classifyLateWindowMotion(samples, 'RIGHT_PROFILE_REGION', 1.0);
  assert.equal(r.state, 'STILL_TURNING');
});
test('6c. classifyLateWindowMotion returns LOW_MOTION_PROFILE_ALIGNED when region-aligned and motion is near the hold reference', () => {
  const samples = [sample({ observedPoseRegion: 'RIGHT_PROFILE_REGION', yawDeg: 40, pitchDeg: 0 }), sample({ observedPoseRegion: 'RIGHT_PROFILE_REGION', yawDeg: 40.5, pitchDeg: 0.2 })];
  const r = P.classifyLateWindowMotion(samples, 'RIGHT_PROFILE_REGION', 2.0);
  assert.equal(r.state, 'LOW_MOTION_PROFILE_ALIGNED');
});
test('6d. classifyLateWindowMotion returns SETTLING when region-aligned but motion is well above the hold reference', () => {
  const samples = [sample({ observedPoseRegion: 'RIGHT_PROFILE_REGION', yawDeg: 40, pitchDeg: 0 }), sample({ observedPoseRegion: 'RIGHT_PROFILE_REGION', yawDeg: 50, pitchDeg: 5 })];
  const r = P.classifyLateWindowMotion(samples, 'RIGHT_PROFILE_REGION', 0.5);
  assert.equal(r.state, 'SETTLING');
});

// ==================================================================================================
// 7 -- existing pose-state use only (no new yaw cutoff)
// ==================================================================================================
test('7. module never defines its own yaw/pitch numeric cutoff constant -- reads observedPoseRegion only', () => {
  assert.doesNotMatch(MODULE_SOURCE, /yawDeg\s*[<>]=?\s*\d/);
  assert.doesNotMatch(MODULE_SOURCE, /PROFILE_YAW_(MIN|MAX)\s*=/);
});

// ==================================================================================================
// 8 -- motion summaries (descriptiveStats reuse)
// ==================================================================================================
test('8. classifyLateWindowMotion reports median/p90 combined delta via the shared descriptiveStats primitive', () => {
  const samples = [sample({ observedPoseRegion: 'RIGHT_PROFILE_REGION', yawDeg: 40 }), sample({ observedPoseRegion: 'RIGHT_PROFILE_REGION', yawDeg: 41 }), sample({ observedPoseRegion: 'RIGHT_PROFILE_REGION', yawDeg: 42 })];
  const r = P.classifyLateWindowMotion(samples, 'RIGHT_PROFILE_REGION', 5);
  assert.ok(r.medianCombinedDelta != null);
  assert.ok(r.p90CombinedDelta != null);
});

// ==================================================================================================
// 9 -- hold comparison
// ==================================================================================================
test('9. classifyLateWindowMotion uses the SAME holdReferenceMedian across calls, never recomputing its own hold baseline', () => {
  assert.doesNotMatch(MODULE_SOURCE, /buildHoldPhaseMetrics/);
});

// ==================================================================================================
// 10 -- burst-end semantic trace
// ==================================================================================================
test('10. BURST_END_SEMANTICS documents POSE_LOCK_SETTLED as distinct from formal-capture-ready, with source evidence', () => {
  assert.match(P.BURST_END_SEMANTICS.meaning, /NOT identical to/);
  assert.ok(P.BURST_END_SEMANTICS.sourceEvidence.mgScan2HoldMsByPose['right-profile'] === 450);
  assert.ok(P.BURST_END_SEMANTICS.sourceEvidence.burstCloseCondition.includes('400'));
});

// ==================================================================================================
// 11 -- phase-coarseness detection
// ==================================================================================================
test('11. auditPhaseLabelCoarseness confirms coarseness when the burst\'s final sample is already destination-region-aligned', () => {
  const samples = [sample({ observedPoseRegion: 'RIGHT45_REGION' }), sample({ observedPoseRegion: 'RIGHT_PROFILE_REGION' })];
  const r = P.auditPhaseLabelCoarseness(samples, 'RIGHT_PROFILE_REGION');
  assert.equal(r.confirmed, true);
  assert.equal(r.reason, 'PHASE_LABEL_COARSENESS_CONFIRMED');
});
test('11b. auditPhaseLabelCoarseness reports not-confirmed when the final sample has not yet reached the destination region', () => {
  const samples = [sample({ observedPoseRegion: 'RIGHT45_REGION' }), sample({ observedPoseRegion: 'RIGHT45_TO_RIGHT_PROFILE' })];
  const r = P.auditPhaseLabelCoarseness(samples, 'RIGHT_PROFILE_REGION');
  assert.equal(r.confirmed, false);
});

// ==================================================================================================
// 12 -- acquisitionSource preservation / 13 -- burst provenance preservation
// ==================================================================================================
test('12. assertBurstProvenancePreserved confirms identity when timestamp and coherence match exactly', () => {
  const orig = sample({ nativeFrameTimestampNs: '5000000000', coherenceStatus: 'VERIFIED_EXACT' });
  assert.equal(P.assertBurstProvenancePreserved(orig, orig), true);
});
test('13. assertBurstProvenancePreserved detects a rewritten/mismatched identity, never silently accepting it', () => {
  const orig = sample({ nativeFrameTimestampNs: '5000000000' });
  const tampered = sample({ nativeFrameTimestampNs: '9999999999' });
  assert.equal(P.assertBurstProvenancePreserved(orig, tampered), false);
});

// ==================================================================================================
// 14 -- no retrospective relabeling
// ==================================================================================================
test('14. module never assigns or rewrites a phase/provenance field on an input sample -- read-only throughout', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\.phase\s*=(?!=)/);
  assert.doesNotMatch(MODULE_SOURCE, /\.provenance\s*=(?!=)/);
});

// ==================================================================================================
// 15 -- profile sufficiency decision
// ==================================================================================================
test('15. assessProfileSufficiency returns EXISTING_BURST_DATA_SUFFICIENT when coarseness confirmed and all usable windows are low-motion-aligned', () => {
  const windows = [{ state: 'LOW_MOTION_PROFILE_ALIGNED' }, { state: 'LOW_MOTION_PROFILE_ALIGNED' }, { state: 'DATA_INSUFFICIENT' }];
  const r = P.assessProfileSufficiency(windows, { confirmed: true });
  assert.equal(r.state, 'EXISTING_BURST_DATA_SUFFICIENT');
});
test('15b. assessProfileSufficiency returns TRUE_PROFILE_HOLD_DATA_SPARSE when coarseness is not confirmed', () => {
  const windows = [{ state: 'STILL_TURNING' }];
  const r = P.assessProfileSufficiency(windows, { confirmed: false });
  assert.equal(r.state, 'TRUE_PROFILE_HOLD_DATA_SPARSE');
});
test('15c. assessProfileSufficiency returns DATA_INSUFFICIENT when every window lacks data', () => {
  const windows = [{ state: 'DATA_INSUFFICIENT' }, { state: 'DATA_INSUFFICIENT' }];
  const r = P.assessProfileSufficiency(windows, { confirmed: true });
  assert.equal(r.state, 'DATA_INSUFFICIENT');
});

// ==================================================================================================
// 16 -- cross-pose audit
// ==================================================================================================
test('16. auditCrossPoseCoarseness reuses the identical coarseness logic for non-profile destination regions', () => {
  const samples = [sample({ observedPoseRegion: 'FRONT_REGION' }), sample({ observedPoseRegion: 'CHINUP_REGION' })];
  const r = P.auditCrossPoseCoarseness(samples, 'CHINUP_REGION');
  assert.equal(r.confirmed, true);
});

// ==================================================================================================
// 17 -- no V2
// ==================================================================================================
test('17. module never imports the V1/V2 temporal-support/measurement instrument', () => {
  assert.doesNotMatch(MODULE_SOURCE, /import[^;]*head-relative-temporal-(support|measurement)/);
});

// ==================================================================================================
// 18 -- no GT
// ==================================================================================================
test('18. module never references ground-truth or IoU machinery', () => {
  assert.doesNotMatch(MODULE_SOURCE, /groundTruth/i);
  assert.doesNotMatch(MODULE_SOURCE, /\bIoU\b/);
});

// ==================================================================================================
// 19 -- no occupancy
// ==================================================================================================
test('19. module imports nothing from the beard-occupancy-field or proposal families', () => {
  assert.doesNotMatch(MODULE_SOURCE, /beard-occupancy-field/);
  assert.doesNotMatch(MODULE_SOURCE, /beard-proposal/);
});

// ==================================================================================================
// 20 -- no Hairness
// ==================================================================================================
test('20. module does not import hairness-core', () => {
  assert.doesNotMatch(MODULE_SOURCE, /hairness-core/);
});

// ==================================================================================================
// 21 -- no network
// ==================================================================================================
test('21. module has zero network calls', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\bfetch\s*\(/);
  assert.doesNotMatch(MODULE_SOURCE, /https?:\/\//);
});

// ==================================================================================================
// 22 -- production isolation
// ==================================================================================================
test('22. production isolation: index.html and worker.js are unchanged by this stage', () => {
  const ROOT = join(HERE, '..');
  const indexHash = createHash('sha256').update(readFileSync(join(ROOT, 'index.html'))).digest('hex');
  const workerHash = createHash('sha256').update(readFileSync(join(ROOT, 'worker.js'))).digest('hex');
  // Baseline updated by BI-1Z2A, which was explicitly authorized to additively modify
  // index.html (corrected temporal subphase instrumentation) without touching the sacrosanct
  // burst recorder block.
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
  assert.equal(indexHash, '928747a5d284060dddac43c95f97a1669492ab4d1ecebf0d34bc59f3a3b5b521');
  assert.equal(workerHash, '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});
test('22b. module never imports a DOM/browser/native-bridge global', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\bwindow\./);
  assert.doesNotMatch(MODULE_SOURCE, /BeardTrimAndroid/);
});
test('22c. module never assigns a beard/shirt/neckline semantic field', () => {
  assert.doesNotMatch(MODULE_SOURCE, /isBeard\s*[:=]/);
  assert.doesNotMatch(MODULE_SOURCE, /isShirt\s*[:=]/);
  assert.doesNotMatch(MODULE_SOURCE, /neckline\s*[:=]/i);
});
