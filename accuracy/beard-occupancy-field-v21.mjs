// Stage BI-1Z1E — RESEARCH-ONLY implementation of the frozen BI-1Z1D V2.1 design
// (D:\MettleTemp\analysis\bi1z1d_beard_occupancy_field_v21_design.json,
// SHA256 0c53aaeb2a84040660d284ec537a832748b85ecc8d67f1ee88daa2a9daf4510a). Implements the four
// required components (BEARD_ROOT_SUPPORT_FIELD_V1, BEARD_ENVELOPE_SUPPORT_FIELD_V1,
// BEARD_ATTACHMENT_CONTINUITY_V1, BEARD_EXCLUSION_FIELD_V1) as ONE cohesive pipeline. Never
// modifies beard-proposal/1, beard-proposal-anatomical-seeded/2, Hairness Core V1 thresholds, the
// jaw rail, or BS1 support tables -- it only IMPORTS their existing, unmodified exports. Never
// wired into production or the annotation workbench.
'use strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as V2 from './beard-proposal-anatomical-seeded-v2.mjs';
import * as H from './hairness-core-v1.mjs';
import * as EP from './beard-evidence-packet-v1.mjs';
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const BP = require(join(HERE, '..', 'tools', 'annotation-workbench', 'beard-proposal.cjs'));

export const V21_ARCHITECTURE_VERSION = 'beard-occupancy-field-v21/1';
export const V21_DESIGN_SHA256 = '0c53aaeb2a84040660d284ec537a832748b85ecc8d67f1ee88daa2a9daf4510a';

// ---- FROZEN V2.1 PARAMETERS (Part 17 -- fixed BEFORE any GT is loaded) ------------------------
export const V21_PARAMETERS = Object.freeze({
  gridCellSizePx: 16,                 // coarse grid cell size (640x480 -> 40x30 cells)
  attachmentCostBudget: 30,           // max accumulated path cost from an activated root
  ambiguityMarginFactor: 1.3,         // cost in [budget, budget*factor] with valid local evidence => AMBIGUOUS, not rejected outright
  discontinuityPenaltyDivisor: 10,    // per-step cost += |meanGray delta| / this
  directionPenaltyDivisorDeg: 30,     // per-step cost += angleDeviationDeg / this
  weakRootActivationCostMultiplier: 1.5, // a WEAK (UNCERTAIN-Hairness) root's budget is divided by this before propagating
  localEvidenceMinState: 'WEAK_POSITIVE' // named, not a raw ordinal number -- resolved via evidenceOrdinal() at use-site to avoid an index/enum mismatch bug (caught by this stage's own synthetic tests before any GT was loaded)
});

// ---- Evidence states (Part 6 / BI-1Z1D) -- ordinal lattice, never a probability ----------------
export const EVIDENCE_STATE_ORDER = Object.freeze(['NEGATIVE', 'WEAK_NEGATIVE', 'UNKNOWN', 'WEAK_POSITIVE', 'POSITIVE', 'STRONG_POSITIVE']);
export const UNCALIBRATED_EVIDENCE_SCORE = Object.freeze({ NEGATIVE: -2, WEAK_NEGATIVE: -1, UNKNOWN: 0, WEAK_POSITIVE: 1, POSITIVE: 2, STRONG_POSITIVE: 3 });
export function evidenceOrdinal(state) { return EVIDENCE_STATE_ORDER.indexOf(state); }

// Root-eligible / lower-beard regions this implementation has honest recovered geometry for
// (JAW_LEFT/JAW_RIGHT/CHIN_BEARD map to BS1's LEFT_JAW/RIGHT_JAW/CHIN_CENTER, already identified
// as "part of VISIBLE_LOWER_BEARD_SILHOUETTE" in BI-1Z1C.3). CHEEK_LEFT/CHEEK_RIGHT/
// SIDEBURN_LEFT/SIDEBURN_RIGHT/MOUSTACHE_CENTER remain CONTEXTUAL ONLY, exactly as BI-1Z1C.3
// established -- narrower than the design's illustrative 7-region list (which also named
// LEFT/RIGHT_LOWER_CHEEK and CHIN_LEFT/CHIN_RIGHT as candidates) because the recovered
// a61_segment.js geometry does not split chin/cheek into those exact sub-regions; this scope
// narrowing is an honest implementation-time decision, not a silent deviation.
export const ROOT_ELIGIBLE_REGIONS = Object.freeze(['JAW_LEFT', 'JAW_RIGHT', 'CHIN_BEARD']);
export const CONTEXTUAL_REGIONS = Object.freeze(['SIDEBURN_LEFT', 'SIDEBURN_RIGHT', 'CHEEK_LEFT', 'CHEEK_RIGHT', 'MOUSTACHE_CENTER']);

function hairnessClassificationToEvidence(classification) {
  if (classification === 'BEARD_CONFIRMED') return 'STRONG_POSITIVE';
  if (classification === 'NON_BEARD_CONFIRMED') return 'WEAK_NEGATIVE'; // Part 2 -- geometry stays valid, evidence only mildly negative
  return 'UNKNOWN'; // UNCERTAIN Hairness classification maps to the neutral point, not WEAK_POSITIVE -- see Part 7 root-activation rule below for how UNCERTAIN is actually used for ROOTS specifically
}

/** Part 7 -- BEARD_ROOT_SUPPORT_FIELD_V1. Returns one record per eligible region with ELIGIBILITY
 *  (fixed geometric fact) kept structurally separate from ACTIVATION (requires real positive
 *  Hairness evidence -- Part 2). Never reads GT. Fails closed (activated:false) on missing
 *  geometry/Hairness rather than guessing. */
export function buildRootSupportField(landmarks2D, faceLocal3D, vmm, intrinsics, gray, w, h) {
  const polys = H.buildA61JawSideburnROIs(faceLocal3D, vmm, intrinsics);
  if (!polys) return { available: false, roots: [] };
  const roots = ROOT_ELIGIBLE_REGIONS.map(region => {
    const poly = polys[region];
    if (!poly) return { region, eligible: true, activated: false, evidenceState: 'UNKNOWN', reason: 'ROI_UNAVAILABLE_THIS_FRAME', hairness: null, mask: null };
    const mask = H.rasterizeA61Polygon(poly, w, h);
    const hr = H.runHairnessCoreV1(gray, mask, w, h);
    if (!hr) return { region, eligible: true, activated: false, evidenceState: 'UNKNOWN', reason: 'NO_VALID_HAIRNESS_PIXELS', hairness: null, mask };
    // Part 2 root-activation rule (distinct from the generic hairnessClassificationToEvidence map,
    // which is used for CONTEXTUAL regions instead -- roots specifically need "strong activation /
    // weak-conditional activation / not-activated" tiers, not a flat evidence lattice value).
    let activated, activationTier, evidenceState;
    if (hr.classification === 'BEARD_CONFIRMED') { activated = true; activationTier = 'STRONG'; evidenceState = 'STRONG_POSITIVE'; }
    else if (hr.classification === 'UNCERTAIN') { activated = true; activationTier = 'WEAK'; evidenceState = 'WEAK_POSITIVE'; }
    else { activated = false; activationTier = 'NONE'; evidenceState = 'WEAK_NEGATIVE'; } // NON_BEARD_CONFIRMED: geometry stays eligible, root not activated
    return { region, eligible: true, activated, activationTier, evidenceState, hairness: { classification: hr.classification, highGradientFraction: hr.highGradientFraction }, mask };
  });
  return { available: true, roots };
}

/** Part 11 -- BEARD_EXCLUSION_FIELD_V1. HARD_EXCLUDED = outside V2's corridor entirely, or above
 *  the verified mouth-anchored upper-exclusion line (both reused unmodified from V2). Everything
 *  else inside the corridor is only ever SOFT_NEGATIVE (from local appearance), never hard. */
export function buildExclusionField(landmarks2D, w, h) {
  const corridor = V2.buildAnatomicalCorridor(landmarks2D, w, h);
  if (!corridor) return null;
  const corridorMask = V2.rasterizeCorridor(corridor, w, h);
  return { corridor, corridorMask, hardExclusionRule: 'outside corridor OR above mouth-anchored upper-exclusion line (both from frozen V2, unmodified)' };
}

function cellCenterToImage(cx, cy, cellSize) { return { x: cx * cellSize + cellSize / 2, y: cy * cellSize + cellSize / 2 }; }

/** Part 5 -- builds the coarse deterministic grid: per-cell geometryStatus (SUPPORTED region name,
 *  UNKNOWN, or null if hard-excluded/out-of-corridor), meanGray, and localEvidenceState (from real
 *  Hairness if the cell falls in a named a61 region, else from IMAGE_APPEARANCE Otsu-relative
 *  darkness -- explicitly tagged, never confused with Hairness). */
export function buildEvidenceGrid(landmarks2D, faceLocal3D, vmm, intrinsics, gray, w, h, manifest = V21_PARAMETERS) {
  const exclusion = buildExclusionField(landmarks2D, w, h);
  if (!exclusion) return null;
  const polys = H.buildA61JawSideburnROIs(faceLocal3D, vmm, intrinsics) || {};
  const regionMasks = {};
  Object.entries(polys).forEach(([name, poly]) => { regionMasks[name] = H.rasterizeA61Polygon(poly, w, h); });

  // Otsu darkness threshold for IMAGE_APPEARANCE fallback, computed ONLY within the corridor
  // (same principled scoping V2 used) -- generic utility reuse, never claims to be Hairness.
  const corridorVals = [];
  for (let i = 0; i < gray.length; i++) if (exclusion.corridorMask[i]) corridorVals.push(gray[i]);
  const otsuThresh = corridorVals.length ? BP.otsuThreshold(BP.histogramOf(corridorVals, 256)) : null;

  const cellSize = manifest.gridCellSizePx;
  const gw = Math.ceil(w / cellSize), gh = Math.ceil(h / cellSize);
  const cells = [];
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const cx0 = gx * cellSize, cy0 = gy * cellSize;
      const cx1 = Math.min(w, cx0 + cellSize), cy1 = Math.min(h, cy0 + cellSize);
      let inCorridor = 0, total = 0, graySumInCorridor = 0, region = null;
      for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
        const idx = y * w + x; total++;
        if (exclusion.corridorMask[idx]) { inCorridor++; graySumInCorridor += gray[idx]; } // mean is over IN-CORRIDOR pixels only -- averaging in out-of-corridor background would dilute sparse coverage far from the rail (caught by this stage's own synthetic long-beard test before any GT was loaded)
        if (!region) for (const [name, mask] of Object.entries(regionMasks)) { if (mask[idx]) { region = name; break; } }
      }
      if (inCorridor === 0) { cells.push({ gx, gy, geometryStatus: 'HARD_EXCLUDED', region: null, meanGray: 255, localEvidenceState: 'NEGATIVE', provenance: 'PRIOR' }); continue; }
      const meanGray = graySumInCorridor / inCorridor;
      if (region) {
        cells.push({ gx, gy, geometryStatus: 'SUPPORTED', region, meanGray, localEvidenceState: null, provenance: 'HAIRNESS_OBSERVED' }); // evidenceState filled in from region Hairness by caller
      } else {
        const dark = otsuThresh != null && meanGray <= otsuThresh; // inclusive: a cell exactly at the adaptive threshold still counts as dark (matters at low pixel-count/degenerate-histogram edges; harmless for real, naturally-varying images)
        cells.push({ gx, gy, geometryStatus: 'UNKNOWN', region: null, meanGray, localEvidenceState: dark ? 'WEAK_POSITIVE' : 'WEAK_NEGATIVE', provenance: 'IMAGE_APPEARANCE' });
      }
    }
  }
  return { gw, gh, cellSize, cells, otsuThresh, exclusion };
}

/** Parts 8/9 -- BEARD_ENVELOPE_SUPPORT_FIELD_V1 + BEARD_ATTACHMENT_CONTINUITY_V1. Multi-source
 *  Dijkstra-style propagation from ACTIVATED roots over the coarse grid. A neighbor is admitted
 *  ONLY if (a) its own localEvidenceState clears localEvidenceMinStateForPropagation (Part 1/8 --
 *  "continuing local evidence required") AND (b) accumulated path cost stays within budget. Cells
 *  passing (a) but landing in [budget, budget*ambiguityMarginFactor] are AMBIGUOUS, never silently
 *  rejected as flat negative. Never selects a single largest component -- every root-reachable
 *  region is included (Part 19/9). */
export function propagateAttachment(grid, rootField, manifest = V21_PARAMETERS) {
  const cellIndex = (gx, gy) => gy * grid.gw + gx;
  const cellByIdx = new Map(grid.cells.map(c => [cellIndex(c.gx, c.gy), c]));
  // fill in region-cell evidence from the root/contextual Hairness results
  const regionEvidence = {};
  (rootField.roots || []).forEach(r => { regionEvidence[r.region] = r.evidenceState; });
  grid.cells.forEach(c => { if (c.geometryStatus === 'SUPPORTED' && c.localEvidenceState == null) c.localEvidenceState = regionEvidence[c.region] || 'UNKNOWN'; });

  const activatedRoots = (rootField.roots || []).filter(r => r.activated);
  const dist = new Map(); // cellIdx -> accumulated cost
  const state = new Map(); // cellIdx -> 'SUPPORTED' | 'AMBIGUOUS'
  const provenanceOf = new Map(); // cellIdx -> {rootRegion, pathCost, contributions}
  if (!activatedRoots.length) return { admitted: dist, state, provenance: provenanceOf, noRootsActivated: true };

  // priority queue via simple array (grid is small -- <= 1200 cells, no need for a heap)
  const frontier = [];
  activatedRoots.forEach(r => {
    if (!r.mask) return;
    for (const c of grid.cells) {
      if (c.geometryStatus !== 'SUPPORTED' || c.region !== r.region) continue;
      const idx = cellIndex(c.gx, c.gy);
      dist.set(idx, 0); state.set(idx, 'SUPPORTED');
      provenanceOf.set(idx, { rootRegion: r.region, pathCost: 0, contributions: ['ROOT_SEED'] });
      frontier.push(idx);
    }
  });

  const budgetFor = (r) => r && r.activationTier === 'WEAK' ? manifest.attachmentCostBudget / manifest.weakRootActivationCostMultiplier : manifest.attachmentCostBudget;
  const maxBudget = manifest.attachmentCostBudget * manifest.ambiguityMarginFactor;
  const minPropagationOrdinal = evidenceOrdinal(manifest.localEvidenceMinState);

  let head = 0;
  while (head < frontier.length) {
    const idx = frontier[head++];
    const c = cellByIdx.get(idx);
    if (!c) continue;
    const curCost = dist.get(idx);
    const curProv = provenanceOf.get(idx);
    const rootRec = activatedRoots.find(r => r.region === curProv.rootRegion);
    const budget = budgetFor(rootRec);
    const neighbors = [[c.gx - 1, c.gy], [c.gx + 1, c.gy], [c.gx, c.gy - 1], [c.gx, c.gy + 1]];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= grid.gw || ny >= grid.gh) continue;
      const nIdx = cellIndex(nx, ny);
      const nCell = cellByIdx.get(nIdx);
      if (!nCell || nCell.geometryStatus === 'HARD_EXCLUDED') continue; // hard exclusion -- never enters the graph
      if (evidenceOrdinal(nCell.localEvidenceState) < minPropagationOrdinal) continue; // Part 1 -- continuing local evidence required, or propagation stops here
      const discontinuity = Math.abs(nCell.meanGray - c.meanGray) / manifest.discontinuityPenaltyDivisor;
      const stepCost = 1 + discontinuity; // direction penalty omitted at grid scale (cells are coarse; reserved refinement, documented as a known simplification)
      const newCost = curCost + stepCost;
      if (newCost > maxBudget) continue; // beyond even the ambiguity margin -- not reachable at all
      const already = dist.get(nIdx);
      if (already !== undefined && already <= newCost) continue;
      dist.set(nIdx, newCost);
      const admitted = newCost <= budget;
      state.set(nIdx, admitted ? 'SUPPORTED' : 'AMBIGUOUS');
      provenanceOf.set(nIdx, { rootRegion: curProv.rootRegion, pathCost: newCost, contributions: curProv.contributions.concat([admitted ? 'PROPAGATED' : 'PROPAGATED_MARGINAL']) });
      frontier.push(nIdx);
    }
  }
  return { admitted: dist, state, provenance: provenanceOf, noRootsActivated: false, cellIndex, cellByIdx };
}

/** Part 15 -- contour extraction, strictly LAST. Upsamples the coarse SUPPORTED-state grid to a
 *  native-resolution mask (nearest-neighbor -- a documented, honest simplification of the frozen
 *  design's "narrow-band pixel refinement," deferred to a future iteration) and traces its
 *  boundary with the project's existing, unmodified Moore-neighbor tracer. AMBIGUOUS cells are
 *  NEVER included in this primary contour (Part 19 benchmark-mask freeze, BI-1Z1E Part 19). */
export function extractContour(grid, attachment, w, h) {
  const mask = new Uint8Array(w * h);
  for (const c of grid.cells) {
    const idx = attachment.cellIndex ? attachment.cellIndex(c.gx, c.gy) : (c.gy * grid.gw + c.gx);
    if (attachment.state.get(idx) !== 'SUPPORTED') continue;
    const x0 = c.gx * grid.cellSize, y0 = c.gy * grid.cellSize;
    const x1 = Math.min(w, x0 + grid.cellSize), y1 = Math.min(h, y0 + grid.cellSize);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 1;
  }
  let area = 0; for (let i = 0; i < mask.length; i++) area += mask[i];
  if (area === 0) return { mask, area: 0, ring: null, polygon: null };
  const ring = BP.traceBoundaryMoore(mask, w, h);
  if (!ring || ring.length < 3) return { mask, area, ring: null, polygon: null };
  const polygon = BP.simplifyRDP(ring, 1.5, true);
  return { mask, area, ring, polygon, handlePoints: BP.reduceToHandles(polygon, 16) };
}

/** Full V2.1 pipeline (research-only). Returns the root field, grid, attachment result, ambiguity
 *  summary, and final contour -- never reads GT, never reads its own prior output. */
export function runV21Occupancy(frameInputs, options = {}) {
  const manifest = options.manifest || V21_PARAMETERS;
  const { landmarks2D, faceLocal3D, imageSpaceViewModelMatrix, intrinsics, gray, width, height } = frameInputs;
  const rootField = buildRootSupportField(landmarks2D, faceLocal3D, imageSpaceViewModelMatrix, intrinsics, gray, width, height);
  if (!rootField.available) return { status: 'UNCERTAIN', reason: 'ANATOMY_OR_ROI_UNAVAILABLE', rootField };
  const grid = buildEvidenceGrid(landmarks2D, faceLocal3D, imageSpaceViewModelMatrix, intrinsics, gray, width, height, manifest);
  if (!grid) return { status: 'UNCERTAIN', reason: 'CORRIDOR_UNAVAILABLE', rootField };
  const attachment = propagateAttachment(grid, rootField, manifest);
  if (attachment.noRootsActivated) {
    return { status: 'NO_BEARD_DETECTED', reason: 'NO_ROOT_ACTIVATED', rootField, grid, attachment, contour: { mask: new Uint8Array(width * height), area: 0, ring: null, polygon: null } };
  }
  const contour = extractContour(grid, attachment, width, height);
  const ambiguousCells = Array.from(attachment.state.values()).filter(s => s === 'AMBIGUOUS').length;
  const supportedCells = Array.from(attachment.state.values()).filter(s => s === 'SUPPORTED').length;
  return {
    status: contour.area > 0 ? 'OCCUPANCY_RESOLVED' : 'NO_BEARD_DETECTED',
    rootField, grid, attachment, contour,
    ambiguitySummary: { ambiguousCellCount: ambiguousCells, supportedCellCount: supportedCells, totalGridCells: grid.cells.length }
  };
}
