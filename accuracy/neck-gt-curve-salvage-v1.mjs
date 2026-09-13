// Stage BI-2B1B -- HUMAN GT CURVE-SALVAGE AUDIT.
// Pure, read-only geometric analysis of already-exported human annotation curves. Never mutates
// the source export. Never uses model/temporal/beard predictions as evidence. Fails closed to
// ACCIDENTALLY_CLOSED_AMBIGUOUS whenever automatic recovery cannot be trusted.

export const CURVE_TARGET_BY_POSE = Object.freeze({
  'chin-up': 'CHIN_TO_NECK_TRANSITION_CURVE',
  'right-profile': 'UNDER_JAW_VISIBLE_BOUNDARY',
  'left-profile': 'UNDER_JAW_VISIBLE_BOUNDARY'
});

export const PRESERVED_TARGETS = Object.freeze(['VISIBLE_NECK_SKIN_POLYGON', 'UNKNOWN_OCCLUSION_MASK']);

export const CLOSED_LOOP_RATIO_THRESHOLD = 0.05; // start/end within 5% of the bbox diagonal -> genuine closed loop
export const RETRACE_RATIO_THRESHOLD = 0.15; // how closely the two halves of a closed loop must retrace each other to be salvaged

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

export function polylineLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

export function boundingBox(pts) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function closedLoopRatio(pts) {
  const bbox = boundingBox(pts);
  const diag = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  if (diag === 0) return 0;
  return dist(pts[0], pts[pts.length - 1]) / diag;
}

export function shoelaceArea(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Index of the polyline point farthest (perpendicular distance) from the start-end chord --
 * a purely geometric proxy for "where the trace might have turned around," never claimed to be
 * anatomically meaningful on its own. */
export function findApexIndex(pts) {
  let maxDistFromChord = -1, apexIdx = -1;
  const a = pts[0], b = pts[pts.length - 1];
  const den = Math.hypot(b.y - a.y, b.x - a.x) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const num = Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x);
    const d = num / den;
    if (d > maxDistFromChord) { maxDistFromChord = d; apexIdx = i; }
  }
  return apexIdx;
}

function directedHausdorff(pathA, pathB) {
  let maxMin = 0;
  pathA.forEach(p => {
    let minD = Infinity;
    pathB.forEach(q => { const d = dist(p, q); if (d < minD) minD = d; });
    if (minD > maxMin) maxMin = minD;
  });
  return maxMin;
}

/** Classifies one already-exported curve. Never mutates its input. Fails closed to
 * ACCIDENTALLY_CLOSED_AMBIGUOUS whenever the two candidate halves of a closed loop do not closely
 * retrace one another -- this is a DETECTION function only; it never itself decides which half
 * (if either) is the "correct" anatomical edge, since doing so from geometry alone would be
 * exactly the forbidden "guessed anatomical prior." */
export function classifyCurve(pts) {
  if (!Array.isArray(pts) || pts.length < 2) return { classification: 'NO_CURVE_DATA' };
  const ratio = closedLoopRatio(pts);
  if (ratio >= CLOSED_LOOP_RATIO_THRESHOLD) {
    return { classification: 'VALID_OPEN_CURVE', closedLoopRatio: ratio };
  }
  const apexIdx = findApexIndex(pts);
  if (apexIdx <= 0 || apexIdx >= pts.length - 1) {
    return { classification: 'ACCIDENTALLY_CLOSED_AMBIGUOUS', closedLoopRatio: ratio, reason: 'DEGENERATE_APEX' };
  }
  const firstHalf = pts.slice(0, apexIdx + 1);
  const secondHalf = pts.slice(apexIdx).slice().reverse();
  const hausdorff = Math.max(directedHausdorff(firstHalf, secondHalf), directedHausdorff(secondHalf, firstHalf));
  const firstHalfLength = polylineLength(firstHalf);
  const retraceRatio = firstHalfLength > 0 ? hausdorff / firstHalfLength : null;
  const salvageable = retraceRatio !== null && retraceRatio < RETRACE_RATIO_THRESHOLD;
  return {
    classification: salvageable ? 'ACCIDENTALLY_CLOSED_BUT_SALVAGEABLE' : 'ACCIDENTALLY_CLOSED_AMBIGUOUS',
    closedLoopRatio: ratio, apexIdx, retraceRatio, hausdorff, firstHalfLength,
    reason: salvageable ? 'HALVES_CLOSELY_RETRACE_EACH_OTHER' : 'HALVES_DIVERGE_TOO_MUCH_TO_TRUST_AUTOMATICALLY'
  };
}

/** Builds the salvaged-curve record ONLY for a classifyCurve() result of
 * ACCIDENTALLY_CLOSED_BUT_SALVAGEABLE. Never invents points -- returns the exact source sub-path
 * (first half, verbatim vertex indices 0..apexIdx) plus full provenance. Marked
 * DERIVED_FROM_HUMAN_GT, never DIRECT_HUMAN_CURVE. */
export function buildSalvagedCurve(pts, classificationResult, provenance) {
  if (classificationResult.classification !== 'ACCIDENTALLY_CLOSED_BUT_SALVAGEABLE') return null;
  const apexIdx = classificationResult.apexIdx;
  return {
    status: 'DERIVED_FROM_HUMAN_GT',
    ...provenance,
    derivationMethod: 'chord-apex split; verbatim first-half sub-path (vertices 0..apexIdx) retained, second half (accidental closing return-path) discarded',
    sourceVertexIndices: Array.from({ length: apexIdx + 1 }, (_, i) => i),
    points: pts.slice(0, apexIdx + 1),
    classificationConfidence: 1 - classificationResult.retraceRatio,
    reasonConsideredUnambiguous: classificationResult.reason
  };
}
