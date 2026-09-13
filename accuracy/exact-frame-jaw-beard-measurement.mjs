// Stage BI-1Z1B — pure geometry/measurement primitives for the exact-frame jaw<->visible-beard
// analysis. No proposal/ROI algorithm code lives here -- this module only MEASURES already-frozen
// artifacts (a completed human GT export + the physical Exact-Frame Research Capture). Nothing
// here is wired into production or into the annotation workbench.
'use strict';

export const MEASUREMENT_MODULE_VERSION = 'exact-frame-jaw-beard-measurement/1';

// Frozen anatomical jaw-support indices/sides (mirrors PERSON_ANATOMY_SIDES in root index.html and
// JAW_SUPPORT_SIDE in accuracy/exact-frame-research-capture.mjs -- never redefined here, only
// consumed as literal values so this module has no import-order dependency on production code).
export const JAW_SUPPORT_RAIL_ORDER = Object.freeze([172, 149, 152, 378, 397]);
export const JAW_SUPPORT_SIDE = Object.freeze({ 172: 'RIGHT', 149: 'RIGHT', 152: 'CENTER', 378: 'LEFT', 397: 'LEFT' });
export const MOUTH_REFERENCE = Object.freeze([61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]);

function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }

// ---- basic polygon geometry (shoelace-based) ------------------------------------------------
export function polygonSignedArea(pts) {
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}
export function polygonArea(pts) { return Math.abs(polygonSignedArea(pts)); }
export function polygonPerimeter(pts) {
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    s += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return s;
}
export function polygonCentroid(pts) {
  const A = polygonSignedArea(pts);
  if (A === 0) {
    // degenerate (zero-area) polygon -- fall back to the arithmetic mean of vertices, flagged by
    // the caller via areaPx2===0, never silently presented as a real centroid otherwise.
    let sx = 0, sy = 0;
    pts.forEach(p => { sx += p.x; sy += p.y; });
    return { x: sx / pts.length, y: sy / pts.length };
  }
  let cx = 0, cy = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}
export function polygonBoundingBox(pts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  pts.forEach(p => { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; });
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}
export function allPointsFinite(pts) { return pts.every(p => p && isFiniteNum(p.x) && isFiniteNum(p.y)); }
export function allPointsInBounds(pts, w, h) { return pts.every(p => p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h); }

// ---- self-intersection detection (proper segment-intersection test, adjacent edges excluded) -
function segProperIntersect(p1, p2, p3, p4) {
  function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false; // collinear/touching cases deliberately NOT counted as a proper crossing here
}
/** Counts genuine (non-adjacent, properly-crossing) edge pairs in a closed polygon ring. Returns
 *  {count, pairs:[[i,j],...]}. Adjacent edges (which always share an endpoint) are always
 *  excluded -- sharing a vertex is not a self-intersection. */
export function polygonSelfIntersections(pts) {
  const n = pts.length;
  const pairs = [];
  for (let i = 0; i < n; i++) {
    const a1 = pts[i], a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i) continue;
      const adjacent = (j === i + 1) || (i === 0 && j === n - 1);
      if (adjacent) continue;
      const b1 = pts[j], b2 = pts[(j + 1) % n];
      if (segProperIntersect(a1, a2, b1, b2)) pairs.push([i, j]);
    }
  }
  return { count: pairs.length, pairs };
}
export function polygonTopologyAudit(pts, w, h) {
  const finite = allPointsFinite(pts);
  const inBounds = finite && allPointsInBounds(pts, w, h);
  const area = finite ? polygonArea(pts) : 0;
  const selfInt = finite ? polygonSelfIntersections(pts) : { count: 0, pairs: [] };
  // duplicate/self-touching-vertex check: any two NON-ADJACENT vertices closer than 1e-6px (true
  // coincident points -- a boundary trace revisiting the exact same pixel at two different
  // positions in its point sequence). This is topologically distinct from an edge-CROSSING
  // self-intersection (an X-shaped overlap mid-edge): a repeated vertex instead creates a
  // "self-touching" figure-eight that meets at a single point, which the strict proper-crossing
  // test above deliberately does not count (touching/shared-vertex cases are not a crossing).
  const duplicateVertexPairs = [];
  if (finite) {
    const n = pts.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const adjacent = (j === i + 1) || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 1e-6) duplicateVertexPairs.push([i, j]);
    }
  }
  const duplicateVertexCount = duplicateVertexPairs.length;
  return {
    pointCount: pts.length,
    allFinite: finite,
    allInBounds: inBounds,
    areaPx2: area,
    nonZeroArea: area > 0,
    duplicateVertexCount,
    duplicateVertexPairs,
    selfIntersectionCount: selfInt.count,
    selfIntersectionPairs: selfInt.pairs,
    selfTouching: duplicateVertexCount > 0,
    selfCrossing: selfInt.count > 0,
    isSimple: finite && selfInt.count === 0 && duplicateVertexCount === 0 && area > 0
  };
}

// ---- rasterization: TWO deterministic fill-rule interpretations (Part 6) --------------------
/** EVEN-ODD scanline fill -- byte-identical algorithm to
 *  tools/annotation-workbench/beard-proposal.cjs's fillPolygonMask (reimplemented here rather than
 *  imported, to keep this analysis module dependency-free of the UMD workbench file; a test
 *  cross-checks the two stay in agreement on shared fixtures). */
export function rasterizeEvenOdd(polygon, w, h) {
  const mask = new Uint8Array(w * h);
  const n = polygon.length;
  if (n < 3) return mask;
  let minY = Infinity, maxY = -Infinity;
  polygon.forEach(p => { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; });
  minY = Math.max(0, Math.floor(minY)); maxY = Math.min(h - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    const yc = y + 0.5;
    const xs = [];
    for (let i = 0; i < n; i++) {
      const a = polygon[i], b = polygon[(i + 1) % n];
      if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) xs.push(a.x + (yc - a.y) / (b.y - a.y) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.round(xs[k])), x1 = Math.min(w - 1, Math.round(xs[k + 1]));
      for (let x = x0; x <= x1; x++) mask[y * w + x] = 1;
    }
  }
  return mask;
}
/** NONZERO winding-number scanline fill -- tracks each crossing's signed direction (+1 for an
 *  edge going downward through the scanline in image (y-down) coordinates, -1 for upward) and
 *  fills any span where the accumulated winding number is non-zero. Differs from EVEN-ODD exactly
 *  on self-intersecting paths (e.g. a "bowtie") where a region is covered by the path twice in the
 *  same rotational sense -- EVEN-ODD would leave it unfilled, NONZERO fills it. */
export function rasterizeNonzero(polygon, w, h) {
  const mask = new Uint8Array(w * h);
  const n = polygon.length;
  if (n < 3) return mask;
  let minY = Infinity, maxY = -Infinity;
  polygon.forEach(p => { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; });
  minY = Math.max(0, Math.floor(minY)); maxY = Math.min(h - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    const yc = y + 0.5;
    const crossings = [];
    for (let i = 0; i < n; i++) {
      const a = polygon[i], b = polygon[(i + 1) % n];
      if ((a.y <= yc && b.y > yc)) crossings.push({ x: a.x + (yc - a.y) / (b.y - a.y) * (b.x - a.x), dir: 1 });
      else if ((b.y <= yc && a.y > yc)) crossings.push({ x: a.x + (yc - a.y) / (b.y - a.y) * (b.x - a.x), dir: -1 });
    }
    crossings.sort((p, q) => p.x - q.x);
    let winding = 0;
    for (let k = 0; k < crossings.length - 1; k++) {
      winding += crossings[k].dir;
      if (winding !== 0) {
        const x0 = Math.max(0, Math.round(crossings[k].x)), x1 = Math.min(w - 1, Math.round(crossings[k + 1].x));
        for (let x = x0; x <= x1; x++) mask[y * w + x] = 1;
      }
    }
  }
  return mask;
}
export function maskArea(mask) { let s = 0; for (let i = 0; i < mask.length; i++) s += mask[i]; return s; }
export function maskIoU(maskA, maskB) {
  let inter = 0, union = 0, areaA = 0, areaB = 0;
  for (let i = 0; i < maskA.length; i++) {
    const a = maskA[i], b = maskB[i];
    if (a) areaA++;
    if (b) areaB++;
    if (a && b) inter++;
    if (a || b) union++;
  }
  return {
    areaA, areaB, intersection: inter, union,
    iou: union > 0 ? inter / union : 0,
    precision: areaB > 0 ? inter / areaB : 0, // proposal=B is "predicted": precision = TP/(TP+FP)
    recall: areaA > 0 ? inter / areaA : 0,    // human=A is "actual": recall = TP/(TP+FN)
    falsePositiveArea: areaB - inter,
    falseNegativeArea: areaA - inter
  };
}
/** Every foreground pixel with at least one background (or out-of-frame) 4-neighbor -- a simple,
 *  orientation-free boundary point set that stays correct even for a mask made of several
 *  disconnected regions (which a self-intersecting NONZERO/EVEN-ODD fill can legitimately produce),
 *  unlike an ordered single-region trace. */
export function maskBoundaryPixels(mask, w, h) {
  const pts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const idx = y * w + x;
    if (!mask[idx]) continue;
    const edge = (x === 0 || x === w - 1 || y === 0 || y === h - 1);
    if (edge || !mask[idx - 1] || !mask[idx + 1] || !mask[idx - w] || !mask[idx + w]) pts.push({ x, y });
  }
  return pts;
}
function nearestDistance(p, set) {
  let best = Infinity;
  for (let i = 0; i < set.length; i++) {
    const d = (set[i].x - p.x) * (set[i].x - p.x) + (set[i].y - p.y) * (set[i].y - p.y);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
  return sorted[idx];
}
/** Symmetric boundary-distance metrics between two boundary point sets, using raw IMAGE pixels
 *  only (Part 7 -- never converted to mm). Returns null fields if a boundary set is empty. */
export function symmetricBoundaryDistances(boundaryA, boundaryB) {
  if (!boundaryA.length || !boundaryB.length) {
    return { meanBoundaryDistancePx: null, medianBoundaryDistancePx: null, p95BoundaryDistancePx: null, hd95Px: null, maxBoundaryDistancePx: null };
  }
  const aToB = boundaryA.map(p => nearestDistance(p, boundaryB));
  const bToA = boundaryB.map(p => nearestDistance(p, boundaryA));
  const all = aToB.concat(bToA).sort((x, y) => x - y);
  const aToBSorted = aToB.slice().sort((x, y) => x - y);
  const bToASorted = bToA.slice().sort((x, y) => x - y);
  const mean = all.reduce((s, v) => s + v, 0) / all.length;
  const p95AtoB = percentile(aToBSorted, 0.95);
  const p95BtoA = percentile(bToASorted, 0.95);
  return {
    meanBoundaryDistancePx: mean,
    medianBoundaryDistancePx: percentile(all, 0.5),
    p95BoundaryDistancePx: percentile(all, 0.95),
    hd95Px: Math.max(p95AtoB, p95BtoA), // standard HD95 definition: max of the two directed 95th percentiles
    maxBoundaryDistancePx: Math.max(all[all.length - 1])
  };
}

// ---- jaw support rail + outward-normal jaw-to-beard offset (Parts 10, 12, 13, 14) -----------
export function jawRailImagePoints(landmarks2D, imageWidth, imageHeight) {
  return JAW_SUPPORT_RAIL_ORDER.map(idx => {
    const lm = landmarks2D[idx];
    if (!lm || !isFiniteNum(lm.x) || !isFiniteNum(lm.y)) return null;
    return { index: idx, side: JAW_SUPPORT_SIDE[idx], x: lm.x * imageWidth, y: lm.y * imageHeight };
  });
}
export function faceInteriorReference(landmarks2D, imageWidth, imageHeight) {
  let sx = 0, sy = 0, n = 0;
  MOUTH_REFERENCE.forEach(idx => {
    const lm = landmarks2D[idx];
    if (lm && isFiniteNum(lm.x) && isFiniteNum(lm.y)) { sx += lm.x * imageWidth; sy += lm.y * imageHeight; n++; }
  });
  if (n === 0) return null;
  return { x: sx / n, y: sy / n, sourceCount: n };
}
function unitVec(v) { const d = Math.hypot(v.x, v.y); return d === 0 ? { x: 0, y: 0 } : { x: v.x / d, y: v.y / d }; }
function rotate90(v, sign) { return { x: -sign * v.y, y: sign * v.x }; }
/** Freezes the outward-normal selection rule BEFORE any beard GT is consulted (Part 13): estimate
 *  the local rail tangent by central difference against this node's rail neighbors, take the two
 *  perpendicular unit normals, and pick whichever one points AWAY from faceInteriorRef (negative
 *  dot product with the "toward interior" direction). Returns null (AMBIGUOUS) if the tangent is
 *  degenerate (coincident neighbors) or the interior/away choice is too close to call (|dot| very
 *  small -- the ray direction would be unstable). */
export function outwardJawNormal(railPoints, nodeIndexInRail, faceInterior) {
  const node = railPoints[nodeIndexInRail];
  if (!node || !faceInterior) return null;
  const prev = nodeIndexInRail > 0 ? railPoints[nodeIndexInRail - 1] : null;
  const next = nodeIndexInRail < railPoints.length - 1 ? railPoints[nodeIndexInRail + 1] : null;
  if (!prev && !next) return null;
  const a = prev || node, b = next || node;
  const tangent = unitVec({ x: b.x - a.x, y: b.y - a.y });
  if (tangent.x === 0 && tangent.y === 0) return null;
  const n1 = rotate90(tangent, 1), n2 = rotate90(tangent, -1);
  const toInterior = unitVec({ x: faceInterior.x - node.x, y: faceInterior.y - node.y });
  const d1 = n1.x * toInterior.x + n1.y * toInterior.y;
  const d2 = n2.x * toInterior.x + n2.y * toInterior.y;
  const AMBIGUITY_EPS = 0.05; // both candidates nearly perpendicular to the interior direction
  if (Math.abs(d1 - d2) < AMBIGUITY_EPS) return null;
  return d1 < d2 ? n1 : n2; // pick the candidate LESS aligned with "toward interior" (i.e. outward)
}
/** Ray-polygon intersection: casts a ray from `origin` in direction `dir` (unit vector) and finds
 *  the closest intersection with the polygon's own edges at strictly positive t. Never falls back
 *  to nearest-boundary-point (Part 12) -- returns null (UNMEASURABLE) if no edge is hit. */
export function rayPolygonIntersection(origin, dir, polygon) {
  let best = null;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const p1 = polygon[i], p2 = polygon[(i + 1) % n];
    const ex = p2.x - p1.x, ey = p2.y - p1.y;
    const denom = dir.x * ey - dir.y * ex;
    if (Math.abs(denom) < 1e-12) continue; // parallel
    const dx = p1.x - origin.x, dy = p1.y - origin.y;
    const t = (dx * ey - dy * ex) / denom;       // distance along the ray
    const u = (dx * dir.y - dy * dir.x) / denom; // position along the edge [0,1]
    if (t > 1e-9 && u >= 0 && u <= 1) {
      if (best === null || t < best.t) best = { t, point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t }, edgeIndex: i };
    }
  }
  return best;
}
export const NEAR_FRONTAL_YAW_THRESHOLD_DEG = 10; // Part 11: "for frontal/near-frontal frames, both sides may be considered"
export function visibilityClass(side, yawDeg) {
  if (side === 'CENTER') return 'CENTER';
  if (Math.abs(yawDeg) < NEAR_FRONTAL_YAW_THRESHOLD_DEG) return 'NEAR_VISIBLE'; // both sides, near-frontal
  // Frozen finding (BI-1Z0/BI-1Z1B Part 11): positive/rightward yaw brings the LEFT-anatomical
  // side into view; negative/leftward yaw brings the RIGHT-anatomical side into view.
  const nearSide = yawDeg > 0 ? 'LEFT' : 'RIGHT';
  return side === nearSide ? 'NEAR_VISIBLE' : 'FAR_SIDE';
}
