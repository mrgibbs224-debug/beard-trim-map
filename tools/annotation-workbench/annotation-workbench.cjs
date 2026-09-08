/*
 * Mettle local annotation workbench — PURE DATA CORE
 * Stage BS1-H. Development / dataset tool. NOT part of the Mettle consumer app.
 *
 * This file is authored as a classic script + CommonJS module so it can be:
 *   - loaded by index.html via <script src="./annotation-workbench.cjs"></script> (sets window.AWB)
 *   - imported by Node for `node --test` (module.exports)
 * with ZERO build step and ZERO dependencies.
 *
 * It contains only pure functions over plain data: bundle validation, a non-crypto bundle
 * fingerprint, default label state, progress accounting, display-transform derivation from
 * rotation/mirroring metadata, autosave payload (NEVER includes raw image pixels), fail-closed
 * autosave restore, and a BS1-F GroundTruthLabel-compatible export. No network, no pixel
 * decoding, no segmentation, no landmark drawing, no polygon tool.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AWB = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var WORKBENCH_VERSION = 'annotation-workbench/1';
  var ANNOTATION_BUNDLE_VERSION = 'annotation-bundle/1'; // mirrors accuracy/annotation-bundle.mjs

  // Canonical BS1-A / BS1-F vocabulary — reproduced here so the tool is standalone.
  var HAIR_STATES = Object.freeze(['BEARD_CONFIRMED', 'NON_BEARD_CONFIRMED', 'BOUNDARY', 'UNCERTAIN', 'UNKNOWN']);
  var ANNOTATION_STATUSES = Object.freeze(['LABELED', 'AMBIGUOUS', 'NEEDS_REVIEW', 'EXCLUDED', 'UNKNOWN']);
  var SCAN_POSES = Object.freeze(['front', 'right-45', 'right-profile', 'left-45', 'left-profile', 'chin-up']);
  var SYNC_STATES = Object.freeze(['EXACT_SYNCHRONIZED', 'NEAR_SYNCHRONIZED', 'UNPAIRED', 'UNKNOWN']);
  var MANUAL_GROUND_TRUTH = 'MANUAL_GROUND_TRUTH';

  // ---- OPTIONAL verified geometry overlay (Stage BS1-H2) --------------------
  // Mirrors accuracy/annotation-overlay-data.mjs. Every index below is a member of an
  // existing verified index.html constant — no landmark number is invented here. The overlay
  // is ANATOMICAL REFERENCE ONLY (no beard / non-beard / boundary / neckline meaning). An
  // AnnotationBundle v1 entry MAY carry an `overlayData` object of schema OVERLAY_DATA_VERSION;
  // if it does not, the geometry guide is simply unavailable for that entry.
  var OVERLAY_DATA_VERSION = 'annotation-overlay-data/1';
  var OVERLAY_COORDINATE_SPACE = 'IMAGE'; // raw keyframe pixels, BEFORE the display transform
  var OVERLAY_GROUPS = Object.freeze([
    Object.freeze({
      id: 'jaw-chin', label: 'Jaw / Chin',
      indices: Object.freeze([172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397]),
      source: 'index.html LOWER_FACE_DIAGNOSTIC_SETS.jawChinRail (:2788); LOWER_JAW (:1964)'
    }),
    Object.freeze({
      id: 'cheek', label: 'Cheek',
      indices: Object.freeze([234, 116, 123, 205, 186, 454, 345, 352, 425, 410]),
      source: 'index.html LOWER_FACE_DIAGNOSTIC_SETS.cheekRailA (:2789) + cheekRailB (:2790)'
    }),
    Object.freeze({
      id: 'mouth-ref', label: 'Mouth reference',
      indices: Object.freeze([61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]),
      source: 'index.html LOWER_FACE_DIAGNOSTIC_SETS.mouthReference (:2792) / ANATOMY_LANDMARKS.mouthRail (:2316)'
    })
  ]);
  var OVERLAY_GROUP_IDS = Object.freeze(OVERLAY_GROUPS.map(function (g) { return g.id; }));
  // named single anatomy points — ANATOMY_LANDMARKS (:2309) + PERSON_ANATOMY_SIDES (:2762)
  var OVERLAY_ANATOMY_POINTS = Object.freeze([8, 397, 172, 377, 148, 152, 454, 234, 17]);
  var VERIFIED_OVERLAY_INDICES = (function () {
    var set = {};
    OVERLAY_GROUPS.forEach(function (g) { g.indices.forEach(function (i) { set[i] = true; }); });
    OVERLAY_ANATOMY_POINTS.forEach(function (i) { set[i] = true; });
    return Object.freeze(Object.keys(set).map(Number).sort(function (a, b) { return a - b; }));
  })();
  var VERIFIED_OVERLAY_INDEX_SET = (function () {
    var m = {}; VERIFIED_OVERLAY_INDICES.forEach(function (i) { m[i] = true; }); return m;
  })();
  function isVerifiedOverlayIndex(i) {
    return typeof i === 'number' && isFinite(i) && Math.floor(i) === i && VERIFIED_OVERLAY_INDEX_SET[i] === true;
  }
  // BS1-H2.1 — per-group index membership: a verified index is only accepted under the rail
  // it actually belongs to (index 152 is jaw-chin, never mouth-ref). A null group is an
  // ungrouped named anatomy anchor and is accepted when the index is verified.
  var OVERLAY_GROUP_INDEX_SET = (function () {
    var m = {};
    OVERLAY_GROUPS.forEach(function (g) { var s = {}; g.indices.forEach(function (i) { s[i] = true; }); m[g.id] = s; });
    return m;
  })();
  function overlayPointGroupValid(index, group) {
    if (!isVerifiedOverlayIndex(index)) return false;
    if (group == null) return true;
    var s = OVERLAY_GROUP_INDEX_SET[String(group)];
    return !!(s && s[index] === true);
  }
  function normRotDeg(v) { return (typeof v === 'number' && isFinite(v)) ? (((v % 360) + 360) % 360) : null; }

  // Human-friendly display labels (canonical value is always what is stored/exported).
  var HAIR_STATE_DISPLAY = Object.freeze({
    BEARD_CONFIRMED: 'Beard', NON_BEARD_CONFIRMED: 'Skin / no beard',
    BOUNDARY: 'Boundary (edge)', UNCERTAIN: 'Uncertain', UNKNOWN: 'Not looked at'
  });

  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }
  function clampConfidence(v) {
    if (v === '' || v === null || typeof v === 'undefined') return null;
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFiniteNum(n)) return null;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  // ---- bundle validation (fail closed, never repair) -------------------------
  function validateBundle(obj) {
    var errors = [];
    if (!obj || typeof obj !== 'object') return { ok: false, errors: ['not a JSON object'], bundle: null };
    if (obj.schemaVersion !== ANNOTATION_BUNDLE_VERSION) {
      errors.push('unsupported schemaVersion "' + obj.schemaVersion + '" (expected "' + ANNOTATION_BUNDLE_VERSION + '")');
      return { ok: false, errors: errors, bundle: null };
    }
    if (!Array.isArray(obj.entries)) errors.push('entries is not an array');
    (obj.entries || []).forEach(function (e, i) {
      if (!e || typeof e !== 'object') { errors.push('entry ' + i + ' is not an object'); return; }
      if (e.sourceScanObservationId == null) errors.push('entry ' + i + ' missing sourceScanObservationId');
      if (e.imageRef == null) errors.push('entry ' + i + ' missing imageRef');
      if (e.poseId != null && SCAN_POSES.indexOf(e.poseId) === -1) errors.push('entry ' + i + ' invalid poseId "' + e.poseId + '"');
      if (e.syncStatus != null && SYNC_STATES.indexOf(e.syncStatus) === -1) errors.push('entry ' + i + ' invalid syncStatus "' + e.syncStatus + '"');
      if (!Array.isArray(e.regionsToAnnotate)) errors.push('entry ' + i + ' regionsToAnnotate is not an array');
    });
    return { ok: errors.length === 0, errors: errors, bundle: errors.length === 0 ? obj : null };
  }

  // ---- deterministic non-crypto bundle fingerprint (identity only) ----------
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  function bundleFingerprint(bundle) {
    if (!bundle) return null;
    var idParts = [
      bundle.schemaVersion, bundle.bundleId, bundle.datasetId, bundle.datasetRevision
    ];
    var entryParts = (bundle.entries || []).map(function (e) {
      return [e.sourceScanObservationId, e.nativeFrameTimestampNs, e.imageRef, e.poseId, e.syncStatus].join('');
    }).sort();
    // fingerprint NEVER includes rawImagePayload
    return fnv1a(idParts.join('') + '' + entryParts.join(''));
  }

  // ---- annotation state ----------------------------------------------------
  function defaultRegionLabel() {
    return { hairState: 'UNKNOWN', annotationStatus: 'UNKNOWN', annotationConfidence: null, notes: '' };
  }
  function initAnnotationState(bundle) {
    var byEntry = {};
    (bundle.entries || []).forEach(function (e) {
      var m = {};
      (e.regionsToAnnotate || []).forEach(function (r) { m[r] = defaultRegionLabel(); });
      byEntry[e.sourceScanObservationId] = m;
    });
    return { workbenchVersion: WORKBENCH_VERSION, fingerprint: bundleFingerprint(bundle), byEntry: byEntry, position: 0, geometryGuide: false };
  }
  // Geometry-guide UI state only. Never touches any annotation label / default.
  function setGeometryGuide(state, on) {
    var next = JSON.parse(JSON.stringify(state));
    next.geometryGuide = !!on;
    return next;
  }
  function setRegionLabel(state, obsId, region, patch) {
    var next = JSON.parse(JSON.stringify(state));
    var m = next.byEntry[obsId] || (next.byEntry[obsId] = {});
    var cur = m[region] || defaultRegionLabel();
    if (patch.hairState != null) {
      if (HAIR_STATES.indexOf(patch.hairState) === -1) throw new Error('setRegionLabel: invalid hairState "' + patch.hairState + '"');
      cur.hairState = patch.hairState;
    }
    if (patch.annotationStatus != null) {
      if (ANNOTATION_STATUSES.indexOf(patch.annotationStatus) === -1) throw new Error('setRegionLabel: invalid annotationStatus "' + patch.annotationStatus + '"');
      cur.annotationStatus = patch.annotationStatus;
    }
    if ('annotationConfidence' in patch) cur.annotationConfidence = clampConfidence(patch.annotationConfidence);
    if ('notes' in patch) cur.notes = patch.notes == null ? '' : String(patch.notes);
    m[region] = cur;
    return next;
  }
  function navigate(state, delta, total) {
    var next = JSON.parse(JSON.stringify(state));
    var p = next.position + delta;
    next.position = p < 0 ? 0 : (p > total - 1 ? total - 1 : p);
    return next;
  }

  // ---- progress ("completed" = every requested region has a non-UNKNOWN status)
  function entryLabels(state, obsId) { return (state.byEntry && state.byEntry[obsId]) || {}; }
  function isEntryComplete(labels, regionsToAnnotate) {
    if (!regionsToAnnotate || !regionsToAnnotate.length) return false;
    return regionsToAnnotate.every(function (r) {
      var l = labels[r];
      return l && l.annotationStatus && l.annotationStatus !== 'UNKNOWN';
    });
  }
  function progressCounts(bundle, state) {
    var entries = bundle.entries || [];
    var regionsRequested = 0, regionsLabeled = 0, imagesCompleted = 0, imagesNeedingReview = 0;
    var ambiguousLabels = 0, excludedLabels = 0;
    entries.forEach(function (e) {
      var labels = entryLabels(state, e.sourceScanObservationId);
      var reqs = e.regionsToAnnotate || [];
      regionsRequested += reqs.length;
      var anyReview = false;
      reqs.forEach(function (r) {
        var l = labels[r] || defaultRegionLabel();
        if (l.annotationStatus && l.annotationStatus !== 'UNKNOWN') regionsLabeled++;
        if (l.annotationStatus === 'NEEDS_REVIEW') anyReview = true;
        if (l.annotationStatus === 'AMBIGUOUS') ambiguousLabels++;
        if (l.annotationStatus === 'EXCLUDED') excludedLabels++;
      });
      if (isEntryComplete(labels, reqs)) imagesCompleted++;
      if (anyReview) imagesNeedingReview++;
    });
    return {
      imageIndex: Math.min(state.position, Math.max(0, entries.length - 1)),
      imageTotal: entries.length,
      regionsLabeled: regionsLabeled,
      regionsRequested: regionsRequested,
      imagesCompleted: imagesCompleted,
      imagesNeedingReview: imagesNeedingReview,
      ambiguousLabels: ambiguousLabels,
      excludedLabels: excludedLabels
    };
  }

  // ---- display transform (NO image edit — CSS/display only) ----------------
  function displayTransform(entry) {
    var rot = isFiniteNum(entry && entry.rotationDegrees) ? ((entry.rotationDegrees % 360) + 360) % 360 : 0;
    var mir = !!(entry && entry.mirrored);
    var css = (mir ? 'scaleX(-1) ' : '') + 'rotate(' + rot + 'deg)';
    return { rotateDeg: rot, mirrored: mir, css: css.trim() };
  }
  function imageRenderable(entry) {
    return !!(entry && typeof entry.rawImagePayload === 'string' && entry.rawImagePayload.length > 0);
  }

  // ---- optional geometry overlay (display model only — no fabrication) -----
  // STRICT (BS1-H2.1). The overlay is derived from exactly ONE keyframe, so it renders ONLY
  // when: the image is renderable; the entry carries a well-formed IMAGE-space
  // annotation-overlay-data/1 object; ALL THREE exact-keyframe identity fields
  // (sourceScanObservationId, imageRef, nativeFrameTimestampNs) are present on BOTH sides and
  // EXACTLY equal (no tolerance / nearest / fuzzy / array-position); any display metadata
  // supplied by BOTH sides agrees; and every point is a verified index that belongs to its
  // declared group. A v1 bundle without overlayData -> unavailable. This is the direct-JSON-
  // load gate (JSON -> validateBundle -> overlayAvailable), NOT only the attachOverlayData path.
  function overlayUnavailableReason(entry) {
    if (!imageRenderable(entry)) return 'image not renderable';
    var od = entry && entry.overlayData;
    if (!od || typeof od !== 'object') return 'no overlayData';
    if (od.schemaVersion !== OVERLAY_DATA_VERSION) return 'schemaVersion';
    if (od.space !== OVERLAY_COORDINATE_SPACE) return 'space not IMAGE'; // never treat CAPTURE_NORMALIZED as pixels
    if (!Array.isArray(od.points) || od.points.length === 0) return 'no points';
    var idFields = ['sourceScanObservationId', 'imageRef', 'nativeFrameTimestampNs'];
    for (var k = 0; k < idFields.length; k++) {
      var f = idFields[k], a = entry[f], b = od[f];
      if (a == null || b == null) return 'identity ' + f + ' missing';
      if (a !== b) return 'identity ' + f + ' mismatch';
    }
    if (isFiniteNum(entry.imageWidth) && isFiniteNum(od.imageWidth) && entry.imageWidth !== od.imageWidth) return 'imageWidth contradiction';
    if (isFiniteNum(entry.imageHeight) && isFiniteNum(od.imageHeight) && entry.imageHeight !== od.imageHeight) return 'imageHeight contradiction';
    var ra = normRotDeg(entry.rotationDegrees), rb = normRotDeg(od.rotationDegrees);
    if (ra != null && rb != null && ra !== rb) return 'rotationDegrees contradiction';
    if (typeof entry.mirrored === 'boolean' && typeof od.mirrored === 'boolean' && entry.mirrored !== od.mirrored) return 'mirrored contradiction';
    for (var j = 0; j < od.points.length; j++) {
      var p = od.points[j];
      // BS1-H2.1.1 — prove p is a plain non-null object BEFORE reading any field; a malformed
      // element (null, primitive, array) makes the whole overlay unavailable, never throws.
      if (p == null || typeof p !== 'object' || Array.isArray(p)) return 'point object';
      if (!isFiniteNum(p.x) || !isFiniteNum(p.y)) return 'point coordinate';
      if (!overlayPointGroupValid(p.index, p.group)) return 'point ' + p.index + ' not valid for group ' + (p.group == null ? '(none)' : p.group);
    }
    return null;
  }
  function overlayAvailable(entry) { return overlayUnavailableReason(entry) == null; }
  // A drawable model in RAW image-pixel space. The caller renders it inside the SAME
  // transformed wrapper as the <img>, so `transformCss` is byte-identical to displayTransform().
  function overlayDisplayModel(entry, options) {
    options = options || {};
    if (!overlayAvailable(entry)) return null;
    var od = entry.overlayData;
    var w = isFiniteNum(od.imageWidth) ? od.imageWidth : (isFiniteNum(entry.imageWidth) ? entry.imageWidth : null);
    var h = isFiniteNum(od.imageHeight) ? od.imageHeight : (isFiniteNum(entry.imageHeight) ? entry.imageHeight : null);
    var want = Array.isArray(options.groupIds) ? options.groupIds.filter(function (g) { return OVERLAY_GROUP_IDS.indexOf(g) !== -1; }) : OVERLAY_GROUP_IDS.slice();
    var pts = od.points.filter(function (p) {
      return isVerifiedOverlayIndex(p.index) && (p.group == null || want.indexOf(p.group) !== -1);
    }).map(function (p) { return { index: p.index, x: p.x, y: p.y, group: p.group == null ? null : p.group }; });
    var groups = OVERLAY_GROUPS.filter(function (g) { return want.indexOf(g.id) !== -1; }).map(function (g) {
      var gp = od.points.filter(function (p) { return p.group === g.id; }).map(function (p) { return { x: p.x, y: p.y, index: p.index }; });
      return { id: g.id, label: g.label, points: gp, polyline: gp.map(function (p) { return p.x + ',' + p.y; }).join(' ') };
    });
    var dt = displayTransform(entry);
    return {
      transformCss: dt.css,                 // identical to the image's display transform
      rotateDeg: dt.rotateDeg, mirrored: dt.mirrored,
      viewBox: { x: 0, y: 0, w: w, h: h },
      points: pts,
      groups: groups,
      groupsPresent: Array.isArray(od.groupsPresent) ? od.groupsPresent.slice() : [],
      caption: 'tracked anatomy reference — NOT beard detection'
    };
  }
  // Diagnostic only: are all overlay points inside the raw image frame? null if no bounds.
  function overlayPointsInImageBounds(entry) {
    if (!overlayAvailable(entry)) return null;
    var od = entry.overlayData;
    var w = isFiniteNum(od.imageWidth) ? od.imageWidth : entry.imageWidth;
    var h = isFiniteNum(od.imageHeight) ? od.imageHeight : entry.imageHeight;
    if (!isFiniteNum(w) || !isFiniteNum(h)) return null;
    return od.points.every(function (p) { return p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h; });
  }

  // ---- autosave (labels/progress only — NEVER raw pixels) -----------------
  function buildAutosavePayload(bundle, state) {
    return {
      workbenchVersion: WORKBENCH_VERSION,
      savedAt: null, // caller may stamp a time; kept null-safe for deterministic tests
      bundleFingerprint: bundleFingerprint(bundle),
      bundleIdentity: {
        schemaVersion: bundle.schemaVersion,
        bundleId: bundle.bundleId || null,
        datasetId: bundle.datasetId || null,
        datasetRevision: bundle.datasetRevision == null ? null : bundle.datasetRevision,
        entryIds: (bundle.entries || []).map(function (e) { return e.sourceScanObservationId; })
      },
      labels: JSON.parse(JSON.stringify(state.byEntry)),
      position: state.position,
      geometryGuide: !!state.geometryGuide  // UI toggle state only — NO coordinates, NO pixels
      // rawImagePayload is intentionally absent
    };
  }
  function restoreFromAutosave(autosave, bundle) {
    if (!autosave || typeof autosave !== 'object') return { ok: false, reason: 'NO_AUTOSAVE', state: null, dropped: [] };
    var fp = bundleFingerprint(bundle);
    if (autosave.bundleFingerprint !== fp) {
      return { ok: false, reason: 'FINGERPRINT_MISMATCH', state: null, dropped: [] };
    }
    var fresh = initAnnotationState(bundle);
    var dropped = [];
    var saved = autosave.labels || {};
    Object.keys(saved).forEach(function (obsId) {
      if (!fresh.byEntry[obsId]) { dropped.push(obsId); return; }
      Object.keys(saved[obsId]).forEach(function (region) {
        if (!fresh.byEntry[obsId][region]) { dropped.push(obsId + '/' + region); return; }
        var l = saved[obsId][region] || {};
        var patch = {};
        if (HAIR_STATES.indexOf(l.hairState) !== -1) patch.hairState = l.hairState;
        if (ANNOTATION_STATUSES.indexOf(l.annotationStatus) !== -1) patch.annotationStatus = l.annotationStatus;
        patch.annotationConfidence = clampConfidence(l.annotationConfidence);
        patch.notes = l.notes == null ? '' : String(l.notes);
        fresh = setRegionLabel(fresh, obsId, region, patch);
      });
    });
    fresh.position = isFiniteNum(autosave.position) ? Math.max(0, Math.min(autosave.position, (bundle.entries || []).length - 1)) : 0;
    fresh.geometryGuide = !!autosave.geometryGuide;
    return { ok: true, reason: null, state: fresh, dropped: dropped };
  }

  // ---- export (BS1-F GroundTruthLabel-compatible; NO raw image) -----------
  function buildExport(bundle, state, options) {
    options = options || {};
    var labels = [];
    var summary = { definitive: 0, ambiguous: 0, needsReview: 0, excluded: 0, unknown: 0 };
    (bundle.entries || []).forEach(function (e) {
      var m = entryLabels(state, e.sourceScanObservationId);
      (e.regionsToAnnotate || []).forEach(function (region) {
        var l = m[region] || defaultRegionLabel();
        if (l.annotationStatus === 'LABELED') summary.definitive++;
        else if (l.annotationStatus === 'AMBIGUOUS') summary.ambiguous++;
        else if (l.annotationStatus === 'NEEDS_REVIEW') summary.needsReview++;
        else if (l.annotationStatus === 'EXCLUDED') summary.excluded++;
        else summary.unknown++;
        labels.push({
          labelId: e.sourceScanObservationId + ':' + region,
          scanSessionId: e.scanSessionId || null,
          sourceScanObservationId: e.sourceScanObservationId,
          imageRef: e.imageRef,
          nativeFrameTimestampNs: isFiniteNum(e.nativeFrameTimestampNs) ? e.nativeFrameTimestampNs : null,
          poseId: e.poseId || null,
          observedPoseRegion: e.observedPoseRegion || null,
          anatomicalRegion: region,
          hairState: l.hairState || 'UNKNOWN',
          annotationStatus: l.annotationStatus || 'UNKNOWN',
          annotationConfidence: clampConfidence(l.annotationConfidence),
          syncStatus: e.syncStatus || null,
          sourceMethod: MANUAL_GROUND_TRUTH,
          revision: isFiniteNum(options.revision) ? options.revision : null,
          notes: l.notes ? String(l.notes) : null
          // NO rawImagePayload / base64 / dataUrl
        });
      });
    });
    return {
      workbenchVersion: WORKBENCH_VERSION,
      exportedAt: options.exportedAt || null,
      bundleFingerprint: bundleFingerprint(bundle),
      bundleId: bundle.bundleId || null,
      datasetId: bundle.datasetId || null,
      datasetRevision: bundle.datasetRevision == null ? null : bundle.datasetRevision,
      sourceMethod: MANUAL_GROUND_TRUTH,
      summary: summary,
      labels: labels
    };
  }
  function validateExport(exportObj, bundle) {
    var errors = [];
    if (!exportObj || !Array.isArray(exportObj.labels)) return { ok: false, errors: ['export has no labels array'] };
    if (exportObj.bundleFingerprint !== bundleFingerprint(bundle)) errors.push('bundleFingerprint mismatch');
    var byId = {};
    (bundle.entries || []).forEach(function (e) { byId[e.sourceScanObservationId] = e; });
    exportObj.labels.forEach(function (l, i) {
      var e = byId[l.sourceScanObservationId];
      if (!e) { errors.push('label ' + i + ' references unknown observation ' + l.sourceScanObservationId); return; }
      if (l.imageRef !== e.imageRef) errors.push('label ' + i + ' imageRef mismatch');
      if ((l.poseId || null) !== (e.poseId || null)) errors.push('label ' + i + ' poseId mismatch');
      if ((l.nativeFrameTimestampNs == null ? null : l.nativeFrameTimestampNs) !== (isFiniteNum(e.nativeFrameTimestampNs) ? e.nativeFrameTimestampNs : null)) errors.push('label ' + i + ' timestamp mismatch');
      if (l.sourceMethod !== MANUAL_GROUND_TRUTH) errors.push('label ' + i + ' sourceMethod is not MANUAL_GROUND_TRUTH');
      if (HAIR_STATES.indexOf(l.hairState) === -1) errors.push('label ' + i + ' invalid hairState');
      if (ANNOTATION_STATUSES.indexOf(l.annotationStatus) === -1) errors.push('label ' + i + ' invalid annotationStatus');
      if (/base64|data:image|rawImage/i.test(JSON.stringify(l))) errors.push('label ' + i + ' contains image payload');
    });
    return { ok: errors.length === 0, errors: errors };
  }
  /** Trivial unwrap: the array BS1-F assembleGroundTruthDataset() consumes. */
  function groundTruthLabelsForBS1F(exportObj) {
    return (exportObj && Array.isArray(exportObj.labels)) ? exportObj.labels.slice() : [];
  }

  return {
    WORKBENCH_VERSION: WORKBENCH_VERSION,
    ANNOTATION_BUNDLE_VERSION: ANNOTATION_BUNDLE_VERSION,
    HAIR_STATES: HAIR_STATES,
    ANNOTATION_STATUSES: ANNOTATION_STATUSES,
    SCAN_POSES: SCAN_POSES,
    SYNC_STATES: SYNC_STATES,
    HAIR_STATE_DISPLAY: HAIR_STATE_DISPLAY,
    MANUAL_GROUND_TRUTH: MANUAL_GROUND_TRUTH,
    clampConfidence: clampConfidence,
    validateBundle: validateBundle,
    bundleFingerprint: bundleFingerprint,
    defaultRegionLabel: defaultRegionLabel,
    initAnnotationState: initAnnotationState,
    setRegionLabel: setRegionLabel,
    setGeometryGuide: setGeometryGuide,
    navigate: navigate,
    entryLabels: entryLabels,
    isEntryComplete: isEntryComplete,
    progressCounts: progressCounts,
    displayTransform: displayTransform,
    imageRenderable: imageRenderable,
    overlayAvailable: overlayAvailable,
    overlayUnavailableReason: overlayUnavailableReason,
    overlayDisplayModel: overlayDisplayModel,
    overlayPointsInImageBounds: overlayPointsInImageBounds,
    isVerifiedOverlayIndex: isVerifiedOverlayIndex,
    overlayPointGroupValid: overlayPointGroupValid,
    OVERLAY_DATA_VERSION: OVERLAY_DATA_VERSION,
    OVERLAY_COORDINATE_SPACE: OVERLAY_COORDINATE_SPACE,
    OVERLAY_GROUPS: OVERLAY_GROUPS,
    OVERLAY_GROUP_IDS: OVERLAY_GROUP_IDS,
    VERIFIED_OVERLAY_INDICES: VERIFIED_OVERLAY_INDICES,
    buildAutosavePayload: buildAutosavePayload,
    restoreFromAutosave: restoreFromAutosave,
    buildExport: buildExport,
    validateExport: validateExport,
    groundTruthLabelsForBS1F: groundTruthLabelsForBS1F
  };
});
