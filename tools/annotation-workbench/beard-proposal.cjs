/*
 * Mettle BI-1Y2 — machine beard-boundary PROPOSAL geometry. PURE DATA/ALGORITHM CORE.
 * Stage BI-1Y2. Development / research tool. NOT part of the Mettle consumer app.
 *
 * CPU-only, dependency-free image-geometry primitives used to turn a color/gradient beard mask
 * into an editable proposal polygon. No neural model, no network, no GPU requirement. Every
 * function here operates on plain arrays/typed-arrays so it is testable under `node --test`
 * without a DOM or canvas -- the browser-only glue that actually decodes an <img> into pixels
 * (tools/annotation-workbench/index.html's Assisted Review mode) is a thin wrapper around these.
 *
 * A proposal produced by this module is NEVER GroundTruth by itself (see annotation-workbench.cjs
 * BI-1Y2 section) -- it is only ever a starting point for human review/correction/approval.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BeardProposal = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var PROPOSAL_ALGORITHM_VERSION = 'beard-proposal/1';

  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }

  // ---- BI-1Z1A — tracked-landmark lower-face ROI (mirrors accuracy/annotation-overlay-data.mjs
  // exactly -- a node test cross-checks these arrays stay byte-identical to that ESM module, since
  // this UMD copy exists only so a plain <script> tag in index.html can use it without a module
  // loader). Deliberately restricted to lower-face-relevant rails/reference points -- this is NOT
  // a full-face landmark set. */
  var LOWER_FACE_ROI_VERSION = 'tracked-lower-face-landmark-roi/1';
  var JAW_CHIN_RAIL = Object.freeze([172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397]);
  var CHEEK_RAIL_RIGHT = Object.freeze([234, 116, 123, 205, 186]);
  var CHEEK_RAIL_LEFT = Object.freeze([454, 345, 352, 425, 410]);
  var MOUTH_REFERENCE = Object.freeze([61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]);
  var LOWER_FACE_ROI_SOURCE_INDICES = Object.freeze(
    Array.from(new Set([].concat(JAW_CHIN_RAIL, CHEEK_RAIL_RIGHT, CHEEK_RAIL_LEFT, MOUTH_REFERENCE))).sort(function (a, b) { return a - b; })
  );
  var JAW_ANGLE_RIGHT_INDEX = 172, JAW_ANGLE_LEFT_INDEX = 397; // frozen PERSON_ANATOMY_SIDES jaw-angle pair

  /** Standard Andrew's monotone-chain convex hull. Deterministic, no library. Returns a
   *  counter-clockwise-or-clockwise (whichever the sweep produces) simple closed ring with no
   *  collinear-redundant points; input order does not matter. Fewer than 3 distinct points returns
   *  the input (a hull is undefined/degenerate). */
  function convexHull(points) {
    var pts = (points || []).slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    if (pts.length <= 2) return pts.slice();
    function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    var lower = [];
    for (var i = 0; i < pts.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
      lower.push(pts[i]);
    }
    var upper = [];
    for (i = pts.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
      upper.push(pts[i]);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  /** BI-1Z1A Part 5 -- autonomous, image-evidence-free-of-human-trace search-region prior. Builds
   *  a generous lower-face ROI from ONLY this frame's own tracked landmarks (never an old human
   *  trace -- Part 4). `landmarks2D` is the full 468-point array (index-addressed, {x,y} normalized
   *  0..1) as carried on an Exact-Frame Tier-B keyframe. Returns null if the required jaw-angle
   *  landmarks are missing (fails closed, never guesses a region). The returned polygon is the
   *  CONVEX HULL of the lower-face rail/reference points in raw IMAGE pixel space, and marginPx is
   *  a per-frame-adaptive (not hand-tuned, not fit to any human answer) dilation radius: half of
   *  this frame's own jaw-angle-to-jaw-angle span, so a closer/farther face gets a proportionally
   *  larger/smaller margin instead of one fixed pixel constant. */
  function buildLandmarkLowerFaceROI(landmarks2D, imageWidth, imageHeight) {
    if (!Array.isArray(landmarks2D) || !isFiniteNum(imageWidth) || !isFiniteNum(imageHeight) || imageWidth <= 0 || imageHeight <= 0) return null;
    var right = landmarks2D[JAW_ANGLE_RIGHT_INDEX], left = landmarks2D[JAW_ANGLE_LEFT_INDEX];
    if (!right || !left || !isFiniteNum(right.x) || !isFiniteNum(right.y) || !isFiniteNum(left.x) || !isFiniteNum(left.y)) return null;
    var srcPts = [];
    for (var i = 0; i < LOWER_FACE_ROI_SOURCE_INDICES.length; i++) {
      var idx = LOWER_FACE_ROI_SOURCE_INDICES[i], lm = landmarks2D[idx];
      if (!lm || !isFiniteNum(lm.x) || !isFiniteNum(lm.y)) continue; // fail closed per-point, never fabricate
      srcPts.push({ x: lm.x * imageWidth, y: lm.y * imageHeight, index: idx });
    }
    if (srcPts.length < 3) return null;
    var hull = convexHull(srcPts.map(function (p) { return { x: p.x, y: p.y }; }));
    if (hull.length < 3) return null;
    var rx = right.x * imageWidth, ry = right.y * imageHeight, lx = left.x * imageWidth, ly = left.y * imageHeight;
    var jawSpanPx = Math.hypot(rx - lx, ry - ly);
    var marginPx = Math.max(4, Math.round(0.5 * jawSpanPx));
    var dilated = dilatePolygonRadially(hull, marginPx);
    return {
      polygon: dilated,        // the actual generous search-region polygon -- pass straight to fillPolygonMask
      hullPolygon: hull,       // undilated convex hull, kept only for diagnostics/visualization
      sourceIndices: srcPts.map(function (p) { return p.index; }),
      jawSpanPx: jawSpanPx,
      marginPx: marginPx,
      roiConstructionVersion: LOWER_FACE_ROI_VERSION,
      provenance: 'TRACKED_LOWER_FACE_LANDMARK_ROI'
    };
  }

  /** Expands a (roughly convex, centered) polygon outward by `r` pixels along each vertex's own
   *  radial direction from the polygon centroid. NOT a true Minkowski-sum offset, but a cheap O(n)
   *  and deterministic way to grow a hull-shaped search-region prior by a large margin -- chosen
   *  specifically because the mask-based dilateByRadius (O(foreground_pixels * r^2)) is far too
   *  slow for the large, per-frame-adaptive margins this ROI needs (a few hundred px, vs. the small
   *  ~3%-of-image-size margin the old BI-1Y2 human-trace-hint prior used). */
  function dilatePolygonRadially(polygon, r) {
    if (!Array.isArray(polygon) || !polygon.length || r <= 0) return (polygon || []).slice();
    var cx = 0, cy = 0;
    polygon.forEach(function (p) { cx += p.x; cy += p.y; });
    cx /= polygon.length; cy /= polygon.length;
    return polygon.map(function (p) {
      var dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy);
      if (d === 0) return { x: p.x, y: p.y };
      var scale = (d + r) / d;
      return { x: cx + dx * scale, y: cy + dy * scale };
    });
  }

  // ---- Otsu's method: automatic threshold from a histogram -----------------
  // Standard, deterministic, single-pass-derivable threshold selection (Otsu 1979) -- chosen
  // instead of a fixed magic-number brightness cutoff so the threshold adapts to each image's
  // own lighting rather than being hand-tuned to these 5 development photos.
  function otsuThreshold(histogram) {
    var total = 0;
    for (var i = 0; i < histogram.length; i++) total += histogram[i];
    if (total === 0) return 0;
    var sum = 0;
    for (i = 0; i < histogram.length; i++) sum += i * histogram[i];
    var sumB = 0, wB = 0, wF = 0, maxVar = 0, threshold = 0;
    for (i = 0; i < histogram.length; i++) {
      wB += histogram[i];
      if (wB === 0) continue;
      wF = total - wB;
      if (wF === 0) break;
      sumB += i * histogram[i];
      var mB = sumB / wB;
      var mF = (sum - sumB) / wF;
      var varBetween = wB * wF * (mB - mF) * (mB - mF);
      if (varBetween > maxVar) { maxVar = varBetween; threshold = i; }
    }
    return threshold;
  }
  function histogramOf(values, bins) {
    bins = bins || 256;
    var h = new Array(bins).fill(0);
    for (var i = 0; i < values.length; i++) {
      var v = Math.max(0, Math.min(bins - 1, Math.round(values[i])));
      h[v]++;
    }
    return h;
  }

  // ---- grayscale + local texture (variance) --------------------------------
  // ITU-R BT.601 luma weights -- standard, not tuned.
  function rgbaToGray(rgba, w, h) {
    var gray = new Float32Array(w * h);
    for (var i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    }
    return gray;
  }
  /** Local standard deviation in a (2r+1)x(2r+1) window -- a simple, well-understood texture
   *  measure: hair has high local contrast, a smooth shirt/skin patch does not. */
  function localVariance(gray, w, h, r) {
    r = r || 2;
    var out = new Float32Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var sum = 0, sumSq = 0, n = 0;
        for (var dy = -r; dy <= r; dy++) {
          var yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (var dx = -r; dx <= r; dx++) {
            var xx = x + dx; if (xx < 0 || xx >= w) continue;
            var v = gray[yy * w + xx];
            sum += v; sumSq += v * v; n++;
          }
        }
        var mean = sum / n;
        out[y * w + x] = Math.max(0, sumSq / n - mean * mean);
      }
    }
    return out;
  }
  // Sobel gradient magnitude -- standard 3x3 kernels, used for the optional local edge-snap only.
  function sobelMagnitude(gray, w, h) {
    var out = new Float32Array(w * h);
    var gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    var gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var sx = 0, sy = 0, k = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++, k++) {
            var v = gray[(y + dy) * w + (x + dx)];
            sx += v * gx[k]; sy += v * gy[k];
          }
        }
        out[y * w + x] = Math.sqrt(sx * sx + sy * sy);
      }
    }
    return out;
  }

  // ---- connected components (4-connectivity flood fill) --------------------
  /** Labels connected components of a binary mask (Uint8Array of 0/1). Returns
   *  {labels:Int32Array, count, sizes:[...]}. Pure BFS flood fill -- no recursion depth risk. */
  function connectedComponents(mask, w, h) {
    var labels = new Int32Array(w * h).fill(-1);
    var sizes = [];
    var label = 0;
    var stack = [];
    for (var start = 0; start < mask.length; start++) {
      if (mask[start] === 0 || labels[start] !== -1) continue;
      var size = 0;
      stack.push(start); labels[start] = label;
      while (stack.length) {
        var idx = stack.pop();
        size++;
        var x = idx % w, y = (idx / w) | 0;
        var neigh = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (var n = 0; n < 4; n++) {
          var nx = neigh[n][0], ny = neigh[n][1];
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          var nIdx = ny * w + nx;
          if (mask[nIdx] === 1 && labels[nIdx] === -1) { labels[nIdx] = label; stack.push(nIdx); }
        }
      }
      sizes.push(size);
      label++;
    }
    return { labels: labels, count: label, sizes: sizes };
  }
  /** Returns a new binary mask containing only the single largest connected component, or an
   *  all-zero mask if the input has no foreground pixels. Never guesses a shape with no evidence. */
  function largestComponentMask(mask, w, h) {
    var cc = connectedComponents(mask, w, h);
    var out = new Uint8Array(w * h);
    if (cc.count === 0) return out;
    var bestLabel = 0, bestSize = cc.sizes[0];
    for (var i = 1; i < cc.sizes.length; i++) if (cc.sizes[i] > bestSize) { bestSize = cc.sizes[i]; bestLabel = i; }
    for (i = 0; i < out.length; i++) if (cc.labels[i] === bestLabel) out[i] = 1;
    return out;
  }

  // ---- minimal binary morphology (3x3, 4-connectivity) ---------------------
  function dilate(mask, w, h) {
    var out = new Uint8Array(mask);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var idx = y * w + x;
      if (mask[idx] === 1) continue;
      if ((x > 0 && mask[idx - 1]) || (x < w - 1 && mask[idx + 1]) ||
          (y > 0 && mask[idx - w]) || (y < h - 1 && mask[idx + w])) out[idx] = 1;
    }
    return out;
  }
  function erode(mask, w, h) {
    var out = new Uint8Array(mask);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var idx = y * w + x;
      if (mask[idx] === 0) continue;
      var edge = (x === 0 || x === w - 1 || y === 0 || y === h - 1);
      if (edge || !mask[idx - 1] || !mask[idx + 1] || !mask[idx - w] || !mask[idx + w]) out[idx] = 0;
    }
    return out;
  }
  function closeMask(mask, w, h) { return erode(dilate(mask, w, h), w, h); } // fills small gaps
  function openMask(mask, w, h) { return dilate(erode(mask, w, h), w, h); } // removes small specks

  // ---- polygon scanline fill (spatial-prior mask from old traces) ---------
  // Standard even-odd scanline polygon fill. Used ONLY to turn a rough prior shape (e.g. the
  // union of BI-1Y's old, topologically-invalid closed loops) into a soft SEARCH REGION for the
  // real color/texture evidence below -- never treated as the answer itself (Part "USE OF OLD
  // MANUAL TRACES": rough spatial hints only, the proposal boundary is still derived from image
  // evidence inside this region).
  function fillPolygonMask(polygon, w, h) {
    var mask = new Uint8Array(w * h);
    if (!Array.isArray(polygon) || polygon.length < 3) return mask;
    var n = polygon.length;
    var minY = Infinity, maxY = -Infinity;
    polygon.forEach(function (p) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; });
    minY = Math.max(0, Math.floor(minY)); maxY = Math.min(h - 1, Math.ceil(maxY));
    for (var y = minY; y <= maxY; y++) {
      var yc = y + 0.5;
      var xs = [];
      for (var i = 0; i < n; i++) {
        var a = polygon[i], b = polygon[(i + 1) % n];
        if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
          xs.push(a.x + (yc - a.y) / (b.y - a.y) * (b.x - a.x));
        }
      }
      xs.sort(function (p, q) { return p - q; });
      for (var k = 0; k + 1 < xs.length; k += 2) {
        var x0 = Math.max(0, Math.round(xs[k])), x1 = Math.min(w - 1, Math.round(xs[k + 1]));
        for (var x = x0; x <= x1; x++) mask[y * w + x] = 1;
      }
    }
    return mask;
  }
  /** Union (logical OR) of several masks of the same w/h. */
  function unionMasks(masks, w, h) {
    var out = new Uint8Array(w * h);
    masks.forEach(function (m) { for (var i = 0; i < out.length; i++) if (m[i]) out[i] = 1; });
    return out;
  }
  /** Grows (dilates) a mask by `r` pixels using a simple squared-distance disk -- used to widen a
   *  polygon-derived prior mask by a generous margin so it tolerates the prior shape being
   *  somewhat off, without growing so far it stops constraining the search at all. */
  function dilateByRadius(mask, w, h, r) {
    if (r <= 0) return new Uint8Array(mask);
    var out = new Uint8Array(w * h);
    var r2 = r * r;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        var y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
        var x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) {
          if ((xx - x) * (xx - x) + (yy - y) * (yy - y) <= r2) out[yy * w + xx] = 1;
        }
      }
    }
    return out;
  }

  // ---- Moore-neighbor boundary tracing --------------------------------------
  /** Traces the outer boundary of the (single, already-largest-component) foreground region of a
   *  binary mask as an ordered, CLOSED ring of pixel-center points. Standard Moore-neighbor
   *  tracing (Gonzalez & Woods) -- deterministic, no library. Returns null if the mask is empty.
   *  `points[0] === points[points.length-1]` is NOT guaranteed/appended; the ring is implicitly
   *  closed (last connects back to first) exactly like the rest of this project's polygon
   *  handling (see AWB shoelace-style consumers). */
  function traceBoundaryMoore(mask, w, h) {
    var start = -1;
    for (var i = 0; i < mask.length; i++) if (mask[i] === 1) { start = i; break; }
    if (start === -1) return null;
    var startX = start % w, startY = (start / w) | 0;
    // 8-neighbor clockwise offsets starting "west" (standard Moore boundary tracing order)
    var DIRS = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
    function at(x, y) { return (x < 0 || x >= w || y < 0 || y >= h) ? 0 : mask[y * w + x]; }
    var points = [];
    var cx = startX, cy = startY, backtrack = 0; // dir index we arrived FROM
    var firstStep = true;
    var guard = w * h * 8 + 8; // absolute upper bound on steps -- never infinite-loop on bad input
    while (guard-- > 0) {
      points.push({ x: cx, y: cy });
      var found = false;
      for (var k = 0; k < 8; k++) {
        var dIdx = (backtrack + 1 + k) % 8; // search starting just after the backtrack direction
        var nx = cx + DIRS[dIdx][0], ny = cy + DIRS[dIdx][1];
        if (at(nx, ny) === 1) {
          cx = nx; cy = ny;
          backtrack = (dIdx + 4) % 8; // direction back to where we came from, for the next step
          found = true;
          break;
        }
      }
      if (!found) break; // isolated single pixel
      if (!firstStep && cx === startX && cy === startY) break; // closed the ring
      firstStep = false;
    }
    return points;
  }

  // ---- Ramer-Douglas-Peucker polyline simplification ------------------------
  /** Standard RDP simplification. Used twice: once lightly (keep the "full proposal" detailed),
   *  once aggressively (derive a small, human-manageable set of draggable control handles) --
   *  the full unsimplified trace is always preserved separately for provenance (Part "CONTROL
   *  POINTS": never discard the original machine proposal). Treats the input as a CLOSED ring
   *  when `closed` is true (keeps it closed through simplification), open otherwise. */
  function simplifyRDP(points, epsilon, closed) {
    if (!Array.isArray(points) || points.length < 3) return points ? points.slice() : [];
    function perpDist(p, a, b) {
      var dx = b.x - a.x, dy = b.y - a.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
      return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
    }
    function rdp(pts, eps) {
      if (pts.length < 3) return pts.slice();
      var maxD = 0, idx = 0;
      for (var i = 1; i < pts.length - 1; i++) {
        var d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > eps) {
        var left = rdp(pts.slice(0, idx + 1), eps);
        var right = rdp(pts.slice(idx), eps);
        return left.slice(0, -1).concat(right);
      }
      return [pts[0], pts[pts.length - 1]];
    }
    if (!closed) return rdp(points, epsilon);
    // For a closed ring, split at the two points farthest apart, simplify each half, then splice.
    var n = points.length, aIdx = 0, bIdx = 0, best = -1;
    for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) {
      var d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      if (d > best) { best = d; aIdx = i; bIdx = j; }
    }
    var lo = Math.min(aIdx, bIdx), hi = Math.max(aIdx, bIdx);
    var half1 = rdp(points.slice(lo, hi + 1), epsilon);
    var half2 = rdp(points.slice(hi).concat(points.slice(0, lo + 1)), epsilon);
    return half1.slice(0, -1).concat(half2.slice(0, -1));
  }

  // ---- deterministic control-handle reduction -------------------------------
  /** Reduces a (possibly dense) traced/simplified ring to at most `maxHandles` roughly
   *  arc-length-evenly-spaced points, for human dragging. The dense input is NEVER discarded by
   *  the caller -- this is only the editable-handle projection. Deterministic, no randomness. */
  function reduceToHandles(points, maxHandles) {
    if (!Array.isArray(points) || points.length === 0) return [];
    if (points.length <= maxHandles) return points.slice();
    var n = points.length;
    var lengths = [0];
    for (var i = 1; i < n; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    var total = lengths[n - 1];
    var out = [];
    for (var h = 0; h < maxHandles; h++) {
      var target = (total * h) / maxHandles;
      var idx = 0;
      while (idx < n - 1 && lengths[idx + 1] < target) idx++;
      out.push(points[idx]);
    }
    return out;
  }

  // ---- deterministic open-edge derivation from a closed silhouette ring -----
  /** PROOF-OF-FEASIBILITY ONLY (per instruction: not the delivered extraction, just proof it is
   *  possible). Splits a closed beard-silhouette ring into three open arcs approximating
   *  OUTER_BEARD_UNDERSIDE / _UNDER_JAW_LEFT / _UNDER_JAW_RIGHT, using only the ring's own
   *  geometry (its lowest point = underside apex, split left/right of the ring's horizontal
   *  midpoint). No anatomy is inferred beyond what the ring itself already encodes. */
  function deriveOpenEdgesFromSilhouette(ring) {
    if (!Array.isArray(ring) || ring.length < 4) return null;
    var minX = Infinity, maxX = -Infinity, maxYIdx = 0, maxY = -Infinity;
    ring.forEach(function (p, i) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) { maxY = p.y; maxYIdx = i; }
    });
    var midX = (minX + maxX) / 2;
    // Walk the ring both directions from the lowest ("underside apex") point until crossing midX,
    // giving a left half-arc and a right half-arc; a short window centered on the apex becomes
    // the underside segment.
    var n = ring.length;
    function next(i) { return (i + 1) % n; }
    function prev(i) { return (i - 1 + n) % n; }
    var leftArc = [ring[maxYIdx]], i = maxYIdx;
    for (var guard = 0; guard < n; guard++) { i = prev(i); leftArc.push(ring[i]); if (ring[i].x < midX) break; }
    var rightArc = [ring[maxYIdx]]; i = maxYIdx;
    for (guard = 0; guard < n; guard++) { i = next(i); rightArc.push(ring[i]); if (ring[i].x > midX) break; }
    var undersideSpan = Math.max(2, Math.round(n * 0.12));
    var underside = [];
    i = maxYIdx;
    for (var s = -undersideSpan; s <= undersideSpan; s++) underside.push(ring[((maxYIdx + s) % n + n) % n]);
    return {
      OUTER_BEARD_UNDERSIDE: underside,
      OUTER_BEARD_UNDER_JAW_LEFT: leftArc,
      OUTER_BEARD_UNDER_JAW_RIGHT: rightArc
    };
  }

  return {
    PROPOSAL_ALGORITHM_VERSION: PROPOSAL_ALGORITHM_VERSION,
    LOWER_FACE_ROI_VERSION: LOWER_FACE_ROI_VERSION,
    JAW_CHIN_RAIL: JAW_CHIN_RAIL, CHEEK_RAIL_RIGHT: CHEEK_RAIL_RIGHT, CHEEK_RAIL_LEFT: CHEEK_RAIL_LEFT,
    MOUTH_REFERENCE: MOUTH_REFERENCE, LOWER_FACE_ROI_SOURCE_INDICES: LOWER_FACE_ROI_SOURCE_INDICES,
    JAW_ANGLE_RIGHT_INDEX: JAW_ANGLE_RIGHT_INDEX, JAW_ANGLE_LEFT_INDEX: JAW_ANGLE_LEFT_INDEX,
    convexHull: convexHull,
    buildLandmarkLowerFaceROI: buildLandmarkLowerFaceROI,
    dilatePolygonRadially: dilatePolygonRadially,
    otsuThreshold: otsuThreshold,
    histogramOf: histogramOf,
    rgbaToGray: rgbaToGray,
    localVariance: localVariance,
    sobelMagnitude: sobelMagnitude,
    connectedComponents: connectedComponents,
    largestComponentMask: largestComponentMask,
    dilate: dilate, erode: erode, closeMask: closeMask, openMask: openMask,
    fillPolygonMask: fillPolygonMask, unionMasks: unionMasks, dilateByRadius: dilateByRadius,
    traceBoundaryMoore: traceBoundaryMoore,
    simplifyRDP: simplifyRDP,
    reduceToHandles: reduceToHandles,
    deriveOpenEdgesFromSilhouette: deriveOpenEdgesFromSilhouette
  };
});
