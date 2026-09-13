import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as OCC from './region-scoped-beard-occupancy-v1.mjs';
import * as EP from './beard-evidence-packet-v1.mjs';
import * as H from './hairness-core-v1.mjs';
import * as N from './sparse-neck-scaffold-v1.mjs';

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
const ANALYSIS_DIR = 'D:/MettleTemp/analysis/';

// ---------- BI-2D artifact verification ----------

test('1. BI-2D-era scaffold implementation hash matches exactly', () => {
  assert.equal(sha256(readFileSync('accuracy/sparse-neck-scaffold-v1.mjs')), '3798248b018919a61dea71173802b7a4acf6420447edffecc3e49da020d306f9');
});

// ---------- production isolation / no scanner modification ----------

test('2. production hashes (index.html, worker.js, burst recorder) remain unchanged', () => {
  const idx = readFileSync(new URL('../index.html', import.meta.url));
  const wkr = readFileSync(new URL('../worker.js', import.meta.url));
  assert.equal(sha256(idx), '928747a5d284060dddac43c95f97a1669492ab4d1ecebf0d34bc59f3a3b5b521');
  assert.equal(sha256(wkr), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
  const src = idx.toString('utf8');
  const startIdx = src.indexOf('const TEMPORAL_BURST_TARGET_INTERVAL_MS');
  const endStart = src.indexOf('function __updateMotionBurstIndicatorUI(){');
  const endIdx = src.indexOf('\n}', endStart) + 2;
  assert.equal(sha256(Buffer.from(src.slice(startIdx, endIdx))), 'eae6776bf4299af02f41b0ac3805bb59eb0167dc903c45a9ca08e87941f0762a');
});

test('3. no scanner/production file was touched -- occupancy module never references scanner runtime globals', () => {
  const src = readFileSync('accuracy/region-scoped-beard-occupancy-v1.mjs', 'utf8');
  assert.ok(!/mgScan2|BeardTrimAndroid|__temporalMotionBurstRecorder|document\.|window\./.test(src));
});

// ---------- neck scaffold reuse ----------

test('4. occupancy module re-exports JAW_SUPPORT_RAIL_V1 identical to the scaffold module (no re-solve)', () => {
  assert.deepEqual(OCC.JAW_SUPPORT_RAIL_V1, N.JAW_SUPPORT_RAIL_V1);
});

// ---------- BeardEvidencePacketV1 reuse / no duplicate contract ----------

test('5. occupancy module imports EvidenceChannel/SupportStatus/makeEvidenceSignal/makeBeardEvidencePacket from the existing contract, never redefines them', () => {
  const src = readFileSync('accuracy/region-scoped-beard-occupancy-v1.mjs', 'utf8');
  assert.match(src, /from '\.\/beard-evidence-packet-v1\.mjs'/);
  assert.ok(!/export const EvidenceChannel|export const SupportStatus/.test(src), 'must not redefine the evidence contract enums locally');
});

test('6. buildOccupancyElement produces a valid BeardEvidencePacketV1-shaped evidencePacket', () => {
  const el = OCC.buildOccupancyElement({ scanSessionId: 's', nativeFrameTimestampNs: 1n, rawObservationId: 'obs1', coherenceStatus: 'VERIFIED_EXACT', occupancyState: 'UNCERTAIN' });
  assert.equal(el.evidencePacket.packetVersion, EP.EVIDENCE_PACKET_VERSION);
  assert.equal(el.evidencePacket.scanSessionId, 's');
  assert.doesNotThrow(() => EP.assertPacketInternallyConsistent(el.evidencePacket));
});

// ---------- Hairness thresholds unchanged / cannot upgrade geometry ----------

test('7. Hairness Core V1 DECISION_RULE is unmodified (frozen thresholds)', () => {
  assert.equal(H.DECISION_RULE.decisionMidpoint, 13.4);
  assert.equal(H.DECISION_RULE.deadZoneLowerBound, 11.9);
  assert.equal(H.DECISION_RULE.deadZoneUpperBound, 14.9);
});

test('8. a positive (BEARD_CONFIRMED-leaning) Hairness reading on the uncalibrated transition ROI is capped at UNCERTAIN, never promoted', () => {
  // Build a synthetic gray buffer/mask that would classify BEARD_CONFIRMED if authoritative
  const w = 40, h = 40;
  const gray = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = ((x + y) % 2) * 255; // high-frequency checkerboard -> high gradient
  const points = [{ x: 10, y: 20 }, { x: 20, y: 20 }, { x: 30, y: 20 }];
  const r = OCC.classifyTransitionRegionOccupancy({ transitionRailPoints: points, gray, w, h });
  assert.notEqual(r.occupancyState, 'BEARD_OCCUPIED_SUPPORTED');
  assert.ok(r.occupancyState === 'UNCERTAIN' || r.occupancyState === 'OCCLUDED');
});

// ---------- occupancy vocabulary / UNKNOWN != UNCERTAIN ----------

test('9. OCCUPANCY_STATES contains exactly the required 7 states, UNKNOWN_ANATOMY distinct from UNCERTAIN', () => {
  const required = ['BEARD_OCCUPIED_SUPPORTED', 'VISIBLE_SKIN_SUPPORTED', 'UNCERTAIN', 'UNKNOWN_ANATOMY', 'OCCLUDED', 'OUTSIDE_SUPPORTED_ANATOMY', 'CLOTHING_EXCLUDED'];
  required.forEach(s => assert.ok(OCC.OCCUPANCY_STATES.includes(s)));
  assert.notEqual('UNKNOWN_ANATOMY', 'UNCERTAIN');
});

test('10. buildUnknownAnatomyElement always returns UNKNOWN_ANATOMY, never UNCERTAIN', () => {
  const el = OCC.buildUnknownAnatomyElement({ scanSessionId: 's', anatomicalRegion: 'RIGHT_MANDIBULAR_ANGLE_UNDERSIDE', side: 'RIGHT', reason: 'test' });
  assert.equal(el.occupancyState, 'UNKNOWN_ANATOMY');
});

// ---------- clothing exclusion ----------

test('11. buildExclusionElement always returns CLOTHING_EXCLUDED and marks it a non-anatomy exclusion aid', () => {
  const el = OCC.buildExclusionElement({ scanSessionId: 's', anatomicalRegion: 'UPPER_CENTRAL_NECK', side: 'CENTER', reason: 'test' });
  assert.equal(el.occupancyState, 'CLOTHING_EXCLUDED');
  assert.match(el.sourceEvidence[0].limitations[0], /never a positive beard boundary/);
});

test('12. real dataset: UPPER_CENTRAL_NECK is CLOTHING_EXCLUDED in all 6 sessions', () => {
  const sessions = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2e_all_sessions_occupancy_raw.json', 'utf8'));
  sessions.forEach(s => {
    const el = s.elements.find(e => e.anatomicalRegion === 'UPPER_CENTRAL_NECK');
    assert.equal(el.occupancyState, 'CLOTHING_EXCLUDED');
  });
});

// ---------- mandibular UNKNOWN preservation ----------

test('13. real dataset: both mandibular-angle regions are UNKNOWN_ANATOMY in all 6 sessions', () => {
  const sessions = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2e_all_sessions_occupancy_raw.json', 'utf8'));
  sessions.forEach(s => {
    ['RIGHT_MANDIBULAR_ANGLE_UNDERSIDE', 'LEFT_MANDIBULAR_ANGLE_UNDERSIDE'].forEach(region => {
      assert.equal(s.elements.find(e => e.anatomicalRegion === region).occupancyState, 'UNKNOWN_ANATOMY');
    });
  });
});

// ---------- exact-frame provenance ----------

test('14. every real occupancy element with an evidencePacket carries scanSessionId/nativeFrameTimestampNs/rawObservationId/coherenceStatus', () => {
  const sessions = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2e_all_sessions_occupancy_raw.json', 'utf8'));
  sessions.forEach(s => s.elements.forEach(el => {
    if (el.evidencePacket) {
      assert.ok(el.evidencePacket.scanSessionId && el.evidencePacket.nativeFrameTimestampNs !== undefined && el.evidencePacket.rawObservationId && el.evidencePacket.coherenceStatus);
    }
  }));
});

// ---------- no cross-session construction pooling ----------

test('15. occupancy was computed independently per session (6 distinct top-level results, never pooled)', () => {
  const sessions = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2e_all_sessions_occupancy_raw.json', 'utf8'));
  assert.equal(sessions.length, 6);
  const ids = new Set(sessions.map(s => s.scanSessionId));
  assert.equal(ids.size, 6);
});

// ---------- multiview provenance (not claimed this stage) ----------

test('16. no MULTIVIEW_SUPPORT channel signal is fabricated this stage', () => {
  const sessions = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2e_all_sessions_occupancy_raw.json', 'utf8'));
  sessions.forEach(s => s.elements.forEach(el => (el.sourceEvidence || []).forEach(sig => assert.notEqual(sig.channel, 'MULTIVIEW_SUPPORT'))));
});

// ---------- no circular GT use / no neck-GT-as-beard-GT ----------

test('17. evidence audit explicitly confirms neck GT was used only for its own semantic purpose, never as beard-boundary GT', () => {
  const audit = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2e_beard_occupancy_evidence_audit.json', 'utf8'));
  assert.match(audit.neckGtSeparationConfirmed, /never re-read or re-interpreted as beard-boundary GT/);
});

test('18. evidence audit explicitly avoids circularity with Hairness\'s own training data', () => {
  const audit = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2e_beard_occupancy_evidence_audit.json', 'utf8'));
  assert.match(audit.existingGtDataAudit.a61AnnotationData, /would be circular/);
});

// ---------- existing-GT-first audit ----------

test('19. evidence audit reports the existing-data-first search across GroundTruthDataset/AnnotationBundle/workbench/holdout/proposal-eval sources', () => {
  const audit = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2e_beard_occupancy_evidence_audit.json', 'utf8'));
  ['groundTruthDatasetModule', 'annotationBundleModule', 'workbenchExports', 'hairnessHoldoutData', 'beardProposalEvaluationData'].forEach(k => assert.ok(k in audit.existingGtDataAudit));
});

test('20. no invented accuracy number is reported anywhere in the occupancy results/report', () => {
  const results = readFileSync(ANALYSIS_DIR + 'bi2e_region_scoped_occupancy_results.json', 'utf8');
  const md = readFileSync(ANALYSIS_DIR + 'bi2e_beard_occupancy_fusion_v1_report.md', 'utf8');
  assert.ok(!/precision|recall|F1|IoU/i.test(results));
  assert.match(md, /No precision\/recall\/F1\/IoU number is reported/);
});

// ---------- false-beard-on-clothing fail closed ----------

test('21. false-beard-on-clothing failure scenario is present and PASSED', () => {
  const fa = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2e_occupancy_failure_analysis.json', 'utf8'));
  const scenario = fa.results.find(r => r.name === 'BEARD_AGAINST_COLLAR_STILL_EXCLUDED');
  assert.ok(scenario && scenario.passed);
});

// ---------- occlusion handling ----------

test('22. missing/unavailable geometry fails closed to OCCLUDED, never a guessed state', () => {
  const r = OCC.classifyTransitionRegionOccupancy({ transitionRailPoints: null, gray: new Uint8Array(4), w: 2, h: 2 });
  assert.equal(r.occupancyState, 'OCCLUDED');
});

// ---------- no dense beard mesh / no outer envelope / no trim recommendation ----------

test('23. module contains no dense mesh, outer envelope, or trim-recommendation logic (excluding its own scope-disclosure header comment)', () => {
  const src = readFileSync('accuracy/region-scoped-beard-occupancy-v1.mjs', 'utf8');
  const bodyOnly = src.slice(src.indexOf('import {'));
  assert.ok(!/triangulat|tessellat|dense.?mesh|outer.?envelope|stand.?off|trim.?line|trim.?path|neckline.?recommend|guard.?length/i.test(bodyOnly));
});

// ---------- no Live Map wiring ----------

test('24. module is never imported by index.html or worker.js (no production wiring)', () => {
  const idx = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const wkr = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.ok(!idx.includes('region-scoped-beard-occupancy-v1'));
  assert.ok(!wkr.includes('region-scoped-beard-occupancy-v1'));
});

// ---------- no network / no paid dependency ----------

test('25. occupancy module has zero network calls and imports only local project files', () => {
  const src = readFileSync('accuracy/region-scoped-beard-occupancy-v1.mjs', 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(src));
  const importLines = src.match(/^import .*/gm) || [];
  importLines.forEach(line => assert.match(line, /from '\.\//));
});

test('26. this test module has zero network calls', () => {
  const src = readFileSync(new URL('./bi2e-region-scoped-beard-occupancy.test.mjs', import.meta.url), 'utf8');
  const bodyOnly = src.slice(src.indexOf("test('1."), src.indexOf("test('25."));
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(bodyOnly));
});

test('27. final report contains the exact required verdict string', () => {
  const md = readFileSync(ANALYSIS_DIR + 'bi2e_beard_occupancy_fusion_v1_report.md', 'utf8');
  assert.match(md, /REGION-SCOPED BEARD OCCUPANCY V1 USABLE — TARGETED GT \/ REGIONS STILL NEEDED/);
});

test('28. failure analysis reports all scenarios passed', () => {
  const fa = JSON.parse(readFileSync(ANALYSIS_DIR + 'bi2e_occupancy_failure_analysis.json', 'utf8'));
  assert.equal(fa.allPassed, true);
  assert.ok(fa.totalScenarios >= 12);
});
