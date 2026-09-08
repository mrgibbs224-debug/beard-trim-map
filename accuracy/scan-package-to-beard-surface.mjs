// MultiObservationScanPackage → BS1-A PersonalizedBeardSurface — PURE PROJECTION ADAPTER
// Stage BS1-C. Isolated under accuracy/. Zero runtime imports.
//
// PURPOSE
//   Project the face-local 3D geometry inside a BS1-B scan package onto BS1-A anatomical
//   regions (using the evidence-backed beard-anatomy-map) and build a BS1-A
//   PersonalizedBeardSurface via buildBeardSurface(). The BS1-B scan package — including
//   every retained EXACT_SYNCHRONIZED image reference — is carried through untouched for
//   BS1-D. No hair semantics, no image pixels, no runtime wiring.
//
// COORDINATE-SPACE SAFETY
//   Only `metadata.faceLocal3DPoints` (the raw 468-point face-local array preserved by the
//   A6 ingest adapter) is projected, and only into CoordinateSpace.CANONICAL_FACE_LOCAL.
//   `landmarks2D` (CAPTURE_NORMALIZED) is NEVER projected as canonical 3D — such
//   observations are skipped and counted.

import {
  makeSurfaceObservation,
  buildBeardSurface,
  summarizeSurface,
  CoordinateSpace,
  ObservationMethod,
  ObservationKind,
  HairState,
  median
} from './beard-surface-core.mjs';
import {
  BEARD_ANATOMY_MAP,
  UNSUPPORTED_REGIONS,
  mappingEvidenceRows,
  ANATOMY_MAP_VERSION
} from './beard-anatomy-map.mjs';

export const PROJECTION_VERSION = 'scan-package-to-beard-surface/1';

const CANONICAL = CoordinateSpace.CANONICAL_FACE_LOCAL;
const isFinitePt = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

function groupPosition(points, indices, primaryIndex) {
  const primary = Number.isInteger(primaryIndex) ? points[primaryIndex] : null;
  if (isFinitePt(primary)) {
    return { x: primary.x, y: primary.y, z: primary.z, from: 'primary', n: 1 };
  }
  const pts = indices.map(i => points[i]).filter(isFinitePt);
  if (!pts.length) return null;
  return {
    x: median(pts.map(p => p.x)),
    y: median(pts.map(p => p.y)),
    z: median(pts.map(p => p.z)),
    from: 'group-median',
    n: pts.length
  };
}

/**
 * Turn a MultiObservationScanPackage into an array of BS1-A surface observations.
 *
 * @param {object} scanPackage  BS1-B MultiObservationScanPackage
 * @param {object} [anatomyMap] region -> { region, primaryIndex, landmarkIndices, ... }
 *                              (defaults to the evidence-backed BEARD_ANATOMY_MAP)
 * @param {object} [options]    { includeImageBackedGeometry = true }
 */
export function scanPackageToSurfaceObservations(scanPackage, anatomyMap = BEARD_ANATOMY_MAP, options = {}) {
  const { includeImageBackedGeometry = true } = options;
  const surfaceObservations = [];
  const skipped = { noCanonical3D: 0, wrongSpace: 0, twoDimOnly: 0, regionNoLandmark: 0 };
  const regionObsCount = {};
  const posesContributing = new Set();

  const poses = scanPackage && scanPackage.posePackages ? scanPackage.posePackages : {};
  for (const [poseId, p] of Object.entries(poses)) {
    const contributors = [
      ...p.retainedGeometryObservations,
      ...(includeImageBackedGeometry ? p.retainedImageObservations : [])
    ];
    for (const obs of contributors) {
      if (obs.faceLocal3DSpace && obs.faceLocal3DSpace !== CANONICAL) { skipped.wrongSpace++; continue; }
      const points = obs.metadata && obs.metadata.faceLocal3DPoints;
      if (!Array.isArray(points) || points.length < 400) {
        // no usable canonical 3D — a 2D-only observation is diagnostic only, never canonical
        if (obs.metadata && Array.isArray(obs.metadata.landmarks2DPoints)) skipped.twoDimOnly++;
        else skipped.noCanonical3D++;
        continue;
      }
      for (const [regionKey, entry] of Object.entries(anatomyMap)) {
        const pos = groupPosition(points, entry.landmarkIndices, entry.primaryIndex);
        if (!pos) { skipped.regionNoLandmark++; continue; }
        surfaceObservations.push(makeSurfaceObservation({
          region: entry.region,
          position: { x: pos.x, y: pos.y, z: pos.z },
          space: CANONICAL,
          pose: poseId,
          method: ObservationMethod.LANDMARK_GEOMETRY,
          kind: ObservationKind.DIRECT_GEOMETRY,
          sourceLandmarks: entry.landmarkIndices,
          hairState: HairState.UNKNOWN,        // BS1-C never infers hair
          confidence: null,                    // no fabricated per-observation score
          observedAt: obs.observationId
        }));
        regionObsCount[regionKey] = (regionObsCount[regionKey] || 0) + 1;
        posesContributing.add(poseId);
      }
    }
  }

  return Object.freeze({
    surfaceObservations,
    regionObsCount: Object.freeze(regionObsCount),
    posesContributing: Object.freeze([...posesContributing].sort()),
    skipped: Object.freeze(skipped),
    unsupportedRegions: UNSUPPORTED_REGIONS
  });
}

/**
 * Full BS1-C bundle: scan package (image evidence preserved) + surface observations +
 * BS1-A PersonalizedBeardSurface + deterministic summary + mapping evidence.
 */
export function projectBeardSurface(scanPackage, anatomyMap = BEARD_ANATOMY_MAP, options = {}) {
  const { toleranceNormalized = null, identityId = null } = options;
  const projected = scanPackageToSurfaceObservations(scanPackage, anatomyMap, options);

  const personalizedBeardSurface = buildBeardSurface(projected.surfaceObservations, {
    toleranceNormalized,
    identityId,
    captureMeta: {
      scanSessionId: scanPackage ? scanPackage.scanSessionId : null,
      sourceArchitectureVersion: scanPackage ? scanPackage.sourceArchitectureVersion : null,
      anatomyMapVersion: ANATOMY_MAP_VERSION,
      poses: scanPackage && scanPackage.posePackages ? Object.keys(scanPackage.posePackages) : []
    }
  });

  const evidence = mappingEvidenceRows();
  const projectionSummary = buildProjectionSummary(scanPackage, projected, personalizedBeardSurface, evidence);

  return Object.freeze({
    scanPackage,                       // untouched — retained image refs survive for BS1-D
    surfaceObservations: Object.freeze([...projected.surfaceObservations]),
    personalizedBeardSurface,
    projectionSummary,
    unsupportedRegions: UNSUPPORTED_REGIONS,
    mappingEvidence: Object.freeze(evidence)
  });
}

function buildProjectionSummary(scanPackage, projected, surface, evidence) {
  const o = scanPackage && scanPackage.overallQualitySummary ? scanPackage.overallQualitySummary : {};
  const s = summarizeSurface(surface);

  let imagesPreservedForSemantics = 0;
  let exactImageGeometry = 0;
  const poses = scanPackage && scanPackage.posePackages ? scanPackage.posePackages : {};
  for (const p of Object.values(poses)) {
    imagesPreservedForSemantics += p.retainedImageObservations.filter(k => k.imageRef && k.imageRef.ref).length;
    exactImageGeometry += p.qualitySummary.syncExactCount;
  }

  const byConfidence = { VERIFIED_DIRECT: 0, VERIFIED_PARTIAL: 0, UNSUPPORTED: 0 };
  for (const row of evidence) byConfidence[row.confidence] = (byConfidence[row.confidence] || 0) + 1;

  return Object.freeze({
    projectionVersion: PROJECTION_VERSION,
    anatomyMapVersion: ANATOMY_MAP_VERSION,
    scan: Object.freeze({
      poses: Object.keys(poses).length,
      geometryRetained: o.totalGeometryObservations ?? 0,
      imagesRetained: o.totalImageObservations ?? 0,
      exactImageGeometry
    }),
    surface: Object.freeze({
      regionsObserved: s.regionsObserved,
      regionsUnknown: s.regionsUnknown,
      multiViewRegions: s.multiViewSupportedRegions,
      semanticRegions: s.semanticSupportedRegions,
      highDisagreementRegions: s.highDisagreementRegions,
      overallGeometryCoverage: s.overallGeometryCoverage,
      overallSemanticCoverage: s.overallSemanticCoverage,
      readyForLiveMap: s.readyForLiveMap
    }),
    mapping: Object.freeze({
      verifiedDirect: byConfidence.VERIFIED_DIRECT,
      verifiedPartial: byConfidence.VERIFIED_PARTIAL,
      unsupported: byConfidence.UNSUPPORTED
    }),
    surfaceObservationCount: projected.surfaceObservations.length,
    regionObsCount: projected.regionObsCount,
    posesContributing: projected.posesContributing,
    skipped: projected.skipped,
    imagesPreservedForSemantics,
    readyForBeardSurfaceProjection: 'NOT_EVALUATED'
  });
}

/** Concise deterministic diagnostic. No image payloads, no landmark dumps, no per-frame logging. */
export function projectionDiagnosticString(bundle) {
  const s = bundle.projectionSummary;
  return [
    'BS1-C Projection',
    '',
    'scan:',
    `  poses=${s.scan.poses}`,
    `  geometryRetained=${s.scan.geometryRetained}`,
    `  imagesRetained=${s.scan.imagesRetained}`,
    `  exactImageGeometry=${s.scan.exactImageGeometry}`,
    '',
    'surface:',
    `  regionsObserved=${s.surface.regionsObserved}`,
    `  regionsUnknown=${s.surface.regionsUnknown}`,
    `  multiViewRegions=${s.surface.multiViewRegions}`,
    `  semanticRegions=${s.surface.semanticRegions}`,
    '',
    'mapping:',
    `  verifiedDirect=${s.mapping.verifiedDirect}`,
    `  verifiedPartial=${s.mapping.verifiedPartial}`,
    `  unsupported=${s.mapping.unsupported}`,
    '',
    `imagesPreservedForSemantics=${s.imagesPreservedForSemantics}`,
    `beardSurfaceProjection=${s.readyForBeardSurfaceProjection}`
  ].join('\n');
}
