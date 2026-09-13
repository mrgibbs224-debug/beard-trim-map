// Stage BI-1Z1C.1 — RESEARCH-ONLY shared evidence contract (BeardEvidencePacketV1) letting Mettle
// subsystems exchange independent, provenance-tagged evidence without collapsing it into one
// generic confidence score and without circular self-confirmation. Reuses (never modifies) the
// existing locked BS1 region-support table (accuracy/beard-anatomy-map.mjs) and the frozen
// Hairness Core V1 transcription (accuracy/hairness-core-v1.mjs). Never wired into production.
'use strict';
import { SUPPORTED_REGIONS, UNSUPPORTED_REGIONS, MAPPING_EVIDENCE, MappingConfidence } from './beard-anatomy-map.mjs';

export const EVIDENCE_PACKET_VERSION = 'beard-evidence-packet/1';

export const EvidenceChannel = Object.freeze({
  TRACKED_FACE_2D: 'TRACKED_FACE_2D',
  TRACKED_FACE_3D: 'TRACKED_FACE_3D',
  JAW_SUPPORT: 'JAW_SUPPORT',
  POSE_VISIBILITY: 'POSE_VISIBILITY',
  BS1_REGION_SUPPORT: 'BS1_REGION_SUPPORT',
  HAIRNESS_CORE_V1: 'HAIRNESS_CORE_V1',
  SEMANTIC_IMAGE_EVIDENCE: 'SEMANTIC_IMAGE_EVIDENCE',
  MULTIVIEW_SUPPORT: 'MULTIVIEW_SUPPORT',
  EXCLUSION_REGION: 'EXCLUSION_REGION',
  UNKNOWN: 'UNKNOWN'
});

// Distinct from EvidenceChannel (WHICH subsystem produced the signal) -- this is WHAT KIND of
// support that signal carries, per the user's explicit "do not collapse into one confidence"
// instruction.
export const SupportStatus = Object.freeze({
  TRACKED_3D_SUPPORTED: 'TRACKED_3D_SUPPORTED',
  TRACKED_2D_SUPPORTED: 'TRACKED_2D_SUPPORTED',
  MULTIVIEW_SUPPORTED: 'MULTIVIEW_SUPPORTED',
  HAIRNESS_OBSERVED: 'HAIRNESS_OBSERVED',
  IMAGE_APPEARANCE: 'IMAGE_APPEARANCE',
  INFERRED: 'INFERRED',
  PRIOR: 'PRIOR',
  UNSUPPORTED: 'UNSUPPORTED'
});

function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }

/** A single evidence signal. Every field the caller supplies is preserved verbatim; nothing here
 *  ever infers a missing field. `value`/`confidence` are optional (an EXCLUSION_REGION or
 *  UNSUPPORTED signal may carry neither). */
export function makeEvidenceSignal(spec = {}) {
  if (!spec.channel || !Object.values(EvidenceChannel).includes(spec.channel)) {
    throw new Error('makeEvidenceSignal: channel is required and must be a known EvidenceChannel');
  }
  if (!spec.supportStatus || !Object.values(SupportStatus).includes(spec.supportStatus)) {
    throw new Error('makeEvidenceSignal: supportStatus is required and must be a known SupportStatus');
  }
  return Object.freeze({
    channel: spec.channel,
    supportStatus: spec.supportStatus,
    anatomicalRegion: spec.anatomicalRegion ?? null,
    anatomicalSide: spec.anatomicalSide ?? null, // 'LEFT' | 'RIGHT' | 'CENTER' | null
    coordinateSpace: spec.coordinateSpace ?? null,
    value: spec.value === undefined ? null : spec.value,
    confidence: isFiniteNum(spec.confidence) ? spec.confidence : null,
    freshness: spec.freshness ?? null, // e.g. 'VERIFIED_EXACT', 'SAME_FRAME', 'MULTIVIEW', null
    source: spec.source ?? null,       // free-text provenance string, e.g. a module/version name
    limitations: Array.isArray(spec.limitations) ? Object.freeze(spec.limitations.slice()) : Object.freeze([])
  });
}

/** BeardEvidencePacketV1 -- one packet per exact frame. Carries full frame identity so evidence
 *  from different timestamps/sessions is never casually combined (Part 5). */
export function makeBeardEvidencePacket(spec = {}) {
  const required = ['scanSessionId', 'nativeFrameTimestampNs', 'rawObservationId', 'coherenceStatus'];
  required.forEach(k => { if (spec[k] === undefined) throw new Error('makeBeardEvidencePacket: missing required field ' + k); });
  return Object.freeze({
    packetVersion: EVIDENCE_PACKET_VERSION,
    scanSessionId: spec.scanSessionId,
    nativeFrameTimestampNs: spec.nativeFrameTimestampNs,
    rawObservationId: spec.rawObservationId,
    sourceScanObservationId: spec.sourceScanObservationId ?? null,
    coherenceStatus: spec.coherenceStatus, // must be VERIFIED_EXACT for exact-frame work (Part 5)
    observedPoseRegion: spec.observedPoseRegion ?? null,
    yawDeg: isFiniteNum(spec.yawDeg) ? spec.yawDeg : null,
    pitchDeg: isFiniteNum(spec.pitchDeg) ? spec.pitchDeg : null,
    signals: Object.freeze((spec.signals || []).slice())
  });
}

/** Fails closed: throws if any signal's identity fields would imply a different frame than the
 *  packet's own (Part 5/10 -- never casually combine evidence from different timestamps). This
 *  is a structural check, not a confidence heuristic. */
export function assertPacketInternallyConsistent(packet) {
  if (packet.coherenceStatus !== 'VERIFIED_EXACT') {
    throw new Error('assertPacketInternallyConsistent: packet coherenceStatus is not VERIFIED_EXACT');
  }
  return true;
}

// ---- BI-1Z1C.3 -- authoritative recovered Hairness evidence signal ----------------------------
// The single source of truth for the recovered A6.1 ROI's identity, so every Hairness signal this
// stage builds cites it identically (never re-typed/re-guessed per call site).
export const A61_FROZEN_ROI_PROVENANCE = Object.freeze({
  roiSource: 'A61_FROZEN_ROI',
  roiSourceSha256: '683b930cd6b5c05a11bf95302a474420d571a40cc9b014bb6fd22a9f4ed8308c',
  projectionMode: 'FACE_LOCAL_3D_TO_IMAGE_VIA_VIEW_MATRIX_INTRINSICS',
  formulaVersion: 'hairness-core-v1',
  feature: 'HIGH_GRADIENT_FRACTION'
});
// The BI-1Z1C.1 landmark-disk seed-band Hairness values are preserved historically (never
// deleted) but are no longer the active runtime/research evidence source -- superseded by the
// recovered A6.1 ROI replay (BI-1Z1C.2/BI-1Z1C.3). Any signal built with this provenance marker
// must never be treated as HAIRNESS_CORE_V1 ground truth for V2.1 input.
export const OUT_OF_CALIBRATION_ROI_EXPERIMENT_PROVENANCE = Object.freeze({
  roiSource: 'V2_LANDMARK_DISK_SEED_BAND',
  status: 'SUPERSEDED',
  supersededBy: 'A61_FROZEN_ROI',
  supersededAtStage: 'BI-1Z1C.3',
  note: 'Preserved historically for research record (BI-1Z1C.1) -- demonstrates ROI-shape dependence of the classifier, not a Hairness Core V1 validity finding. Must not be consumed as active evidence.'
});

/** One HAIRNESS_CORE_V1 signal for ONE named A6.1 region (JAW_LEFT/JAW_RIGHT/CHIN_BEARD/
 *  SIDEBURN_LEFT/SIDEBURN_RIGHT/CHEEK_LEFT/CHEEK_RIGHT/MOUSTACHE_CENTER). Never blends regions
 *  together -- each keeps its own identity so a caller (e.g. a future V2.1) can decide which
 *  regions are relevant to VISIBLE_LOWER_BEARD_SILHOUETTE rather than this module deciding for
 *  it (Part 4 -- moustache/sideburn evidence must never silently become lower-beard evidence). */
export function makeHairnessEvidenceSignal(spec = {}) {
  const required = ['anatomicalRegion', 'classification', 'highGradientFraction', 'validPixelCount'];
  required.forEach(k => { if (spec[k] === undefined) throw new Error('makeHairnessEvidenceSignal: missing required field ' + k); });
  return makeEvidenceSignal({
    channel: EvidenceChannel.HAIRNESS_CORE_V1,
    supportStatus: SupportStatus.HAIRNESS_OBSERVED,
    anatomicalRegion: spec.anatomicalRegion,
    anatomicalSide: spec.anatomicalSide ?? null,
    coordinateSpace: 'IMAGE',
    value: Object.freeze({
      classification: spec.classification, highGradientFraction: spec.highGradientFraction, validPixelCount: spec.validPixelCount,
      feature: A61_FROZEN_ROI_PROVENANCE.feature, formulaVersion: A61_FROZEN_ROI_PROVENANCE.formulaVersion,
      roiSource: A61_FROZEN_ROI_PROVENANCE.roiSource, roiSourceSha256: A61_FROZEN_ROI_PROVENANCE.roiSourceSha256,
      projectionMode: A61_FROZEN_ROI_PROVENANCE.projectionMode,
      decisionThresholds: Object.freeze({ deadZoneLowerBound: 11.9, deadZoneUpperBound: 14.9 })
    }),
    freshness: spec.freshness ?? 'VERIFIED_EXACT',
    source: 'accuracy/hairness-core-v1.mjs buildA61JawSideburnROIs + runHairnessCoreV1 (recovered A6.1 ROI, BI-1Z1C.2/3)',
    limitations: spec.limitations || ['Hairness classification is EVIDENCE, not a hard beard/non-beard gate -- view-dependent, illumination-dependent, and calibrated on limited historical development data (Part 5).']
  });
}

// ---- BS1 region-support re-export (read-only reuse, never redefined here) --------------------
export const BS1_SUPPORTED_REGIONS = SUPPORTED_REGIONS;
export const BS1_UNSUPPORTED_REGIONS = UNSUPPORTED_REGIONS;
export const BS1_MAPPING_EVIDENCE = MAPPING_EVIDENCE;
export function bs1SupportStatusFor(region) {
  const e = MAPPING_EVIDENCE[region];
  if (!e) return SupportStatus.UNSUPPORTED;
  if (e.confidence === MappingConfidence.UNSUPPORTED) return SupportStatus.UNSUPPORTED;
  return SupportStatus.TRACKED_2D_SUPPORTED; // BS1's DIRECT/PARTIAL landmark mappings are 2D image-space projections of tracked landmarks, never claimed as 3D mesh here
}
