// Stage BS1-C — pure unit tests for the A6 → scan package → Beard Surface projection.
// Node built-in runner (node --test). Zero dependencies.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HairState, ObservationKind, CoordinateSpace, summarizeSurface
} from './beard-surface-core.mjs';
import { SyncStatus, RejectionReason, ObservationPayloadKind, makeScanObservation, makePoseObservationPackage, makeMultiObservationScanPackage } from './multi-observation-scan-package.mjs';
import {
  toCanonicalPose, toScannerStepId, UNKNOWN_POSE, POSE_ID_MAP, SOURCE_A6_DEFAULTS,
  fromA60Export, fromA60BExport, fromA6Exports
} from './a6-scan-package-adapter.mjs';
import {
  MAPPING_EVIDENCE, SUPPORTED_REGIONS, UNSUPPORTED_REGIONS, MAPPED_LANDMARK_INDICES,
  BEARD_ANATOMY_MAP, MappingConfidence
} from './beard-anatomy-map.mjs';
import {
  scanPackageToSurfaceObservations, projectBeardSurface, projectionDiagnosticString
} from './scan-package-to-beard-surface.mjs';

// ---- synthetic fixtures ----
function pts(overrides = {}) {
  const a = Array.from({ length: 468 }, (_, i) => ({ x: (i % 50) * 0.01, y: Math.floor(i / 50) * 0.01, z: (i % 7) * 0.005 }));
  for (const [k, v] of Object.entries(overrides)) a[Number(k)] = v;
  return a;
}
let ts = 1_000_000;
function g(extra = {}) {
  ts += 1000;
  return {
    nativeTs: ts, t: ts / 1000,
    yawDeg: 0, pitchDeg: 0, rollDeg: 0,
    faceCameraX: 0, faceCameraY: 0, faceCameraZ: 0.35,
    transformationMatrix: new Array(16).fill(0),
    landmarks2D: pts(), faceLocal3D: pts(),
    frameWidth: 1080, frameHeight: 1920, mirrored: true, coverageValid: true,
    ...extra
  };
}
function kf(extra = {}) {
  ts += 1000;
  return {
    nativeTs: ts, coherenceStatus: 'VERIFIED_EXACT', rejectReason: null,
    dataUrl: 'data:image/jpeg;base64,AAAA', width: 640, height: 480,
    imageRotationDegrees: 90, imageMirrored: false,
    intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240, imageWidth: 640, imageHeight: 480, space: 'IMAGE' },
    landmarks2D: pts(), faceLocal3D: pts(), transformationMatrix: new Array(16).fill(0),
    imageSpaceViewModelMatrix: new Array(16).fill(0),
    yawDeg: 0, pitchDeg: 0, rollDeg: 0, faceCameraX: 0, faceCameraY: 0, faceCameraZ: 0.35,
    captureLatencyMs: 12,
    ...extra
  };
}
const a60Export = (spec) => {
  const geometryObs = {}, imageKeyframes = {};
  for (const [pose, s] of Object.entries(spec)) {
    geometryObs[pose] = Array.from({ length: s.geom || 0 }, () => g());
    imageKeyframes[pose] = Array.from({ length: s.img || 0 }, () => kf(s.kfExtra || {}));
  }
  return { geometryObs, imageKeyframes };
};

// 1 — A60 right-45 maps explicitly to the right-three-quarter canonical pose.
test('pose-id adapter maps A60 and Scanner vocab to one canonical id', () => {
  assert.equal(toCanonicalPose('right-45'), 'right-45');
  assert.equal(toCanonicalPose('right-three-quarter'), 'right-45');
  assert.equal(toCanonicalPose('left-three-quarter'), 'left-45');
  assert.equal(toScannerStepId('right-45'), 'right-three-quarter');
  assert.equal(POSE_ID_MAP['right-three-quarter'], 'right-45');
});

// 2 — Unknown pose does not fuzzy-map.
test('unknown pose fails closed to UNKNOWN', () => {
  assert.equal(toCanonicalPose('top-down'), UNKNOWN_POSE);
  assert.equal(toCanonicalPose('right'), UNKNOWN_POSE);
  assert.equal(toCanonicalPose(''), UNKNOWN_POSE);
  assert.equal(toCanonicalPose(null), UNKNOWN_POSE);
  const { scanPackage, unmappedPoseKeys } = fromA60Export({ geometryObs: { 'top-down': [g()] }, imageKeyframes: {} });
  assert.deepEqual(unmappedPoseKeys, ['top-down']);
  assert.equal(Object.keys(scanPackage.posePackages).length, 0);
});

// 3 — Realistic synthetic A60 export ingests multiple geometry observations.
test('A60 export ingests multiple geometry observations for one pose', () => {
  const { scanPackage } = fromA60Export(a60Export({ front: { geom: 5 } }));
  assert.equal(scanPackage.posePackages.front.retainedGeometryObservations.length, 5);
  assert.equal(scanPackage.sourceArchitectureVersion, 'A6.0');
});

// 4 — Eight image keyframes for one visible pose survive.
test('eight image keyframes for one pose survive ingest', () => {
  const { scanPackage } = fromA60Export(a60Export({ 'right-45': { img: 8 } }));
  assert.equal(scanPackage.posePackages['right-45'].retainedImageObservations.length, 8);
});

// 5 — Forty geometry observations for one visible pose survive.
test('forty geometry observations for one pose survive ingest', () => {
  const { scanPackage } = fromA60Export(a60Export({ 'left-profile': { geom: 40 } }));
  assert.equal(scanPackage.posePackages['left-profile'].retainedGeometryObservations.length, 40);
});

// 6 — VERIFIED_EXACT SpatialKeyframe remains EXACT_SYNCHRONIZED.
test('VERIFIED_EXACT keyframe stays EXACT_SYNCHRONIZED through packaging', () => {
  const { scanPackage } = fromA60Export(a60Export({ 'chin-up': { img: 3 } }));
  const p = scanPackage.posePackages['chin-up'];
  assert.ok(p.retainedImageObservations.every(k => k.syncStatus === SyncStatus.EXACT_SYNCHRONIZED));
  assert.equal(p.synchronizedObservationPairs.length, 3);
  assert.ok(p.synchronizedObservationPairs.every(pr => pr.syncStatus === SyncStatus.EXACT_SYNCHRONIZED));
});

// 7 — Separate geometryObs is not falsely paired to an imageKeyframe.
test('separate geometryObs is not paired to an imageKeyframe by timestamp', () => {
  const { scanPackage } = fromA60Export(a60Export({ front: { geom: 3, img: 1 } }));
  const p = scanPackage.posePackages.front;
  assert.equal(p.synchronizedObservationPairs.length, 1);           // only the keyframe self-pair
  const geomIds = new Set(p.retainedGeometryObservations.map(o => o.observationId));
  assert.ok(p.synchronizedObservationPairs.every(pr => !geomIds.has(pr.geometry.observationId)));
});

// 8 — Geometry-only observation remains geometry-only.
test('geometry-only observation remains geometry-only', () => {
  const { scanPackage } = fromA60Export(a60Export({ front: { geom: 1 } }));
  const o = scanPackage.posePackages.front.retainedGeometryObservations[0];
  assert.equal(o.payloadKind, ObservationPayloadKind.GEOMETRY_ONLY);
  assert.equal(o.imageRef, null);
});

// 9 — Transition observedPoseRegion survives.
test('A60B transition observedPoseRegion survives ingest', () => {
  const b = {
    manifest: { scannerSessionId: 's1', startedAt: 0 },
    geometryObs: [{ ...g(), currentScannerStep: 'right-three-quarter', observedPoseRegion: 'RIGHT45_TO_RIGHT_PROFILE', observationId: 0 }],
    imageKeyframes: [], formalCaptureAssociations: []
  };
  const { scanPackage } = fromA60BExport(b);
  const o = scanPackage.posePackages['right-45'].retainedGeometryObservations[0];
  assert.equal(o.observedPoseRegion, 'RIGHT45_TO_RIGHT_PROFILE');
  assert.equal(o.poseId, 'right-45'); // formal association kept alongside measured region
});

// 10 — Actual yaw/pitch/roll survive.
test('measured yaw/pitch/roll survive ingest', () => {
  const { scanPackage } = fromA60Export({ geometryObs: { front: [g({ yawDeg: 3.4, pitchDeg: -1.2, rollDeg: 0.7 })] }, imageKeyframes: {} });
  const o = scanPackage.posePackages.front.retainedGeometryObservations[0];
  assert.equal(o.yawDeg, 3.4); assert.equal(o.pitchDeg, -1.2); assert.equal(o.rollDeg, 0.7);
});

// 11 — Quality / rejection provenance survives.
test('quality and rejection provenance survive ingest', () => {
  const b = {
    manifest: { scannerSessionId: 's2', startedAt: 0 },
    geometryObs: [{ ...g(), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: 7, qualityOk: false, qualityReason: 'centerOff', retentionReason: 'TIME_SAMPLE', stableFrames: 4, readyFormalPose: false }],
    imageKeyframes: [{ ...kf({ coherenceStatus: 'REJECTED_UNMATCHED', rejectReason: 'encode failed' }), currentScannerStep: 'front', observationId: 2 }],
    formalCaptureAssociations: []
  };
  const { scanPackage } = fromA60BExport(b);
  const p = scanPackage.posePackages.front;
  const g0 = p.retainedGeometryObservations[0];
  assert.equal(g0.metadata.qualityOk, false);
  assert.equal(g0.metadata.retentionReason, 'TIME_SAMPLE');
  assert.equal(g0.metadata.sourceObservationId, 7);
  const rej = p.rejectedObservations.find(o => o.metadata && o.metadata.rejectReason === 'encode failed');
  assert.ok(rej);
  assert.equal(rej.rejectionReason, RejectionReason.SYNC_UNCERTAIN);
  assert.equal(rej.coherenceStatus, 'REJECTED_UNMATCHED');
});

// 12 — Unknown image quality remains null.
test('unknown image quality stays null (no fabricated sharpness)', () => {
  const { scanPackage } = fromA60Export(a60Export({ front: { img: 1 } }));
  assert.equal(scanPackage.posePackages.front.retainedImageObservations[0].imageQuality, null);
});

// 13 — Anatomy map uses only explicitly supported landmarks.
test('anatomy map is evidence-backed and adds no invented indices', () => {
  for (const r of SUPPORTED_REGIONS) {
    const e = MAPPING_EVIDENCE[r];
    assert.notEqual(e.confidence, MappingConfidence.UNSUPPORTED);
    assert.ok(Array.isArray(e.landmarkIndices) && e.landmarkIndices.length > 0);
    assert.ok(Number.isInteger(e.primaryIndex));
    assert.ok(e.evidenceSource && e.evidenceSource.length > 0);
  }
  for (const r of UNSUPPORTED_REGIONS) {
    assert.equal(MAPPING_EVIDENCE[r].confidence, MappingConfidence.UNSUPPORTED);
    assert.equal(MAPPING_EVIDENCE[r].primaryIndex, undefined);
    assert.ok(MAPPING_EVIDENCE[r].reason);
  }
  // every mapped index is a MediaPipe FaceLandmarker index (0..467)
  assert.ok(MAPPED_LANDMARK_INDICES.every(i => Number.isInteger(i) && i >= 0 && i < 468));
});

// 14 — Unsupported region produces no fake observation.
test('unsupported regions produce no surface observation', () => {
  const { scanPackage } = fromA60Export(a60Export({ front: { geom: 3 } }));
  const { surfaceObservations } = scanPackageToSurfaceObservations(scanPackage);
  const seen = new Set(surfaceObservations.map(o => o.region));
  for (const bad of ['NECK_FRONT', 'UNDER_JAW_CENTER', 'CHIN_NECK_TRANSITION', 'LEFT_SIDEBURN', 'MOUSTACHE_LEFT']) {
    assert.equal(seen.has(bad), false);
  }
  assert.ok(surfaceObservations.every(o => SUPPORTED_REGIONS.includes(o.region)));
});

// 15 — Coordinate-space mismatch is rejected.
test('coordinate-space mismatch is rejected, not silently projected', () => {
  const bad = makeScanObservation({
    observationId: 'x', poseId: 'front', nativeFrameTimestampNs: 1, faceLocal3D: 468,
    faceLocal3DSpace: CoordinateSpace.CAMERA_FRAME,
    metadata: { faceLocal3DPoints: pts() }
  });
  const pkg = makeMultiObservationScanPackage({
    posePackages: { front: makePoseObservationPackage({ poseId: 'front', retainedGeometryObservations: [bad] }) }
  });
  const res = scanPackageToSurfaceObservations(pkg);
  assert.equal(res.surfaceObservations.length, 0);
  assert.ok(res.skipped.wrongSpace >= 1);
});

// 16 — Multiple Front observations remain single-view.
test('multiple Front observations stay single-view', () => {
  const { scanPackage } = fromA60Export(a60Export({ front: { geom: 8 } }));
  const bundle = projectBeardSurface(scanPackage);
  const chin = bundle.personalizedBeardSurface.regions.CHIN_CENTER;
  assert.equal(chin.multiViewSupported, false);
  assert.deepEqual(chin.perPose.map(p => p.pose), ['front']);
  assert.equal(chin.perPose[0].count, 8);
});

// 17 — Front + Right 3/4 can become multi-view.
test('Front + Right 3/4 direct geometry becomes multi-view for a region', () => {
  const { scanPackage } = fromA60Export(a60Export({ front: { geom: 2 }, 'right-45': { geom: 2 } }));
  const bundle = projectBeardSurface(scanPackage);
  const jaw = bundle.personalizedBeardSurface.regions.RIGHT_JAW;
  assert.equal(jaw.multiViewSupported, true);
  assert.equal(jaw.observationKind, ObservationKind.MULTI_VIEW_FUSED);
  assert.deepEqual(jaw.provenance.poses, ['front', 'right-45']);
});

// 18 — Conflicting within-pose geometry preserves disagreement.
test('conflicting within-pose geometry preserves disagreement', () => {
  const a = g({ faceLocal3D: pts({ 152: { x: 0, y: 0, z: 0 } }) });
  const b = g({ faceLocal3D: pts({ 152: { x: 5, y: 5, z: 5 } }) });
  const { scanPackage } = fromA60Export({ geometryObs: { front: [a, b] }, imageKeyframes: {} });
  const bundle = projectBeardSurface(scanPackage, undefined, { toleranceNormalized: 0.001 });
  const chin = bundle.personalizedBeardSurface.regions.CHIN_CENTER;
  assert.equal(chin.disagreement.level, 'HIGH_DISAGREEMENT');
  assert.equal(chin.multiViewSupported, false); // still one pose
  assert.equal(chin.perPose[0].count, 2);
});

// 19 — Missing semantic data remains HairState.UNKNOWN.
test('projected regions carry HairState.UNKNOWN', () => {
  const { scanPackage } = fromA60Export(a60Export({ front: { geom: 2 } }));
  const bundle = projectBeardSurface(scanPackage);
  assert.equal(bundle.personalizedBeardSurface.regions.CHIN_CENTER.hairState, HairState.UNKNOWN);
});

// 20 — semanticConfidence remains null.
test('semanticConfidence stays null after projection', () => {
  const { scanPackage } = fromA60Export(a60Export({ front: { geom: 2 } }));
  const bundle = projectBeardSurface(scanPackage);
  assert.equal(bundle.personalizedBeardSurface.regions.CHIN_CENTER.confidence.semanticConfidence, null);
  assert.equal(bundle.personalizedBeardSurface.regions.CHIN_CENTER.confidence.registrationConfidence, null);
});

// 21 — Image references remain available after surface projection.
test('image references survive projection for BS1-D', () => {
  const { scanPackage } = fromA60Export(a60Export({ front: { geom: 2, img: 4 } }));
  const bundle = projectBeardSurface(scanPackage);
  const kfs = bundle.scanPackage.posePackages.front.retainedImageObservations;
  assert.equal(kfs.length, 4);
  assert.ok(kfs.every(k => typeof k.imageRef.ref === 'string' && k.imageRef.ref.length > 0));
  assert.equal(bundle.projectionSummary.imagesPreservedForSemantics, 4);
});

// 22 — Empty A6 export produces valid empty package / surface.
test('empty A6 export produces a valid empty package and surface', () => {
  const { scanPackage } = fromA60Export({});
  assert.equal(Object.keys(scanPackage.posePackages).length, 0);
  assert.equal(scanPackage.overallQualitySummary.poseCount, 0);
  const bundle = projectBeardSurface(scanPackage);
  assert.equal(bundle.surfaceObservations.length, 0);
  assert.equal(summarizeSurface(bundle.personalizedBeardSurface).regionsObserved, 0);
  assert.equal(bundle.projectionSummary.readyForBeardSurfaceProjection, 'NOT_EVALUATED');
});

// 23 — Projection summary is deterministic.
test('projection summary is deterministic', () => {
  const { scanPackage } = fromA60Export(a60Export({ front: { geom: 3, img: 2 }, 'right-45': { geom: 2 } }));
  const a = projectBeardSurface(scanPackage).projectionSummary;
  const b = projectBeardSurface(scanPackage).projectionSummary;
  assert.deepEqual(a, b);
  assert.equal(typeof projectionDiagnosticString(projectBeardSurface(scanPackage)), 'string');
});

// --- supporting ---

test('fromA6Exports merges A6.0 and A6.0B into one package per pose', () => {
  const a60 = a60Export({ front: { geom: 2, img: 1 } });
  const a60b = {
    manifest: { scannerSessionId: 'sX', startedAt: 0 },
    geometryObs: [{ ...g(), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: 0 }],
    imageKeyframes: [], formalCaptureAssociations: []
  };
  const { scanPackage } = fromA6Exports({ a60, a60b });
  assert.equal(scanPackage.sourceArchitectureVersion, 'A6.0 / A6.0A / A6.0B');
  assert.equal(scanPackage.posePackages.front.retainedGeometryObservations.length, 3); // 2 + 1
  assert.equal(scanPackage.posePackages.front.retainedImageObservations.length, 1);
});

test('SOURCE_A6_DEFAULTS mirror verified constants without being production thresholds', () => {
  assert.equal(SOURCE_A6_DEFAULTS.geometryPerPose, 40);
  assert.equal(SOURCE_A6_DEFAULTS.imagePerPose, 8);
  assert.equal(SOURCE_A6_DEFAULTS.poseDeltaDeg, 4);
  assert.equal(SOURCE_A6_DEFAULTS.distanceDeltaM, 0.015);
});

test('BEARD_ANATOMY_MAP only contains supported regions with a canonical AnatomicalRegion value', () => {
  for (const [k, v] of Object.entries(BEARD_ANATOMY_MAP)) {
    assert.equal(v.region, k);
    assert.ok(v.confidence === MappingConfidence.VERIFIED_DIRECT || v.confidence === MappingConfidence.VERIFIED_PARTIAL);
  }
});

// ---------------------------------------------------------------------------
// BI-1C — real A6.0B exports serialize nativeTs as a decimal STRING, not a number (confirmed
// against a real 29-image / 100-geometry session). The synthetic fixtures above authored
// nativeTs as a JS number throughout, which is why this was missed. These tests pin the fixed
// numOrIntegerString() ingest behaviour directly through the public fromA60BExport() boundary.
// ---------------------------------------------------------------------------

test('BI-1C: numeric nativeTs (pre-existing behaviour) is unaffected', () => {
  const a60b = {
    manifest: { scannerSessionId: 'ts-num', startedAt: 0 },
    geometryObs: [{ ...g(), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: 0 }],
    imageKeyframes: [{ ...kf(), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: 0 }],
    formalCaptureAssociations: []
  };
  const { scanPackage } = fromA60BExport(a60b);
  const pose = scanPackage.posePackages.front;
  assert.equal(pose.retainedGeometryObservations.length, 1);
  assert.equal(pose.retainedImageObservations.length, 1);
  assert.equal(typeof pose.retainedImageObservations[0].timestamp.nativeFrameTimestampNs, 'number');
});

test('BI-1C: real-shaped numeric-string nativeTs is accepted — the actual reproduced defect', () => {
  const realStyleTs = '3416128030189369'; // real 16-digit A6.0B nativeTs shape (session scan_mtcfdr6x_atfvgh)
  const a60b = {
    manifest: { scannerSessionId: 'ts-str', startedAt: 0 },
    geometryObs: [{ ...g({ nativeTs: realStyleTs }), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: 0 }],
    imageKeyframes: [{ ...kf({ nativeTs: realStyleTs }), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: 0 }],
    formalCaptureAssociations: []
  };
  const { scanPackage } = fromA60BExport(a60b);
  const pose = scanPackage.posePackages.front;
  assert.equal(pose.retainedGeometryObservations.length, 1);
  assert.equal(pose.retainedImageObservations.length, 1,
    'a real numeric-string nativeTs must not cause the image to be rejected as MISSING_IMAGE');
  const img = pose.retainedImageObservations[0];
  assert.equal(typeof img.timestamp.nativeFrameTimestampNs, 'number');
  assert.equal(img.timestamp.nativeFrameTimestampNs, Number(realStyleTs));
});

test('BI-1C: malformed nativeTs string fails closed to REJECTED/MISSING_IMAGE, not silently coerced', () => {
  const a60b = {
    manifest: { scannerSessionId: 'ts-malformed', startedAt: 0 },
    geometryObs: [],
    imageKeyframes: [{ ...kf({ nativeTs: '34161-broken-289369' }), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: 0 }],
    formalCaptureAssociations: []
  };
  const { scanPackage } = fromA60BExport(a60b);
  const pose = scanPackage.posePackages.front;
  assert.equal(pose.retainedImageObservations.length, 0);
  assert.ok(pose.rejectedObservations.some(r => r.rejectionReason === RejectionReason.MISSING_IMAGE));
});

test('BI-1C: empty-string nativeTs fails closed exactly like a malformed string', () => {
  const a60b = {
    manifest: { scannerSessionId: 'ts-empty', startedAt: 0 },
    geometryObs: [],
    imageKeyframes: [{ ...kf({ nativeTs: '' }), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: 0 }],
    formalCaptureAssociations: []
  };
  const { scanPackage } = fromA60BExport(a60b);
  assert.equal(scanPackage.posePackages.front.retainedImageObservations.length, 0);
});

test('BI-1C: null/undefined nativeTs fails closed exactly as before this fix (no regression)', () => {
  const a60b = {
    manifest: { scannerSessionId: 'ts-null', startedAt: 0 },
    geometryObs: [],
    imageKeyframes: [
      { ...kf({ nativeTs: null }), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: 0 },
      { ...kf({ nativeTs: undefined }), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: 1 }
    ],
    formalCaptureAssociations: []
  };
  const { scanPackage } = fromA60BExport(a60b);
  assert.equal(scanPackage.posePackages.front.retainedImageObservations.length, 0);
});

test('BI-1C: non-finite numeric nativeTs (NaN/Infinity) fails closed', () => {
  const a60b = {
    manifest: { scannerSessionId: 'ts-nonfinite', startedAt: 0 },
    geometryObs: [],
    imageKeyframes: [
      { ...kf({ nativeTs: NaN }), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: 0 },
      { ...kf({ nativeTs: Infinity }), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: 1 }
    ],
    formalCaptureAssociations: []
  };
  const { scanPackage } = fromA60BExport(a60b);
  assert.equal(scanPackage.posePackages.front.retainedImageObservations.length, 0);
});

test('BI-1C: decimal-point numeric string is rejected — not a valid integer nativeTs form', () => {
  const a60b = {
    manifest: { scannerSessionId: 'ts-decimal', startedAt: 0 },
    geometryObs: [],
    imageKeyframes: [{ ...kf({ nativeTs: '3416128030189369.5' }), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: 0 }],
    formalCaptureAssociations: []
  };
  const { scanPackage } = fromA60BExport(a60b);
  assert.equal(scanPackage.posePackages.front.retainedImageObservations.length, 0);
});

test('BI-1C: whitespace-padded numeric string is rejected, never silently trimmed', () => {
  const a60b = {
    manifest: { scannerSessionId: 'ts-whitespace', startedAt: 0 },
    geometryObs: [],
    imageKeyframes: [{ ...kf({ nativeTs: ' 3416128030189369 ' }), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: 0 }],
    formalCaptureAssociations: []
  };
  const { scanPackage } = fromA60BExport(a60b);
  assert.equal(scanPackage.posePackages.front.retainedImageObservations.length, 0);
});

test('BI-1C: precision-boundary numeric string beyond Number.MAX_SAFE_INTEGER is rejected, never silently corrupted', () => {
  const unsafe = '99999999999999999999'; // far beyond Number.MAX_SAFE_INTEGER — would round if coerced blindly
  const a60b = {
    manifest: { scannerSessionId: 'ts-unsafe', startedAt: 0 },
    geometryObs: [],
    imageKeyframes: [{ ...kf({ nativeTs: unsafe }), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: 0 }],
    formalCaptureAssociations: []
  };
  const { scanPackage } = fromA60BExport(a60b);
  assert.equal(scanPackage.posePackages.front.retainedImageObservations.length, 0);
});

test('BI-1C: real-shaped session (metadata-only fixture matching the real 29-image export) retains every image', () => {
  // Minimal metadata-only fixture matching the shape of the real scan_mtcfdr6x_atfvgh session --
  // no personal image bytes, no real pixel data; only the same field shapes (string nativeTs,
  // real-looking 16-digit magnitude, VERIFIED_EXACT coherence).
  let localTs = 3416128030189369;
  const realTs = () => String(localTs++);
  const a60b = {
    manifest: { scannerSessionId: 'scan_real_shape_test', startedAt: 0 },
    geometryObs: Array.from({ length: 5 }, (_, i) => ({
      ...g({ nativeTs: realTs() }), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: i
    })),
    imageKeyframes: Array.from({ length: 3 }, (_, i) => ({
      ...kf({ nativeTs: realTs() }), currentScannerStep: 'front', observedPoseRegion: 'FRONT_REGION', observationId: i
    })),
    formalCaptureAssociations: []
  };
  const { scanPackage } = fromA60BExport(a60b);
  const pose = scanPackage.posePackages.front;
  assert.equal(pose.retainedGeometryObservations.length, 5);
  assert.equal(pose.retainedImageObservations.length, 3,
    'all real-shaped images must retain — the pre-fix defect produced 0/3 here');
});
