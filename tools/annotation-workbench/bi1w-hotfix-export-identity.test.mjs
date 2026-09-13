// Stage BI-1W HOTFIX — raw-observation export identity null-timestamp regression tests.
// Root cause: nativeFrameTimestampNs is a real raw-export identity field serialized as a numeric
// STRING (same bug class previously fixed in accuracy/a6-scan-package-adapter.mjs for the
// adapter-retained path); buildExport/validateExport's old isFiniteNum(v) gate required
// typeof v === 'number', silently nulling a truthfully-present string timestamp and producing
// "raw:<session>:null:<rawObservationId>" — an unresolvable export key.
// Node built-in runner (node --test). Zero dependencies. Synthetic fixtures only, plus one
// structural check against the real (unmodified) BI-1W bundle file.
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
    nativeFrameTimestampNs: '9999', // STRING on purpose -- this is the real-world shape
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
function fullyLabel(b) {
  let st = AWB.initAnnotationState(b);
  for (const e of b.entries) {
    const key = AWB.entryKey(e);
    for (const region of e.regionsToAnnotate) {
      const patch = { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' };
      if (AWB.regionRequiresSurfaceObservability(region)) patch.surfaceObservability = 'VISIBLE_SKIN';
      st = AWB.setRegionLabel(st, key, region, patch);
    }
  }
  return st;
}

// 1 — a completed raw-observation annotation exports successfully.
test('1: a fully-labeled RAW_SCAN_OBSERVATION bundle exports with zero validation errors', () => {
  const b = bundleWithRaw();
  const st = fullyLabel(b);
  const exp = AWB.buildExport(b, st);
  const vexp = AWB.validateExport(exp, b);
  assert.equal(vexp.ok, true, JSON.stringify(vexp.errors));
});

// 2 — nativeFrameTimestampNs is copied from the canonical bundle entry, string type preserved.
test('2: exported nativeFrameTimestampNs is copied verbatim (string in, string out) from the canonical entry', () => {
  const b = bundleWithRaw({ nativeFrameTimestampNs: '424242' });
  const st = fullyLabel(b);
  const exp = AWB.buildExport(b, st);
  for (const l of exp.labels) assert.equal(l.nativeFrameTimestampNs, '424242');
});

// 3 — a raw export label never emits a null timestamp when the canonical entry truthfully has one.
test('3: raw export never nulls a truthfully-present numeric-string timestamp', () => {
  for (const ts of ['9999', 424242, '0', 1]) {
    const b = bundleWithRaw({ nativeFrameTimestampNs: ts });
    const st = fullyLabel(b);
    const exp = AWB.buildExport(b, st);
    for (const l of exp.labels) assert.notEqual(l.nativeFrameTimestampNs, null, 'timestamp ' + JSON.stringify(ts) + ' must not become null');
  }
});

// 4 — sourceScanObservationId stays null for RAW_SCAN_OBSERVATION, unaffected by the timestamp fix.
test('4: sourceScanObservationId remains null for RAW_SCAN_OBSERVATION after the hotfix', () => {
  const b = bundleWithRaw();
  const st = fullyLabel(b);
  const exp = AWB.buildExport(b, st);
  for (const l of exp.labels) assert.equal(l.sourceScanObservationId, null);
});

// 5 — export identity round-trips to exactly one bundle entry (no ambiguity, no unknowns).
test('5: every exported raw label resolves to exactly one bundle entry via validateExport', () => {
  const b = bundleWithRaw();
  b.entries.push(rawEntry({ rawObservationId: 7, nativeFrameTimestampNs: '8888', imageRef: 'synthetic-raw:img:7:ts8888', regionsToAnnotate: ['UNDER_CHIN'] }));
  const st = fullyLabel(b);
  const exp = AWB.buildExport(b, st);
  const vexp = AWB.validateExport(exp, b);
  assert.equal(vexp.ok, true, JSON.stringify(vexp.errors));
  assert.equal(exp.labels.length, 4); // 3 regions on obs3 + 1 region on obs7
});

// 6 — annotation state need not duplicate canonical identity fields; only labels are stored per key.
test('6: internal annotation state stores only region labels, not a copy of identity fields', () => {
  const b = bundleWithRaw();
  const st = AWB.initAnnotationState(b);
  const key = AWB.entryKey(b.entries[0]);
  const regionKeys = Object.keys(st.byEntry[key]);
  for (const r of regionKeys) {
    const l = st.byEntry[key][r];
    assert.deepEqual(Object.keys(l).sort(), ['annotationConfidence', 'annotationStatus', 'hairState', 'notes', 'surfaceObservability'].sort());
    assert.equal('nativeFrameTimestampNs' in l, false, 'identity fields must be read from the canonical entry, never duplicated into label state');
  }
});

// 7 — existing historical ADAPTER_RETAINED exports still work (this hotfix touched a shared code
// path -- must not regress the untouched historical identity mode).
test('7: historical ADAPTER_RETAINED_OBSERVATION export is unaffected by the hotfix', () => {
  const b = bundle();
  const st = fullyLabel({ entries: [Object.assign({}, b.entries[0], { regionsToAnnotate: ['CHIN_CENTER', 'LEFT_JAW', 'RIGHT_JAW'] })] });
  const exp = AWB.buildExport({ entries: [Object.assign({}, b.entries[0], { regionsToAnnotate: ['CHIN_CENTER', 'LEFT_JAW', 'RIGHT_JAW'] })] }, st);
  const vexp = AWB.validateExport(exp, { entries: [Object.assign({}, b.entries[0], { regionsToAnnotate: ['CHIN_CENTER', 'LEFT_JAW', 'RIGHT_JAW'] })] });
  assert.equal(vexp.ok, true, JSON.stringify(vexp.errors));
  assert.equal(exp.labels[0].nativeFrameTimestampNs, b.entries[0].nativeFrameTimestampNs);
});

// 8 — currentScannerStep:"front" + observedPoseRegion:"CHINUP_REGION" still exports correctly
// after the hotfix (must not have regressed BI-1W's original disagreement-tolerance).
test('8: currentScannerStep/observedPoseRegion disagreement still exports correctly post-hotfix', () => {
  const b = bundleWithRaw({ currentScannerStep: 'front', observedPoseRegion: 'CHINUP_REGION' });
  const st = fullyLabel(b);
  const exp = AWB.buildExport(b, st);
  const vexp = AWB.validateExport(exp, b);
  assert.equal(vexp.ok, true, JSON.stringify(vexp.errors));
  assert.equal(exp.labels[0].observedPoseRegion, 'CHINUP_REGION');
});

// 9 — dual-channel values survive export unchanged.
test('9: hairState and surfaceObservability both survive export unchanged for dual-channel regions', () => {
  const b = bundleWithRaw();
  let st = AWB.initAnnotationState(b);
  const key = AWB.entryKey(b.entries[0]);
  st = AWB.setRegionLabel(st, key, 'UNDER_CHIN', { hairState: 'BEARD_CONFIRMED', surfaceObservability: 'BEARD_OCCLUDED_SKIN', annotationStatus: 'LABELED' });
  const exp = AWB.buildExport(b, st);
  const underChin = exp.labels.find(l => l.anatomicalRegion === 'UNDER_CHIN');
  assert.equal(underChin.hairState, 'BEARD_CONFIRMED');
  assert.equal(underChin.surfaceObservability, 'BEARD_OCCLUDED_SKIN');
});

// 10 — the real, unmodified BI-1W development bundle (as currently on disk -- NOT rebuilt by
// this hotfix) exports cleanly end-to-end from a synthetic "25/25 complete" state, proving the
// exact real-world failure is fixed without requiring the user's actual browser state.
test('10: the real BI-1W bundle exports 25/25 with zero identity errors after the hotfix', () => {
  const path = 'D:/MettleTemp/annotation/bi1w_submental_dev_bundle.json';
  let real;
  try { real = JSON.parse(readFileSync(path, 'utf8')); } catch { return; } // stage-external artifact; skip if absent
  assert.equal(AWB.validateBundle(real).ok, true);
  const st = fullyLabel(real);
  const p = AWB.progressCounts(real, st);
  assert.equal(p.regionsLabeled, 25);
  assert.equal(p.imagesCompleted, 5);
  const exp = AWB.buildExport(real, st);
  assert.equal(exp.labels.length, 25);
  for (const l of exp.labels) {
    assert.notEqual(l.nativeFrameTimestampNs, null, 'label ' + l.labelId + ' must not have a null timestamp');
    assert.equal(l.sourceScanObservationId, null);
  }
  const vexp = AWB.validateExport(exp, real);
  assert.equal(vexp.ok, true, JSON.stringify(vexp.errors));
});
