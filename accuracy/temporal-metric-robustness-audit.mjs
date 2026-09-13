// Stage BI-1Z1N -- exploratory metric-robustness audit utilities for the
// HEAD_RELATIVE_TEMPORAL_SUPPORT_V1 research line. Pure statistics/aggregation only -- this module
// never extracts image patches, never computes ZNCC/gradient/residual itself (it consumes
// accuracy/head-relative-temporal-support-v1.mjs's own evaluateCandidatePair() output shape, exactly
// as accuracy/head-relative-temporal-evidence-v1.mjs does), never fits a semantic beard/shirt
// classifier, never loads GT, never imports V1/V2/V2.1/V2.2, never touches the network or the
// sealed holdout. Used to compare metric reproducibility ACROSS two already-collected scan
// sessions (BI-1Z1J discovery, BI-1Z1M fresh validation) without pooling their patch counts into a
// fake combined sample size.
'use strict';

export const TEMPORAL_METRIC_ROBUSTNESS_AUDIT_V1_VERSION = 'temporal-metric-robustness-audit-v1/1';

function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

// ---- Part 6/7 -- residual comparison primitives --------------------------------------------------
/** staticResidualMagnitude - headResidualMagnitude. Positive means the head-relative prediction
 *  required LESS corrective displacement than the static prediction (favors head-relative). Never
 *  fabricates a value when either input is missing. */
export function residualDifference(staticResidualMagnitude, headResidualMagnitude) {
  if (!isFiniteNum(staticResidualMagnitude) || !isFiniteNum(headResidualMagnitude)) return null;
  return staticResidualMagnitude - headResidualMagnitude;
}
/** headResidualMagnitude / staticResidualMagnitude, guarded against a zero or non-finite
 *  denominator (returns null rather than Infinity/NaN -- "safe" per Part 2/20's zero-denominator
 *  handling requirement). A ratio < 1 means the head-relative prediction needed less correction. */
export function safeResidualRatio(headResidualMagnitude, staticResidualMagnitude) {
  if (!isFiniteNum(headResidualMagnitude) || !isFiniteNum(staticResidualMagnitude)) return null;
  if (staticResidualMagnitude === 0) return null;
  return headResidualMagnitude / staticResidualMagnitude;
}
/** Whether the best local-translation-search offset touched the edge of its own search window --
 *  a structural clipping signal, not a physical one (Part 7). searchRadiusPx is rounded the same
 *  way accuracy/head-relative-temporal-support-v1.mjs's own localTranslationSearch rounds it. */
export function isSearchBoundaryHit(dx, dy, searchRadiusPx) {
  if (!isFiniteNum(dx) || !isFiniteNum(dy) || !isFiniteNum(searchRadiusPx)) return null;
  const r = Math.round(searchRadiusPx);
  if (r <= 0) return false;
  return Math.abs(dx) === r || Math.abs(dy) === r;
}

// ---- generic descriptive-statistics primitives ----------------------------------------------------
export function median(values) {
  const v = values.filter(isFiniteNum).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
export function medianAbsoluteDeviation(values, med = median(values)) {
  if (med == null) return null;
  return median(values.filter(isFiniteNum).map(v => Math.abs(v - med)));
}
/** Flags outliers by robust MAD distance -- NEVER removes or mutates the input. Returns one entry
 *  per finite input value (in original order over the finite subset), each carrying its own
 *  isOutlier flag and deviation, so callers can report every flagged item, not silently drop any
 *  (Part 5's explicit "do not delete outliers" instruction). */
export function detectOutliers(values, multiplier = 3.5) {
  const finite = values.map((v, i) => ({ v, i })).filter(x => isFiniteNum(x.v));
  const vals = finite.map(x => x.v);
  const med = median(vals);
  const mad = medianAbsoluteDeviation(vals, med);
  const scale = mad && mad > 0 ? mad * 1.4826 : null; // normal-consistent MAD scale
  return finite.map(({ v, i }) => {
    const deviation = (med != null) ? v - med : null;
    const robustZ = (scale && deviation != null) ? deviation / scale : null;
    return { index: i, value: v, median: med, deviation, robustZ, isOutlier: robustZ != null ? Math.abs(robustZ) > multiplier : false };
  });
}

// ---- generic grouping / hierarchy helpers ----------------------------------------------------------
export function groupBy(items, keyFn) {
  const map = new Map();
  items.forEach(item => { const k = keyFn(item); if (!map.has(k)) map.set(k, []); map.get(k).push(item); });
  return map;
}
export function meanOf(values) {
  const v = values.filter(isFiniteNum);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}
/** Groups records by pairKeyFn and averages valueFn over each pair -- the level at which
 *  reproducibility should be judged first, before any burst/session pooling (Part 2/3). */
export function perPairMean(records, valueFn, pairKeyFn) {
  const byPair = groupBy(records, pairKeyFn);
  return Array.from(byPair.entries()).map(([pairKey, recs]) => ({
    pairKey, n: recs.length, mean: meanOf(recs.map(valueFn))
  }));
}
/** Counts positive/negative/near-zero among a set of (already pair- or burst-level) values. Purely
 *  descriptive -- picks no semantic cutoff, only a sign-noise epsilon supplied by the caller. */
export function signTally(values, eps = 0.001) {
  let positive = 0, negative = 0, nearZero = 0;
  values.forEach(v => { if (!isFiniteNum(v)) return; if (v > eps) positive++; else if (v < -eps) negative++; else nearZero++; });
  return { positive, negative, nearZero, total: positive + negative + nearZero };
}

// ---- Part 1 -- strict session separation / hierarchy preservation ---------------------------------
export const PATCH_COUNT_IS_NOT_INDEPENDENT_SAMPLE_SIZE = Object.freeze({
  rule: 'A record/pair/burst count is a nested PATCH MEASUREMENT count, never an independent subject or session count. The independent experimental unit remains the SCAN SESSION -- BI-1Z1J discovery and BI-1Z1M fresh are exactly TWO independent units, never pooled into one combined patch total for reproducibility judgments.',
  independentExperimentalUnit: 'SCAN_SESSION'
});
/** Splits records into one bucket per sessionIdOf(record) -- structurally incapable of blending two
 *  sessions' records into a single unlabeled list, since every returned group is keyed by its own
 *  session id. */
export function splitBySession(records, sessionIdOf) {
  return groupBy(records, sessionIdOf);
}
/** Builds a session > burst > pair > patch hierarchy summary (counts only) from a flat record list,
 *  mirroring accuracy/head-relative-temporal-evidence-v1.mjs's own hierarchy invariant so this
 *  exploratory module cannot silently report a flattened, pseudoreplicated patch total as if it
 *  were a session count. */
export function buildHierarchySummary(records, { sessionIdOf, burstIdOf, pairKeyOf }) {
  const sessions = splitBySession(records, sessionIdOf);
  const summary = [];
  sessions.forEach((sessionRecords, sessionId) => {
    const bursts = groupBy(sessionRecords, burstIdOf);
    const burstSummaries = [];
    bursts.forEach((burstRecords, burstId) => {
      const pairs = groupBy(burstRecords, pairKeyOf);
      burstSummaries.push({ burstId, pairCount: pairs.size, patchCount: burstRecords.length });
    });
    summary.push({ sessionId, burstCount: bursts.size, pairCount: burstSummaries.reduce((s, b) => s + b.pairCount, 0), patchCount: sessionRecords.length, burstSummaries });
  });
  return summary;
}

// ---- Part 4 -- stratification wrappers (named per the audit's own required breakdowns) ------------
export function stratifyByMotionBin(records, motionBinOf) { return groupBy(records, motionBinOf); }
export function stratifyByTextureBand(records, textureLevelOf, bands = [3, 8, 16]) {
  return groupBy(records, r => {
    const t = textureLevelOf(r);
    if (!isFiniteNum(t)) return 'UNKNOWN';
    for (let i = 0; i < bands.length; i++) if (t <= bands[i]) return 'BAND_' + i;
    return 'BAND_' + bands.length;
  });
}
export function stratifyByPoseTransition(records, sourceTransitionOf) { return groupBy(records, sourceTransitionOf); }

// ---- Part 8 -- control-relative residual representation (descriptive only, no threshold) ----------
/** Same-PAIR-only representation, directly analogous to BI-1Z1L's attachSamePairControls but
 *  applied to residualDifference instead of deltaZncc. Never reads a different pair/burst/session's
 *  values; CONTROL_INSUFFICIENT (never a fabricated global substitute) when a control regime has no
 *  usable residualDifference in this pair. */
export function controlRelativeResidual({ headReferenceResidualDiffs = [], backgroundControlResidualDiffs = [], candidateResidualDiff }) {
  const headMean = meanOf(headReferenceResidualDiffs);
  const bgMean = meanOf(backgroundControlResidualDiffs);
  const haveHead = headMean != null, haveBg = bgMean != null;
  const controlAvailability = (haveHead && haveBg) ? 'BOTH_AVAILABLE' : (haveHead || haveBg) ? 'PARTIAL_AVAILABLE' : 'CONTROL_INSUFFICIENT';
  return {
    controlAvailability,
    headControlMeanResidualDiff: haveHead ? headMean : null,
    backgroundControlMeanResidualDiff: haveBg ? bgMean : null,
    candidateRelativeToHeadControl: (isFiniteNum(candidateResidualDiff) && haveHead) ? candidateResidualDiff - headMean : null,
    candidateRelativeToBackgroundControl: (isFiniteNum(candidateResidualDiff) && haveBg) ? candidateResidualDiff - bgMean : null
  };
}
