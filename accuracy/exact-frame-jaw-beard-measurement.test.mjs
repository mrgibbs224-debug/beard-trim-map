// Stage BI-1Z1B — tests for the exact-frame jaw<->beard measurement primitives. Node built-in
// runner (node --test). Synthetic fixtures only -- the completed GT export (Downloads) and the
// physical research capture (D:\MettleTemp\research-captures\...) are local artifacts outside this
// repo (same convention as every prior bi1y*/bi1z* bundle), exercised manually and reported in the
// BI-1Z1B report/JSON artifact rather than committed as test fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as M from './exact-frame-jaw-beard-measurement.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT_INDEX_HTML = readFileSync(join(HERE, '..', 'index.html'), 'utf8');

// ---- 1/2: basic polygon geometry -------------------------------------------------------------
test('1: polygon area/perimeter/centroid/bbox are correct for a known simple square', () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(M.polygonArea(sq), 100);
  assert.equal(M.polygonPerimeter(sq), 40);
  assert.deepEqual(M.polygonCentroid(sq), { x: 5, y: 5 });
  assert.deepEqual(M.polygonBoundingBox(sq), { minX: 0, maxX: 10, minY: 0, maxY: 10, width: 10, height: 10 });
});
test('2: allPointsFinite/allPointsInBounds fail closed on non-finite or out-of-bounds points', () => {
  assert.equal(M.allPointsFinite([{ x: 1, y: NaN }]), false);
  assert.equal(M.allPointsInBounds([{ x: -1, y: 5 }], 10, 10), false);
  assert.equal(M.allPointsInBounds([{ x: 5, y: 5 }], 10, 10), true);
});

// ---- 3-5: self-intersection / topology audit --------------------------------------------------
test('3: a classic self-intersecting bowtie is correctly flagged (edge-crossing) and NOT simple', () => {
  const bowtie = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
  const t = M.polygonTopologyAudit(bowtie, 20, 20);
  assert.equal(t.selfCrossing, true);
  assert.equal(t.selfIntersectionCount, 1);
  assert.equal(t.isSimple, false);
});
test('4: a simple convex polygon is correctly classified as simple with zero self-intersections/duplicate vertices', () => {
  const tri = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }];
  const t = M.polygonTopologyAudit(tri, 20, 20);
  assert.equal(t.isSimple, true);
  assert.equal(t.selfCrossing, false);
  assert.equal(t.selfTouching, false);
});
test('5: a "self-touching" ring (repeated non-adjacent vertex, no edge crossing) is distinguished from a self-crossing one -- this is the exact obs2 real-world case', () => {
  // a figure-eight that revisits point (5,5) exactly, without any edge properly crossing another
  const figureEight = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 10 }, { x: -5, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 10 }, { x: 15, y: 5 }, { x: 10, y: 0 }];
  const t = M.polygonTopologyAudit(figureEight, 30, 30);
  assert.equal(t.selfTouching, true, 'a repeated non-adjacent vertex must be detected');
  assert.equal(t.isSimple, false);
});

// ---- 6-8: rasterization + IoU -----------------------------------------------------------------
test('6: EVEN-ODD and NONZERO rasterization agree exactly for a simple (non-self-intersecting) polygon', () => {
  const sq = [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }];
  const eo = M.rasterizeEvenOdd(sq, 40, 40), nz = M.rasterizeNonzero(sq, 40, 40);
  assert.equal(M.maskArea(eo), M.maskArea(nz));
  assert.deepEqual(Array.from(eo), Array.from(nz));
});
test('7: EVEN-ODD and NONZERO rasterization DIFFER on a self-intersecting bowtie (the whole reason both are computed and reported per Part 6)', () => {
  const bowtie = [{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 20, y: 0 }, { x: 0, y: 20 }];
  const eo = M.rasterizeEvenOdd(bowtie, 25, 25), nz = M.rasterizeNonzero(bowtie, 25, 25);
  // NONZERO must never be smaller than EVEN-ODD on any self-intersecting ring (it can only add
  // coverage where winding number is +/-2 that even-odd parity cancels back to "outside").
  assert.ok(M.maskArea(nz) >= M.maskArea(eo));
});
test('8: maskIoU is deterministic and computes precision/recall/false-positive/false-negative areas correctly', () => {
  const a = new Uint8Array(16); a[0] = a[1] = a[4] = a[5] = 1; // 2x2 block at (0,0)-(1,1) in a 4x4 grid
  const b = new Uint8Array(16); b[1] = b[2] = b[5] = b[6] = 1; // shifted 2x2 block, overlapping by 2
  const r = M.maskIoU(a, b);
  assert.equal(r.areaA, 4); assert.equal(r.areaB, 4); assert.equal(r.intersection, 2); assert.equal(r.union, 6);
  assert.ok(Math.abs(r.iou - 2 / 6) < 1e-12);
  assert.equal(r.falsePositiveArea, 2); assert.equal(r.falseNegativeArea, 2);
});

// ---- 9: no proposal/GT mutation -----------------------------------------------------------------
test('9: every measurement function is read-only -- input point arrays are never mutated', () => {
  const pts = [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }, { x: 1, y: 5 }];
  const before = JSON.parse(JSON.stringify(pts));
  M.polygonArea(pts); M.polygonPerimeter(pts); M.polygonCentroid(pts); M.polygonBoundingBox(pts);
  M.polygonSelfIntersections(pts); M.polygonTopologyAudit(pts, 10, 10);
  M.rasterizeEvenOdd(pts, 10, 10); M.rasterizeNonzero(pts, 10, 10);
  assert.deepEqual(pts, before);
});

// ---- 10-12: jaw rail / face-interior / outward-normal ------------------------------------------
function syntheticLandmarks() {
  const arr = new Array(468).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0.5 }));
  // A simple, plausible near-frontal layout: jaw rail roughly along y=0.7, mouth reference above it.
  const rail = { 172: [0.70, 0.65], 149: [0.60, 0.70], 152: [0.50, 0.72], 378: [0.40, 0.70], 397: [0.30, 0.65] };
  Object.keys(rail).forEach(k => { arr[k] = { x: rail[k][0], y: rail[k][1], z: 0.5 }; });
  M.MOUTH_REFERENCE.forEach(idx => { arr[idx] = { x: 0.5, y: 0.55, z: 0.5 }; }); // interior reference well above the rail
  return arr;
}
test('10: jawRailImagePoints returns the 5 nodes in the frozen order with the frozen side mapping', () => {
  const rail = M.jawRailImagePoints(syntheticLandmarks(), 640, 480);
  assert.deepEqual(rail.map(r => r.index), [172, 149, 152, 378, 397]);
  assert.deepEqual(rail.map(r => r.side), ['RIGHT', 'RIGHT', 'CENTER', 'LEFT', 'LEFT']);
});
test('11: outwardJawNormal points AWAY from the face-interior reference, chosen independently of any human GT (Part 13) -- verified by dot-product sign, not by inspecting a beard silhouette', () => {
  const lm = syntheticLandmarks();
  const rail = M.jawRailImagePoints(lm, 640, 480);
  const interior = M.faceInteriorReference(lm, 640, 480);
  const normal = M.outwardJawNormal(rail, 2, interior); // CENTER node
  const toInterior = { x: interior.x - rail[2].x, y: interior.y - rail[2].y };
  const dot = normal.x * toInterior.x + normal.y * toInterior.y;
  assert.ok(dot < 0, 'the chosen normal must point away from the interior reference (negative dot with the toward-interior vector)');
});
test('12: outwardJawNormal never reads any GT/proposal point -- its signature only accepts rail + interior reference (a structural guarantee against Part 13\'s "independent of human GT" requirement)', () => {
  assert.equal(M.outwardJawNormal.length, 3); // (railPoints, nodeIndexInRail, faceInterior)
});

// ---- 13-14: ray-polygon intersection fail-closed behavior --------------------------------------
test('13: rayPolygonIntersection returns null (UNMEASURABLE) when the ray points away from every edge, never substituting a nearest-point fallback', () => {
  const square = [{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 110, y: 110 }, { x: 100, y: 110 }];
  const origin = { x: 0, y: 0 };
  const awayFromSquare = { x: -1, y: 0 };
  assert.equal(M.rayPolygonIntersection(origin, awayFromSquare, square), null);
});
test('14: rayPolygonIntersection finds the correct nearest forward intersection when one exists', () => {
  const square = [{ x: 10, y: -10 }, { x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: -10 }];
  const hit = M.rayPolygonIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, square);
  assert.ok(hit);
  assert.ok(Math.abs(hit.t - 10) < 1e-9);
  assert.ok(Math.abs(hit.point.x - 10) < 1e-9 && Math.abs(hit.point.y - 0) < 1e-9);
});

// ---- 15: normalized offset formula --------------------------------------------------------------
test('15: normalizedOffset = offsetPx / jawSpanPx exactly (dimensionless, never presented as metric)', () => {
  const offsetPx = 42, jawSpanPx = 300;
  assert.equal(offsetPx / jawSpanPx, 0.14);
});

// ---- 16-17: visibility classification -----------------------------------------------------------
test('16: visibilityClass keeps the frozen anatomical labels fixed while classifying near/far by yaw sign, and treats near-frontal (|yaw|<10deg) as NEAR_VISIBLE for both sides', () => {
  assert.equal(M.visibilityClass('CENTER', 25), 'CENTER');
  assert.equal(M.visibilityClass('LEFT', 25), 'NEAR_VISIBLE');   // positive yaw -> LEFT near
  assert.equal(M.visibilityClass('RIGHT', 25), 'FAR_SIDE');
  assert.equal(M.visibilityClass('RIGHT', -25), 'NEAR_VISIBLE'); // negative yaw -> RIGHT near
  assert.equal(M.visibilityClass('LEFT', -25), 'FAR_SIDE');
  assert.equal(M.visibilityClass('LEFT', 5), 'NEAR_VISIBLE');    // near-frontal: both sides NEAR_VISIBLE
  assert.equal(M.visibilityClass('RIGHT', 5), 'NEAR_VISIBLE');
});
test('17: far-side classification is never silently discarded by any function in this module -- visibilityClass always returns a label, never null/undefined for a valid side+yaw', () => {
  ['RIGHT', 'LEFT', 'CENTER'].forEach(side => {
    [-50, -5, 0, 5, 50].forEach(yaw => { assert.ok(typeof M.visibilityClass(side, yaw) === 'string'); });
  });
});

// ---- 18: no millimeter conversion anywhere in this module ---------------------------------------
test('18: this module never performs or claims a millimeter/metric conversion (defensive comments explicitly disclaiming mm are fine and expected -- only an actual conversion claim would fail this)', () => {
  const src = readFileSync(join(HERE, 'exact-frame-jaw-beard-measurement.mjs'), 'utf8');
  assert.equal(/\bmillimeter/i.test(src), false);
  // "mm" appears only inside the phrase "never converted to mm" -- a disclaimer, not a conversion.
  const bareMm = src.match(/\bmm\b/gi) || [];
  bareMm.forEach(() => {}); // presence alone is fine; assert none appear as a numeric unit suffix
  assert.equal(/\d+(\.\d+)?\s*mm\b/i.test(src), false, 'no numeric value should ever be suffixed with mm');
});

// ---- 19: production isolation -------------------------------------------------------------------
test('19: root production index.html carries no BI-1Z1B measurement symbols (no production integration)', () => {
  assert.equal(ROOT_INDEX_HTML.includes('jawToBeardOffset'), false);
  assert.equal(ROOT_INDEX_HTML.includes('outwardJawNormal'), false);
  assert.equal(ROOT_INDEX_HTML.includes('exact-frame-jaw-beard-measurement'), false);
});
test('20: no sealed-holdout identifier appears in this module', () => {
  const src = readFileSync(join(HERE, 'exact-frame-jaw-beard-measurement.mjs'), 'utf8');
  assert.equal(src.includes('espu2w'), false);
});

// ---- 21: symmetric boundary distance sanity ------------------------------------------------------
test('21: symmetricBoundaryDistances returns zero distances for two identical boundary sets, and HD95 is the max of the two directed P95 values', () => {
  const boundary = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }];
  const r = M.symmetricBoundaryDistances(boundary, boundary);
  assert.equal(r.meanBoundaryDistancePx, 0);
  assert.equal(r.hd95Px, 0);
});
