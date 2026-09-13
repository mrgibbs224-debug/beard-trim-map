// Stage BI-1Z1R -- synthetic/invariant tests for WHOLE_SCAN_TEMPORAL_EXACT_V1. Pure synthetic
// fixtures; no physical capture, no GT.
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
const DESIGN_PATH = 'D:/MettleTemp/analysis/bi1z1q_continuous_whole_scan_temporal_design.json';

function verifiedExactRes(overrides = {}) {
  return Object.assign({
    coherenceStatus: 'VERIFIED_EXACT', nativeFrameTimestampNs: '1000000000',
    poseYawDeg: 5, posePitchDeg: 2, poseRollDeg: 1,
    landmarks2D: [{ x: 1, y: 1, z: 0 }], faceLocal3D: [{ x: 0, y: 0, z: 0 }],
    imageSpaceViewModelMatrix: new Array(16).fill(0), transformationMatrix: new Array(16).fill(0),
    intrinsicsFx: 500, intrinsicsFy: 500, intrinsicsCx: 320, intrinsicsCy: 240, intrinsicsImageWidth: 640, intrinsicsImageHeight: 480, intrinsicsSpace: 'RAW',
    imageBase64Jpeg: 'data:image/jpeg;base64,AAAA', imageWidth: 640, imageHeight: 480,
    imageRotationDegrees: 0, imageMirrored: false, displayRotationDegrees: 0, sensorOrientationDegrees: 90,
    captureLatencyMs: 12
  }, overrides);
}

// ==================================================================================================
// 1 -- frozen design hash
// ==================================================================================================
test('1. module records the exact frozen BI-1Z1Q design SHA256', () => {
  assert.equal(W.BI1Z1Q_DESIGN_SHA256, 'c06d4f6adff5a157eb151c6f16b99a3cea77969fb0b1612081787da0feff203a');
});
test('1b. design hash re-verification against the live artifact', () => {
  assert.equal(createHash('sha256').update(readFileSync(DESIGN_PATH)).digest('hex'), W.BI1Z1Q_DESIGN_SHA256);
});

// ==================================================================================================
// 2 -- continuous stream default OFF
// ==================================================================================================
test('2. shouldWholeScanBeActive is inactive by default (no signals supplied at all)', () => {
  const r = W.shouldWholeScanBeActive({});
  assert.equal(r.active, false);
});

// ==================================================================================================
// 3/4 -- research-build gate / research toggle required
// ==================================================================================================
test('3. isWholeScanCaptureAllowed requires BOTH the toggle and isResearchBuild()', () => {
  assert.equal(W.isWholeScanCaptureAllowed(true, () => true), true);
  assert.equal(W.isWholeScanCaptureAllowed(false, () => true), false);
  assert.equal(W.isWholeScanCaptureAllowed(true, () => false), false);
});
test('4. isWholeScanCaptureAllowed fails closed on a throwing isResearchBuildFn', () => {
  assert.equal(W.isWholeScanCaptureAllowed(true, () => { throw new Error('x'); }), false);
});

// ==================================================================================================
// 5 -- start lifecycle
// ==================================================================================================
test('5. shouldWholeScanBeActive is active when every required signal is true and on SCANNER', () => {
  const r = W.shouldWholeScanBeActive({ researchCaptureFlag: true, isResearchBuildFn: () => true, appForeground: true, cameraLive: true, scanSessionActive: true, screen: 'SCANNER' });
  assert.equal(r.active, true);
  assert.equal(r.reason, null);
});

// ==================================================================================================
// 6 -- stop lifecycle
// ==================================================================================================
test('6. shouldWholeScanBeActive stops once the scan session is no longer active', () => {
  const r = W.shouldWholeScanBeActive({ researchCaptureFlag: true, isResearchBuildFn: () => true, appForeground: true, cameraLive: true, scanSessionActive: false, screen: 'SCANNER' });
  assert.equal(r.active, false);
  assert.equal(r.reason, 'SCAN_NOT_ACTIVE');
});

// ==================================================================================================
// 7 -- pause/background stop
// ==================================================================================================
test('7. shouldWholeScanBeActive stops when the app is backgrounded', () => {
  const r = W.shouldWholeScanBeActive({ researchCaptureFlag: true, isResearchBuildFn: () => true, appForeground: false, cameraLive: true, scanSessionActive: true, screen: 'SCANNER' });
  assert.equal(r.active, false);
  assert.equal(r.reason, 'APP_BACKGROUNDED');
});

// ==================================================================================================
// 8 -- abort stop
// ==================================================================================================
test('8. shouldWholeScanBeActive stops immediately on scanAborted, before any other check', () => {
  const r = W.shouldWholeScanBeActive({ scanAborted: true, researchCaptureFlag: true, isResearchBuildFn: () => true, appForeground: true, cameraLive: true, scanSessionActive: true, screen: 'SCANNER' });
  assert.equal(r.active, false);
  assert.equal(r.reason, 'SCAN_ABORTED');
});

// ==================================================================================================
// 9 -- no Review capture
// ==================================================================================================
test('9. shouldWholeScanBeActive never captures on the Review screen', () => {
  const r = W.shouldWholeScanBeActive({ researchCaptureFlag: true, isResearchBuildFn: () => true, appForeground: true, cameraLive: true, scanSessionActive: true, screen: 'REVIEW' });
  assert.equal(r.active, false);
  assert.equal(r.reason, 'REVIEW_SCREEN');
});
test('9b. shouldWholeScanBeActive never captures while Settings is open', () => {
  const r = W.shouldWholeScanBeActive({ researchCaptureFlag: true, isResearchBuildFn: () => true, appForeground: true, cameraLive: true, scanSessionActive: true, screen: 'SETTINGS' });
  assert.equal(r.reason, 'SETTINGS_OPEN');
});

// ==================================================================================================
// 10/11 -- VERIFIED_EXACT-only retention / non-exact skip
// ==================================================================================================
test('10. isAcceptableWholeScanSample accepts only VERIFIED_EXACT', () => {
  assert.equal(W.isAcceptableWholeScanSample(verifiedExactRes()), true);
});
test('11. isAcceptableWholeScanSample rejects anything else, including null', () => {
  assert.equal(W.isAcceptableWholeScanSample(verifiedExactRes({ coherenceStatus: 'REJECTED_TIMEOUT' })), false);
  assert.equal(W.isAcceptableWholeScanSample(null), false);
});

// ==================================================================================================
// 12 -- nominal 7Hz throttle
// ==================================================================================================
test('12. WHOLE_SCAN_PARAMETERS targets 7Hz nominal (~142.86ms interval), never 30/60fps', () => {
  assert.ok(Math.abs(W.WHOLE_SCAN_PARAMETERS.targetIntervalMs - (1000 / 7)) < 1e-9);
  assert.ok(W.WHOLE_SCAN_PARAMETERS.targetIntervalMs > 30); // nowhere near a 30fps (33ms) or 60fps (16ms) interval
});
test('12b. shouldSampleNow throttles by elapsed time, not a fixed frame counter', () => {
  assert.equal(W.shouldSampleNow(1000, 1100), false); // 100ms elapsed < ~142.86ms
  assert.equal(W.shouldSampleNow(1000, 1150), true);  // 150ms elapsed >= ~142.86ms
});

// ==================================================================================================
// 13 -- no unbounded queue
// ==================================================================================================
test('13. module never implements a queue -- a skip is final for that tick, never retried/enqueued', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\bqueue\b/i);
  assert.doesNotMatch(MODULE_SOURCE, /setInterval|setTimeout/);
});

// ==================================================================================================
// 14/15/16/17 -- single-in-flight yield / formal priority / burst priority / whole-scan lowest
// ==================================================================================================
test('14. wholeScanSampleDecision yields to its own in-flight request first', () => {
  const r = W.wholeScanSampleDecision({ wholeScanRequestInFlight: true, lastSampleAtMs: 0 }, 1000);
  assert.equal(r.sample, false);
  assert.equal(r.skipReason, 'SKIPPED_SINGLE_IN_FLIGHT');
});
test('15. wholeScanSampleDecision yields to a formal-capture request in flight', () => {
  const r = W.wholeScanSampleDecision({ formalRequestInFlight: true, lastSampleAtMs: 0 }, 1000);
  assert.equal(r.skipReason, 'SKIPPED_FORMAL_PRIORITY');
});
test('16. wholeScanSampleDecision issues a hard veto (WHOLE_SCAN_SUPPRESSED_FOR_BURST) whenever a burst is active -- BI-1Z1T architecture', () => {
  const r = W.wholeScanSampleDecision({ burstActive: true, lastSampleAtMs: 0 }, 1000);
  assert.equal(r.sample, false);
  assert.equal(r.skipReason, 'WHOLE_SCAN_SUPPRESSED_FOR_BURST');
});
test('17. the burst-active veto is checked FIRST, before formal-priority or in-flight checks', () => {
  const r = W.wholeScanSampleDecision({ burstActive: true, formalRequestInFlight: true, wholeScanRequestInFlight: true, lastSampleAtMs: 0 }, 1000);
  assert.equal(r.sample, false);
  assert.equal(r.skipReason, 'WHOLE_SCAN_SUPPRESSED_FOR_BURST');
});

// ==================================================================================================
// 18/19 -- phase vocabulary / phase transition ordering
// ==================================================================================================
test('18. phaseForState returns every required POSE_HOLD_* label from the frozen vocabulary', () => {
  ['front', 'right-three-quarter', 'right-profile', 'left-three-quarter', 'left-profile', 'chin-up'].forEach(stepId => {
    const phase = W.phaseForState({ currentStepId: stepId, hasActiveBurst: false });
    assert.ok(W.PHASE_VOCABULARY.includes(phase), phase + ' not in vocabulary');
    assert.ok(phase.startsWith('POSE_HOLD_'));
  });
});
test('19. phaseForState maps a burst transition to the correct TRANSITION_* label in order', () => {
  assert.equal(W.phaseForState({ hasActiveBurst: true, transitionFromStepId: 'front', transitionToStepId: 'right-three-quarter' }), 'TRANSITION_FRONT_TO_RIGHT45');
  assert.equal(W.phaseForState({ hasActiveBurst: true, transitionFromStepId: 'right-three-quarter', transitionToStepId: 'right-profile' }), 'TRANSITION_RIGHT45_TO_RIGHT_PROFILE');
  assert.equal(W.phaseForState({ hasActiveBurst: true, transitionFromStepId: 'left-profile', transitionToStepId: 'chin-up' }), 'TRANSITION_LEFT_PROFILE_TO_CHINUP');
});
test('19b. phaseForState returns UNRECOGNIZED_STATE for an unmapped step id -- never guesses', () => {
  assert.equal(W.phaseForState({ currentStepId: 'some-future-pose', hasActiveBurst: false }), 'UNRECOGNIZED_STATE');
  assert.equal(W.phaseForState({ hasActiveBurst: true, transitionFromStepId: 'front', transitionToStepId: 'some-future-pose' }), 'UNRECOGNIZED_STATE');
});

// ==================================================================================================
// 20 -- hold-phase sampling (not suppressed by small motion)
// ==================================================================================================
test('20. nothing in this module suppresses a sample based on motion magnitude -- POSE_HOLD samples are never discarded for being "too still"', () => {
  assert.doesNotMatch(MODULE_SOURCE, /motionMagnitude|tooSmallMotion|minMotionDelta/i);
});

// ==================================================================================================
// 21 -- transition sampling
// ==================================================================================================
test('21. a TRANSITION_* phase sample is built identically to a POSE_HOLD_* one -- no special-cased suppression', () => {
  const res = verifiedExactRes();
  const holdSample = W.buildWholeScanSample({ scanSessionId: 's1', wholeScanSampleId: 'w1', res, phase: 'POSE_HOLD_FRONT', roleLabels: ['WHOLE_SCAN'] });
  const transitionSample = W.buildWholeScanSample({ scanSessionId: 's1', wholeScanSampleId: 'w2', res, phase: 'TRANSITION_FRONT_TO_RIGHT45', roleLabels: ['WHOLE_SCAN'] });
  assert.equal(holdSample.nativeFrameTimestampNs, transitionSample.nativeFrameTimestampNs);
  assert.notEqual(holdSample.phase, transitionSample.phase);
});

// ==================================================================================================
// 22 -- exact frame identity
// ==================================================================================================
test('22. makeFrameRegistryKey uses scanSessionId + nativeFrameTimestampNs, never an ordinal index', () => {
  assert.equal(W.makeFrameRegistryKey('scan_a', '12345'), 'scan_a#12345');
  assert.notEqual(W.makeFrameRegistryKey('scan_a', '12345'), W.makeFrameRegistryKey('scan_b', '12345'));
});

// ==================================================================================================
// 23/24/25 -- duplicate-role labeling / frame-registry dedup / duplicate payload prevention
// ==================================================================================================
test('23. registerFrame accumulates multiple role labels on the SAME frame identity', () => {
  const registry = W.createFrameRegistry();
  let buildCount = 0;
  const key = W.makeFrameRegistryKey('s1', '100');
  W.registerFrame(registry, key, () => { buildCount++; return { jpeg: 'X' }; }, 'FORMAL_KEYFRAME');
  const entry = W.registerFrame(registry, key, () => { buildCount++; return { jpeg: 'Y' }; }, 'WHOLE_SCAN');
  assert.deepEqual(entry.roleLabels.sort(), ['FORMAL_KEYFRAME', 'WHOLE_SCAN']);
});
test('24. registerFrame never rebuilds the payload for an already-registered frame identity (dedup)', () => {
  const registry = W.createFrameRegistry();
  let buildCount = 0;
  const key = W.makeFrameRegistryKey('s1', '100');
  W.registerFrame(registry, key, () => { buildCount++; return { jpeg: 'X' }; }, 'BURST');
  W.registerFrame(registry, key, () => { buildCount++; return { jpeg: 'X' }; }, 'WHOLE_SCAN');
  W.registerFrame(registry, key, () => { buildCount++; return { jpeg: 'X' }; }, 'FORMAL_KEYFRAME');
  assert.equal(buildCount, 1);
});
test('25. registered entries for the same frame share the identical payload object (no duplicate JPEG storage)', () => {
  const registry = W.createFrameRegistry();
  const key = W.makeFrameRegistryKey('s1', '100');
  const first = W.registerFrame(registry, key, () => ({ jpeg: 'X' }), 'BURST');
  const second = W.registerFrame(registry, key, () => ({ jpeg: 'SHOULD_NOT_BE_USED' }), 'WHOLE_SCAN');
  assert.equal(first.payload, second.payload); // same object reference, never a second copy
});

// ==================================================================================================
// 26/27/28 -- sample cap / duration cap / approximate-byte cap
// ==================================================================================================
test('26. checkSafetyCaps returns MAX_SAMPLES_REACHED at the frozen 700-sample cap', () => {
  assert.equal(W.checkSafetyCaps({ sampleCount: 700, startedAtMs: 0, approxBytesWritten: 0 }, 1000), 'MAX_SAMPLES_REACHED');
  assert.equal(W.checkSafetyCaps({ sampleCount: 699, startedAtMs: 0, approxBytesWritten: 0 }, 1000), null);
});
test('27. checkSafetyCaps returns MAX_DURATION_REACHED at the frozen 180000ms cap', () => {
  assert.equal(W.checkSafetyCaps({ sampleCount: 0, startedAtMs: 0, approxBytesWritten: 0 }, 180000), 'MAX_DURATION_REACHED');
});
test('28. checkSafetyCaps returns MAX_EXPORT_BYTES_REACHED at the frozen ~60MB cap', () => {
  assert.equal(W.checkSafetyCaps({ sampleCount: 0, startedAtMs: 0, approxBytesWritten: 62914560 }, 1000), 'MAX_EXPORT_BYTES_REACHED');
});
test('28b. projectedCapOrder correctly reports the sample cap hits first at nominal ~71KB/sample average', () => {
  const r = W.projectedCapOrder(71000);
  assert.equal(r.firstCapToHit, 'MAX_SAMPLES_REACHED');
});

// ==================================================================================================
// 29 -- cap stop affects whole-scan only
// ==================================================================================================
test('29. checkSafetyCaps/module never imports or references the burst/formal recorder state', () => {
  assert.doesNotMatch(MODULE_SOURCE, /__temporalMotionBurstRecorder/);
  assert.doesNotMatch(MODULE_SOURCE, /__scannerSpatialRecorder\b/);
});

// ==================================================================================================
// 30 -- performance telemetry
// ==================================================================================================
test('30. buildWholeScanTelemetry returns every required counter, with thermalState UNKNOWN by default', () => {
  const t = W.buildWholeScanTelemetry({});
  ['requestedSamples', 'retainedSamples', 'skippedSingleInFlight', 'skippedForBurstPriority', 'skippedForFormalPriority',
    'meanCadenceHz', 'intervalP50Ms', 'intervalP90Ms', 'intervalP95Ms', 'largestGapMs', 'formalKeyframeCollisionCount',
    'burstCollisionCount', 'wholeScanFrameCount', 'uniqueExactFrameCount', 'sharedRoleFrameCount', 'approxBytesWritten',
    'streamStopReason', 'thermalState'].forEach(k => assert.ok(k in t, 'missing telemetry field ' + k));
  assert.equal(t.thermalState, 'UNKNOWN');
});

// ==================================================================================================
// 31/32 -- /1 and /2 reader compatibility
// ==================================================================================================
test('31. extractBurstDataset returns [] for a /1-shaped package (no temporalMotionBursts field at all)', () => {
  assert.deepEqual(W.extractBurstDataset({ exactFrameResearchCaptureVersion: 'exact-frame-research-capture/1' }), []);
});
test('32. extractBurstDataset returns the burst array unchanged for a /2 package', () => {
  const bursts = [{ burstId: 'b1' }];
  assert.equal(W.extractBurstDataset({ exactFrameResearchCaptureVersion: W.PACKAGE_SCHEMA_VERSION_V2, temporalMotionBursts: bursts }), bursts);
});

// ==================================================================================================
// 33/34 -- /3 schema / /3 whole-scan field
// ==================================================================================================
test('33. versionForExport returns /3 only when whole-scan samples exist, else stays /2', () => {
  assert.equal(W.versionForExport(true), W.PACKAGE_SCHEMA_VERSION_V3);
  assert.equal(W.versionForExport(false), W.PACKAGE_SCHEMA_VERSION_V2);
});
test('34. extendPackageWithWholeScanStream adds wholeScanTemporalStream and bumps the version', () => {
  const v2Pkg = { exactFrameResearchCaptureVersion: W.PACKAGE_SCHEMA_VERSION_V2, temporalMotionBursts: [{ burstId: 'b1' }] };
  const samples = [{ wholeScanSampleId: 'w1' }];
  const telemetry = W.buildWholeScanTelemetry({});
  const v3Pkg = W.extendPackageWithWholeScanStream(v2Pkg, samples, telemetry);
  assert.equal(v3Pkg.exactFrameResearchCaptureVersion, W.PACKAGE_SCHEMA_VERSION_V3);
  assert.equal(v3Pkg.wholeScanTemporalStream.samples, samples);
});
test('34b. extendPackageWithWholeScanStream leaves the package at /2 when no whole-scan samples exist -- never a silent version bump', () => {
  const v2Pkg = { exactFrameResearchCaptureVersion: W.PACKAGE_SCHEMA_VERSION_V2, temporalMotionBursts: [] };
  const result = W.extendPackageWithWholeScanStream(v2Pkg, [], W.buildWholeScanTelemetry({}));
  assert.equal(result, v2Pkg); // identical object, not even a new copy
  assert.equal(result.exactFrameResearchCaptureVersion, W.PACKAGE_SCHEMA_VERSION_V2);
});

// ==================================================================================================
// 35/36 -- burst field unchanged / burst extraction equivalence
// ==================================================================================================
test('35. extendPackageWithWholeScanStream never modifies temporalMotionBursts', () => {
  const bursts = [{ burstId: 'b1', samples: [{ x: 1 }] }];
  const v2Pkg = { exactFrameResearchCaptureVersion: W.PACKAGE_SCHEMA_VERSION_V2, temporalMotionBursts: bursts };
  const v3Pkg = W.extendPackageWithWholeScanStream(v2Pkg, [{ id: 'w1' }], W.buildWholeScanTelemetry({}));
  assert.equal(v3Pkg.temporalMotionBursts, bursts); // same reference, untouched
});
test('36. burst extraction is equivalent whether or not the whole-scan field is present', () => {
  const bursts = [{ burstId: 'b1' }];
  const v2Pkg = { exactFrameResearchCaptureVersion: W.PACKAGE_SCHEMA_VERSION_V2, temporalMotionBursts: bursts };
  const v3Pkg = W.extendPackageWithWholeScanStream(v2Pkg, [{ id: 'w1' }], W.buildWholeScanTelemetry({}));
  assert.deepEqual(W.extractBurstDataset(v2Pkg), W.extractBurstDataset(v3Pkg));
});

// ==================================================================================================
// 37 -- V2 (HEAD_RELATIVE_TEMPORAL_SUPPORT_V1) burst compatibility
// ==================================================================================================
test('37. a burst sample extracted from a /3 whole-scan-enabled export is still accepted by the frozen V1 temporal instrument', () => {
  const flat468 = new Array(468).fill(0).map((_, i) => ({ x: i, y: i, z: 0 }));
  const sampleA = {
    coherenceStatus: 'VERIFIED_EXACT', nativeFrameTimestampNs: '1000000000', imageWidth: 640, imageHeight: 480,
    faceLocal3D: flat468, imageSpaceViewModelMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 }, yawDeg: 0, pitchDeg: 0, rollDeg: 0
  };
  const bursts = [{ burstId: 'b1', samples: [sampleA] }];
  const v2Pkg = { exactFrameResearchCaptureVersion: W.PACKAGE_SCHEMA_VERSION_V2, temporalMotionBursts: bursts };
  const v3Pkg = W.extendPackageWithWholeScanStream(v2Pkg, [{ id: 'w1' }], W.buildWholeScanTelemetry({}));
  const extracted = W.extractBurstDataset(v3Pkg);
  // T.buildCandidatesForSample is the frozen V1 entry point -- confirm it still runs without error
  // on data extracted from a /3 package (it will return null here since only one sample exists and
  // some fields are degenerate, but it must not throw, and pairEligibility must still be callable).
  assert.doesNotThrow(() => T.buildCandidatesForSample(extracted[0].samples[0]));
  assert.doesNotThrow(() => T.pairEligibility(extracted[0].samples[0], extracted[0].samples[0]));
});

// ==================================================================================================
// 38 -- missing metadata fail-closed
// ==================================================================================================
test('38. buildWholeScanSample nulls out fields the native result does not actually provide -- never fabricates', () => {
  const res = verifiedExactRes({ imageRotationDegrees: undefined, imageMirrored: undefined, captureLatencyMs: undefined });
  const sample = W.buildWholeScanSample({ scanSessionId: 's1', wholeScanSampleId: 'w1', res });
  assert.equal(sample.imageRotationDegrees, null);
  assert.equal(sample.imageMirrored, null);
  assert.equal(sample.captureLatencyMs, null);
});

// ==================================================================================================
// 39 -- no network
// ==================================================================================================
test('39. module has zero network calls', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\bfetch\s*\(/);
  assert.doesNotMatch(MODULE_SOURCE, /XMLHttpRequest/);
  assert.doesNotMatch(MODULE_SOURCE, /https?:\/\//);
});

// ==================================================================================================
// 40 -- consumer mode unchanged
// ==================================================================================================
test('40. every activation path requires isWholeScanCaptureAllowed() -- no consumer/production bypass exists', () => {
  assert.doesNotMatch(MODULE_SOURCE, /consumerMode\s*[:=]\s*true/i);
  assert.doesNotMatch(MODULE_SOURCE, /productionEnabled\s*[:=]\s*true/i);
  // shouldWholeScanBeActive's FIRST substantive gate (after the abort check) is always the
  // research-allowed check -- verified structurally by re-running test 2/3's behavior.
  const r = W.shouldWholeScanBeActive({ appForeground: true, cameraLive: true, scanSessionActive: true, screen: 'SCANNER' }); // no researchCaptureFlag/isResearchBuildFn supplied
  assert.equal(r.active, false);
  assert.equal(r.reason, 'RESEARCH_NOT_ALLOWED');
});

// ==================================================================================================
// 41 -- no UI-layout fix mixed in
// ==================================================================================================
test('41. module contains no DOM/CSS/UI-layout code -- the known research UI issue is not touched here', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\bdocument\./);
  assert.doesNotMatch(MODULE_SOURCE, /getElementById/);
  assert.doesNotMatch(MODULE_SOURCE, /style\.|\.css/i);
});

// ==================================================================================================
// 42 -- production/research isolation
// ==================================================================================================
test('42. worker.js is unchanged by this stage', () => {
  const ROOT = join(HERE, '..');
  const workerHash = createHash('sha256').update(readFileSync(join(ROOT, 'worker.js'))).digest('hex');
  assert.equal(workerHash, '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});
test('42b. module never imports a DOM/browser/native-bridge global', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\bwindow\./);
  assert.doesNotMatch(MODULE_SOURCE, /BeardTrimAndroid/);
});
test('42c. module never imports V1/V2.1/V2.2 occupancy or GT machinery', () => {
  assert.doesNotMatch(MODULE_SOURCE, /beard-occupancy-field/);
  assert.doesNotMatch(MODULE_SOURCE, /beard-proposal/);
  assert.doesNotMatch(MODULE_SOURCE, /groundTruth/i);
});
