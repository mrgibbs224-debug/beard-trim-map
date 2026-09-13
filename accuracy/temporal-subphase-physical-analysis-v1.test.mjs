import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as A from './temporal-subphase-physical-analysis-v1.mjs';

test('1. frozen manifest hash re-verifies', () => {
  const buf = readFileSync('D:/MettleTemp/analysis/bi1z2a_temporal_subphase_instrumentation_frozen_manifest.json');
  assert.equal(createHash('sha256').update(buf).digest('hex'), 'd53defa233a5161c3d92b8b80f6299033e70199b86ea8d341c0442a268e1edf7');
});

test('2. exactly the five authorized scans are recognized, no others', () => {
  assert.deepEqual([...A.AUTHORIZED_SCAN_SESSION_IDS].sort(), [
    'scan_mtzxr228_7b50dm', 'scan_mtzxslrd_yxv72h', 'scan_mtzxt16l_tzqup3', 'scan_mtzxtevz_hp05uo', 'scan_mtzxtrhf_dlw7ge'
  ].sort());
});

test('3. assertAuthorizedScan throws for an unauthorized scan id (never silently pools other data)', () => {
  assert.throws(() => A.assertAuthorizedScan('scan_mtz6mhc9_3aoc5d'), /UNAUTHORIZED_SCAN_FOR_BI_1Z2B/);
  A.AUTHORIZED_SCAN_SESSION_IDS.forEach(id => assert.doesNotThrow(() => A.assertAuthorizedScan(id)));
});

test('4. deriveDuration prefers native-frame timestamps when both events have one', () => {
  const a = { relatedNativeFrameTimestampNs: '1000000000', jsClockDomain: null };
  const b = { relatedNativeFrameTimestampNs: '1050000000', jsClockDomain: null };
  const r = A.deriveDuration(a, b);
  assert.equal(r.status, 'AVAILABLE');
  assert.equal(r.domain, 'NATIVE_FRAME_TIMESTAMP_NS');
  assert.equal(r.ms, 50);
});

test('5. deriveDuration falls back to a shared PERFORMANCE_NOW pair only when no native pair exists', () => {
  const a = { relatedNativeFrameTimestampNs: null, jsClockDomain: 'PERFORMANCE_NOW', jsTimestampMs: 1000 };
  const b = { relatedNativeFrameTimestampNs: null, jsClockDomain: 'PERFORMANCE_NOW', jsTimestampMs: 1400 };
  const r = A.deriveDuration(a, b);
  assert.equal(r.status, 'AVAILABLE');
  assert.equal(r.domain, 'PERFORMANCE_NOW');
  assert.equal(r.ms, 400);
});

test('6. deriveDuration NEVER cross-subtracts a PERFORMANCE_NOW event against an EPOCH_ISO event', () => {
  const a = { relatedNativeFrameTimestampNs: null, jsClockDomain: 'PERFORMANCE_NOW', jsTimestampMs: 1000 };
  const b = { relatedNativeFrameTimestampNs: null, jsClockDomain: 'EPOCH_ISO', jsTimestampIso: '2026-01-01T00:00:00.000Z' };
  const r = A.deriveDuration(a, b);
  assert.equal(r.status, 'DURATION_UNAVAILABLE_CROSS_CLOCK');
  assert.equal(r.ms, null);
});

test('7. deriveDuration reports DURATION_UNAVAILABLE_CROSS_CLOCK when neither domain matches, never fabricates a number', () => {
  const a = { relatedNativeFrameTimestampNs: null, jsClockDomain: 'EPOCH_ISO', jsTimestampIso: 'x' };
  const b = { relatedNativeFrameTimestampNs: null, jsClockDomain: null };
  assert.equal(A.deriveDuration(a, b).status, 'DURATION_UNAVAILABLE_CROSS_CLOCK');
});

test('8. classifyCompleteness requires exactly 6 formal captures, 5 bursts, schema /3', () => {
  assert.equal(A.classifyCompleteness({ formalCaptureAssociations: new Array(6), temporalMotionBursts: new Array(5), exactFrameResearchCaptureVersion: 'exact-frame-research-capture/3' }).complete, true);
  assert.equal(A.classifyCompleteness({ formalCaptureAssociations: new Array(5), temporalMotionBursts: new Array(5), exactFrameResearchCaptureVersion: 'exact-frame-research-capture/3' }).complete, false);
  assert.equal(A.classifyCompleteness({ formalCaptureAssociations: new Array(6), temporalMotionBursts: new Array(4), exactFrameResearchCaptureVersion: 'exact-frame-research-capture/3' }).complete, false);
  assert.equal(A.classifyCompleteness({ formalCaptureAssociations: new Array(6), temporalMotionBursts: new Array(5), exactFrameResearchCaptureVersion: 'exact-frame-research-capture/2' }).complete, false);
});

test('9. findBurstForStep locates by the destination (TO) side of sourceTransition', () => {
  const bursts = [{ sourceTransition: 'right-three-quarter_TO_right-profile', burstId: 'b1' }, { sourceTransition: 'front_TO_right-three-quarter', burstId: 'b2' }];
  assert.equal(A.findBurstForStep(bursts, 'right-profile').burstId, 'b1');
  assert.equal(A.findBurstForStep(bursts, 'chin-up'), null);
});

test('10. right/left profile are analyzed as separate step ids, never merged', () => {
  assert.deepEqual([...A.PROFILE_STEP_IDS], ['right-profile', 'left-profile']);
});

test('11. splitTimelineByProvenance separates WHOLE_SCAN_OWNED from BURST_SHARED exhaustively', () => {
  const samples = [{ provenance: 'WHOLE_SCAN_OWNED' }, { provenance: 'BURST_SHARED' }, { provenance: 'WHOLE_SCAN_OWNED' }];
  const { owned, shared } = A.splitTimelineByProvenance(samples);
  assert.equal(owned.length, 2);
  assert.equal(shared.length, 1);
});

test('12. sharedSamplesForBurst filters by sourceBurstId and sorts by native timestamp', () => {
  const shared = [
    { sourceBurstId: 'b1', nativeFrameTimestampNs: '30' }, { sourceBurstId: 'b2', nativeFrameTimestampNs: '10' },
    { sourceBurstId: 'b1', nativeFrameTimestampNs: '10' }
  ];
  const r = A.sharedSamplesForBurst(shared, 'b1');
  assert.equal(r.length, 2);
  assert.equal(r[0].nativeFrameTimestampNs, '10');
});

test('13. ownedSamplesForStep filters by scannerStepAtTrigger and sorts by native timestamp', () => {
  const owned = [{ scannerStepAtTrigger: 'right-profile', nativeFrameTimestampNs: '20' }, { scannerStepAtTrigger: 'chin-up', nativeFrameTimestampNs: '5' }, { scannerStepAtTrigger: 'right-profile', nativeFrameTimestampNs: '10' }];
  const r = A.ownedSamplesForStep(owned, 'right-profile');
  assert.equal(r.length, 2);
  assert.equal(r[0].nativeFrameTimestampNs, '10');
});

test('14. analyzeReadyDropouts counts scannerReadyAtTrigger=false only among BURST_SETTLE_TIMER_ACTIVE samples', () => {
  const shared = [
    { temporalSubphase: 'BURST_SETTLE_TIMER_ACTIVE', scannerReadyAtTrigger: true, qualityOkAtTrigger: true },
    { temporalSubphase: 'BURST_SETTLE_TIMER_ACTIVE', scannerReadyAtTrigger: false, qualityOkAtTrigger: false },
    { temporalSubphase: 'TURNING_OR_OFF_TARGET', scannerReadyAtTrigger: false }
  ];
  const r = A.analyzeReadyDropouts(shared);
  assert.equal(r.burstSettleTimerActiveSampleCount, 2);
  assert.equal(r.readyFalseWhileTimerActiveCount, 1);
  assert.equal(r.readyTrueWhileTimerActiveCount, 1);
});

test('15. analyzePostBurstFormalHold returns present:false with zero count when no such samples exist', () => {
  const r = A.analyzePostBurstFormalHold([{ temporalSubphase: 'TURNING_OR_OFF_TARGET' }]);
  assert.equal(r.present, false);
  assert.equal(r.sampleCount, 0);
});

test('16. analyzePostBurstFormalHold reports formalHoldElapsedMsAtTrigger progression honestly (never fabricated)', () => {
  const samples = [
    { temporalSubphase: 'POST_BURST_FORMAL_HOLD', nativeFrameTimestampNs: '1', yawDeg: 40, pitchDeg: 0, destinationRegionMatchedAtTrigger: true, scannerReadyAtTrigger: true, qualityOkAtTrigger: true, formalHoldElapsedMsAtTrigger: 100, formalCaptureStateAtTrigger: 'hold' },
    { temporalSubphase: 'POST_BURST_FORMAL_HOLD', nativeFrameTimestampNs: '2', yawDeg: 41, pitchDeg: 0, destinationRegionMatchedAtTrigger: true, scannerReadyAtTrigger: true, qualityOkAtTrigger: true, formalHoldElapsedMsAtTrigger: 200, formalCaptureStateAtTrigger: 'locked' }
  ];
  const r = A.analyzePostBurstFormalHold(samples);
  assert.equal(r.present, true);
  assert.equal(r.sampleCount, 2);
  assert.deepEqual(r.formalHoldElapsedMsAtTriggerSequence, [100, 200]);
  assert.equal(r.formalHoldElapsedMonotonicNonDecreasing, true);
});

test('17. combineLateBurstAndPostBurst merges by native timestamp across BOTH provenances (the one shared comparable domain)', () => {
  const shared = [{ temporalSubphase: 'BURST_SETTLE_TIMER_ACTIVE', nativeFrameTimestampNs: '100', destinationRegionMatchedAtTrigger: true, scannerReadyAtTrigger: false }];
  const owned = [{ temporalSubphase: 'POST_BURST_FORMAL_HOLD', nativeFrameTimestampNs: '200', destinationRegionMatchedAtTrigger: true, scannerReadyAtTrigger: true }];
  const r = A.combineLateBurstAndPostBurst(shared, owned);
  assert.equal(r.observationCount, 2);
  assert.deepEqual(r.orderedSourceSequence, ['LATE_BURST_SETTLE', 'POST_BURST_FORMAL_HOLD']);
  assert.equal(r.timeSpanMs, (200 - 100) / 1e6);
});

test('18. classifyTimingSufficiency: non-POSE_LOCK_SETTLED close is always TRUE_TEMPORAL_COVERAGE_GAP, never reinterpreted', () => {
  A.NON_POSE_LOCK_CLOSE_REASONS.forEach(reason => {
    assert.equal(A.classifyTimingSufficiency(reason, { observationCount: 5, lateBurstCount: 3, postBurstCount: 2, timeSpanMs: 500 }), 'TRUE_TEMPORAL_COVERAGE_GAP');
  });
});

test('19. classifyTimingSufficiency: DATA_INSUFFICIENT when burstEndReason is unknown', () => {
  assert.equal(A.classifyTimingSufficiency(null, null), 'DATA_INSUFFICIENT');
});

test('20. classifyTimingSufficiency: CLEAR_EXISTING_TEMPORAL_COVERAGE requires both late-burst and post-burst samples plus measurable span', () => {
  assert.equal(A.classifyTimingSufficiency('POSE_LOCK_SETTLED', { observationCount: 3, lateBurstCount: 2, postBurstCount: 1, timeSpanMs: 300 }), 'CLEAR_EXISTING_TEMPORAL_COVERAGE');
});

test('21. classifyTimingSufficiency: PARTIAL when only one side has samples', () => {
  assert.equal(A.classifyTimingSufficiency('POSE_LOCK_SETTLED', { observationCount: 2, lateBurstCount: 2, postBurstCount: 0, timeSpanMs: 100 }), 'PARTIAL_EXISTING_TEMPORAL_COVERAGE');
});

test('22. classifyTimingSufficiency: TRUE_TEMPORAL_COVERAGE_GAP when POSE_LOCK_SETTLED but zero combined observations', () => {
  assert.equal(A.classifyTimingSufficiency('POSE_LOCK_SETTLED', { observationCount: 0, lateBurstCount: 0, postBurstCount: 0, timeSpanMs: null }), 'TRUE_TEMPORAL_COVERAGE_GAP');
});

test('23. classifyTimingSufficiency never fits a numeric sample-count threshold -- 1 vs 2 vs 100 samples with both sides present and a span all resolve the same way (structural, not count-calibrated)', () => {
  const a = A.classifyTimingSufficiency('POSE_LOCK_SETTLED', { observationCount: 2, lateBurstCount: 1, postBurstCount: 1, timeSpanMs: 1 });
  const b = A.classifyTimingSufficiency('POSE_LOCK_SETTLED', { observationCount: 100, lateBurstCount: 50, postBurstCount: 50, timeSpanMs: 5000 });
  assert.equal(a, 'CLEAR_EXISTING_TEMPORAL_COVERAGE');
  assert.equal(b, 'CLEAR_EXISTING_TEMPORAL_COVERAGE');
});

test('24. auditMidFlightDensityGap is circumstantial-only, never asserts causation, and handles a missing burst', () => {
  assert.equal(A.auditMidFlightDensityGap(null).evidenceOfBoundaryDrop, false);
  const r = A.auditMidFlightDensityGap({ skippedCount: 2, lastSkipReason: 'REQUEST_REJECTED_OR_TIMEOUT' });
  assert.equal(r.evidenceOfBoundaryDrop, true);
  assert.match(r.note, /never treated as proof/);
});

test('25. auditEventOrdering flags an impossible order using only native-domain comparisons', () => {
  const events = [
    { eventType: 'FIRST_TARGET_REGION_MATCH', relatedNativeFrameTimestampNs: '200' },
    { eventType: 'FIRST_READY_TRUE', relatedNativeFrameTimestampNs: '100' },
    { eventType: 'BURST_CLOSE', relatedNativeFrameTimestampNs: '300' }
  ];
  const r = A.auditEventOrdering(events, null);
  assert.equal(r.noImpossibleOrder, false);
  assert.ok(r.issues.some(i => i.includes('FIRST_TARGET_REGION_MATCH occurs after FIRST_READY_TRUE')));
});

test('26. auditEventOrdering passes for a well-ordered event set', () => {
  const events = [
    { eventType: 'FIRST_TARGET_REGION_MATCH', relatedNativeFrameTimestampNs: '100' },
    { eventType: 'FIRST_READY_TRUE', relatedNativeFrameTimestampNs: '200' },
    { eventType: 'BURST_CLOSE', relatedNativeFrameTimestampNs: '300' },
    { eventType: 'FORMAL_CAPTURED', relatedNativeFrameTimestampNs: '400' }
  ];
  assert.equal(A.auditEventOrdering(events, null).noImpossibleOrder, true);
});

test('27. auditStateIntegrity flags POST_BURST_FORMAL_HOLD on a non-owned (i.e. BURST_SHARED) sample as a violation', () => {
  const r = A.auditStateIntegrity([{ wholeScanSampleId: 'x', temporalSubphase: 'POST_BURST_FORMAL_HOLD', provenance: 'BURST_SHARED' }]);
  assert.equal(r.violationCount, 1);
});

test('28. auditStateIntegrity flags TARGET_REGION_MATCHED_NOT_READY without an actual region match', () => {
  const r = A.auditStateIntegrity([{ wholeScanSampleId: 'x', temporalSubphase: 'TARGET_REGION_MATCHED_NOT_READY', destinationRegionMatchedAtTrigger: false }]);
  assert.equal(r.violationCount, 1);
});

test('29. auditStateIntegrity finds zero violations on an internally consistent sample set', () => {
  const r = A.auditStateIntegrity([
    { wholeScanSampleId: 'a', temporalSubphase: 'POST_BURST_FORMAL_HOLD', provenance: 'WHOLE_SCAN_OWNED' },
    { wholeScanSampleId: 'b', temporalSubphase: 'TARGET_REGION_MATCHED_NOT_READY', destinationRegionMatchedAtTrigger: true },
    { wholeScanSampleId: 'c', temporalSubphase: 'BURST_SETTLE_TIMER_ACTIVE', provenance: 'WHOLE_SCAN_OWNED', burstActiveAtTrigger: true }
  ]);
  assert.equal(r.violationCount, 0);
});

test('30. UNKNOWN_SUBPHASE samples never trigger any integrity violation rule (fail-closed classification is not itself a violation)', () => {
  const r = A.auditStateIntegrity([{ wholeScanSampleId: 'x', temporalSubphase: 'UNKNOWN_SUBPHASE' }]);
  assert.equal(r.violationCount, 0);
});

test('31. module fits no new numeric yaw/pitch/motion threshold', () => {
  const src = readFileSync(new URL('./temporal-subphase-physical-analysis-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/yawDeg\s*[<>]=?\s*-?\d/.test(src));
  assert.ok(!/pitchDeg\s*[<>]=?\s*-?\d/.test(src));
});

test('32. clothing is never referenced in this analysis module\'s executable logic (descriptive-only note lives in the report/JSON output, not analysis code)', () => {
  const src = readFileSync(new URL('./temporal-subphase-physical-analysis-v1.mjs', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export const AUTHORIZED_SCAN_SESSION_IDS'));
  assert.ok(!/shirt|clothing|shirtless/i.test(body));
});

// The leading file-header comment intentionally documents what this module does NOT do (a
// disclaimer, matching every other stage's convention) -- code-level checks below scan only the
// executable body, past that header, so the disclaimer's own wording never false-positives.
function bodyOnly(src) { return src.slice(src.indexOf('export const AUTHORIZED_SCAN_SESSION_IDS')); }

test('33. module never imports V2/GT/occupancy/Hairness machinery', () => {
  const src = bodyOnly(readFileSync(new URL('./temporal-subphase-physical-analysis-v1.mjs', import.meta.url), 'utf8'));
  assert.ok(!/head-relative-temporal-measurement-v2/.test(src));
  assert.ok(!/occupancy/i.test(src));
  assert.ok(!/hairness/i.test(src));
  assert.ok(!/ground.?truth|\bGT\b/i.test(src));
});

test('34. module has zero network calls', () => {
  const src = readFileSync(new URL('./temporal-subphase-physical-analysis-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(src));
});

test('35. module never imports a DOM/browser/native-bridge global', () => {
  const src = readFileSync(new URL('./temporal-subphase-physical-analysis-v1.mjs', import.meta.url), 'utf8');
  assert.ok(!/window\.|document\.|BeardTrimAndroid/.test(src));
});

test('36. no beard/neckline semantic classification in this module', () => {
  const src = bodyOnly(readFileSync(new URL('./temporal-subphase-physical-analysis-v1.mjs', import.meta.url), 'utf8'));
  assert.ok(!/beard|neckline/i.test(src));
});
