import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as C from './temporal-subphase-classifier-v1.mjs';

const CORRECTED_DESIGN_PATH = 'D:/MettleTemp/analysis/bi1z1x1_temporal_subphase_semantics_corrected_design.json';
const CORRECTED_DESIGN_SHA256 = 'f459b495dd465282f0254b5f83bbe50329bafb6902d53c27292ca6eb250def5d';

test('1. corrected design hash matches the frozen authoritative design', () => {
  const buf = readFileSync(CORRECTED_DESIGN_PATH);
  assert.equal(createHash('sha256').update(buf).digest('hex'), CORRECTED_DESIGN_SHA256);
});

test('2. duration enum exact membership -- exactly the 5 corrected states, no more, no less', () => {
  assert.deepEqual([...C.DURATION_SUBPHASES].sort(), [
    'BURST_SETTLE_TIMER_ACTIVE', 'POST_BURST_FORMAL_HOLD', 'TARGET_REGION_MATCHED_NOT_READY',
    'TURNING_OR_OFF_TARGET', 'UNKNOWN_SUBPHASE'
  ].sort());
});

test('3. removed states are never re-introduced as duration states', () => {
  C.REMOVED_DURATION_STATES.forEach(s => assert.ok(!C.DURATION_SUBPHASES.includes(s)));
});
test('3b. no READY_SETTLING', () => assert.ok(!C.DURATION_SUBPHASES.includes('READY_SETTLING')));
test('3c. no LOCK_SETTLED', () => assert.ok(!C.DURATION_SUBPHASES.includes('LOCK_SETTLED')));
test('3d. no POST_CAPTURE_HOLD', () => assert.ok(!C.DURATION_SUBPHASES.includes('POST_CAPTURE_HOLD')));
test('3e. no FORMAL_CAPTURE_PENDING', () => assert.ok(!C.DURATION_SUBPHASES.includes('FORMAL_CAPTURE_PENDING')));

test('4. point event types exact membership', () => {
  assert.deepEqual([...C.POINT_EVENT_TYPES].sort(), [
    'BURST_CLOSE', 'CAPTURE_ATTEMPT_FAILED', 'FIRST_READY_TRUE', 'FIRST_TARGET_REGION_MATCH', 'FORMAL_CAPTURED', 'STEP_ADVANCED'
  ].sort());
});

test('5. UNKNOWN_SUBPHASE on null/undefined facts (fail closed)', () => {
  assert.equal(C.classifyDurationSubphase(null), 'UNKNOWN_SUBPHASE');
  assert.equal(C.classifyDurationSubphase(undefined), 'UNKNOWN_SUBPHASE');
  assert.equal(C.classifyDurationSubphase({}), 'UNKNOWN_SUBPHASE');
});

test('6. UNKNOWN_SUBPHASE when burstActiveAtTrigger is missing/non-boolean', () => {
  assert.equal(C.classifyDurationSubphase({ burstActiveAtTrigger: null }), 'UNKNOWN_SUBPHASE');
  assert.equal(C.classifyDurationSubphase({ burstActiveAtTrigger: undefined }), 'UNKNOWN_SUBPHASE');
});

test('7. POST_BURST_FORMAL_HOLD only when burst inactive + preceding close POSE_LOCK_SETTLED + capture not yet committed', () => {
  assert.equal(C.classifyDurationSubphase({
    burstActiveAtTrigger: false, precedingBurstClosedWithPoseLockSettled: true, formalCaptureCommittedForStepAtTrigger: false
  }), 'POST_BURST_FORMAL_HOLD');
});

test('8. MAX_DURATION-equivalent (non-POSE_LOCK_SETTLED close) never yields POST_BURST_FORMAL_HOLD', () => {
  const r = C.classifyDurationSubphase({
    burstActiveAtTrigger: false, precedingBurstClosedWithPoseLockSettled: false, formalCaptureCommittedForStepAtTrigger: false,
    destinationRegionMatchedAtTrigger: true, scannerReadyAtTrigger: false
  });
  assert.notEqual(r, 'POST_BURST_FORMAL_HOLD');
});

test('9. formal capture already committed prevents POST_BURST_FORMAL_HOLD even after a POSE_LOCK_SETTLED close', () => {
  const r = C.classifyDurationSubphase({
    burstActiveAtTrigger: false, precedingBurstClosedWithPoseLockSettled: true, formalCaptureCommittedForStepAtTrigger: true,
    destinationRegionMatchedAtTrigger: true, scannerReadyAtTrigger: true
  });
  assert.notEqual(r, 'POST_BURST_FORMAL_HOLD');
});

test('10. BURST_SETTLE_TIMER_ACTIVE when burst active + lockedAtMs known set, regardless of current ready value', () => {
  assert.equal(C.classifyDurationSubphase({ burstActiveAtTrigger: true, lockedAtMsKnownSetAtTrigger: true, scannerReadyAtTrigger: true }), 'BURST_SETTLE_TIMER_ACTIVE');
  assert.equal(C.classifyDurationSubphase({ burstActiveAtTrigger: true, lockedAtMsKnownSetAtTrigger: true, scannerReadyAtTrigger: false }), 'BURST_SETTLE_TIMER_ACTIVE');
});

test('11. TARGET_REGION_MATCHED_NOT_READY requires region match AND ready===false', () => {
  assert.equal(C.classifyDurationSubphase({
    burstActiveAtTrigger: true, lockedAtMsKnownSetAtTrigger: false, destinationRegionMatchedAtTrigger: true, scannerReadyAtTrigger: false
  }), 'TARGET_REGION_MATCHED_NOT_READY');
});

test('12. TURNING_OR_OFF_TARGET when region does not match', () => {
  assert.equal(C.classifyDurationSubphase({
    burstActiveAtTrigger: true, lockedAtMsKnownSetAtTrigger: false, destinationRegionMatchedAtTrigger: false, scannerReadyAtTrigger: false
  }), 'TURNING_OR_OFF_TARGET');
});

test('13. on-target + ready + no burst context (removed POST_CAPTURE_HOLD territory) classifies UNKNOWN_SUBPHASE, never TURNING_OR_OFF_TARGET', () => {
  const r = C.classifyDurationSubphase({
    burstActiveAtTrigger: false, precedingBurstClosedWithPoseLockSettled: false, formalCaptureCommittedForStepAtTrigger: true,
    destinationRegionMatchedAtTrigger: true, scannerReadyAtTrigger: true
  });
  assert.equal(r, 'UNKNOWN_SUBPHASE');
});

test('14. scannerReadyAtTrigger never implied persistent by BURST_SETTLE_TIMER_ACTIVE -- both ready values reach the same state', () => {
  const a = C.classifyDurationSubphase({ burstActiveAtTrigger: true, lockedAtMsKnownSetAtTrigger: true, scannerReadyAtTrigger: true });
  const b = C.classifyDurationSubphase({ burstActiveAtTrigger: true, lockedAtMsKnownSetAtTrigger: true, scannerReadyAtTrigger: false });
  assert.equal(a, b);
});

test('15. deriveLockedAtMsKnownSetAtTrigger: false before any ready sample, true from the first ready sample onward (sticky)', () => {
  const samples = [
    { poseLockReadyAtTrigger: false }, { poseLockReadyAtTrigger: false }, { poseLockReadyAtTrigger: true }, { poseLockReadyAtTrigger: false }
  ];
  assert.equal(C.deriveLockedAtMsKnownSetAtTrigger(samples, 0), false);
  assert.equal(C.deriveLockedAtMsKnownSetAtTrigger(samples, 1), false);
  assert.equal(C.deriveLockedAtMsKnownSetAtTrigger(samples, 2), true);
  assert.equal(C.deriveLockedAtMsKnownSetAtTrigger(samples, 3), true, 'sticky -- never resets once set within the burst');
});

test('16. buildBurstSampleFacts never mutates the original sample array', () => {
  const samples = [{ observedPoseRegion: 'RIGHT45_REGION', poseLockReadyAtTrigger: false }];
  const before = JSON.stringify(samples);
  C.buildBurstSampleFacts(samples, 0, 'RIGHT_PROFILE_REGION');
  assert.equal(JSON.stringify(samples), before);
});

test('17. buildBurstSampleFacts: burstActiveAtTrigger always true, post-burst facts always false (not applicable mid-burst)', () => {
  const facts = C.buildBurstSampleFacts([{ observedPoseRegion: 'X', poseLockReadyAtTrigger: true }], 0, 'X');
  assert.equal(facts.burstActiveAtTrigger, true);
  assert.equal(facts.precedingBurstClosedWithPoseLockSettled, false);
  assert.equal(facts.formalCaptureCommittedForStepAtTrigger, false);
});

test('18. buildWholeScanOwnedFacts derives lockedAtMsKnownSetAtTrigger only when burst active', () => {
  const f1 = C.buildWholeScanOwnedFacts({ burstActiveAtTrigger: false, lockedAtMsAtTrigger: 123 });
  assert.equal(f1.lockedAtMsKnownSetAtTrigger, null, 'burst not active -- lockedAtMs question not applicable');
  const f2 = C.buildWholeScanOwnedFacts({ burstActiveAtTrigger: true, lockedAtMsAtTrigger: 123 });
  assert.equal(f2.lockedAtMsKnownSetAtTrigger, true);
  const f3 = C.buildWholeScanOwnedFacts({ burstActiveAtTrigger: true, lockedAtMsAtTrigger: null });
  assert.equal(f3.lockedAtMsKnownSetAtTrigger, false);
});

test('19. buildWholeScanOwnedFacts maps precedingBurstEndReasonAtTrigger=POSE_LOCK_SETTLED to precedingBurstClosedWithPoseLockSettled=true', () => {
  const f = C.buildWholeScanOwnedFacts({ burstActiveAtTrigger: false, precedingBurstEndReasonAtTrigger: 'POSE_LOCK_SETTLED', formalCaptureAlreadyCommittedForStepAtTrigger: false });
  assert.equal(f.precedingBurstClosedWithPoseLockSettled, true);
  assert.equal(C.classifyDurationSubphase(f), 'POST_BURST_FORMAL_HOLD');
});

['MAX_DURATION_REACHED', 'MAX_FRAMES_PER_BURST_REACHED', 'SUPERSEDED_BY_NEW_BURST', 'SCAN_ENDED'].forEach(reason => {
  test(`20. non-POSE_LOCK_SETTLED close (${reason}) never yields POST_BURST_FORMAL_HOLD via buildWholeScanOwnedFacts`, () => {
    const f = C.buildWholeScanOwnedFacts({ burstActiveAtTrigger: false, precedingBurstEndReasonAtTrigger: reason, formalCaptureAlreadyCommittedForStepAtTrigger: false, destinationRegionMatchedAtTrigger: true, scannerReadyAtTrigger: false });
    assert.notEqual(C.classifyDurationSubphase(f), 'POST_BURST_FORMAL_HOLD');
  });
});

test('21. STEP_ID_TO_FORMAL_REGION covers exactly the 6 scanner steps, values are all real A60B formal region names', () => {
  const REGIONS = new Set(['FRONT_REGION', 'RIGHT45_REGION', 'RIGHT_PROFILE_REGION', 'LEFT45_REGION', 'LEFT_PROFILE_REGION', 'CHINUP_REGION']);
  const ids = Object.keys(C.STEP_ID_TO_FORMAL_REGION);
  assert.deepEqual(ids.sort(), ['chin-up', 'front', 'left-profile', 'left-three-quarter', 'right-profile', 'right-three-quarter'].sort());
  ids.forEach(id => assert.ok(REGIONS.has(C.STEP_ID_TO_FORMAL_REGION[id])));
});

test('22. FIRST_TARGET_REGION_MATCH event picks the first matching sample by array order (already time-sorted upstream)', () => {
  const burst = { burstId: 'b1', sourceTransition: 'right-three-quarter_TO_right-profile', endReason: 'POSE_LOCK_SETTLED', samples: [
    { observedPoseRegion: 'RIGHT45_TO_RIGHT_PROFILE', nativeFrameTimestampNs: '1' },
    { observedPoseRegion: 'RIGHT_PROFILE_REGION', nativeFrameTimestampNs: '2' },
    { observedPoseRegion: 'RIGHT_PROFILE_REGION', nativeFrameTimestampNs: '3' }
  ] };
  const e = C.buildFirstTargetRegionMatchEvent('scan1', burst, 'RIGHT_PROFILE_REGION');
  assert.equal(e.eventType, 'FIRST_TARGET_REGION_MATCH');
  assert.equal(e.relatedNativeFrameTimestampNs, '2');
  assert.equal(e.scannerStep, 'right-profile');
});

test('23. FIRST_TARGET_REGION_MATCH returns null when no sample ever matches', () => {
  const burst = { burstId: 'b1', sourceTransition: 'front_TO_right-three-quarter', samples: [{ observedPoseRegion: 'TRANSITION_OTHER', nativeFrameTimestampNs: '1' }] };
  assert.equal(C.buildFirstTargetRegionMatchEvent('scan1', burst, 'RIGHT45_REGION'), null);
});

test('24. FIRST_READY_TRUE event picks the first ready sample', () => {
  const burst = { burstId: 'b1', sourceTransition: 'front_TO_right-three-quarter', endReason: 'POSE_LOCK_SETTLED', samples: [
    { poseLockReadyAtTrigger: false, nativeFrameTimestampNs: '1' },
    { poseLockReadyAtTrigger: true, nativeFrameTimestampNs: '2' }
  ] };
  const e = C.buildFirstReadyTrueEvent('scan1', burst);
  assert.equal(e.eventType, 'FIRST_READY_TRUE');
  assert.equal(e.relatedNativeFrameTimestampNs, '2');
});

test('25. BURST_CLOSE event carries the real endReason and a PERFORMANCE_NOW-domain jsTimestampMs when derivable', () => {
  const burst = { burstId: 'b1', sourceTransition: 'front_TO_right-three-quarter', endReason: 'MAX_DURATION_REACHED', startedAtMs: 1000, actualDurationMs: 2500, endNativeTimestampNs: '999' };
  const e = C.buildBurstCloseEvent('scan1', burst);
  assert.equal(e.eventType, 'BURST_CLOSE');
  assert.equal(e.burstEndReason, 'MAX_DURATION_REACHED');
  assert.equal(e.jsTimestampMs, 3500);
  assert.equal(e.jsClockDomain, 'PERFORMANCE_NOW');
  assert.equal(e.relatedNativeFrameTimestampNs, '999');
});

test('26. FORMAL_CAPTURED event uses EPOCH_ISO clock domain, never invents a native timestamp beyond the real association', () => {
  const assoc = { formalCaptureId: 'right-profile', formalCaptureAt: '2026-09-13T00:00:00.000Z', formalCaptureNativeTs: '4242' };
  const e = C.buildFormalCapturedEvent('scan1', assoc);
  assert.equal(e.eventType, 'FORMAL_CAPTURED');
  assert.equal(e.jsClockDomain, 'EPOCH_ISO');
  assert.equal(e.jsTimestampMs, null, 'never fabricates a PERFORMANCE_NOW value for an EPOCH_ISO-sourced event');
  assert.equal(e.relatedNativeFrameTimestampNs, '4242');
});

test('27. STEP_ADVANCED event shares FORMAL_CAPTURED\'s timestamp facts (code-proven synchronous), as its own distinct eventType', () => {
  const assoc = { formalCaptureId: 'front', formalCaptureAt: '2026-09-13T00:00:00.000Z', formalCaptureNativeTs: '111' };
  const cap = C.buildFormalCapturedEvent('scan1', assoc);
  const adv = C.buildStepAdvancedEvent('scan1', assoc);
  assert.equal(adv.eventType, 'STEP_ADVANCED');
  assert.notEqual(adv.eventType, cap.eventType);
  assert.equal(adv.jsTimestampIso, cap.jsTimestampIso);
  assert.equal(adv.relatedNativeFrameTimestampNs, cap.relatedNativeFrameTimestampNs);
});

test('28. CAPTURE_ATTEMPT_FAILED is explicitly documented as uninstrumented, not fabricated as a real event', () => {
  assert.equal(C.CAPTURE_ATTEMPT_FAILED_STATUS.status, 'UNINSTRUMENTED_RUNTIME_EVENT');
  assert.equal(C.CAPTURE_ATTEMPT_FAILED_STATUS.eventType, 'CAPTURE_ATTEMPT_FAILED');
});

test('29. early-return guard scenarios are never represented as CAPTURE_ATTEMPT_FAILED anywhere in this module', () => {
  // The module exposes no function that could construct this event from a guard-return path --
  // the only reference to the event type is the documentation-only status object.
  const src = readFileSync(new URL('./temporal-subphase-classifier-v1.mjs', import.meta.url), 'utf8');
  const occurrences = src.split('CAPTURE_ATTEMPT_FAILED').length - 1;
  // Appears in POINT_EVENT_TYPES array, the status object's eventType, and its status name -- never as a constructed/returned event elsewhere.
  assert.ok(occurrences <= 4, 'CAPTURE_ATTEMPT_FAILED must not be wired into any live event-construction path this stage');
});

test('30. assembleTemporalSubphaseEvents keeps events structurally separate from any duration-state field (no temporalSubphase key on an event)', () => {
  const bursts = [{ burstId: 'b1', sourceTransition: 'front_TO_right-three-quarter', endReason: 'POSE_LOCK_SETTLED', startedAtMs: 0, actualDurationMs: 100, endNativeTimestampNs: '10',
    samples: [{ observedPoseRegion: 'RIGHT45_REGION', poseLockReadyAtTrigger: true, nativeFrameTimestampNs: '10' }] }];
  const assocs = [{ formalCaptureId: 'right-three-quarter', formalCaptureAt: '2026-01-01T00:00:00.000Z', formalCaptureNativeTs: '11' }];
  const events = C.assembleTemporalSubphaseEvents('scan1', bursts, assocs);
  events.forEach(e => assert.ok(!('temporalSubphase' in e)));
  assert.ok(events.some(e => e.eventType === 'FIRST_TARGET_REGION_MATCH'));
  assert.ok(events.some(e => e.eventType === 'FIRST_READY_TRUE'));
  assert.ok(events.some(e => e.eventType === 'BURST_CLOSE'));
  assert.ok(events.some(e => e.eventType === 'FORMAL_CAPTURED'));
  assert.ok(events.some(e => e.eventType === 'STEP_ADVANCED'));
});

test('31. every event carries scanSessionId, eventType, and an explicit jsClockDomain (possibly null, never absent as a key)', () => {
  const bursts = [{ burstId: 'b1', sourceTransition: 'front_TO_right-three-quarter', endReason: 'POSE_LOCK_SETTLED', startedAtMs: 0, actualDurationMs: 50, endNativeTimestampNs: '5',
    samples: [{ observedPoseRegion: 'RIGHT45_REGION', poseLockReadyAtTrigger: true, nativeFrameTimestampNs: '5' }] }];
  const events = C.assembleTemporalSubphaseEvents('scan1', bursts, []);
  events.forEach(e => {
    assert.equal(e.scanSessionId, 'scan1');
    assert.ok(C.POINT_EVENT_TYPES.includes(e.eventType));
    assert.ok('jsClockDomain' in e);
  });
});

test('32. PERFORMANCE_NOW-domain and EPOCH_ISO-domain events are never numerically comparable through jsTimestampMs alone', () => {
  const burstEvent = C.buildBurstCloseEvent('scan1', { burstId: 'b1', sourceTransition: 'x_TO_y', endReason: 'POSE_LOCK_SETTLED', startedAtMs: 0, actualDurationMs: 400, endNativeTimestampNs: '1' });
  const captureEvent = C.buildFormalCapturedEvent('scan1', { formalCaptureId: 'y', formalCaptureAt: '2026-01-01T00:00:00.000Z', formalCaptureNativeTs: '2' });
  assert.equal(burstEvent.jsClockDomain, 'PERFORMANCE_NOW');
  assert.equal(captureEvent.jsClockDomain, 'EPOCH_ISO');
  assert.notEqual(burstEvent.jsClockDomain, captureEvent.jsClockDomain);
  assert.equal(captureEvent.jsTimestampMs, null, 'no PERFORMANCE_NOW value exists for this event -- never derived from EPOCH_ISO');
});

test('33. module contains no scanner timing, cadence, or newly fitted pose/motion threshold', () => {
  const src = readFileSync(new URL('./temporal-subphase-classifier-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/TEMPORAL_BURST_TARGET_INTERVAL_MS\s*=/.test(src));
  assert.ok(!/WHOLE_SCAN_TARGET_INTERVAL_MS\s*=/.test(src));
  assert.ok(!/SETTLE_TAIL_MS\s*=/.test(src));
  assert.ok(!/mgScan2HoldMs/.test(src));
});

test('34. module never imports V2/GT/occupancy/Hairness machinery', () => {
  const src = readFileSync(new URL('./temporal-subphase-classifier-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/head-relative-temporal-measurement-v2/.test(src));
  assert.ok(!/occupancy/i.test(src));
  assert.ok(!/hairness/i.test(src));
  assert.ok(!/ground.?truth|\bGT\b/i.test(src));
});

test('35. module has zero network/IO calls beyond readFileSync used only by its own tests', () => {
  const src = readFileSync(new URL('./temporal-subphase-classifier-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|axios/.test(src));
});

test('36. module never imports a DOM/browser/native-bridge global', () => {
  const src = readFileSync(new URL('./temporal-subphase-classifier-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/window\.|document\.|BeardTrimAndroid/.test(src));
});

test('37. no beard/shirt/neckline semantic classification anywhere in this module', () => {
  const src = readFileSync(new URL('./temporal-subphase-classifier-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/beard|shirt|neckline|jawline\s*classif/i.test(src));
});
