// Portable local annotation bundle — PURE, ISOLATED
// Stage BS1-G. Zero dependencies beyond sibling accuracy/ modules. No I/O, no network, no model.
//
// PURPOSE
//   A LOCAL / DEVELOPMENT / DATASET artifact that carries, for each eligible hidden
//   image-backed scan observation from a BS1-F manifest: the exact keyframe identity + the
//   raw JPEG payload (for human annotation) + pose / sync / geometry metadata + the regions
//   a human is being asked to label.
//
//   Unlike every other accuracy/ contract, THIS ONE MAY CARRY RAW IMAGE PAYLOADS — its whole
//   job is to feed a human annotation workbench. The ownership boundary is explicit:
//   `rawImageStorageScope = LOCAL_ANNOTATION_BUNDLE`. BS1-G adds NO persistence, NO network,
//   NO Android storage, NO upload, and does NOT change A6 image retention. A caller decides
//   whether to write a bundle to disk later. Raw payloads NEVER enter PersonalizedBeardSurface,
//   semantic observations, or ground-truth semantic observations.
//
//   BS1-G performs NO pixel processing: no decode, resize, crop, rotate, mirror, segment,
//   similarity, or mask. Rotation / mirroring are carried as metadata for a future UI to honour.

import { SCAN_POSES, HairState, ObservationMethod } from './beard-surface-core.mjs';
import { SyncStatus } from './multi-observation-scan-package.mjs';
import { ImageResolveStatus } from './semantic-image-evidence.mjs';

export const ANNOTATION_BUNDLE_VERSION = 'annotation-bundle/1';

/** The only storage scope a raw image payload in this contract is allowed to have. */
export const RawImageStorageScope = Object.freeze({ LOCAL_ANNOTATION_BUNDLE: 'LOCAL_ANNOTATION_BUNDLE' });

/** Bundle-specific raw-image lifetime — deliberately SEPARATE from BS1-B RawImageLifecycle. */
export const BundleImageStatus = Object.freeze({
  INCLUDED_FOR_ANNOTATION: 'INCLUDED_FOR_ANNOTATION',
  ANNOTATION_COMPLETE: 'ANNOTATION_COMPLETE',
  ELIGIBLE_FOR_LOCAL_DISCARD: 'ELIGIBLE_FOR_LOCAL_DISCARD'
});

/** Raw image payload encodings, per the verified A6 format (base64 JPEG). No re-encoding here. */
export const RawImageFormat = Object.freeze({
  DATA_URL: 'data-url',        // "data:image/jpeg;base64,...."
  BASE64_JPEG: 'base64-jpeg'   // bare base64, no data: prefix
});

/** Per-manifest-row outcome. */
export const EntryOutcome = Object.freeze({
  RESOLVED: 'RESOLVED',
  MISSING_NOT_FOUND: 'MISSING_NOT_FOUND',
  MISSING_EXPIRED: 'MISSING_EXPIRED',
  MISSING_INVALID: 'MISSING_INVALID',
  REJECTED_IDENTITY_CONFLICT: 'REJECTED_IDENTITY_CONFLICT',
  REJECTED_UNKNOWN_POSE: 'REJECTED_UNKNOWN_POSE',
  REJECTED_UNKNOWN_SYNC: 'REJECTED_UNKNOWN_SYNC',
  REJECTED_SYNC_BELOW_EXACT: 'REJECTED_SYNC_BELOW_EXACT'
});

/** Documentation of the next UI boundary (Part 18). Data only — BS1-G builds no UI. */
export const ANNOTATION_WORKBENCH_BOUNDARY = Object.freeze({
  pipeline: 'AnnotationBundle -> local standalone annotation workbench -> GroundTruthLabel JSON -> BS1-F assembleGroundTruthDataset -> BS1-E evaluateSemanticProducer',
  consumes: 'accuracy/annotation-bundle.mjs',
  producesForNextStage: 'GroundTruthLabel JSON (accuracy/ground-truth-dataset.mjs makeGroundTruthLabel shape)',
  guarantees: Object.freeze([
    'raw images stay in the LOCAL_ANNOTATION_BUNDLE scope only',
    'no persistence / network / model / pixel processing in this module',
    'stripRawImages() yields a redistributable no-pixel manifest'
  ])
});

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asStr = (v) => (v == null ? null : String(v));
const KNOWN_SYNC = new Set(Object.values(SyncStatus));
const KNOWN_FORMAT = new Set(Object.values(RawImageFormat));

// ---------------------------------------------------------------------------
// Row normalisation — accepts a BS1-F annotation-manifest row OR a producer-manifest row.
// ---------------------------------------------------------------------------
function normRow(row) {
  const sourceScanObservationId = row.sourceScanObservationId != null ? row.sourceScanObservationId
    : (row.observationId != null ? row.observationId : null);
  const regionsToAnnotate = Array.isArray(row.regionsToAnnotate) ? row.regionsToAnnotate
    : (Array.isArray(row.regionsToEvaluate) ? row.regionsToEvaluate : []);
  return {
    sourceScanObservationId,
    imageRef: typeof row.imageRef === 'string' ? row.imageRef : ((row.imageRef && row.imageRef.ref) || null),
    nativeFrameTimestampNs: numOrNull(row.nativeFrameTimestampNs),
    scanSessionId: row.scanSessionId != null ? asStr(row.scanSessionId) : null,
    poseId: row.poseId || null,
    observedPoseRegion: row.observedPoseRegion || null,
    yawDeg: numOrNull(row.yawDeg), pitchDeg: numOrNull(row.pitchDeg), rollDeg: numOrNull(row.rollDeg),
    syncStatus: row.syncStatus || null,
    imageWidth: numOrNull(row.imageWidth), imageHeight: numOrNull(row.imageHeight),
    sourceTier: row.sourceTier || null,
    supportedGeometryRegions: Array.isArray(row.supportedGeometryRegions) ? Object.freeze([...row.supportedGeometryRegions]) : Object.freeze([]),
    regionsToAnnotate: Object.freeze([...regionsToAnnotate])
  };
}

/** Minimum identity key a caller resolver needs. No pixels. */
export function imageResolverKeyForRow(row) {
  const r = row.sourceScanObservationId != null || row.observationId != null ? normRow(row) : row;
  return Object.freeze({
    sourceScanObservationId: r.sourceScanObservationId,
    imageRef: r.imageRef,
    nativeFrameTimestampNs: r.nativeFrameTimestampNs,
    poseId: r.poseId,
    scanSessionId: r.scanSessionId
  });
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
function makeEntry(row, resolved, outcome, detail = null) {
  return Object.freeze({
    schemaVersion: ANNOTATION_BUNDLE_VERSION,
    // identity — always from the manifest ROW, never from the resolver
    sourceScanObservationId: row.sourceScanObservationId,
    imageRef: row.imageRef,
    nativeFrameTimestampNs: row.nativeFrameTimestampNs,
    scanSessionId: row.scanSessionId,
    poseId: row.poseId,
    observedPoseRegion: row.observedPoseRegion,
    yawDeg: row.yawDeg, pitchDeg: row.pitchDeg, rollDeg: row.rollDeg,
    syncStatus: row.syncStatus || SyncStatus.UNKNOWN,
    sourceTier: row.sourceTier,
    supportedGeometryRegions: row.supportedGeometryRegions,
    regionsToAnnotate: row.regionsToAnnotate, // a labeling REQUEST, not a ground-truth claim
    // image metadata — the resolver is the source of the actual-image attributes
    coherenceStatus: resolved ? (resolved.coherenceStatus || null) : null,
    imageWidth: resolved && numOrNull(resolved.width) != null ? numOrNull(resolved.width) : row.imageWidth,
    imageHeight: resolved && numOrNull(resolved.height) != null ? numOrNull(resolved.height) : row.imageHeight,
    rotationDegrees: resolved ? numOrNull(resolved.rotationDegrees) : null,
    mirrored: resolved && typeof resolved.mirrored === 'boolean' ? resolved.mirrored : null,
    intrinsics: resolved && resolved.intrinsics && typeof resolved.intrinsics === 'object'
      ? Object.freeze({ ...resolved.intrinsics }) : null,
    landmarkCount: resolved ? numOrNull(resolved.landmarkCount) : null,
    // raw payload — ONLY here, ONLY in this scope
    rawImagePayload: resolved && typeof resolved.payload === 'string' ? resolved.payload : null,
    rawImageFormat: resolved ? (KNOWN_FORMAT.has(resolved.format) ? resolved.format
      : (typeof resolved.payload === 'string' && resolved.payload.startsWith('data:') ? RawImageFormat.DATA_URL : RawImageFormat.BASE64_JPEG))
      : null,
    rawImageStorageScope: RawImageStorageScope.LOCAL_ANNOTATION_BUNDLE,
    bundleImageStatus: outcome === EntryOutcome.RESOLVED ? BundleImageStatus.INCLUDED_FOR_ANNOTATION : BundleImageStatus.ELIGIBLE_FOR_LOCAL_DISCARD,
    outcome,
    outcomeDetail: detail
  });
}

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

/**
 * @param annotationManifest  array of BS1-F manifest rows, OR a { rows } manifest object
 * @param imagePayloadResolver caller function: (key, row) -> {
 *          status: ImageResolveStatus, payload?, format?, width?, height?, rotationDegrees?,
 *          mirrored?, intrinsics?, coherenceStatus?, landmarkCount?,
 *          imageRef?, nativeFrameTimestampNs?, poseId?, scanSessionId?, reason?
 *        }
 * @param options { requireExactSync=false, requireAllImages=false, timestampToleranceNs=null,
 *                  bundleId, datasetId, datasetRevision, createdAt, metadata }
 */
export function buildAnnotationBundle(annotationManifest, imagePayloadResolver, options = {}) {
  const {
    requireExactSync = false,
    requireAllImages = false,
    timestampToleranceNs = null,
    bundleId = null,
    datasetId = null,
    datasetRevision = null,
    createdAt = null,
    metadata = {}
  } = options;

  const rawRows = Array.isArray(annotationManifest) ? annotationManifest
    : (annotationManifest && Array.isArray(annotationManifest.rows) ? annotationManifest.rows : []);
  const rows = rawRows.map(normRow);
  const hasResolver = typeof imagePayloadResolver === 'function';

  const entries = [];
  const missingEntries = [];
  const rejectedEntries = [];
  const scanSessionIds = new Set();

  for (const row of rows) {
    if (row.scanSessionId) scanSessionIds.add(row.scanSessionId);

    if (row.poseId != null && !SCAN_POSES.includes(row.poseId)) {
      rejectedEntries.push(makeEntry(row, null, EntryOutcome.REJECTED_UNKNOWN_POSE, row.poseId)); continue;
    }
    if (row.syncStatus != null && !KNOWN_SYNC.has(row.syncStatus)) {
      rejectedEntries.push(makeEntry(row, null, EntryOutcome.REJECTED_UNKNOWN_SYNC, row.syncStatus)); continue;
    }
    if (requireExactSync && row.syncStatus !== SyncStatus.EXACT_SYNCHRONIZED) {
      rejectedEntries.push(makeEntry(row, null, EntryOutcome.REJECTED_SYNC_BELOW_EXACT, row.syncStatus)); continue;
    }

    let res;
    if (!hasResolver) {
      res = { status: ImageResolveStatus.UNSUPPORTED, reason: 'no resolver supplied' };
    } else {
      try { res = imagePayloadResolver(imageResolverKeyForRow(row), row); }
      catch (e) { res = { status: ImageResolveStatus.INVALID, reason: `resolver threw: ${e && e.message}` }; }
    }
    if (!res || typeof res !== 'object') res = { status: ImageResolveStatus.INVALID, reason: 'resolver returned non-object' };

    if (res.status === ImageResolveStatus.RESOLVED) {
      const conflict = identityConflict(row, res, timestampToleranceNs);
      if (conflict) { rejectedEntries.push(makeEntry(row, null, EntryOutcome.REJECTED_IDENTITY_CONFLICT, conflict)); continue; }
      if (typeof res.payload !== 'string' || res.payload.length === 0) {
        missingEntries.push(makeEntry(row, null, EntryOutcome.MISSING_INVALID, 'resolver RESOLVED without a string payload')); continue;
      }
      entries.push(makeEntry(row, res, EntryOutcome.RESOLVED));
    } else if (res.status === ImageResolveStatus.NOT_FOUND) {
      missingEntries.push(makeEntry(row, null, EntryOutcome.MISSING_NOT_FOUND, res.reason || null));
    } else if (res.status === ImageResolveStatus.EXPIRED) {
      missingEntries.push(makeEntry(row, null, EntryOutcome.MISSING_EXPIRED, res.reason || null));
    } else {
      missingEntries.push(makeEntry(row, null, EntryOutcome.MISSING_INVALID, res.reason || res.status || null));
    }
  }

  const complete = missingEntries.length === 0 && rejectedEntries.length === 0;
  const buildOk = complete || !requireAllImages;

  return Object.freeze({
    schemaVersion: ANNOTATION_BUNDLE_VERSION,
    bundleId,
    datasetId,
    datasetRevision: numOrNull(datasetRevision),
    createdAt,
    scanSessionIds: Object.freeze([...scanSessionIds].sort()),
    rawImageStorageScope: RawImageStorageScope.LOCAL_ANNOTATION_BUNDLE,
    entries: Object.freeze(entries),
    missingEntries: Object.freeze(missingEntries),
    rejectedEntries: Object.freeze(rejectedEntries),
    complete,
    buildOk,
    buildError: buildOk ? null : `requireAllImages: ${missingEntries.length} missing, ${rejectedEntries.length} rejected`,
    summary: annotationBundleSummary(entries, missingEntries, rejectedEntries, false),
    metadata: Object.freeze({ ...metadata })
  });
}

function identityConflict(row, res, timestampToleranceNs) {
  if (res.imageRef && row.imageRef && res.imageRef !== row.imageRef) return 'imageRef';
  if (res.poseId && row.poseId && res.poseId !== row.poseId) return 'poseId';
  if (res.scanSessionId && row.scanSessionId && String(res.scanSessionId) !== row.scanSessionId) return 'scanSessionId';
  const rts = numOrNull(res.nativeFrameTimestampNs);
  if (rts != null && row.nativeFrameTimestampNs != null) {
    const d = Math.abs(rts - row.nativeFrameTimestampNs);
    if (d !== 0 && (!(typeof timestampToleranceNs === 'number' && Number.isFinite(timestampToleranceNs)) || d > timestampToleranceNs)) {
      return 'nativeFrameTimestampNs';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Privacy-safe derived export (Part 14)
// ---------------------------------------------------------------------------
export function stripRawImages(bundle) {
  const strip = (e) => Object.freeze({
    ...e,
    rawImagePayload: null,
    rawImagePayloadStripped: true,
    bundleImageStatus: BundleImageStatus.ELIGIBLE_FOR_LOCAL_DISCARD
  });
  return Object.freeze({
    ...bundle,
    entries: Object.freeze(bundle.entries.map(strip)),
    missingEntries: bundle.missingEntries,
    rejectedEntries: bundle.rejectedEntries,
    noPixelManifest: true,
    summary: annotationBundleSummary(bundle.entries.map(strip), bundle.missingEntries, bundle.rejectedEntries, true)
  });
}

// ---------------------------------------------------------------------------
// Summary + diagnostics
// ---------------------------------------------------------------------------
export function annotationBundleSummary(entries, missingEntries, rejectedEntries, noPixelManifestAvailable) {
  const perPoseCount = {};
  for (const p of SCAN_POSES) perPoseCount[p] = 0;
  let totalRegionsRequested = 0;
  const uniqueRegions = new Set();
  let exactSyncCount = 0, weakSyncCount = 0, rawBytes = 0;
  for (const e of entries) {
    if (e.poseId && perPoseCount[e.poseId] != null) perPoseCount[e.poseId]++;
    totalRegionsRequested += e.regionsToAnnotate.length;
    for (const r of e.regionsToAnnotate) uniqueRegions.add(r);
    if (e.syncStatus === SyncStatus.EXACT_SYNCHRONIZED) exactSyncCount++; else weakSyncCount++;
    if (typeof e.rawImagePayload === 'string') rawBytes += e.rawImagePayload.length;
  }
  return Object.freeze({
    entryCount: entries.length,
    resolvedImageCount: entries.filter(e => typeof e.rawImagePayload === 'string').length,
    missingImageCount: missingEntries.length,
    rejectedEntryCount: rejectedEntries.length,
    exactSyncCount,
    weakSyncCount,
    perPoseCount: Object.freeze(perPoseCount),
    totalRegionsRequested,
    uniqueRegionsRequested: uniqueRegions.size,
    rawPayloadBytesApprox: rawBytes,
    noPixelManifestAvailable: !!noPixelManifestAvailable
  });
}

/** Concise deterministic text. NEVER contains base64 / dataUrl / raw JPEG. */
export function annotationBundleDiagnosticString(bundle) {
  const s = bundle.summary;
  const mb = (s.rawPayloadBytesApprox / (1024 * 1024)).toFixed(1);
  const lines = [
    'Mettle Annotation Bundle',
    '',
    `entries=${s.entryCount}`,
    `imagesResolved=${s.resolvedImageCount}`,
    `imagesMissing=${s.missingImageCount}`,
    `entriesRejected=${s.rejectedEntryCount}`,
    `exactSync=${s.exactSyncCount}`,
    `weakSync=${s.weakSyncCount}`,
    `regionsRequested=${s.totalRegionsRequested}`,
    `uniqueRegionsRequested=${s.uniqueRegionsRequested}`,
    `rawPayloadApprox=${mb}MB`,
    `noPixelManifestAvailable=${s.noPixelManifestAvailable}`,
    '',
    'poses:'
  ];
  for (const p of SCAN_POSES) lines.push(`  ${p}=${s.perPoseCount[p] || 0}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Serialization (Part 13)
// ---------------------------------------------------------------------------
export function serializeAnnotationBundle(bundle) {
  return JSON.parse(JSON.stringify({ ...bundle, schemaVersion: bundle.schemaVersion || ANNOTATION_BUNDLE_VERSION }));
}
export function deserializeAnnotationBundle(json) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  if (!obj || typeof obj !== 'object') throw new Error('deserializeAnnotationBundle: not an object');
  if (obj.schemaVersion !== ANNOTATION_BUNDLE_VERSION) {
    throw new Error(`deserializeAnnotationBundle: unsupported schemaVersion "${obj.schemaVersion}" (expected "${ANNOTATION_BUNDLE_VERSION}")`);
  }
  const validateEntry = (e, i) => {
    if (e.poseId != null && !SCAN_POSES.includes(e.poseId)) throw new Error(`deserializeAnnotationBundle: entry ${i} invalid poseId "${e.poseId}"`);
    if (e.syncStatus != null && !KNOWN_SYNC.has(e.syncStatus)) throw new Error(`deserializeAnnotationBundle: entry ${i} invalid syncStatus "${e.syncStatus}"`);
    if (e.rawImageFormat != null && !KNOWN_FORMAT.has(e.rawImageFormat)) throw new Error(`deserializeAnnotationBundle: entry ${i} invalid rawImageFormat "${e.rawImageFormat}"`);
    if (e.regionsToAnnotate != null && !Array.isArray(e.regionsToAnnotate)) throw new Error(`deserializeAnnotationBundle: entry ${i} regionsToAnnotate must be an array`);
    if (e.sourceScanObservationId == null) throw new Error(`deserializeAnnotationBundle: entry ${i} missing sourceScanObservationId`);
    return Object.freeze({ ...e });
  };
  return Object.freeze({
    ...obj,
    entries: Object.freeze((obj.entries || []).map(validateEntry)),
    missingEntries: Object.freeze((obj.missingEntries || []).map(e => Object.freeze({ ...e }))),
    rejectedEntries: Object.freeze((obj.rejectedEntries || []).map(e => Object.freeze({ ...e }))),
    scanSessionIds: Object.freeze([...(obj.scanSessionIds || [])])
  });
}

// ---------------------------------------------------------------------------
// GT round-trip template (Part 17) — identity only, NOT a claim that annotation happened
// ---------------------------------------------------------------------------
export function groundTruthLabelTemplateForEntry(entry, anatomicalRegion) {
  return Object.freeze({
    // exact identity fields BS1-F makeGroundTruthLabel / validateLabelAgainstScanPackage expect
    scanSessionId: entry.scanSessionId,
    sourceScanObservationId: entry.sourceScanObservationId,
    imageRef: entry.imageRef,
    nativeFrameTimestampNs: entry.nativeFrameTimestampNs,
    poseId: entry.poseId,
    observedPoseRegion: entry.observedPoseRegion,
    anatomicalRegion: anatomicalRegion != null ? anatomicalRegion : null,
    syncStatus: entry.syncStatus,
    sourceMethod: ObservationMethod.MANUAL_GROUND_TRUTH,
    // explicitly non-committal — a human must fill these; the template asserts nothing
    hairState: HairState.UNKNOWN,
    annotationStatus: 'UNKNOWN',
    annotationConfidence: null,
    _templateNote: 'identity only — no annotation has occurred; a human must set hairState + annotationStatus'
  });
}
