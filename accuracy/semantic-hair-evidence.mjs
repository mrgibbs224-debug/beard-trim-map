// Facial-hair semantic evidence + cross-pose fusion — PURE, ISOLATED
// Stage BS1-D. Zero dependencies beyond sibling accuracy/ modules. No model, no pixels.
//
// PURPOSE
//   Turn CALLER-SUPPLIED semantic labels (a future segmentation producer, or manual ground
//   truth) attached to BS1-C image-backed scan observations into BS1-A surface observations,
//   fuse them across formal poses with the existing BS1-A primitives, and summarise semantic
//   support separately from geometry support. BS1-D performs NO beard segmentation — synthetic
//   test labels are tagged `synthetic:true` and must not masquerade as runtime detection.
//
// BS1-A SEMANTIC EVIDENCE RECOGNITION (current behaviour, updated for BS1-D1)
//   BS1-A `fuseRegion` counts BOTH `SEMANTIC_SEGMENTATION` and `MANUAL_GROUND_TRUTH` as
//   semantic evidence: BS1-D1 broadened `isSemanticObservation` in `beard-surface-core.mjs`
//   (`SEMANTIC_OBSERVATION_METHODS` / `isSemanticObservationMethod`) after BS1-D proved that
//   `MANUAL_GROUND_TRUTH` surface observations were previously inert in `region.hairState` /
//   `semanticSupported`. Both methods now drive region hair state and semantic support, and
//   this module's own `semanticSurfaceSummary` likewise folds in both.

import {
  makeSurfaceObservation,
  buildBeardSurface,
  fuseHairState,
  isKnownRegion,
  HairState,
  ObservationMethod,
  ObservationKind,
  CoordinateSpace,
  SCAN_POSES,
  CORE_REGIONS,
  clamp01OrNull
} from './beard-surface-core.mjs';
import { SyncStatus } from './multi-observation-scan-package.mjs';
import { RawImageLifecycle } from './semantic-image-evidence.mjs';

export const SEMANTIC_HAIR_EVIDENCE_VERSION = 'semantic-hair-evidence/1';

/** Semantic evidence source methods — a subset of BS1-A ObservationMethod. */
export const SEMANTIC_METHODS = Object.freeze([
  ObservationMethod.SEMANTIC_SEGMENTATION,
  ObservationMethod.MANUAL_GROUND_TRUTH
]);

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round4 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : x);
const meanOf = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

/**
 * Future-compatible image-space support. NO pixel masks are stored — `maskRef` is an opaque
 * caller handle only. No image-space polygons are invented for unsupported regions.
 */
export function makeImageSpaceSupport(spec = {}) {
  const b = spec.normalizedBBox;
  return Object.freeze({
    normalizedBBox: (b && typeof b === 'object')
      ? Object.freeze({ x: numOrNull(b.x), y: numOrNull(b.y), w: numOrNull(b.w), h: numOrNull(b.h) })
      : null,
    landmarkIndices: Array.isArray(spec.landmarkIndices) ? Object.freeze([...spec.landmarkIndices]) : null,
    maskRef: typeof spec.maskRef === 'string' ? spec.maskRef : null,
    sampleCount: numOrNull(spec.sampleCount),
    positiveFraction: clamp01OrNull(spec.positiveFraction)
  });
}

/** One region-scoped piece of semantic evidence derived (later) from one keyframe. */
export function makeSemanticHairObservation(spec = {}) {
  const {
    observationId = null,
    sourceScanObservationId = null,
    imageRef = null,
    poseId = null,
    observedPoseRegion = null,
    nativeFrameTimestampNs = null,
    anatomicalRegion,
    hairState = HairState.UNKNOWN,
    semanticConfidence = null,
    sourceMethod = ObservationMethod.SEMANTIC_SEGMENTATION,
    synthetic = true,
    spatialSupport = null,        // { geometryRegionSupported: boolean } — geometry vs semantic kept SEPARATE
    imageSpaceSupport = null,
    landmarkSupport = null,
    syncStatus = SyncStatus.UNKNOWN,
    provenance = null,
    rawImageLifecycle = RawImageLifecycle.DERIVED_DATA_EXTRACTED,
    boundaryMeta = null,          // Part 15 — attach-later metadata, no contour fitting
    notes = null
  } = spec;

  if (!isKnownRegion(anatomicalRegion)) throw new Error(`makeSemanticHairObservation: unknown region "${anatomicalRegion}"`);
  if (poseId != null && !SCAN_POSES.includes(poseId)) throw new Error(`makeSemanticHairObservation: unknown poseId "${poseId}"`);
  if (!Object.values(HairState).includes(hairState)) throw new Error(`makeSemanticHairObservation: unknown hairState "${hairState}"`);
  if (!SEMANTIC_METHODS.includes(sourceMethod)) {
    throw new Error('makeSemanticHairObservation: sourceMethod must be SEMANTIC_SEGMENTATION or MANUAL_GROUND_TRUTH');
  }
  if (!Object.values(SyncStatus).includes(syncStatus)) throw new Error(`makeSemanticHairObservation: unknown syncStatus "${syncStatus}"`);

  return Object.freeze({
    semanticHairEvidenceVersion: SEMANTIC_HAIR_EVIDENCE_VERSION,
    observationId,
    sourceScanObservationId,
    imageRef: typeof imageRef === 'string' ? imageRef : ((imageRef && imageRef.ref) || null),
    poseId,
    observedPoseRegion,
    nativeFrameTimestampNs: numOrNull(nativeFrameTimestampNs),
    anatomicalRegion,
    hairState,
    semanticConfidence: clamp01OrNull(semanticConfidence), // caller-supplied only; null stays null
    sourceMethod,
    synthetic: !!synthetic,
    spatialSupport: spatialSupport && typeof spatialSupport === 'object'
      ? Object.freeze({ geometryRegionSupported: spatialSupport.geometryRegionSupported === true ? true
          : spatialSupport.geometryRegionSupported === false ? false : null })
      : null,
    imageSpaceSupport: imageSpaceSupport ? makeImageSpaceSupport(imageSpaceSupport) : null,
    landmarkSupport: Array.isArray(landmarkSupport) ? Object.freeze([...landmarkSupport]) : null,
    syncStatus,                    // preserved from the source keyframe — never upgraded
    provenance: provenance ? Object.freeze({ ...provenance }) : null,
    rawImageLifecycle,
    boundaryMeta: boundaryMeta ? Object.freeze({ ...boundaryMeta }) : null,
    notes: notes != null ? String(notes) : (synthetic ? 'synthetic/test evidence — not runtime segmentation' : null)
  });
}

/**
 * Turn caller-supplied `semanticLabels` (keyed by scanObservationId or imageRef, plus an
 * anatomicalRegion + hairState) into SemanticHairObservations bound to real BS1-C image
 * observations. Fails closed on unknown references.
 *
 * options: {
 *   requireImageBacked = true,        // reject labels on geometry-only observations
 *   requireExactSync = false,         // EXACT-only caller policy
 *   sourceMethod = SEMANTIC_SEGMENTATION,
 *   synthetic = true,
 *   anatomySupport = null             // Set<region> | {region:bool} from BS1-C — fills spatialSupport
 * }
 */
export function semanticObservationsFromKeyframes(scanPackage, semanticLabels, options = {}) {
  const {
    requireImageBacked = true,
    requireExactSync = false,
    sourceMethod = ObservationMethod.SEMANTIC_SEGMENTATION,
    synthetic = true,
    anatomySupport = null
  } = options;

  const byId = new Map();
  const byRef = new Map();
  const poses = scanPackage && scanPackage.posePackages ? scanPackage.posePackages : {};
  for (const p of Object.values(poses)) {
    for (const k of p.retainedImageObservations) {
      byId.set(k.observationId, k);
      if (k.imageRef && k.imageRef.ref) byRef.set(k.imageRef.ref, k);
    }
    for (const g of p.retainedGeometryObservations) byId.set(g.observationId, g);
  }

  const regionSupported = (region) => {
    if (!anatomySupport) return null;
    if (typeof anatomySupport.has === 'function') return anatomySupport.has(region);
    return !!anatomySupport[region];
  };

  const semanticObservations = [];
  const unsupportedSemanticLabels = [];
  let auto = 0;

  for (const label of (semanticLabels || [])) {
    const idRef = label.scanObservationId != null ? label.scanObservationId
      : (label.observationId != null ? label.observationId : null);
    const imgKey = label.imageRef != null ? label.imageRef : null;
    const scanObs = idRef != null ? byId.get(idRef) : (imgKey != null ? byRef.get(imgKey) : undefined);

    if (!scanObs) { unsupportedSemanticLabels.push(Object.freeze({ label, reason: 'referenced scan observation not found' })); continue; }
    const imageBacked = !!(scanObs.imageRef && scanObs.imageRef.ref);
    if (requireImageBacked && !imageBacked) {
      unsupportedSemanticLabels.push(Object.freeze({ label, reason: 'referenced observation is not image-backed' })); continue;
    }
    if (requireExactSync && scanObs.syncStatus !== SyncStatus.EXACT_SYNCHRONIZED) {
      unsupportedSemanticLabels.push(Object.freeze({ label, reason: `sync status ${scanObs.syncStatus} fails EXACT-only policy` })); continue;
    }
    if (!isKnownRegion(label.anatomicalRegion)) {
      unsupportedSemanticLabels.push(Object.freeze({ label, reason: `unknown anatomicalRegion "${label.anatomicalRegion}"` })); continue;
    }

    const geomSupported = regionSupported(label.anatomicalRegion);
    semanticObservations.push(makeSemanticHairObservation({
      observationId: `sem:${scanObs.observationId}:${label.anatomicalRegion}:${auto++}`,
      sourceScanObservationId: scanObs.observationId,
      imageRef: imageBacked ? scanObs.imageRef.ref : null,
      poseId: scanObs.poseId || null,
      observedPoseRegion: scanObs.observedPoseRegion || null,
      nativeFrameTimestampNs: scanObs.timestamp ? scanObs.timestamp.nativeFrameTimestampNs : null,
      anatomicalRegion: label.anatomicalRegion,
      hairState: label.hairState || HairState.UNKNOWN,
      semanticConfidence: label.semanticConfidence != null ? label.semanticConfidence : null,
      sourceMethod: label.sourceMethod || sourceMethod,
      synthetic: label.synthetic != null ? !!label.synthetic : synthetic,
      spatialSupport: geomSupported == null ? null : { geometryRegionSupported: geomSupported },
      imageSpaceSupport: label.imageSpaceSupport || null,
      landmarkSupport: label.landmarkSupport || null,
      syncStatus: scanObs.syncStatus,
      provenance: {
        sourceRecorder: scanObs.metadata ? scanObs.metadata.sourceRecorder : null,
        sourceTier: scanObs.sourceTier,
        nativeSpatialKeyframe: !!scanObs.nativeSpatialKeyframe,
        coherenceStatus: scanObs.coherenceStatus || null,
        labelKeyedBy: idRef != null ? 'scanObservationId' : (imgKey != null ? 'imageRef' : 'unknown')
      },
      boundaryMeta: label.boundaryMeta || null,
      notes: label.notes || null
    }));
  }

  return Object.freeze({
    semanticObservations: Object.freeze(semanticObservations),
    unsupportedSemanticLabels: Object.freeze(unsupportedSemanticLabels),
    unresolvedImageRefs: Object.freeze([])
  });
}

/** SemanticHairObservation[] → BS1-A surface observations (position null — no fabricated 3D). */
export function semanticObservationsToSurfaceObservations(semanticObs) {
  return (semanticObs || []).map(s => makeSurfaceObservation({
    region: s.anatomicalRegion,
    position: null,
    space: CoordinateSpace.CANONICAL_FACE_LOCAL, // the surface's single space; position stays null
    pose: s.poseId || null,
    method: s.sourceMethod,
    kind: ObservationKind.SEMANTIC_OBSERVATION,
    sourceLandmarks: s.landmarkSupport || [],
    hairState: s.hairState,
    confidence: s.semanticConfidence != null ? { semanticConfidence: s.semanticConfidence } : null,
    observedAt: s.observationId
  }));
}

/** Semantic-only summary. Folds in BOTH semantic methods (SEMANTIC_SEGMENTATION + MANUAL_GROUND_TRUTH). */
export function semanticSurfaceSummary(semanticObservations) {
  const byRegion = new Map();
  for (const s of (semanticObservations || [])) {
    if (!byRegion.has(s.anatomicalRegion)) byRegion.set(s.anatomicalRegion, []);
    byRegion.get(s.anatomicalRegion).push(s);
  }

  let semanticMultiPoseRegions = 0;
  let beardConfirmedRegions = 0, nonBeardConfirmedRegions = 0, boundaryRegions = 0, uncertainRegions = 0;
  let semanticConflictRegions = 0, exactSyncSemanticObservationCount = 0;
  const perRegion = {};
  let coreRegionsWithSemantics = 0;

  for (const [region, obs] of byRegion) {
    const poses = [...new Set(obs.map(o => o.poseId).filter(p => SCAN_POSES.includes(p)))].sort();
    const states = new Set(obs.map(o => o.hairState).filter(h => h && h !== HairState.UNKNOWN));
    // reuse BS1-A fuseHairState semantics, treating every semantic method as semantic here
    const fused = fuseHairState(obs.map(o => ({ method: ObservationMethod.SEMANTIC_SEGMENTATION, hairState: o.hairState })));
    const exact = obs.filter(o => o.syncStatus === SyncStatus.EXACT_SYNCHRONIZED).length;
    const conflict = states.has(HairState.BEARD_CONFIRMED) && states.has(HairState.NON_BEARD_CONFIRMED);

    exactSyncSemanticObservationCount += exact;
    if (conflict) semanticConflictRegions++;
    if (poses.length >= 2) semanticMultiPoseRegions++;
    if (fused === HairState.BEARD_CONFIRMED) beardConfirmedRegions++;
    else if (fused === HairState.NON_BEARD_CONFIRMED) nonBeardConfirmedRegions++;
    else if (fused === HairState.BOUNDARY) boundaryRegions++;
    else if (fused === HairState.UNCERTAIN) uncertainRegions++;
    if (CORE_REGIONS.includes(region)) coreRegionsWithSemantics++;

    const support = obs.map(o => o.spatialSupport && o.spatialSupport.geometryRegionSupported);
    perRegion[region] = Object.freeze({
      fusedHairState: fused,
      observationCount: obs.length,
      contributingPoses: Object.freeze(poses),
      multiPose: poses.length >= 2,
      exactSyncCount: exact,
      conflict,
      geometryRegionSupported: support.includes(true) ? true : (support.includes(false) ? false : null),
      methods: Object.freeze([...new Set(obs.map(o => o.sourceMethod))].sort()),
      isCoreRegion: CORE_REGIONS.includes(region)
    });
  }

  const confidences = (semanticObservations || []).map(o => o.semanticConfidence).filter(v => typeof v === 'number');

  return Object.freeze({
    semanticHairEvidenceVersion: SEMANTIC_HAIR_EVIDENCE_VERSION,
    semanticRegionsObserved: byRegion.size,
    semanticRegionsUnknown: Math.max(0, CORE_REGIONS.length - coreRegionsWithSemantics),
    semanticMultiPoseRegions,
    beardConfirmedRegions,
    nonBeardConfirmedRegions,
    boundaryRegions,
    uncertainRegions,
    semanticConflictRegions,
    exactSyncSemanticObservationCount,
    semanticCoverage: round4(coreRegionsWithSemantics / CORE_REGIONS.length),
    meanSuppliedSemanticConfidence: confidences.length ? round4(meanOf(confidences)) : null,
    rawImagesRequiredAfterDerivation: false,
    perRegion: Object.freeze(perRegion)
  });
}

/**
 * Full BS1-D bundle: scan package (image refs preserved) + geometry surface observations
 * (from BS1-C) + semantic observations + combined BS1-A surface + semantic summary.
 * No competing PersonalizedBeardSurface type — `personalizedBeardSurface` is BS1-A's.
 */
export function buildSemanticBeardSurfaceBundle(scanPackage, geometrySurfaceObservations, semanticLabels, options = {}) {
  const { toleranceNormalized = null, identityId = null } = options;

  const ingest = semanticObservationsFromKeyframes(scanPackage, semanticLabels, options);
  const semanticSurfaceObservations = semanticObservationsToSurfaceObservations(ingest.semanticObservations);
  const geom = Array.isArray(geometrySurfaceObservations) ? geometrySurfaceObservations : [];
  const combinedSurfaceObservations = [...geom, ...semanticSurfaceObservations];

  const personalizedBeardSurface = buildBeardSurface(combinedSurfaceObservations, {
    toleranceNormalized,
    identityId,
    captureMeta: {
      scanSessionId: scanPackage ? scanPackage.scanSessionId : null,
      sourceArchitectureVersion: scanPackage ? scanPackage.sourceArchitectureVersion : null,
      semanticHairEvidenceVersion: SEMANTIC_HAIR_EVIDENCE_VERSION
    }
  });

  const semanticSummary = semanticSurfaceSummary(ingest.semanticObservations);

  return Object.freeze({
    scanPackage,
    geometrySurfaceObservations: Object.freeze([...geom]),
    semanticObservations: ingest.semanticObservations,
    combinedSurfaceObservations: Object.freeze(combinedSurfaceObservations),
    personalizedBeardSurface,
    semanticSummary,
    unresolvedImageRefs: ingest.unresolvedImageRefs,
    unsupportedSemanticLabels: ingest.unsupportedSemanticLabels
  });
}

/** Concise deterministic diagnostic. No pixels, no masks, no per-frame logging. */
export function semanticDiagnosticString(bundle) {
  const s = bundle.semanticSummary;
  return [
    'BS1-D Semantic',
    '',
    'semantic:',
    `  regionsObserved=${s.semanticRegionsObserved}`,
    `  regionsUnknown=${s.semanticRegionsUnknown}`,
    `  multiPoseRegions=${s.semanticMultiPoseRegions}`,
    `  beardConfirmed=${s.beardConfirmedRegions}`,
    `  nonBeardConfirmed=${s.nonBeardConfirmedRegions}`,
    `  boundary=${s.boundaryRegions}`,
    `  uncertain=${s.uncertainRegions}`,
    `  conflictRegions=${s.semanticConflictRegions}`,
    `  exactSyncSemanticObs=${s.exactSyncSemanticObservationCount}`,
    `  semanticCoverage=${s.semanticCoverage}`,
    '',
    `unresolvedImageRefs=${bundle.unresolvedImageRefs.length}`,
    `unsupportedSemanticLabels=${bundle.unsupportedSemanticLabels.length}`,
    `rawImagesRequiredAfterDerivation=${s.rawImagesRequiredAfterDerivation}`
  ].join('\n');
}
