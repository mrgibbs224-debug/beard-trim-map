// Stage BI-1Z1T -- synthetic tests for the burst-priority-isolation + shared-transition-frame-reuse
// architecture (accuracy/whole-scan-temporal-exact-v1.mjs's new BI-1Z1T functions). Pure synthetic
// fixtures; no scientific/temporal-attachment interpretation anywhere in this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as W from './whole-scan-temporal-exact-v1.mjs';
import * as T from './head-relative-temporal-support-v1.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_SOURCE = readFileSync(join(HERE, 'whole-scan-temporal-exact-v1.mjs'), 'utf8');

function burstSample(overrides = {}) {
  return Object.assign({ nativeFrameTimestampNs: '1000000000', coherenceStatus: 'VERIFIED_EXACT', observedPoseRegion: 'FRONT', yawDeg: 1, pitchDeg: 1, rollDeg: 0, dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(200) }, overrides);
}
function burst(overrides = {}) {
  return Object.assign({ burstId: 'burst_1', sourceTransition: 'front_TO_right-three-quarter', samples: [burstSample({ nativeFrameTimestampNs: '1000000000' }), burstSample({ nativeFrameTimestampNs: '1133000000' })] }, overrides);
}
function phaseForTransition(sourceTransition) {
  const parts = (sourceTransition || '').split('_TO_');
  const suffix = { front: 'FRONT', 'right-three-quarter': 'RIGHT45', 'right-profile': 'RIGHT_PROFILE', 'left-three-quarter': 'LEFT45', 'left-profile': 'LEFT_PROFILE', 'chin-up': 'CHINUP' };
  const from = suffix[parts[0]], to = suffix[parts[1]];
  return (from && to) ? ('TRANSITION_' + from + '_TO_' + to) : 'UNRECOGNIZED_STATE';
}

// ==================================================================================================
// 1/2 -- frozen manifest/validation hashes (re-verification, Part 0)
// ==================================================================================================
test('1. BI-1Z1R implementation manifest hash re-verifies', () => {
  const buf = readFileSync('D:/MettleTemp/analysis/bi1z1r_whole_scan_temporal_v1_frozen_manifest.json');
  assert.equal(createHash('sha256').update(buf).digest('hex'), '9c89df0e564f13f61f4b68c67035f0e89867bb00d6e2a64c9f9689fd6a3767b1');
});
test('2. BI-1Z1S instrument-validation artifact hash re-verifies', () => {
  const buf = readFileSync('D:/MettleTemp/analysis/bi1z1s_whole_scan_temporal_instrument_validation.json');
  assert.equal(createHash('sha256').update(buf).digest('hex'), '5fc13acb60651b02be2353d9211ca0b60b7a5ba0405bbf23a4cca0c1068cb183');
});

// ==================================================================================================
// 3 -- burst recorder byte hash unchanged
// ==================================================================================================
test('3. the existing burst-recorder source block in index.html is byte-identical to BI-1Z1R/S', () => {
  const src = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
  const startIdx = src.indexOf('const TEMPORAL_BURST_TARGET_INTERVAL_MS');
  const endStart = src.indexOf('function __updateMotionBurstIndicatorUI(){');
  const endIdx = src.indexOf('\n}', endStart) + 2;
  const block = src.slice(startIdx, endIdx);
  assert.equal(createHash('sha256').update(block).digest('hex'), 'eae6776bf4299af02f41b0ac3805bb59eb0167dc903c45a9ca08e87941f0762a');
});

// ==================================================================================================
// 4/5 -- burst-active suppresses whole-scan native request / zero-request invariant throughout
// ==================================================================================================
test('4. isBurstActive is true exactly when currentBurst is set, reading (never writing) the burst recorder', () => {
  assert.equal(W.isBurstActive({ currentBurst: { burstId: 'b1' } }), true);
  assert.equal(W.isBurstActive({ currentBurst: null }), false);
  assert.equal(W.isBurstActive(null), false);
});
test('5. wholeScanSampleDecision returns sample:false for every tick while burstActive is true, regardless of throttle/in-flight state', () => {
  const results = [
    W.wholeScanSampleDecision({ burstActive: true, lastSampleAtMs: 0 }, 100000),
    W.wholeScanSampleDecision({ burstActive: true, lastSampleAtMs: 0, wholeScanRequestInFlight: false }, 200000),
    W.wholeScanSampleDecision({ burstActive: true, lastSampleAtMs: 0, formalRequestInFlight: false }, 300000)
  ];
  results.forEach(r => { assert.equal(r.sample, false); assert.equal(r.skipReason, 'WHOLE_SCAN_SUPPRESSED_FOR_BURST'); });
});

// ==================================================================================================
// 6/7 -- no burst-start race / no burst-end race
// ==================================================================================================
test('6. the instant a burst starts (currentBurst becomes non-null), the very next decision is suppressed -- no one-tick grace period', () => {
  const burstJustStarted = { currentBurst: { burstId: 'b1' } };
  const r = W.wholeScanSampleDecision({ burstActive: W.isBurstActive(burstJustStarted), lastSampleAtMs: 0 }, 1000000);
  assert.equal(r.sample, false);
  assert.equal(r.skipReason, 'WHOLE_SCAN_SUPPRESSED_FOR_BURST');
});
test('7. the instant a burst ends (currentBurst becomes null again), whole-scan may immediately resume -- no lingering suppression', () => {
  const burstJustEnded = { currentBurst: null };
  const r = W.wholeScanSampleDecision({ burstActive: W.isBurstActive(burstJustEnded), lastSampleAtMs: 0 }, 1000000);
  assert.equal(r.sample, true);
});

// ==================================================================================================
// 8 -- hold permits whole-scan request
// ==================================================================================================
test('8. with no burst active and the throttle elapsed, whole-scan may sample normally', () => {
  const r = W.wholeScanSampleDecision({ burstActive: false, lastSampleAtMs: 0 }, 1000);
  assert.equal(r.sample, true);
  assert.equal(r.skipReason, null);
});

// ==================================================================================================
// 9/10/11/12/13 -- shared burst sample enters timeline, preserves timestamp/burstId/transition/exactness
// ==================================================================================================
test('9. buildBurstSharedSample creates a timeline entry from an already-captured burst sample, issuing no new request', () => {
  const b = burst();
  const entry = W.buildBurstSharedSample({ scanSessionId: 's1', wholeScanSampleId: 'ws_shared_0', burstId: b.burstId, sourceTransition: b.sourceTransition, temporalSampleIndex: 0, burstSample: b.samples[0], phase: 'TRANSITION_FRONT_TO_RIGHT45' });
  assert.equal(entry.provenance, 'BURST_SHARED');
});
test('10. a BURST_SHARED entry preserves the original nativeFrameTimestampNs exactly', () => {
  const b = burst();
  const entry = W.buildBurstSharedSample({ scanSessionId: 's1', wholeScanSampleId: 'x', burstId: b.burstId, sourceTransition: b.sourceTransition, temporalSampleIndex: 0, burstSample: b.samples[0], phase: 'TRANSITION_FRONT_TO_RIGHT45' });
  assert.equal(entry.nativeFrameTimestampNs, b.samples[0].nativeFrameTimestampNs);
});
test('11. a BURST_SHARED entry preserves the original burstId (sourceBurstId)', () => {
  const b = burst();
  const entry = W.buildBurstSharedSample({ scanSessionId: 's1', wholeScanSampleId: 'x', burstId: b.burstId, sourceTransition: b.sourceTransition, temporalSampleIndex: 0, burstSample: b.samples[0], phase: 'TRANSITION_FRONT_TO_RIGHT45' });
  assert.equal(entry.sourceBurstId, 'burst_1');
});
test('12. a BURST_SHARED entry preserves the original sourceTransition', () => {
  const b = burst();
  const entry = W.buildBurstSharedSample({ scanSessionId: 's1', wholeScanSampleId: 'x', burstId: b.burstId, sourceTransition: b.sourceTransition, temporalSampleIndex: 0, burstSample: b.samples[0], phase: 'TRANSITION_FRONT_TO_RIGHT45' });
  assert.equal(entry.sourceTransition, 'front_TO_right-three-quarter');
});
test('13. a BURST_SHARED entry preserves the original VERIFIED_EXACT coherenceStatus, never re-derived', () => {
  const b = burst({ samples: [burstSample({ coherenceStatus: 'VERIFIED_EXACT' })] });
  const entry = W.buildBurstSharedSample({ scanSessionId: 's1', wholeScanSampleId: 'x', burstId: b.burstId, sourceTransition: b.sourceTransition, temporalSampleIndex: 0, burstSample: b.samples[0], phase: 'TRANSITION_FRONT_TO_RIGHT45' });
  assert.equal(entry.coherenceStatus, 'VERIFIED_EXACT');
});

// ==================================================================================================
// 14/15 -- no second JPEG encoding / no duplicate heavy payload
// ==================================================================================================
test('14. a BURST_SHARED entry never carries an imageBase64Jpeg field of its own -- no re-encoding', () => {
  const b = burst();
  const entry = W.buildBurstSharedSample({ scanSessionId: 's1', wholeScanSampleId: 'x', burstId: b.burstId, sourceTransition: b.sourceTransition, temporalSampleIndex: 0, burstSample: b.samples[0], phase: 'TRANSITION_FRONT_TO_RIGHT45' });
  assert.equal('imageBase64Jpeg' in entry, false);
});
test('15. a BURST_SHARED entry never carries landmarks2D/faceLocal3D/transformationMatrix/intrinsics of its own -- the burst array remains the single source of truth', () => {
  const b = burst();
  const entry = W.buildBurstSharedSample({ scanSessionId: 's1', wholeScanSampleId: 'x', burstId: b.burstId, sourceTransition: b.sourceTransition, temporalSampleIndex: 0, burstSample: b.samples[0], phase: 'TRANSITION_FRONT_TO_RIGHT45' });
  ['landmarks2D', 'faceLocal3D', 'transformationMatrix', 'imageSpaceViewModelMatrix', 'intrinsics'].forEach(f => assert.equal(f in entry, false, f + ' must not be duplicated'));
});

// ==================================================================================================
// 16 -- multi-role frame identity
// ==================================================================================================
test('16. a BURST_SHARED entry carries both WHOLE_SCAN and TEMPORAL_BURST role labels', () => {
  const b = burst();
  const entry = W.buildBurstSharedSample({ scanSessionId: 's1', wholeScanSampleId: 'x', burstId: b.burstId, sourceTransition: b.sourceTransition, temporalSampleIndex: 0, burstSample: b.samples[0], phase: 'TRANSITION_FRONT_TO_RIGHT45' });
  assert.deepEqual(entry.roleLabels.sort(), ['TEMPORAL_BURST', 'WHOLE_SCAN']);
});

// ==================================================================================================
// 17 -- chronological timeline merge
// ==================================================================================================
test('17. assembleWholeScanTimeline sorts owned + shared entries by nativeFrameTimestampNs, never by insertion order', () => {
  const owned = [{ scanSessionId: 's1', nativeFrameTimestampNs: '3000000000', roleLabels: ['WHOLE_SCAN'] }];
  const shared = [{ scanSessionId: 's1', nativeFrameTimestampNs: '1000000000', roleLabels: ['WHOLE_SCAN', 'TEMPORAL_BURST'] }, { scanSessionId: 's1', nativeFrameTimestampNs: '2000000000', roleLabels: ['WHOLE_SCAN', 'TEMPORAL_BURST'] }];
  const { timeline, orderingOk } = W.assembleWholeScanTimeline(owned, shared);
  assert.deepEqual(timeline.map(t => t.nativeFrameTimestampNs), ['1000000000', '2000000000', '3000000000']);
  assert.equal(orderingOk, true);
});

// ==================================================================================================
// 18 -- duplicate identity collapse
// ==================================================================================================
test('18. assembleWholeScanTimeline collapses a duplicate physical-frame identity into ONE entry with unioned role labels', () => {
  const owned = [{ scanSessionId: 's1', nativeFrameTimestampNs: '1000000000', roleLabels: ['WHOLE_SCAN'] }];
  const shared = [{ scanSessionId: 's1', nativeFrameTimestampNs: '1000000000', roleLabels: ['WHOLE_SCAN', 'TEMPORAL_BURST'] }];
  const { timeline, duplicateIdentityCount } = W.assembleWholeScanTimeline(owned, shared);
  assert.equal(timeline.length, 1);
  assert.equal(duplicateIdentityCount, 1);
  assert.deepEqual(timeline[0].roleLabels.sort(), ['TEMPORAL_BURST', 'WHOLE_SCAN']);
});

// ==================================================================================================
// 19/20/21 -- all 11 phases / 6 hold whole-scan-owned / 5 transitions burst-shared
// ==================================================================================================
test('19. an assembled timeline built from 6 owned hold samples + 5 bursts (each mapped to its transition phase) covers all 11 phases', () => {
  const holdPhases = ['POSE_HOLD_FRONT', 'POSE_HOLD_RIGHT45', 'POSE_HOLD_RIGHT_PROFILE', 'POSE_HOLD_LEFT45', 'POSE_HOLD_LEFT_PROFILE', 'POSE_HOLD_CHINUP'];
  const owned = holdPhases.map((p, i) => ({ scanSessionId: 's1', nativeFrameTimestampNs: String(1000000000 + i * 2000000000), phase: p, provenance: 'WHOLE_SCAN_OWNED', roleLabels: ['WHOLE_SCAN'] }));
  const bursts = [
    burst({ burstId: 'b1', sourceTransition: 'front_TO_right-three-quarter', samples: [burstSample({ nativeFrameTimestampNs: '1500000000' })] }),
    burst({ burstId: 'b2', sourceTransition: 'right-three-quarter_TO_right-profile', samples: [burstSample({ nativeFrameTimestampNs: '3500000000' })] }),
    burst({ burstId: 'b3', sourceTransition: 'right-profile_TO_left-three-quarter', samples: [burstSample({ nativeFrameTimestampNs: '5500000000' })] }),
    burst({ burstId: 'b4', sourceTransition: 'left-three-quarter_TO_left-profile', samples: [burstSample({ nativeFrameTimestampNs: '7500000000' })] }),
    burst({ burstId: 'b5', sourceTransition: 'left-profile_TO_chin-up', samples: [burstSample({ nativeFrameTimestampNs: '9500000000' })] })
  ];
  const shared = W.buildAllBurstSharedSamplesForTimeline(bursts, 's1', phaseForTransition, (bid, i) => 'ws_' + bid + '_' + i);
  const { timeline } = W.assembleWholeScanTimeline(owned, shared);
  const phasesSeen = new Set(timeline.map(t => t.phase));
  const REQUIRED = ['POSE_HOLD_FRONT', 'TRANSITION_FRONT_TO_RIGHT45', 'POSE_HOLD_RIGHT45', 'TRANSITION_RIGHT45_TO_RIGHT_PROFILE', 'POSE_HOLD_RIGHT_PROFILE', 'TRANSITION_RIGHT_PROFILE_TO_LEFT45', 'POSE_HOLD_LEFT45', 'TRANSITION_LEFT45_TO_LEFT_PROFILE', 'POSE_HOLD_LEFT_PROFILE', 'TRANSITION_LEFT_PROFILE_TO_CHINUP', 'POSE_HOLD_CHINUP'];
  REQUIRED.forEach(p => assert.ok(phasesSeen.has(p), 'missing phase ' + p));
});
test('20. every hold-phase entry in the assembled timeline is WHOLE_SCAN_OWNED', () => {
  const owned = [{ scanSessionId: 's1', nativeFrameTimestampNs: '1000000000', phase: 'POSE_HOLD_FRONT', provenance: 'WHOLE_SCAN_OWNED', roleLabels: ['WHOLE_SCAN'] }];
  const { timeline } = W.assembleWholeScanTimeline(owned, []);
  assert.equal(timeline[0].provenance, 'WHOLE_SCAN_OWNED');
});
test('21. every transition-phase entry in the assembled timeline is BURST_SHARED', () => {
  const b = burst();
  const shared = W.buildAllBurstSharedSamplesForTimeline([b], 's1', phaseForTransition, (bid, i) => 'ws_' + bid + '_' + i);
  const { timeline } = W.assembleWholeScanTimeline([], shared);
  timeline.forEach(t => assert.equal(t.provenance, 'BURST_SHARED'));
});

// ==================================================================================================
// 22/23/24 -- /1, /2, /3 compatibility (unchanged from BI-1Z1R)
// ==================================================================================================
test('22. extractBurstDataset returns [] for a /1-shaped package', () => {
  assert.deepEqual(W.extractBurstDataset({ exactFrameResearchCaptureVersion: 'exact-frame-research-capture/1' }), []);
});
test('23. extractBurstDataset returns the burst array unchanged for a /2 package', () => {
  const bursts = [{ burstId: 'b1' }];
  assert.equal(W.extractBurstDataset({ exactFrameResearchCaptureVersion: W.PACKAGE_SCHEMA_VERSION_V2, temporalMotionBursts: bursts }), bursts);
});
test('24. versionForExport still returns /3 only when whole-scan samples exist', () => {
  assert.equal(W.versionForExport(true), W.PACKAGE_SCHEMA_VERSION_V3);
  assert.equal(W.versionForExport(false), W.PACKAGE_SCHEMA_VERSION_V2);
});

// ==================================================================================================
// 25 -- temporalMotionBursts unchanged
// ==================================================================================================
test('25. extendPackageWithWholeScanStream still never modifies temporalMotionBursts', () => {
  const bursts = [{ burstId: 'b1', samples: [{ x: 1 }] }];
  const v2Pkg = { exactFrameResearchCaptureVersion: W.PACKAGE_SCHEMA_VERSION_V2, temporalMotionBursts: bursts };
  const v3Pkg = W.extendPackageWithWholeScanStream(v2Pkg, [{ id: 'w1' }], W.buildWholeScanTelemetry({}));
  assert.equal(v3Pkg.temporalMotionBursts, bursts);
});

// ==================================================================================================
// 26 -- V2 burst compatibility unchanged
// ==================================================================================================
test('26. a burst sample is still accepted by the frozen V1 temporal instrument after this stage\'s changes', () => {
  const flat468 = new Array(468).fill(0).map((_, i) => ({ x: i, y: i, z: 0 }));
  const sample = { coherenceStatus: 'VERIFIED_EXACT', nativeFrameTimestampNs: '1000000000', imageWidth: 640, imageHeight: 480, faceLocal3D: flat468, imageSpaceViewModelMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 }, yawDeg: 0, pitchDeg: 0, rollDeg: 0 };
  assert.doesNotThrow(() => T.buildCandidatesForSample(sample));
  assert.doesNotThrow(() => T.pairEligibility(sample, sample));
});

// ==================================================================================================
// 27 -- nominal hold cadence unchanged
// ==================================================================================================
test('27. WHOLE_SCAN_PARAMETERS.targetIntervalMs is still ~7Hz (unchanged nominal cadence for hold sampling)', () => {
  assert.ok(Math.abs(W.WHOLE_SCAN_PARAMETERS.targetIntervalMs - (1000 / 7)) < 1e-9);
});

// ==================================================================================================
// 28 -- safety caps preserved
// ==================================================================================================
test('28. safety caps (700 samples / 180s / ~60MB) are unchanged', () => {
  assert.equal(W.WHOLE_SCAN_PARAMETERS.maxSamples, 700);
  assert.equal(W.WHOLE_SCAN_PARAMETERS.maxDurationMs, 180000);
  assert.equal(W.WHOLE_SCAN_PARAMETERS.maxApproxExportBytes, 62914560);
});

// ==================================================================================================
// 29 -- lifecycle preserved
// ==================================================================================================
test('29. shouldWholeScanBeActive lifecycle gating is unchanged by this stage', () => {
  const r = W.shouldWholeScanBeActive({ researchCaptureFlag: true, isResearchBuildFn: () => true, appForeground: true, cameraLive: true, scanSessionActive: true, screen: 'SCANNER' });
  assert.equal(r.active, true);
});

// ==================================================================================================
// 30/31/32 -- no occupancy / no GT / no network
// ==================================================================================================
test('30. module imports nothing from the beard-occupancy-field or proposal families', () => {
  assert.doesNotMatch(MODULE_SOURCE, /beard-occupancy-field/);
  assert.doesNotMatch(MODULE_SOURCE, /beard-proposal/);
});
test('31. module never references ground-truth or IoU machinery', () => {
  assert.doesNotMatch(MODULE_SOURCE, /groundTruth/i);
  assert.doesNotMatch(MODULE_SOURCE, /\bIoU\b/); // word-boundary: "previous" legitimately contains "iou" as a substring
});
test('32. module has zero network calls', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\bfetch\s*\(/);
  assert.doesNotMatch(MODULE_SOURCE, /https?:\/\//);
});

// ==================================================================================================
// 33 -- UI issue untouched
// ==================================================================================================
test('33. module contains no DOM/CSS/UI-layout code -- the known research UI issue is not touched here', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\bdocument\./);
  assert.doesNotMatch(MODULE_SOURCE, /getElementById/);
});

// ==================================================================================================
// 34 -- production isolation
// ==================================================================================================
test('34. verifyNoRequestDuringBurst enforces the hard invariant from telemetry alone', () => {
  assert.equal(W.verifyNoRequestDuringBurst({ wholeScanIndependentRequestsDuringBurst: 0 }), true);
  assert.equal(W.verifyNoRequestDuringBurst({ wholeScanIndependentRequestsDuringBurst: 1 }), false);
});
test('34b. computeDedupSavings sums real source-burst JPEG bytes, never a fabricated estimate', () => {
  const b = burst();
  const shared = [{ sourceBurstId: 'burst_1', sourceTemporalSampleIndex: 0 }];
  const bySId = new Map([['burst_1', b]]);
  const r = W.computeDedupSavings(shared, bySId);
  assert.equal(r.deduplicatedPayloadCount, 1);
  assert.equal(r.deduplicatedApproxBytesSaved, b.samples[0].dataUrl.length);
});
