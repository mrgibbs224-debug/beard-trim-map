// Stage BI-1Z1P -- reusable, testable pieces of the third-session validation logic: fresh-session
// identity checking, frozen-hash verification, capture-quality gating, directional endpoint
// counting, and the prospective/historical firewall itself (structurally enforced by function
// signature, not just by convention -- buildProspectiveVerdict() cannot see prior-session data
// because it is never passed to it). Consumes accuracy/head-relative-temporal-measurement-v2.mjs
// and accuracy/temporal-metric-robustness-audit.mjs output shapes; never re-extracts a patch,
// never recomputes ZNCC/gradient/residual, never touches V1/V2/V2.1/V2.2, never loads GT, no
// network, no beard/shirt field.
'use strict';
import { signTally, detectOutliers, meanOf, perPairMean } from './temporal-metric-robustness-audit.mjs';

// ---- fresh-session identity ------------------------------------------------------------------
export function assertFreshSessionIdentity(candidateSessionId, priorSessionIds) {
  if (!candidateSessionId) throw new Error('candidateSessionId is required');
  const collision = priorSessionIds.find(id => id === candidateSessionId);
  if (collision) throw new Error('Session identity collision: ' + candidateSessionId + ' matches a prior session (' + collision + ') -- not a distinct fresh capture.');
  return true;
}

// ---- frozen-hash verification ------------------------------------------------------------------
export function verifyFrozenHashes(checks) {
  const results = checks.map(c => ({ label: c.label, expected: c.expected, actual: c.actual, match: c.actual === c.expected }));
  return { allMatch: results.every(r => r.match), results, mismatches: results.filter(r => !r.match) };
}

// ---- capture-quality gating (does NOT reject merely for a differing sample count) --------------
export function validateCaptureQuality(burstsSummary) {
  // burstsSummary: [{ burstId, sampleCount, allVerifiedExact, timestampsMonotonic, eligiblePairCount, totalPairCount }]
  const reasons = [];
  burstsSummary.forEach(b => {
    if (!b.allVerifiedExact) reasons.push(b.burstId + ': not all samples VERIFIED_EXACT');
    if (!b.timestampsMonotonic) reasons.push(b.burstId + ': timestamps not monotonic');
    if (b.totalPairCount > 0 && b.eligiblePairCount === 0) reasons.push(b.burstId + ': zero eligible pairs');
  });
  return { pass: reasons.length === 0, reasons, sampleCountVariesAcrossBursts: new Set(burstsSummary.map(b => b.sampleCount)).size > 1 };
}

// ---- directional endpoint counting (ties handled explicitly, never coerced into a sign) --------
export function classifyDirectionalCounts(values, eps = 0.05) {
  const t = signTally(values, eps);
  return { positive: t.positive, negative: t.negative, ties: t.nearZero, total: t.total };
}

// ---- outlier-vs-directional-majority cross-check (never deletes) -------------------------------
export function outlierMasqueradeCheck(pairMeans, eps = 0.05) {
  const flags = detectOutliers(pairMeans.map(p => p.mean), 3.5);
  const outlierIdx = new Set(flags.filter(f => f.isOutlier).map(f => f.index));
  const pooled = meanOf(pairMeans.map(p => p.mean));
  const pooledExOutliers = meanOf(pairMeans.filter((p, i) => !outlierIdx.has(i)).map(p => p.mean));
  const majoritySign = classifyDirectionalCounts(pairMeans.map(p => p.mean), eps);
  const majorityAgreesWithPooled = pooled == null ? null : (pooled > 0 ? majoritySign.positive >= majoritySign.negative : majoritySign.negative >= majoritySign.positive);
  return {
    outlierCount: outlierIdx.size, outlierPairKeys: pairMeans.filter((p, i) => outlierIdx.has(i)).map(p => p.pairKey),
    pooledMean: pooled, pooledMeanExcludingOutliers: pooledExOutliers,
    masqueradeSuspected: outlierIdx.size > 0 && pooled != null && pooledExOutliers != null && Math.abs(pooled) > eps && Math.abs(pooled - pooledExOutliers) > Math.abs(pooled) * 0.5,
    majorityAgreesWithPooled
  };
}

// ---- the prospective / historical firewall, enforced structurally ------------------------------
/** Builds the prospective Session-3-only verdict record. STRUCTURALLY cannot read any prior
 *  session's data -- no such parameter exists on this function's signature. */
export function buildProspectiveVerdict({ sessionId, primaryAFavorBursts, primaryATotalBursts, primaryBFavorBursts, primaryBTotalBursts, primaryCFavorBursts, primaryCTotalBursts, primaryAPairMajorityPct, primaryBPairMajorityPct }) {
  const allBurstsFavor = primaryAFavorBursts === primaryATotalBursts && primaryBFavorBursts === primaryBTotalBursts && primaryCFavorBursts === primaryCTotalBursts;
  const strongPairMajority = primaryAPairMajorityPct >= 60 && primaryBPairMajorityPct >= 60;
  let outcome;
  if (allBurstsFavor && strongPairMajority) outcome = 'OUTCOME_A';
  else if (primaryAFavorBursts > 0 && primaryBFavorBursts > 0) outcome = 'OUTCOME_B';
  else outcome = 'OUTCOME_C';
  return { sessionId, outcome, allBurstsFavor, strongPairMajority, determinedFromPriorSessionData: false };
}
/** Historical comparison -- REQUIRES the session-3 verdict to already be a finished object (i.e.
 *  already produced/frozen) before it can even be called; never mutates or returns a revised
 *  outcome for it. */
export function buildHistoricalComparison(frozenSession3Verdict, priorSessionSummaries) {
  if (!frozenSession3Verdict || !frozenSession3Verdict.outcome) throw new Error('Session 3 verdict must already be frozen before historical comparison can run.');
  return {
    session3Outcome: frozenSession3Verdict.outcome, // carried through verbatim, never recomputed here
    comparisons: priorSessionSummaries.map(s => ({ sessionId: s.sessionId, note: 'descriptive only' }))
  };
}

export const THREE_SESSION_SCOPE_LIMITATION = Object.freeze([
  'NOT general-human validation', 'NOT population validation', 'NOT multi-device validation', 'NOT beard-classification validation', 'NOT production readiness'
]);
