// Stage BI-2F0 -- PRECISION ANNOTATION UX + BLIND-GT INTEGRITY CORE.
// Pure, dependency-free logic shared by the workbench's existing contour (OPEN_POLYLINE) and
// assisted-review (CLOSED_POLYGON) editors. No DOM, no I/O, no network. Classic script (works via
// <script src> in the browser AND `require()` under node --test), matching annotation-workbench.cjs
// and beard-proposal.cjs's existing convention exactly.
(function (root) {
  'use strict';

  var GEOMETRY_TYPE = Object.freeze({ OPEN_POLYLINE: 'OPEN_POLYLINE', CLOSED_POLYGON: 'CLOSED_POLYGON' });

  var BLIND_GT_MODE_FIELD = 'gtMode';
  var BLIND_GT_VALUE = 'BLIND_GT';

  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // ---------- BI-2F0A.1 -- OVERLAY GEOMETRY / CANONICAL COORDINATE MODEL ----------------------
  // ROOT CAUSE (proven by DOM structure, not guessed): the click->raw conversion always used
  // #img's OWN actual rendered box (img.clientWidth/clientHeight), but the SVG overlay
  // (#contourOverlay etc.) was sized/positioned purely via CSS ("position:absolute; inset:0;
  // width:100%; height:100%" relative to #imgStack) -- i.e. relative to the WRAPPER, not #img
  // itself. #img has `max-width:96%; max-height:96%`, and #imgStack has no explicit size of its
  // own (content-hugging inside a flex layout) -- a classic CSS percentage-of-indeterminate-
  // ancestor situation where #img's rendered box is NOT guaranteed to exactly equal #imgStack's
  // box in every browser/layout state. Whenever they differ, the SVG's viewBox-based render
  // (which stretches raw-pixel-space content to fill WHATEVER box the SVG occupies) drifts
  // systematically away from the real image pixels the click math used -- exactly the symptom
  // reported (a consistent directional offset, reproduced by two independent traces).
  //
  // FIX: stop trusting CSS percentage sizing for the overlay. Directly MEASURE #img's own
  // rendered box (via getBoundingClientRect, in the caller) and express the overlay's box in the
  // SAME coordinate frame the click handler already uses (relative to the container/#imgStack
  // origin). This function is the pure geometry step of that measurement -- it takes two already-
  // measured DOMRect-like objects ({left,top,width,height}) and returns the overlay's exact box
  // relative to the container. No DOM access happens here; the caller (index.html) does the
  // getBoundingClientRect() calls and passes plain objects in, so this stays unit-testable.
  function computeOverlayBoxFromRects(imgRect, containerRect) {
    return {
      left: imgRect.left - containerRect.left,
      top: imgRect.top - containerRect.top,
      width: imgRect.width,
      height: imgRect.height
    };
  }

  /** display point (relative to the SAME container origin overlayBox.left/top use) -> canonical
   *  raw image pixel. This is algebraically the same ratio math displayClickToImagePoint always
   *  used (offsetX/offsetY are already relative to #img's own box, i.e. already "local" -- this
   *  generalized version additionally subtracts overlayBox.left/top so it also accepts a point
   *  measured relative to the container, which the round-trip diagnostic needs). */
  function displayToRaw(displayX, displayY, overlayBox, naturalWidth, naturalHeight) {
    if (!overlayBox || overlayBox.width <= 0 || overlayBox.height <= 0) return null;
    var localX = displayX - overlayBox.left, localY = displayY - overlayBox.top;
    return { x: localX * (naturalWidth / overlayBox.width), y: localY * (naturalHeight / overlayBox.height) };
  }

  /** Inverse of displayToRaw -- canonical raw image pixel -> display point (relative to the same
   *  container origin). This is exactly what the SVG viewBox scaling does visually; expressing it
   *  as a pure function lets the round-trip diagnostic prove the two halves agree numerically. */
  function rawToDisplay(rawX, rawY, overlayBox, naturalWidth, naturalHeight) {
    if (!overlayBox || naturalWidth <= 0 || naturalHeight <= 0) return null;
    var localX = rawX * (overlayBox.width / naturalWidth), localY = rawY * (overlayBox.height / naturalHeight);
    return { x: overlayBox.left + localX, y: overlayBox.top + localY };
  }

  /** Part 3/4 -- the round-trip diagnostic itself: display -> raw -> display, reporting the
   *  residual. When overlayBox is the CORRECT box (== #img's own measured rect, the BI-2F0A.1
   *  fix), this residual is bounded only by floating-point rounding (<< 0.5px). If overlayBox were
   *  instead the (buggy) container-assumed box while the click math used #img's real box, this
   *  same function -- called with the WRONG overlayBox -- reproduces the historical drift, which
   *  is exactly how this stage's regression tests prove the bug and the fix. */
  function roundTripResidual(displayX, displayY, overlayBox, naturalWidth, naturalHeight) {
    var raw = displayToRaw(displayX, displayY, overlayBox, naturalWidth, naturalHeight);
    if (!raw) return null;
    var back = rawToDisplay(raw.x, raw.y, overlayBox, naturalWidth, naturalHeight);
    if (!back) return null;
    var deltaX = back.x - displayX, deltaY = back.y - displayY;
    return { raw: raw, displayBack: back, deltaX: deltaX, deltaY: deltaY, residualPx: Math.hypot(deltaX, deltaY) };
  }

  // ---------- BI-2F0A UX addition -- persistent side loupe (pure geometry only) ---------------
  var LOUPE_ZOOM_LEVELS = Object.freeze([4, 6, 8, 10]);
  var DEFAULT_LOUPE_ZOOM = 6;
  /** Given a RAW-image-pixel focus point and a canvas size, returns the source crop rectangle
   *  (in the SAME raw-image-pixel space) that the canvas should sample via drawImage -- pure
   *  geometry, no DOM. The caller draws with imageSmoothingEnabled=false and this exact rect;
   *  no interpolation/sharpening/enhancement is computed here or anywhere else. */
  function computeLoupeSampleRect(centerX, centerY, zoomFactor, canvasSizePx) {
    var z = LOUPE_ZOOM_LEVELS.indexOf(zoomFactor) !== -1 ? zoomFactor : DEFAULT_LOUPE_ZOOM;
    var half = canvasSizePx / (2 * z);
    return { sx: centerX - half, sy: centerY - half, sw: half * 2, sh: half * 2 };
  }

  // ---------- Part 6: ordered insertion (shared by both editors) ----------
  /** Inserts {x,y} immediately after index `afterIndex` (use -1 to insert at the very front).
   *  Never appends to the end unless afterIndex is the last valid index -- callers pick the
   *  target segment (e.g. nearest-edge) and this never reorders existing points. */
  function insertPointOrdered(points, afterIndex, x, y) {
    if (!Array.isArray(points)) throw new Error('insertPointOrdered: points must be an array');
    if (!isFiniteNum(x) || !isFiniteNum(y)) throw new Error('insertPointOrdered: x/y must be finite');
    if (afterIndex < -1 || afterIndex >= points.length) throw new Error('insertPointOrdered: afterIndex out of range');
    var next = points.slice();
    next.splice(afterIndex + 1, 0, { x: x, y: y });
    return next;
  }

  // ---------- Part 11/12: non-destructive geometry quality warnings ----------
  function segmentsIntersect(p1, p2, p3, p4) {
    function ccw(a, b, c) { return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x); }
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
  }
  /** Returns index-pairs of NON-ADJACENT segments that cross. `closed` adds the wrap-around edge.
   *  Adjacent segments (which always share an endpoint) are never flagged. */
  function findSelfIntersections(points, closed) {
    if (!Array.isArray(points) || points.length < 4) return [];
    var n = points.length;
    var edgeCount = closed ? n : n - 1;
    var out = [];
    for (var i = 0; i < edgeCount; i++) {
      var a1 = points[i], a2 = points[(i + 1) % n];
      for (var j = i + 2; j < edgeCount; j++) {
        if (closed && i === 0 && j === edgeCount - 1) continue; // adjacent wrap-around edge
        var b1 = points[j], b2 = points[(j + 1) % n];
        if (segmentsIntersect(a1, a2, b1, b2)) out.push([i, j]);
      }
    }
    return out;
  }

  var DUPLICATE_EPS_PX = 0.01;
  var NEAR_DUPLICATE_EPS_PX = 1.5;
  /** Returns indices of consecutive points that are exact or near-duplicates of their predecessor. */
  function findDuplicatePoints(points) {
    var out = [];
    for (var i = 1; i < (points || []).length; i++) {
      var d = dist(points[i - 1], points[i]);
      if (d <= DUPLICATE_EPS_PX) out.push({ index: i, kind: 'EXACT_DUPLICATE', distancePx: d });
      else if (d <= NEAR_DUPLICATE_EPS_PX) out.push({ index: i, kind: 'NEAR_DUPLICATE', distancePx: d });
    }
    return out;
  }

  function findOutOfBoundsPoints(points, w, h) {
    if (!isFiniteNum(w) || !isFiniteNum(h) || w <= 0 || h <= 0) return null; // invalid dimensions -- caller reports separately
    var out = [];
    (points || []).forEach(function (p, i) { if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) out.push(i); });
    return out;
  }

  /** DISCLOSED heuristic (never a hidden/learned threshold): a new point is flagged if its segment
   *  to the previous point is more than `multiplier`x the MEDIAN of the OTHER existing segment
   *  lengths (requires at least 3 existing points so a median is meaningful), with a minimum
   *  absolute floor (`floorPx`) so early tiny segments on a small curve don't produce noise. */
  function largeJumpWarning(points, multiplier, floorPx) {
    multiplier = isFiniteNum(multiplier) ? multiplier : 4;
    floorPx = isFiniteNum(floorPx) ? floorPx : 8;
    if (!Array.isArray(points) || points.length < 4) return null;
    var lengths = [];
    for (var i = 1; i < points.length - 1; i++) lengths.push(dist(points[i - 1], points[i]));
    if (lengths.length < 2) return null;
    var sorted = lengths.slice().sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)];
    var lastSeg = dist(points[points.length - 2], points[points.length - 1]);
    var threshold = Math.max(median * multiplier, floorPx);
    if (lastSeg > threshold) return { lastSegmentLengthPx: lastSeg, medianOtherSegmentLengthPx: median, thresholdPx: threshold };
    return null;
  }

  /** Part 9: OPEN_POLYLINE nearly-closed detection -- fraction of the image diagonal, disclosed
   *  and fixed (never learned). Returns the ratio so the caller can word the warning; never
   *  mutates the curve. */
  function nearClosedOpenCurveWarning(points, w, h, thresholdFraction) {
    thresholdFraction = isFiniteNum(thresholdFraction) ? thresholdFraction : 0.03;
    if (!Array.isArray(points) || points.length < 3) return null;
    if (!isFiniteNum(w) || !isFiniteNum(h) || w <= 0 || h <= 0) return null;
    var diagonal = Math.hypot(w, h);
    var endpointDist = dist(points[0], points[points.length - 1]);
    var ratio = endpointDist / diagonal;
    if (ratio <= thresholdFraction) return { endpointDistancePx: endpointDist, diagonalPx: diagonal, ratio: ratio, thresholdFraction: thresholdFraction };
    return null;
  }

  /** Aggregate, non-destructive validator. Never repairs -- returns {warnings, errors, minPointsOk}. */
  function validateGeometry(points, geometryType, w, h, opts) {
    opts = opts || {};
    var pts = points || [];
    var warnings = [], errors = [];
    var minPoints = geometryType === GEOMETRY_TYPE.CLOSED_POLYGON ? 3 : 2;
    var minPointsOk = pts.length >= minPoints;
    if (!minPointsOk) errors.push('TOO_FEW_POINTS');
    if (!isFiniteNum(w) || !isFiniteNum(h) || w <= 0 || h <= 0) errors.push('INVALID_IMAGE_DIMENSIONS');
    else {
      var oob = findOutOfBoundsPoints(pts, w, h);
      if (oob && oob.length) errors.push('POINTS_OUT_OF_BOUNDS');
    }
    var dupes = findDuplicatePoints(pts);
    if (dupes.some(function (d) { return d.kind === 'EXACT_DUPLICATE'; })) warnings.push('DUPLICATE_CONSECUTIVE_POINT');
    if (dupes.some(function (d) { return d.kind === 'NEAR_DUPLICATE'; })) warnings.push('NEAR_DUPLICATE_POINT');
    var closed = geometryType === GEOMETRY_TYPE.CLOSED_POLYGON;
    if (pts.length >= 4 && findSelfIntersections(pts, closed).length) warnings.push('SELF_INTERSECTION');
    var jump = largeJumpWarning(pts, opts.jumpMultiplier, opts.jumpFloorPx);
    if (jump) warnings.push('LARGE_JUMP');
    if (geometryType === GEOMETRY_TYPE.OPEN_POLYLINE && isFiniteNum(w) && isFiniteNum(h)) {
      var nc = nearClosedOpenCurveWarning(pts, w, h, opts.nearCloseFraction);
      if (nc) warnings.push('OPEN_POLYLINE_NEARLY_CLOSED');
    }
    return { warnings: warnings, errors: errors, minPointsOk: minPointsOk, blocksExport: errors.length > 0 };
  }

  // ---------- Part 7: transactional undo/redo (ONE completed gesture = ONE entry) ----------
  var MAX_HISTORY = 50;
  function createHistory() { return { past: [], future: [] }; }
  /** Call ONCE per completed edit action (never per intermediate pointermove). Clears redo, since
   *  a fresh edit invalidates the old future. */
  function pushTransaction(history, snapshot) {
    var h = { past: history.past.slice(), future: [] };
    h.past.push(JSON.parse(JSON.stringify(snapshot)));
    if (h.past.length > MAX_HISTORY) h.past.shift();
    return h;
  }
  /** Returns {history, snapshot} -- snapshot is null (no-op) if there is nothing to undo.
   *  `current` is pushed onto `future` so redo can restore it. */
  function undo(history, current) {
    if (!history.past.length) return { history: history, snapshot: null };
    var past = history.past.slice();
    var restored = past.pop();
    var future = history.future.slice();
    future.push(JSON.parse(JSON.stringify(current)));
    return { history: { past: past, future: future }, snapshot: restored };
  }
  function redo(history, current) {
    if (!history.future.length) return { history: history, snapshot: null };
    var future = history.future.slice();
    var restored = future.pop();
    var past = history.past.slice();
    past.push(JSON.parse(JSON.stringify(current)));
    return { history: { past: past, future: future }, snapshot: restored };
  }

  // ---------- Part 17-21: BLIND GT ----------
  function isBlindGtBundle(bundle) { return !!(bundle && bundle[BLIND_GT_MODE_FIELD] === BLIND_GT_VALUE); }
  /** Part 18: Geometry Guide MUST default OFF for a blind bundle, and the bundle/task definition
   *  (not the annotator) controls it -- callers should also disable the toggle entirely, not just
   *  default it off. */
  function blindGtGeometryGuideForced(bundle) { return isBlindGtBundle(bundle) ? false : null; }
  /** The concrete list this stage's UI must never surface while a target is in blind mode. Purely
   *  documentary/testable -- the actual hiding happens in index.html by checking isBlindGtBundle(). */
  var BLIND_GT_FORBIDDEN_UI = Object.freeze([
    'MACHINE_BEARD_PROPOSAL', 'HAIRNESS_CLASSIFICATION', 'BI2E_OCCUPANCY_ANSWER',
    'SEMANTIC_PREDICTION', 'PREDICTED_BEARD_BOUNDARY', 'MODEL_SEGMENTATION',
    'AUTOMATIC_EDGE_SUGGESTION', 'AUTOMATIC_SNAP_TO_BOUNDARY', 'CONFIDENCE_HEATMAP',
    'RECOMMENDATION', 'ALGORITHMIC_GT_GUESS'
  ]);

  // Deterministic, dependency-free fingerprint (NOT cryptographic -- disclosed). Stable under key
  // order because canonicalStringify sorts object keys recursively before hashing.
  function canonicalStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonicalStringify).join(',') + ']';
    var keys = Object.keys(v).sort();
    return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + canonicalStringify(v[k]); }).join(',') + '}';
  }
  function fnv1aHash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  /** Deterministic fingerprint of any JSON-serializable value. Same input -> same output, always,
   *  regardless of original key insertion order. Documented as non-cryptographic (Part 20 says
   *  "if practical" -- this is the practical, dependency-free choice for a plain-HTML/JS tool). */
  function computeFingerprint(value) { return fnv1aHash(canonicalStringify(value)); }

  /** Part 20: locks a blind annotation. Returns a NEW, frozen-shape record -- never mutates the
   *  points array it was given. `meta` must carry bundleId/entryKey/target identity so the lock is
   *  traceable. */
  function lockBlindAnnotation(points, geometryType, meta) {
    meta = meta || {};
    var pointsCopy = (points || []).map(function (p) { return { x: p.x, y: p.y }; });
    var record = {
      locked: true,
      geometryType: geometryType,
      points: pointsCopy,
      lockedAtIso: meta.lockedAtIso || new Date().toISOString(),
      bundleId: meta.bundleId != null ? meta.bundleId : null,
      entryKey: meta.entryKey != null ? meta.entryKey : null,
      target: meta.target != null ? meta.target : null,
      revision: isFiniteNum(meta.revision) ? meta.revision : 1
    };
    record.fingerprint = computeFingerprint({ geometryType: record.geometryType, points: record.points, bundleId: record.bundleId, entryKey: record.entryKey, target: record.target });
    return Object.freeze(record);
  }
  /** Part 21: the ONLY sanctioned way to "change" a locked answer -- produces a brand-new revision
   *  object that REFERENCES the lock (via basedOnFingerprint/basedOnRevision) rather than mutating
   *  or replacing it. The original `lockedRecord` argument is never written to. */
  function createRevisionFromLocked(lockedRecord, newPoints, meta) {
    if (!lockedRecord || !lockedRecord.locked) throw new Error('createRevisionFromLocked: lockedRecord must be an existing locked record');
    meta = meta || {};
    var next = lockBlindAnnotation(newPoints, lockedRecord.geometryType, {
      lockedAtIso: meta.lockedAtIso, bundleId: lockedRecord.bundleId, entryKey: lockedRecord.entryKey,
      target: lockedRecord.target, revision: lockedRecord.revision + 1
    });
    return Object.assign({}, next, { basedOnFingerprint: lockedRecord.fingerprint, basedOnRevision: lockedRecord.revision });
  }

  /** BI-2F1 -- categorical counterpart to lockBlindAnnotation. The categorical region-labeling
   *  path answers are NOT geometry (no x/y points), so this does not force them through
   *  lockBlindAnnotation's points/geometryType shape -- it reuses the exact same underlying
   *  primitives instead (computeFingerprint/canonicalStringify, Object.freeze, deterministic
   *  ordering, the same lockedAtIso/bundleId/entryKey/revision record fields) applied to an
   *  ordered array of per-region categorical answers. Same philosophy, honestly different shape. */
  function lockBlindCategoricalAnswers(answers, meta) {
    meta = meta || {};
    // Deterministic order: sort by region name so the fingerprint never depends on the original
    // insertion/iteration order of the caller's answers array.
    var sorted = (answers || []).slice().sort(function (a, b) {
      return a.region < b.region ? -1 : (a.region > b.region ? 1 : 0);
    });
    var answersCopy = sorted.map(function (a) {
      return {
        region: a.region,
        hairState: a.hairState,
        surfaceObservability: a.surfaceObservability == null ? null : a.surfaceObservability,
        annotationStatus: a.annotationStatus,
        annotationConfidence: a.annotationConfidence == null ? null : a.annotationConfidence,
        notes: a.notes ? String(a.notes) : ''
      };
    });
    var record = {
      locked: true,
      kind: 'CATEGORICAL_REGION_ANSWERS',
      answers: answersCopy,
      lockedAtIso: meta.lockedAtIso || new Date().toISOString(),
      bundleId: meta.bundleId != null ? meta.bundleId : null,
      entryKey: meta.entryKey != null ? meta.entryKey : null,
      revision: isFiniteNum(meta.revision) ? meta.revision : 1
    };
    record.fingerprint = computeFingerprint({ kind: record.kind, answers: record.answers, bundleId: record.bundleId, entryKey: record.entryKey });
    return Object.freeze(record);
  }
  /** BI-2F1 -- categorical counterpart to createRevisionFromLocked. The original lockedRecord
   *  argument is never written to; the new revision REFERENCES it via basedOnFingerprint/
   *  basedOnRevision rather than mutating or replacing it. */
  function createCategoricalRevisionFromLocked(lockedRecord, newAnswers, meta) {
    if (!lockedRecord || !lockedRecord.locked || lockedRecord.kind !== 'CATEGORICAL_REGION_ANSWERS') {
      throw new Error('createCategoricalRevisionFromLocked: lockedRecord must be an existing locked categorical record');
    }
    meta = meta || {};
    var next = lockBlindCategoricalAnswers(newAnswers, {
      lockedAtIso: meta.lockedAtIso, bundleId: lockedRecord.bundleId, entryKey: lockedRecord.entryKey,
      revision: lockedRecord.revision + 1
    });
    return Object.assign({}, next, { basedOnFingerprint: lockedRecord.fingerprint, basedOnRevision: lockedRecord.revision });
  }

  var API = {
    LOUPE_ZOOM_LEVELS: LOUPE_ZOOM_LEVELS,
    DEFAULT_LOUPE_ZOOM: DEFAULT_LOUPE_ZOOM,
    computeLoupeSampleRect: computeLoupeSampleRect,
    computeOverlayBoxFromRects: computeOverlayBoxFromRects,
    displayToRaw: displayToRaw,
    rawToDisplay: rawToDisplay,
    roundTripResidual: roundTripResidual,
    GEOMETRY_TYPE: GEOMETRY_TYPE,
    BLIND_GT_MODE_FIELD: BLIND_GT_MODE_FIELD, BLIND_GT_VALUE: BLIND_GT_VALUE, BLIND_GT_FORBIDDEN_UI: BLIND_GT_FORBIDDEN_UI,
    insertPointOrdered: insertPointOrdered,
    findSelfIntersections: findSelfIntersections,
    findDuplicatePoints: findDuplicatePoints,
    findOutOfBoundsPoints: findOutOfBoundsPoints,
    largeJumpWarning: largeJumpWarning,
    nearClosedOpenCurveWarning: nearClosedOpenCurveWarning,
    validateGeometry: validateGeometry,
    createHistory: createHistory, pushTransaction: pushTransaction, undo: undo, redo: redo,
    isBlindGtBundle: isBlindGtBundle, blindGtGeometryGuideForced: blindGtGeometryGuideForced,
    canonicalStringify: canonicalStringify, computeFingerprint: computeFingerprint,
    lockBlindAnnotation: lockBlindAnnotation, createRevisionFromLocked: createRevisionFromLocked,
    lockBlindCategoricalAnswers: lockBlindCategoricalAnswers, createCategoricalRevisionFromLocked: createCategoricalRevisionFromLocked
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.PrecisionCore = API;
})(typeof window !== 'undefined' ? window : globalThis);
