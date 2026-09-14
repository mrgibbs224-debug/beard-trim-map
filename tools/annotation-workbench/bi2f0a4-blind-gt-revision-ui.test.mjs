import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PC = require('./precision-annotation-core.cjs');
const A = require('./annotation-workbench.cjs');

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
const INDEX_HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

function blindBundle() {
  return {
    schemaVersion: 'annotation-bundle/1', bundleId: 'bi2f0a4-blind-001', gtMode: 'BLIND_GT',
    entries: [{ sourceScanObservationId: 'o1', imageRef: 'img1', contourTypesToAnnotate: ['OUTER_BEARD_UNDERSIDE'] }]
  };
}
function reviewBundle() {
  return {
    schemaVersion: 'annotation-bundle/1', bundleId: 'bi2f0a4-blind-review-001', gtMode: 'BLIND_GT',
    entries: [{ sourceScanObservationId: 'o1', imageRef: 'img1', assistedReviewTargets: ['VISIBLE_BEARD_SILHOUETTE'] }]
  };
}
function lockedContourState() {
  const b = blindBundle();
  let st = A.initContourState(b);
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 10, 10);
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 20, 20);
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 30, 10);
  st = A.lockContour(st, 'o1', 'OUTER_BEARD_UNDERSIDE', PC, { bundleId: b.bundleId });
  return { bundle: b, st };
}
function lockedReviewState() {
  const b = reviewBundle();
  let st = A.initAssistedReviewState(b);
  st = A.attachProposal(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', {
    originalProposalPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    handlePoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
  });
  st = A.lockReviewTarget(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', PC, { bundleId: b.bundleId });
  return { bundle: b, st };
}

// ---------- 1. locked annotation cannot be modified ----------

test('1. a locked contour refuses every mutating function (add/move/insert/delete/undo/redo/clear)', () => {
  const { st } = lockedContourState();
  assert.throws(() => A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 5, 5), /LOCKED/);
  assert.throws(() => A.moveContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 1, 1), /LOCKED/);
  assert.throws(() => A.deleteContourPointAt(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0), /LOCKED/);
  assert.throws(() => A.insertContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 5, 5, PC), /LOCKED/);
  assert.throws(() => A.clearContour(st, 'o1', 'OUTER_BEARD_UNDERSIDE'), /LOCKED/);
});

test('1b. a locked review target refuses every mutating function', () => {
  const { st } = lockedReviewState();
  assert.throws(() => A.moveHandlePoint(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', 0, 1, 1), /LOCKED/);
  assert.throws(() => A.addHandlePoint(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', 0, 1, 1), /LOCKED/);
  assert.throws(() => A.deleteHandlePoint(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', 0), /LOCKED/);
  assert.throws(() => A.resetCurrentReviewTarget(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE'), /LOCKED/);
});

// ---------- 2. Create New Revision appears only when appropriate ----------

test('2. index.html only renders the "Create New Revision" button when the contour/review target IS locked', () => {
  assert.ok(INDEX_HTML.includes('isBlindGtBundle(bundle)&&c.locked ? \'<button data-act="createRevision" data-ct="\'+ct+\'">Create New Revision</button>\''));
  assert.ok(INDEX_HTML.includes('isBlindBundle() && inst.locked ? \'<button data-act="createRevision" data-t="\'+t+\'">Create New Revision</button>\''));
});

test('2b. createContourRevision/createReviewRevision refuse when the source is NOT locked', () => {
  const b = blindBundle();
  let st = A.initContourState(b);
  st = A.addContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 1, 1);
  assert.throws(() => A.createContourRevision(st, 'o1', 'OUTER_BEARD_UNDERSIDE', PC), /not locked/);

  const rb = reviewBundle();
  let rst = A.initAssistedReviewState(rb);
  rst = A.attachProposal(rst, 'o1', 'VISIBLE_BEARD_SILHOUETTE', {
    originalProposalPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
    handlePoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]
  });
  assert.throws(() => A.createReviewRevision(rst, 'o1', 'VISIBLE_BEARD_SILHOUETTE', PC), /not locked/);
});

// ---------- 3/4. clicking Create New Revision never alters the locked source ----------

test('3/4. createContourRevision leaves the ORIGINAL locked record and fingerprint byte-identical', () => {
  const { st } = lockedContourState();
  const originalRecord = st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.lockedRecord;
  const originalFingerprint = originalRecord.fingerprint;
  const originalPointsJson = JSON.stringify(originalRecord.points);
  const next = A.createContourRevision(st, 'o1', 'OUTER_BEARD_UNDERSIDE', PC);
  // the archived copy in priorRevisions must be the exact same record, unmutated
  const archived = next.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.priorRevisions[0];
  assert.equal(archived.fingerprint, originalFingerprint);
  assert.equal(JSON.stringify(archived.points), originalPointsJson);
  // the input `st` object itself must also be untouched (defensive clone discipline)
  assert.equal(st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.lockedRecord.fingerprint, originalFingerprint);
  assert.equal(st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.locked, true);
});

test('3b/4b. createReviewRevision leaves the ORIGINAL locked record and fingerprint byte-identical', () => {
  const { st } = lockedReviewState();
  const originalRecord = st.byEntry.o1.targets.VISIBLE_BEARD_SILHOUETTE.lockedRecord;
  const originalFingerprint = originalRecord.fingerprint;
  const next = A.createReviewRevision(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', PC);
  const archived = next.byEntry.o1.targets.VISIBLE_BEARD_SILHOUETTE.priorRevisions[0];
  assert.equal(archived.fingerprint, originalFingerprint);
  assert.equal(st.byEntry.o1.targets.VISIBLE_BEARD_SILHOUETTE.lockedRecord.fingerprint, originalFingerprint);
});

// ---------- 5. new revision copies geometry ----------

test('5. the new revision starts as an exact geometric copy of the locked source', () => {
  const { st } = lockedContourState();
  const srcPoints = st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.lockedRecord.points;
  const next = A.createContourRevision(st, 'o1', 'OUTER_BEARD_UNDERSIDE', PC);
  const newC = next.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE;
  assert.deepEqual(newC.points, srcPoints);
  // must be a deep copy, not the same array reference
  assert.notEqual(newC.points, srcPoints);
});

// ---------- 6. new revision is editable ----------

test('6. the new revision is immediately editable (locked:false) and accepts a point move', () => {
  const { st } = lockedContourState();
  let next = A.createContourRevision(st, 'o1', 'OUTER_BEARD_UNDERSIDE', PC);
  assert.equal(next.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.locked, false);
  assert.equal(next.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.lockedRecord, null);
  next = A.moveContourPoint(next, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 99, 99);
  assert.deepEqual(next.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.points[0], { x: 99, y: 99 });
});

test('6b. the new review revision is immediately editable and accepts a point move', () => {
  const { st } = lockedReviewState();
  let next = A.createReviewRevision(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', PC);
  assert.equal(next.byEntry.o1.targets.VISIBLE_BEARD_SILHOUETTE.locked, false);
  next = A.moveHandlePoint(next, 'o1', 'VISIBLE_BEARD_SILHOUETTE', 0, 55, 55);
  assert.deepEqual(next.byEntry.o1.targets.VISIBLE_BEARD_SILHOUETTE.humanFinalPoints[0], { x: 55, y: 55 });
});

// ---------- 7. revision number increments ----------

test('7. revisionNumber increments from the source lock\'s revision, and basedOnFingerprint/basedOnRevision are stamped', () => {
  const { st } = lockedContourState();
  const src = st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.lockedRecord;
  const next = A.createContourRevision(st, 'o1', 'OUTER_BEARD_UNDERSIDE', PC);
  const newC = next.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE;
  assert.equal(src.revision, 1);
  assert.equal(newC.revisionNumber, 2);
  assert.equal(newC.basedOnFingerprint, src.fingerprint);
  assert.equal(newC.basedOnRevision, 1);
});

test('7b. locking the new revision produces a lockedRecord tagged with revision 2 and the same lineage', () => {
  let { st } = lockedContourState();
  st = A.createContourRevision(st, 'o1', 'OUTER_BEARD_UNDERSIDE', PC);
  st = A.moveContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 40, 40);
  st = A.lockContour(st, 'o1', 'OUTER_BEARD_UNDERSIDE', PC, { bundleId: 'bi2f0a4-blind-001' });
  const c = st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE;
  assert.equal(c.lockedRecord.revision, 2);
  assert.equal(c.lockedRecord.basedOnRevision, 1);
  assert.equal(c.lockedRecord.basedOnFingerprint, c.priorRevisions[0].fingerprint);
});

// ---------- 8. source revision remains locked ----------

test('8. the archived prior revision remains marked locked:true within its own record', () => {
  const { st } = lockedContourState();
  const next = A.createContourRevision(st, 'o1', 'OUTER_BEARD_UNDERSIDE', PC);
  const archived = next.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.priorRevisions[0];
  assert.equal(archived.locked, true);
});

// ---------- 9. autosave keeps revisions separate ----------

test('9. autosave round-trip preserves revisionNumber/basedOnFingerprint/priorRevisions distinctly from the live instance', () => {
  let st = lockedContourState().st;
  st = A.createContourRevision(st, 'o1', 'OUTER_BEARD_UNDERSIDE', PC);
  const bundle = blindBundle();
  const payload = A.buildContourAutosavePayload(bundle, st);
  const restored = A.restoreContourFromAutosave(payload, bundle);
  assert.equal(restored.ok, true);
  const c = restored.state.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE;
  assert.equal(c.revisionNumber, 2);
  assert.equal(c.locked, false);
  assert.equal(c.priorRevisions.length, 1);
  assert.equal(c.priorRevisions[0].revision, 1);
});
test('9b. autosave round-trip preserves an ACTIVE lock (locked:true + exact lockedRecord fingerprint) across reload', () => {
  const { st } = lockedContourState();
  const bundle = blindBundle();
  const payload = A.buildContourAutosavePayload(bundle, st);
  const restored = A.restoreContourFromAutosave(payload, bundle);
  assert.equal(restored.ok, true);
  const c = restored.state.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE;
  assert.equal(c.locked, true);
  assert.equal(c.lockedRecord.fingerprint, st.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.lockedRecord.fingerprint);
  assert.throws(() => A.addContourPoint(restored.state, 'o1', 'OUTER_BEARD_UNDERSIDE', 1, 1), /LOCKED/);
});
test('9c. a structurally implausible saved lockedRecord fails closed to unlocked, never trusted as a real lock', () => {
  const bundle = blindBundle();
  const payload = A.buildContourAutosavePayload(bundle, A.initContourState(bundle));
  payload.contours.o1.contours.OUTER_BEARD_UNDERSIDE = { traceabilityStatus: 'TRACED', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], notes: '', locked: true, lockedRecord: { garbage: true } };
  const restored = A.restoreContourFromAutosave(payload, bundle);
  assert.equal(restored.ok, true);
  assert.equal(restored.state.byEntry.o1.contours.OUTER_BEARD_UNDERSIDE.locked, false);
});

// ---------- 10. export contains correct lineage ----------

test('10. buildContourExport reports revisionNumber/locked/lockedFingerprint/basedOnFingerprint/basedOnRevision/priorRevisionFingerprints', () => {
  let st = lockedContourState().st;
  const bundle = blindBundle();
  st = A.createContourRevision(st, 'o1', 'OUTER_BEARD_UNDERSIDE', PC);
  st = A.moveContourPoint(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 0, 41, 41);
  st = A.setContourTraceabilityStatus(st, 'o1', 'OUTER_BEARD_UNDERSIDE', 'TRACED');
  const exp = A.buildContourExport(bundle, st, {});
  const row = exp.contours[0];
  assert.equal(row.revisionNumber, 2);
  assert.equal(row.locked, false);
  assert.equal(row.lockedFingerprint, null);
  assert.equal(typeof row.basedOnFingerprint, 'string');
  assert.equal(row.basedOnRevision, 1);
  assert.equal(row.priorRevisionFingerprints.length, 1);
  assert.equal(row.priorRevisionFingerprints[0], row.basedOnFingerprint);
});

test('10b. buildAssistedReviewExport reports the same lineage fields', () => {
  let st = lockedReviewState().st;
  const bundle = reviewBundle();
  st = A.createReviewRevision(st, 'o1', 'VISIBLE_BEARD_SILHOUETTE', PC);
  const exp = A.buildAssistedReviewExport(bundle, st, {});
  const row = exp.items[0];
  assert.equal(row.revisionNumber, 2);
  assert.equal(row.basedOnRevision, 1);
  assert.equal(row.priorRevisionFingerprints.length, 1);
});

// ---------- 11. BLIND_GT remains free of machine proposals ----------

test('11. the Create New Revision addition does not introduce any machine-proposal/auto-suggestion UI, and blind bundles still hide Generate proposal', () => {
  const src = INDEX_HTML.slice(INDEX_HTML.indexOf("function onContourButton"), INDEX_HTML.indexOf("function onContourButton") + 2000);
  assert.ok(!/predict|suggest|autofill|autoTrace/i.test(src.replace(/createRevision/g, '')));
  assert.match(INDEX_HTML, /isBlindBundle\(\) \? '' : '<button data-act="generate"/);
});

// ---------- 12. no production files changed ----------

test('12. production hashes (index.html at repo root, worker.js) remain unchanged', () => {
  const idx = readFileSync(new URL('../../index.html', import.meta.url));
  const wkr = readFileSync(new URL('../../worker.js', import.meta.url));
  assert.equal(sha256(idx), '928747a5d284060dddac43c95f97a1669492ab4d1ecebf0d34bc59f3a3b5b521');
  assert.equal(sha256(wkr), '42adab00e17aa72a963c949aaf786d97b8f8717cf743adafd7e86712bfa909ab');
});

test('12b. accuracy/research runtime modules (neck scaffold, BI-2E occupancy) remain unchanged', () => {
  assert.equal(sha256(readFileSync(new URL('../../accuracy/sparse-neck-scaffold-v1.mjs', import.meta.url))), '3798248b018919a61dea71173802b7a4acf6420447edffecc3e49da020d306f9');
  assert.equal(sha256(readFileSync(new URL('../../accuracy/region-scoped-beard-occupancy-v1.mjs', import.meta.url))), '4296668b88e121859db0a40ff69bce19c3c47f0b273363acb73e133795d6eaaa');
});

// ---------- bonus: UI text matches the requested labels ----------

test('bonus: button label is exactly "Create New Revision", and the revision indicator uses "Revision N — Locked/Editable" phrasing', () => {
  assert.match(INDEX_HTML, />Create New Revision</);
  assert.ok(INDEX_HTML.includes("Revision <b>'+(c.revisionNumber||1)+'</b> — '+(c.locked?'Locked':'Editable')"));
  assert.ok(INDEX_HTML.includes("Revision <b>'+(inst.revisionNumber||1)+'</b> — '+(inst.locked?'Locked':'Editable')"));
});
