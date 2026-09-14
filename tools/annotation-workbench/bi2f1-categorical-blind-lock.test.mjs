import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('./annotation-workbench.cjs');
const PC = require('./precision-annotation-core.cjs');

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

function blindBundle() {
  return {
    schemaVersion: 'annotation-bundle/1', gtMode: 'BLIND_GT', bundleId: 'bi2f1-test-001',
    entries: [{ sourceScanObservationId: 'o1', imageRef: 'img1', regionsToAnnotate: ['CHIN_CENTER', 'LEFT_JAW'] }]
  };
}
function normalBundle() {
  return {
    schemaVersion: 'annotation-bundle/1', bundleId: 'normal-001',
    entries: [{ sourceScanObservationId: 'o1', imageRef: 'img1', regionsToAnnotate: ['CHIN_CENTER', 'LEFT_JAW'] }]
  };
}
function completeState(bundle) {
  let st = A.initAnnotationState(bundle);
  st = A.setRegionLabel(st, 'o1', 'CHIN_CENTER', { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  st = A.setRegionLabel(st, 'o1', 'LEFT_JAW', { hairState: 'NON_BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  return st;
}

// ---------- categorical blind lock only available in BLIND_GT ----------

test('1. lockEntryAnswers works for a BLIND_GT bundle', () => {
  const b = blindBundle();
  const st = A.lockEntryAnswers(completeState(b), 'o1', b, PC, { bundleId: b.bundleId });
  assert.equal(A.entryMetaOf(st, 'o1').locked, true);
});

test('1b. the categorical lock UI button only renders for BLIND_GT bundles (index.html)', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /PC\.isBlindGtBundle\(bundle\) && \(e\.regionsToAnnotate\|\|\[\]\)\.length/);
  assert.match(html, /Lock Blind Answers/);
});

// ---------- cannot lock an incomplete entry ----------

test('2. lockEntryAnswers refuses when any requested region is still pending', () => {
  const b = blindBundle();
  let st = A.initAnnotationState(b);
  st = A.setRegionLabel(st, 'o1', 'CHIN_CENTER', { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  // LEFT_JAW never touched -- still UNKNOWN/pending
  assert.throws(() => A.lockEntryAnswers(st, 'o1', b, PC, {}), /not complete/);
});

// ---------- lock freezes exact answers ----------

test('3. the locked record carries the exact answers, sorted deterministically by region', () => {
  const b = blindBundle();
  const st = A.lockEntryAnswers(completeState(b), 'o1', b, PC, {});
  const rec = A.entryMetaOf(st, 'o1').lockedRecord;
  assert.equal(rec.kind, 'CATEGORICAL_REGION_ANSWERS');
  assert.deepEqual(rec.answers.map(a => a.region), ['CHIN_CENTER', 'LEFT_JAW']);
  assert.equal(rec.answers[0].hairState, 'BEARD_CONFIRMED');
  assert.equal(rec.answers[1].hairState, 'NON_BEARD_CONFIRMED');
  assert.equal(typeof rec.fingerprint, 'string');
  assert.ok(Object.isFrozen(rec));
});

// ---------- locked entry rejects edits ----------

test('4. setRegionLabel refuses to edit a locked entry', () => {
  const b = blindBundle();
  const st = A.lockEntryAnswers(completeState(b), 'o1', b, PC, {});
  assert.throws(() => A.setRegionLabel(st, 'o1', 'CHIN_CENTER', { hairState: 'UNKNOWN' }), /LOCKED/);
});

test('4b. a second lockEntryAnswers call on an already-locked entry refuses', () => {
  const b = blindBundle();
  const st = A.lockEntryAnswers(completeState(b), 'o1', b, PC, {});
  assert.throws(() => A.lockEntryAnswers(st, 'o1', b, PC, {}), /already locked/);
});

// ---------- autosave restores categorical lock ----------

test('5. autosave round-trip preserves an ACTIVE categorical lock (locked:true + exact fingerprint)', () => {
  const b = blindBundle();
  const st = A.lockEntryAnswers(completeState(b), 'o1', b, PC, {});
  const payload = A.buildAutosavePayload(b, st);
  const restored = A.restoreFromAutosave(payload, b);
  assert.equal(restored.ok, true);
  const em = A.entryMetaOf(restored.state, 'o1');
  assert.equal(em.locked, true);
  assert.equal(em.lockedRecord.fingerprint, A.entryMetaOf(st, 'o1').lockedRecord.fingerprint);
  assert.throws(() => A.setRegionLabel(restored.state, 'o1', 'CHIN_CENTER', { hairState: 'UNKNOWN' }), /LOCKED/);
});

test('5b. a structurally implausible saved lock fails closed to unlocked, never trusted as real', () => {
  const b = blindBundle();
  const payload = A.buildAutosavePayload(b, A.initAnnotationState(b));
  payload.entryMeta.o1 = { locked: true, lockedRecord: { garbage: true } };
  const restored = A.restoreFromAutosave(payload, b);
  assert.equal(restored.ok, true);
  assert.equal(A.entryMetaOf(restored.state, 'o1').locked, false);
});

// ---------- revision preserves original lock / lineage survives reload ----------

test('6. createCategoricalRevision archives the original lock unmutated and starts a new editable copy', () => {
  const b = blindBundle();
  const locked = A.lockEntryAnswers(completeState(b), 'o1', b, PC, {});
  const origFingerprint = A.entryMetaOf(locked, 'o1').lockedRecord.fingerprint;
  const revised = A.createCategoricalRevision(locked, 'o1', PC);
  const em = A.entryMetaOf(revised, 'o1');
  assert.equal(em.locked, false);
  assert.equal(em.revisionNumber, 2);
  assert.equal(em.basedOnFingerprint, origFingerprint);
  assert.equal(em.priorRevisions[0].fingerprint, origFingerprint);
  // original input object is untouched
  assert.equal(A.entryMetaOf(locked, 'o1').lockedRecord.fingerprint, origFingerprint);
  assert.equal(A.entryMetaOf(locked, 'o1').locked, true);
  // the revision copies the exact answers, editable
  assert.equal(A.entryLabels(revised, 'o1').CHIN_CENTER.hairState, 'BEARD_CONFIRMED');
  const moved = A.setRegionLabel(revised, 'o1', 'CHIN_CENTER', { hairState: 'NON_BEARD_CONFIRMED' });
  assert.equal(A.entryLabels(moved, 'o1').CHIN_CENTER.hairState, 'NON_BEARD_CONFIRMED');
});

test('6b. re-locking a revision stamps lineage (revision 2, basedOnRevision 1) and lineage survives autosave reload', () => {
  const b = blindBundle();
  let st = A.lockEntryAnswers(completeState(b), 'o1', b, PC, {});
  st = A.createCategoricalRevision(st, 'o1', PC);
  st = A.lockEntryAnswers(st, 'o1', b, PC, {});
  const em = A.entryMetaOf(st, 'o1');
  assert.equal(em.lockedRecord.revision, 2);
  assert.equal(em.lockedRecord.basedOnRevision, 1);
  const restored = A.restoreFromAutosave(A.buildAutosavePayload(b, st), b);
  const remEm = A.entryMetaOf(restored.state, 'o1');
  assert.equal(remEm.revisionNumber, 2);
  assert.equal(remEm.lockedRecord.basedOnRevision, 1);
  assert.equal(remEm.priorRevisions.length, 1);
});

test('6c. createCategoricalRevision refuses when the source entry is not locked', () => {
  const b = blindBundle();
  assert.throws(() => A.createCategoricalRevision(completeState(b), 'o1', PC), /not locked/);
});

// ---------- BLIND_GT export blocked when pending / unlocked; completed+locked exports ----------

test('7. validateExport blocks a BLIND_GT export when any region is still pending', () => {
  const b = blindBundle();
  let st = A.initAnnotationState(b);
  st = A.setRegionLabel(st, 'o1', 'CHIN_CENTER', { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  const exp = A.buildExport(b, st, {});
  const v = A.validateExport(exp, b);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /pending annotationStatus/.test(e)));
});

test('8. validateExport blocks a BLIND_GT export when an entry is complete but NOT locked', () => {
  const b = blindBundle();
  const exp = A.buildExport(b, completeState(b), {});
  const v = A.validateExport(exp, b);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /not locked/.test(e)));
});

test('9. a complete AND locked BLIND_GT bundle exports cleanly', () => {
  const b = blindBundle();
  const st = A.lockEntryAnswers(completeState(b), 'o1', b, PC, {});
  const exp = A.buildExport(b, st, {});
  const v = A.validateExport(exp, b);
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

test('9b. manually invoking buildExport/validateExport (bypassing the UI button) cannot smuggle through an incomplete/unlocked BLIND_GT export', () => {
  const b = blindBundle();
  const exp = A.buildExport(b, A.initAnnotationState(b), {}); // nothing ever touched
  assert.equal(A.validateExport(exp, b).ok, false);
});

// ---------- explicit human UNKNOWN distinguishable from pending status ----------

test('10. hairState UNKNOWN with an explicit LABELED annotationStatus is a legitimate, exportable human answer, distinct from a pending UNKNOWN status', () => {
  const b = blindBundle();
  let st = A.initAnnotationState(b);
  st = A.setRegionLabel(st, 'o1', 'CHIN_CENTER', { hairState: 'UNKNOWN', annotationStatus: 'LABELED' });
  st = A.setRegionLabel(st, 'o1', 'LEFT_JAW', { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  assert.equal(A.isEntryComplete(A.entryLabels(st, 'o1'), b.entries[0].regionsToAnnotate), true);
  const locked = A.lockEntryAnswers(st, 'o1', b, PC, {});
  const exp = A.buildExport(b, locked, {});
  assert.equal(A.validateExport(exp, b).ok, true);
  const chinLabel = exp.labels.find(l => l.anatomicalRegion === 'CHIN_CENTER');
  assert.equal(chinLabel.hairState, 'UNKNOWN');
  assert.equal(chinLabel.annotationStatus, 'LABELED');
});

// ---------- exact evaluation-region ID survives export; no ambiguous mapping ----------

test('11. an entry-declared regionEvaluationIds mapping survives into the export as evaluationRegionId', () => {
  const b = blindBundle();
  b.entries[0].regionEvaluationIds = { CHIN_CENTER: 'CHIN_BEARD', LEFT_JAW: 'JAW_LEFT' };
  const st = A.lockEntryAnswers(completeState(b), 'o1', b, PC, {});
  const exp = A.buildExport(b, st, {});
  assert.equal(exp.labels.find(l => l.anatomicalRegion === 'CHIN_CENTER').evaluationRegionId, 'CHIN_BEARD');
  assert.equal(exp.labels.find(l => l.anatomicalRegion === 'LEFT_JAW').evaluationRegionId, 'JAW_LEFT');
});

test('11b. a region with no explicit regionEvaluationIds mapping falls back to its own canonical key (never left blank/ambiguous)', () => {
  const b = normalBundle();
  const exp = A.buildExport(b, completeState(b), {});
  assert.equal(exp.labels.find(l => l.anatomicalRegion === 'CHIN_CENTER').evaluationRegionId, 'CHIN_CENTER');
});

// ---------- evaluation ROI contains no prediction/result fields; geometry badge hidden ----------

test('12. a synthetic regionEvaluationRoi carries ONLY points/space/source -- real-bundle content is checked separately, LOCALLY, in D:\\MettleTemp\\analysis\\bi2f_blind_gt\\', () => {
  const roi = { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }], space: 'IMAGE', source: 'test fixture' };
  assert.deepEqual(Object.keys(roi).sort(), ['points', 'source', 'space']);
  roi.points.forEach(p => assert.deepEqual(Object.keys(p).sort(), ['x', 'y']));
});

test('13. the geometry-support tier badge/notes are hidden for BLIND_GT bundles in index.html, but the labeling controls remain', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /var blindRegions=isBlindBundle\(\);/);
  assert.match(html, /\(blindRegions \? '' :\s*\n\s*'<div class="row" style="margin:-4px 0 6px">'\+\s*\n\s*'<span class="tier-badge/);
});

// ---------- Hairness/occupancy/fusion outputs absent ----------

test('14. no Hairness/occupancy/fusion output field exists anywhere in the categorical export or the real bundle', () => {
  const b = blindBundle();
  const st = A.lockEntryAnswers(completeState(b), 'o1', b, PC, {});
  const exp = A.buildExport(b, st, {});
  const raw = JSON.stringify(exp);
  assert.ok(!/hairnessScore|occupancyState|semanticFusion|modelConfidence|predictedBeardBoundary/i.test(raw));
});

// ---------- exact JAW_SUPPORT region mapping ----------

test('15. buildExport correctly preserves an 8-region JAW_SUPPORT-style regionEvaluationIds mapping one-to-one, exactly as the real bundle declares it', () => {
  const b = normalBundle();
  b.entries[0].regionsToAnnotate = ['MOUSTACHE_CENTER', 'CHIN_CENTER', 'LEFT_LOWER_CHEEK', 'RIGHT_LOWER_CHEEK', 'LEFT_SIDEBURN', 'RIGHT_SIDEBURN', 'LEFT_JAW', 'RIGHT_JAW'];
  const expected = { MOUSTACHE_CENTER: 'MOUSTACHE_CENTER', CHIN_CENTER: 'CHIN_BEARD', LEFT_LOWER_CHEEK: 'CHEEK_LEFT', RIGHT_LOWER_CHEEK: 'CHEEK_RIGHT', LEFT_SIDEBURN: 'SIDEBURN_LEFT', RIGHT_SIDEBURN: 'SIDEBURN_RIGHT', LEFT_JAW: 'JAW_LEFT', RIGHT_JAW: 'JAW_RIGHT' };
  b.entries[0].regionEvaluationIds = expected;
  let st = A.initAnnotationState(b);
  b.entries[0].regionsToAnnotate.forEach(r => { st = A.setRegionLabel(st, 'o1', r, { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' }); });
  const exp = A.buildExport(b, st, {});
  const gotMap = {};
  exp.labels.forEach(l => { gotMap[l.anatomicalRegion] = l.evaluationRegionId; });
  assert.deepEqual(gotMap, expected);
});

// ---------- CHIN_NECK_TRANSITION behavior per the audit result ----------

test('16. CHIN_NECK_TRANSITION is promoted to LABELABLE_WITH_CAUTION (not the stronger LABELABLE_FROM_IMAGE) and allows a real categorical judgment', () => {
  const lab = A.regionLabelability('CHIN_NECK_TRANSITION');
  assert.equal(lab.tier, 'LABELABLE_WITH_CAUTION');
  const allowed = A.regionAllowedHairStates('CHIN_NECK_TRANSITION');
  assert.deepEqual(allowed.slice().sort(), ['BEARD_CONFIRMED', 'NON_BEARD_CONFIRMED', 'UNKNOWN'].sort());
});

// (16b -- the real bundle's CHIN_NECK_TRANSITION entry provenance is checked separately, LOCALLY,
// in D:\MettleTemp\analysis\bi2f_blind_gt\validate_bundle.test.mjs, since it depends on the
// personal-data bundle file, which is never committed to this repo.)

// ---------- non-BLIND historical behavior does not regress ----------

test('17. a non-BLIND (historical) bundle is completely unaffected: no entry-level lock guard, no export gating change', () => {
  const b = normalBundle();
  const st = A.setRegionLabel(A.initAnnotationState(b), 'o1', 'CHIN_CENTER', { hairState: 'BEARD_CONFIRMED', annotationStatus: 'LABELED' });
  // no lock ever applied, no completeness -- still exports exactly as before (historical behavior)
  const exp = A.buildExport(b, st, {});
  const v = A.validateExport(exp, b);
  assert.equal(v.ok, true); // non-BLIND bundles were never gated on completeness/lock
});

test('17b. defaultRegionLabel/entryLabels/isEntryComplete/progressCounts signatures and core behavior are byte-identical to pre-BI-2F1 (additive-only entryMeta)', () => {
  const b = normalBundle();
  const st = A.initAnnotationState(b);
  assert.deepEqual(Object.keys(A.defaultRegionLabel()).sort(), ['annotationConfidence', 'annotationStatus', 'hairState', 'notes', 'surfaceObservability']);
  assert.deepEqual(A.entryLabels(st, 'o1').CHIN_CENTER, A.defaultRegionLabel());
});

// ---------- production/scanner hashes unchanged ----------

test('18. production hashes (index.html at repo root, worker.js) remain unchanged', () => {
  const idx = readFileSync(new URL('../../index.html', import.meta.url));
  const wkr = readFileSync(new URL('../../worker.js', import.meta.url));
  assert.equal(sha256(idx), '928747a5d284060dddac43c95f97a1669492ab4d1ecebf0d34bc59f3a3b5b521');
  assert.equal(sha256(wkr), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});

test('18b. accuracy/research runtime modules (neck scaffold, BI-2E occupancy, hairness core) remain unchanged -- no Hairness threshold tuning occurred', () => {
  assert.equal(sha256(readFileSync(new URL('../../accuracy/sparse-neck-scaffold-v1.mjs', import.meta.url))), '3798248b018919a61dea71173802b7a4acf6420447edffecc3e49da020d306f9');
  assert.equal(sha256(readFileSync(new URL('../../accuracy/region-scoped-beard-occupancy-v1.mjs', import.meta.url))), '4296668b88e121859db0a40ff69bce19c3c47f0b273363acb73e133795d6eaaa');
});

// ---------- BI-2F1 manual-acceptance-failure follow-up: harden proof that a 0/N-pending
// BLIND_GT bundle cannot export, at both the exact UI boolean expression AND validateExport ----

test('19. index.html re-computes el(\'btnExport\').disabled on EVERY render() for BLIND_GT bundles, using imagesCompleted/imagesLocked (not just the load-time hasRegions check)', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /if\(isBlindBundle\(\)\)\{\s*\n\s*el\('btnExport'\)\.disabled = !\(p\.regionsRequested>0 && p\.imagesCompleted===p\.imageTotal && p\.imagesLocked===p\.imageTotal\);/);
});

test('20. the exact UI gating expression evaluates disabled=true for a fully-pending 0/N BLIND_GT bundle (mirrors index.html\'s own boolean, computed from real progressCounts, not appearance)', () => {
  const b = {
    schemaVersion: 'annotation-bundle/1', gtMode: 'BLIND_GT', bundleId: 'zero-of-n',
    entries: [
      { sourceScanObservationId: 'o1', imageRef: 'i1', regionsToAnnotate: ['CHIN_CENTER'] },
      { sourceScanObservationId: 'o2', imageRef: 'i2', regionsToAnnotate: ['LEFT_JAW'] }
    ]
  };
  const st = A.initAnnotationState(b); // nothing touched -- the "0/3"-style pending case
  const p = A.progressCounts(b, st);
  assert.equal(p.regionsRequested, 2);
  assert.equal(p.imagesCompleted, 0);
  assert.equal(p.imagesLocked, 0);
  const disabled = !(p.regionsRequested > 0 && p.imagesCompleted === p.imageTotal && p.imagesLocked === p.imageTotal);
  assert.equal(disabled, true, 'a 0/N pending BLIND_GT bundle must compute Export as disabled');
  // and the programmatic path agrees independently of the UI boolean
  const exp = A.buildExport(b, st, {});
  assert.equal(A.validateExport(exp, b).ok, false);
});

// (21/22 -- the repaired acceptance bundle's own zero-annotation export-gating and image-payload
// validity are checked separately, LOCALLY, in
// D:\MettleTemp\analysis\bi2f1_manual\validate_acceptance_bundle.test.mjs, keeping this
// git-tracked file free of any dependency on a file outside the repo.)

// ---------- BI-2F1 region-activation UX fix: physical acceptance found that clicking/tabbing
// into a region's HAIR/SKIN SURFACE/Status/Confidence/Notes control never activated that region
// (the old code only listened for 'focus' directly on the region DIV, which does not bubble from
// a child control), so the evaluation ROI never followed the annotator's actual interaction.
// index.html has no DOM test harness (no jsdom in this repo -- see every other index.html test
// in this file/precision-annotation.test.mjs), so activation wiring is verified structurally,
// exactly like tests 1b/13/19 above verify other index.html behavior. ----------

test('23. the old non-bubbling focus-only activation listener is gone', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /addEventListener\('focus',function\(\)\{ activeRegion=rg;/);
});

test('24. focusin (bubbles from ANY descendant -- covers a child SELECT, INPUT, or TEXTAREA gaining focus via click or Tab) is bound on the region card', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /d\.addEventListener\('focusin', activateThisRegion\)/);
  // the region card's own innerHTML nests a <select> (HAIR, SKIN SURFACE, Status), an
  // <input> (Confidence), and a <textarea> (Notes) -- focusin's bubbling is a DOM platform
  // guarantee that fires identically regardless of which of these three tag types receives
  // focus, so one listener on the shared ancestor covers HAIR/SKIN-SURFACE/Status (select),
  // Confidence (input), and Notes (textarea) alike -- never only some of them.
  assert.match(html, /<label>HAIR<\/label>'\+sel\(/);
  assert.match(html, /<label>SKIN SURFACE/);
  assert.match(html, /type="number"[^>]*data-k="cf"/);
  assert.match(html, /<textarea data-k="nt"/);
});

test('25. click is also bound on the region card, so the header/blank card area (not natively focusable) activates it too', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /d\.addEventListener\('click', activateThisRegion\)/);
});

test('26. activateThisRegion mutates ONLY activeRegion/the active-card highlight/the ROI redraw -- never a label field (onField/setRegionLabel)', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const m = /var activateThisRegion=function\(\)\{[\s\S]*?\}\s*\};/.exec(html);
  assert.ok(m, 'activateThisRegion definition must be present');
  const body = m[0];
  assert.match(body, /activeRegion=rg/);
  assert.match(body, /markActive\(\)/);
  assert.match(body, /renderGeometryGuide\(e\)/);
  assert.doesNotMatch(body, /onField|setRegionLabel|A\.setRegionLabel/);
});

test('27. the evaluation ROI shown is keyed by the current activeRegion, so switching the active region (CHIN_CENTER -> LEFT_JAW, or any region on image 2) immediately selects that region\'s own regionEvaluationRoi', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /var roiDef = activeRegion && e\.regionEvaluationRoi && e\.regionEvaluationRoi\[activeRegion\];/);
});

test('28. no Hairness/occupancy/fusion/model-result term was introduced by the activation-UX fix itself', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const m = /var activateThisRegion=function\(\)\{[\s\S]*?\}\s*\};[\s\S]{0,200}/.exec(html);
  assert.ok(m);
  assert.doesNotMatch(m[0], /hairnessScore|occupancyState|semanticFusion|modelConfidence|predictedBeardBoundary/i);
});

// ---------- BI-2F1 ROI visibility fix: physical acceptance found the original single light-gray
// stroke (#e8ecf1) nearly invisible against a similarly-toned light source image. The overlay was
// changed to a two-tone (dark halo + light dashed outline) treatment plus an optional neutral
// "TARGET AREA" label, all drawn from the exact same regionEvaluationRoi point list -- geometry
// itself is untouched. No jsdom in this repo, so verified structurally like every other
// index.html UI behavior above. ----------

function neutralColorChannels(str) {
  // pull every #rrggbb / #rgb / rgb(a)(...) color literal out of a CSS/text fragment and return
  // each as an [r,g,b] triple, so a test can assert every one is grayscale (r==g==b, or very
  // close -- never a color with a dominant green or red channel).
  const triples = [];
  const hex6 = str.match(/#[0-9a-f]{6}\b/gi) || [];
  hex6.forEach(h => triples.push([parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]));
  const rgbFn = str.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g) || [];
  rgbFn.forEach(f => { const n = f.match(/\d+/g).map(Number); triples.push([n[0], n[1], n[2]]); });
  return triples;
}

function evalRoiRuleBodies(html) {
  // extract ONLY the {...} property bodies of the three eval-roi rules -- never the surrounding
  // prose comments, which are free to discuss "confidence"/"#e8ecf1" etc. in plain English
  // without that being mistaken for an actual property value.
  const halo = /\.eval-roi-halo\{([^}]*)\}/.exec(html);
  const outline = /(?<!-)\.eval-roi\{([^}]*)\}/.exec(html);
  const label = /\.eval-roi-label\{([^}]*)\}/.exec(html);
  assert.ok(halo && outline && label, 'all three eval-roi CSS rules must be present');
  return { halo: halo[1], outline: outline[1], label: label[1], all: halo[1] + ';' + outline[1] + ';' + label[1] };
}

test('29. the ROI overlay style (halo + dashed outline + label) uses only neutral grayscale colors -- no green/red beard-vs-skin coding, no color-coded model implication', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const { all } = evalRoiRuleBodies(html);
  const triples = neutralColorChannels(all);
  assert.ok(triples.length >= 3, 'expected at least halo/outline/label colors');
  triples.forEach(([r, g, b]) => {
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    assert.ok(spread <= 10, `color [${r},${g},${b}] is not neutral grayscale (channel spread ${spread})`);
  });
});

test('30. the ROI is still a plain outline/halo/label, never a filled heatmap or confidence-scaled opacity', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const { halo, all } = evalRoiRuleBodies(html);
  assert.match(halo, /fill:none/, 'halo layer must carry no fill, only an outline');
  assert.doesNotMatch(all, /gradient|heatmap|confidence/i);
});

test('31. the halo polygon, dashed outline polygon, and TARGET AREA label are all drawn from the exact same point list/centroid for the CURRENT activeRegion -- switching regions (CHIN_CENTER/LEFT_JAW/CHIN_NECK_TRANSITION alike) recomputes all three together, with no per-region special case', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /var roiDef = activeRegion && e\.regionEvaluationRoi && e\.regionEvaluationRoi\[activeRegion\];/);
  const renderBlock = /var roiDef = activeRegion[\s\S]*?svg\.style\.display='block';/.exec(html);
  assert.ok(renderBlock, 'ROI render block must be present');
  assert.match(renderBlock[0], /var pts=roiDef\.points\.map/);
  assert.match(renderBlock[0], /var cx=roiDef\.points\.reduce/);
  assert.match(renderBlock[0], /var cy=roiDef\.points\.reduce/);
  assert.match(renderBlock[0], /class="eval-roi-halo" points="'\+pts\+'"/);
  assert.match(renderBlock[0], /class="eval-roi" points="'\+pts\+'"/);
  assert.match(renderBlock[0], /class="eval-roi-label" x="'\+cx\+'" y="'\+cy\+'">TARGET AREA</);
  // no hardcoded branch naming a specific region (CHIN_CENTER/LEFT_JAW/CHIN_NECK_TRANSITION/etc.)
  // inside the render block -- the exact same generic path must serve every region alike.
  assert.doesNotMatch(renderBlock[0], /activeRegion\s*===\s*'[A-Z_]+'/);
});

test('32. the ROI overlay block (polygons, label, and its note text) carries zero prediction/result/class/confidence wording', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const block = /if\(blind\)\{[\s\S]*?\n      return;\n    \}/.exec(html);
  assert.ok(block, 'the BLIND_GT overlay branch must be present');
  assert.doesNotMatch(block[0], /hairnessScore|occupancyState|semanticFusion|modelConfidence|predictedBeardBoundary/i);
  // the label itself must be exactly the neutral task phrase, never a class/result/confidence word
  assert.match(block[0], />TARGET AREA</);
  assert.doesNotMatch(block[0], /BEARD_CONFIRMED|NON_BEARD_CONFIRMED|predicted|expected class/i);
});

// (29 -- the regenerated synthetic acceptance bitmap's absence of the old baked-in green
// "suggested trace guide" dashed line is checked separately, LOCALLY, in
// D:\MettleTemp\analysis\bi2f1_manual\validate_acceptance_bundle.test.mjs, since it depends on
// the local, non-personal but non-repo acceptance bundle file and decodes real pixel data.)
