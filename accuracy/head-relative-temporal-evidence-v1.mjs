// Stage BI-1Z1L -- HEAD_RELATIVE_TEMPORAL_SUPPORT_V1's nonsemantic evidence packet + hierarchical
// aggregation machinery. Implements the frozen BI-1Z1K design
// (D:\MettleTemp\analysis\bi1z1k_head_relative_temporal_support_channel_design.json, SHA256
// 2a2f10844c675c88df1d3e651ca8d174888b955428b63bfe4b9050747b11c656). This module does NOT extract
// image patches or compute ZNCC/gradient/residual metrics itself -- it consumes already-computed
// BI-1Z1J-style per-candidate measurements (accuracy/head-relative-temporal-support-v1.mjs's own
// evaluateCandidatePair() output shape) and packages/aggregates them into provenance-preserving,
// hierarchy-preserving, STRICTLY NONSEMANTIC records. No beard/shirt field, no calibrated
// probability, no state-boundary threshold, no V1/V2/V2.1/V2.2 input, no GT.
'use strict';

export const HEAD_RELATIVE_TEMPORAL_EVIDENCE_V1_VERSION = 'head-relative-temporal-evidence-v1/1';
export const BI1Z1K_DESIGN_SHA256 = '2a2f10844c675c88df1d3e651ca8d174888b955428b63bfe4b9050747b11c656';

// ---- Part 8 -- conceptual, unboundaried state vocabulary (schema-level names ONLY) --------------
// No numeric deltaZNCC/gradient/residual value is ever mapped to any of these in this module --
// state-boundary calibration is explicitly deferred (BI-1Z1K Part 8/23). Exported only so a
// future, separately-authorized calibration stage has a stable, already-reviewed vocabulary to
// map onto -- this module itself never performs that mapping.
export const TEMPORAL_ATTACHMENT_STATE_VOCABULARY = Object.freeze([
  'HEAD_RELATIVE_SUPPORTED', 'HEAD_RELATIVE_LEANING', 'INTERMEDIATE_OR_DEFORMABLE',
  'STATIC_RELATIVE_LEANING', 'STATIC_RELATIVE_SUPPORTED', 'UNRESOLVED', 'UNAVAILABLE'
]);

export const QUALITY_AVAILABILITY_STATES = Object.freeze([
  'PATCH_USABLE', 'LOW_TEXTURE', 'OUT_OF_BOUNDS', 'PAIR_INELIGIBLE',
  'CONTROL_INSUFFICIENT', 'GEOMETRY_MISSING', 'METRIC_DEGENERATE', 'FAR_SIDE_LOW_AUTHORITY'
]);

export const AUTHORITY_LEVELS = Object.freeze(['PRIMARY', 'LOWER', 'EXPERIMENTAL_LOW_AUTHORITY']);
// Part 9 -- families whose temporal authority is capped, regardless of how favorable any single
// physical result looks. This restriction is a structural, code-level guarantee, not a per-run
// judgment call.
const EXPERIMENTAL_LOW_AUTHORITY_FAMILIES = Object.freeze(['DISTAL_LOWER_FACE_ENVELOPE_CANDIDATE']);

function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

// ---- Part 2 -- the nonsemantic Temporal Evidence Packet (one per candidate-pair evaluation) -----
const PROHIBITED_FIELD_NAMES = Object.freeze(['isBeard', 'isShirt', 'beardScore', 'shirtScore', 'beardProbability', 'shirtProbability', 'probabilityBeard']);

/** Builds ONE Temporal Evidence Packet from an already-computed BI-1Z1J-style evaluation result
 *  (evaluateCandidatePair()'s own return shape) plus the frame/pair/provenance context. Never
 *  computes a metric itself -- pure packaging. Fails closed (qualityState carried through
 *  honestly) rather than fabricating a value for an unusable candidate. */
export function buildTemporalEvidencePacket(spec) {
  const {
    scanSessionId, subjectSessionIdentifier = null, deviceModel = null,
    temporalBurstId, sampleATimestampNs, sampleBTimestampNs, pairIdentity,
    candidateResult, // the evaluateCandidatePair() result: { id, family, qualityState, headHypothesis, staticHypothesis, ... }
    motionBin = null, visibilityClass = null,
    designSha256, captureSha256, sourceModule = 'head-relative-temporal-support-v1', sourceVersion = null,
    limitations = []
  } = spec;

  const family = candidateResult.family;
  let qualityState = candidateResult.qualityState || 'GEOMETRY_MISSING';
  let authorityLevel = 'PRIMARY';
  if (EXPERIMENTAL_LOW_AUTHORITY_FAMILIES.includes(family)) authorityLevel = 'EXPERIMENTAL_LOW_AUTHORITY';
  else if (visibilityClass === 'FAR_SIDE') authorityLevel = 'LOWER';

  const head = candidateResult.headHypothesis, stat = candidateResult.staticHypothesis;
  const headUsable = qualityState === 'PATCH_USABLE' && head && !head.unusable;
  const staticUsable = qualityState === 'PATCH_USABLE' && stat && !stat.unusable;
  const bothUsable = headUsable && staticUsable;

  const packet = {
    // identity / provenance
    scanSessionId, subjectSessionIdentifier, deviceModel, temporalBurstId,
    sampleATimestampNs, sampleBTimestampNs, pairIdentity, candidateIdentity: candidateResult.id,
    patchFamily: family, anatomicalRegion: candidateResult.region ?? null, anatomicalSide: candidateResult.anatomicalSide ?? null,
    visibilityClass, motionBin,
    // raw metrics -- honestly null (never 0 or fabricated) when the underlying hypothesis was unusable
    headZncc: headUsable ? head.zncc : null,
    staticZncc: staticUsable ? stat.zncc : null,
    deltaZncc: bothUsable ? (head.zncc - stat.zncc) : null,
    headGradientZncc: headUsable ? head.gradientZncc : null,
    staticGradientZncc: staticUsable ? stat.gradientZncc : null,
    deltaGradientZncc: (headUsable && staticUsable && isFiniteNum(head.gradientZncc) && isFiniteNum(stat.gradientZncc)) ? (head.gradientZncc - stat.gradientZncc) : null,
    headResidualDx: headUsable ? head.bestResidualDx : null,
    headResidualDy: headUsable ? head.bestResidualDy : null,
    headResidualMagnitude: headUsable ? head.bestResidualMagnitude : null,
    staticResidualDx: staticUsable ? stat.bestResidualDx : null,
    staticResidualDy: staticUsable ? stat.bestResidualDy : null,
    staticResidualMagnitude: staticUsable ? stat.bestResidualMagnitude : null,
    residualComparison: bothUsable ? (stat.bestResidualMagnitude - head.bestResidualMagnitude) : null,
    // quality / authority
    qualityState, textureState: qualityState === 'LOW_TEXTURE' ? 'LOW_TEXTURE' : (qualityState === 'PATCH_USABLE' ? 'TEXTURED' : 'UNKNOWN'),
    controlAvailability: null, // filled in by attachSamePairControls() below -- never fabricated here
    authorityLevel,
    // conceptual state -- deliberately left UNRESOLVED (never computed from a numeric threshold, Part 8/23)
    conceptualState: bothUsable ? 'UNRESOLVED' : 'UNAVAILABLE',
    // module/design provenance
    sourceModule, sourceVersion: sourceVersion || HEAD_RELATIVE_TEMPORAL_EVIDENCE_V1_VERSION,
    designSha256, captureSha256,
    provenanceTags: candidateResult.provenanceTags || [],
    limitations: [...limitations]
  };
  PROHIBITED_FIELD_NAMES.forEach(name => { if (name in packet) throw new Error('Prohibited semantic field would have been emitted: ' + name); });
  return packet;
}

// ---- Part 5/6 -- same-pair control representation (descriptive only, no classifier) -------------
function meanUsableDeltaZncc(packets) {
  const usable = packets.filter(p => isFiniteNum(p.deltaZncc));
  return usable.length ? usable.reduce((s, p) => s + p.deltaZncc, 0) / usable.length : null;
}
/** Attaches same-PAIR (never cross-pair, never cross-session) HEAD_REFERENCE/BACKGROUND_CONTROL
 *  descriptive anchors to every packet in that pair. Sets controlAvailability + descriptive
 *  relative quantities; never a classifier cutoff. CONTROL_INSUFFICIENT (not a fabricated global
 *  substitution) when a pair lacks enough usable control packets of a given kind. */
export function attachSamePairControls(pairPackets, minUsableControlCount = 1) {
  const headControlPackets = pairPackets.filter(p => p.patchFamily === 'HEAD_REFERENCE' && isFiniteNum(p.deltaZncc));
  const backgroundControlPackets = pairPackets.filter(p => p.patchFamily === 'BACKGROUND_CONTROL' && isFiniteNum(p.deltaZncc));
  const headControlDeltaZncc = headControlPackets.length >= minUsableControlCount ? meanUsableDeltaZncc(headControlPackets) : null;
  const backgroundControlDeltaZncc = backgroundControlPackets.length >= minUsableControlCount ? meanUsableDeltaZncc(backgroundControlPackets) : null;
  return pairPackets.map(p => {
    const haveHead = headControlDeltaZncc != null, haveBackground = backgroundControlDeltaZncc != null;
    const controlAvailability = (haveHead && haveBackground) ? 'BOTH_AVAILABLE' : (haveHead || haveBackground) ? 'PARTIAL_AVAILABLE' : 'CONTROL_INSUFFICIENT';
    return Object.assign({}, p, {
      controlAvailability,
      headControlDeltaZncc: haveHead ? headControlDeltaZncc : null,
      backgroundControlDeltaZncc: haveBackground ? backgroundControlDeltaZncc : null,
      candidateRelativeToHeadControl: (isFiniteNum(p.deltaZncc) && haveHead) ? (p.deltaZncc - headControlDeltaZncc) : null,
      candidateRelativeToBackgroundControl: (isFiniteNum(p.deltaZncc) && haveBackground) ? (p.deltaZncc - backgroundControlDeltaZncc) : null
    });
  });
}

// ---- Part 3/4 -- structural hierarchy (never flattened into a fake independent sample count) ----
function qualityBreakdown(items, qualityOf) {
  const breakdown = {};
  items.forEach(it => { const q = qualityOf(it); breakdown[q] = (breakdown[q] || 0) + 1; });
  return breakdown;
}
/** PATCH MEASUREMENT -> CANDIDATE SUMMARY WITHIN PAIR. One packet per candidate is already the
 *  "patch measurement" level in this design (a candidate IS one patch-pair evaluation) -- this
 *  function groups packets sharing a candidateIdentity+family (in case a future stage evaluates
 *  the same anchor more than once within a pair), never inflating the count. */
export function summarizeCandidateWithinPair(packets) {
  return {
    childCount: packets.length,
    usableChildCount: packets.filter(p => p.qualityState === 'PATCH_USABLE').length,
    unavailableChildCount: packets.filter(p => p.qualityState !== 'PATCH_USABLE').length,
    qualityBreakdown: qualityBreakdown(packets, p => p.qualityState),
    childPacketIds: packets.map(p => p.candidateIdentity),
    packets
  };
}
/** PAIR SUMMARY -- groups all candidate packets for one (sampleA,sampleB) pair, by family, and
 *  attaches same-pair controls (Part 5/6). */
export function summarizePair(pairPackets, pairIdentity) {
  const withControls = attachSamePairControls(pairPackets);
  const byFamily = {};
  withControls.forEach(p => { (byFamily[p.patchFamily] = byFamily[p.patchFamily] || []).push(p); });
  const familySummaries = {};
  Object.entries(byFamily).forEach(([fam, pkts]) => { familySummaries[fam] = summarizeCandidateWithinPair(pkts); });
  return {
    pairIdentity,
    childCount: withControls.length,
    usableChildCount: withControls.filter(p => p.qualityState === 'PATCH_USABLE').length,
    unavailableChildCount: withControls.filter(p => p.qualityState !== 'PATCH_USABLE').length,
    qualityBreakdown: qualityBreakdown(withControls, p => p.qualityState),
    byFamily: familySummaries,
    packets: withControls
  };
}
/** BURST SUMMARY -- groups all pair summaries within one temporalBurstId. Retains references to
 *  every constituent pair summary (never discards lower-level records). */
export function summarizeBurst(pairSummaries, temporalBurstId) {
  const allPackets = pairSummaries.flatMap(ps => ps.packets);
  return {
    temporalBurstId,
    pairCount: pairSummaries.length,
    childCount: allPackets.length,
    usableChildCount: allPackets.filter(p => p.qualityState === 'PATCH_USABLE').length,
    unavailableChildCount: allPackets.filter(p => p.qualityState !== 'PATCH_USABLE').length,
    qualityBreakdown: qualityBreakdown(allPackets, p => p.qualityState),
    pairSummaries
  };
}
/** SCAN SESSION SUMMARY -- groups all burst summaries within one scanSessionId. This is the
 *  independent experimental unit for validation purposes (Part 4/BI-1Z1K's pseudoreplication
 *  invariant) -- NOT the patch count. */
export function summarizeScanSession(burstSummaries, scanSessionId) {
  const allPackets = burstSummaries.flatMap(bs => bs.pairSummaries.flatMap(ps => ps.packets));
  return {
    scanSessionId,
    burstCount: burstSummaries.length,
    pairCount: burstSummaries.reduce((s, b) => s + b.pairCount, 0),
    childCount: allPackets.length,
    usableChildCount: allPackets.filter(p => p.qualityState === 'PATCH_USABLE').length,
    unavailableChildCount: allPackets.filter(p => p.qualityState !== 'PATCH_USABLE').length,
    qualityBreakdown: qualityBreakdown(allPackets, p => p.qualityState),
    independentExperimentalUnitNote: 'This scanSessionId is ONE independent experimental unit. childCount (patch-level evaluations) must never be reported as an independent sample count -- see PATCH_COUNT_IS_NOT_INDEPENDENT_SUBJECT_COUNT below.',
    burstSummaries
  };
}

// ---- Part 4 -- explicit pseudoreplication invariant, enforced structurally ----------------------
export const PATCH_COUNT_IS_NOT_INDEPENDENT_SUBJECT_COUNT = Object.freeze({
  rule: 'A childCount/usableChildCount at the pair/burst/session level counts nested PATCH MEASUREMENTS, never independent subjects, sessions, or physical repetitions. The independent experimental unit for validation purposes is the SCAN SESSION (summarizeScanSession\'s own identity), with burst-level repeatability reported beneath it.',
  independentExperimentalUnit: 'SCAN_SESSION'
});
/** Structural assertion helper: throws if a caller tries to treat a session summary's own
 *  childCount as if it were a count of independent sessions -- used by this module's own tests,
 *  and available for any future report-generation code to call defensively. */
export function assertNotPseudoreplicated(claimedIndependentUnitCount, sessionSummaries) {
  if (claimedIndependentUnitCount > sessionSummaries.length) {
    throw new Error('Pseudoreplication: claimed ' + claimedIndependentUnitCount + ' independent units but only ' + sessionSummaries.length + ' scan session(s) are present.');
  }
  return true;
}
