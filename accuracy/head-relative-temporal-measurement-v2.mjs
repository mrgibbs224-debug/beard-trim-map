// Stage BI-1Z1O -- HEAD_RELATIVE_TEMPORAL_MEASUREMENT_V2. Implements the frozen BI-1Z1N design
// (D:\MettleTemp\analysis\bi1z1n_temporal_measurement_v2_design.json, SHA256
// 1c822af649c2ea219cdadb245f0d7d1924a52db2f30a30b8b3939aab9407400c). This is a MEASUREMENT
// INTERPRETATION / PACKAGING layer ONLY -- it consumes accuracy/head-relative-temporal-support-
// v1.mjs's own evaluateCandidatePair() output shape (exactly as accuracy/head-relative-temporal-
// evidence-v1.mjs does) and never re-extracts a patch, never re-runs the local translation search,
// never recomputes ZNCC/gradient-ZNCC/residual itself, never changes patch scale, search radius,
// projection, hypothesis construction, interpolation, pair eligibility, pose/visibility rules, or
// motion-bin definitions. The V1 physical measurement instrument remains completely frozen.
//
// PRIMARY channel (Part 2/3 of BI-1Z1O): residualDifference + a zero-denominator-safe residual
// ratio, both carrying explicit search-boundary-censoring flags (Part 4). SECONDARY/corroborating
// channel (Part 6): deltaZNCC / deltaGradientZNCC, retained unchanged, never promoted, never
// averaged or multiplied into the primary channel. No beard/shirt field, no numeric attachment-
// state calibration (Part 14), no GT, no occupancy dependency, no network.
'use strict';
import { residualDifference as auditResidualDifference, isSearchBoundaryHit, controlRelativeResidual, groupBy, meanOf } from './temporal-metric-robustness-audit.mjs';

export const HEAD_RELATIVE_TEMPORAL_MEASUREMENT_V2_VERSION = 'head-relative-temporal-measurement-v2/1';
export const BI1Z1N_DESIGN_SHA256 = '1c822af649c2ea219cdadb245f0d7d1924a52db2f30a30b8b3939aab9407400c';
export const BI1Z1N_THIRD_SESSION_PROTOCOL_SHA256 = '5f1adb49b3f4560de04d41e80094433c080c80bf732d39e0f647abc2e116c9dd';
export const HEAD_RELATIVE_TEMPORAL_SUPPORT_V1_SOURCE_SHA256 = '818640e3101b3b82ce24b2efdf65b7098a54f660821953637e6c002da5db1e3f';

function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

// ---- Part 3 -- zero-denominator-safe residual ratio, with an explicit state, never a sentinel ----
export const RESIDUAL_RATIO_STATES = Object.freeze(['AVAILABLE', 'DEGENERATE_ZERO_DENOMINATOR', 'UNAVAILABLE']);
export const RESIDUAL_RATIO_EPSILON = 1e-9; // purely numerical guard against a near-zero denominator, never a semantic cutoff
/** headResidualMagnitude / staticResidualMagnitude, guarded against a zero/near-zero or
 *  non-finite denominator. Returns an explicit state instead of Infinity/NaN/a fabricated large
 *  sentinel; raw numerator/denominator are always preserved on the result regardless of state. */
export function safeResidualRatioV2(headResidualMagnitude, staticResidualMagnitude) {
  const base = { headResidualMagnitude: isFiniteNum(headResidualMagnitude) ? headResidualMagnitude : null, staticResidualMagnitude: isFiniteNum(staticResidualMagnitude) ? staticResidualMagnitude : null };
  if (!isFiniteNum(headResidualMagnitude) || !isFiniteNum(staticResidualMagnitude)) return { ...base, state: 'UNAVAILABLE', ratio: null };
  if (Math.abs(staticResidualMagnitude) <= RESIDUAL_RATIO_EPSILON) return { ...base, state: 'DEGENERATE_ZERO_DENOMINATOR', ratio: null };
  return { ...base, state: 'AVAILABLE', ratio: headResidualMagnitude / staticResidualMagnitude };
}

// ---- Part 4 -- search-boundary censoring, never silently treated as an exact optimum -------------
export const CENSORING_STATES = Object.freeze(['HEAD_RESIDUAL_RIGHT_CENSORED', 'STATIC_RESIDUAL_RIGHT_CENSORED']);
/** Determines whether a hypothesis's best local-translation-search match sat on the boundary of
 *  its own (frozen, UNCHANGED) search window -- a structural signal that the measured residual is
 *  a lower-bound-like value under the bounded search, never a claim that the true unconstrained
 *  optimum is numerically known. The raw residual magnitude is always preserved alongside this
 *  flag (Part 4's explicit instruction) -- censoring never deletes or replaces the measurement. */
export function censoringStateFor(dx, dy, searchRadiusPx) {
  const hit = isSearchBoundaryHit(dx, dy, searchRadiusPx);
  if (hit == null) return { boundaryHit: null, censored: false, label: null };
  return { boundaryHit: hit, censored: hit, label: hit ? 'RIGHT_CENSORED' : null };
}

// ---- Part 9 -- authority (unchanged rule set) ------------------------------------------------------
export const AUTHORITY_LEVELS = Object.freeze(['PRIMARY', 'LOWER', 'EXPERIMENTAL_LOW_AUTHORITY']);
const EXPERIMENTAL_LOW_AUTHORITY_FAMILIES = Object.freeze(['DISTAL_LOWER_FACE_ENVELOPE_CANDIDATE']);
const PRIMARY_VALIDATION_CONTROL_FAMILIES = Object.freeze(['HEAD_REFERENCE', 'BACKGROUND_CONTROL']);
export function authorityLevelFor(family, visibilityClass) {
  if (EXPERIMENTAL_LOW_AUTHORITY_FAMILIES.includes(family)) return 'EXPERIMENTAL_LOW_AUTHORITY';
  if (visibilityClass === 'FAR_SIDE') return 'LOWER';
  return 'PRIMARY';
}
export function isPrimaryValidationControl(family) { return PRIMARY_VALIDATION_CONTROL_FAMILIES.includes(family); }

// ---- Part 10 -- quality states (unchanged from V1) -------------------------------------------------
export const QUALITY_STATES = Object.freeze(['PATCH_USABLE', 'PATCH_UNUSABLE', 'PAIR_INELIGIBLE', 'LOW_TEXTURE', 'METRIC_DEGENERATE', 'OUT_OF_BOUNDS', 'GEOMETRY_MISSING', 'CONTROL_INSUFFICIENT']);

// ---- Part 2/6 -- the V2 Temporal Measurement Packet (one per candidate-pair evaluation) -----------
const PROHIBITED_SEMANTIC_FIELD_NAMES = Object.freeze(['isBeard', 'isShirt', 'beardScore', 'shirtScore', 'beardProbability', 'shirtProbability', 'probabilityBeard']);
// Part 14 -- V2 provides measurements, not categorical attachment classification. These names are
// listed ONLY so this module can actively refuse to ever emit them (never as documentation of an
// intended future mapping performed HERE).
const PROHIBITED_STATE_VOCABULARY = Object.freeze(['HEAD_RELATIVE_SUPPORTED', 'HEAD_RELATIVE_LEANING', 'INTERMEDIATE_OR_DEFORMABLE', 'STATIC_RELATIVE_LEANING', 'STATIC_RELATIVE_SUPPORTED']);

/** Builds ONE V2 Temporal Measurement Packet from an already-computed BI-1Z1J-style evaluation
 *  result (evaluateCandidatePair()'s own return shape) plus pair/burst/session context. Never
 *  computes a metric itself -- pure reinterpretation/packaging of already-frozen V1 measurements. */
export function buildTemporalMeasurementV2Packet(spec) {
  const {
    scanSessionId, temporalBurstId, sampleATimestampNs, sampleBTimestampNs, pairIdentity,
    candidateResult, motionBin = null, visibilityClass = null,
    captureSha256 = null, limitations = []
  } = spec;

  const family = candidateResult.family;
  let qualityState = candidateResult.qualityState || 'GEOMETRY_MISSING';
  const authorityLevel = authorityLevelFor(family, visibilityClass);

  const head = candidateResult.headHypothesis, stat = candidateResult.staticHypothesis;
  const headUsable = qualityState === 'PATCH_USABLE' && head && !head.unusable;
  const staticUsable = qualityState === 'PATCH_USABLE' && stat && !stat.unusable;
  const bothUsable = headUsable && staticUsable;

  const headCensor = headUsable ? censoringStateFor(head.bestResidualDx, head.bestResidualDy, candidateResult.searchRadiusPx) : { boundaryHit: null, censored: false, label: null };
  const staticCensor = staticUsable ? censoringStateFor(stat.bestResidualDx, stat.bestResidualDy, candidateResult.searchRadiusPx) : { boundaryHit: null, censored: false, label: null };

  const ratio = bothUsable ? safeResidualRatioV2(head.bestResidualMagnitude, stat.bestResidualMagnitude) : { state: 'UNAVAILABLE', ratio: null, headResidualMagnitude: null, staticResidualMagnitude: null };

  const packet = {
    // identity / provenance
    scanSessionId, temporalBurstId, sampleATimestampNs, sampleBTimestampNs, pairIdentity, candidateIdentity: candidateResult.id,
    patchFamily: family, anatomicalRegion: candidateResult.region ?? null, anatomicalSide: candidateResult.anatomicalSide ?? null,
    visibilityClass, motionBin,

    // ---- PRIMARY: residual-based geometric temporal attachment measurement ----
    headResidualMagnitude: headUsable ? head.bestResidualMagnitude : null,
    staticResidualMagnitude: staticUsable ? stat.bestResidualMagnitude : null,
    residualDifference: bothUsable ? auditResidualDifference(stat.bestResidualMagnitude, head.bestResidualMagnitude) : null,
    residualRatioState: ratio.state,
    residualRatio: ratio.ratio,

    // ---- Part 4: search-boundary censoring -- raw residual is preserved above regardless ----
    headBoundaryHit: headCensor.boundaryHit,
    staticBoundaryHit: staticCensor.boundaryHit,
    headResidualCensored: headCensor.censored,
    staticResidualCensored: staticCensor.censored,
    censoringLabels: [headCensor.censored ? 'HEAD_RESIDUAL_RIGHT_CENSORED' : null, staticCensor.censored ? 'STATIC_RESIDUAL_RIGHT_CENSORED' : null].filter(Boolean),

    // ---- Part 6: SECONDARY / corroborating appearance metrics -- retained unchanged, never promoted ----
    headZncc: headUsable ? head.zncc : null,
    staticZncc: staticUsable ? stat.zncc : null,
    deltaZncc: bothUsable ? (head.zncc - stat.zncc) : null,
    headGradientZncc: headUsable ? head.gradientZncc : null,
    staticGradientZncc: staticUsable ? stat.gradientZncc : null,
    deltaGradientZncc: (headUsable && staticUsable && isFiniteNum(head.gradientZncc) && isFiniteNum(stat.gradientZncc)) ? (head.gradientZncc - stat.gradientZncc) : null,

    // quality / authority (unchanged rule set)
    qualityState, authorityLevel,
    controlAvailability: null, // filled in by attachSamePairControlRelativeResidual() below -- never fabricated here

    // module/design provenance
    sourceModule: 'head-relative-temporal-support-v1', sourceVersion: HEAD_RELATIVE_TEMPORAL_MEASUREMENT_V2_VERSION,
    designSha256: BI1Z1N_DESIGN_SHA256, captureSha256,
    provenanceTags: candidateResult.provenanceTags || [],
    limitations: [...limitations]
  };
  PROHIBITED_SEMANTIC_FIELD_NAMES.forEach(name => { if (name in packet) throw new Error('Prohibited semantic field would have been emitted: ' + name); });
  return packet;
}

// ---- Part 7 -- same-PAIR-only control-relative residual (never cross-pair/burst/session) ----------
function meanUsableResidualDiff(packets) {
  const usable = packets.filter(p => isFiniteNum(p.residualDifference));
  return meanOf(usable.map(p => p.residualDifference));
}
/** Attaches same-PAIR HEAD_REFERENCE/BACKGROUND_CONTROL residual-preference control summaries to
 *  every packet in that pair, via the frozen controlRelativeResidual() primitive
 *  (accuracy/temporal-metric-robustness-audit.mjs, reused unmodified). CONTROL_INSUFFICIENT (never
 *  a fabricated global/discovery-session substitution) when a pair lacks usable control packets. */
export function attachSamePairControlRelativeResidual(pairPackets) {
  const headControlPackets = pairPackets.filter(p => p.patchFamily === 'HEAD_REFERENCE' && isFiniteNum(p.residualDifference));
  const backgroundControlPackets = pairPackets.filter(p => p.patchFamily === 'BACKGROUND_CONTROL' && isFiniteNum(p.residualDifference));
  const headDiffs = headControlPackets.map(p => p.residualDifference);
  const bgDiffs = backgroundControlPackets.map(p => p.residualDifference);
  return pairPackets.map(p => {
    const rel = controlRelativeResidual({ headReferenceResidualDiffs: headDiffs, backgroundControlResidualDiffs: bgDiffs, candidateResidualDiff: p.residualDifference });
    return Object.assign({}, p, {
      controlAvailability: rel.controlAvailability,
      headControlMeanResidualDiff: rel.headControlMeanResidualDiff,
      backgroundControlMeanResidualDiff: rel.backgroundControlMeanResidualDiff,
      controlRelativeResidual: { relativeToHeadControl: rel.candidateRelativeToHeadControl, relativeToBackgroundControl: rel.candidateRelativeToBackgroundControl }
    });
  });
}

// ---- Part 8 -- structural hierarchy (never flattened into a fake independent sample count) --------
function qualityBreakdown(items, qualityOf) {
  const breakdown = {};
  items.forEach(it => { const q = qualityOf(it); breakdown[q] = (breakdown[q] || 0) + 1; });
  return breakdown;
}
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
export function summarizePair(pairPackets, pairIdentity) {
  const withControls = attachSamePairControlRelativeResidual(pairPackets);
  const byFamily = {};
  withControls.forEach(p => { (byFamily[p.patchFamily] = byFamily[p.patchFamily] || []).push(p); });
  const familySummaries = {};
  Object.entries(byFamily).forEach(([fam, pkts]) => { familySummaries[fam] = summarizeCandidateWithinPair(pkts); });
  return {
    pairIdentity, childCount: withControls.length,
    usableChildCount: withControls.filter(p => p.qualityState === 'PATCH_USABLE').length,
    unavailableChildCount: withControls.filter(p => p.qualityState !== 'PATCH_USABLE').length,
    qualityBreakdown: qualityBreakdown(withControls, p => p.qualityState),
    byFamily: familySummaries, packets: withControls
  };
}
export function summarizeBurst(pairSummaries, temporalBurstId) {
  const allPackets = pairSummaries.flatMap(ps => ps.packets);
  return {
    temporalBurstId, pairCount: pairSummaries.length, childCount: allPackets.length,
    usableChildCount: allPackets.filter(p => p.qualityState === 'PATCH_USABLE').length,
    unavailableChildCount: allPackets.filter(p => p.qualityState !== 'PATCH_USABLE').length,
    qualityBreakdown: qualityBreakdown(allPackets, p => p.qualityState),
    pairSummaries
  };
}
export function summarizeScanSession(burstSummaries, scanSessionId) {
  const allPackets = burstSummaries.flatMap(bs => bs.pairSummaries.flatMap(ps => ps.packets));
  return {
    scanSessionId, burstCount: burstSummaries.length,
    pairCount: burstSummaries.reduce((s, b) => s + b.pairCount, 0),
    childCount: allPackets.length,
    usableChildCount: allPackets.filter(p => p.qualityState === 'PATCH_USABLE').length,
    unavailableChildCount: allPackets.filter(p => p.qualityState !== 'PATCH_USABLE').length,
    qualityBreakdown: qualityBreakdown(allPackets, p => p.qualityState),
    independentExperimentalUnitNote: 'This scanSessionId is ONE independent experimental unit. childCount (patch-level evaluations) must never be reported as an independent sample count.',
    burstSummaries
  };
}
export const PATCH_COUNT_IS_NOT_INDEPENDENT_SAMPLE_SIZE = Object.freeze({
  rule: 'A childCount/usableChildCount at the pair/burst/session level counts nested PATCH MEASUREMENTS, never independent subjects, sessions, or physical repetitions. The independent experimental unit for third-session validation is the SCAN SESSION, with burst-level consistency reported beneath it.',
  independentExperimentalUnit: 'SCAN_SESSION'
});

// ---- Part 11 -- third-session prospective endpoint evaluation (directional only, no threshold) ----
/** Evaluates PRIMARY_A_V2 (HEAD_REFERENCE favors head-relative) / PRIMARY_B_V2 (BACKGROUND_CONTROL
 *  favors static) / PRIMARY_C_V2 (directional separation) at the BURST level from already-built
 *  pair summaries, using residualDifference (the PRIMARY V2 channel) exclusively -- deltaZncc is
 *  reported alongside as corroboration only and never participates in this pass/fail judgment. No
 *  numeric threshold from Sessions 1/2 is read by this function; the caller supplies no such value. */
export function evaluateBurstEndpointsV2(burstSummary) {
  const allPackets = burstSummary.pairSummaries.flatMap(ps => ps.packets);
  const headPackets = allPackets.filter(p => p.patchFamily === 'HEAD_REFERENCE' && isFiniteNum(p.residualDifference));
  const bgPackets = allPackets.filter(p => p.patchFamily === 'BACKGROUND_CONTROL' && isFiniteNum(p.residualDifference));
  const headMean = meanOf(headPackets.map(p => p.residualDifference));
  const bgMean = meanOf(bgPackets.map(p => p.residualDifference));
  const headCorroboration = meanOf(headPackets.map(p => p.deltaZncc));
  const bgCorroboration = meanOf(bgPackets.map(p => p.deltaZncc));
  return {
    temporalBurstId: burstSummary.temporalBurstId,
    headResidualDifferenceMean: headMean, backgroundResidualDifferenceMean: bgMean,
    PRIMARY_A_V2_favorsHeadRelative: headMean != null ? headMean > 0 : null,
    PRIMARY_B_V2_favorsStatic: bgMean != null ? bgMean < 0 : null,
    PRIMARY_C_V2_separated: (headMean != null && bgMean != null) ? headMean > bgMean : null,
    corroboration: { headDeltaZnccMean: headCorroboration, backgroundDeltaZnccMean: bgCorroboration }
  };
}
/** Session-level roll-up: counts of bursts individually favoring each endpoint, never a
 *  pooled-only figure (Part 11/BI-1Z1N's anti-masquerade requirement carried forward). */
export function evaluateSessionEndpointsV2(burstSummaries) {
  const perBurst = burstSummaries.map(evaluateBurstEndpointsV2);
  function tally(key) {
    return { favor: perBurst.filter(b => b[key] === true).length, against: perBurst.filter(b => b[key] === false).length, unavailable: perBurst.filter(b => b[key] === null).length, total: perBurst.length };
  }
  return { perBurst, PRIMARY_A_V2: tally('PRIMARY_A_V2_favorsHeadRelative'), PRIMARY_B_V2: tally('PRIMARY_B_V2_favorsStatic'), PRIMARY_C_V2: tally('PRIMARY_C_V2_separated') };
}
