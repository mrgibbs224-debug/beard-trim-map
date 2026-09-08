// Manual ground-truth dataset assembler — PURE, ISOLATED
// Stage BS1-F. Zero dependencies beyond sibling accuracy/ modules. No model, no pixels, no I/O.
//
// PURPOSE
//   Turn verified BS1-C scan observations + human/manual annotation records into strictly
//   aligned MANUAL_GROUND_TRUTH SemanticHairObservations (BS1-D contract) and BS1-E
//   evaluation entries. The central rule: a ground-truth label is bound to the EXACT
//   observation it labels — identity is `sourceScanObservationId + anatomicalRegion`. There
//   is NO fuzzy matching by array index, nearest image, nearest pose, nearest timestamp, or
//   filename. Conflicting identity metadata rejects the label.
//
//   AMBIGUOUS / UNKNOWN / NEEDS_REVIEW / EXCLUDED labels never become scored ground truth
//   and are never treated as NON_BEARD. All test fixtures are synthetic annotation RECORDS —
//   no photographs, no pixels, no segmentation.

import {
  HairState, ObservationMethod, SCAN_POSES, isKnownRegion, clamp01OrNull
} from './beard-surface-core.mjs';
import { SyncStatus, ObservationPayloadKind } from './multi-observation-scan-package.mjs';
import { makeSemanticHairObservation, SEMANTIC_HAIR_EVIDENCE_VERSION } from './semantic-hair-evidence.mjs';
import { SUPPORTED_REGIONS } from './beard-anatomy-map.mjs';

export const GROUND_TRUTH_DATASET_VERSION = 'ground-truth-dataset/1';

/** Human annotation status. AMBIGUOUS / UNKNOWN is NOT NON_BEARD. */
export const AnnotationStatus = Object.freeze({
  LABELED: 'LABELED',           // definitive human label
  AMBIGUOUS: 'AMBIGUOUS',       // annotator could not decide / conflicting evidence
  NEEDS_REVIEW: 'NEEDS_REVIEW', // flagged for a second pass — not definitive
  EXCLUDED: 'EXCLUDED',         // deliberately removed from the dataset
  UNKNOWN: 'UNKNOWN'            // status not supplied
});

/** Why a label failed strict identity validation against the scan package. */
export const LabelRejectReason = Object.freeze({
  UNKNOWN_OBSERVATION: 'UNKNOWN_OBSERVATION',
  IDENTITY_CONFLICT: 'IDENTITY_CONFLICT',
  NOT_IMAGE_BACKED: 'NOT_IMAGE_BACKED',
  SYNC_BELOW_EXACT: 'SYNC_BELOW_EXACT',
  UNKNOWN_REGION: 'UNKNOWN_REGION',
  UNKNOWN_POSE: 'UNKNOWN_POSE'
});

export const DuplicateOutcome = Object.freeze({
  DEDUP_IDENTICAL: 'DEDUP_IDENTICAL',
  CONFLICT_PRESERVED: 'CONFLICT_PRESERVED'
});

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round4 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : x);
const safeDiv = (n, d) => (typeof d === 'number' && d > 0 ? round4(n / d) : null);
const labelKey = (l) => `${l.sourceScanObservationId} ${l.anatomicalRegion}`;

// ---------------------------------------------------------------------------
// GroundTruthLabel
// ---------------------------------------------------------------------------
export function makeGroundTruthLabel(spec = {}) {
  const {
    labelId = null,
    scanSessionId = null,
    sourceScanObservationId = null,
    imageRef = null,
    nativeFrameTimestampNs = null,
    poseId = null,
    observedPoseRegion = null,
    anatomicalRegion,
    hairState = HairState.UNKNOWN,
    annotationStatus = AnnotationStatus.UNKNOWN,
    annotationConfidence = null,
    syncStatus = null,
    revision = null,
    supersedesLabelId = null,
    annotatorId = null,          // opaque; never required, never PII
    notes = null
  } = spec;

  if (!Object.values(HairState).includes(hairState)) {
    throw new Error(`makeGroundTruthLabel: unknown hairState "${hairState}"`);
  }
  if (!Object.values(AnnotationStatus).includes(annotationStatus)) {
    throw new Error(`makeGroundTruthLabel: unknown annotationStatus "${annotationStatus}"`);
  }

  return Object.freeze({
    groundTruthDatasetVersion: GROUND_TRUTH_DATASET_VERSION,
    labelId,
    scanSessionId,
    sourceScanObservationId,
    imageRef: typeof imageRef === 'string' ? imageRef : ((imageRef && imageRef.ref) || null),
    nativeFrameTimestampNs: numOrNull(nativeFrameTimestampNs),
    poseId: poseId || null,
    observedPoseRegion: observedPoseRegion || null,
    anatomicalRegion: anatomicalRegion != null ? anatomicalRegion : null,
    hairState,
    annotationStatus,
    // confidence and status are SEPARATE — a high-confidence UNKNOWN label is still UNKNOWN.
    annotationConfidence: clamp01OrNull(annotationConfidence),
    syncStatus: syncStatus || null,
    sourceMethod: ObservationMethod.MANUAL_GROUND_TRUTH, // always
    revision: numOrNull(revision),
    supersedesLabelId,
    annotatorId: annotatorId != null ? String(annotatorId) : null,
    notes: notes != null ? String(notes) : null
  });
}

// ---------------------------------------------------------------------------
// Scan-package index + strict identity validation
// ---------------------------------------------------------------------------
function indexScanPackage(scanPackage) {
  const byId = new Map();
  const scanSessionIds = new Set();
  const poses = scanPackage && scanPackage.posePackages ? scanPackage.posePackages : {};
  for (const p of Object.values(poses)) {
    for (const o of [...p.retainedImageObservations, ...p.retainedGeometryObservations]) {
      byId.set(o.observationId, o);
      const sid = o.metadata && o.metadata.scannerSessionId;
      if (sid) scanSessionIds.add(sid);
    }
  }
  const pkgSid = scanPackage && scanPackage.scanSessionId;
  if (pkgSid) scanSessionIds.add(pkgSid);
  return { byId, scanSessionIds: [...scanSessionIds].sort() };
}

/**
 * Validate ONE GroundTruthLabel against a MultiObservationScanPackage (or a BS1-C bundle's
 * `.scanPackage`). Strict by default.
 *
 * options: { requireImageBacked=true, allowNonImageGroundTruth=false, requireExactSync=false,
 *            timestampToleranceNs=null }
 */
export function validateLabelAgainstScanPackage(label, scanPackage, options = {}) {
  const {
    requireImageBacked = true,
    allowNonImageGroundTruth = false,
    requireExactSync = false,
    timestampToleranceNs = null,
    _index = null
  } = options;
  const idx = _index || indexScanPackage(scanPackage);

  if (!isKnownRegion(label.anatomicalRegion)) {
    return reject(LabelRejectReason.UNKNOWN_REGION, `unknown region "${label.anatomicalRegion}"`);
  }
  if (label.poseId != null && !SCAN_POSES.includes(label.poseId)) {
    return reject(LabelRejectReason.UNKNOWN_POSE, `unknown poseId "${label.poseId}"`);
  }
  const obs = idx.byId.get(label.sourceScanObservationId);
  if (!obs) return reject(LabelRejectReason.UNKNOWN_OBSERVATION, `no scan observation "${label.sourceScanObservationId}"`);

  // strict identity — only compare fields the label actually supplied
  const obsImageRef = obs.imageRef && obs.imageRef.ref ? obs.imageRef.ref : null;
  if (label.imageRef && obsImageRef && label.imageRef !== obsImageRef) {
    return reject(LabelRejectReason.IDENTITY_CONFLICT, 'imageRef', obs);
  }
  if (label.poseId && obs.poseId && label.poseId !== obs.poseId) {
    return reject(LabelRejectReason.IDENTITY_CONFLICT, 'poseId', obs);
  }
  const obsTs = obs.timestamp ? numOrNull(obs.timestamp.nativeFrameTimestampNs) : null;
  if (label.nativeFrameTimestampNs != null && obsTs != null) {
    const d = Math.abs(label.nativeFrameTimestampNs - obsTs);
    if (d !== 0 && (!(typeof timestampToleranceNs === 'number' && Number.isFinite(timestampToleranceNs)) || d > timestampToleranceNs)) {
      return reject(LabelRejectReason.IDENTITY_CONFLICT, 'nativeFrameTimestampNs', obs);
    }
  }
  const obsSid = obs.metadata && obs.metadata.scannerSessionId;
  if (label.scanSessionId && obsSid && label.scanSessionId !== obsSid) {
    return reject(LabelRejectReason.IDENTITY_CONFLICT, 'scanSessionId', obs);
  }

  const payloadKind = obs.payloadKind || ObservationPayloadKind.UNKNOWN;
  const imageBacked = payloadKind === ObservationPayloadKind.IMAGE_AND_GEOMETRY ||
    payloadKind === ObservationPayloadKind.IMAGE_INCOMPLETE_METADATA;
  if (requireImageBacked && !allowNonImageGroundTruth && !imageBacked) {
    return reject(LabelRejectReason.NOT_IMAGE_BACKED, `payloadKind ${payloadKind} is not image-backed`, obs);
  }
  if (requireExactSync && obs.syncStatus !== SyncStatus.EXACT_SYNCHRONIZED) {
    return reject(LabelRejectReason.SYNC_BELOW_EXACT, `syncStatus ${obs.syncStatus}`, obs);
  }

  return Object.freeze({ valid: true, reason: null, detail: null, sourceObservation: obs, payloadKind });

  function reject(reason, detail, sourceObservation = null) {
    return Object.freeze({ valid: false, reason, detail, sourceObservation, payloadKind: sourceObservation ? (sourceObservation.payloadKind || null) : null });
  }
}

// ---------------------------------------------------------------------------
// Label → BS1-D SemanticHairObservation (MANUAL_GROUND_TRUTH)
// ---------------------------------------------------------------------------
export function groundTruthLabelToSemanticObservation(label, sourceObservation, options = {}) {
  const { synthetic = true, anatomySupport = SUPPORTED_REGIONS } = options;
  const geomSupported = anatomySupport
    ? (typeof anatomySupport.includes === 'function' ? anatomySupport.includes(label.anatomicalRegion)
      : (typeof anatomySupport.has === 'function' ? anatomySupport.has(label.anatomicalRegion) : !!anatomySupport[label.anatomicalRegion]))
    : null;
  const syncStatus = sourceObservation ? (sourceObservation.syncStatus || SyncStatus.UNKNOWN) : (label.syncStatus || SyncStatus.UNKNOWN);

  return makeSemanticHairObservation({
    observationId: `gt:${label.sourceScanObservationId}:${label.anatomicalRegion}:${label.labelId != null ? label.labelId : (label.revision != null ? 'r' + label.revision : '0')}`,
    sourceScanObservationId: label.sourceScanObservationId,
    imageRef: label.imageRef || (sourceObservation && sourceObservation.imageRef && sourceObservation.imageRef.ref) || null,
    poseId: label.poseId || (sourceObservation && sourceObservation.poseId) || null,
    observedPoseRegion: label.observedPoseRegion || (sourceObservation && sourceObservation.observedPoseRegion) || null,
    nativeFrameTimestampNs: label.nativeFrameTimestampNs != null ? label.nativeFrameTimestampNs
      : (sourceObservation && sourceObservation.timestamp ? sourceObservation.timestamp.nativeFrameTimestampNs : null),
    anatomicalRegion: label.anatomicalRegion,
    hairState: label.hairState,
    semanticConfidence: label.annotationConfidence,        // explicit only; null stays null
    sourceMethod: ObservationMethod.MANUAL_GROUND_TRUTH,
    synthetic: !!synthetic,
    spatialSupport: geomSupported == null ? null : { geometryRegionSupported: geomSupported },
    syncStatus,                                            // copied from the verified source — never upgraded
    provenance: {
      datasetSource: 'ground-truth-dataset',
      annotationStatus: label.annotationStatus,
      annotatorId: label.annotatorId,
      revision: label.revision,
      labelId: label.labelId,
      sourceRecorder: sourceObservation && sourceObservation.metadata ? sourceObservation.metadata.sourceRecorder : null,
      coherenceStatus: sourceObservation ? (sourceObservation.coherenceStatus || null) : null
    },
    notes: label.notes || null
  });
}

// ---------------------------------------------------------------------------
// Dataset assembler
// ---------------------------------------------------------------------------
export function assembleGroundTruthDataset(scanPackage, annotationLabels, options = {}) {
  const {
    datasetId = null,
    datasetRevision = null,
    createdAt = null,
    annotationSource = null,
    synthetic = true,
    revisionPolicy = 'preserve-conflict', // or 'latest-wins' (requires numeric label revisions)
    metadata = {}
  } = options;

  const idx = indexScanPackage(scanPackage);
  const labels = (annotationLabels || []).map(l => (l && l.groundTruthDatasetVersion ? l : makeGroundTruthLabel(l)));

  const rejectedLabels = [];
  const excludedLabels = [];
  const needsReviewLabels = [];
  const validByKey = new Map();       // key -> [{label, sourceObservation}]

  for (const label of labels) {
    if (label.annotationStatus === AnnotationStatus.EXCLUDED) { excludedLabels.push(label); continue; }
    const v = validateLabelAgainstScanPackage(label, scanPackage, { ...options, _index: idx });
    if (!v.valid) { rejectedLabels.push(Object.freeze({ label, reason: v.reason, detail: v.detail })); continue; }
    if (label.annotationStatus === AnnotationStatus.NEEDS_REVIEW) { needsReviewLabels.push(Object.freeze({ label, sourceObservation: v.sourceObservation })); continue; }
    const k = labelKey(label);
    if (!validByKey.has(k)) validByKey.set(k, []);
    validByKey.get(k).push({ label, sourceObservation: v.sourceObservation });
  }

  const acceptedLabels = [];
  const acceptedSourceObsByKey = new Map();  // labelKey -> sourceObservation for the accepted label
  const ambiguousLabels = [];
  const conflictLabels = [];
  const duplicateLabels = [];

  for (const [k, group] of validByKey) {
    const definitive = group.filter(g => g.label.annotationStatus === AnnotationStatus.LABELED);
    const ambiguousInGroup = group.filter(g => g.label.annotationStatus === AnnotationStatus.AMBIGUOUS);
    for (const g of ambiguousInGroup) ambiguousLabels.push(g.label);

    if (definitive.length === 0) continue;

    const accept = (g) => { acceptedLabels.push(g.label); acceptedSourceObsByKey.set(k, g.sourceObservation); };

    if (definitive.length === 1) { accept(definitive[0]); continue; }

    // multiple definitive labels for one (observation, region)
    const distinctStates = new Set(definitive.map(g => g.label.hairState));
    if (distinctStates.size === 1) {
      // identical duplicates → keep the first deterministically, record the rest
      const sorted = definitive.slice().sort(byDeterministicOrder);
      accept(sorted[0]);
      for (const g of sorted.slice(1)) duplicateLabels.push(Object.freeze({ label: g.label, outcome: DuplicateOutcome.DEDUP_IDENTICAL, keptLabelId: sorted[0].label.labelId }));
      continue;
    }

    // conflicting definitive labels
    if (revisionPolicy === 'latest-wins' && definitive.every(g => g.label.revision != null)) {
      const sorted = definitive.slice().sort((a, b) => (b.label.revision - a.label.revision) || byDeterministicOrder(a, b));
      accept(sorted[0]);
      for (const g of sorted.slice(1)) {
        conflictLabels.push(Object.freeze({ label: g.label, outcome: 'SUPERSEDED_BY_REVISION', winnerLabelId: sorted[0].label.labelId }));
      }
    } else {
      for (const g of definitive) conflictLabels.push(Object.freeze({ label: g.label, outcome: DuplicateOutcome.CONFLICT_PRESERVED }));
    }
  }

  const semanticGroundTruthObservations = acceptedLabels.map(l =>
    groundTruthLabelToSemanticObservation(l, acceptedSourceObsByKey.get(labelKey(l)), { synthetic }));

  const eligible = eligibleImageObservations(scanPackage);
  const labeledObsIds = new Set(acceptedLabels.map(l => l.sourceScanObservationId));
  const unlabeledEligibleObservations = eligible
    .filter(o => !labeledObsIds.has(o.observationId))
    .map(o => manifestRow(o, scanPackage));

  const datasetSummary = summarize({
    scanPackage, eligible, acceptedLabels, ambiguousLabels, conflictLabels,
    excludedLabels, needsReviewLabels, rejectedLabels
  });

  return Object.freeze({
    schemaVersion: GROUND_TRUTH_DATASET_VERSION,
    datasetId,
    datasetRevision: numOrNull(datasetRevision),
    createdAt,
    sourceScanSessionIds: Object.freeze(idx.scanSessionIds),
    annotationSource: annotationSource != null ? String(annotationSource) : null,
    labels: Object.freeze([...acceptedLabels, ...ambiguousLabels, ...needsReviewLabels.map(g => g.label)]),
    acceptedLabels: Object.freeze(acceptedLabels),
    ambiguousLabels: Object.freeze(ambiguousLabels),
    conflictLabels: Object.freeze(conflictLabels),
    duplicateLabels: Object.freeze(duplicateLabels),
    needsReviewLabels: Object.freeze(needsReviewLabels.map(g => g.label)),
    excludedLabels: Object.freeze(excludedLabels),
    rejectedLabels: Object.freeze(rejectedLabels),
    semanticGroundTruthObservations: Object.freeze(semanticGroundTruthObservations),
    unlabeledEligibleObservations: Object.freeze(unlabeledEligibleObservations),
    datasetSummary,
    metadata: Object.freeze({ semanticHairEvidenceVersion: SEMANTIC_HAIR_EVIDENCE_VERSION, ...metadata })
  });
}

function byDeterministicOrder(a, b) {
  const ai = String(a.label.labelId != null ? a.label.labelId : ''), bi = String(b.label.labelId != null ? b.label.labelId : '');
  if (ai !== bi) return ai < bi ? -1 : 1;
  const ar = a.label.revision == null ? -1 : a.label.revision, br = b.label.revision == null ? -1 : b.label.revision;
  return ar - br;
}

export function emptyGroundTruthDataset(options = {}) {
  return assembleGroundTruthDataset({ posePackages: {} }, [], options);
}

// ---------------------------------------------------------------------------
// Manifests (no pixels, no dataUrl/base64)
// ---------------------------------------------------------------------------
function eligibleImageObservations(scanPackage) {
  const out = [];
  const poses = scanPackage && scanPackage.posePackages ? scanPackage.posePackages : {};
  for (const p of Object.values(poses)) {
    for (const o of p.retainedImageObservations) {
      if (o.imageRef && o.imageRef.ref) out.push(o);
    }
  }
  return out;
}
function manifestRow(o, scanPackage) {
  return Object.freeze({
    scanSessionId: (o.metadata && o.metadata.scannerSessionId) || (scanPackage && scanPackage.scanSessionId) || null,
    sourceScanObservationId: o.observationId,
    imageRef: o.imageRef ? o.imageRef.ref : null,          // handle only — never dataUrl/base64
    nativeFrameTimestampNs: o.timestamp ? numOrNull(o.timestamp.nativeFrameTimestampNs) : null,
    poseId: o.poseId || null,
    observedPoseRegion: o.observedPoseRegion || null,
    yawDeg: numOrNull(o.yawDeg), pitchDeg: numOrNull(o.pitchDeg), rollDeg: numOrNull(o.rollDeg),
    syncStatus: o.syncStatus || SyncStatus.UNKNOWN,
    imageWidth: o.imageRef ? numOrNull(o.imageRef.width) : null,
    imageHeight: o.imageRef ? numOrNull(o.imageRef.height) : null,
    sourceTier: o.sourceTier || null
  });
}

/** Manifest of image-backed observations eligible for future human annotation. */
export function buildAnnotationManifest(scanPackage, options = {}) {
  const { anatomySupport = SUPPORTED_REGIONS } = options;
  const supported = anatomySupport && typeof anatomySupport.includes === 'function'
    ? Object.freeze([...anatomySupport]) : Object.freeze([...SUPPORTED_REGIONS]);
  return Object.freeze(eligibleImageObservations(scanPackage).map(o =>
    Object.freeze({ ...manifestRow(o, scanPackage), supportedGeometryRegions: supported })));
}

// ---------------------------------------------------------------------------
// BS1-E bridge
// ---------------------------------------------------------------------------
function toEvalEntry(labelOrObs) {
  // accepts a SemanticHairObservation or a GroundTruthLabel-derived shape
  return {
    sourceScanObservationId: labelOrObs.sourceScanObservationId,
    anatomicalRegion: labelOrObs.anatomicalRegion,
    imageRef: labelOrObs.imageRef || null,
    poseId: labelOrObs.poseId || null,
    observedPoseRegion: labelOrObs.observedPoseRegion || null,
    nativeFrameTimestampNs: numOrNull(labelOrObs.nativeFrameTimestampNs),
    hairState: labelOrObs.hairState,
    semanticConfidence: clamp01OrNull(labelOrObs.semanticConfidence != null ? labelOrObs.semanticConfidence : labelOrObs.annotationConfidence),
    syncStatus: labelOrObs.syncStatus || null,
    sourceMethod: ObservationMethod.MANUAL_GROUND_TRUTH
  };
}

/**
 * Exactly the GT entries BS1-E's evaluateSemanticProducer(...) expects. Only
 * accepted/definitive labels enter `scoredEntries`; ambiguous / conflict / excluded /
 * needs-review labels are returned separately and never silently scored.
 */
export function groundTruthDatasetToEvaluationEntries(dataset) {
  return Object.freeze({
    scoredEntries: Object.freeze(dataset.semanticGroundTruthObservations.map(toEvalEntry)),
    ambiguousEntries: Object.freeze(dataset.ambiguousLabels.map(toEvalEntry)),
    conflictEntries: Object.freeze(dataset.conflictLabels.map(c => toEvalEntry(c.label))),
    excludedEntries: Object.freeze(dataset.excludedLabels.map(toEvalEntry)),
    needsReviewEntries: Object.freeze(dataset.needsReviewLabels.map(toEvalEntry))
  });
}

/** Reproducible producer-evaluation manifest: the exact observation set + regions with GT. */
export function buildProducerEvaluationManifest(dataset, scanPackage) {
  const idx = indexScanPackage(scanPackage);
  const byObs = new Map();
  for (const o of dataset.semanticGroundTruthObservations) {
    if (!byObs.has(o.sourceScanObservationId)) byObs.set(o.sourceScanObservationId, new Set());
    byObs.get(o.sourceScanObservationId).add(o.anatomicalRegion);
  }
  const rows = [];
  for (const [obsId, regions] of byObs) {
    const obs = idx.byId.get(obsId);
    rows.push(Object.freeze({
      observationId: obsId,
      imageRef: obs && obs.imageRef ? obs.imageRef.ref : null,
      poseId: obs ? (obs.poseId || null) : null,
      nativeFrameTimestampNs: obs && obs.timestamp ? numOrNull(obs.timestamp.nativeFrameTimestampNs) : null,
      syncStatus: obs ? (obs.syncStatus || SyncStatus.UNKNOWN) : SyncStatus.UNKNOWN,
      regionsToEvaluate: Object.freeze([...regions].sort())
    }));
  }
  rows.sort((a, b) => (String(a.observationId) < String(b.observationId) ? -1 : 1));
  return Object.freeze({
    schemaVersion: GROUND_TRUTH_DATASET_VERSION,
    datasetId: dataset.datasetId,
    datasetRevision: dataset.datasetRevision,
    rows: Object.freeze(rows)
  });
}

// ---------------------------------------------------------------------------
// Grouping (Part 18). NO train/test split: no subject-group identity exists in the data,
// so any split MUST be driven by a caller-supplied subjectGroupOf() function.
// ---------------------------------------------------------------------------
const groupBy = (labels, keyFn) => {
  const m = {};
  for (const l of labels || []) { const k = keyFn(l) ?? '__null'; (m[k] || (m[k] = [])).push(l); }
  return Object.freeze(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Object.freeze(v)])));
};
export const groupByScanSession = (labels) => groupBy(labels, l => l.scanSessionId);
export const groupByPose = (labels) => groupBy(labels, l => l.poseId);
export const groupByRegion = (labels) => groupBy(labels, l => l.anatomicalRegion);

/**
 * Deterministic split by caller-supplied subject group. Throws if no grouping function is
 * given — this stage refuses to invent subject identity or split randomly, which would leak
 * one person's observations across train and test.
 */
export function splitBySubjectGroup(entries, subjectGroupOf, assignment) {
  if (typeof subjectGroupOf !== 'function') {
    throw new Error('splitBySubjectGroup: a caller subjectGroupOf(entry) -> groupId is required; no subject identity exists in the data and random splitting is not allowed');
  }
  if (!assignment || typeof assignment !== 'object') {
    throw new Error('splitBySubjectGroup: a caller { groupId: "train"|"validation"|"test" } assignment map is required');
  }
  const out = {};
  for (const e of entries || []) {
    const g = subjectGroupOf(e);
    const split = assignment[g];
    if (!split) continue;
    (out[split] || (out[split] = [])).push(e);
  }
  return Object.freeze(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Object.freeze(v)])));
}

// ---------------------------------------------------------------------------
// Summary + diagnostics
// ---------------------------------------------------------------------------
function summarize({ scanPackage, eligible, acceptedLabels, ambiguousLabels, conflictLabels, excludedLabels, needsReviewLabels, rejectedLabels }) {
  const exactSyncEligible = eligible.filter(o => o.syncStatus === SyncStatus.EXACT_SYNCHRONIZED).length;
  const labeledObsIds = new Set(acceptedLabels.map(l => l.sourceScanObservationId));
  const perPose = {}, perRegion = {}, perHairState = {};
  for (const s of SCAN_POSES) perPose[s] = 0;
  for (const l of acceptedLabels) {
    if (l.poseId) perPose[l.poseId] = (perPose[l.poseId] || 0) + 1;
    perRegion[l.anatomicalRegion] = (perRegion[l.anatomicalRegion] || 0) + 1;
    perHairState[l.hairState] = (perHairState[l.hairState] || 0) + 1;
  }
  const exactSyncLabelCount = acceptedLabels.filter(l => l.syncStatus === SyncStatus.EXACT_SYNCHRONIZED).length;

  return Object.freeze({
    // coverage denominator = image-backed retained observations eligible for annotation
    eligibleImageObservationCount: eligible.length,
    exactSyncEligibleCount: exactSyncEligible,
    labeledObservationCount: labeledObsIds.size,
    unlabeledObservationCount: Math.max(0, eligible.length - labeledObsIds.size),
    totalRegionLabels: acceptedLabels.length + ambiguousLabels.length + needsReviewLabels.length,
    definitiveLabelCount: acceptedLabels.length,
    ambiguousLabelCount: ambiguousLabels.length,
    conflictLabelCount: conflictLabels.length,
    excludedLabelCount: excludedLabels.length,
    needsReviewCount: needsReviewLabels.length,
    rejectedLabelCount: rejectedLabels.length,
    exactSyncLabelCount,
    perPoseLabelCounts: Object.freeze(perPose),
    perRegionLabelCounts: Object.freeze(perRegion),
    perHairStateCounts: Object.freeze(perHairState),
    datasetCoverageRate: safeDiv(labeledObsIds.size, eligible.length) // labeled / eligible image obs
  });
}

export function groundTruthDatasetDiagnosticString(dataset) {
  const s = dataset.datasetSummary;
  const lines = [
    'Mettle Ground Truth Dataset',
    '',
    `datasetRevision=${dataset.datasetRevision}`,
    `eligibleImages=${s.eligibleImageObservationCount}`,
    `exactSyncEligible=${s.exactSyncEligibleCount}`,
    '',
    'labels:',
    `  total=${s.totalRegionLabels}`,
    `  definitive=${s.definitiveLabelCount}`,
    `  ambiguous=${s.ambiguousLabelCount}`,
    `  conflict=${s.conflictLabelCount}`,
    `  needsReview=${s.needsReviewCount}`,
    `  excluded=${s.excludedLabelCount}`,
    `  rejected=${s.rejectedLabelCount}`,
    '',
    `coverage=${s.datasetCoverageRate}`,
    '',
    'poses:'
  ];
  for (const pose of SCAN_POSES) lines.push(`  ${pose}=${s.perPoseLabelCounts[pose] || 0}`);
  lines.push('', `unlabeledEligibleImages=${s.unlabeledObservationCount}`);
  return lines.join('\n');
}
