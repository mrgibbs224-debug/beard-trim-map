// BI-1E UX BLOCKER — per-region visual reference tier tests.
// Verifies: selecting a region activates its overlay; switching regions updates it; UNKNOWN
// remains available for every region; an unsupported region cannot masquerade as precise
// (categorical labeling is blocked, not just hidden); existing labels/export are unchanged for
// already-supported regions; the input bundle/fixtures are never mutated.
// Node built-in runner (node --test). Zero dependencies. Synthetic fixtures only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import AWB from './annotation-workbench.cjs';
import { attachOverlayData } from '../../accuracy/annotation-overlay-data.mjs';
import { UNSUPPORTED_REGIONS, SUPPORTED_REGIONS } from '../../accuracy/beard-anatomy-map.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'synthetic-bundle.json'), 'utf8'));
const OVERLAY_FIXTURE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'synthetic-overlay-bundle.json'), 'utf8'));
const bundle = () => JSON.parse(JSON.stringify(FIXTURE));
const overlayBundle = () => JSON.parse(JSON.stringify(OVERLAY_FIXTURE));

// 1 — selecting a (verified) region activates a real overlay group.
test('a VERIFIED region resolves to one of the real, existing overlay groups', () => {
  const ref = AWB.regionVisualReference('LEFT_JAW');
  assert.equal(ref.tier, 'VERIFIED');
  assert.ok(AWB.OVERLAY_GROUP_IDS.includes(ref.overlayGroupId));
});

// 2 — a PROXY region is honestly labeled as approximate, not precise.
test('MOUSTACHE_CENTER is a PROXY (borrowed lower-lip reference), never presented as verified', () => {
  const ref = AWB.regionVisualReference('MOUSTACHE_CENTER');
  assert.equal(ref.tier, 'PROXY');
  assert.equal(ref.overlayGroupId, 'mouth-ref');
  assert.match(ref.note, /not the upper-lip moustache surface/);
});

// 3 — switching the active region changes which group is referenced.
test('switching regions changes the resolved overlay group', () => {
  const jaw = AWB.regionVisualReference('LEFT_JAW');
  const cheek = AWB.regionVisualReference('RIGHT_LOWER_CHEEK');
  const mouth = AWB.regionVisualReference('MOUSTACHE_CENTER');
  assert.notEqual(jaw.overlayGroupId, cheek.overlayGroupId);
  assert.notEqual(cheek.overlayGroupId, mouth.overlayGroupId);
});

// 4 — UNKNOWN remains available for literally every AnatomicalRegion, supported or not.
test('UNKNOWN is always an allowed HairState, for every supported and unsupported region', () => {
  for (const r of [...SUPPORTED_REGIONS, ...UNSUPPORTED_REGIONS]) {
    assert.ok(AWB.regionAllowedHairStates(r).includes('UNKNOWN'), r + ' must allow UNKNOWN');
  }
});

// 5 — a geometrically-UNSUPPORTED region still never invents a visual reference, regardless of
// whether it turns out to be semantically labelable (that's a SEPARATE question — see the
// "visualization support and semantic labelability are independent" block below).
test('every UNSUPPORTED (geometry) region has no overlay group, even if it is semantically labelable', () => {
  for (const r of UNSUPPORTED_REGIONS) {
    const ref = AWB.regionVisualReference(r);
    assert.equal(ref.tier, 'UNSUPPORTED');
    assert.equal(ref.overlayGroupId, null, r + ' must not invent a visual reference');
  }
});

// ===========================================================================
// BI-1E PRE-ANNOTATION CORRECTION — visualization support vs. semantic labelability
// ===========================================================================
// "No verified 3D/geometric reference" and "can a human classify this region from the raw
// photo" are independent questions. A region can fail the first and pass the second.

test('visualization support and semantic labelability are independent axes', () => {
  // LEFT_SIDEBURN: no geometric reference at all, but confidently labelable from the photo.
  const sideburn = { visual: AWB.regionVisualReference('LEFT_SIDEBURN'), lab: AWB.regionLabelability('LEFT_SIDEBURN') };
  assert.equal(sideburn.visual.tier, 'UNSUPPORTED');
  assert.equal(sideburn.lab.tier, 'LABELABLE_FROM_IMAGE');
  // LEFT_JAW: has BOTH a verified geometric reference AND is labelable — the two tables agree
  // here, but that's a coincidence of evidence, not a rule that one determines the other.
  const jaw = { visual: AWB.regionVisualReference('LEFT_JAW'), lab: AWB.regionLabelability('LEFT_JAW') };
  assert.equal(jaw.visual.tier, 'VERIFIED');
  assert.equal(jaw.lab.tier, 'LABELABLE_FROM_IMAGE');
  // NECK_FRONT: no geometric reference AND not reliably labelable either — both axes agree on
  // "no", but for different, independently-evaluated reasons (no rail vs. no reliable semantic
  // definition), not because one caused the other. (UNDER_CHIN itself was promoted to
  // LABELABLE_WITH_CAUTION in BI-1W once real Chin-Up imagery confirmed it is visually judgeable
  // — see the dedicated dual-channel tests for that region's current behavior.)
  const neckFront = { visual: AWB.regionVisualReference('NECK_FRONT'), lab: AWB.regionLabelability('NECK_FRONT') };
  assert.equal(neckFront.visual.tier, 'UNSUPPORTED');
  assert.equal(neckFront.lab.tier, 'UNKNOWN_ONLY');
});

// an unsupported-but-image-labelable region can receive BOTH BEARD_CONFIRMED and
// NON_BEARD_CONFIRMED (real ground truth needs both positive and negative evidence).
test('an unsupported-but-image-labelable region (RIGHT_SIDEBURN) can receive BEARD_CONFIRMED', () => {
  const b = bundle();
  b.entries[0].regionsToAnnotate = ['RIGHT_SIDEBURN'];
  const id = b.entries[0].sourceScanObservationId;
  let st = AWB.initAnnotationState(b);
  st = AWB.setRegionLabel(st, id, 'RIGHT_SIDEBURN', { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  assert.equal(st.byEntry[id].RIGHT_SIDEBURN.hairState, 'BEARD_CONFIRMED');
});

test('the same unsupported-but-image-labelable region can receive NON_BEARD_CONFIRMED', () => {
  const b = bundle();
  b.entries[0].regionsToAnnotate = ['RIGHT_SIDEBURN'];
  const id = b.entries[0].sourceScanObservationId;
  let st = AWB.initAnnotationState(b);
  st = AWB.setRegionLabel(st, id, 'RIGHT_SIDEBURN', { hairState: 'NON_BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  assert.equal(st.byEntry[id].RIGHT_SIDEBURN.hairState, 'NON_BEARD_CONFIRMED');
});

// a truly UNKNOWN_ONLY region (no geometry AND no reliable semantic definition) rejects both
// positive and negative categorical labels — only UNKNOWN succeeds.
test('a truly UNKNOWN_ONLY region (NECK_FRONT) rejects both BEARD_CONFIRMED and NON_BEARD_CONFIRMED', () => {
  const b = bundle();
  b.entries[0].regionsToAnnotate = ['NECK_FRONT'];
  const id = b.entries[0].sourceScanObservationId;
  let st = AWB.initAnnotationState(b);
  assert.throws(() => AWB.setRegionLabel(st, id, 'NECK_FRONT', { hairState: 'BEARD_CONFIRMED' }), /classified UNKNOWN_ONLY/);
  assert.throws(() => AWB.setRegionLabel(st, id, 'NECK_FRONT', { hairState: 'NON_BEARD_CONFIRMED' }), /classified UNKNOWN_ONLY/);
  st = AWB.setRegionLabel(st, id, 'NECK_FRONT', { hairState: 'UNKNOWN', annotationStatus: 'NEEDS_REVIEW' });
  assert.equal(st.byEntry[id].NECK_FRONT.hairState, 'UNKNOWN');
});

// SOUL_PATCH remains distinct: it is its own AnatomicalRegion (never merged into a generic beard
// region name), is labelable from the image, and its export label carries that exact region name
// so downstream consumers can keep ORANGE (soul-patch) separate from BLUE (general beard).
test('SOUL_PATCH remains a distinct, labelable, non-merged region', () => {
  assert.equal(AWB.regionLabelability('SOUL_PATCH').tier, 'LABELABLE_FROM_IMAGE');
  assert.notEqual('SOUL_PATCH', 'CHIN_CENTER');
  const b = bundle();
  b.entries.length = 1; // isolate to a single entry so buildExport only reports these two regions
  b.entries[0].regionsToAnnotate = ['SOUL_PATCH', 'CHIN_CENTER'];
  const id = b.entries[0].sourceScanObservationId;
  let st = AWB.initAnnotationState(b);
  st = AWB.setRegionLabel(st, id, 'SOUL_PATCH', { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  st = AWB.setRegionLabel(st, id, 'CHIN_CENTER', { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  const exp = AWB.buildExport(b, st);
  const regions = exp.labels.map(l => l.anatomicalRegion).sort();
  assert.deepEqual(regions, ['CHIN_CENTER', 'SOUL_PATCH']); // two distinct rows, never collapsed
});

// no fake geometry is ever emitted for an unsupported region, regardless of its labelability —
// overlayGroupId stays null, and overlayDisplayModel never fabricates a group for it.
test('no fake geometry is emitted for unsupported regions, labelable or not', () => {
  for (const r of ['LEFT_SIDEBURN', 'MOUSTACHE_LEFT', 'SOUL_PATCH', 'LEFT_UPPER_CHEEK', 'UNDER_CHIN']) {
    assert.equal(AWB.regionVisualReference(r).overlayGroupId, null, r + ' must never be assigned a fake overlay group');
  }
  const e = overlayBundle().entries[0];
  const noGroupRequested = AWB.overlayDisplayModel(e, { groupIds: [] });
  assert.deepEqual(noGroupRequested.groups, []);
});

// a replacement bundle entry (e.g. swapping in a better real Front keyframe) must preserve
// identity/provenance exactly — attachOverlayData is the same reused chain a real swap uses, and
// it refuses to attach overlay data whose identity doesn't match, and never touches any other field.
test('a replacement entry preserves identity/provenance exactly via the same attachOverlayData chain a real swap uses', () => {
  const original = {
    sourceScanObservationId: 'a60b:front:img:99', imageRef: 'a60b:front:img:99:ts123', nativeFrameTimestampNs: 123,
    poseId: 'front', observedPoseRegion: 'FRONT_REGION', syncStatus: 'EXACT_SYNCHRONIZED',
    rawImagePayload: 'data:image/png;base64,ZZZ', regionsToAnnotate: ['CHIN_CENTER', 'MOUSTACHE_CENTER'],
    rotationDegrees: 0, mirrored: false, imageWidth: 640, imageHeight: 480
  };
  const overlayData = {
    schemaVersion: 'annotation-overlay-data/1', space: 'IMAGE',
    sourceScanObservationId: original.sourceScanObservationId, imageRef: original.imageRef,
    nativeFrameTimestampNs: original.nativeFrameTimestampNs, imageWidth: 640, imageHeight: 480,
    rotationDegrees: 0, mirrored: false,
    points: [{ index: 152, x: 320, y: 300, group: 'jaw-chin' }], groupsPresent: ['jaw-chin']
  };
  const replaced = attachOverlayData(original, overlayData);
  for (const k of Object.keys(original)) assert.deepEqual(replaced[k], original[k], k + ' must survive a replacement untouched');
  assert.equal(replaced.overlayData, overlayData);
  assert.equal(Object.isFrozen(replaced), true);
});

// 6 — existing labels/export are unchanged for regions that were already supported.
test('a VERIFIED region still labels and exports exactly as before', () => {
  const b = bundle();
  const id = b.entries[0].sourceScanObservationId;
  let st = AWB.initAnnotationState(b);
  st = AWB.setRegionLabel(st, id, 'LEFT_JAW', { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  const exp = AWB.buildExport(b, st, { exportedAt: '2026-01-01T00:00:00.000Z' });
  const label = exp.labels.find(l => l.anatomicalRegion === 'LEFT_JAW');
  assert.equal(label.hairState, 'BEARD_CONFIRMED');
  assert.equal(label.annotationStatus, 'LABELED');
  const v = AWB.validateExport(exp, b);
  assert.equal(v.ok, true);
});

// 7 — the input bundle and the reference table are never mutated by any of this.
test('resolving region references never mutates the bundle, and the reference table is frozen', () => {
  const b = bundle();
  const before = JSON.stringify(b);
  AWB.regionVisualReference('LEFT_JAW');
  AWB.regionVisualReference('SOUL_PATCH');
  AWB.regionAllowedHairStates('UNDER_CHIN');
  assert.equal(JSON.stringify(b), before, 'bundle must be byte-identical after read-only lookups');
  const ref = AWB.regionVisualReference('LEFT_JAW');
  assert.throws(() => { ref.tier = 'UNSUPPORTED'; }, /Cannot assign|read only|read-only/i);
});

// 8 — an unrecognized region name fails closed to UNSUPPORTED rather than throwing or guessing.
test('an unrecognized region name resolves to UNSUPPORTED, not a crash or a guess', () => {
  const ref = AWB.regionVisualReference('NOT_A_REAL_REGION');
  assert.equal(ref.tier, 'UNSUPPORTED');
  assert.equal(ref.overlayGroupId, null);
});

// 9 — this is the exact mechanism index.html's renderGeometryGuide() relies on to isolate the
// ACTIVE region's group: overlayDisplayModel(entry, {groupIds}) must return only that group's
// points/rail, not the whole overlay, and an empty groupIds list must return no groups/points.
test('overlayDisplayModel groupIds option isolates a single group (the active-region-highlight mechanism)', () => {
  const e = overlayBundle().entries[0];
  const full = AWB.overlayDisplayModel(e);
  assert.ok(full.groups.length > 1, 'fixture must carry more than one group for this test to be meaningful');
  const jawOnly = AWB.overlayDisplayModel(e, { groupIds: ['jaw-chin'] });
  assert.deepEqual(jawOnly.groups.map(g => g.id), ['jaw-chin']);
  assert.ok(jawOnly.points.every(p => p.group === 'jaw-chin' || p.group === null));
  const none = AWB.overlayDisplayModel(e, { groupIds: [] });
  assert.deepEqual(none.groups, []);
  assert.ok(none.points.every(p => p.group === null), 'an empty groupIds must drop every grouped point');
});

// 10 — the same image renders identically whichever region is active: switching the active
// region only changes which group is highlighted, never the underlying image/overlay geometry.
test('switching the active region changes the highlighted group without altering the image geometry itself', () => {
  const e = overlayBundle().entries[0];
  const forJaw = AWB.overlayDisplayModel(e, { groupIds: ['jaw-chin'] });
  const forCheek = AWB.overlayDisplayModel(e, { groupIds: ['cheek'] });
  assert.deepEqual(forJaw.viewBox, forCheek.viewBox);
  assert.equal(forJaw.transformCss, forCheek.transformCss);
  assert.notDeepEqual(forJaw.groups.map(g => g.id), forCheek.groups.map(g => g.id));
});
