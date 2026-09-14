// Stage BI-1Z1A.1 — regression tests for the real interactive "Generate proposal does nothing"
// bug: index.html's REVIEW_TARGET was a single hardcoded 'VISIBLE_BEARD_SILHOUETTE' constant left
// over from BI-1Y2 (when every bundle had exactly one possible review target). BI-1Z1A introduced
// a second target (VISIBLE_LOWER_BEARD_SILHOUETTE); every function that still used the hardcoded
// constant kept attaching/reading proposals under the WRONG target key for a BI-1Z1A bundle, so a
// correctly-generated proposal was silently invisible. Root cause was proven (not guessed) via a
// real headless-Chrome CDP session against the actual bundle file (see the BI-1Z1A.1 report) —
// that session also confirmed, post-fix, that all 8 real frames generate proposals correctly and
// that frames B (obs2) / C (obs4) produce byte-identical geometry (otsuThreshold 130/140,
// simplified point counts 185/137) to the original BI-1Z1A bake-off, proving the algorithm itself
// was never touched. Those two facts require a live browser + real JPEGs and are NOT re-encoded
// here (this repo has no Puppeteer/Playwright); this file covers everything provable with pure
// Node + static source-text checks, per this project's established testing convention.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import AWB from './annotation-workbench.cjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKBENCH_INDEX_HTML = readFileSync(join(HERE, 'index.html'), 'utf8');
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwAEhgGAWjR9awAAAABJRU5ErkJggg==';

// ---- 1: the old hardcoded constant is completely gone -------------------------------------
test('1: no reference to the old hardcoded REVIEW_TARGET constant remains anywhere in the workbench', () => {
  assert.equal(/\bREVIEW_TARGET\b/.test(WORKBENCH_INDEX_HTML), false);
});

// ---- 2: generateProposal takes the target as an explicit parameter, sourced from the real
// clicked button's own data-t, not a shared/hardcoded constant --------------------------------
test('2: generateProposal is declared with an explicit target parameter', () => {
  assert.match(WORKBENCH_INDEX_HTML, /function generateProposal\(e, target\)\{/);
});
test('3: onReviewButton passes the clicked button\'s own data-t straight into generateProposal (the exact fix for the reported bug)', () => {
  // BI-2F0 added a BLIND_GT early-return guard in front of this same call (machine proposals are
  // never generated for a blind bundle) -- the fix this test protects (passing the button's own
  // `t`, not a stale/shared constant, into generateProposal) is unchanged and still present.
  assert.match(WORKBENCH_INDEX_HTML, /if\(act==='generate'\)\{[\s\S]*?generateProposal\(e, t\); return; \}/);
});
test('4: onReviewButton keeps a shared "active target" in sync with every per-target button click, for the non-button code paths (Add-point, magnifier, keyboard) that have no data-t of their own', () => {
  assert.match(WORKBENCH_INDEX_HTML, /if\(t\) activeReviewTarget=t;/);
});
test('5: render() only resets the active target when it is invalid for the CURRENT entry -- never clobbers an explicit in-entry choice mid-interaction, and correctly resets on navigation to a different image', () => {
  const m = WORKBENCH_INDEX_HTML.match(/if\(e && Array\.isArray\(e\.assistedReviewTargets\) && e\.assistedReviewTargets\.indexOf\(activeReviewTarget\)===-1\)\{\s*\n\s*activeReviewTarget = e\.assistedReviewTargets\[0\] \|\| null;\s*\n\s*\}/);
  assert.ok(m, 'render() must reset activeReviewTarget only when it is not one of the current entry\'s own targets');
});
test('6: the Add-point click-to-insert handler, the magnifier, and the keyboard delete/nudge handlers all read the shared activeReviewTarget (not a stale/wrong hardcoded value)', () => {
  assert.match(WORKBENCH_INDEX_HTML, /reviewState\.byEntry\[key\] && reviewState\.byEntry\[key\]\.targets\[activeReviewTarget\]/);
  assert.match(WORKBENCH_INDEX_HTML, /A\.addHandlePoint\(reviewState,key,activeReviewTarget,bestI,p\.x,p\.y\)/);
  assert.match(WORKBENCH_INDEX_HTML, /curReviewRecord\(\); var inst=rec\.targets\[activeReviewTarget\]/);
  assert.match(WORKBENCH_INDEX_HTML, /A\.deleteHandlePoint\(reviewState,key0,activeReviewTarget,selectedHandle\)/);
  assert.match(WORKBENCH_INDEX_HTML, /A\.nudgeHandlePoint\(reviewState,key,activeReviewTarget,selectedHandle,dx,dy\)/);
});

// ---- 7: user feedback -- the button must never silently do nothing (Part 4) ------------------
test('7: every generateProposal failure branch shows a distinct, clear "Proposal generation failed: ..." toast, and success shows a distinct "Proposal generated" toast -- never silent either way', () => {
  const start = WORKBENCH_INDEX_HTML.indexOf('function generateProposal');
  const end = WORKBENCH_INDEX_HTML.indexOf('function renderReview(', start);
  const body = WORKBENCH_INDEX_HTML.slice(start, end);
  assert.match(body, /toast\('Proposal generation failed: no review target for this image\.'\)/);
  assert.match(body, /toast\('Proposal generation failed: image pixels unavailable/);
  assert.match(body, /toast\('Proposal generation failed: no beard region found/);
  assert.match(body, /toast\('Proposal generated \('\+handles\.length\+' points\)/);
});
test('8: generateProposal fails closed (does not attach a proposal) when called with no target', () => {
  const start = WORKBENCH_INDEX_HTML.indexOf('function generateProposal');
  const firstBrace = WORKBENCH_INDEX_HTML.indexOf('{', start);
  const nextLine = WORKBENCH_INDEX_HTML.slice(firstBrace, firstBrace + 200);
  assert.match(nextLine, /if\(!target\)\{ toast\('Proposal generation failed: no review target for this image\.'\); return; \}/);
});

// ---- 9/10: proposal attachment correctness with the real (dynamic) target, and no cross-target
// / cross-entry contamination -----------------------------------------------------------------
function entryWithTarget(target, overrides) {
  return Object.assign({
    schemaVersion: 'annotation-bundle/1', identityMode: 'RAW_SCAN_OBSERVATION', sourceScanObservationId: null,
    scanSessionId: 'scan_wiring_test', nativeFrameTimestampNs: '1', rawObservationId: 0, adapterRetained: false,
    imageRef: 'scan_wiring_test:raw:0:ts1', poseId: 'front', observedPoseRegion: 'FRONT_REGION', currentScannerStep: 'front',
    yawDeg: 0, pitchDeg: 0, rollDeg: 0, imageWidth: 100, imageHeight: 100, regionsToAnnotate: [], contourTypesToAnnotate: [],
    assistedReviewTargets: [target], rawImagePayload: TINY_PNG, rawImageFormat: 'data-url',
    rawImageStorageScope: 'LOCAL_ANNOTATION_BUNDLE', bundleImageStatus: 'INCLUDED_FOR_ANNOTATION', outcome: 'RESOLVED'
  }, overrides || {});
}
test('9: attaching a proposal under the CORRECT (entry-requested) target makes it visible to that entry\'s own target lookup -- the exact behavior the bug broke', () => {
  const bundle = { schemaVersion: 'annotation-bundle/1', bundleId: 'x', datasetId: 'x', datasetRevision: 1, entries: [entryWithTarget('VISIBLE_LOWER_BEARD_SILHOUETTE')] };
  const e = bundle.entries[0];
  const key = AWB.entryKey(e);
  let state = AWB.initAssistedReviewState(bundle);
  // simulate the FIXED call: target is the entry's own requested target, not a hardcoded constant
  const target = e.assistedReviewTargets[0];
  state = AWB.attachProposal(state, key, target, {
    algorithm: 'beard-proposal-otsu-prior-hybrid', algorithmVersion: 'beard-proposal/1', parameters: {},
    generatedAt: null, originalProposalPoints: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }], handlePoints: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }]
  });
  const rec = state.byEntry[key];
  assert.ok(rec.targets[e.assistedReviewTargets[0]].originalProposalPoints, 'the entry\'s own requested target must have the proposal attached');
  assert.equal(rec.targets[e.assistedReviewTargets[0]].humanFinalPoints.length, 3);
});
test('10: two different entries (and two different targets) never cross-contaminate each other\'s proposal state', () => {
  const bundle = {
    schemaVersion: 'annotation-bundle/1', bundleId: 'x', datasetId: 'x', datasetRevision: 1,
    entries: [
      entryWithTarget('VISIBLE_LOWER_BEARD_SILHOUETTE', { rawObservationId: 0, nativeFrameTimestampNs: '1', imageRef: 'scan_wiring_test:raw:0:ts1' }),
      entryWithTarget('VISIBLE_BEARD_SILHOUETTE', { rawObservationId: 1, nativeFrameTimestampNs: '2', imageRef: 'scan_wiring_test:raw:1:ts2' })
    ]
  };
  const e0 = bundle.entries[0], e1 = bundle.entries[1];
  const k0 = AWB.entryKey(e0), k1 = AWB.entryKey(e1);
  let state = AWB.initAssistedReviewState(bundle);
  state = AWB.attachProposal(state, k0, 'VISIBLE_LOWER_BEARD_SILHOUETTE', {
    algorithm: 'a', algorithmVersion: 'v1', parameters: {}, generatedAt: null,
    originalProposalPoints: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }], handlePoints: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }]
  });
  // entry 1 (a different entry, requesting a DIFFERENT target) must remain completely untouched
  const rec1 = state.byEntry[k1];
  assert.equal(rec1.targets['VISIBLE_BEARD_SILHOUETTE'].originalProposalPoints, null);
  assert.equal(rec1.targets['VISIBLE_LOWER_BEARD_SILHOUETTE'], undefined, 'entry 1 never requested this target and must not have gained one');
  // entry 0's OWN other/unrequested target key must also never have been created as a side effect
  assert.equal(state.byEntry[k0].targets['VISIBLE_BEARD_SILHOUETTE'], undefined, 'attachProposal must not create a stray target entry never requested by this entry');
});

// ---- 11: hide/show + jaw-diagnostic default-state code paths are wired to the fixed target too
test('11: renderReviewOverlay\'s proposal-visibility and jaw-diagnostic logic are unaffected by this fix (still gated on hideProposal/showJawDiagnostic, never on activeReviewTarget)', () => {
  assert.match(WORKBENCH_INDEX_HTML, /if\(!hideProposal && Array\.isArray\(inst\.originalProposalPoints\)/);
  assert.match(WORKBENCH_INDEX_HTML, /if\(showJawDiagnostic && Array\.isArray\(e\.jawDiagnosticLandmarks\)\)/);
});

// ---- 12: overlay redraw is still invoked at the end of a successful generation --------------
test('12: generateProposal still calls render() (which redraws #reviewOverlay) after a successful attach, and only after attaching -- never before', () => {
  const start = WORKBENCH_INDEX_HTML.indexOf('function generateProposal');
  const end = WORKBENCH_INDEX_HTML.indexOf('function renderReview(', start);
  const body = WORKBENCH_INDEX_HTML.slice(start, end);
  const attachIdx = body.indexOf('A.attachProposal(reviewState,key,target');
  const renderIdx = body.indexOf('render();');
  assert.ok(attachIdx > -1 && renderIdx > attachIdx, 'render() must be called after attachProposal, never before');
});

// ---- 13-16: unchanged invariants re-affirmed (full detail already covered by the existing
// bi1z1a-fresh-exact-frame-lower-beard.test.mjs suite, which still passes byte-identically) ---
test('13: ASSISTED_REVIEW_TARGETS and the landmark-ROI-first proposal-source priority are untouched by this bugfix', () => {
  assert.deepEqual(AWB.ASSISTED_REVIEW_TARGETS, Object.freeze(['VISIBLE_BEARD_SILHOUETTE', 'VISIBLE_LOWER_BEARD_SILHOUETTE']));
  const start = WORKBENCH_INDEX_HTML.indexOf('function generateProposal');
  const end = WORKBENCH_INDEX_HTML.indexOf('function renderReview(', start);
  const body = WORKBENCH_INDEX_HTML.slice(start, end);
  assert.match(body, /TRACKED_LOWER_FACE_LANDMARK_ROI/);
  assert.ok(body.indexOf('e.landmarkRoi') < body.indexOf('hintPolys.length'));
});
