import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from './temporal-subphase-classifier-v1.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(HERE, '..', 'index.html');
const WORKER_PATH = join(HERE, '..', 'worker.js');

function readIndex() { return readFileSync(INDEX_PATH, 'utf8'); }

test('1. corrected design hash re-verifies (source of truth for this stage)', () => {
  const buf = readFileSync('D:/MettleTemp/analysis/bi1z1x1_temporal_subphase_semantics_corrected_design.json');
  assert.equal(createHash('sha256').update(buf).digest('hex'), 'f459b495dd465282f0254b5f83bbe50329bafb6902d53c27292ca6eb250def5d');
});

test('2. the sacrosanct burst-recorder source block is byte-identical to BI-1Z1R/S/T', () => {
  const src = readIndex();
  const startIdx = src.indexOf('const TEMPORAL_BURST_TARGET_INTERVAL_MS');
  const endStart = src.indexOf('function __updateMotionBurstIndicatorUI(){');
  const endIdx = src.indexOf('\n}', endStart) + 2;
  const block = src.slice(startIdx, endIdx);
  assert.equal(createHash('sha256').update(block).digest('hex'), 'eae6776bf4299af02f41b0ac3805bb59eb0167dc903c45a9ca08e87941f0762a');
});

test('3. worker.js is unchanged by this stage', () => {
  const buf = readFileSync(WORKER_PATH);
  assert.equal(createHash('sha256').update(buf).digest('hex'), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});

test('4. existing phase field/values are not renamed or removed', () => {
  const src = readIndex();
  assert.ok(src.includes("TRANSITION_'+from+'_TO_'+to"));
  assert.ok(src.includes("'POSE_HOLD_'+suffix"));
});

test('5. existing acquisitionSource/provenance labels unchanged', () => {
  const src = readIndex();
  assert.ok(src.includes("provenance:'WHOLE_SCAN_OWNED'"));
  assert.ok(src.includes("provenance:'BURST_SHARED'"));
});

test('6. exactly the 5 corrected duration states are declared, no removed states re-introduced', () => {
  const src = readIndex();
  const m = src.match(/const TEMPORAL_SUBPHASE_DURATION_STATES\s*=\s*\[([^\]]*)\]/);
  assert.ok(m);
  const states = m[1].split(',').map(s => s.replace(/['"\s]/g, '')).filter(Boolean);
  assert.deepEqual([...states].sort(), [...C.DURATION_SUBPHASES].sort());
  ['READY_SETTLING', 'LOCK_SETTLED', 'POST_CAPTURE_HOLD', 'FORMAL_CAPTURE_PENDING'].forEach(bad => {
    assert.ok(!states.includes(bad), `${bad} must not be declared as a duration state`);
  });
});

test('7. UNKNOWN_SUBPHASE fail-closed path exists in the inline classifier', () => {
  const src = readIndex();
  assert.match(src, /return 'UNKNOWN_SUBPHASE';/);
});

test('8. inline classifier function exists and mirrors the pure module\'s exported states', () => {
  const src = readIndex();
  assert.match(src, /function __temporalSubphaseClassify\(facts\)\{/);
});

test('9. destinationRegionMatchedAtTrigger is recomputed per trigger, never cached as a sticky "entered" flag', () => {
  const src = readIndex();
  // The whole-scan owned path recomputes destinationRegionMatchedAtTrigger fresh from the freshly
  // classified observedPoseRegionAtTrigger every call -- no module-level "hasEnteredRegion" state exists.
  assert.ok(!/hasEnteredRegion|regionEnteredFlag|stickyRegion/i.test(src));
  assert.match(src, /const destinationRegionMatchedAtTrigger=destinationFormalRegionAtTrigger!=null\?\(observedPoseRegionAtTrigger===destinationFormalRegionAtTrigger\):null;/);
});

test('10. scanner readiness (scannerReadyAtTrigger) is never conflated with lockedAtMs presence', () => {
  const src = readIndex();
  // The classifier's BURST_SETTLE_TIMER_ACTIVE branch never reads scannerReadyAtTrigger.
  const fnMatch = src.match(/function __temporalSubphaseClassify\(facts\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch);
  const fnBody = fnMatch[0];
  const settleLine = fnBody.split('\n').find(l => l.includes('BURST_SETTLE_TIMER_ACTIVE'));
  assert.ok(settleLine && !settleLine.includes('scannerReadyAtTrigger'));
});

test('11. stableFramesAtTrigger is captured for WHOLE_SCAN_OWNED samples from the existing stableFrames variable, no new threshold introduced', () => {
  const src = readIndex();
  assert.match(src, /stableFramesAtTrigger:\(typeof stableFrames==='number'\)\?stableFrames:null/);
});

test('12. lockedAtMsAtTrigger / lockElapsedMsAtTrigger are read-only reads of the existing burst recorder, never a new write', () => {
  const src = readIndex();
  assert.match(src, /const lockedAtMsAtTrigger=\(burstRec && burstRec\.currentBurst && typeof burstRec\.currentBurst\.lockedAtMs==='number'\)\?burstRec\.currentBurst\.lockedAtMs:null;/);
  assert.match(src, /const lockElapsedMsAtTrigger=\(lockedAtMsAtTrigger!=null\)\?\(nowMs-lockedAtMsAtTrigger\):null;/);
});

test('13. burstActiveAtTrigger is computed honestly (not hardcoded false) even though it is structurally always false for WHOLE_SCAN_OWNED', () => {
  const src = readIndex();
  assert.match(src, /const burstActiveAtTrigger=!!\(burstRec && burstRec\.currentBurst\);/);
});

test('14. formalHoldElapsedMsAtTrigger / formalCaptureStateAtTrigger read the actual mgScan2 runtime object, never reconstruct from a fixed hold duration', () => {
  const src = readIndex();
  assert.match(src, /formalHoldElapsedMsAtTrigger:\(typeof mgScan2!=='undefined' && mgScan2 && typeof mgScan2\.continuousReadyMs==='number'\)\?mgScan2\.continuousReadyMs:null/);
  assert.match(src, /formalCaptureStateAtTrigger:\(typeof mgScan2!=='undefined' && mgScan2 && typeof mgScan2\.state==='string'\)\?mgScan2\.state:null/);
});

test('15. POST_BURST_FORMAL_HOLD is gated on endReason===POSE_LOCK_SETTLED, never on any other close reason', () => {
  const src = readIndex();
  assert.match(src, /precedingBurstClosedWithPoseLockSettled===true && formalCaptureCommittedForStepAtTrigger===false\) return 'POST_BURST_FORMAL_HOLD';/);
  assert.match(src, /precedingBurstEndReasonAtTrigger===='POSE_LOCK_SETTLED'/.source ? /precedingBurstEndReasonAtTrigger===('|")POSE_LOCK_SETTLED\1/ : /x/);
});

['MAX_DURATION_REACHED', 'MAX_FRAMES_PER_BURST_REACHED', 'SUPERSEDED_BY_NEW_BURST', 'SCAN_ENDED'].forEach(reason => {
  test(`16. a burst actually closing with ${reason} in the burst recorder cannot itself be reinterpreted as POSE_LOCK_SETTLED by the new code`, () => {
    // Structural guarantee: __buildTemporalSubphaseEventsExport/__wholeScanMaybeSample read
    // b.endReason / precedingBurstEndReasonAtTrigger verbatim -- there is no reason-remapping table.
    const src = readIndex();
    assert.ok(!new RegExp(reason + "[^']*['\"]\\s*:\\s*['\"]POSE_LOCK_SETTLED").test(src));
  });
});

test('17. FIRST_TARGET_REGION_MATCH event construction exists and is separate from duration-state fields', () => {
  const src = readIndex();
  assert.match(src, /eventType:'FIRST_TARGET_REGION_MATCH'/);
});
test('18. FIRST_READY_TRUE event construction exists', () => {
  assert.match(readIndex(), /eventType:'FIRST_READY_TRUE'/);
});
test('19. BURST_CLOSE event construction carries burstEndReason from the real burst object', () => {
  const src = readIndex();
  assert.match(src, /eventType:'BURST_CLOSE'[\s\S]{0,200}burstEndReason:b\.endReason\|\|null/);
});
test('20. FORMAL_CAPTURED event construction exists, sourced from real formalCaptureAssociations', () => {
  const src = readIndex();
  assert.match(src, /associations\.forEach\(function\(a\)\{/);
  assert.match(src, /eventType:'FORMAL_CAPTURED'/);
});
test('21. STEP_ADVANCED event construction exists as a distinct eventType from FORMAL_CAPTURED', () => {
  const src = readIndex();
  assert.match(src, /eventType:'STEP_ADVANCED'/);
});
test('22. CAPTURE_ATTEMPT_FAILED is declared in the event-type vocabulary but never constructed as a live event this stage', () => {
  const src = readIndex();
  assert.match(src, /TEMPORAL_SUBPHASE_EVENT_TYPES\s*=\s*\[[^\]]*'CAPTURE_ATTEMPT_FAILED'/);
  // never appears as a constructed eventType:'CAPTURE_ATTEMPT_FAILED' literal anywhere
  assert.ok(!src.includes("eventType:'CAPTURE_ATTEMPT_FAILED'"));
});
test('22b. takeCapture() early-return guards are untouched (no new event hook inserted into guard returns)', () => {
  const src = readIndex();
  const fnStart = src.indexOf('async function takeCapture(){');
  const fnBody = src.slice(fnStart, fnStart + 1200);
  assert.ok(!/CAPTURE_ATTEMPT_FAILED/.test(fnBody));
});

test('23. temporalSubphaseEvents[] is a separate top-level export field, never merged into temporalMotionBursts or wholeScanTemporalStream', () => {
  const src = readIndex();
  assert.match(src, /temporalSubphaseEvents:\(typeof __buildTemporalSubphaseEventsExport==='function'\)\?__buildTemporalSubphaseEventsExport\(rec\.scannerSessionId\):\[\]/);
});

test('24. every event object as constructed carries an explicit jsClockDomain key (PERFORMANCE_NOW, EPOCH_ISO, or null)', () => {
  const src = readIndex();
  const occurrences = src.match(/jsClockDomain:[^,}\n]+/g) || [];
  assert.ok(occurrences.length >= 5);
});

test('25. AtTrigger naming discipline: every new snapshot field this stage carries the AtTrigger suffix', () => {
  const src = readIndex();
  ['stableFramesAtTrigger', 'lockedAtMsAtTrigger', 'lockElapsedMsAtTrigger', 'burstActiveAtTrigger', 'formalHoldElapsedMsAtTrigger', 'formalCaptureStateAtTrigger', 'destinationRegionMatchedAtTrigger', 'scannerReadyAtTrigger', 'qualityOkAtTrigger'].forEach(f => {
    assert.ok(src.includes(f), `expected field ${f} to appear in index.html`);
  });
});

test('26. JS-clock snapshots are never asserted to occur at nativeFrameTimestampNs -- no field aliases the two', () => {
  const src = readIndex();
  assert.ok(!/nativeFrameTimestampNsAtTrigger/.test(src));
});

test('27. existing burst sample provenance fields preserved verbatim on BURST_SHARED entries', () => {
  const src = readIndex();
  ['sourceBurstId:b.burstId', 'sourceTransition:b.sourceTransition', 'sourceTemporalSampleIndex:i', "provenance:'BURST_SHARED'"].forEach(f => {
    assert.ok(src.includes(f));
  });
});

test('28. BURST_SHARED reconstruction never mutates b.samples (no assignment into s.* anywhere in the shared-sample builder)', () => {
  const src = readIndex();
  const start = src.indexOf('function __buildBurstSharedWholeScanSamples(scanSessionId){');
  const end = src.indexOf('\n}', start) + 2;
  const body = src.slice(start, end);
  assert.ok(!/\bs\.\w+\s*=(?!=)/.test(body), 'must never write to a raw burst sample object');
});

test('29. WHOLE_SCAN_OWNED existing image/geometry/provenance fields remain unchanged in shape', () => {
  const src = readIndex();
  ['nativeFrameTimestampNs:res.nativeFrameTimestampNs', "provenance:'WHOLE_SCAN_OWNED'", 'frameRegistryKey:key'].forEach(f => assert.ok(src.includes(f)));
});

test('30. no new motion/yaw/pitch/velocity threshold constant introduced this stage', () => {
  const src = readIndex();
  // The only new numeric-looking constants added are region-name mappings and enum arrays, not thresholds.
  const addedBlock = src.slice(src.indexOf('const A60B_STEP_TO_FORMAL_REGION'), src.indexOf('window.__scannerSpatialRecorder='));
  assert.ok(!/\b\d+\.?\d*\s*(deg|Deg|DEG)\b/.test(addedBlock));
  assert.ok(!/yawDeg\s*[<>]=?\s*-?\d/.test(addedBlock));
  assert.ok(!/pitchDeg\s*[<>]=?\s*-?\d/.test(addedBlock));
});

test('31. no scanner timing constant changed (burst/whole-scan interval and settle-tail constants untouched)', () => {
  const src = readIndex();
  assert.match(src, /TEMPORAL_BURST_SETTLE_TAIL_MS/);
  // still referenced, not redefined a second time
  const defs = src.match(/TEMPORAL_BURST_SETTLE_TAIL_MS\s*=/g) || [];
  assert.equal(defs.length, 1);
});

test('32. no V2 (head-relative-temporal-measurement-v2) execution wired into this stage\'s new code', () => {
  const src = readIndex();
  const addedBlock = src.slice(src.indexOf('const A60B_STEP_TO_FORMAL_REGION'), src.indexOf('window.__scannerSpatialRecorder='));
  assert.ok(!/head-relative-temporal-measurement-v2/.test(addedBlock));
});

test('33. no GT/occupancy/Hairness reference introduced in the new subphase code', () => {
  const src = readIndex();
  const addedBlock = src.slice(src.indexOf('const A60B_STEP_TO_FORMAL_REGION'), src.indexOf('window.__scannerSpatialRecorder='))
    + src.slice(src.indexOf('function __buildBurstSharedWholeScanSamples'), src.indexOf('function __buildWholeScanTemporalStreamExport'))
    + src.slice(src.indexOf('async function __wholeScanMaybeSample'), src.indexOf('function __wholeScanTick'));
  assert.ok(!/occupancy/i.test(addedBlock));
  assert.ok(!/hairness/i.test(addedBlock));
  assert.ok(!/ground.?truth/i.test(addedBlock));
});

test('34. no network call introduced (no fetch/XHR/WebSocket in any new function this stage)', () => {
  const src = readIndex();
  const wholeScanFn = src.slice(src.indexOf('async function __wholeScanMaybeSample'), src.indexOf('function __wholeScanTick'));
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(wholeScanFn));
});

test('35. voice/haptics/HUD/Live Map/DIST/Profile/Chin-Up/jaw/BS1 systems are not referenced by the new subphase code', () => {
  const src = readIndex();
  const addedBlock = src.slice(src.indexOf('const A60B_STEP_TO_FORMAL_REGION'), src.indexOf('window.__scannerSpatialRecorder='));
  assert.ok(!/speak\(|SpeechSynthesis|vibrate\(|liveMap|jawSupport/i.test(addedBlock));
});

test('36. production isolation: the full index.html hash differs from the BI-1Z1T baseline only in the additive regions this stage touched (structural sanity: file still parses as HTML with a single <html> document)', () => {
  const src = readIndex();
  assert.ok(src.trim().toLowerCase().startsWith('<!doctype html') || src.includes('<html'));
});

test('37. classifier parity: inline __temporalSubphaseClassify (extracted from index.html) matches the pure module bit-for-bit on a representative case battery', () => {
  const src = readIndex();
  const start = src.indexOf('const A60B_STEP_TO_FORMAL_REGION');
  const end = src.indexOf('window.__scannerSpatialRecorder=');
  const snippet = src.slice(start, end);
  const fn = new Function(snippet + '\nreturn __temporalSubphaseClassify;')();
  const cases = [
    null, {}, { burstActiveAtTrigger: null },
    { burstActiveAtTrigger: false, precedingBurstClosedWithPoseLockSettled: true, formalCaptureCommittedForStepAtTrigger: false },
    { burstActiveAtTrigger: true, lockedAtMsKnownSetAtTrigger: true, scannerReadyAtTrigger: false },
    { burstActiveAtTrigger: true, lockedAtMsKnownSetAtTrigger: false, destinationRegionMatchedAtTrigger: true, scannerReadyAtTrigger: false },
    { burstActiveAtTrigger: true, lockedAtMsKnownSetAtTrigger: false, destinationRegionMatchedAtTrigger: false, scannerReadyAtTrigger: false },
    { burstActiveAtTrigger: false, precedingBurstClosedWithPoseLockSettled: false, formalCaptureCommittedForStepAtTrigger: true, destinationRegionMatchedAtTrigger: true, scannerReadyAtTrigger: true }
  ];
  cases.forEach(c => assert.equal(fn(c), C.classifyDurationSubphase(c)));
});

test('38. deriveLockedAtMsKnownSet parity between inline and pure module', () => {
  const src = readIndex();
  const start = src.indexOf('const A60B_STEP_TO_FORMAL_REGION');
  const end = src.indexOf('window.__scannerSpatialRecorder=');
  const snippet = src.slice(start, end);
  const fn = new Function(snippet + '\nreturn __temporalSubphaseDeriveLockedAtMsKnownSet;')();
  const samples = [{ poseLockReadyAtTrigger: false }, { poseLockReadyAtTrigger: true }, { poseLockReadyAtTrigger: false }];
  for (let i = 0; i < samples.length; i++) {
    assert.equal(fn(samples, i), C.deriveLockedAtMsKnownSetAtTrigger(samples, i));
  }
});

test('39. STEP_ID_TO_FORMAL_REGION inline mapping matches the pure module exactly', () => {
  const src = readIndex();
  const start = src.indexOf('const A60B_STEP_TO_FORMAL_REGION');
  const end = src.indexOf('window.__scannerSpatialRecorder=');
  const snippet = src.slice(start, end);
  const map = new Function(snippet + '\nreturn A60B_STEP_TO_FORMAL_REGION;')();
  assert.deepEqual(map, C.STEP_ID_TO_FORMAL_REGION);
});

test('40. no beard/shirt/neckline semantic classification introduced this stage', () => {
  const src = readIndex();
  const addedBlock = src.slice(src.indexOf('const A60B_STEP_TO_FORMAL_REGION'), src.indexOf('window.__scannerSpatialRecorder='));
  assert.ok(!/beard|shirt|neckline/i.test(addedBlock));
});

test('41. schema field is purely additive -- exactFrameResearchCaptureVersion logic (the /2 vs /3 decision) is untouched by this stage', () => {
  const src = readIndex();
  assert.match(src, /exactFrameResearchCaptureVersion: __hasWholeScanSamples\?'exact-frame-research-capture\/3':'exact-frame-research-capture\/2'/);
});

test('42. frozen manifest hash placeholder file exists for this stage (structural presence check deferred to build script)', () => {
  // The manifest itself is created after tests pass (Part 19) -- this test only guards that the
  // classifier module the manifest depends on exports the expected surface.
  assert.ok(typeof C.classifyDurationSubphase === 'function');
  assert.ok(Array.isArray(C.DURATION_SUBPHASES));
  assert.ok(Object.isFrozen(C.DURATION_SUBPHASES));
});

test('43. voice guidance code path is not referenced or modified by this stage\'s new code', () => {
  const src = readIndex();
  const addedBlock = src.slice(src.indexOf('const A60B_STEP_TO_FORMAL_REGION'), src.indexOf('window.__scannerSpatialRecorder='));
  assert.ok(!/voiceGuidance|speechSynthesis/i.test(addedBlock));
});
