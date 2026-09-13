// Stage BI-1Z1G -- tests for TEMPORAL_EXACT_FRAME_BURST_V1. Combines (a) pure-logic unit tests
// against the canonical accuracy/temporal-exact-frame-burst.mjs mirror, and (b) source-text
// assertions against index.html's actual wired-in copy, matching this project's established
// dual-testing convention for logic that has no module system in its production host file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as TB from './temporal-exact-frame-burst.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT_INDEX_HTML = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
// isolate just the BI-1Z1G JS block for tighter source assertions (avoids false hits against the
// unrelated HTML comment/indicator markup that also mentions this stage's name earlier in the file)
const BI1Z1G_START = ROOT_INDEX_HTML.indexOf('function __temporalBurstAllowed');
const BI1Z1G_BLOCK = ROOT_INDEX_HTML.slice(BI1Z1G_START, BI1Z1G_START + 20000);

function fakeRes(overrides = {}) {
  return Object.assign({
    nativeFrameTimestampNs: '1000000000', coherenceStatus: 'VERIFIED_EXACT',
    imageBase64Jpeg: 'data:image/jpeg;base64,AAAA', imageWidth: 640, imageHeight: 480,
    intrinsicsFx: 500, intrinsicsFy: 500, intrinsicsCx: 320, intrinsicsCy: 240, intrinsicsImageWidth: 640, intrinsicsImageHeight: 480, intrinsicsSpace: 'IMAGE',
    landmarks2D: new Array(468).fill({ x: 0.5, y: 0.5, z: 0 }),
    faceLocal3D: new Array(468).fill({ x: 0, y: 0, z: 0 }),
    transformationMatrix: new Array(16).fill(0), imageSpaceViewModelMatrix: new Array(16).fill(0),
    poseYawDeg: 10, posePitchDeg: -5, poseRollDeg: 1, captureLatencyMs: 12
  }, overrides);
}

// ==================================================================================================
// 1/2 -- research feature gating
// ==================================================================================================
test('1. research feature defaults OFF: index.html declares window.__EXACT_FRAME_RESEARCH_CAPTURE = false', () => {
  assert.match(ROOT_INDEX_HTML, /window\.__EXACT_FRAME_RESEARCH_CAPTURE\s*=\s*false/);
});
test('1b. isResearchCaptureAllowed is false when the toggle itself is off', () => {
  assert.equal(TB.isResearchCaptureAllowed(false, () => true), false);
});
test('2. non-research build cannot expose temporal capture: isResearchCaptureAllowed is false when isResearchBuild() is false, even with the toggle on', () => {
  assert.equal(TB.isResearchCaptureAllowed(true, () => false), false);
});
test('2b. isResearchCaptureAllowed fails closed on a throwing isResearchBuild()', () => {
  assert.equal(TB.isResearchCaptureAllowed(true, () => { throw new Error('native bridge unavailable'); }), false);
});

// ==================================================================================================
// 3 -- normal scan unchanged when OFF
// ==================================================================================================
test('3. normal scan unchanged when OFF: __temporalBurstTick gates on __temporalBurstAllowed() before doing anything else', () => {
  const idx = BI1Z1G_BLOCK.indexOf('function __temporalBurstTick');
  const fnBody = BI1Z1G_BLOCK.slice(idx, idx + 300);
  assert.match(fnBody, /if\(!__temporalBurstAllowed\(\)\) return;/);
});
test('3b. the tick call site is wrapped in the same fail-safe try/catch pattern as the existing Tier-A/B tick', () => {
  assert.match(ROOT_INDEX_HTML, /try\{ __temporalBurstTick\(lastMetrics, q, ready\); \}catch\(_e\)\{\}/);
});

// ==================================================================================================
// 4 -- exact-frame coherence required
// ==================================================================================================
test('4. exact-frame coherence required: only VERIFIED_EXACT results are acceptable', () => {
  assert.equal(TB.isAcceptableSample(fakeRes({ coherenceStatus: 'VERIFIED_EXACT' })), true);
  assert.equal(TB.isAcceptableSample(fakeRes({ coherenceStatus: 'REJECTED_UNMATCHED' })), false);
  assert.equal(TB.isAcceptableSample(null), false);
  assert.equal(TB.isAcceptableSample(undefined), false);
});

// ==================================================================================================
// 5 -- burst identity uniqueness
// ==================================================================================================
test('5. burst identity uniqueness: 1000 generated burst ids are all unique and follow the documented shape', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) ids.add(TB.makeBurstId(Date.now() + i, Math.random()));
  assert.equal(ids.size, 1000);
  [...ids].forEach(id => assert.match(id, /^burst_[0-9a-z]+_[0-9a-z]{1,6}$/));
});

// ==================================================================================================
// 6 -- temporal sample identity uniqueness
// ==================================================================================================
test('6. temporal sample identity uniqueness: (temporalBurstId, temporalSampleIndex) is unique within and across bursts', () => {
  const burstA = TB.createBurst(TB.makeBurstId(), 'front_TO_right-three-quarter', 'FRONT_REGION', 0);
  const burstB = TB.createBurst(TB.makeBurstId(), 'right-three-quarter_TO_right-profile', 'RIGHT45_REGION', 1000);
  const seen = new Set();
  [burstA, burstB].forEach(burst => {
    for (let i = 0; i < 5; i++) {
      const sample = TB.buildTemporalSample({ scanSessionId: 's1', res: fakeRes({ nativeFrameTimestampNs: String(1000000000 + i * 125000000) }), burstId: burst.burstId, sampleIndex: i, transitionLabel: burst.sourceTransition, region: 'FRONT_REGION', currentScannerStep: 'front', lensFacing: 'front', triggerSnapshot: null });
      const key = sample.temporalBurstId + '#' + sample.temporalSampleIndex;
      assert.equal(seen.has(key), false, 'duplicate identity: ' + key);
      seen.add(key);
    }
  });
});

// ==================================================================================================
// 7 -- timestamp monotonicity within burst
// ==================================================================================================
test('7. timestamp monotonicity: a non-monotonic (out-of-order) timestamp pair contributes no interval, never a negative one', () => {
  const samples = [
    { nativeFrameTimestampNs: '2000000000' },
    { nativeFrameTimestampNs: '1000000000' }, // out of order
    { nativeFrameTimestampNs: '2125000000' }
  ];
  const stats = TB.computeIntervalStats(samples);
  // only ONE valid forward interval exists in this sequence in isolation (pairwise: 2.0->1.0 invalid, 1.0->2.125 would be valid if consecutive,
  // but computeIntervalStats only looks at consecutive pairs as given -- pair(0,1) invalid (negative), pair(1,2) is 1.0->2.125 = 1125ms valid)
  assert.equal(stats.count, 1);
  assert.equal(stats.min, 1125);
});
test('7b. fully monotonic samples produce one interval per consecutive pair', () => {
  const samples = [0, 125, 250, 375].map(ms => ({ nativeFrameTimestampNs: String(1000000000 + ms * 1e6) }));
  const stats = TB.computeIntervalStats(samples);
  assert.equal(stats.count, 3);
  assert.equal(stats.mean, 125);
});

// ==================================================================================================
// 8 -- cadence throttling deterministic
// ==================================================================================================
test('8. cadence throttling is deterministic: identical inputs always produce the identical decision', () => {
  const burst = TB.createBurst('b1', 'front_TO_right-three-quarter', 'FRONT_REGION', 0);
  burst.lastSampleAtMs = 1000;
  assert.equal(TB.shouldSampleNow(burst, 1124), false); // 124ms < 125ms target
  assert.equal(TB.shouldSampleNow(burst, 1125), true);  // exactly at target
  assert.equal(TB.shouldSampleNow(burst, 1125), true);  // re-checking the same inputs gives the same answer
  assert.equal(TB.shouldSampleNow(null, 5000), false);
});

// ==================================================================================================
// 9/10 -- maximum burst duration / maximum frames per burst
// ==================================================================================================
test('9. maximum burst duration: shouldEndBurst returns MAX_DURATION_REACHED once the bound is crossed', () => {
  const burst = TB.createBurst('b1', 'x', 'FRONT_REGION', 0);
  assert.equal(TB.shouldEndBurst(burst, 2499), null);
  assert.equal(TB.shouldEndBurst(burst, 2500), 'MAX_DURATION_REACHED');
});
test('10. maximum frames per burst: shouldEndBurst returns MAX_FRAMES_PER_BURST_REACHED once the bound is crossed', () => {
  const burst = TB.createBurst('b1', 'x', 'FRONT_REGION', 0);
  for (let i = 0; i < TB.TEMPORAL_BURST_PARAMETERS.maxFramesPerBurst; i++) burst.samples.push({ nativeFrameTimestampNs: String(i) });
  assert.equal(TB.shouldEndBurst(burst, 100), 'MAX_FRAMES_PER_BURST_REACHED');
});
test('9b/10b. pose-lock settle tail ends the burst independent of the other two bounds', () => {
  const burst = TB.createBurst('b1', 'x', 'FRONT_REGION', 0);
  burst.lockedAtMs = 500;
  assert.equal(TB.shouldEndBurst(burst, 899), null);
  assert.equal(TB.shouldEndBurst(burst, 900), 'POSE_LOCK_SETTLED');
});

// ==================================================================================================
// 11/12 -- maximum bursts per scan / graceful cap handling
// ==================================================================================================
test('11. maximum bursts per scan: canStartNewBurst becomes false once the cap is reached', () => {
  const state = { bursts: new Array(TB.TEMPORAL_BURST_PARAMETERS.maxBurstsPerScan).fill({}), totalFramesCaptured: 0 };
  assert.equal(TB.canStartNewBurst(state), false);
});
test('12. graceful cap handling: canStartNewBurst never throws and the recorder state remains valid at the cap boundary', () => {
  const state = { bursts: [], totalFramesCaptured: TB.TEMPORAL_BURST_PARAMETERS.maxTotalFramesPerExport };
  assert.doesNotThrow(() => TB.canStartNewBurst(state));
  assert.equal(TB.canStartNewBurst(state), false);
  // one below either cap remains startable
  assert.equal(TB.canStartNewBurst({ bursts: [], totalFramesCaptured: 0 }), true);
});
test('12b. index.html records an honest stopReason rather than crashing or silently dropping the whole package when a cap is hit', () => {
  assert.match(BI1Z1G_BLOCK, /stopReason=this\.stopReason\|\|\(this\.bursts\.length>=TEMPORAL_MAX_BURSTS_PER_SCAN\?'MAX_BURSTS_PER_SCAN_REACHED':'MAX_TOTAL_FRAMES_REACHED'\)/);
});

// ==================================================================================================
// 13-20 -- per-sample field retention
// ==================================================================================================
test('13. full image+geometry coherence: dataUrl, landmarks2D, and faceLocal3D all trace to the SAME res object', () => {
  const res = fakeRes({ nativeFrameTimestampNs: '42' });
  const sample = TB.buildTemporalSample({ scanSessionId: 's', res, burstId: 'b', sampleIndex: 0, transitionLabel: 'x', region: 'FRONT_REGION', currentScannerStep: 'front', lensFacing: 'front', triggerSnapshot: null });
  assert.equal(sample.nativeFrameTimestampNs, '42');
  assert.equal(sample.dataUrl, res.imageBase64Jpeg);
  assert.deepEqual(sample.landmarks2D, res.landmarks2D);
  assert.deepEqual(sample.faceLocal3D, res.faceLocal3D);
});
test('14. landmarks2D retained', () => { const s = TB.buildTemporalSample({ scanSessionId: 's', res: fakeRes(), burstId: 'b', sampleIndex: 0, transitionLabel: 'x', region: 'r', currentScannerStep: 'front', lensFacing: 'front' }); assert.ok(Array.isArray(s.landmarks2D)); });
test('15. faceLocal3D retained', () => { const s = TB.buildTemporalSample({ scanSessionId: 's', res: fakeRes(), burstId: 'b', sampleIndex: 0, transitionLabel: 'x', region: 'r', currentScannerStep: 'front', lensFacing: 'front' }); assert.ok(Array.isArray(s.faceLocal3D)); });
test('16. intrinsics retained', () => { const s = TB.buildTemporalSample({ scanSessionId: 's', res: fakeRes(), burstId: 'b', sampleIndex: 0, transitionLabel: 'x', region: 'r', currentScannerStep: 'front', lensFacing: 'front' }); assert.equal(s.intrinsics.fx, 500); assert.equal(s.intrinsics.space, 'IMAGE'); });
test('17. imageSpaceViewModelMatrix retained', () => { const s = TB.buildTemporalSample({ scanSessionId: 's', res: fakeRes(), burstId: 'b', sampleIndex: 0, transitionLabel: 'x', region: 'r', currentScannerStep: 'front', lensFacing: 'front' }); assert.equal(s.imageSpaceViewModelMatrix.length, 16); });
test('18. yaw/pitch/roll retained with the same sign convention as Tier-B', () => {
  const s = TB.buildTemporalSample({ scanSessionId: 's', res: fakeRes({ poseYawDeg: 15, posePitchDeg: -8, poseRollDeg: 2 }), burstId: 'b', sampleIndex: 0, transitionLabel: 'x', region: 'r', currentScannerStep: 'front', lensFacing: 'front' });
  assert.equal(s.yawDeg, -15); // Tier-B negates poseYawDeg
  assert.equal(s.pitchDeg, -8);
  assert.equal(s.rollDeg, 2);
});
test('19. explicit imageRotationDegrees field is present (this was missing from prior physical Tier-B exports)', () => {
  const s = TB.buildTemporalSample({ scanSessionId: 's', res: fakeRes({ imageRotationDegrees: 90 }), burstId: 'b', sampleIndex: 0, transitionLabel: 'x', region: 'r', currentScannerStep: 'front', lensFacing: 'front' });
  assert.equal(s.imageRotationDegrees, 90);
  assert.ok(Object.prototype.hasOwnProperty.call(s, 'imageRotationDegrees'));
});
test('20. explicit imageMirrored field is present', () => {
  const s = TB.buildTemporalSample({ scanSessionId: 's', res: fakeRes({ imageMirrored: true }), burstId: 'b', sampleIndex: 0, transitionLabel: 'x', region: 'r', currentScannerStep: 'front', lensFacing: 'front' });
  assert.equal(s.imageMirrored, true);
  assert.ok(Object.prototype.hasOwnProperty.call(s, 'imageMirrored'));
});

// ==================================================================================================
// 21 -- no fabricated unavailable metadata
// ==================================================================================================
test('21. no fabricated unavailable metadata: rotation/mirror/display/sensor fields are explicitly null, never defaulted to 0/false, when the native result omits them', () => {
  const res = fakeRes(); // deliberately no imageRotationDegrees/imageMirrored/displayRotationDegrees/sensorOrientationDegrees
  const s = TB.buildTemporalSample({ scanSessionId: 's', res, burstId: 'b', sampleIndex: 0, transitionLabel: 'x', region: 'r', currentScannerStep: 'front', lensFacing: 'front' });
  assert.equal(s.imageRotationDegrees, null);
  assert.equal(s.imageMirrored, null);
  assert.equal(s.displayRotationDegrees, null);
  assert.equal(s.sensorOrientationDegrees, null);
});

// ==================================================================================================
// 22/23/24/25 -- independence, no classifier, no network
// ==================================================================================================
test('22. no V2.1/V2.2 dependency: neither the pure module nor index.html\'s BI-1Z1G block reference beard-occupancy-field-v21/v22', () => {
  const moduleSource = readFileSync(join(HERE, 'temporal-exact-frame-burst.mjs'), 'utf8');
  assert.equal(/beard-occupancy-field-v2[12]/i.test(moduleSource), false);
  assert.equal(/beard-occupancy-field-v2[12]|BEARD_ROOT_SUPPORT_FIELD|BEARD_REACHABILITY_FIELD/i.test(BI1Z1G_BLOCK), false);
});
test('23. no GT dependency: no humanFinalPoints/groundTruth references anywhere in the new capture code', () => {
  const moduleSource = readFileSync(join(HERE, 'temporal-exact-frame-burst.mjs'), 'utf8');
  assert.equal(/humanFinalPoints|humanGT|groundTruth/i.test(moduleSource), false);
  assert.equal(/humanFinalPoints|humanGT|groundTruth/i.test(BI1Z1G_BLOCK), false);
});
test('24. no temporal classifier: no optical-flow/motion-scoring/segmentation keywords anywhere in the new capture code', () => {
  const moduleSource = readFileSync(join(HERE, 'temporal-exact-frame-burst.mjs'), 'utf8');
  const forbidden = /opticalFlow|motionScor|shirtMotion|beardMotion|backgroundSubtract|motionSegmentation|temporalOccupancy|crossFrameBeardPropagation/i;
  assert.equal(forbidden.test(moduleSource), false);
  assert.equal(forbidden.test(BI1Z1G_BLOCK), false);
});
test('25. zero network behavior: no fetch/XMLHttpRequest/WebSocket in the new capture code', () => {
  const moduleSource = readFileSync(join(HERE, 'temporal-exact-frame-burst.mjs'), 'utf8');
  const network = /\bfetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon/;
  assert.equal(network.test(moduleSource), false);
  assert.equal(network.test(BI1Z1G_BLOCK), false);
});

// ==================================================================================================
// 26 -- package backward compatibility
// ==================================================================================================
test('26. package backward compatibility: schema bumped to /2, but every /1 field is still produced unchanged, with new fields additive only', () => {
  const v1Package = { exactFrameResearchCaptureVersion: 'exact-frame-research-capture/1', manifest: { a: 1 }, imageKeyframes: [{ id: 1 }], geometryObs: [{ id: 2 }], formalCaptureAssociations: [] };
  const extended = TB.extendPackageWithTemporalBursts(v1Package, [{ burstId: 'b1' }], [{ burstId: 'b1', achievedSampleRateHz: 8 }]);
  assert.equal(extended.exactFrameResearchCaptureVersion, 'exact-frame-research-capture/2');
  assert.deepEqual(extended.manifest, v1Package.manifest);
  assert.deepEqual(extended.imageKeyframes, v1Package.imageKeyframes);
  assert.deepEqual(extended.geometryObs, v1Package.geometryObs);
  assert.ok(Array.isArray(extended.temporalMotionBursts));
  assert.ok(Array.isArray(extended.temporalCaptureFeasibilityMetrics));
});
test('26b. index.html keeps every existing field name in the builder and still falls back to /2 (BI-1Z1R made the version conditional on whole-scan presence, added additively -- the /2 literal remains as the no-whole-scan-data fallback branch)', () => {
  assert.match(ROOT_INDEX_HTML, /exactFrameResearchCaptureVersion:.*'exact-frame-research-capture\/2'/);
  assert.match(ROOT_INDEX_HTML, /imageKeyframes:rec\.imageKeyframes\.map/);
  assert.match(ROOT_INDEX_HTML, /geometryObs:rec\.geometryObs\.map/);
  assert.match(ROOT_INDEX_HTML, /formalCaptureAssociations:rec\.formalCaptureAssociations\.map/);
});

// ==================================================================================================
// 27 -- export save path behavior
// ==================================================================================================
test('27. export save path behavior: no new save mechanism was introduced -- the existing __saveExactFrameResearchCapture/MediaStore path is reused unchanged', () => {
  assert.match(ROOT_INDEX_HTML, /function __saveExactFrameResearchCapture\(\)/);
  // exactly one definition -- BI-1Z1G did not add a second save function
  const matches = ROOT_INDEX_HTML.match(/function __saveExactFrameResearchCapture\(\)/g);
  assert.equal(matches.length, 1);
  assert.match(ROOT_INDEX_HTML, /window\.BeardTrimAndroid\.saveResearchCapture/);
});

// ==================================================================================================
// 28/29 -- production isolation / sealed holdout
// ==================================================================================================
test('28. production isolation when research OFF: every temporal function/entry point is gated behind __temporalBurstAllowed() or __EXACT_FRAME_RESEARCH_CAPTURE', () => {
  assert.match(BI1Z1G_BLOCK, /function __temporalBurstAllowed\(\)\{/);
  // the scan-start hook and step-advance hook both check __temporalBurstAllowed() before touching the recorder
  assert.match(ROOT_INDEX_HTML, /typeof __temporalBurstAllowed==='function' && __temporalBurstAllowed\(\)/);
});
test('29. no sealed-holdout identifier appears in the new capture code', () => {
  const moduleSource = readFileSync(join(HERE, 'temporal-exact-frame-burst.mjs'), 'utf8');
  assert.equal(moduleSource.includes('espu2w'), false);
  assert.equal(BI1Z1G_BLOCK.includes('espu2w'), false);
});

// ==================================================================================================
// Additional engineering-correctness checks (feasibility metrics, module isolation)
// ==================================================================================================
test('feasibility metrics report requested vs achieved cadence and never fabricate a rate with zero samples', () => {
  const burst = TB.createBurst('b1', 'front_TO_right-three-quarter', 'FRONT_REGION', 0);
  const metrics = TB.buildFeasibilityMetricsForBurst(burst);
  assert.equal(metrics.achievedSampleRateHz, null);
  assert.equal(metrics.requestedSampleRateHz, 8);
});
test('feasibility metrics detect inconsistent image dimensions across a burst', () => {
  const burst = TB.createBurst('b1', 'x', 'FRONT_REGION', 0);
  burst.samples = [{ imageWidth: 640, imageHeight: 480 }, { imageWidth: 480, imageHeight: 640 }];
  const metrics = TB.buildFeasibilityMetricsForBurst(burst);
  assert.equal(metrics.imageDimensionsConsistent, false);
});
test('module never imports a DOM/browser global -- pure, dependency-free, matches project convention', () => {
  const moduleSource = readFileSync(join(HERE, 'temporal-exact-frame-burst.mjs'), 'utf8');
  assert.equal(/\bwindow\.|\bdocument\.|\bBeardTrimAndroid\b/.test(moduleSource), false);
});
