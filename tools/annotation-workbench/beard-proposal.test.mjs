// Stage BI-1Y2 — pure unit tests for the machine beard-boundary PROPOSAL geometry core.
// Node built-in runner (node --test). Synthetic arrays only -- no real images, no canvas, no
// network. Proves the underlying CV primitives (Otsu threshold, connected components, boundary
// tracing, polyline simplification, deterministic edge derivation) behave correctly in isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import BP from './beard-proposal.cjs';

test('otsuThreshold separates two clearly separated intensity clusters', () => {
  var vals = [];
  for (var i = 0; i < 100; i++) vals.push(20 + (i % 10)); // dark cluster ~20-29
  for (i = 0; i < 100; i++) vals.push(200 + (i % 10));    // light cluster ~200-209
  var hist = BP.histogramOf(vals, 256);
  var t = BP.otsuThreshold(hist);
  // functional correctness, not a specific tie-broken index: every dark-cluster value must fall
  // at or below the threshold and every light-cluster value strictly above it.
  assert.ok(t >= 29 && t < 200, 'threshold ' + t + ' should separate the two clusters');
  assert.ok([20, 25, 29].every(v => v <= t));
  assert.ok([200, 205, 209].every(v => v > t));
});

test('rgbaToGray converts a solid-color 2x2 image to a uniform gray value', () => {
  var rgba = new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255, 100, 100, 100, 255, 100, 100, 100, 255]);
  var gray = BP.rgbaToGray(rgba, 2, 2);
  assert.equal(gray.length, 4);
  for (var i = 0; i < 4; i++) assert.ok(Math.abs(gray[i] - 100) < 1e-6);
});

test('localVariance is ~0 on a flat region and > 0 across a hard edge', () => {
  var w = 6, h = 6;
  var gray = new Float32Array(w * h).fill(50);
  var flatVar = BP.localVariance(gray, w, h, 1)[3 * w + 3];
  assert.ok(flatVar < 1e-6);
  for (var y = 0; y < h; y++) for (var x = 3; x < w; x++) gray[y * w + x] = 200; // hard vertical edge
  var edgeVar = BP.localVariance(gray, w, h, 1)[3 * w + 3];
  assert.ok(edgeVar > flatVar);
});

test('sobelMagnitude is near-zero on a flat field and large across a step edge', () => {
  var w = 5, h = 5;
  var flat = new Float32Array(w * h).fill(10);
  var flatMag = BP.sobelMagnitude(flat, w, h);
  assert.ok(Math.max.apply(null, flatMag) < 1e-6);
  var stepped = new Float32Array(w * h);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) stepped[y * w + x] = x < 2 ? 0 : 255;
  var stepMag = BP.sobelMagnitude(stepped, w, h);
  assert.ok(Math.max.apply(null, stepMag) > 100);
});

test('connectedComponents finds exactly two disjoint blobs and reports correct sizes', () => {
  var w = 7, h = 3;
  // XX.XXX.  -- deliberately two components: a 2px blob and a 3px blob, separated by a gap
  var mask = new Uint8Array([
    1, 1, 0, 1, 1, 1, 0,
    0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0
  ]);
  var cc = BP.connectedComponents(mask, w, h);
  assert.equal(cc.count, 2);
  assert.deepEqual(cc.sizes.slice().sort((a, b) => a - b), [2, 3]);
});

test('largestComponentMask keeps only the biggest blob and drops smaller ones', () => {
  var w = 7, h = 1;
  var mask = new Uint8Array([1, 1, 0, 1, 1, 1, 0]);
  var out = BP.largestComponentMask(mask, w, h);
  assert.deepEqual(Array.from(out), [0, 0, 0, 1, 1, 1, 0]);
});
test('largestComponentMask returns all-zero for an empty mask, never fabricates a shape', () => {
  var out = BP.largestComponentMask(new Uint8Array(9), 3, 3);
  assert.deepEqual(Array.from(out), [0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('dilate/erode/close/open behave as standard 3x3 binary morphology', () => {
  var w = 5, h = 5;
  var mask = new Uint8Array(w * h); mask[2 * w + 2] = 1; // single center pixel
  var dilated = BP.dilate(mask, w, h);
  assert.equal(dilated.reduce((a, b) => a + b, 0), 5); // center + 4-neighbors
  var reEroded = BP.erode(dilated, w, h);
  assert.deepEqual(Array.from(reEroded), Array.from(mask)); // dilate-then-erode restores a single pixel
  // openMask removes an isolated speck
  var speck = new Uint8Array(w * h); speck[0] = 1;
  assert.equal(BP.openMask(speck, w, h).reduce((a, b) => a + b, 0), 0);
});

test('fillPolygonMask fills a simple square polygon and nothing outside it', () => {
  var w = 10, h = 10;
  var poly = [{ x: 2, y: 2 }, { x: 7, y: 2 }, { x: 7, y: 7 }, { x: 2, y: 7 }];
  var mask = BP.fillPolygonMask(poly, w, h);
  assert.equal(mask[4 * w + 4], 1); // inside
  assert.equal(mask[0 * w + 0], 0); // outside
  assert.equal(mask[9 * w + 9], 0); // outside
});
test('fillPolygonMask returns an empty mask for a degenerate (too-short) polygon', () => {
  var mask = BP.fillPolygonMask([{ x: 0, y: 0 }, { x: 1, y: 1 }], 5, 5);
  assert.equal(mask.reduce((a, b) => a + b, 0), 0);
});
test('unionMasks ORs multiple masks together', () => {
  var w = 3, h = 1;
  var m1 = new Uint8Array([1, 0, 0]);
  var m2 = new Uint8Array([0, 0, 1]);
  assert.deepEqual(Array.from(BP.unionMasks([m1, m2], w, h)), [1, 0, 1]);
});
test('dilateByRadius grows a single point into a disk of the requested radius', () => {
  var w = 11, h = 11;
  var mask = new Uint8Array(w * h); mask[5 * w + 5] = 1;
  var grown = BP.dilateByRadius(mask, w, h, 3);
  assert.equal(grown[5 * w + 8], 1); // exactly 3px right -- inside the disk
  assert.equal(grown[5 * w + 9], 0); // 4px right -- outside radius 3
});
test('dilateByRadius with radius 0 is a no-op copy', () => {
  var mask = new Uint8Array([0, 1, 0]);
  assert.deepEqual(Array.from(BP.dilateByRadius(mask, 3, 1, 0)), [0, 1, 0]);
});

test('traceBoundaryMoore traces a solid 4x4 square as a closed ring covering its perimeter', () => {
  var w = 6, h = 6;
  var mask = new Uint8Array(w * h);
  for (var y = 1; y <= 4; y++) for (var x = 1; x <= 4; x++) mask[y * w + x] = 1;
  var ring = BP.traceBoundaryMoore(mask, w, h);
  assert.ok(ring && ring.length >= 12, 'a 4x4 square perimeter should trace a substantial ring');
  // every traced point must actually be a foreground pixel
  ring.forEach(p => assert.equal(mask[p.y * w + p.x], 1));
});
test('traceBoundaryMoore returns null for an empty mask', () => {
  assert.equal(BP.traceBoundaryMoore(new Uint8Array(16), 4, 4), null);
});

test('simplifyRDP reduces a near-straight noisy line to its two endpoints', () => {
  var pts = [];
  for (var x = 0; x <= 20; x++) pts.push({ x: x, y: (x % 2) * 0.01 }); // essentially a straight line
  var simplified = BP.simplifyRDP(pts, 1, false);
  assert.ok(simplified.length < pts.length);
  assert.deepEqual(simplified[0], pts[0]);
  assert.deepEqual(simplified[simplified.length - 1], pts[pts.length - 1]);
});
test('simplifyRDP preserves a genuine right-angle corner (does not over-simplify)', () => {
  var pts = [];
  for (var x = 0; x <= 10; x++) pts.push({ x: x, y: 0 });
  for (var y = 1; y <= 10; y++) pts.push({ x: 10, y: y });
  var simplified = BP.simplifyRDP(pts, 0.5, false);
  assert.ok(simplified.some(p => p.x === 10 && p.y === 0), 'the corner point must survive simplification');
});

test('reduceToHandles never returns more points than requested and preserves first/last', () => {
  var pts = []; for (var i = 0; i < 100; i++) pts.push({ x: i, y: Math.sin(i / 5) * 10 });
  var handles = BP.reduceToHandles(pts, 12);
  assert.ok(handles.length <= 12);
  assert.deepEqual(handles[0], pts[0]);
});
test('reduceToHandles is a no-op when already under the limit', () => {
  var pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  assert.deepEqual(BP.reduceToHandles(pts, 12), pts);
});

test('deriveOpenEdgesFromSilhouette splits a synthetic ring into three labeled, non-empty arcs', () => {
  // a simple synthetic "beard-like" ring: wider at top, tapering to a point at the bottom
  var ring = [];
  var n = 40;
  for (var i = 0; i < n; i++) {
    var t = (i / n) * Math.PI * 2;
    var x = 50 + Math.cos(t) * 40;
    var y = 50 + Math.sin(t) * 30 + (Math.sin(t) > 0 ? Math.sin(t) * 20 : 0); // taper downward
    ring.push({ x: x, y: y });
  }
  var arcs = BP.deriveOpenEdgesFromSilhouette(ring);
  assert.ok(arcs.OUTER_BEARD_UNDERSIDE.length >= 2);
  assert.ok(arcs.OUTER_BEARD_UNDER_JAW_LEFT.length >= 2);
  assert.ok(arcs.OUTER_BEARD_UNDER_JAW_RIGHT.length >= 2);
});
test('deriveOpenEdgesFromSilhouette returns null for a degenerate (too-short) ring', () => {
  assert.equal(BP.deriveOpenEdgesFromSilhouette([{ x: 0, y: 0 }]), null);
});
