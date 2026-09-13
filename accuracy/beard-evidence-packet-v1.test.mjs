// Stage BI-1Z1C.1 — tests for the shared BeardEvidencePacketV1 contract. Node built-in runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as EP from './beard-evidence-packet-v1.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT_INDEX_HTML = readFileSync(join(HERE, '..', 'index.html'), 'utf8');

// ---- 1: BS1 region-support mapping reused, not redefined ---------------------------------------
test('1: BS1_SUPPORTED_REGIONS/BS1_UNSUPPORTED_REGIONS are the SAME frozen arrays exported by beard-anatomy-map.mjs (re-exported, never redefined)', async () => {
  const BAM = await import('./beard-anatomy-map.mjs');
  assert.equal(EP.BS1_SUPPORTED_REGIONS, BAM.SUPPORTED_REGIONS);
  assert.equal(EP.BS1_UNSUPPORTED_REGIONS, BAM.UNSUPPORTED_REGIONS);
});
// ---- 2: unsupported region remains unsupported --------------------------------------------------
test('2: under-jaw/under-chin/neck regions remain UNSUPPORTED -- this module never upgrades them', () => {
  ['UNDER_CHIN', 'UNDER_JAW_LEFT', 'UNDER_JAW_CENTER', 'UNDER_JAW_RIGHT', 'NECK_FRONT', 'NECK_LEFT', 'NECK_RIGHT', 'CHIN_NECK_TRANSITION'].forEach(r => {
    assert.equal(EP.bs1SupportStatusFor(r), EP.SupportStatus.UNSUPPORTED, r + ' must remain UNSUPPORTED');
  });
});
test('3: verified chin/jaw/lower-cheek regions report TRACKED_2D_SUPPORTED, never TRACKED_3D_SUPPORTED (BS1 never claims 3D mesh)', () => {
  ['CHIN_CENTER', 'LEFT_JAW', 'RIGHT_JAW', 'LEFT_LOWER_CHEEK', 'RIGHT_LOWER_CHEEK'].forEach(r => {
    assert.equal(EP.bs1SupportStatusFor(r), EP.SupportStatus.TRACKED_2D_SUPPORTED);
  });
});

// ---- 4: evidence signal validation / provenance preservation ------------------------------------
test('4: makeEvidenceSignal requires a known channel and supportStatus, and preserves every field verbatim without inferring missing ones', () => {
  const s = EP.makeEvidenceSignal({
    channel: EP.EvidenceChannel.JAW_SUPPORT, supportStatus: EP.SupportStatus.TRACKED_2D_SUPPORTED,
    anatomicalRegion: 'CHIN_CENTER', anatomicalSide: 'CENTER', coordinateSpace: 'IMAGE',
    value: 0.82, confidence: 0.9, freshness: 'VERIFIED_EXACT', source: 'test', limitations: ['none']
  });
  assert.equal(s.anatomicalRegion, 'CHIN_CENTER');
  assert.equal(s.value, 0.82);
  assert.deepEqual(s.limitations, ['none']);
  assert.throws(() => EP.makeEvidenceSignal({ channel: 'NOT_A_CHANNEL', supportStatus: EP.SupportStatus.PRIOR }));
  assert.throws(() => EP.makeEvidenceSignal({ channel: EP.EvidenceChannel.JAW_SUPPORT, supportStatus: 'NOT_A_STATUS' }));
});
test('5: an evidence signal with no value/confidence is still valid (e.g. an EXCLUSION_REGION signal) -- fields are optional, never fabricated to fill them in', () => {
  const s = EP.makeEvidenceSignal({ channel: EP.EvidenceChannel.EXCLUSION_REGION, supportStatus: EP.SupportStatus.UNSUPPORTED });
  assert.equal(s.value, null);
  assert.equal(s.confidence, null);
});

// ---- 6: packet identity + exact-frame consistency ------------------------------------------------
test('6: makeBeardEvidencePacket requires full frame identity and rejects a missing field', () => {
  assert.throws(() => EP.makeBeardEvidencePacket({ scanSessionId: 'x', nativeFrameTimestampNs: '1', rawObservationId: 0 })); // missing coherenceStatus
  const p = EP.makeBeardEvidencePacket({ scanSessionId: 'x', nativeFrameTimestampNs: '1', rawObservationId: 0, coherenceStatus: 'VERIFIED_EXACT' });
  assert.equal(p.packetVersion, EP.EVIDENCE_PACKET_VERSION);
});
test('7: assertPacketInternallyConsistent throws for a non-VERIFIED_EXACT packet -- exact-frame evidence must never be silently accepted otherwise', () => {
  const p = EP.makeBeardEvidencePacket({ scanSessionId: 'x', nativeFrameTimestampNs: '1', rawObservationId: 0, coherenceStatus: 'UNVERIFIED' });
  assert.throws(() => EP.assertPacketInternallyConsistent(p));
  const ok = EP.makeBeardEvidencePacket({ scanSessionId: 'x', nativeFrameTimestampNs: '1', rawObservationId: 0, coherenceStatus: 'VERIFIED_EXACT' });
  assert.equal(EP.assertPacketInternallyConsistent(ok), true);
});

// ---- 8: evidence packet determinism ---------------------------------------------------------------
test('8: building the same packet twice from identical input produces deep-equal (frozen) output', () => {
  const spec = { scanSessionId: 'x', nativeFrameTimestampNs: '1', rawObservationId: 0, coherenceStatus: 'VERIFIED_EXACT', yawDeg: 5.2 };
  const a = EP.makeBeardEvidencePacket(spec), b = EP.makeBeardEvidencePacket(spec);
  assert.deepEqual(a, b);
  assert.ok(Object.isFrozen(a));
  assert.ok(Object.isFrozen(a.signals));
});

// ---- 9: no GT input into runtime evidence / no circular self-confirmation ------------------------
test('9: this module\'s exported API has no parameter or field named after human GT, and no function reads a proposal result as an input to build a signal', () => {
  const src = readFileSync(join(HERE, 'beard-evidence-packet-v1.mjs'), 'utf8');
  assert.equal(/humanFinalPoints|humanGT|groundTruth/i.test(src), false);
  assert.equal(/originalProposalPoints/.test(src), false);
});
test('10: SupportStatus and EvidenceChannel are distinct, frozen enums -- support-kind and producing-subsystem are never collapsed into one value', () => {
  assert.ok(Object.isFrozen(EP.SupportStatus));
  assert.ok(Object.isFrozen(EP.EvidenceChannel));
  assert.notDeepEqual(Object.values(EP.SupportStatus), Object.values(EP.EvidenceChannel));
});

// ---- 11: production isolation --------------------------------------------------------------------
test('11: root production index.html carries no BeardEvidencePacketV1 symbols', () => {
  assert.equal(ROOT_INDEX_HTML.includes('BeardEvidencePacketV1'), false);
  assert.equal(ROOT_INDEX_HTML.includes('beard-evidence-packet'), false);
});
test('12: no sealed-holdout identifier appears in this module', () => {
  const src = readFileSync(join(HERE, 'beard-evidence-packet-v1.mjs'), 'utf8');
  assert.equal(src.includes('espu2w'), false);
});
