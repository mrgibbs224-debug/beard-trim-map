// Stage BI-1Z1C — RESEARCH-ONLY V2 beard proposal architecture. NEVER replaces or modifies
// tools/annotation-workbench/beard-proposal.cjs ("beard-proposal/1", frozen and byte-identical) or
// tools/annotation-workbench/beard-proposal.cjs's ROI construction ("tracked-lower-face-landmark-
// roi/1", also frozen). This module imports ONLY the generic, algorithm-agnostic pixel/geometry
// primitives already exported by that file (Otsu threshold, morphology, connected components,
// boundary tracing, RDP simplification, local-variance texture) -- the exact same reuse pattern
// V1 itself already uses for its own primitives -- and assembles them into a DIFFERENT pipeline
// that treats tracked jaw/chin anatomy as an ATTACHMENT CONSTRAINT rather than merely a search-box
// hint. Never wired into production; never invoked by the annotation workbench UI.
'use strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const BP = require(join(HERE, '..', 'tools', 'annotation-workbench', 'beard-proposal.cjs'));

export const V2_ALGORITHM_VERSION = 'beard-proposal-anatomical-seeded/2';

// ---- FROZEN V2 PARAMETERS (Part 13 -- fixed BEFORE any GT metric is computed) ----------------
// Every constant below is a round, principled number chosen from the anatomy/geometry itself
// (fractions of the frame's OWN jaw span), never fit to the completed human GT.
export const BEARD_BEARING_PRIOR_VERSION = 'BEARD_BEARING_ANATOMICAL_PRIOR_V1';
export const V2_MANIFEST = Object.freeze({
  version: V2_ALGORITHM_VERSION,
  beardBearingPriorVersion: BEARD_BEARING_PRIOR_VERSION,
  parameters: Object.freeze({
    seedDiskRadiusFactor: 0.18,        // seed disk radius = factor * jawSpanPx, centered on each rail node
    upperExclusionMarginFactor: 0.05,  // exclusion line offset toward jaw from mouth centroid = factor * jawSpanPx
    corridorHalfAngleDeg: 35,          // angular spread of each outward wedge, either side of the segment normal
    corridorLengthFactor: 1.8,         // max wedge length = factor * jawSpanPx (long-beard/under-chin allowance)
    minSeedTouchPixels: 3,             // a component must share >= this many pixels with the seed band to qualify
    minMeanPriorWeight: 0.20,          // a component's own MEAN beard-bearing prior weight must reach this to qualify
    implausibleAreaJawSpanFactor: 1.0, // candidate area > factor * jawSpanPx^2 => IMPLAUSIBLY_LARGE_RELATIVE_TO_JAW
    weakTextureFractionThreshold: 0.15 // < this fraction of high-texture candidate pixels => WEAK_TEXTURE_EVIDENCE
  }),
  seedRules: 'Union of 5 disks (radius=seedDiskRadiusFactor*jawSpanPx) centered on JAW_SUPPORT_RAIL_ORDER nodes [172,149,152,378,397] in raw IMAGE pixel space for the CURRENT frame only.',
  exclusionRules: 'A half-plane boundary line through the MOUTH_REFERENCE centroid, offset toward the jaw rail by upperExclusionMarginFactor*jawSpanPx along the mouth-to-jaw direction; the corridor/seed/prior are intersected with the jaw-side half-plane only. This single mouth-anchored line collectively excludes lips, nose, eyes, forehead, and scalp (all of which sit above the mouth on a face) -- no separate per-feature landmark set for nose/eyes exists in this codebase, so a single verified anchor (MOUTH_REFERENCE) is used rather than inventing unverified additional landmark indices. Derived entirely from this frame\'s own tracking, never a manual cutoff.',
  corridorRules: 'For each of the 4 rail segments, a trapezoidal wedge extends outward (away-from-face-interior normal, same sign rule as BI-1Z1B\'s outwardJawNormal) from the segment, spanning +/-corridorHalfAngleDeg and reaching corridorLengthFactor*jawSpanPx -- long/medium/short beards and profile/under-chin/Chin-Up projection remain reachable; the corridor is NOT a fixed pixel box and is NOT a broad omnidirectional convex hull (V1\'s construction). The corridor defines WHERE evidence is sampled; it is not itself the beard-bearing prior.',
  beardBearingPriorRule: 'BEARD_BEARING_ANATOMICAL_PRIOR_V1: a continuous (probabilistic, not binary) [0,1] field over the corridor only, answering "could visible beard plausibly originate from this pixel given tracked lower-face anatomy" -- NOT a hidden-tissue-depth or bone/fat/muscle estimate. Per pixel: max over the 5 seed disks of a linear radial falloff (1 - dist/radius, clamped >=0) and, for each of the 4 wedges, a bilinear falloff = (1 - longitudinalFraction) * (1 - angularFraction) where longitudinalFraction is distance along the wedge\'s outward axis (0 at the jaw segment, 1 at corridorLengthFactor*jawSpanPx) and angularFraction is the pixel\'s angular deviation from the wedge\'s central axis divided by corridorHalfAngleDeg. Zero outside the corridor (which already enforces the upper-exclusion half-plane) -- so lips/nose/eyes/forehead/scalp/background/clothing/disconnected regions all carry prior weight exactly 0 by construction, never a fabricated value. High plausibility concentrates on chin/jaw/lower-cheek/under-chin/under-jaw; the prior never asserts that beard IS present, only that it COULD plausibly originate there.',
  componentAssociationRule: 'After Otsu-threshold darkness + light morphology (OPEN only, no CLOSE, to avoid bridging a real skin gap) inside the corridor, keep only connected components that (a) intersect the seed band by >= minSeedTouchPixels AND (b) have a MEAN beard-bearing prior weight (averaged over the component\'s own pixels) >= minMeanPriorWeight -- darkness alone can never win; a component must be BOTH dark AND anatomically well-supported. Multiple qualifying components are recorded (multipleIndependentSeedContacts), but the single LARGEST qualifying component is what gets boundary-traced (tracing an unconnected union is topologically invalid regardless of GT outcome -- see selectSeedAssociatedComponents\'s own comment). A component with zero anatomical support (e.g. a wall picture frame, or a shirt/chest region reached only through a corridor-external bridge) is never selected regardless of size or darkness.',
  confidenceRules: 'UNCERTAIN/NO_RELIABLE_PROPOSAL if: no component clears BOTH the seed-touch and mean-prior-weight bars; OR final area exceeds implausibleAreaJawSpanFactor*jawSpanPx^2 (IMPLAUSIBLY_LARGE_RELATIVE_TO_JAW); OR the traced boundary is degenerate. WEAK_TEXTURE_EVIDENCE is a soft (non-blocking) confidence flag, never a hard rejection, computed only in experiment B.',
  hairnessNote: 'HAIRNESS_CORE_V1 was searched for across accuracy/, tools/, and root index.html and does not exist as locatable code under that name in this repository. This experiment therefore uses the already-existing, unmodified beard-proposal.cjs localVariance() aggregate-texture primitive as a documented PROXY for "existing aggregate fiber texture signal" per Part 9 -- it is NOT a Hairness Core V1 invocation, and is reported as a proxy, never claimed as the real thing.',
  scopeNote: 'No hidden tissue depth (bone/fat/muscle/true beard stand-off/hidden skin surface under beard) is estimated anywhere in this module -- 2D tracked anatomy + visible image evidence only, per explicit instruction.',
  existingBS1ResearchAudit: 'Audited accuracy/beard-surface-core.mjs and accuracy/beard-anatomy-map.mjs (both locked, both read-only, neither modified). beard-anatomy-map.mjs\'s own frozen MAPPING_EVIDENCE/SUPPORTED_REGIONS/UNSUPPORTED_REGIONS classifies CHIN_CENTER, CHIN_LEFT, CHIN_RIGHT, LEFT_JAW, RIGHT_JAW, LEFT_LOWER_CHEEK, RIGHT_LOWER_CHEEK, MOUSTACHE_CENTER as VERIFIED_DIRECT/VERIFIED_PARTIAL (tracked-landmark-supported), and explicitly classifies UNDER_CHIN, UNDER_JAW_LEFT/CENTER/RIGHT, NECK_FRONT/LEFT/RIGHT, CHIN_NECK_TRANSITION as UNSUPPORTED with reasons on record such as "no tracked under-jaw landmark; would fabricate 3D from a front-face point" and "derived throat/neck geometry is a 2D projection heuristic, not tracked 3D." This independently CONFIRMS V2\'s own design boundary: the seed band (on JAW_CHIN_RAIL/172,149,152,378,397) is TRACKED_2D_SUPPORTED, grounded in the same verified landmarks underlying BS1\'s VERIFIED chin/jaw/lower-cheek regions; the corridor\'s under-jaw/under-chin/long-beard EXTENSION beyond the rail is a 2D IMAGE-SPACE SEARCH-REGION EXTRAPOLATION only (provenance PRIOR) -- it does NOT claim, assert, or depend on tracked 3D under-jaw/neck surface support, and never contradicts BS1\'s UNSUPPORTED classification for those regions. No BS1 file was modified; no locked region classification was overwritten or recomputed.',
  signalProvenance: Object.freeze({
    seedBandRailPoints: 'TRACKED_2D_SUPPORTED (landmarks2D indices 172/149/152/378/397, the same verified points underlying BS1\'s VERIFIED chin/jaw/lower-cheek regions)',
    upperExclusionLine: 'TRACKED_2D_SUPPORTED (MOUTH_REFERENCE landmark centroid)',
    corridorWedgeExtension: 'PRIOR (2D geometric extrapolation beyond the tracked rail -- explicitly NOT tracked 3D/2D support, matches BS1\'s UNSUPPORTED classification for under-jaw/under-chin/neck)',
    beardBearingPriorField: 'PRIOR (derived deterministically from the two TRACKED_2D_SUPPORTED signals above plus the geometric PRIOR extrapolation; never derived from image pixels, GT, or this run\'s own proposal output)',
    otsuDarknessMask: 'IMAGE_APPEARANCE (raw pixel evidence only)',
    localVarianceTextureCue: 'IMAGE_APPEARANCE (Experiment B only; a documented proxy for aggregate fiber texture, see hairnessNote)',
    finalProposal: 'INFERRED (the run\'s own output -- never fed back into buildBeardBearingPrior, buildAnatomicalCorridor, or buildSeedBand within or across runs; those three functions take only landmarks2D/w/h/manifest as input, structurally incapable of reading a proposal result, which rules out circular self-confirmation by construction)',
    humanGT: 'HUMAN_GT (used only for post-hoc benchmarking in this stage, never as an input to any V2 function above)'
  }),
  futureFusionDirection: 'A later stage may investigate a genuine two-way fusion where TRACKED 3D/2D-SUPPORTED face surface strengthens the prior more directly (e.g. weighting by BS1\'s own per-region confidence rather than a flat radial falloff) and, separately, accumulated 2D hair evidence across multiple exact-frame poses populates a beard-occupancy estimate ONLY on already-SUPPORTED tracked regions -- never fabricating occupancy on UNSUPPORTED regions (under-jaw/neck) merely because doing so would look more complete. This was NOT implemented or evaluated in BI-1Z1C (the one-shot GT benchmark was already run before this audit was requested); it is recommended as the next research stage, not retrofitted into this stage\'s frozen, already-evaluated design.'
});

function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }
const RAIL = [172, 149, 152, 378, 397];
const MOUTH_REF = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];

function railImagePoints(landmarks2D, w, h) {
  return RAIL.map(idx => {
    const lm = landmarks2D[idx];
    if (!lm || !isFiniteNum(lm.x) || !isFiniteNum(lm.y)) return null;
    return { index: idx, x: lm.x * w, y: lm.y * h };
  });
}
function mouthCentroid(landmarks2D, w, h) {
  let sx = 0, sy = 0, n = 0;
  MOUTH_REF.forEach(idx => { const lm = landmarks2D[idx]; if (lm && isFiniteNum(lm.x) && isFiniteNum(lm.y)) { sx += lm.x * w; sy += lm.y * h; n++; } });
  return n ? { x: sx / n, y: sy / n } : null;
}
function unit(v) { const d = Math.hypot(v.x, v.y); return d === 0 ? { x: 0, y: 0 } : { x: v.x / d, y: v.y / d }; }
function rot(v, deg) { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }; }

/** Part 3/4 -- the anatomical beard-attachment seed band: a union of disks centered on the 5 jaw
 *  rail nodes, radius scaled to THIS frame's own jaw span. Fails closed (null) if the rail or jaw
 *  span cannot be established. */
export function buildSeedBand(landmarks2D, w, h, manifest = V2_MANIFEST) {
  const rail = railImagePoints(landmarks2D, w, h);
  if (rail.some(p => !p)) return null;
  const jawSpanPx = Math.hypot(rail[0].x - rail[4].x, rail[0].y - rail[4].y);
  if (!(jawSpanPx > 0)) return null;
  const radius = manifest.parameters.seedDiskRadiusFactor * jawSpanPx;
  return { rail, jawSpanPx, radius, provenance: { version: V2_ALGORITHM_VERSION, sourceLandmarks: RAIL, rule: 'disk-union-on-rail' } };
}
export function rasterizeSeedBand(seed, w, h) {
  const mask = new Uint8Array(w * h);
  const r2 = seed.radius * seed.radius;
  seed.rail.forEach(p => {
    const x0 = Math.max(0, Math.floor(p.x - seed.radius)), x1 = Math.min(w - 1, Math.ceil(p.x + seed.radius));
    const y0 = Math.max(0, Math.floor(p.y - seed.radius)), y1 = Math.min(h - 1, Math.ceil(p.y + seed.radius));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if ((x - p.x) * (x - p.x) + (y - p.y) * (y - p.y) <= r2) mask[y * w + x] = 1;
    }
  });
  return mask;
}

/** Part 5 -- upper exclusion half-plane, derived only from this frame's own tracked mouth
 *  reference + jaw rail (no manual cutoff, no beard GT). Returns {point, normal} describing a
 *  line through `point` with `normal` pointing toward the ALLOWED (jaw) side. */
export function buildUpperExclusionLine(landmarks2D, w, h, manifest = V2_MANIFEST) {
  const rail = railImagePoints(landmarks2D, w, h);
  const mouth = mouthCentroid(landmarks2D, w, h);
  if (!mouth || rail.some(p => !p)) return null;
  const jawSpanPx = Math.hypot(rail[0].x - rail[4].x, rail[0].y - rail[4].y);
  const jawCentroid = { x: rail.reduce((s, p) => s + p.x, 0) / rail.length, y: rail.reduce((s, p) => s + p.y, 0) / rail.length };
  const toJaw = unit({ x: jawCentroid.x - mouth.x, y: jawCentroid.y - mouth.y });
  if (toJaw.x === 0 && toJaw.y === 0) return null;
  const margin = manifest.parameters.upperExclusionMarginFactor * jawSpanPx;
  const point = { x: mouth.x + toJaw.x * margin, y: mouth.y + toJaw.y * margin };
  return { point, normal: toJaw, jawSpanPx };
}
function sideOfLine(p, line) { return (p.x - line.point.x) * line.normal.x + (p.y - line.point.y) * line.normal.y; }

/** Part 6 -- anatomical corridor: for each of the 4 rail segments, a trapezoidal wedge extending
 *  outward (away from face interior) from the segment's own outward normal, spanning
 *  +/-corridorHalfAngleDeg and reaching corridorLengthFactor*jawSpanPx. Directional and bounded --
 *  never an omnidirectional convex-hull blob. */
export function buildAnatomicalCorridor(landmarks2D, w, h, manifest = V2_MANIFEST) {
  const seed = buildSeedBand(landmarks2D, w, h, manifest);
  const exclusion = buildUpperExclusionLine(landmarks2D, w, h, manifest);
  if (!seed || !exclusion) return null;
  const rail = seed.rail, jawSpanPx = seed.jawSpanPx;
  const length = manifest.parameters.corridorLengthFactor * jawSpanPx;
  const halfAngle = manifest.parameters.corridorHalfAngleDeg;
  const wedges = [];
  for (let i = 0; i < rail.length - 1; i++) {
    const a = rail[i], b = rail[i + 1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const tangent = unit({ x: b.x - a.x, y: b.y - a.y });
    const n1 = { x: -tangent.y, y: tangent.x }, n2 = { x: tangent.y, y: -tangent.x };
    // outward = the normal pointing away from the OTHER rail nodes' centroid (face interior proxy)
    const centroid = { x: rail.reduce((s, p) => s + p.x, 0) / rail.length, y: rail.reduce((s, p) => s + p.y, 0) / rail.length };
    const d1 = n1.x * (centroid.x - mid.x) + n1.y * (centroid.y - mid.y);
    const outward = d1 > 0 ? n2 : n1; // outward has the more-negative alignment with the interior direction
    const tip1 = rot(outward, halfAngle), tip2 = rot(outward, -halfAngle);
    wedges.push({
      polygon: [a, b, { x: b.x + tip2.x * length, y: b.y + tip2.y * length }, { x: mid.x + outward.x * length, y: mid.y + outward.y * length }, { x: a.x + tip1.x * length, y: a.y + tip1.y * length }],
      segmentIndex: i, mid, outward, length, halfAngleDeg: halfAngle
    });
  }
  return { seed, exclusion, wedges, jawSpanPx, rail };
}
export function rasterizeCorridor(corridor, w, h) {
  const seedMask = rasterizeSeedBand(corridor.seed, w, h);
  const wedgeMasks = corridor.wedges.map(wd => BP.fillPolygonMask(wd.polygon, w, h));
  const union = BP.unionMasks([seedMask, ...wedgeMasks], w, h);
  // intersect with the upper-exclusion allowed half-plane
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const idx = y * w + x;
    if (!union[idx]) continue;
    if (sideOfLine({ x, y }, corridor.exclusion) >= 0) out[idx] = 1;
  }
  return out;
}

/** BEARD_BEARING_ANATOMICAL_PRIOR_V1 -- a continuous [0,1] "could beard plausibly originate here"
 *  field over the corridor only (zero everywhere else, by construction -- see V2_MANIFEST's
 *  beardBearingPriorRule for the exact formula). This is a PRIOR, never a beard/no-beard verdict:
 *  a pixel with prior 1.0 means "anatomically very plausible," not "beard is present." */
export function buildBeardBearingPrior(landmarks2D, w, h, manifest = V2_MANIFEST) {
  const corridor = buildAnatomicalCorridor(landmarks2D, w, h, manifest);
  if (!corridor) return null;
  const corridorMask = rasterizeCorridor(corridor, w, h);
  const { seed, wedges } = corridor;
  const field = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const idx = y * w + x;
    if (!corridorMask[idx]) continue; // exclusion/out-of-corridor pixels stay exactly 0
    let best = 0;
    seed.rail.forEach(p => {
      const d = Math.hypot(x - p.x, y - p.y);
      const val = Math.max(0, 1 - d / seed.radius);
      if (val > best) best = val;
    });
    wedges.forEach(wd => {
      const dx = x - wd.mid.x, dy = y - wd.mid.y;
      const longit = dx * wd.outward.x + dy * wd.outward.y; // projection along outward axis
      if (longit < 0) return;
      const longFrac = Math.min(1, longit / wd.length);
      const lateral = { x: dx - wd.outward.x * longit, y: dy - wd.outward.y * longit };
      const lateralDist = Math.hypot(lateral.x, lateral.y);
      const angleDeg = Math.atan2(lateralDist, Math.max(1e-6, longit)) * 180 / Math.PI;
      const angFrac = Math.min(1, angleDeg / wd.halfAngleDeg);
      const val = (1 - longFrac) * (1 - angFrac);
      if (val > best) best = val;
    });
    field[idx] = best;
  }
  return { field, corridor };
}
function meanPriorWeight(mask, priorField) {
  let sum = 0, n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { sum += priorField[i]; n++; }
  return n ? sum / n : 0;
}

/** Part 7/8 -- component association: keep only components touching the seed band by
 *  >= minSeedTouchPixels. Returns the UNION mask (informational -- e.g. for area/confidence
 *  checks that legitimately want total seed-associated coverage) AND, separately, the single
 *  LARGEST seed-associated component's own mask for boundary tracing: `traceBoundaryMoore` (reused
 *  unmodified from beard-proposal.cjs) is only well-defined for ONE connected region -- tracing a
 *  mask that unions several disconnected accepted components produces a self-intersecting,
 *  structurally-invalid path. This is a topology-CORRECTNESS choice (verifiable from the mask's
 *  own connectivity, independent of any GT outcome), not a GT-tuned threshold -- Part 7's "union"
 *  language is preserved for the association DECISION (which components qualify), while tracing
 *  always operates on one well-formed region. `multipleIndependentSeedContacts` records whether
 *  more than one component qualified, for confidence reporting (Part 7's own suggested signal). */
export function selectSeedAssociatedComponents(darkMask, seedMask, priorField, w, h, manifest = V2_MANIFEST) {
  const cc = BP.connectedComponents(darkMask, w, h);
  const touchCounts = new Array(cc.count).fill(0);
  const priorSums = new Array(cc.count).fill(0);
  for (let i = 0; i < darkMask.length; i++) {
    if (!darkMask[i] || cc.labels[i] === -1) continue;
    const lbl = cc.labels[i];
    if (seedMask[i]) touchCounts[lbl]++;
    priorSums[lbl] += priorField[i];
  }
  const accepted = [];
  const componentReport = [];
  for (let lbl = 0; lbl < cc.count; lbl++) {
    const meanPrior = cc.sizes[lbl] ? priorSums[lbl] / cc.sizes[lbl] : 0;
    const touchesSeed = touchCounts[lbl] >= manifest.parameters.minSeedTouchPixels;
    const strongPrior = meanPrior >= manifest.parameters.minMeanPriorWeight;
    if (touchesSeed && strongPrior) accepted.push(lbl);
    componentReport.push({ label: lbl, size: cc.sizes[lbl], seedTouchPixels: touchCounts[lbl], meanPriorWeight: meanPrior, accepted: touchesSeed && strongPrior });
  }
  const unionMask = new Uint8Array(w * h);
  for (let i = 0; i < darkMask.length; i++) { if (cc.labels[i] !== -1 && accepted.indexOf(cc.labels[i]) !== -1) unionMask[i] = 1; }
  let largestLbl = -1, largestSize = -1;
  accepted.forEach(lbl => { if (cc.sizes[lbl] > largestSize) { largestSize = cc.sizes[lbl]; largestLbl = lbl; } });
  const largestMask = new Uint8Array(w * h);
  if (largestLbl !== -1) for (let i = 0; i < darkMask.length; i++) if (cc.labels[i] === largestLbl) largestMask[i] = 1;
  return {
    unionMask, largestMask, totalComponents: cc.count, acceptedComponents: accepted.length,
    rejectedComponents: cc.count - accepted.length, multipleIndependentSeedContacts: accepted.length > 1,
    componentReport
  };
}

/** Full V2 pipeline. `gray` is the frame's own rgbaToGray() output (w*h Float32Array). Returns a
 *  result object with a `status` of 'PROPOSED' or 'UNCERTAIN' and, if UNCERTAIN, `reasons`.
 *  `useTextureCue` selects Experiment B (Part 9) -- Experiment A when false. Deterministic: same
 *  inputs always produce the same output, no randomness anywhere. */
export function runV2Proposal(landmarks2D, gray, w, h, options = {}) {
  const manifest = options.manifest || V2_MANIFEST;
  const useTextureCue = !!options.useTextureCue;
  const reasons = [];
  const corridor = buildAnatomicalCorridor(landmarks2D, w, h, manifest);
  if (!corridor) return { status: 'UNCERTAIN', reasons: ['ANATOMY_UNAVAILABLE'], manifest };
  const corridorMask = rasterizeCorridor(corridor, w, h);
  const seedMask = rasterizeSeedBand(corridor.seed, w, h);
  const priorResult = buildBeardBearingPrior(landmarks2D, w, h, manifest);
  if (!priorResult) return { status: 'UNCERTAIN', reasons: ['ANATOMY_UNAVAILABLE'], manifest, corridor };
  const priorField = priorResult.field;

  const priorVals = []; for (let i = 0; i < gray.length; i++) if (corridorMask[i]) priorVals.push(gray[i]);
  if (!priorVals.length) return { status: 'UNCERTAIN', reasons: ['EMPTY_CORRIDOR'], manifest, corridor };
  const thresh = BP.otsuThreshold(BP.histogramOf(priorVals, 256));
  let darkMask = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) if (corridorMask[i] && gray[i] < thresh) darkMask[i] = 1;
  darkMask = BP.openMask(darkMask, w, h); // OPEN only -- never CLOSE, to avoid bridging a real skin gap (Part 8)

  const assoc = selectSeedAssociatedComponents(darkMask, seedMask, priorField, w, h, manifest);
  if (assoc.acceptedComponents === 0) return { status: 'UNCERTAIN', reasons: ['NO_SEED_ASSOCIATED_COMPONENT'], manifest, corridor, thresh, rejectedComponents: assoc.rejectedComponents, componentReport: assoc.componentReport };

  let finalMask = assoc.largestMask;
  let area = 0; for (let i = 0; i < finalMask.length; i++) area += finalMask[i];
  const acceptedMeanPriorWeight = meanPriorWeight(finalMask, priorField);
  if (area > manifest.parameters.implausibleAreaJawSpanFactor * corridor.jawSpanPx * corridor.jawSpanPx) {
    reasons.push('IMPLAUSIBLY_LARGE_RELATIVE_TO_JAW');
  }

  let textureFraction = null;
  if (useTextureCue) {
    const texture = BP.localVariance(gray, w, h, 2);
    let texVals = []; for (let i = 0; i < gray.length; i++) if (corridorMask[i]) texVals.push(texture[i]);
    const sortedTex = texVals.slice().sort((a, b) => a - b);
    const median = sortedTex[Math.floor(sortedTex.length / 2)] || 0;
    let highTexCount = 0, candidateCount = 0;
    for (let i = 0; i < finalMask.length; i++) if (finalMask[i]) { candidateCount++; if (texture[i] > median) highTexCount++; }
    textureFraction = candidateCount ? highTexCount / candidateCount : 0;
    if (textureFraction < manifest.parameters.weakTextureFractionThreshold) reasons.push('WEAK_TEXTURE_EVIDENCE');
  }

  const ring = BP.traceBoundaryMoore(finalMask, w, h);
  if (!ring || ring.length < 3) return { status: 'UNCERTAIN', reasons: reasons.concat(['DEGENERATE_BOUNDARY']), manifest, corridor, thresh, area };
  const fullProposal = BP.simplifyRDP(ring, 1.5, true);
  const handles = BP.reduceToHandles(fullProposal, 16);

  const hardFail = reasons.includes('IMPLAUSIBLY_LARGE_RELATIVE_TO_JAW');
  return {
    status: hardFail ? 'UNCERTAIN' : 'PROPOSED',
    reasons,
    manifest, corridor, thresh, area, textureFraction, acceptedMeanPriorWeight,
    acceptedComponents: assoc.acceptedComponents, rejectedComponents: assoc.rejectedComponents,
    multipleIndependentSeedContacts: assoc.multipleIndependentSeedContacts, componentReport: assoc.componentReport,
    originalProposalPoints: fullProposal, handlePoints: handles
  };
}
