// Stage BI-1Z1O -- synthetic/invariant tests for HEAD_RELATIVE_TEMPORAL_MEASUREMENT_V2. Pure
// synthetic fixtures; no physical capture, no GT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as V2 from './head-relative-temporal-measurement-v2.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_SOURCE = readFileSync(join(HERE, 'head-relative-temporal-measurement-v2.mjs'), 'utf8');
const DESIGN_PATH = 'D:/MettleTemp/analysis/bi1z1n_temporal_measurement_v2_design.json';
const PROTOCOL_PATH = 'D:/MettleTemp/analysis/bi1z1n_third_session_validation_protocol.json';
const V1_MODULE_PATH = join(HERE, 'head-relative-temporal-support-v1.mjs');

function usableResult(overrides = {}) {
  return Object.assign({
    id: 'HEAD_REFERENCE_6', family: 'HEAD_REFERENCE', anatomicalIndex: 6, anatomicalSide: null, region: null,
    provenanceTags: ['TRACKED_3D_SUPPORTED'], qualityState: 'PATCH_USABLE', searchRadiusPx: 6,
    headHypothesis: { unusable: false, zncc: 0.95, gradientZncc: 0.9, bestResidualDx: 1, bestResidualDy: 0, bestResidualMagnitude: 1 },
    staticHypothesis: { unusable: false, zncc: 0.85, gradientZncc: 0.8, bestResidualDx: 3, bestResidualDy: 1, bestResidualMagnitude: 3.16 }
  }, overrides);
}
function baseSpec(overrides = {}) {
  return Object.assign({
    scanSessionId: 'scan_test1', temporalBurstId: 'burst_test1', sampleATimestampNs: '1000000000', sampleBTimestampNs: '1125000000',
    pairIdentity: 'burst_test1#0#1', candidateResult: usableResult(),
    motionBin: 'SMALL', visibilityClass: 'NEAR_VISIBLE', captureSha256: 'a'.repeat(64)
  }, overrides);
}

// ==================================================================================================
// 1 -- V2 design hash
// ==================================================================================================
test('1. module records the exact frozen BI-1Z1N V2 design SHA256', () => {
  assert.equal(V2.BI1Z1N_DESIGN_SHA256, '1c822af649c2ea219cdadb245f0d7d1924a52db2f30a30b8b3939aab9407400c');
});
test('1b. design hash re-verification against the live artifact', () => {
  const buf = readFileSync(DESIGN_PATH);
  assert.equal(createHash('sha256').update(buf).digest('hex'), V2.BI1Z1N_DESIGN_SHA256);
});

// ==================================================================================================
// 2 -- third-session protocol hash
// ==================================================================================================
test('2. module records the exact frozen third-session protocol SHA256', () => {
  assert.equal(V2.BI1Z1N_THIRD_SESSION_PROTOCOL_SHA256, '5f1adb49b3f4560de04d41e80094433c080c80bf732d39e0f647abc2e116c9dd');
});
test('2b. protocol hash re-verification against the live artifact', () => {
  const buf = readFileSync(PROTOCOL_PATH);
  assert.equal(createHash('sha256').update(buf).digest('hex'), V2.BI1Z1N_THIRD_SESSION_PROTOCOL_SHA256);
});

// ==================================================================================================
// 3 -- residualDifference sign
// ==================================================================================================
test('3. packet residualDifference is positive when head required less correction than static', () => {
  const p = V2.buildTemporalMeasurementV2Packet(baseSpec());
  assert.equal(p.residualDifference, 3.16 - 1);
});
test('3b. packet residualDifference is negative when static required less correction', () => {
  const p = V2.buildTemporalMeasurementV2Packet(baseSpec({ candidateResult: usableResult({
    headHypothesis: { unusable: false, zncc: 0.9, gradientZncc: 0.9, bestResidualDx: 5, bestResidualDy: 0, bestResidualMagnitude: 5 },
    staticHypothesis: { unusable: false, zncc: 0.9, gradientZncc: 0.9, bestResidualDx: 1, bestResidualDy: 0, bestResidualMagnitude: 1 }
  }) }));
  assert.equal(p.residualDifference, 1 - 5);
});

// ==================================================================================================
// 4 -- residualDifference determinism
// ==================================================================================================
test('4. residualDifference is a pure deterministic function of the same inputs', () => {
  const spec = baseSpec();
  const a = V2.buildTemporalMeasurementV2Packet(spec).residualDifference;
  const b = V2.buildTemporalMeasurementV2Packet(spec).residualDifference;
  assert.equal(a, b);
});

// ==================================================================================================
// 5 -- safe residual ratio
// ==================================================================================================
test('5. safeResidualRatioV2 computes head/static with an explicit AVAILABLE state', () => {
  const r = V2.safeResidualRatioV2(2, 4);
  assert.equal(r.state, 'AVAILABLE');
  assert.equal(r.ratio, 0.5);
  assert.equal(r.headResidualMagnitude, 2);
  assert.equal(r.staticResidualMagnitude, 4);
});

// ==================================================================================================
// 6 -- zero static residual handling
// ==================================================================================================
test('6. safeResidualRatioV2 returns DEGENERATE_ZERO_DENOMINATOR (never Infinity) when static residual is zero', () => {
  const r = V2.safeResidualRatioV2(2, 0);
  assert.equal(r.state, 'DEGENERATE_ZERO_DENOMINATOR');
  assert.equal(r.ratio, null);
  assert.equal(r.headResidualMagnitude, 2); // raw numerator preserved regardless
  assert.equal(r.staticResidualMagnitude, 0); // raw denominator preserved regardless
});

// ==================================================================================================
// 7 -- zero head residual handling
// ==================================================================================================
test('7. safeResidualRatioV2 computes a normal 0-valued ratio when only the numerator is zero', () => {
  const r = V2.safeResidualRatioV2(0, 4);
  assert.equal(r.state, 'AVAILABLE');
  assert.equal(r.ratio, 0);
});

// ==================================================================================================
// 8 -- both-zero handling
// ==================================================================================================
test('8. safeResidualRatioV2 treats a zero/zero pair as DEGENERATE_ZERO_DENOMINATOR, not NaN', () => {
  const r = V2.safeResidualRatioV2(0, 0);
  assert.equal(r.state, 'DEGENERATE_ZERO_DENOMINATOR');
  assert.equal(r.ratio, null);
  assert.equal(Number.isNaN(r.ratio), false);
});

// ==================================================================================================
// 9 -- finite-value validation
// ==================================================================================================
test('9. safeResidualRatioV2 returns UNAVAILABLE (never a fabricated value) on non-finite input', () => {
  assert.equal(V2.safeResidualRatioV2(NaN, 4).state, 'UNAVAILABLE');
  assert.equal(V2.safeResidualRatioV2(2, undefined).state, 'UNAVAILABLE');
  assert.equal(V2.safeResidualRatioV2(2, Infinity).state, 'UNAVAILABLE');
});

// ==================================================================================================
// 10 -- head boundary-hit detection
// ==================================================================================================
test('10. censoringStateFor flags a head-hypothesis boundary hit', () => {
  const c = V2.censoringStateFor(6, 0, 6);
  assert.equal(c.boundaryHit, true);
  assert.equal(c.censored, true);
  assert.equal(c.label, 'RIGHT_CENSORED');
});

// ==================================================================================================
// 11 -- static boundary-hit detection
// ==================================================================================================
test('11. packet sets staticBoundaryHit/staticResidualCensored from staticHypothesis dx/dy vs. searchRadiusPx', () => {
  const p = V2.buildTemporalMeasurementV2Packet(baseSpec({ candidateResult: usableResult({
    searchRadiusPx: 4,
    staticHypothesis: { unusable: false, zncc: 0.8, gradientZncc: 0.8, bestResidualDx: -4, bestResidualDy: 0, bestResidualMagnitude: 4 }
  }) }));
  assert.equal(p.staticBoundaryHit, true);
  assert.equal(p.staticResidualCensored, true);
  assert.ok(p.censoringLabels.includes('STATIC_RESIDUAL_RIGHT_CENSORED'));
});

// ==================================================================================================
// 12 -- both-boundary-hit handling
// ==================================================================================================
test('12. a packet can have BOTH hypotheses censored simultaneously, independently flagged', () => {
  const p = V2.buildTemporalMeasurementV2Packet(baseSpec({ candidateResult: usableResult({
    searchRadiusPx: 3,
    headHypothesis: { unusable: false, zncc: 0.9, gradientZncc: 0.9, bestResidualDx: 3, bestResidualDy: 0, bestResidualMagnitude: 3 },
    staticHypothesis: { unusable: false, zncc: 0.8, gradientZncc: 0.8, bestResidualDx: 0, bestResidualDy: -3, bestResidualMagnitude: 3 }
  }) }));
  assert.equal(p.headResidualCensored, true);
  assert.equal(p.staticResidualCensored, true);
  assert.deepEqual(p.censoringLabels.sort(), ['HEAD_RESIDUAL_RIGHT_CENSORED', 'STATIC_RESIDUAL_RIGHT_CENSORED']);
});

// ==================================================================================================
// 13 -- censoring retained with raw measurement
// ==================================================================================================
test('13. a censored residual still carries its raw measured magnitude -- censoring never blanks it', () => {
  const p = V2.buildTemporalMeasurementV2Packet(baseSpec({ candidateResult: usableResult({
    searchRadiusPx: 3,
    staticHypothesis: { unusable: false, zncc: 0.8, gradientZncc: 0.8, bestResidualDx: 3, bestResidualDy: 0, bestResidualMagnitude: 3 }
  }) }));
  assert.equal(p.staticResidualCensored, true);
  assert.equal(p.staticResidualMagnitude, 3); // preserved, not nulled out
});

// ==================================================================================================
// 14 -- censored != unavailable
// ==================================================================================================
test('14. a censored packet is NOT the same quality state as an unavailable one', () => {
  const censored = V2.buildTemporalMeasurementV2Packet(baseSpec({ candidateResult: usableResult({
    searchRadiusPx: 3,
    staticHypothesis: { unusable: false, zncc: 0.8, gradientZncc: 0.8, bestResidualDx: 3, bestResidualDy: 0, bestResidualMagnitude: 3 }
  }) }));
  const unavailable = V2.buildTemporalMeasurementV2Packet(baseSpec({ candidateResult: usableResult({ qualityState: 'LOW_TEXTURE' }) }));
  assert.equal(censored.qualityState, 'PATCH_USABLE');
  assert.notEqual(unavailable.qualityState, 'PATCH_USABLE');
  assert.equal(censored.staticResidualMagnitude, 3); // censored still has a real number
  assert.equal(unavailable.staticResidualMagnitude, null); // unavailable has null, never a number
});

// ==================================================================================================
// 15/16/17/18 -- no change to the frozen V1 instrument (structural, source-text guards)
// ==================================================================================================
test('15. module never re-implements or references the frozen search radius computation', () => {
  assert.doesNotMatch(MODULE_SOURCE, /computeSearchRadiusPx/);
  assert.doesNotMatch(MODULE_SOURCE, /searchRadiusFactor\s*[:=]/);
});
test('16. module never re-implements or references the frozen patch-scale computation', () => {
  assert.doesNotMatch(MODULE_SOURCE, /computePatchSizePx/);
  assert.doesNotMatch(MODULE_SOURCE, /patchWidthFactor\s*[:=]/);
});
test('17. module never re-implements or references the frozen image-space projection chain', () => {
  assert.doesNotMatch(MODULE_SOURCE, /a61ProjectPoint/);
  assert.doesNotMatch(MODULE_SOURCE, /imageSpaceViewModelMatrix/);
});
test('18. module never re-implements candidate/hypothesis construction (buildCandidatesForSample, localTranslationSearch, extractPatch)', () => {
  assert.doesNotMatch(MODULE_SOURCE, /buildCandidatesForSample/);
  assert.doesNotMatch(MODULE_SOURCE, /localTranslationSearch/);
  assert.doesNotMatch(MODULE_SOURCE, /extractPatch/);
  assert.doesNotMatch(MODULE_SOURCE, /bilinearSample/);
});
test('18b. V1 source module is unchanged (byte-identical SHA256 to the value this module records)', () => {
  const v1Hash = createHash('sha256').update(readFileSync(V1_MODULE_PATH)).digest('hex');
  assert.equal(v1Hash, V2.HEAD_RELATIVE_TEMPORAL_SUPPORT_V1_SOURCE_SHA256);
});

// ==================================================================================================
// 19/20/21 -- appearance metrics retained, never promoted
// ==================================================================================================
test('19. deltaZNCC is retained on every usable packet', () => {
  const p = V2.buildTemporalMeasurementV2Packet(baseSpec());
  assert.equal(p.deltaZncc, 0.95 - 0.85);
});
test('20. deltaGradientZNCC is retained on every usable packet', () => {
  const p = V2.buildTemporalMeasurementV2Packet(baseSpec());
  assert.equal(p.deltaGradientZncc, 0.9 - 0.8);
});
test('21. appearance metrics never appear in the PRIMARY endpoint evaluation formula -- only residualDifference does', () => {
  // construct a burst where deltaZncc points one way but residualDifference points the other,
  // and confirm the endpoint follows residualDifference, not deltaZncc.
  const contraryResult = usableResult({
    headHypothesis: { unusable: false, zncc: 0.80, gradientZncc: 0.80, bestResidualDx: 1, bestResidualDy: 0, bestResidualMagnitude: 1 },
    staticHypothesis: { unusable: false, zncc: 0.95, gradientZncc: 0.95, bestResidualDx: 5, bestResidualDy: 0, bestResidualMagnitude: 5 }
  });
  const p = V2.buildTemporalMeasurementV2Packet(baseSpec({ candidateResult: contraryResult }));
  assert.ok(p.deltaZncc < 0, 'appearance says static wins');
  assert.ok(p.residualDifference > 0, 'residual says head wins');
  const pairSummary = V2.summarizePair([p], 'pair1');
  const burstSummary = V2.summarizeBurst([pairSummary], 'burst1');
  const endpoints = V2.evaluateBurstEndpointsV2(burstSummary);
  assert.equal(endpoints.PRIMARY_A_V2_favorsHeadRelative, true); // follows residual, not appearance
});
test('21b. module never averages or multiplies appearance metrics into residualDifference', () => {
  // Look for an actual arithmetic combination (+, -, *, /) between the two on one line -- a
  // documentation sentence merely mentioning both by name (e.g. "using residualDifference ...
  // deltaZncc is reported alongside") must not trip this guard.
  assert.doesNotMatch(MODULE_SOURCE, /residualDifference\s*[-+*/]\s*\w*[Zz]ncc/);
  assert.doesNotMatch(MODULE_SOURCE, /[Zz]ncc\w*\s*[-+*/]\s*residualDifference/);
});

// ==================================================================================================
// 22/23/24 -- same-pair control-only rule
// ==================================================================================================
test('22. attachSamePairControlRelativeResidual computes controls ONLY from packets in the SAME pair array', () => {
  const head = V2.buildTemporalMeasurementV2Packet(baseSpec());
  const bg = V2.buildTemporalMeasurementV2Packet(baseSpec({ candidateResult: usableResult({ id: 'BACKGROUND_0', family: 'BACKGROUND_CONTROL',
    headHypothesis: { unusable: false, zncc: 0.7, gradientZncc: 0.7, bestResidualDx: 4, bestResidualDy: 0, bestResidualMagnitude: 4 },
    staticHypothesis: { unusable: false, zncc: 0.9, gradientZncc: 0.9, bestResidualDx: 0, bestResidualDy: 0, bestResidualMagnitude: 0.5 }
  }) }));
  const root = V2.buildTemporalMeasurementV2Packet(baseSpec({ candidateResult: usableResult({ id: 'BEARD_ROOT_172', family: 'BEARD_ROOT_CANDIDATE' }) }));
  const withControls = V2.attachSamePairControlRelativeResidual([head, bg, root]);
  const rootOut = withControls.find(p => p.candidateIdentity === 'BEARD_ROOT_172');
  assert.equal(rootOut.controlAvailability, 'BOTH_AVAILABLE');
  assert.equal(rootOut.headControlMeanResidualDiff, head.residualDifference);
  assert.equal(rootOut.backgroundControlMeanResidualDiff, bg.residualDifference);
});
test('23. CONTROL_INSUFFICIENT is reported when a pair has no usable control packets', () => {
  const root = V2.buildTemporalMeasurementV2Packet(baseSpec({ candidateResult: usableResult({ id: 'BEARD_ROOT_172', family: 'BEARD_ROOT_CANDIDATE' }) }));
  const withControls = V2.attachSamePairControlRelativeResidual([root]);
  assert.equal(withControls[0].controlAvailability, 'CONTROL_INSUFFICIENT');
  assert.equal(withControls[0].headControlMeanResidualDiff, null);
});
test('24. no global/discovery-session control substitution exists anywhere in the module', () => {
  assert.doesNotMatch(MODULE_SOURCE, /scan_mtz6mhc9_3aoc5d/);
  assert.doesNotMatch(MODULE_SOURCE, /scan_mtza9rzw_t24vk9/);
  assert.doesNotMatch(MODULE_SOURCE, /globalMean|discoveryMean|fallbackControl/i);
});

// ==================================================================================================
// 25/26/27 -- hierarchy (pair / burst / session)
// ==================================================================================================
test('25. summarizePair preserves every packet and reports quality breakdown', () => {
  const p1 = V2.buildTemporalMeasurementV2Packet(baseSpec());
  const p2 = V2.buildTemporalMeasurementV2Packet(baseSpec({ candidateResult: usableResult({ id: 'HEAD_REFERENCE_151', qualityState: 'LOW_TEXTURE' }) }));
  const pairSummary = V2.summarizePair([p1, p2], 'pair1');
  assert.equal(pairSummary.childCount, 2);
  assert.equal(pairSummary.usableChildCount, 1);
  assert.equal(pairSummary.unavailableChildCount, 1);
});
test('26. summarizeBurst aggregates multiple pair summaries without discarding any', () => {
  const p1 = V2.summarizePair([V2.buildTemporalMeasurementV2Packet(baseSpec())], 'pair1');
  const p2 = V2.summarizePair([V2.buildTemporalMeasurementV2Packet(baseSpec({ pairIdentity: 'pair2' }))], 'pair2');
  const burstSummary = V2.summarizeBurst([p1, p2], 'burst1');
  assert.equal(burstSummary.pairCount, 2);
  assert.equal(burstSummary.childCount, 2);
});
test('27. summarizeScanSession is the top level and names SCAN_SESSION as the independent unit', () => {
  const pairSummary = V2.summarizePair([V2.buildTemporalMeasurementV2Packet(baseSpec())], 'pair1');
  const burstSummary = V2.summarizeBurst([pairSummary], 'burst1');
  const sessionSummary = V2.summarizeScanSession([burstSummary], 'scan_test1');
  assert.equal(sessionSummary.scanSessionId, 'scan_test1');
  assert.equal(V2.PATCH_COUNT_IS_NOT_INDEPENDENT_SAMPLE_SIZE.independentExperimentalUnit, 'SCAN_SESSION');
});

// ==================================================================================================
// 28 -- motion-bin provenance (pass-through, never recomputed)
// ==================================================================================================
test('28. motionBin is carried through from the spec verbatim, never recomputed by this module', () => {
  const p = V2.buildTemporalMeasurementV2Packet(baseSpec({ motionBin: 'MEDIUM' }));
  assert.equal(p.motionBin, 'MEDIUM');
  assert.doesNotMatch(MODULE_SOURCE, /motionBinSmallMaxDeg|motionBinMediumMaxDeg/);
});

// ==================================================================================================
// 29 -- pose/visibility authority
// ==================================================================================================
test('29. authorityLevelFor assigns LOWER for a FAR_SIDE visibility class', () => {
  assert.equal(V2.authorityLevelFor('BEARD_ROOT_CANDIDATE', 'FAR_SIDE'), 'LOWER');
  assert.equal(V2.authorityLevelFor('BEARD_ROOT_CANDIDATE', 'NEAR_VISIBLE'), 'PRIMARY');
});
test('29b. HEAD_REFERENCE and BACKGROUND_CONTROL are the primary validation controls', () => {
  assert.equal(V2.isPrimaryValidationControl('HEAD_REFERENCE'), true);
  assert.equal(V2.isPrimaryValidationControl('BACKGROUND_CONTROL'), true);
  assert.equal(V2.isPrimaryValidationControl('BEARD_ROOT_CANDIDATE'), false);
});

// ==================================================================================================
// 30 -- DISTAL experimental-low-authority
// ==================================================================================================
test('30. DISTAL_LOWER_FACE_ENVELOPE_CANDIDATE is ALWAYS EXPERIMENTAL_LOW_AUTHORITY regardless of visibility', () => {
  assert.equal(V2.authorityLevelFor('DISTAL_LOWER_FACE_ENVELOPE_CANDIDATE', 'NEAR_VISIBLE'), 'EXPERIMENTAL_LOW_AUTHORITY');
  assert.equal(V2.authorityLevelFor('DISTAL_LOWER_FACE_ENVELOPE_CANDIDATE', 'FAR_SIDE'), 'EXPERIMENTAL_LOW_AUTHORITY');
});
test('30b. DISTAL is not among the primary validation control families', () => {
  assert.equal(V2.isPrimaryValidationControl('DISTAL_LOWER_FACE_ENVELOPE_CANDIDATE'), false);
});

// ==================================================================================================
// 31/32 -- no semantic beard/shirt fields
// ==================================================================================================
test('31. module never assigns a beard semantic field', () => {
  assert.doesNotMatch(MODULE_SOURCE, /isBeard\s*[:=]/);
  assert.doesNotMatch(MODULE_SOURCE, /beardScore\s*[:=]/);
  assert.doesNotMatch(MODULE_SOURCE, /beardProbability\s*[:=]/);
});
test('32. module never assigns a shirt semantic field', () => {
  assert.doesNotMatch(MODULE_SOURCE, /isShirt\s*[:=]/);
  assert.doesNotMatch(MODULE_SOURCE, /shirtScore\s*[:=]/);
  assert.doesNotMatch(MODULE_SOURCE, /shirtProbability\s*[:=]/);
});

// ==================================================================================================
// 33 -- no numeric attachment-state calibration
// ==================================================================================================
test('33. module never maps a numeric measurement onto a categorical attachment-state vocabulary', () => {
  // The vocabulary may appear in a defensive PROHIBITED-list (never emitted); only an actual
  // assignment (`field: 'HEAD_RELATIVE_SUPPORTED'` etc.) would indicate real state calibration.
  ['HEAD_RELATIVE_SUPPORTED', 'HEAD_RELATIVE_LEANING', 'INTERMEDIATE_OR_DEFORMABLE', 'STATIC_RELATIVE_LEANING', 'STATIC_RELATIVE_SUPPORTED'].forEach(state => {
    assert.doesNotMatch(MODULE_SOURCE, new RegExp(':\\s*\'' + state + '\''));
  });
  const p = V2.buildTemporalMeasurementV2Packet(baseSpec());
  assert.equal('conceptualState' in p, false);
});

// ==================================================================================================
// 34 -- no occupancy dependency
// ==================================================================================================
test('34. module imports nothing from the beard-occupancy-field or proposal families', () => {
  assert.doesNotMatch(MODULE_SOURCE, /beard-occupancy-field/);
  assert.doesNotMatch(MODULE_SOURCE, /beard-proposal/);
});

// ==================================================================================================
// 35 -- no GT
// ==================================================================================================
test('35. module never references ground-truth or IoU machinery', () => {
  assert.doesNotMatch(MODULE_SOURCE, /groundTruth/i);
  assert.doesNotMatch(MODULE_SOURCE, /IoU/i);
  assert.doesNotMatch(MODULE_SOURCE, /silhouette/i);
});

// ==================================================================================================
// 36 -- no Hairness feedback
// ==================================================================================================
test('36. module does not import or feed back into hairness-core-v1', () => {
  assert.doesNotMatch(MODULE_SOURCE, /hairness-core/);
  assert.doesNotMatch(MODULE_SOURCE, /Hairness/);
});

// ==================================================================================================
// 37 -- no network
// ==================================================================================================
test('37. module has zero network calls', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\bfetch\s*\(/);
  assert.doesNotMatch(MODULE_SOURCE, /XMLHttpRequest/);
  assert.doesNotMatch(MODULE_SOURCE, /https?:\/\//);
});

// ==================================================================================================
// 38 -- sealed-holdout absence
// ==================================================================================================
test('38. module never references the sealed holdout scan', () => {
  assert.doesNotMatch(MODULE_SOURCE, /scan_mtdogmlr_espu2w/);
  assert.doesNotMatch(MODULE_SOURCE, /obs22|obs23/);
});

// ==================================================================================================
// 39 -- production isolation
// ==================================================================================================
test('39. production isolation: index.html and worker.js are unchanged by this stage', () => {
  const ROOT = join(HERE, '..');
  const indexHash = createHash('sha256').update(readFileSync(join(ROOT, 'index.html'))).digest('hex');
  const workerHash = createHash('sha256').update(readFileSync(join(ROOT, 'worker.js'))).digest('hex');
  // Baseline updated by BI-1Z1R, which was explicitly authorized to modify index.html
  // (research-only WHOLE_SCAN_TEMPORAL_EXACT_V1 wiring) -- this snapshot only needs to prove
  // no LATER, unauthorized stage touches it further.
  // Baseline updated by BI-1Z1T, which was explicitly authorized to modify index.html's
  // whole-scan block (burst-priority isolation) -- this snapshot only needs to prove no LATER,
  // unauthorized stage touches it further.
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
test('39b. module never imports a DOM/browser/native-bridge global', () => {
  assert.doesNotMatch(MODULE_SOURCE, /\bdocument\./);
  assert.doesNotMatch(MODULE_SOURCE, /\bwindow\./);
  assert.doesNotMatch(MODULE_SOURCE, /BeardTrimAndroid/);
});
test('39c. module performs zero image-patch extraction or metric computation of its own', () => {
  assert.doesNotMatch(MODULE_SOURCE, /getImageData/);
  assert.doesNotMatch(MODULE_SOURCE, /sobelGradientMagnitude/);
});
