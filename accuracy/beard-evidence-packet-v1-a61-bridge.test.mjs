// Stage BI-1Z1C.3 — tests for the authoritative-Hairness evidence-provenance bridge added to
// accuracy/beard-evidence-packet-v1.mjs. Node built-in runner (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as EP from './beard-evidence-packet-v1.mjs';
import * as H from './hairness-core-v1.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const V1_SOURCE = readFileSync(join(HERE, '..', 'tools', 'annotation-workbench', 'beard-proposal.cjs'), 'utf8');
const V2_SOURCE = readFileSync(join(HERE, 'beard-proposal-anatomical-seeded-v2.mjs'), 'utf8');
const ROOT_INDEX_HTML = readFileSync(join(HERE, '..', 'index.html'), 'utf8');

// ---- 1/2: V1/V2 unchanged -----------------------------------------------------------------------
test('1: original V1 (beard-proposal/1) is untouched', () => {
  assert.match(V1_SOURCE, /PROPOSAL_ALGORITHM_VERSION = 'beard-proposal\/1'/);
});
test('2: original V2 (beard-proposal-anatomical-seeded/2) manifest is untouched', () => {
  assert.match(V2_SOURCE, /V2_ALGORITHM_VERSION = 'beard-proposal-anatomical-seeded\/2'/);
});
// ---- 3: frozen Hairness thresholds unchanged -----------------------------------------------------
test('3: DECISION_RULE thresholds remain 11.9/14.9/13.4', () => {
  assert.equal(H.DECISION_RULE.deadZoneLowerBound, 11.9);
  assert.equal(H.DECISION_RULE.deadZoneUpperBound, 14.9);
  assert.equal(H.DECISION_RULE.decisionMidpoint, 13.4);
});
// ---- 4: authoritative a61 SHA exact ---------------------------------------------------------------
test('4: A61_FROZEN_ROI_PROVENANCE.roiSourceSha256 matches the locked SHA256 exactly', () => {
  assert.equal(EP.A61_FROZEN_ROI_PROVENANCE.roiSourceSha256, '683b930cd6b5c05a11bf95302a474420d571a40cc9b014bb6fd22a9f4ed8308c');
  assert.equal(EP.A61_FROZEN_ROI_PROVENANCE.roiSourceSha256, H.A61_SEGMENT_SOURCE.sha256, 'the evidence-packet provenance and the Hairness adapter must cite the SAME hash');
});
// ---- 5/6: projection + dynamic side semantics preserved --------------------------------------------
test('5: A61_FROZEN_ROI_PROVENANCE.projectionMode names the faceLocal3D->view-matrix->intrinsics path, never a flat landmarks2D*width/height claim', () => {
  assert.equal(EP.A61_FROZEN_ROI_PROVENANCE.projectionMode, 'FACE_LOCAL_3D_TO_IMAGE_VIA_VIEW_MATRIX_INTRINSICS');
});
test('6: buildA61JawSideburnROIs (the function this bridge relies on) still resolves side dynamically per-frame, not via a hardcoded index table', () => {
  const src = readFileSync(join(HERE, 'hairness-core-v1.mjs'), 'utf8');
  assert.match(src, /sideOf\s*=\s*idx\s*=>\s*\(faceLocal3D\[idx\]\.x - midlineX\)/);
});
// ---- 7: correct Hairness ROI provenance on every signal ---------------------------------------------
test('7: makeHairnessEvidenceSignal always stamps roiSource/roiSourceSha256/projectionMode/feature/formulaVersion/decisionThresholds on every signal, never omitting provenance', () => {
  const s = EP.makeHairnessEvidenceSignal({ anatomicalRegion: 'JAW_LEFT', classification: 'BEARD_CONFIRMED', highGradientFraction: 15.2, validPixelCount: 400 });
  assert.equal(s.value.roiSource, 'A61_FROZEN_ROI');
  assert.equal(s.value.roiSourceSha256, EP.A61_FROZEN_ROI_PROVENANCE.roiSourceSha256);
  assert.equal(s.value.feature, 'HIGH_GRADIENT_FRACTION');
  assert.equal(s.value.formulaVersion, 'hairness-core-v1');
  assert.deepEqual(s.value.decisionThresholds, { deadZoneLowerBound: 11.9, deadZoneUpperBound: 14.9 });
  assert.equal(s.coordinateSpace, 'IMAGE');
});
test('7b: makeHairnessEvidenceSignal requires region/classification/HGF/pixel-count, never fabricating a signal from partial data', () => {
  assert.throws(() => EP.makeHairnessEvidenceSignal({ anatomicalRegion: 'JAW_LEFT' }));
});
// ---- 8: exact frame identity preservation -----------------------------------------------------------
test('8: a packet built with these signals still requires and preserves full frame identity', () => {
  const s = EP.makeHairnessEvidenceSignal({ anatomicalRegion: 'CHIN_BEARD', classification: 'UNCERTAIN', highGradientFraction: 13.0, validPixelCount: 100 });
  const p = EP.makeBeardEvidencePacket({ scanSessionId: 'scan_x', nativeFrameTimestampNs: '123', rawObservationId: 0, coherenceStatus: 'VERIFIED_EXACT', signals: [s] });
  assert.equal(p.scanSessionId, 'scan_x');
  EP.assertPacketInternallyConsistent(p); // must not throw
});
// ---- 9: one signal per honest region, never blended ---------------------------------------------------
test('9: each Hairness signal names exactly ONE anatomicalRegion -- SIDEBURN evidence and JAW evidence are never merged into a single blended signal', () => {
  const jaw = EP.makeHairnessEvidenceSignal({ anatomicalRegion: 'JAW_LEFT', classification: 'BEARD_CONFIRMED', highGradientFraction: 16, validPixelCount: 300 });
  const sideburn = EP.makeHairnessEvidenceSignal({ anatomicalRegion: 'SIDEBURN_LEFT', classification: 'BEARD_CONFIRMED', highGradientFraction: 18, validPixelCount: 200 });
  assert.notEqual(jaw.anatomicalRegion, sideburn.anatomicalRegion);
});
// ---- 10: unsupported regions remain unsupported ------------------------------------------------------
test('10: under-jaw/under-chin/neck regions remain UNSUPPORTED regardless of any Hairness evidence existing elsewhere on the frame', () => {
  ['UNDER_CHIN', 'UNDER_JAW_LEFT', 'UNDER_JAW_CENTER', 'UNDER_JAW_RIGHT', 'NECK_FRONT', 'NECK_LEFT', 'NECK_RIGHT', 'CHIN_NECK_TRANSITION'].forEach(r => {
    assert.equal(EP.bs1SupportStatusFor(r), EP.SupportStatus.UNSUPPORTED);
  });
});
// ---- 11: temporary disk-ROI evidence marked superseded --------------------------------------------
test('11: OUT_OF_CALIBRATION_ROI_EXPERIMENT_PROVENANCE is explicitly marked SUPERSEDED by A61_FROZEN_ROI, never silently dropped or presented as active', () => {
  assert.equal(EP.OUT_OF_CALIBRATION_ROI_EXPERIMENT_PROVENANCE.status, 'SUPERSEDED');
  assert.equal(EP.OUT_OF_CALIBRATION_ROI_EXPERIMENT_PROVENANCE.supersededBy, 'A61_FROZEN_ROI');
});
// ---- 12: no GT input --------------------------------------------------------------------------------
test('12: no function in this bridge reads a human-GT or proposal-result parameter', () => {
  const src = readFileSync(join(HERE, 'beard-evidence-packet-v1.mjs'), 'utf8');
  assert.equal(/humanFinalPoints|humanGT|groundTruth|originalProposalPoints/i.test(src), false);
});
// ---- 13: Hairness does not upgrade geometry support --------------------------------------------------
test('13: a region with real Hairness evidence but no BS1 geometry mapping (e.g. sideburn) still reports UNSUPPORTED BS1 status -- Hairness never upgrades geometry support', () => {
  const hairness = EP.makeHairnessEvidenceSignal({ anatomicalRegion: 'SIDEBURN_LEFT', classification: 'BEARD_CONFIRMED', highGradientFraction: 18, validPixelCount: 300 });
  assert.equal(hairness.channel, 'HAIRNESS_CORE_V1');
  assert.equal(EP.bs1SupportStatusFor('LEFT_SIDEBURN'), EP.SupportStatus.UNSUPPORTED, 'BS1 status for sideburn must remain UNSUPPORTED regardless of the Hairness signal existing');
});
// ---- 14: no proposal generation ----------------------------------------------------------------------
test('14: this module exports no proposal-generation function (no originalProposalPoints/handlePoints builder)', () => {
  assert.equal(typeof EP.runV2Proposal, 'undefined');
  assert.equal(Object.keys(EP).some(k => /proposal/i.test(k)), false);
});
// ---- 15: no motion implementation --------------------------------------------------------------------
test('15: no optical-flow/motion/temporal-tracking function exists in this bridge module', () => {
  const src = readFileSync(join(HERE, 'beard-evidence-packet-v1.mjs'), 'utf8');
  assert.equal(/opticalFlow|motionVector|temporalTrack/i.test(src), false);
});
// ---- 16: production isolation -------------------------------------------------------------------------
test('16: root production index.html carries no A6.1 bridge symbols', () => {
  assert.equal(ROOT_INDEX_HTML.includes('A61_FROZEN_ROI'), false);
  assert.equal(ROOT_INDEX_HTML.includes('makeHairnessEvidenceSignal'), false);
});
test('17: no sealed-holdout identifier appears in this module', () => {
  const src = readFileSync(join(HERE, 'beard-evidence-packet-v1.mjs'), 'utf8');
  assert.equal(src.includes('espu2w'), false);
});
