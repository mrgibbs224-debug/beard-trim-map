// Stage BI-1Z1L -- synthetic/invariant tests for the nonsemantic Temporal Evidence Packet +
// hierarchy machinery. Pure synthetic fixtures; no physical capture, no GT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as E from './head-relative-temporal-evidence-v1.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_SOURCE = readFileSync(join(HERE, 'head-relative-temporal-evidence-v1.mjs'), 'utf8');
const DESIGN_PATH = 'D:/MettleTemp/analysis/bi1z1k_head_relative_temporal_support_channel_design.json';

function usableResult(overrides = {}) {
  return Object.assign({
    id: 'HEAD_REFERENCE_6', family: 'HEAD_REFERENCE', anatomicalIndex: 6, anatomicalSide: null, region: null,
    provenanceTags: ['TRACKED_3D_SUPPORTED'], qualityState: 'PATCH_USABLE',
    headHypothesis: { unusable: false, zncc: 0.95, gradientZncc: 0.9, bestResidualDx: 1, bestResidualDy: 0, bestResidualMagnitude: 1 },
    staticHypothesis: { unusable: false, zncc: 0.85, gradientZncc: 0.8, bestResidualDx: 3, bestResidualDy: 1, bestResidualMagnitude: 3.16 }
  }, overrides);
}
function baseSpec(overrides = {}) {
  return Object.assign({
    scanSessionId: 'scan_test1', temporalBurstId: 'burst_test1', sampleATimestampNs: '1000000000', sampleBTimestampNs: '1125000000',
    pairIdentity: 'burst_test1#0#1', candidateResult: usableResult(),
    motionBin: 'SMALL', visibilityClass: 'NEAR_VISIBLE',
    designSha256: E.BI1Z1K_DESIGN_SHA256, captureSha256: 'a'.repeat(64), sourceVersion: '1'
  }, overrides);
}

// ==================================================================================================
// 1 -- design hash
// ==================================================================================================
test('1. design hash: module records the exact frozen BI-1Z1K design SHA256', () => {
  assert.equal(E.BI1Z1K_DESIGN_SHA256, '2a2f10844c675c88df1d3e651ca8d174888b955428b63bfe4b9050747b11c656');
});
test('1b. design hash re-verification against the live artifact', () => {
  const buf = readFileSync(DESIGN_PATH);
  assert.equal(createHash('sha256').update(buf).digest('hex'), E.BI1Z1K_DESIGN_SHA256);
});

// ==================================================================================================
// 2 -- complete packet provenance
// ==================================================================================================
test('2. complete packet provenance: every required field is present', () => {
  const p = E.buildTemporalEvidencePacket(baseSpec());
  ['scanSessionId', 'subjectSessionIdentifier', 'deviceModel', 'temporalBurstId', 'sampleATimestampNs', 'sampleBTimestampNs',
    'pairIdentity', 'candidateIdentity', 'patchFamily', 'anatomicalRegion', 'anatomicalSide', 'visibilityClass', 'motionBin',
    'headZncc', 'staticZncc', 'deltaZncc', 'headGradientZncc', 'staticGradientZncc', 'deltaGradientZncc',
    'headResidualDx', 'headResidualDy', 'headResidualMagnitude', 'staticResidualDx', 'staticResidualDy', 'staticResidualMagnitude',
    'residualComparison', 'qualityState', 'textureState', 'controlAvailability', 'authorityLevel',
    'sourceModule', 'sourceVersion', 'designSha256', 'captureSha256', 'provenanceTags', 'limitations'
  ].forEach(field => assert.ok(field in p, field));
});

// ==================================================================================================
// 3/4 -- no beard/shirt semantic fields
// ==================================================================================================
test('3. no beard semantic fields', () => {
  const p = E.buildTemporalEvidencePacket(baseSpec());
  assert.equal('isBeard' in p, false); assert.equal('beardScore' in p, false); assert.equal('beardProbability' in p, false);
});
test('4. no shirt semantic fields', () => {
  const p = E.buildTemporalEvidencePacket(baseSpec());
  assert.equal('isShirt' in p, false); assert.equal('shirtScore' in p, false);
});
test('3b/4b. source never ASSIGNS a semantic beard/shirt field name as an output key (the names appear only in the PROHIBITED_FIELD_NAMES guard-list, never as "packet.isBeard =" or similar)', () => {
  assert.equal(/(packet|out|result)\s*\.\s*(isBeard|isShirt|beardScore|shirtScore|beardProbability|shirtProbability)\s*=/i.test(MODULE_SOURCE), false);
  assert.equal(/['"](isBeard|isShirt|beardScore|shirtScore|beardProbability|shirtProbability)['"]\s*:/i.test(MODULE_SOURCE), false);
});

// ==================================================================================================
// 5/6/7 -- hierarchy
// ==================================================================================================
test('5. patch->pair hierarchy: summarizePair retains every constituent packet', () => {
  const packets = [E.buildTemporalEvidencePacket(baseSpec()), E.buildTemporalEvidencePacket(baseSpec({ candidateResult: usableResult({ id: 'BACKGROUND_0', family: 'BACKGROUND_CONTROL' }) }))];
  const pairSummary = E.summarizePair(packets, 'pair1');
  assert.equal(pairSummary.childCount, 2);
  assert.equal(pairSummary.packets.length, 2);
});
test('6. pair->burst hierarchy: summarizeBurst retains every constituent pair summary', () => {
  const pair1 = E.summarizePair([E.buildTemporalEvidencePacket(baseSpec())], 'pair1');
  const pair2 = E.summarizePair([E.buildTemporalEvidencePacket(baseSpec({ pairIdentity: 'pair2' }))], 'pair2');
  const burstSummary = E.summarizeBurst([pair1, pair2], 'burst_test1');
  assert.equal(burstSummary.pairCount, 2);
  assert.equal(burstSummary.pairSummaries.length, 2);
});
test('7. burst->session hierarchy: summarizeScanSession retains every constituent burst summary', () => {
  const pair1 = E.summarizePair([E.buildTemporalEvidencePacket(baseSpec())], 'pair1');
  const burst1 = E.summarizeBurst([pair1], 'burst1');
  const burst2 = E.summarizeBurst([pair1], 'burst2');
  const session = E.summarizeScanSession([burst1, burst2], 'scan_test1');
  assert.equal(session.burstCount, 2);
  assert.equal(session.burstSummaries.length, 2);
});

// ==================================================================================================
// 8 -- raw patch measurements retained
// ==================================================================================================
test('8. raw patch measurements retained through every hierarchy level', () => {
  const packet = E.buildTemporalEvidencePacket(baseSpec());
  const pairSummary = E.summarizePair([packet], 'pair1');
  const burstSummary = E.summarizeBurst([pairSummary], 'burst1');
  const session = E.summarizeScanSession([burstSummary], 'scan1');
  const recovered = session.burstSummaries[0].pairSummaries[0].packets[0];
  assert.equal(recovered.candidateIdentity, packet.candidateIdentity);
  assert.equal(recovered.headZncc, packet.headZncc);
});

// ==================================================================================================
// 9/10 -- unusable patch exclusion / count preservation
// ==================================================================================================
test('9. unusable patch excluded from aggregate numerator (usableChildCount)', () => {
  const usable = E.buildTemporalEvidencePacket(baseSpec());
  const unusable = E.buildTemporalEvidencePacket(baseSpec({ candidateResult: usableResult({ id: 'x', qualityState: 'LOW_TEXTURE', headHypothesis: null, staticHypothesis: null }) }));
  const pairSummary = E.summarizePair([usable, unusable], 'pair1');
  assert.equal(pairSummary.usableChildCount, 1);
});
test('10. unusable patch count preserved (unavailableChildCount)', () => {
  const usable = E.buildTemporalEvidencePacket(baseSpec());
  const unusable = E.buildTemporalEvidencePacket(baseSpec({ candidateResult: usableResult({ id: 'x', qualityState: 'LOW_TEXTURE', headHypothesis: null, staticHypothesis: null }) }));
  const pairSummary = E.summarizePair([usable, unusable], 'pair1');
  assert.equal(pairSummary.unavailableChildCount, 1);
  assert.equal(pairSummary.childCount, 2);
});

// ==================================================================================================
// 11/12 -- unavailable != negative / LOW_TEXTURE handling
// ==================================================================================================
test('11. unavailable != negative: an unusable candidate never receives a negative or zero deltaZncc, only null', () => {
  const packet = E.buildTemporalEvidencePacket(baseSpec({ candidateResult: usableResult({ id: 'x', qualityState: 'LOW_TEXTURE', headHypothesis: null, staticHypothesis: null }) }));
  assert.equal(packet.deltaZncc, null);
  assert.notEqual(packet.deltaZncc, 0);
});
test('12. LOW_TEXTURE handling: qualityState/conceptualState correctly reflect LOW_TEXTURE, never PATCH_USABLE', () => {
  const packet = E.buildTemporalEvidencePacket(baseSpec({ candidateResult: usableResult({ id: 'x', qualityState: 'LOW_TEXTURE', headHypothesis: null, staticHypothesis: null }) }));
  assert.equal(packet.qualityState, 'LOW_TEXTURE');
  assert.equal(packet.conceptualState, 'UNAVAILABLE');
});

// ==================================================================================================
// 13/14/15 -- CONTROL_INSUFFICIENT / missing head control / missing background control
// ==================================================================================================
test('13. CONTROL_INSUFFICIENT when neither control family is present in the pair', () => {
  const rootPacket = E.buildTemporalEvidencePacket(baseSpec({ candidateResult: usableResult({ id: 'ROOT_1', family: 'BEARD_ROOT_CANDIDATE' }) }));
  const [withControls] = E.attachSamePairControls([rootPacket]);
  assert.equal(withControls.controlAvailability, 'CONTROL_INSUFFICIENT');
  assert.equal(withControls.headControlDeltaZncc, null);
  assert.equal(withControls.backgroundControlDeltaZncc, null);
});
test('14. missing head control: PARTIAL_AVAILABLE when only background control is present', () => {
  const rootPacket = E.buildTemporalEvidencePacket(baseSpec({ candidateResult: usableResult({ id: 'ROOT_1', family: 'BEARD_ROOT_CANDIDATE' }) }));
  const bgPacket = E.buildTemporalEvidencePacket(baseSpec({ candidateResult: usableResult({ id: 'BG_1', family: 'BACKGROUND_CONTROL' }) }));
  const results = E.attachSamePairControls([rootPacket, bgPacket]);
  const root = results.find(r => r.patchFamily === 'BEARD_ROOT_CANDIDATE');
  assert.equal(root.controlAvailability, 'PARTIAL_AVAILABLE');
  assert.equal(root.headControlDeltaZncc, null);
  assert.notEqual(root.backgroundControlDeltaZncc, null);
});
test('15. missing background control: PARTIAL_AVAILABLE when only head control is present', () => {
  const rootPacket = E.buildTemporalEvidencePacket(baseSpec({ candidateResult: usableResult({ id: 'ROOT_1', family: 'BEARD_ROOT_CANDIDATE' }) }));
  const headPacket = E.buildTemporalEvidencePacket(baseSpec());
  const results = E.attachSamePairControls([rootPacket, headPacket]);
  const root = results.find(r => r.patchFamily === 'BEARD_ROOT_CANDIDATE');
  assert.equal(root.controlAvailability, 'PARTIAL_AVAILABLE');
  assert.notEqual(root.headControlDeltaZncc, null);
  assert.equal(root.backgroundControlDeltaZncc, null);
});

// ==================================================================================================
// 16/17 -- same-pair controls only / no global-control substitution
// ==================================================================================================
test('16. same-pair controls only: attachSamePairControls never reads a control from a different pair (structural -- it only ever receives the SAME pair\'s own packet array)', () => {
  const fnStart = MODULE_SOURCE.indexOf('export function attachSamePairControls');
  const fnBody = MODULE_SOURCE.slice(fnStart, MODULE_SOURCE.indexOf('\n}', fnStart) + 2);
  assert.equal(/globalThis|previousBurst|discoverySession|otherPair/i.test(fnBody), false);
});
test('17. no global-control substitution: a pair with insufficient controls never falls back to a nonzero value', () => {
  const rootPacket = E.buildTemporalEvidencePacket(baseSpec({ candidateResult: usableResult({ id: 'ROOT_1', family: 'BEARD_ROOT_CANDIDATE' }) }));
  const [withControls] = E.attachSamePairControls([rootPacket]);
  assert.equal(withControls.candidateRelativeToHeadControl, null);
  assert.equal(withControls.candidateRelativeToBackgroundControl, null);
});

// ==================================================================================================
// 18/19/20 -- raw metric preservation
// ==================================================================================================
test('18. raw deltaZncc preserved exactly as computed from the input hypotheses', () => {
  const packet = E.buildTemporalEvidencePacket(baseSpec());
  assert.ok(Math.abs(packet.deltaZncc - (0.95 - 0.85)) < 1e-9);
});
test('19. raw gradient metrics preserved', () => {
  const packet = E.buildTemporalEvidencePacket(baseSpec());
  assert.equal(packet.headGradientZncc, 0.9); assert.equal(packet.staticGradientZncc, 0.8);
  assert.ok(Math.abs(packet.deltaGradientZncc - 0.1) < 1e-9);
});
test('20. raw residual metrics preserved', () => {
  const packet = E.buildTemporalEvidencePacket(baseSpec());
  assert.equal(packet.headResidualDx, 1); assert.equal(packet.staticResidualDx, 3);
  assert.ok(Math.abs(packet.residualComparison - (3.16 - 1)) < 1e-6);
});

// ==================================================================================================
// 21 -- metrics not multiplied as probabilities
// ==================================================================================================
test('21. metrics not multiplied/summed as if independent probabilities', () => {
  assert.equal(/headZncc\s*\*\s*staticZncc|deltaZncc\s*\*\s*deltaGradientZncc|Zncc.*\*.*Residual/i.test(MODULE_SOURCE), false);
});

// ==================================================================================================
// 22/23 -- SMALL/MEDIUM/LARGE provenance / near/far-side authority
// ==================================================================================================
test('22. SMALL/MEDIUM/LARGE provenance retained verbatim on the packet', () => {
  const packet = E.buildTemporalEvidencePacket(baseSpec({ motionBin: 'LARGE' }));
  assert.equal(packet.motionBin, 'LARGE');
});
test('23. near/far-side authority: a FAR_SIDE visibility class yields LOWER authority, never equal to PRIMARY', () => {
  const near = E.buildTemporalEvidencePacket(baseSpec({ visibilityClass: 'NEAR_VISIBLE', candidateResult: usableResult({ family: 'BEARD_ROOT_CANDIDATE' }) }));
  const far = E.buildTemporalEvidencePacket(baseSpec({ visibilityClass: 'FAR_SIDE', candidateResult: usableResult({ family: 'BEARD_ROOT_CANDIDATE' }) }));
  assert.equal(near.authorityLevel, 'PRIMARY');
  assert.equal(far.authorityLevel, 'LOWER');
});

// ==================================================================================================
// 24 -- distal EXPERIMENTAL_LOW_AUTHORITY
// ==================================================================================================
test('24. DISTAL candidates always carry EXPERIMENTAL_LOW_AUTHORITY, even at near-side visibility', () => {
  const packet = E.buildTemporalEvidencePacket(baseSpec({ visibilityClass: 'NEAR_VISIBLE', candidateResult: usableResult({ family: 'DISTAL_LOWER_FACE_ENVELOPE_CANDIDATE' }) }));
  assert.equal(packet.authorityLevel, 'EXPERIMENTAL_LOW_AUTHORITY');
});

// ==================================================================================================
// 25 -- no state-threshold mapping
// ==================================================================================================
test('25. no state-threshold mapping: conceptualState is only ever UNRESOLVED or UNAVAILABLE, never a specific attachment state derived from a numeric cutoff', () => {
  const packet = E.buildTemporalEvidencePacket(baseSpec({ candidateResult: usableResult({ headHypothesis: { unusable: false, zncc: 0.9999, gradientZncc: 0.99, bestResidualDx: 0, bestResidualDy: 0, bestResidualMagnitude: 0 } }) }));
  assert.ok(['UNRESOLVED', 'UNAVAILABLE'].includes(packet.conceptualState));
  assert.equal(/deltaZncc\s*[><]=?\s*0\.\d|zncc\s*[><]=?\s*0\.\d/i.test(MODULE_SOURCE), false);
});

// ==================================================================================================
// 26/27/28 -- no occupancy input / no GT / no Hairness feedback
// ==================================================================================================
test('26. no occupancy input', () => { assert.equal(/beard-occupancy-field-v2[12]/i.test(MODULE_SOURCE), false); });
test('27. no GT', () => { assert.equal(/humanFinalPoints|humanGT|groundTruth/i.test(MODULE_SOURCE), false); });
test('28. no Hairness feedback', () => { assert.equal(/hairness-core-v1/i.test(MODULE_SOURCE), false); });

// ==================================================================================================
// 29 -- deterministic aggregation
// ==================================================================================================
test('29. deterministic aggregation: identical input packets always produce an identical session summary', () => {
  const p1 = E.buildTemporalEvidencePacket(baseSpec());
  const pairSummary = E.summarizePair([p1], 'pair1');
  const burstSummary = E.summarizeBurst([pairSummary], 'burst1');
  const a = E.summarizeScanSession([burstSummary], 'scan1');
  const b = E.summarizeScanSession([burstSummary], 'scan1');
  assert.deepEqual(a.qualityBreakdown, b.qualityBreakdown);
  assert.equal(a.childCount, b.childCount);
});

// ==================================================================================================
// 30 -- no pseudoreplication reporting
// ==================================================================================================
test('30. no pseudoreplication reporting: assertNotPseudoreplicated throws when claimed independent units exceed actual scan sessions', () => {
  const pairSummary = E.summarizePair([E.buildTemporalEvidencePacket(baseSpec())], 'pair1');
  const burstSummary = E.summarizeBurst([pairSummary], 'burst1');
  const session = E.summarizeScanSession([burstSummary], 'scan1');
  assert.throws(() => E.assertNotPseudoreplicated(335, [session]));
  assert.equal(E.assertNotPseudoreplicated(1, [session]), true);
});
test('30b. PATCH_COUNT_IS_NOT_INDEPENDENT_SUBJECT_COUNT invariant is exported and names SCAN_SESSION as the independent unit', () => {
  assert.equal(E.PATCH_COUNT_IS_NOT_INDEPENDENT_SUBJECT_COUNT.independentExperimentalUnit, 'SCAN_SESSION');
});

// ==================================================================================================
// 31 -- fresh-session requirement (structural: session summary carries its own scanSessionId, never a shared/default one)
// ==================================================================================================
test('31. fresh-session requirement: session summaries are keyed by their own distinct scanSessionId, never defaulted', () => {
  const pairSummary = E.summarizePair([E.buildTemporalEvidencePacket(baseSpec())], 'pair1');
  const burstSummary = E.summarizeBurst([pairSummary], 'burst1');
  const sessionA = E.summarizeScanSession([burstSummary], 'scan_discovery');
  const sessionB = E.summarizeScanSession([burstSummary], 'scan_fresh');
  assert.notEqual(sessionA.scanSessionId, sessionB.scanSessionId);
});

// ==================================================================================================
// 32 -- production isolation
// ==================================================================================================
test('32. production isolation: module never imports a DOM/browser/native-bridge global', () => {
  assert.equal(/\bwindow\.|\bdocument\.|\bBeardTrimAndroid\b/.test(MODULE_SOURCE), false);
});

// ==================================================================================================
// Additional engineering-correctness checks
// ==================================================================================================
test('module never imports V1/V2/V2.1/V2.2 proposal/occupancy files', () => {
  assert.equal(/beard-proposal|beard-occupancy/i.test(MODULE_SOURCE), false);
});
test('module never performs its own image patch extraction or metric computation (no pixel/gray array processing)', () => {
  assert.equal(/extractPatch|bilinearSample|zncc\s*\(/i.test(MODULE_SOURCE.replace(/gradientZncc|headZncc|staticZncc|deltaZncc/gi, '')), false);
});
test('sealed-holdout absence', () => { assert.equal(MODULE_SOURCE.includes('espu2w'), false); });
test('module has zero network calls', () => { assert.equal(/\bfetch\(|XMLHttpRequest|WebSocket/.test(MODULE_SOURCE), false); });
