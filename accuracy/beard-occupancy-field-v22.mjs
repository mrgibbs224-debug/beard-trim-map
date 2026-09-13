// Stage BI-1Z1F — V2.2 Beard Occupancy Field: design-fidelity + continuity recovery. A SEPARATE
// research implementation from V2.1 (accuracy/beard-occupancy-field-v21.mjs), which is FROZEN and
// NEVER modified or imported for its field-building logic here (only its pure evidence-lattice
// constants are reused, read-only, for continuity of vocabulary). Never modifies V1, V2, Hairness
// Core V1, BeardEvidencePacketV1, BS1 region support, the jaw rail, or pose confidence -- only
// imports their existing, unmodified exports. Never wired into production or the annotation
// workbench.
'use strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as V21 from './beard-occupancy-field-v21.mjs';
import * as V2 from './beard-proposal-anatomical-seeded-v2.mjs';
import * as H from './hairness-core-v1.mjs';
import * as AM from './beard-anatomy-map.mjs';
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const BP = require(join(HERE, '..', 'tools', 'annotation-workbench', 'beard-proposal.cjs'));

export const V22_ARCHITECTURE_VERSION = 'beard-occupancy-field-v22/1';
export const V21_BASELINE_REFERENCE = Object.freeze({
  note: 'BI-1Z1E frozen baseline this stage builds on top of. V2.1 is never modified or re-run differently here -- its results are reused verbatim in the one-shot comparison table.',
  v21ModuleSha256: '6338d617498d6229f90dfa5f20dc112ec2699060e042be3fee7437a2da397063',
  v21DesignSha256: '0c53aaeb2a84040660d284ec537a832748b85ecc8d67f1ee88daa2a9daf4510a',
  v21ResultsSha256: 'a16fe6fc5f4c5a50cfb35053e9ed380c89b9f0ef87aebbb197100fd99df0ce06',
  fullSuiteAtStart: { total: 696, pass: 696, fail: 0 }
});

// ---- Evidence lattice: reused, read-only, from V2.1 (never redefined) --------------------------
export const EVIDENCE_STATE_ORDER = V21.EVIDENCE_STATE_ORDER;
export const UNCALIBRATED_EVIDENCE_SCORE = V21.UNCALIBRATED_EVIDENCE_SCORE;
export const evidenceOrdinal = V21.evidenceOrdinal;

// ---- FROZEN V2.2 PARAMETERS (Part 16 -- fixed BEFORE any GT is loaded) -------------------------
export const V22_PARAMETERS = Object.freeze({
  gridCellSizePx: 16,
  rootSeedDiskRadiusFactor: 0.20,           // BS1 root seed-disk radius = factor * jawSpanPx (Part 1)
  reachabilityOuterBoundFactor: 4.0,        // beyond factor*jawSpanPx from the rail polyline -> HARD_EXCLUDED (Part 3/4, scale-aware, not a fixed pixel box)
  reachabilityCostGrowthFactor: 0.5,        // per-cell cost multiplier = 1 + (distToRail/jawSpanPx)*this (Part 4 -- smooth, continuous, no wedge-tiling gaps)
  minDarkFractionForPositive: 0.20,         // native-resolution darkFraction (Part 8) >= this -> WEAK_POSITIVE for UNKNOWN-geometry cells
  attachmentCostBudgetFactor: 2.5,          // attachmentCostBudget = this * (jawSpanPx / gridCellSizePx) -- scale-aware, replaces V2.1's fixed 30
  ambiguityMarginFactor: 1.3,               // cost/gap in (budget, budget*factor] => AMBIGUOUS (Part 11), same convention as V2.1
  weakRootActivationCostMultiplier: 1.5,    // a WEAK-tier root's budget is divided by this, same convention as V2.1
  gapToleranceFactor: 0.35,                 // maxGapCost = this * (jawSpanPx / gridCellSizePx) -- scale-aware bounded evidence-gap tolerance (Part 5/6)
  localEvidenceMinState: 'WEAK_POSITIVE',   // the state a cell must reach to RESET a gap run to 0 (Part 5) -- named, resolved via evidenceOrdinal()
  nativeRefinementBandPx: 16,               // Part 9 -- native-pixel refinement band half-width around the coarse boundary
  directionalCostStatus: 'NOT_IMPLEMENTED_BY_DESIGN_CHOICE_B', // Part 14 choice B -- see manifest note; no directional parameter is defined or executed
});

// ---- Part 1/2 -- root eligibility from BS1 anatomy, Hairness kept as independent evidence -------
// The 7 BS1-supported lower-face regions this stage treats as root-ELIGIBLE (anatomy only, not
// appearance). Deliberately excludes MOUSTACHE_CENTER (a supported BS1 region, but not a "beard"
// root in either V2.1's or this stage's scope) and every BS1-UNSUPPORTED region (no invented
// anatomy: UNDER_CHIN/UNDER_JAW_*/NECK_*/CHIN_NECK_TRANSITION remain out of scope exactly as
// beard-anatomy-map.mjs already establishes, unmodified).
export const ROOT_ELIGIBLE_REGIONS = Object.freeze(['CHIN_CENTER', 'CHIN_LEFT', 'CHIN_RIGHT', 'LEFT_JAW', 'RIGHT_JAW', 'LEFT_LOWER_CHEEK', 'RIGHT_LOWER_CHEEK']);
// A61 Hairness ROIs that carry no BS1 root at all -- pure CONTEXTUAL appearance evidence, exactly
// as BI-1Z1C.3 established (BS1 has no verified sideburn/moustache-surface anatomy).
export const CONTEXTUAL_ONLY_A61_REGIONS = Object.freeze(['SIDEBURN_LEFT', 'SIDEBURN_RIGHT', 'MOUSTACHE_CENTER']);

/** Part 2 -- explicit A61-appearance-ROI <-> BS1-anatomical-root relationship table. matchQuality
 *  DIRECT means the a61 ROI corresponds one-to-one with the BS1 region (same jaw-angle landmark
 *  family); PARTIAL means the a61 ROI is broader than the BS1 region (e.g. one whole-chin ROI
 *  covering three BS1 chin sub-regions) -- a real Hairness reading there is real evidence, but
 *  spatially coarser than the BS1 region it is credited to, so activation from a PARTIAL match is
 *  capped at WEAK tier (see buildRootSupportField). NONE means no BS1 root exists for that a61
 *  region (sideburns/moustache) -- it stays purely CONTEXTUAL. This table does NOT redefine BS1
 *  region support and does NOT make a missing match remove root eligibility -- see Part 2 rules. */
export const A61_TO_BS1_EVIDENCE_MAP = Object.freeze({
  JAW_LEFT: { bs1Regions: Object.freeze(['LEFT_JAW']), matchQuality: 'DIRECT' },
  JAW_RIGHT: { bs1Regions: Object.freeze(['RIGHT_JAW']), matchQuality: 'DIRECT' },
  CHIN_BEARD: { bs1Regions: Object.freeze(['CHIN_CENTER', 'CHIN_LEFT', 'CHIN_RIGHT']), matchQuality: 'PARTIAL', note: 'a61_segment.js does not split the chin into left/center/right sub-ROIs; one Hairness reading is shared across all three BS1 chin regions, each capped at WEAK activation tier as a result.' },
  CHEEK_LEFT: { bs1Regions: Object.freeze(['LEFT_LOWER_CHEEK']), matchQuality: 'PARTIAL', note: 'a61 CHEEK_LEFT is a whole-cheek ROI; BS1 LEFT_LOWER_CHEEK is narrower (lower cheek only) -- capped at WEAK.' },
  CHEEK_RIGHT: { bs1Regions: Object.freeze(['RIGHT_LOWER_CHEEK']), matchQuality: 'PARTIAL', note: 'a61 CHEEK_RIGHT is a whole-cheek ROI; BS1 RIGHT_LOWER_CHEEK is narrower (lower cheek only) -- capped at WEAK.' },
  SIDEBURN_LEFT: { bs1Regions: Object.freeze([]), matchQuality: 'NONE' },
  SIDEBURN_RIGHT: { bs1Regions: Object.freeze([]), matchQuality: 'NONE' },
  MOUSTACHE_CENTER: { bs1Regions: Object.freeze([]), matchQuality: 'NONE' }
});
/** Reverse index: BS1 root region -> the single a61 region that provides its DIRECT/PARTIAL
 *  Hairness evidence, or null if none does (CHIN_LEFT/CHIN_RIGHT/LEFT_LOWER_CHEEK/RIGHT_LOWER_CHEEK
 *  never get a DIRECT match in this recovered geometry -- PARTIAL only, or none). */
export const BS1_ROOT_TO_A61_MATCH = Object.freeze(Object.fromEntries(ROOT_ELIGIBLE_REGIONS.map(region => {
  const hit = Object.entries(A61_TO_BS1_EVIDENCE_MAP).find(([, v]) => v.bs1Regions.includes(region));
  return [region, hit ? { a61Region: hit[0], matchQuality: hit[1].matchQuality } : null];
})));

function hairnessClassificationToEvidence(classification) {
  if (classification === 'BEARD_CONFIRMED') return 'STRONG_POSITIVE';
  if (classification === 'NON_BEARD_CONFIRMED') return 'WEAK_NEGATIVE';
  return 'UNKNOWN';
}
function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }
function pointToSegmentDistance(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * abx, cy = a.y + t * aby;
  return Math.hypot(p.x - cx, p.y - cy);
}
function distanceToRailPolyline(p, rail) {
  let best = Infinity;
  for (let i = 0; i < rail.length - 1; i++) best = Math.min(best, pointToSegmentDistance(p, rail[i], rail[i + 1]));
  return best;
}
function sideOfLine(p, line) { return (p.x - line.point.x) * line.normal.x + (p.y - line.point.y) * line.normal.y; }

/** Part 3/4 -- BEARD_REACHABILITY_FIELD_V1: replaces V2's disconnected four-wedge corridor with a
 *  single, continuous, gap-free field. The ONLY hard exclusion is (a) V2's own frozen, scientifically
 *  verified mouth-anchored upper-exclusion line (reused unmodified via V2.buildUpperExclusionLine),
 *  and (b) a generous, scale-normalized outer bound (reachabilityOuterBoundFactor * jawSpanPx) from
 *  the jaw-rail polyline, needed only to keep the attachment graph finite -- never a beard-shaped
 *  template, never a fixed pixel cutoff. Everything else is REACHABLE with a smoothly increasing
 *  cost multiplier the farther a cell sits from the rail (soft, not a wall). */
export function buildReachabilityField(landmarks2D, w, h, manifest = V22_PARAMETERS) {
  if (!landmarks2D) return null; // fails closed rather than crashing -- V2.buildSeedBand assumes a non-null array
  const seed = V2.buildSeedBand(landmarks2D, w, h);
  const exclusionLine = V2.buildUpperExclusionLine(landmarks2D, w, h);
  if (!seed || !exclusionLine) return null;
  const rail = seed.rail, jawSpanPx = seed.jawSpanPx;
  const outerBound = manifest.reachabilityOuterBoundFactor * jawSpanPx;
  const excludedMask = new Uint8Array(w * h);
  const costMultiplierField = new Float32Array(w * h);
  const distField = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const idx = y * w + x;
    if (sideOfLine({ x, y }, exclusionLine) < 0) { excludedMask[idx] = 1; continue; } // above the mouth line -- the one verified hard exclusion
    const d = distanceToRailPolyline({ x, y }, rail);
    distField[idx] = d;
    if (d > outerBound) { excludedMask[idx] = 1; continue; } // generous, scale-normalized outer bound only -- keeps the graph finite
    costMultiplierField[idx] = 1 + (d / jawSpanPx) * manifest.reachabilityCostGrowthFactor;
  }
  return { available: true, excludedMask, costMultiplierField, distField, jawSpanPx, rail, exclusionLine, outerBound };
}

/** Otsu darkness threshold computed ONLY over REACHABLE (non-hard-excluded) pixels -- the
 *  continuous-field analogue of V2.1's corridor-scoped threshold. */
export function computeOtsuOverReachable(gray, reachability) {
  if (!reachability) return null;
  const vals = [];
  for (let i = 0; i < gray.length; i++) if (!reachability.excludedMask[i]) vals.push(gray[i]);
  return vals.length ? BP.otsuThreshold(BP.histogramOf(vals, 256)) : null;
}

function rootSeedDiskMask(center, radius, w, h) {
  const mask = new Uint8Array(w * h);
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(center.x - radius)), x1 = Math.min(w - 1, Math.ceil(center.x + radius));
  const y0 = Math.max(0, Math.floor(center.y - radius)), y1 = Math.min(h - 1, Math.ceil(center.y + radius));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if ((x - center.x) * (x - center.x) + (y - center.y) * (y - center.y) <= r2) mask[y * w + x] = 1;
  }
  return mask;
}

/** Part 1/2/13 -- BEARD_ROOT_SUPPORT_FIELD_V2.2. Root ELIGIBILITY geometry comes ONLY from BS1's
 *  own verified landmark indices (beard-anatomy-map.mjs, unmodified) -- a small seed disk around
 *  each region's primaryIndex, scaled by jawSpanPx. Root ACTIVATION prefers a DIRECT/PARTIAL A61
 *  Hairness match (per A61_TO_BS1_EVIDENCE_MAP) but FALLS BACK to native IMAGE_APPEARANCE evidence
 *  within the root's own seed disk when no matching Hairness ROI is available -- missing Hairness
 *  never erases anatomical eligibility (Part 2/13). Fails closed (activated:false) rather than
 *  guessing when even the appearance fallback has no valid pixels. */
export function buildRootSupportField(landmarks2D, faceLocal3D, vmm, intrinsics, gray, w, h, manifest = V22_PARAMETERS) {
  const reachability = buildReachabilityField(landmarks2D, w, h, manifest);
  if (!reachability) return { available: false, roots: [] };
  const otsuThresh = computeOtsuOverReachable(gray, reachability);
  const a61Polys = H.buildA61JawSideburnROIs(faceLocal3D, vmm, intrinsics);
  const roots = ROOT_ELIGIBLE_REGIONS.map(region => {
    const entry = AM.anatomyMapEntry(region);
    if (!entry) return { region, eligible: false, activated: false, evidenceState: 'UNKNOWN', reason: 'BS1_ENTRY_MISSING' };
    const lm = landmarks2D[entry.primaryIndex];
    if (!lm || !isFiniteNum(lm.x) || !isFiniteNum(lm.y)) return { region, eligible: true, activated: false, evidenceState: 'UNKNOWN', reason: 'LANDMARK_UNAVAILABLE_THIS_FRAME', mask: null };
    const center = { x: lm.x * w, y: lm.y * h };
    const radius = manifest.rootSeedDiskRadiusFactor * reachability.jawSpanPx;
    const mask = rootSeedDiskMask(center, radius, w, h);

    const match = BS1_ROOT_TO_A61_MATCH[region];
    if (match && a61Polys && a61Polys[match.a61Region]) {
      const a61Mask = H.rasterizeA61Polygon(a61Polys[match.a61Region], w, h);
      const hr = H.runHairnessCoreV1(gray, a61Mask, w, h);
      if (hr) {
        let activated, activationTier, evidenceState;
        if (match.matchQuality === 'DIRECT') {
          if (hr.classification === 'BEARD_CONFIRMED') { activated = true; activationTier = 'STRONG'; evidenceState = 'STRONG_POSITIVE'; }
          else if (hr.classification === 'UNCERTAIN') { activated = true; activationTier = 'WEAK'; evidenceState = 'WEAK_POSITIVE'; }
          else { activated = false; activationTier = 'NONE'; evidenceState = 'WEAK_NEGATIVE'; }
        } else { // PARTIAL -- capped at WEAK regardless of classification strength (Part 2 spatial-imprecision cap)
          if (hr.classification === 'NON_BEARD_CONFIRMED') { activated = false; activationTier = 'NONE'; evidenceState = 'WEAK_NEGATIVE'; }
          else { activated = true; activationTier = 'WEAK'; evidenceState = 'WEAK_POSITIVE'; }
        }
        return { region, eligible: true, activated, activationTier, evidenceState, matchedA61Region: match.a61Region, matchQuality: match.matchQuality, provenance: 'HAIRNESS_OBSERVED', hairness: { classification: hr.classification, highGradientFraction: hr.highGradientFraction }, mask, center, radius };
      }
    }
    // No DIRECT/PARTIAL Hairness reading available (no match at all, or zero valid ROI pixels this
    // frame) -- fall back to native IMAGE_APPEARANCE within the root's own seed disk. This is what
    // keeps CHIN_LEFT/CHIN_RIGHT/LEFT_LOWER_CHEEK/RIGHT_LOWER_CHEEK root-ELIGIBLE and activatable
    // even though the recovered A61 geometry never gives them an exact-match ROI (Part 2/13:
    // missing Hairness is missing APPEARANCE evidence, never missing anatomy).
    if (otsuThresh == null) return { region, eligible: true, activated: false, evidenceState: 'UNKNOWN', reason: 'NO_VALID_APPEARANCE_PIXELS', matchedA61Region: match ? match.a61Region : null, matchQuality: match ? match.matchQuality : 'NONE', mask, center, radius };
    let dark = 0, total = 0;
    for (let i = 0; i < mask.length; i++) { if (!mask[i] || reachability.excludedMask[i]) continue; total++; if (gray[i] <= otsuThresh) dark++; }
    if (total === 0) return { region, eligible: true, activated: false, evidenceState: 'UNKNOWN', reason: 'NO_VALID_APPEARANCE_PIXELS', matchedA61Region: match ? match.a61Region : null, matchQuality: match ? match.matchQuality : 'NONE', mask, center, radius };
    const darkFraction = dark / total;
    const activated = darkFraction >= manifest.minDarkFractionForPositive;
    return {
      region, eligible: true, activated, activationTier: activated ? 'WEAK' : 'NONE', evidenceState: activated ? 'WEAK_POSITIVE' : 'WEAK_NEGATIVE',
      matchedA61Region: match ? match.a61Region : null, matchQuality: match ? match.matchQuality : 'NONE', provenance: 'IMAGE_APPEARANCE', appearanceFallbackUsed: true,
      darkFraction, mask, center, radius
    };
  });
  return { available: true, roots, reachability, otsuThresh };
}

/** Part 13 -- CONTEXTUAL_ONLY A61 regions (sideburns/moustache) with no BS1 root at all. Purely
 *  informational appearance evidence for grid-cell tagging; never seeds attachment propagation. */
export function buildContextualEvidence(faceLocal3D, vmm, intrinsics, gray, w, h) {
  const a61Polys = H.buildA61JawSideburnROIs(faceLocal3D, vmm, intrinsics);
  if (!a61Polys) return {};
  const out = {};
  CONTEXTUAL_ONLY_A61_REGIONS.forEach(region => {
    const poly = a61Polys[region];
    if (!poly) { out[region] = { evidenceState: 'UNKNOWN', mask: null }; return; }
    const mask = H.rasterizeA61Polygon(poly, w, h);
    const hr = H.runHairnessCoreV1(gray, mask, w, h);
    out[region] = hr ? { evidenceState: hairnessClassificationToEvidence(hr.classification), hairness: hr, mask } : { evidenceState: 'UNKNOWN', mask };
  });
  return out;
}

/** Part 8 -- coarse deterministic grid, but local evidence for UNKNOWN-geometry cells is derived
 *  from a NATIVE-RESOLUTION darkFraction (fraction of individually-dark reachable pixels in the
 *  cell), not a diluted cell-mean threshold -- a small, strongly-dark sub-region inside an
 *  otherwise-bright cell is not silently erased. Root/contextual cells take their evidence from the
 *  already-resolved root/contextual records (patched in after this pass, matching V2.1's
 *  convention) so the grid and the root field never disagree. */
export function buildEvidenceGrid(landmarks2D, faceLocal3D, vmm, intrinsics, gray, w, h, manifest = V22_PARAMETERS) {
  const reachability = buildReachabilityField(landmarks2D, w, h, manifest);
  if (!reachability) return null;
  const otsuThresh = computeOtsuOverReachable(gray, reachability);
  const rootField = buildRootSupportField(landmarks2D, faceLocal3D, vmm, intrinsics, gray, w, h, manifest);
  const contextual = buildContextualEvidence(faceLocal3D, vmm, intrinsics, gray, w, h);

  const rootMasksByRegion = {};
  (rootField.roots || []).forEach(r => { if (r.mask) rootMasksByRegion[r.region] = r.mask; });
  const contextualMasksByRegion = {};
  Object.entries(contextual).forEach(([region, rec]) => { if (rec.mask) contextualMasksByRegion[region] = rec.mask; });

  const cellSize = manifest.gridCellSizePx;
  const gw = Math.ceil(w / cellSize), gh = Math.ceil(h / cellSize);
  const cells = [];
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const cx0 = gx * cellSize, cy0 = gy * cellSize;
      const cx1 = Math.min(w, cx0 + cellSize), cy1 = Math.min(h, cy0 + cellSize);
      let reachableCount = 0, darkCount = 0, graySum = 0, costMultSum = 0, rootRegion = null, a61Region = null;
      for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
        const idx = y * w + x;
        if (reachability.excludedMask[idx]) continue;
        reachableCount++;
        graySum += gray[idx];
        costMultSum += reachability.costMultiplierField[idx];
        if (otsuThresh != null && gray[idx] <= otsuThresh) darkCount++;
        if (!rootRegion) for (const [name, mask] of Object.entries(rootMasksByRegion)) { if (mask[idx]) { rootRegion = name; break; } }
        if (!a61Region) for (const [name, mask] of Object.entries(contextualMasksByRegion)) { if (mask[idx]) { a61Region = name; break; } }
      }
      if (reachableCount === 0) { cells.push({ gx, gy, geometryStatus: 'HARD_EXCLUDED', rootRegion: null, a61Region: null, meanGray: 255, darkFraction: 0, costMultiplier: 1, localEvidenceState: 'NEGATIVE', provenance: 'PRIOR' }); continue; }
      const meanGray = graySum / reachableCount, darkFraction = darkCount / reachableCount, costMultiplier = costMultSum / reachableCount;
      if (rootRegion) {
        cells.push({ gx, gy, geometryStatus: 'REACHABLE', rootRegion, a61Region: null, meanGray, darkFraction, costMultiplier, localEvidenceState: null, provenance: null }); // patched below from rootField
      } else if (a61Region) {
        cells.push({ gx, gy, geometryStatus: 'REACHABLE', rootRegion: null, a61Region, meanGray, darkFraction, costMultiplier, localEvidenceState: contextual[a61Region].evidenceState, provenance: 'HAIRNESS_OBSERVED' });
      } else {
        const dark = darkFraction >= manifest.minDarkFractionForPositive;
        cells.push({ gx, gy, geometryStatus: 'REACHABLE', rootRegion: null, a61Region: null, meanGray, darkFraction, costMultiplier, localEvidenceState: dark ? 'WEAK_POSITIVE' : 'WEAK_NEGATIVE', provenance: 'IMAGE_APPEARANCE' });
      }
    }
  }
  // patch root-tagged cells from the resolved root field (mirrors V2.1's own two-pass convention)
  const rootEvidenceByRegion = {};
  (rootField.roots || []).forEach(r => { rootEvidenceByRegion[r.region] = { evidenceState: r.evidenceState, provenance: r.provenance || (r.matchQuality && r.matchQuality !== 'NONE' ? 'HAIRNESS_OBSERVED' : 'IMAGE_APPEARANCE') }; });
  cells.forEach(c => { if (c.rootRegion && c.localEvidenceState == null) { const rec = rootEvidenceByRegion[c.rootRegion] || { evidenceState: 'UNKNOWN', provenance: 'PRIOR' }; c.localEvidenceState = rec.evidenceState; c.provenance = rec.provenance; } });

  return { gw, gh, cellSize, cells, otsuThresh, reachability, rootField, contextual };
}

/** Parts 5/6/7/11/12 -- bounded-gap attachment propagation. A path may cross a BOUNDED run of
 *  sub-WEAK_POSITIVE evidence (UNKNOWN or WEAK_NEGATIVE) scaled by jawSpanPx (Part 6); the run
 *  resets to zero the moment real positive evidence resumes (Part 5/7 "continuing local support"
 *  without a fixed maximum beard length). Cells whose accumulated cost OR gap-run exceeds its hard
 *  budget (but not the ambiguity margin) become AMBIGUOUS rather than silently rejected (Part 11).
 *
 *  DESIGN NOTE (Part 12, finding from this stage's own pre-GT synthetic tests): an EARLIER version
 *  of this function additionally hard-rejected any single edge whose raw |meanGray delta| exceeded
 *  a fixed "strong separation" threshold, intended to model Part 12 category B (beard transitioning
 *  into clothing with a strong appearance change). That rule was REMOVED after synthetic testing
 *  showed it is indistinguishable, using grayscale-only evidence, from an ORDINARY short bright
 *  highlight gap within real beard texture -- both produce the same large single-step gray delta,
 *  so the rule either fired on legitimate bounded gaps (breaking Part 5) or, set high enough to
 *  avoid that, never fired at all. Category B is instead handled entirely by the bounded-gap
 *  mechanism itself: a genuine, sustained transition into a different material never recovers
 *  positive evidence, so its gap run keeps growing past maxGap and eventually past maxGapMargin,
 *  naturally becoming unreached (the practical equivalent of "stop / become negative") without a
 *  separate, empirically-unreliable single-step threshold. A short DARK region that happens to be
 *  clothing rather than beard, genuinely indistinguishable from beard in a single grayscale frame,
 *  is an explicitly accepted limitation of static, single-frame evidence (BI-1Z1D's own design
 *  principle: prefer AMBIGUOUS over a manufactured edge; see Part 21's motion-evidence checkpoint
 *  for the real fix). */
export function propagateAttachment(grid, rootField, manifest = V22_PARAMETERS) {
  const cellIndex = (gx, gy) => gy * grid.gw + gx;
  const cellByIdx = new Map(grid.cells.map(c => [cellIndex(c.gx, c.gy), c]));
  const activatedRoots = (rootField.roots || []).filter(r => r.activated);
  const dist = new Map(), gapRun = new Map(), state = new Map(), provenanceOf = new Map();
  if (!activatedRoots.length) return { admitted: dist, state, gapRun, provenance: provenanceOf, noRootsActivated: true };

  const jawSpanPx = grid.reachability ? grid.reachability.jawSpanPx : 0;
  const cellsPerJawSpan = jawSpanPx / manifest.gridCellSizePx;
  const maxGap = manifest.gapToleranceFactor * cellsPerJawSpan;
  const maxGapMargin = maxGap * manifest.ambiguityMarginFactor;
  const budgetFor = (r) => (r && r.activationTier === 'WEAK' ? manifest.attachmentCostBudgetFactor / manifest.weakRootActivationCostMultiplier : manifest.attachmentCostBudgetFactor) * cellsPerJawSpan;
  const minPropagationOrdinal = evidenceOrdinal(manifest.localEvidenceMinState);

  const frontier = [];
  activatedRoots.forEach(r => {
    if (!r.region) return;
    for (const c of grid.cells) {
      if (c.geometryStatus !== 'REACHABLE' || c.rootRegion !== r.region) continue;
      const idx = cellIndex(c.gx, c.gy);
      dist.set(idx, 0); gapRun.set(idx, 0); state.set(idx, 'SUPPORTED');
      provenanceOf.set(idx, { rootRegion: r.region, pathCost: 0, gapRun: 0, contributions: ['ROOT_SEED'] });
      frontier.push(idx);
    }
  });

  let head = 0;
  while (head < frontier.length) {
    const idx = frontier[head++];
    const c = cellByIdx.get(idx);
    if (!c) continue;
    const curCost = dist.get(idx), curGap = gapRun.get(idx), curProv = provenanceOf.get(idx);
    const rootRec = activatedRoots.find(r => r.region === curProv.rootRegion);
    const budget = budgetFor(rootRec), budgetMargin = budget * manifest.ambiguityMarginFactor;
    const neighbors = [[c.gx - 1, c.gy], [c.gx + 1, c.gy], [c.gx, c.gy - 1], [c.gx, c.gy + 1]];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= grid.gw || ny >= grid.gh) continue;
      const nIdx = cellIndex(nx, ny);
      const nCell = cellByIdx.get(nIdx);
      if (!nCell || nCell.geometryStatus === 'HARD_EXCLUDED') continue;
      // stepCost is PURELY the distance-based reachability cost multiplier (Part 4) -- deliberately
      // NOT a raw-meanGray discontinuity penalty. An earlier version added |meanGray delta| here,
      // but that double-penalizes a cell Part 8's darkFraction logic already correctly classified as
      // still-evidence-positive (e.g. a cell half covered by a short bright highlight, mostly dark
      // otherwise): its CELL-MEAN gray still jumps sharply even though the real, native-resolution
      // evidence in it did not, producing a spurious one-step cost spike that could consume most of
      // a root's entire budget crossing a single ordinary highlight cell (caught by this stage's own
      // pre-GT "strong highlight" synthetic test). Real material-boundary cost is instead captured
      // entirely by the gap-run mechanism (Parts 5/6/11), which already keys off darkFraction-derived
      // localEvidenceState, not raw gray.
      const stepCost = nCell.costMultiplier;
      const newCost = curCost + stepCost;
      const nOrdinal = evidenceOrdinal(nCell.localEvidenceState);
      // Gap-run accumulates in the same scale-normalized cell-distance units as stepCost, resetting
      // to zero the instant real positive evidence (>= localEvidenceMinState) resumes (Part 5/6).
      const newGap = nOrdinal >= minPropagationOrdinal ? 0 : curGap + stepCost;
      if (newCost > budgetMargin || newGap > maxGapMargin) continue; // beyond even the ambiguity margin on EITHER axis -- unreachable (each axis is an independent hard limit; an easy cost does not buy extra gap tolerance and vice versa)
      const already = dist.get(nIdx);
      if (already !== undefined && already <= newCost) continue;
      dist.set(nIdx, newCost); gapRun.set(nIdx, newGap);
      const supported = newCost <= budget && newGap <= maxGap;
      state.set(nIdx, supported ? 'SUPPORTED' : 'AMBIGUOUS');
      provenanceOf.set(nIdx, { rootRegion: curProv.rootRegion, pathCost: newCost, gapRun: newGap, contributions: curProv.contributions.concat([supported ? 'PROPAGATED' : 'PROPAGATED_MARGINAL']) });
      frontier.push(nIdx);
    }
  }
  return { admitted: dist, state, gapRun, provenance: provenanceOf, noRootsActivated: false, cellIndex, cellByIdx };
}

/** Part 9 -- native-resolution boundary refinement. Uses ONLY already-available independent
 *  evidence (native per-pixel darkness vs the frame's own Otsu threshold, and the reachability
 *  exclusion mask) -- never human GT, never contour feedback. A band of `bandPx` around the coarse
 *  boundary is reclassified pixel-by-pixel: pixels in the eroded interior of the coarse mask stay
 *  included unconditionally; pixels outside a dilated version of the coarse mask stay excluded
 *  unconditionally; band pixels are included only if individually dark AND 4-connected (via a
 *  bounded flood fill confined to the band) to the eroded interior. */
export function refineNativeBoundary(coarseMask, gray, reachability, otsuThresh, w, h, manifest = V22_PARAMETERS) {
  const r = manifest.nativeRefinementBandPx;
  if (otsuThresh == null) return coarseMask;
  const inverted = new Uint8Array(w * h); for (let i = 0; i < coarseMask.length; i++) inverted[i] = coarseMask[i] ? 0 : 1;
  const erodedCore = new Uint8Array(w * h); { const d = BP.dilateByRadius(inverted, w, h, r); for (let i = 0; i < d.length; i++) erodedCore[i] = d[i] ? 0 : 1; } // erode(mask) = invert(dilate(invert(mask)))
  const dilatedOuter = BP.dilateByRadius(coarseMask, w, h, r);
  const out = new Uint8Array(w * h);
  const bandQueue = [];
  for (let i = 0; i < w * h; i++) {
    if (erodedCore[i]) { out[i] = 1; continue; }
    if (!dilatedOuter[i]) { out[i] = 0; continue; }
    // band pixel: tentatively dark-eligible, connectivity resolved by flood fill below
    if (!reachability.excludedMask[i] && gray[i] <= otsuThresh) bandQueue.push(i);
  }
  // flood-fill from the eroded core through dark band pixels only (bounded to the band by construction: erodedCore pixels are already `out=1`, non-dark/excluded band pixels are never enqueued)
  const bandDark = new Uint8Array(w * h);
  bandQueue.forEach(i => { bandDark[i] = 1; });
  const visited = new Uint8Array(w * h);
  const stack = [];
  for (let i = 0; i < w * h; i++) if (erodedCore[i]) { stack.push(i); visited[i] = 1; }
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % w, y = (idx - x) / w;
    const neigh = [idx - 1, idx + 1, idx - w, idx + w];
    for (const n of neigh) {
      if (n < 0 || n >= w * h || visited[n]) continue;
      if (!(erodedCore[n] || bandDark[n])) continue;
      visited[n] = 1; out[n] = 1; stack.push(n);
    }
  }
  return out;
}

/** Part 10 -- enumerate EVERY supported, root-reachable connected component independently (never
 *  only the first one BP.traceBoundaryMoore happens to find). Each component is isolated into its
 *  own single-component mask before tracing (the tracer itself is reused completely unmodified --
 *  it is simply called once per component instead of once for the whole, possibly multi-blob,
 *  mask), topology-audited, and its contributing root region(s) recovered from the attachment
 *  provenance map. */
export function extractContours(grid, attachment, gray, w, h, manifest = V22_PARAMETERS) {
  const coarseMask = new Uint8Array(w * h);
  const ambiguousMask = new Uint8Array(w * h);
  for (const c of grid.cells) {
    const idx = attachment.cellIndex ? attachment.cellIndex(c.gx, c.gy) : (c.gy * grid.gw + c.gx);
    const st = attachment.state.get(idx);
    if (st !== 'SUPPORTED' && st !== 'AMBIGUOUS') continue;
    const x0 = c.gx * grid.cellSize, y0 = c.gy * grid.cellSize;
    const x1 = Math.min(w, x0 + grid.cellSize), y1 = Math.min(h, y0 + grid.cellSize);
    const target = st === 'SUPPORTED' ? coarseMask : ambiguousMask;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) target[y * w + x] = 1;
  }
  const refined = refineNativeBoundary(coarseMask, gray, grid.reachability, grid.otsuThresh, w, h, manifest);
  const cc = BP.connectedComponents(refined, w, h);
  const components = [];
  for (let lbl = 0; lbl < cc.count; lbl++) {
    const singleMask = new Uint8Array(w * h);
    let area = 0;
    for (let i = 0; i < refined.length; i++) if (cc.labels[i] === lbl) { singleMask[i] = 1; area++; }
    const ring = BP.traceBoundaryMoore(singleMask, w, h);
    let polygon = null, handlePoints = null, topology = null;
    if (ring && ring.length >= 3) {
      polygon = BP.simplifyRDP(ring, 1.5, true);
      handlePoints = BP.reduceToHandles(polygon, 16);
    }
    // recover which root region(s) contributed cells to this component (via the coarse grid, before native refinement)
    const contributingRoots = new Set();
    for (const c of grid.cells) {
      const gidx = attachment.cellIndex ? attachment.cellIndex(c.gx, c.gy) : (c.gy * grid.gw + c.gx);
      if (attachment.state.get(gidx) !== 'SUPPORTED') continue;
      const x0 = c.gx * grid.cellSize, y0 = c.gy * grid.cellSize;
      const centerIdx = Math.min(h - 1, y0 + 8) * w + Math.min(w - 1, x0 + 8);
      if (cc.labels[centerIdx] === lbl) { const prov = attachment.provenance.get(gidx); if (prov) contributingRoots.add(prov.rootRegion); }
    }
    components.push({ label: lbl, mask: singleMask, area, ring, polygon, handlePoints, contributingRoots: [...contributingRoots] });
  }
  components.sort((a, b) => b.area - a.area);
  const primaryMask = new Uint8Array(w * h);
  let totalArea = 0;
  components.forEach(comp => { for (let i = 0; i < refined.length; i++) if (comp.mask[i]) primaryMask[i] = 1; totalArea += comp.area; });
  return { components, primaryMask, ambiguousMask, totalArea, refinedFromCoarseMask: coarseMask };
}

/** Full V2.2 pipeline (research-only). Never reads GT, never reads its own prior output. */
export function runV22Occupancy(frameInputs, options = {}) {
  const manifest = options.manifest || V22_PARAMETERS;
  const { landmarks2D, faceLocal3D, imageSpaceViewModelMatrix, intrinsics, gray, width, height } = frameInputs;
  const rootField = buildRootSupportField(landmarks2D, faceLocal3D, imageSpaceViewModelMatrix, intrinsics, gray, width, height, manifest);
  if (!rootField.available) return { status: 'UNCERTAIN', reason: 'ANATOMY_OR_REACHABILITY_UNAVAILABLE', rootField };
  const grid = buildEvidenceGrid(landmarks2D, faceLocal3D, imageSpaceViewModelMatrix, intrinsics, gray, width, height, manifest);
  if (!grid) return { status: 'UNCERTAIN', reason: 'REACHABILITY_UNAVAILABLE', rootField };
  const attachment = propagateAttachment(grid, rootField, manifest);
  if (attachment.noRootsActivated) {
    return { status: 'NO_BEARD_DETECTED', reason: 'NO_ROOT_ACTIVATED', rootField, grid, attachment, contour: { mask: new Uint8Array(width * height), area: 0, ring: null, polygon: null }, components: [] };
  }
  const extraction = extractContours(grid, attachment, gray, width, height, manifest);
  const ambiguousCells = Array.from(attachment.state.values()).filter(s => s === 'AMBIGUOUS').length;
  const supportedCells = Array.from(attachment.state.values()).filter(s => s === 'SUPPORTED').length;
  const largest = extraction.components[0] || null;
  return {
    status: extraction.totalArea > 0 ? 'OCCUPANCY_RESOLVED' : 'NO_BEARD_DETECTED',
    rootField, grid, attachment, components: extraction.components,
    contour: { mask: extraction.primaryMask, area: extraction.totalArea, ring: largest ? largest.ring : null, polygon: largest ? largest.polygon : null, handlePoints: largest ? largest.handlePoints : null },
    ambiguousMask: extraction.ambiguousMask,
    ambiguitySummary: { ambiguousCellCount: ambiguousCells, supportedCellCount: supportedCells, totalGridCells: grid.cells.length, componentCount: extraction.components.length }
  };
}
