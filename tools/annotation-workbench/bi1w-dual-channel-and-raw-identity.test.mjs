// Stage BI-1W — dual-channel Surface Observability + raw-observation identity.
// Node built-in runner (node --test). Zero dependencies. Synthetic fixtures only (SAME fixture
// file as BS1-H's own tests — no real user imagery is used here).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import AWB from './annotation-workbench.cjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'synthetic-bundle.json'), 'utf8'));
const bundle = () => JSON.parse(JSON.stringify(FIXTURE));

function rawEntry(overrides) {
  return Object.assign({
    schemaVersion: 'annotation-bundle/1',
    identityMode: 'RAW_SCAN_OBSERVATION',
    sourceScanObservationId: null,
    scanSessionId: 'synthetic-session-raw',
    nativeFrameTimestampNs: 9999,
    rawObservationId: 3,
    adapterRetained: false,
    imageRef: 'synthetic-raw:img:3:ts9999',
    poseId: 'chin-up',
    observedPoseRegion: 'CHINUP_REGION',
    currentScannerStep: 'front',
    yawDeg: 0.8, pitchDeg: -39.2, rollDeg: 5.2,
    regionsToAnnotate: ['UNDER_CHIN', 'UNDER_JAW_LEFT', 'UNDER_JAW_RIGHT'],
    rawImagePayload: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwAEhgGAWjR9awAAAABJRU5ErkJggg==',
    rawImageFormat: 'data-url', rawImageStorageScope: 'LOCAL_ANNOTATION_BUNDLE',
    bundleImageStatus: 'INCLUDED_FOR_ANNOTATION', outcome: 'RESOLVED'
  }, overrides || {});
}
function bundleWithRaw(entryOverrides) {
  const b = bundle();
  b.entries = [rawEntry(entryOverrides)];
  return b;
}

// 1 — historical hair-only bundles still load.
test('1: a historical (hair-only) bundle still loads and validates exactly as before', () => {
  const v = AWB.validateBundle(bundle());
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

// 2 — dual-channel bundle loads.
test('2: a bundle requesting the three promoted dual-channel regions loads', () => {
  const b = bundle();
  b.entries[0].regionsToAnnotate = ['UNDER_CHIN', 'UNDER_JAW_LEFT', 'UNDER_JAW_RIGHT'];
  const v = AWB.validateBundle(b);
  assert.equal(v.ok, true);
});

// 3 — Hair Semantics and Surface Observability remain independent (no auto-derivation either way).
test('3: hairState and surfaceObservability are set and read independently, with no auto-derivation', () => {
  const b = bundle();
  b.entries[0].regionsToAnnotate = ['UNDER_CHIN'];
  const id = b.entries[0].sourceScanObservationId;
  let st = AWB.initAnnotationState(b);
  // BEARD_CONFIRMED + BEARD_OCCLUDED_SKIN: hair visibly present, underlying skin not observable.
  st = AWB.setRegionLabel(st, id, 'UNDER_CHIN', { hairState: 'BEARD_CONFIRMED', surfaceObservability: 'BEARD_OCCLUDED_SKIN', annotationStatus: 'LABELED' });
  assert.equal(st.byEntry[id].UNDER_CHIN.hairState, 'BEARD_CONFIRMED');
  assert.equal(st.byEntry[id].UNDER_CHIN.surfaceObservability, 'BEARD_OCCLUDED_SKIN');
  // Sparse beard + visible skin is also a legitimate, independently-set combination.
  st = AWB.setRegionLabel(st, id, 'UNDER_CHIN', { hairState: 'BEARD_CONFIRMED', surfaceObservability: 'VISIBLE_SKIN' });
  assert.equal(st.byEntry[id].UNDER_CHIN.hairState, 'BEARD_CONFIRMED');
  assert.equal(st.byEntry[id].UNDER_CHIN.surfaceObservability, 'VISIBLE_SKIN');
  // Setting one channel never silently changes the other.
  st = AWB.setRegionLabel(st, id, 'UNDER_CHIN', { hairState: 'NON_BEARD_CONFIRMED' });
  assert.equal(st.byEntry[id].UNDER_CHIN.surfaceObservability, 'VISIBLE_SKIN', 'changing hairState must not rewrite surfaceObservability');
});

// 4 — UNKNOWN is explicit, not null; untouched stays null (BI-1W Part 4).
test('4: surfaceObservability is null until explicitly set, and an explicit UNKNOWN is distinct from untouched', () => {
  const b = bundle();
  b.entries[0].regionsToAnnotate = ['UNDER_CHIN'];
  const id = b.entries[0].sourceScanObservationId;
  let st = AWB.initAnnotationState(b);
  assert.equal(st.byEntry[id].UNDER_CHIN.surfaceObservability, null, 'untouched region must be null, not the string UNKNOWN');
  assert.equal(AWB.isEntryComplete(st.byEntry[id], ['UNDER_CHIN']), false);
  st = AWB.setRegionLabel(st, id, 'UNDER_CHIN', { hairState: 'UNKNOWN', surfaceObservability: 'UNKNOWN', annotationStatus: 'NEEDS_REVIEW' });
  assert.equal(st.byEntry[id].UNDER_CHIN.surfaceObservability, 'UNKNOWN', 'an explicit human choice of Unknown must be the string, never null');
  assert.equal(AWB.isEntryComplete(st.byEntry[id], ['UNDER_CHIN']), true, 'explicit UNKNOWN on both channels counts as complete');
});

// 5 — adapter-retained identity still works (unchanged historical path).
test('5: an ADAPTER_RETAINED_OBSERVATION entry (identityMode absent) behaves exactly as before', () => {
  const b = bundle();
  const e = b.entries[0];
  assert.equal(AWB.identityModeOf(e), 'ADAPTER_RETAINED_OBSERVATION');
  assert.equal(AWB.entryKey(e), e.sourceScanObservationId);
  const st = AWB.initAnnotationState(b);
  assert.ok(st.byEntry[e.sourceScanObservationId]);
});

// 6 — raw observation identity works.
test('6: a RAW_SCAN_OBSERVATION entry validates and keys correctly with sourceScanObservationId null', () => {
  const b = bundleWithRaw();
  const v = AWB.validateBundle(b);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const e = b.entries[0];
  assert.equal(AWB.identityModeOf(e), 'RAW_SCAN_OBSERVATION');
  const key = AWB.entryKey(e);
  assert.equal(key, 'raw:synthetic-session-raw:9999:3');
  const st = AWB.initAnnotationState(b);
  assert.ok(st.byEntry[key]);
});

// 7 — currentScannerStep:"front" + observedPoseRegion:CHINUP_REGION is accepted, not rejected.
test('7: currentScannerStep and observedPoseRegion may legitimately disagree; the entry is still valid', () => {
  const b = bundleWithRaw({ currentScannerStep: 'front', observedPoseRegion: 'CHINUP_REGION' });
  const v = AWB.validateBundle(b);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(b.entries[0].currentScannerStep, 'front');
  assert.equal(b.entries[0].observedPoseRegion, 'CHINUP_REGION');
});

// 8 — sourceScanObservationId remains null when it does not truthfully exist, and is never
// silently populated with a synthesized "retained" value.
test('8: sourceScanObservationId stays null for a RAW_SCAN_OBSERVATION entry through export', () => {
  const b = bundleWithRaw();
  const st = AWB.initAnnotationState(b);
  const exp = AWB.buildExport(b, st);
  assert.equal(exp.labels.length, 3);
  for (const l of exp.labels) {
    assert.equal(l.sourceScanObservationId, null);
    assert.equal(l.identityMode, 'RAW_SCAN_OBSERVATION');
    assert.equal(l.rawObservationId, 3);
    assert.equal(l.adapterRetained, false);
  }
  // A RAW entry claiming a non-null sourceScanObservationId is rejected outright (Part 8).
  const bad = bundleWithRaw({ sourceScanObservationId: 'a60b:chin-up:img:3' });
  assert.equal(AWB.validateBundle(bad).ok, false);
});

// 9 — composite raw identity round-trips through export and validateExport.
test('9: composite raw identity (scanSessionId + nativeFrameTimestampNs + rawObservationId) round-trips', () => {
  const b = bundleWithRaw();
  const st0 = AWB.initAnnotationState(b);
  const key = AWB.entryKey(b.entries[0]);
  const st = AWB.setRegionLabel(st0, key, 'UNDER_CHIN', { hairState: 'BEARD_CONFIRMED', surfaceObservability: 'BEARD_OCCLUDED_SKIN', annotationStatus: 'LABELED' });
  const exp = AWB.buildExport(b, st);
  const vexp = AWB.validateExport(exp, b);
  assert.equal(vexp.ok, true, JSON.stringify(vexp.errors));
  const underChin = exp.labels.find(l => l.anatomicalRegion === 'UNDER_CHIN');
  assert.equal(underChin.scanSessionId, 'synthetic-session-raw');
  assert.equal(underChin.nativeFrameTimestampNs, 9999);
  assert.equal(underChin.rawObservationId, 3);
  assert.equal(underChin.hairState, 'BEARD_CONFIRMED');
  assert.equal(underChin.surfaceObservability, 'BEARD_OCCLUDED_SKIN');
});

// 10a/b/c — CORRECTION: each canonical region is individually confirmed dual-channel, using
// the pre-existing project keys (accuracy/beard-surface-core.mjs's AnatomicalRegion enum,
// accuracy/beard-anatomy-map.mjs's MAPPING_EVIDENCE — neither ever defined LEFT_UNDER_JAW /
// RIGHT_UNDER_JAW), never the short-lived duplicate names.
for (const region of ['UNDER_CHIN', 'UNDER_JAW_LEFT', 'UNDER_JAW_RIGHT']) {
  test('10.' + region + ': is dual-channel, labelable-with-caution, plain-language, no geometry claim', () => {
    const lab = AWB.regionLabelability(region);
    assert.equal(lab.tier, 'LABELABLE_WITH_CAUTION');
    assert.equal(typeof lab.semanticDescription, 'string');
    assert.ok(lab.semanticDescription.length > 0);
    assert.doesNotMatch(lab.semanticDescription, /menton|gnathion|pogonion/i, 'no medical landmark terms shown to the annotator');
    assert.deepEqual(AWB.regionAllowedHairStates(region), ['BEARD_CONFIRMED', 'NON_BEARD_CONFIRMED', 'UNKNOWN']);
    assert.deepEqual(AWB.regionAllowedSurfaceStates(region), AWB.SURFACE_OBSERVABILITY_STATES);
    assert.equal(AWB.regionRequiresSurfaceObservability(region), true);
    assert.equal(AWB.regionVisualReference(region).tier, 'UNSUPPORTED', 'no geometry landmark exists — only labelability changed');
    assert.ok(AWB.DUAL_CHANNEL_REGIONS.includes(region));
  });
}

// 10d/e — LEFT_UNDER_JAW / RIGHT_UNDER_JAW are NOT separate semantic regions: an unrecognized
// name fails closed to the same UNSUPPORTED/UNKNOWN_ONLY default as any other unknown string,
// exactly like a typo would — never a second, parallel definition of under-jaw territory.
test('10d: LEFT_UNDER_JAW is not a separate new semantic region (fails closed like any unrecognized name)', () => {
  assert.equal(AWB.regionLabelability('LEFT_UNDER_JAW').tier, 'UNKNOWN_ONLY');
  assert.equal(AWB.regionLabelability('LEFT_UNDER_JAW').semanticDescription, null);
  assert.equal(AWB.regionVisualReference('LEFT_UNDER_JAW').tier, 'UNSUPPORTED');
  assert.equal(AWB.regionVisualReference('LEFT_UNDER_JAW').note, 'region not recognized');
  assert.equal(AWB.DUAL_CHANNEL_REGIONS.includes('LEFT_UNDER_JAW'), false);
  assert.deepEqual(AWB.regionAllowedSurfaceStates('LEFT_UNDER_JAW'), ['UNKNOWN']);
});
test('10e: RIGHT_UNDER_JAW is not a separate new semantic region (fails closed like any unrecognized name)', () => {
  assert.equal(AWB.regionLabelability('RIGHT_UNDER_JAW').tier, 'UNKNOWN_ONLY');
  assert.equal(AWB.regionVisualReference('RIGHT_UNDER_JAW').tier, 'UNSUPPORTED');
  assert.equal(AWB.regionVisualReference('RIGHT_UNDER_JAW').note, 'region not recognized');
  assert.equal(AWB.DUAL_CHANNEL_REGIONS.includes('RIGHT_UNDER_JAW'), false);
});

// 10f — the pre-existing UNDER_JAW_CENTER (a genuinely distinct canonical key, not left/right)
// and NECK_FRONT/LEFT/RIGHT are untouched, still UNKNOWN_ONLY. CHIN_NECK_TRANSITION was
// deliberately promoted in BI-2F1 (real, non-beard-model evidence: BI-2C's
// CHIN_NECK_TRANSITION_RAIL personalized geometric estimate) -- see bi2f1-categorical-blind-lock
// test file for the dedicated coverage of that promotion.
test('10f: UNDER_JAW_CENTER and NECK_FRONT/LEFT/RIGHT remain unsupported and untouched', () => {
  for (const region of ['UNDER_JAW_CENTER', 'NECK_FRONT', 'NECK_LEFT', 'NECK_RIGHT']) {
    assert.equal(AWB.regionLabelability(region).tier, 'UNKNOWN_ONLY', region + ' must remain unsupported');
  }
});
test('10g: CHIN_NECK_TRANSITION is now LABELABLE_WITH_CAUTION (BI-2F1 promotion), never the stronger LABELABLE_FROM_IMAGE', () => {
  assert.equal(AWB.regionLabelability('CHIN_NECK_TRANSITION').tier, 'LABELABLE_WITH_CAUTION');
  assert.ok(AWB.regionLabelability('CHIN_NECK_TRANSITION').semanticDescription);
});

// 11 — holdout is absent from the real BI-1W development bundle, cross-checked against the
// real sealed holdout manifest (structural/identity check only, never pixel content).
test('11: the real BI-1W development bundle excludes both sealed espu2w holdout observations', () => {
  const bundlePath = 'D:/MettleTemp/annotation/bi1w_submental_dev_bundle.json';
  const holdoutPath = 'D:/MettleTemp/annotation/bi1w_sealed_holdout_manifest.json';
  let devBundle, holdout;
  try { devBundle = JSON.parse(readFileSync(bundlePath, 'utf8')); holdout = JSON.parse(readFileSync(holdoutPath, 'utf8')); }
  catch { return; } // stage-external artifacts; skip if not present in this checkout
  const sealedKeys = new Set((holdout.entries || []).map(e => e.scanSessionId + ':' + e.nativeFrameTimestampNs + ':' + e.rawObservationId));
  assert.ok(sealedKeys.size >= 2, 'sealed holdout manifest must actually list the espu2w observations');
  for (const e of devBundle.entries || []) {
    const key = e.scanSessionId + ':' + e.nativeFrameTimestampNs + ':' + e.rawObservationId;
    assert.equal(sealedKeys.has(key), false, 'a sealed holdout observation must never appear in the development bundle');
    assert.notEqual(e.scanSessionId, 'scan_mtdogmlr_espu2w', 'espu2w is sealed in full for this stage');
  }
});

// 13 — the rebuilt development bundle uses ONLY the canonical submental keys, and the expected
// region-instance / individual-decision counts are exactly what the correction specifies.
test('13: development bundle uses canonical keys only, with the exact expected counts', () => {
  const path = 'D:/MettleTemp/annotation/bi1w_submental_dev_bundle.json';
  let devBundle;
  try { devBundle = JSON.parse(readFileSync(path, 'utf8')); } catch { return; }
  const expectedRegions = ['UNDER_CHIN', 'UNDER_JAW_LEFT', 'UNDER_JAW_RIGHT', 'CHIN_CENTER', 'SOUL_PATCH'];
  assert.equal(devBundle.entries.length, 5, 'expects exactly 5 development images');
  let regionInstances = 0, dualChannelInstances = 0, singleChannelInstances = 0;
  for (const e of devBundle.entries) {
    assert.deepEqual([...e.regionsToAnnotate].sort(), [...expectedRegions].sort());
    for (const r of e.regionsToAnnotate) {
      assert.equal(r.includes('LEFT_UNDER_JAW') || r.includes('RIGHT_UNDER_JAW'), false, 'no duplicate-key region names in the real bundle');
      regionInstances++;
      if (AWB.regionRequiresSurfaceObservability(r)) dualChannelInstances++; else singleChannelInstances++;
    }
  }
  assert.equal(regionInstances, 25);
  assert.equal(dualChannelInstances, 15);
  assert.equal(singleChannelInstances, 10);
  assert.equal(dualChannelInstances * 2 + singleChannelInstances * 1, 40, 'expected individual decisions');
});

// 12 — no contour requirement is introduced (BI-1W Part 18).
test('12: no contour/geometry annotation field or requirement exists on region labels', () => {
  const b = bundle();
  b.entries[0].regionsToAnnotate = ['UNDER_CHIN'];
  const id = b.entries[0].sourceScanObservationId;
  let st = AWB.initAnnotationState(b);
  st = AWB.setRegionLabel(st, id, 'UNDER_CHIN', { hairState: 'BEARD_CONFIRMED', surfaceObservability: 'VISIBLE_SKIN', annotationStatus: 'LABELED' });
  const exp = AWB.buildExport(b, st);
  const json = JSON.stringify(exp);
  for (const bad of ['contour', 'polygon', 'vertices', 'spline', 'path2d']) {
    assert.equal(json.toLowerCase().includes(bad), false, 'export must not contain ' + bad);
  }
});

// bonus — the composite-identity uniqueness guard actually fires on a real collision.
test('bonus: duplicate identity keys within a bundle are rejected', () => {
  const b = bundleWithRaw();
  b.entries.push(rawEntry()); // exact same scanSessionId/nativeFrameTimestampNs/rawObservationId
  const v = AWB.validateBundle(b);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /duplicate identity key/.test(e)));
});

// bonus — the advisory helper flags one clearly-impossible combination without throwing or
// rewriting either channel.
test('bonus: regionLabelAdvisory flags an impossible combination without mutating anything', () => {
  assert.match(AWB.regionLabelAdvisory('NON_BEARD_CONFIRMED', 'BEARD_OCCLUDED_SKIN'), /cannot simultaneously/);
  assert.equal(AWB.regionLabelAdvisory('BEARD_CONFIRMED', 'BEARD_OCCLUDED_SKIN'), null);
  assert.equal(AWB.regionLabelAdvisory('BEARD_CONFIRMED', 'VISIBLE_SKIN'), null, 'sparse beard with visible skin is legitimate, never flagged');
});
