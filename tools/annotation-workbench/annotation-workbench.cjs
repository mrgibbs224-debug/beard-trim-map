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

  var WORKBENCH_VERSION = 'annotation-workbench/2'; // BI-1W: dual-channel labels + raw-observation
  // identity (both additive; ANNOTATION_BUNDLE_VERSION is intentionally unchanged below so every
  // historical bundle/export continues to validate exactly as before).
  var ANNOTATION_BUNDLE_VERSION = 'annotation-bundle/1'; // mirrors accuracy/annotation-bundle.mjs

  // Canonical BS1-A / BS1-F vocabulary — reproduced here so the tool is standalone.
  var HAIR_STATES = Object.freeze(['BEARD_CONFIRMED', 'NON_BEARD_CONFIRMED', 'BOUNDARY', 'UNCERTAIN', 'UNKNOWN']);
  // BI-1W Part 2 — independent Surface Observability channel. Never auto-derived from hairState
  // (Part 3): sparse beard can still show visible skin underneath, and thick beard can hide skin
  // even where hair is confidently confirmed. The annotator sets both channels independently.
  var SURFACE_OBSERVABILITY_STATES = Object.freeze(['VISIBLE_SKIN', 'BEARD_OCCLUDED_SKIN', 'OTHER_OCCLUDED', 'NOT_VISIBLE', 'UNKNOWN']);
  // BI-1W Part 9 — which identity path a bundle entry follows. Absent on an entry means the
  // historical default, ADAPTER_RETAINED_OBSERVATION (see identityModeOf below).
  var IDENTITY_MODES = Object.freeze(['ADAPTER_RETAINED_OBSERVATION', 'RAW_SCAN_OBSERVATION']);
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

  // ---- BI-1E region -> visual reference tier -------------------------------
  // Mirrors accuracy/beard-anatomy-map.mjs's MAPPING_EVIDENCE confidence table (reproduced
  // here so the tool stays standalone, same pattern as OVERLAY_GROUPS above). Every note string
  // is copied verbatim from that table rather than re-derived, so the workbench can never say
  // something the anatomy map itself does not already say.
  //   VERIFIED    -> a real overlay group IS this region (or an evidence-backed narrower slice
  //                  of it); highlight that group's rail/points as the reference.
  //   PROXY       -> a real overlay group exists nearby but is a DIFFERENT anatomical feature
  //                  used only as an approximate anchor; highlight it, but visually distinct
  //                  and with its caveat shown, never presented as the region itself.
  //   UNSUPPORTED -> no verified landmark evidence exists anywhere in the codebase for this
  //                  region. No ROI is invented. Categorical labeling is blocked (see
  //                  regionAllowedHairStates) and only UNKNOWN remains available.
  var REGION_TIERS = Object.freeze(['VERIFIED', 'PROXY', 'UNSUPPORTED']);
  var REGION_VISUAL_REFERENCE = Object.freeze({
    CHIN_CENTER: Object.freeze({ tier: 'VERIFIED', overlayGroupId: 'jaw-chin', note: null }),
    CHIN_LEFT: Object.freeze({ tier: 'VERIFIED', overlayGroupId: 'jaw-chin', note: null }),
    CHIN_RIGHT: Object.freeze({ tier: 'VERIFIED', overlayGroupId: 'jaw-chin', note: null }),
    LEFT_JAW: Object.freeze({ tier: 'VERIFIED', overlayGroupId: 'jaw-chin', note: null }),
    RIGHT_JAW: Object.freeze({ tier: 'VERIFIED', overlayGroupId: 'jaw-chin', note: null }),
    LEFT_LOWER_CHEEK: Object.freeze({ tier: 'VERIFIED', overlayGroupId: 'cheek', note: 'mid/low cheek rail — source does not separate upper vs lower cheek' }),
    RIGHT_LOWER_CHEEK: Object.freeze({ tier: 'VERIFIED', overlayGroupId: 'cheek', note: 'mid/low cheek rail — source does not separate upper vs lower cheek' }),
    MOUSTACHE_CENTER: Object.freeze({ tier: 'PROXY', overlayGroupId: 'mouth-ref', note: 'this is the LOWER-lip reference contour, not the upper-lip moustache surface itself — an approximate nearby anchor only' }),

    LEFT_SIDEBURN: Object.freeze({ tier: 'UNSUPPORTED', overlayGroupId: null, note: 'no source set labels a sideburn region; profile/templateAxis indices near the ear are not sideburn-specific' }),
    RIGHT_SIDEBURN: Object.freeze({ tier: 'UNSUPPORTED', overlayGroupId: null, note: 'no source set labels a sideburn region' }),
    LEFT_UPPER_CHEEK: Object.freeze({ tier: 'UNSUPPORTED', overlayGroupId: null, note: 'cheek rails in source are mid/low cheek only; no upper-cheek set exists' }),
    RIGHT_UPPER_CHEEK: Object.freeze({ tier: 'UNSUPPORTED', overlayGroupId: null, note: 'cheek rails in source are mid/low cheek only; no upper-cheek set exists' }),
    MOUSTACHE_LEFT: Object.freeze({ tier: 'UNSUPPORTED', overlayGroupId: null, note: 'no upper-lip / philtrum landmark set exists in source' }),
    MOUSTACHE_RIGHT: Object.freeze({ tier: 'UNSUPPORTED', overlayGroupId: null, note: 'no upper-lip / philtrum landmark set exists in source' }),
    SOUL_PATCH: Object.freeze({ tier: 'UNSUPPORTED', overlayGroupId: null, note: 'no between-lip-and-chin landmark set exists in source' }),
    UNDER_CHIN: Object.freeze({ tier: 'UNSUPPORTED', overlayGroupId: null, note: 'only a synthesised 2D display heuristic (throatDrop) exists, not a tracked landmark' }),
    UNDER_JAW_LEFT: Object.freeze({ tier: 'UNSUPPORTED', overlayGroupId: null, note: 'no tracked under-jaw landmark; would fabricate 3D from a front-face point' }),
    UNDER_JAW_CENTER: Object.freeze({ tier: 'UNSUPPORTED', overlayGroupId: null, note: 'no tracked under-jaw landmark; throat point is a projection heuristic' }),
    UNDER_JAW_RIGHT: Object.freeze({ tier: 'UNSUPPORTED', overlayGroupId: null, note: 'no tracked under-jaw landmark; would fabricate 3D from a front-face point' }),
    // BI-1W CORRECTION: LEFT_UNDER_JAW / RIGHT_UNDER_JAW were briefly introduced as separate keys
    // here, duplicating the canonical UNDER_JAW_LEFT / UNDER_JAW_RIGHT already defined above and
    // authoritative project-wide (accuracy/beard-surface-core.mjs's AnatomicalRegion enum,
    // accuracy/beard-anatomy-map.mjs's MAPPING_EVIDENCE — neither ever defined LEFT_UNDER_JAW /
    // RIGHT_UNDER_JAW). Removed before any GT was collected against them. Do not reintroduce
    // without concrete historical evidence they denote a genuinely different territory.
    NECK_FRONT: Object.freeze({ tier: 'UNSUPPORTED', overlayGroupId: null, note: 'derived neck drawing is a 2D display heuristic; no tracked neck landmarks, no 3D' }),
    NECK_LEFT: Object.freeze({ tier: 'UNSUPPORTED', overlayGroupId: null, note: 'no tracked neck landmarks in source' }),
    NECK_RIGHT: Object.freeze({ tier: 'UNSUPPORTED', overlayGroupId: null, note: 'no tracked neck landmarks in source' }),
    CHIN_NECK_TRANSITION: Object.freeze({ tier: 'UNSUPPORTED', overlayGroupId: null, note: 'derived throat/neck geometry is a 2D projection heuristic, not tracked 3D' })
  });
  var UNKNOWN_ONLY = Object.freeze(['UNKNOWN']);
  /** Visual-reference tier for a requested AnatomicalRegion. Unknown region names fail closed. */
  function regionVisualReference(region) {
    return REGION_VISUAL_REFERENCE[region] || Object.freeze({ tier: 'UNSUPPORTED', overlayGroupId: null, note: 'region not recognized' });
  }

  // ---- BI-1E PRE-ANNOTATION CORRECTION — semantic labelability -------------
  // "No verified 3D/geometric reference" (REGION_VISUAL_REFERENCE above) is a DIFFERENT question
  // from "can a human classify this region from the raw photo" (this table). A region can have
  // zero geometric reference and still be confidently, categorically labelable — sideburn,
  // moustache-left/right and soul-patch are all highly salient visual features a human can judge
  // without any landmark rail. Conversely under-jaw/neck regions lack BOTH a geometric reference
  // AND a reliable, self-occlusion-free visual definition, so they stay UNKNOWN-only.
  //   LABELABLE_FROM_IMAGE  -> confidently classifiable from the raw photo alone.
  //   LABELABLE_WITH_CAUTION-> classifiable, but the boundary/split is inherently approximate
  //                            (no geometry to anchor it) and the UI must say so prominently.
  //   UNKNOWN_ONLY          -> not reliably identifiable without a trustworthy spatial
  //                            definition, for this experiment; only UNKNOWN may be recorded.
  // `semanticDescription` is shown INSTEAD of a fake ROI for a labelable-but-geometrically-
  // unsupported region: human-readable guidance about WHERE to look, never a coordinate claim.
  var LABELABILITY_TIERS = Object.freeze(['LABELABLE_FROM_IMAGE', 'LABELABLE_WITH_CAUTION', 'UNKNOWN_ONLY']);
  var LABELABLE_HAIR_STATES = Object.freeze(['BEARD_CONFIRMED', 'NON_BEARD_CONFIRMED', 'UNKNOWN']);
  var REGION_LABELABILITY = Object.freeze({
    CHIN_CENTER: Object.freeze({ tier: 'LABELABLE_FROM_IMAGE', semanticDescription: null }),
    CHIN_LEFT: Object.freeze({ tier: 'LABELABLE_FROM_IMAGE', semanticDescription: null }),
    CHIN_RIGHT: Object.freeze({ tier: 'LABELABLE_FROM_IMAGE', semanticDescription: null }),
    LEFT_JAW: Object.freeze({ tier: 'LABELABLE_FROM_IMAGE', semanticDescription: null }),
    RIGHT_JAW: Object.freeze({ tier: 'LABELABLE_FROM_IMAGE', semanticDescription: null }),
    LEFT_LOWER_CHEEK: Object.freeze({ tier: 'LABELABLE_FROM_IMAGE', semanticDescription: null }),
    RIGHT_LOWER_CHEEK: Object.freeze({ tier: 'LABELABLE_FROM_IMAGE', semanticDescription: null }),
    MOUSTACHE_CENTER: Object.freeze({ tier: 'LABELABLE_WITH_CAUTION', semanticDescription: null }),

    LEFT_SIDEBURN: Object.freeze({ tier: 'LABELABLE_FROM_IMAGE', semanticDescription: 'beard/hair region immediately in front of the visible left ear, connecting temple hair toward the beard' }),
    RIGHT_SIDEBURN: Object.freeze({ tier: 'LABELABLE_FROM_IMAGE', semanticDescription: 'beard/hair region immediately in front of the visible right ear, connecting temple hair toward the beard' }),
    SOUL_PATCH: Object.freeze({ tier: 'LABELABLE_FROM_IMAGE', semanticDescription: 'small hair region centered below the lower lip and above the main chin beard — keep distinct from the surrounding beard, never merge into it' }),
    MOUSTACHE_LEFT: Object.freeze({ tier: 'LABELABLE_WITH_CAUTION', semanticDescription: 'left half of visible moustache hair above the upper lip, as seen by the viewer — no midline reference is drawn' }),
    MOUSTACHE_RIGHT: Object.freeze({ tier: 'LABELABLE_WITH_CAUTION', semanticDescription: 'right half of visible moustache hair above the upper lip, as seen by the viewer — no midline reference is drawn' }),
    LEFT_UPPER_CHEEK: Object.freeze({ tier: 'LABELABLE_WITH_CAUTION', semanticDescription: 'beard/hair coverage on the upper cheek, between the cheekbone and the main lower-cheek beard line — this boundary is not sharply defined' }),
    RIGHT_UPPER_CHEEK: Object.freeze({ tier: 'LABELABLE_WITH_CAUTION', semanticDescription: 'beard/hair coverage on the upper cheek, between the cheekbone and the main lower-cheek beard line — this boundary is not sharply defined' }),

    // BI-1W Part 5/6/7 — promoted from UNKNOWN_ONLY: BI-1V's direct visual inspection of real
    // Chin-Up-family imagery confirmed these three are genuinely, if cautiously, labelable from
    // the photo (no geometry anchor exists, hence LABELABLE_WITH_CAUTION not LABELABLE_FROM_IMAGE,
    // the same pattern already used for MOUSTACHE_LEFT/RIGHT and *_UPPER_CHEEK above). Descriptions
    // are plain-language per Part 6 -- no medical landmark terms shown to the annotator.
    // CORRECTION: promoted using the pre-existing CANONICAL keys (UNDER_JAW_LEFT/RIGHT, already
    // the authoritative AnatomicalRegion in accuracy/beard-surface-core.mjs and
    // accuracy/beard-anatomy-map.mjs) instead of the short-lived duplicate LEFT_UNDER_JAW /
    // RIGHT_UNDER_JAW names, which have been removed — see the removal note in
    // REGION_VISUAL_REFERENCE above.
    UNDER_CHIN: Object.freeze({ tier: 'LABELABLE_WITH_CAUTION', semanticDescription: 'The central underside directly behind/below the chin, visible when your head is tilted upward. Do not label the front of the chin.' }),
    UNDER_JAW_LEFT: Object.freeze({ tier: 'LABELABLE_WITH_CAUTION', semanticDescription: 'The underside beneath the left half of your jaw, between the side jaw and the central under-chin area.' }),
    UNDER_JAW_RIGHT: Object.freeze({ tier: 'LABELABLE_WITH_CAUTION', semanticDescription: 'The underside beneath the right half of your jaw, between the side jaw and the central under-chin area.' }),
    // UNDER_JAW_CENTER is a third, distinct pre-existing canonical key (center, not left/right) —
    // not requested for promotion this round, left exactly as before, UNKNOWN_ONLY.
    UNDER_JAW_CENTER: Object.freeze({ tier: 'UNKNOWN_ONLY', semanticDescription: null }),
    NECK_FRONT: Object.freeze({ tier: 'UNKNOWN_ONLY', semanticDescription: null }),
    NECK_LEFT: Object.freeze({ tier: 'UNKNOWN_ONLY', semanticDescription: null }),
    NECK_RIGHT: Object.freeze({ tier: 'UNKNOWN_ONLY', semanticDescription: null }),
    CHIN_NECK_TRANSITION: Object.freeze({ tier: 'UNKNOWN_ONLY', semanticDescription: null })
  });
  /** Semantic-labelability classification for a requested AnatomicalRegion. Unrecognized region
   *  names fail closed to UNKNOWN_ONLY — never guessed as labelable. */
  function regionLabelability(region) {
    return REGION_LABELABILITY[region] || Object.freeze({ tier: 'UNKNOWN_ONLY', semanticDescription: null });
  }
  /** HairState values a region may be labeled with. Driven ENTIRELY by semantic labelability,
   *  not by 3D visualization support (BI-1E correction) — enforced (not just suggested) by
   *  setRegionLabel below. UNKNOWN_ONLY regions may only ever record UNKNOWN. */
  function regionAllowedHairStates(region) {
    return regionLabelability(region).tier === 'UNKNOWN_ONLY' ? UNKNOWN_ONLY : LABELABLE_HAIR_STATES;
  }

  // ---- BI-1W Part 2/3/5 — independent Surface Observability channel --------
  // Explicit opt-in list (not derived from labelability) so promoting a region to hair-labelable
  // never silently makes Surface Observability completion-required for regions that never asked
  // for it -- this is what keeps every historical single-channel region and bundle unaffected.
  var DUAL_CHANNEL_REGIONS = Object.freeze(['UNDER_CHIN', 'UNDER_JAW_LEFT', 'UNDER_JAW_RIGHT']);
  function regionRequiresSurfaceObservability(region) {
    return DUAL_CHANNEL_REGIONS.indexOf(region) !== -1;
  }
  /** SurfaceObservability values a region may be labeled with. Mirrors regionAllowedHairStates'
   *  gating (dual-channel regions get the full vocabulary, everything else stays UNKNOWN-only)
   *  but is a wholly separate, independently-set channel (Part 3) -- never derived from hairState. */
  function regionAllowedSurfaceStates(region) {
    return regionRequiresSurfaceObservability(region) ? SURFACE_OBSERVABILITY_STATES : UNKNOWN_ONLY;
  }
  /** Advisory only (Part 3): flags one obviously-impossible channel combination without ever
   *  rewriting either value. Returns a warning string, or null (including for every combination
   *  not explicitly known to be impossible -- sparse beard genuinely can show visible skin, etc). */
  function regionLabelAdvisory(hairState, surfaceObservability) {
    if (hairState === 'NON_BEARD_CONFIRMED' && surfaceObservability === 'BEARD_OCCLUDED_SKIN') {
      return 'No beard was confirmed in this region, so skin cannot simultaneously be beard-occluded -- please re-check both fields.';
    }
    return null;
  }

  // Human-friendly display labels (canonical value is always what is stored/exported).
  var HAIR_STATE_DISPLAY = Object.freeze({
    BEARD_CONFIRMED: 'Beard', NON_BEARD_CONFIRMED: 'Skin / no beard',
    BOUNDARY: 'Boundary (edge)', UNCERTAIN: 'Uncertain', UNKNOWN: 'Not looked at'
  });
  var SURFACE_OBSERVABILITY_DISPLAY = Object.freeze({
    VISIBLE_SKIN: 'Visible skin', BEARD_OCCLUDED_SKIN: 'Hidden by beard',
    OTHER_OCCLUDED: 'Other occlusion', NOT_VISIBLE: 'Not visible from this view', UNKNOWN: 'Not looked at'
  });

  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }
  // BI-1W HOTFIX: nativeFrameTimestampNs is an IDENTITY field, not a measurement -- real raw
  // scan exports serialize it as a numeric STRING (the same class of issue previously fixed in
  // accuracy/a6-scan-package-adapter.mjs for the adapter-retained path; RAW_SCAN_OBSERVATION
  // entries built directly from a raw export never went through that normalization). Export/
  // validation must preserve whatever type the canonical bundle entry actually carries rather
  // than silently nulling it out because it isn't a JS `number`. Used ONLY for identity fields
  // (nativeFrameTimestampNs) -- every other isFiniteNum call site (coordinates, dimensions,
  // confidence, rotation) is intentionally untouched and stays numeric-only.
  function isIdentityValuePresent(v) {
    if (typeof v === 'number') return isFinite(v);
    if (typeof v === 'string') return v.length > 0 && isFinite(Number(v));
    return false;
  }
  function clampConfidence(v) {
    if (v === '' || v === null || typeof v === 'undefined') return null;
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFiniteNum(n)) return null;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  // ---- BI-1W Part 7/8/9/10 — raw-observation identity ----------------------
  // currentScannerStep is Scanner state-machine progress; observedPoseRegion is the real-time
  // pose-region classification of the actual observation. For continuous/hidden observations the
  // two may legitimately disagree (BI-1V found several real Chin-Up-family frames carrying
  // currentScannerStep:"front"). Neither this module nor any consumer may treat currentScannerStep
  // as if it determined visible anatomy -- observedPoseRegion plus the real image is authoritative.
  function identityModeOf(e) {
    return (e && IDENTITY_MODES.indexOf(e.identityMode) !== -1) ? e.identityMode : 'ADAPTER_RETAINED_OBSERVATION';
  }
  /** Internal-only lookup key. For ADAPTER_RETAINED_OBSERVATION (the historical default, used
   *  whenever identityMode is absent) this is exactly sourceScanObservationId, byte-identical to
   *  every prior stage. For RAW_SCAN_OBSERVATION (sourceScanObservationId truthfully null, Part 8)
   *  this is the Part 10 composite: scanSessionId + nativeFrameTimestampNs + rawObservationId. It
   *  is used ONLY to key in-memory annotation state / UI navigation and is NEVER written into an
   *  export's sourceScanObservationId field. */
  function entryKey(e) {
    if (!e) return null;
    if (e.sourceScanObservationId != null) return String(e.sourceScanObservationId);
    return 'raw:' + e.scanSessionId + ':' + e.nativeFrameTimestampNs + ':' + e.rawObservationId;
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
      if (e.identityMode != null && IDENTITY_MODES.indexOf(e.identityMode) === -1) errors.push('entry ' + i + ' invalid identityMode "' + e.identityMode + '"');
      var mode = identityModeOf(e);
      if (mode === 'RAW_SCAN_OBSERVATION') {
        if (e.sourceScanObservationId != null) errors.push('entry ' + i + ' is RAW_SCAN_OBSERVATION but sourceScanObservationId is not null (never synthesize a retained id — Part 8)');
        if (e.scanSessionId == null) errors.push('entry ' + i + ' RAW_SCAN_OBSERVATION missing scanSessionId');
        if (e.nativeFrameTimestampNs == null) errors.push('entry ' + i + ' RAW_SCAN_OBSERVATION missing nativeFrameTimestampNs');
        if (e.rawObservationId == null) errors.push('entry ' + i + ' RAW_SCAN_OBSERVATION missing rawObservationId');
        if (e.observedPoseRegion == null) errors.push('entry ' + i + ' RAW_SCAN_OBSERVATION missing observedPoseRegion');
      } else if (e.sourceScanObservationId == null) {
        errors.push('entry ' + i + ' missing sourceScanObservationId');
      }
      if (e.imageRef == null) errors.push('entry ' + i + ' missing imageRef');
      if (e.poseId != null && SCAN_POSES.indexOf(e.poseId) === -1) errors.push('entry ' + i + ' invalid poseId "' + e.poseId + '"');
      if (e.syncStatus != null && SYNC_STATES.indexOf(e.syncStatus) === -1) errors.push('entry ' + i + ' invalid syncStatus "' + e.syncStatus + '"');
      if (!Array.isArray(e.regionsToAnnotate)) errors.push('entry ' + i + ' regionsToAnnotate is not an array');
    });
    // Standing composite-identity discipline: every entry's lookup key must be unique, whichever
    // identity path it takes (guards the exact cross-session collision class found in BI-1G).
    var seenKeys = {};
    (obj.entries || []).forEach(function (e, i) {
      var k = entryKey(e);
      if (k == null) return; // already reported above
      if (seenKeys[k]) errors.push('entry ' + i + ' duplicate identity key — composite identity must be unique');
      seenKeys[k] = true;
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
  // surfaceObservability defaults to null (BI-1W Part 4): a distinct "not yet touched" sentinel,
  // never confused with the string 'UNKNOWN' the annotator gets by explicitly choosing it. This
  // mirrors hairState's own pattern (its 'UNKNOWN' default plus the separate annotationStatus
  // field already carries the same "touched vs not" distinction for the historical channel).
  function defaultRegionLabel() {
    return { hairState: 'UNKNOWN', annotationStatus: 'UNKNOWN', annotationConfidence: null, notes: '', surfaceObservability: null };
  }
  function initAnnotationState(bundle) {
    var byEntry = {};
    (bundle.entries || []).forEach(function (e) {
      var m = {};
      (e.regionsToAnnotate || []).forEach(function (r) { m[r] = defaultRegionLabel(); });
      byEntry[entryKey(e)] = m;
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
      if (regionAllowedHairStates(region).indexOf(patch.hairState) === -1) {
        throw new Error('setRegionLabel: "' + region + '" is classified UNKNOWN_ONLY for this experiment (not reliably identifiable without a trustworthy spatial definition) — only UNKNOWN is allowed');
      }
      cur.hairState = patch.hairState;
    }
    // BI-1W Part 2/3 — wholly independent of hairState above: no cross-derivation either way.
    if (patch.surfaceObservability != null) {
      if (SURFACE_OBSERVABILITY_STATES.indexOf(patch.surfaceObservability) === -1) throw new Error('setRegionLabel: invalid surfaceObservability "' + patch.surfaceObservability + '"');
      if (regionAllowedSurfaceStates(region).indexOf(patch.surfaceObservability) === -1) {
        throw new Error('setRegionLabel: "' + region + '" does not accept Surface Observability labeling in this experiment — only UNKNOWN is allowed');
      }
      cur.surfaceObservability = patch.surfaceObservability;
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
  // BI-1W Part 4: for the three dual-channel regions, completion additionally requires an
  // explicit (non-null) surfaceObservability -- every other region's completion rule is
  // byte-identical to every prior stage (regionRequiresSurfaceObservability is false for them).
  function isEntryComplete(labels, regionsToAnnotate) {
    if (!regionsToAnnotate || !regionsToAnnotate.length) return false;
    return regionsToAnnotate.every(function (r) {
      var l = labels[r];
      if (!l || !l.annotationStatus || l.annotationStatus === 'UNKNOWN') return false;
      if (regionRequiresSurfaceObservability(r) && l.surfaceObservability == null) return false;
      return true;
    });
  }
  function progressCounts(bundle, state) {
    var entries = bundle.entries || [];
    var regionsRequested = 0, regionsLabeled = 0, imagesCompleted = 0, imagesNeedingReview = 0;
    var ambiguousLabels = 0, excludedLabels = 0;
    entries.forEach(function (e) {
      var labels = entryLabels(state, entryKey(e));
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
        entryIds: (bundle.entries || []).map(function (e) { return entryKey(e); })
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
      var key = entryKey(e);
      var mode = identityModeOf(e);
      var m = entryLabels(state, key);
      (e.regionsToAnnotate || []).forEach(function (region) {
        var l = m[region] || defaultRegionLabel();
        if (l.annotationStatus === 'LABELED') summary.definitive++;
        else if (l.annotationStatus === 'AMBIGUOUS') summary.ambiguous++;
        else if (l.annotationStatus === 'NEEDS_REVIEW') summary.needsReview++;
        else if (l.annotationStatus === 'EXCLUDED') summary.excluded++;
        else summary.unknown++;
        labels.push({
          labelId: key + ':' + region,
          scanSessionId: e.scanSessionId || null,
          // Part 8: sourceScanObservationId is truthfully null for RAW_SCAN_OBSERVATION entries —
          // never populated with entryKey's internal composite convenience value.
          sourceScanObservationId: e.sourceScanObservationId != null ? e.sourceScanObservationId : null,
          identityMode: mode,
          rawObservationId: e.rawObservationId != null ? e.rawObservationId : null,
          adapterRetained: e.adapterRetained === true,
          imageRef: e.imageRef,
          nativeFrameTimestampNs: isIdentityValuePresent(e.nativeFrameTimestampNs) ? e.nativeFrameTimestampNs : null,
          poseId: e.poseId || null,
          observedPoseRegion: e.observedPoseRegion || null,
          anatomicalRegion: region,
          hairState: l.hairState || 'UNKNOWN',
          surfaceObservability: l.surfaceObservability == null ? null : l.surfaceObservability,
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
    var byKey = {};
    (bundle.entries || []).forEach(function (e) { byKey[entryKey(e)] = e; });
    exportObj.labels.forEach(function (l, i) {
      var mode = IDENTITY_MODES.indexOf(l.identityMode) !== -1 ? l.identityMode : 'ADAPTER_RETAINED_OBSERVATION';
      var lookupKey = mode === 'RAW_SCAN_OBSERVATION'
        ? ('raw:' + l.scanSessionId + ':' + l.nativeFrameTimestampNs + ':' + l.rawObservationId)
        : (l.sourceScanObservationId != null ? String(l.sourceScanObservationId) : null);
      var e = lookupKey != null ? byKey[lookupKey] : null;
      if (!e) {
        // BI-1W HOTFIX Part 11: name the missing/malformed identity component explicitly rather
        // than only surfacing the opaque reconstructed key -- never silently repair it.
        if (mode === 'RAW_SCAN_OBSERVATION') {
          var missing = [];
          if (l.scanSessionId == null) missing.push('scanSessionId');
          if (l.nativeFrameTimestampNs == null) missing.push('nativeFrameTimestampNs');
          if (l.rawObservationId == null) missing.push('rawObservationId');
          errors.push('label ' + i + ' (region ' + (l.anatomicalRegion || '?') + ', session ' + (l.scanSessionId || '?') + ', rawObservationId ' + (l.rawObservationId != null ? l.rawObservationId : '?') + ') references unknown observation' +
            (missing.length ? ' -- missing: ' + missing.join(', ') : ' -- no bundle entry matches key ' + lookupKey));
        } else {
          errors.push('label ' + i + ' (region ' + (l.anatomicalRegion || '?') + ') references unknown observation ' + (l.sourceScanObservationId != null ? l.sourceScanObservationId : lookupKey));
        }
        return;
      }
      if (l.imageRef !== e.imageRef) errors.push('label ' + i + ' imageRef mismatch');
      if ((l.poseId || null) !== (e.poseId || null)) errors.push('label ' + i + ' poseId mismatch');
      if ((l.nativeFrameTimestampNs == null ? null : l.nativeFrameTimestampNs) !== (isIdentityValuePresent(e.nativeFrameTimestampNs) ? e.nativeFrameTimestampNs : null)) errors.push('label ' + i + ' timestamp mismatch');
      if (l.sourceMethod !== MANUAL_GROUND_TRUTH) errors.push('label ' + i + ' sourceMethod is not MANUAL_GROUND_TRUTH');
      if (HAIR_STATES.indexOf(l.hairState) === -1) errors.push('label ' + i + ' invalid hairState');
      if (l.surfaceObservability != null && SURFACE_OBSERVABILITY_STATES.indexOf(l.surfaceObservability) === -1) errors.push('label ' + i + ' invalid surfaceObservability');
      if (ANNOTATION_STATUSES.indexOf(l.annotationStatus) === -1) errors.push('label ' + i + ' invalid annotationStatus');
      if (mode === 'RAW_SCAN_OBSERVATION' && l.sourceScanObservationId != null) errors.push('label ' + i + ' RAW_SCAN_OBSERVATION must not carry a synthesized sourceScanObservationId');
      if (/base64|data:image|rawImage/i.test(JSON.stringify(l))) errors.push('label ' + i + ' contains image payload');
    });
    return { ok: errors.length === 0, errors: errors };
  }
  /** Trivial unwrap: the array BS1-F assembleGroundTruthDataset() consumes. */
  function groundTruthLabelsForBS1F(exportObj) {
    return (exportObj && Array.isArray(exportObj.labels)) ? exportObj.labels.slice() : [];
  }

  // ---- BI-1Y — outer-beard contour ground truth (additive, wholly separate from -------------
  // ---- the categorical HairState/SurfaceObservability channel above) ------------------------
  // BI-1X found the current categorical submental GT is valid but no trustworthy submental ROI
  // exists yet, and identified VISIBLE_OUTER_BEARD_SURFACE silhouette contour GT as the highest-
  // value next step -- BEFORE any 3D reconstruction. This section adds a minimal point-click
  // open-polyline contour tool for exactly that evidence layer. It never touches WORKBENCH_VERSION,
  // buildAutosavePayload/restoreFromAutosave, buildExport/validateExport, or defaultRegionLabel --
  // a BI-1W categorical bundle/export/autosave is byte-for-byte unaffected by everything below.
  //
  // SURFACE SEPARATION (permanent): this tool captures VISIBLE_OUTER_BEARD_SURFACE evidence only
  // -- never VISIBLE_SKIN_SURFACE, never HIDDEN_SKIN_UNDER_BEARD. A contour is the beard/air or
  // beard/background boundary as actually seen, never a projection onto hidden anatomy.
  var CONTOUR_WORKBENCH_VERSION = 'annotation-workbench-contour/1';
  // Reuses the SAME canonical pixel space already defined for the verified geometry overlay
  // (OVERLAY_COORDINATE_SPACE / accuracy/annotation-overlay-data.mjs) rather than inventing a
  // second convention: raw keyframe pixels, before the rotate/mirror display transform.
  var CONTOUR_COORDINATE_SPACE = OVERLAY_COORDINATE_SPACE;
  // Audited against accuracy/beard-surface-core.mjs's AnatomicalRegion enum and this file's own
  // REGION_VISUAL_REFERENCE / REGION_LABELABILITY tables -- no OUTER_BEARD_* key exists anywhere
  // in the project, so these three are new, non-duplicate semantic keys (Part 5). BI-1Y CORRECTION:
  // the left/right ordering originally shipped as OUTER_BEARD_LEFT_UNDER_JAW / _RIGHT_UNDER_JAW,
  // inconsistent with the project's established UNDER_JAW_LEFT / UNDER_JAW_RIGHT anatomical
  // ordering (accuracy/beard-surface-core.mjs AnatomicalRegion, this file's own DUAL_CHANNEL_REGIONS
  // above). Renamed before any human contour GT existed against the old names -- confirmed by
  // repo-wide audit (no export, no autosave payload, no consumer anywhere used the old names).
  var CONTOUR_TYPES = Object.freeze(['OUTER_BEARD_UNDERSIDE', 'OUTER_BEARD_UNDER_JAW_LEFT', 'OUTER_BEARD_UNDER_JAW_RIGHT']);
  var CONTOUR_TYPE_DISPLAY = Object.freeze({
    OUTER_BEARD_UNDERSIDE: 'Beard underside',
    OUTER_BEARD_UNDER_JAW_LEFT: 'Beard — left under-jaw',
    OUTER_BEARD_UNDER_JAW_RIGHT: 'Beard — right under-jaw'
  });
  // Plain-language definitions shown verbatim to the annotator (Part 6). Never call this skin;
  // never describe hidden anatomy.
  var CONTOUR_TYPE_DEFINITIONS = Object.freeze({
    OUTER_BEARD_UNDERSIDE: 'Trace the visible outside edge of the beard beneath the chin. Trace the BEARD-AIR / BEARD-BACKGROUND boundary. Do not trace where you think the skin is underneath.',
    OUTER_BEARD_UNDER_JAW_LEFT: 'Trace the visible outside beard edge beneath the anatomical LEFT side of the jaw.',
    OUTER_BEARD_UNDER_JAW_RIGHT: 'Trace the visible outside beard edge beneath the anatomical RIGHT side of the jaw.'
  });
  // The three legitimate FINAL human decisions. Deliberately does NOT include the "untouched"
  // sentinel (CONTOUR_PENDING_STATUS below) -- UNKNOWN here means "the annotator looked and could
  // not determine an answer", never "nobody has looked yet". Keeping the pending sentinel out of
  // this enum is what makes every existing membership check (setContourTraceabilityStatus,
  // validateContourExport) fail closed on a still-pending contour for free, with no separate check.
  var TRACEABILITY_STATUSES = Object.freeze(['TRACED', 'NOT_TRACEABLE', 'UNKNOWN']);
  // BI-1Y CORRECTION (Issue 2) -- an untouched contour instance's internal state, distinct from
  // every real answer. Mirrors the existing "distinct not-yet-touched sentinel" pattern already
  // used for surfaceObservability (defaultRegionLabel above: starts `null`, never confused with
  // the string 'UNKNOWN' a categorical annotator gets by explicitly choosing it). A plain string
  // (not null) is used here because traceabilityStatus is rendered verbatim as UI badge text and
  // is typed identically to the three real answers everywhere else in this module.
  var CONTOUR_PENDING_STATUS = 'UNSET';
  // The minimum number of ordered points that still describes a meaningful polyline (Part 9).
  var MIN_CONTOUR_POINTS = 2;
  // Mirrors the sealed BI-1W holdout manifest identity exactly (scan_mtdogmlr_espu2w obs22/obs23).
  // Never viewed, annotated, or scored -- this constant exists ONLY so validateContourBundle /
  // validateContourExport can fail closed if it is ever accidentally included (Part 19/23).
  var SEALED_HOLDOUT_IDENTITIES = Object.freeze([
    Object.freeze({ scanSessionId: 'scan_mtdogmlr_espu2w', rawObservationId: 22 }),
    Object.freeze({ scanSessionId: 'scan_mtdogmlr_espu2w', rawObservationId: 23 })
  ]);
  function isSealedHoldoutEntry(e) {
    if (!e) return false;
    return SEALED_HOLDOUT_IDENTITIES.some(function (h) { return h.scanSessionId === e.scanSessionId && h.rawObservationId === e.rawObservationId; });
  }

  /** Superset of validateBundle (Part 1/13): every check above still applies unchanged, plus
   *  optional entry.contourTypesToAnnotate membership and a sealed-holdout fail-closed guard.
   *  A historical bundle with neither field behaves byte-identically to validateBundle. */
  function validateContourBundle(obj) {
    var base = validateBundle(obj);
    if (!base.ok) return base;
    var errors = [];
    (obj.entries || []).forEach(function (e, i) {
      if (e.contourTypesToAnnotate != null) {
        if (!Array.isArray(e.contourTypesToAnnotate)) {
          errors.push('entry ' + i + ' contourTypesToAnnotate is not an array');
        } else {
          e.contourTypesToAnnotate.forEach(function (ct) {
            if (CONTOUR_TYPES.indexOf(ct) === -1) errors.push('entry ' + i + ' invalid contour type "' + ct + '"');
          });
        }
      }
      if (isSealedHoldoutEntry(e)) errors.push('entry ' + i + ' is the SEALED HOLDOUT (scan_mtdogmlr_espu2w obs22/obs23) — must never appear in a development bundle');
    });
    return { ok: errors.length === 0, errors: errors, bundle: errors.length === 0 ? obj : null };
  }

  // ---- contour annotation state ---------------------------------------------------------
  // BI-1Y CORRECTION (Issue 2): an untouched instance starts CONTOUR_PENDING_STATUS ('UNSET'),
  // never 'UNKNOWN' -- UNKNOWN is a real human answer and must only appear after the annotator
  // explicitly chooses it (setContourTraceabilityStatus below).
  // BI-2F0A.4 additions (backward compatible -- an older restored instance simply lacks these;
  // every reader below treats a missing revisionNumber/basedOnFingerprint/basedOnRevision/
  // priorRevisions as 1 / null / null / [], never as an error): revisionNumber is THIS
  // instance's own revision number (1 for an original, never-revised annotation);
  // basedOnFingerprint/basedOnRevision identify the locked source this instance was created
  // FROM via createContourRevision (null for an original); priorRevisions is the append-only,
  // never-mutated archive of every earlier locked record for this contour, oldest first.
  function defaultContourInstance() { return { traceabilityStatus: CONTOUR_PENDING_STATUS, points: [], notes: '', history: [], redoStack: [], locked: false, lockedRecord: null, revisionNumber: 1, basedOnFingerprint: null, basedOnRevision: null, priorRevisions: [] }; }
  function assertContourNotLocked(rec, contourType) {
    var c = rec && rec.contours && rec.contours[contourType];
    if (c && c.locked) throw new Error('this contour is LOCKED (blind GT) -- create a new revision rather than editing the locked original');
  }
  // BI-2F0A.2 -- unified snapshot-based undo/redo for contour instances. Every mutating
  // operation (append, insert, move, delete-at-index) pushes ONE full-points-array snapshot
  // here first; undo/redo always restore a whole snapshot, never a single point, so a move/
  // delete/insert is exactly as undoable as an append always was. Backward compatible with the
  // pre-existing "Undo last point" button: for a history that only ever appended points, undoing
  // a snapshot produces the IDENTICAL observable result as popping the last point.
  function pushContourSnapshot(c) {
    if (!Array.isArray(c.history)) c.history = [];
    c.history.push(JSON.parse(JSON.stringify(c.points)));
    if (c.history.length > 50) c.history.shift();
    c.redoStack = [];
  }
  function initContourState(bundle) {
    var byEntry = {};
    (bundle.entries || []).forEach(function (e) {
      var contours = {};
      (e.contourTypesToAnnotate || []).forEach(function (ct) { contours[ct] = defaultContourInstance(); });
      byEntry[entryKey(e)] = { imageWidth: null, imageHeight: null, contours: contours };
    });
    return { contourWorkbenchVersion: CONTOUR_WORKBENCH_VERSION, fingerprint: bundleFingerprint(bundle), byEntry: byEntry, position: 0 };
  }
  function contourEntryRecord(state, obsId) { return (state.byEntry && state.byEntry[obsId]) || { imageWidth: null, imageHeight: null, contours: {} }; }
  /** Captured once per image from the loaded <img>'s real naturalWidth/naturalHeight (Part 3/4)
   *  -- never from CSS/display size -- so every contour point on this entry stays reproducible. */
  function setContourImageDimensions(state, obsId, imageWidth, imageHeight) {
    var next = JSON.parse(JSON.stringify(state));
    var rec = next.byEntry[obsId] || (next.byEntry[obsId] = { imageWidth: null, imageHeight: null, contours: {} });
    if (isFiniteNum(imageWidth)) rec.imageWidth = imageWidth;
    if (isFiniteNum(imageHeight)) rec.imageHeight = imageHeight;
    return next;
  }
  function addContourPoint(state, obsId, contourType, x, y) {
    if (CONTOUR_TYPES.indexOf(contourType) === -1) throw new Error('addContourPoint: invalid contour type "' + contourType + '"');
    if (!isFiniteNum(x) || !isFiniteNum(y)) throw new Error('addContourPoint: point must have finite x/y');
    var next = JSON.parse(JSON.stringify(state));
    var rec = next.byEntry[obsId] || (next.byEntry[obsId] = { imageWidth: null, imageHeight: null, contours: {} });
    assertContourNotLocked(rec, contourType);
    var c = rec.contours[contourType] || (rec.contours[contourType] = defaultContourInstance());
    pushContourSnapshot(c);
    c.points.push({ x: x, y: y });
    return next;
  }
  // ---- BI-2F0 Part 6: insert a point BETWEEN two existing contour vertices (never appended to
  // the end when inserted mid-curve). Reuses precision-annotation-core's ordering primitive so
  // both editors (contour + review) share the exact same splice semantics.
  function insertContourPoint(state, obsId, contourType, afterIndex, x, y, precisionCore) {
    var next = JSON.parse(JSON.stringify(state));
    var rec = next.byEntry[obsId] || (next.byEntry[obsId] = { imageWidth: null, imageHeight: null, contours: {} });
    assertContourNotLocked(rec, contourType);
    var c = rec.contours[contourType] || (rec.contours[contourType] = defaultContourInstance());
    pushContourSnapshot(c);
    c.points = precisionCore.insertPointOrdered(c.points, afterIndex, x, y);
    return next;
  }
  // ---- BI-2F0A.2 -- vertex selection/drag/keyboard-nudge for contour (OPEN_POLYLINE) points,
  // mirroring the review (CLOSED_POLYGON) editor's already-proven pattern exactly (same locked
  // guard, same "one drag = one snapshot" discipline via the No-History variant).
  function moveContourPoint(state, obsId, contourType, index, x, y) {
    if (!isFiniteNum(x) || !isFiniteNum(y)) throw new Error('moveContourPoint: x/y must be finite');
    var next = JSON.parse(JSON.stringify(state));
    var rec = next.byEntry[obsId]; if (!rec) throw new Error('moveContourPoint: no record for this entry');
    assertContourNotLocked(rec, contourType);
    var c = rec.contours[contourType]; if (!c) throw new Error('moveContourPoint: no contour instance for this type');
    if (index < 0 || index >= c.points.length) throw new Error('moveContourPoint: index out of range');
    pushContourSnapshot(c);
    c.points[index] = { x: x, y: y };
    return next;
  }
  /** Used during an active drag's pointermove -- updates the point WITHOUT pushing a new
   *  snapshot, so a whole drag gesture (many pointermoves) still equals exactly one undo entry
   *  once beginContourDragTransaction pushed the pre-drag snapshot at pointerdown. */
  function moveContourPointNoHistory(state, obsId, contourType, index, x, y) {
    if (!isFiniteNum(x) || !isFiniteNum(y)) throw new Error('moveContourPointNoHistory: x/y must be finite');
    var next = JSON.parse(JSON.stringify(state));
    var rec = next.byEntry[obsId]; if (!rec) throw new Error('moveContourPointNoHistory: no record for this entry');
    assertContourNotLocked(rec, contourType);
    var c = rec.contours[contourType]; if (!c) throw new Error('moveContourPointNoHistory: no contour instance for this type');
    if (index < 0 || index >= c.points.length) throw new Error('moveContourPointNoHistory: index out of range');
    c.points[index] = { x: x, y: y };
    return next;
  }
  function beginContourDragTransaction(state, obsId, contourType) {
    var next = JSON.parse(JSON.stringify(state));
    var rec = next.byEntry[obsId]; if (!rec) throw new Error('beginContourDragTransaction: no record for this entry');
    assertContourNotLocked(rec, contourType);
    var c = rec.contours[contourType]; if (!c) throw new Error('beginContourDragTransaction: no contour instance for this type');
    pushContourSnapshot(c);
    return next;
  }
  /** Arrow-key nudge (Part 6: 1 raw image px, Shift+Arrow: 5 raw image px). One keypress = one
   *  snapshot (via moveContourPoint), matching the review editor's nudgeHandlePoint exactly. */
  function nudgeContourPoint(state, obsId, contourType, index, dx, dy) {
    var rec = contourEntryRecord(state, obsId);
    var c = rec.contours[contourType]; if (!c || index < 0 || index >= c.points.length) throw new Error('nudgeContourPoint: index out of range');
    var p = c.points[index];
    return moveContourPoint(state, obsId, contourType, index, p.x + dx, p.y + dy);
  }
  /** Deletes exactly the point at `index` (click-select + Delete/Backspace path) -- distinct
   *  from undoLastContourPoint (which always targets the LAST point / most recent snapshot).
   *  Refuses to remove the only remaining point (a 0-point "traced" contour is meaningless). */
  function deleteContourPointAt(state, obsId, contourType, index) {
    var next = JSON.parse(JSON.stringify(state));
    var rec = next.byEntry[obsId]; if (!rec) throw new Error('deleteContourPointAt: no record for this entry');
    assertContourNotLocked(rec, contourType);
    var c = rec.contours[contourType]; if (!c) throw new Error('deleteContourPointAt: no contour instance for this type');
    if (index < 0 || index >= c.points.length) throw new Error('deleteContourPointAt: index out of range');
    if (c.points.length <= 1) throw new Error('deleteContourPointAt: refusing to remove the only remaining point');
    pushContourSnapshot(c);
    c.points.splice(index, 1);
    return next;
  }
  /** Removes exactly the last point, if any (Part 20 test 8). Safe no-op on an empty contour.
   *  BI-2F0A.2: now backed by the unified snapshot history (pushContourSnapshot) -- for a
   *  history that only ever appended points this produces the IDENTICAL observable result as
   *  popping the last point, so existing append-only callers see no behavior change. */
  function undoLastContourPoint(state, obsId, contourType) {
    var next = JSON.parse(JSON.stringify(state));
    var rec = next.byEntry[obsId]; if (!rec) return next;
    assertContourNotLocked(rec, contourType);
    var c = rec.contours[contourType]; if (!c || !c.history || !c.history.length) return next;
    if (!Array.isArray(c.redoStack)) c.redoStack = [];
    c.redoStack.push(JSON.parse(JSON.stringify(c.points)));
    c.points = c.history.pop();
    return next;
  }
  /** BI-2F0 Part 7: redo the snapshot undoLastContourPoint most recently restored-from. */
  function redoLastContourPoint(state, obsId, contourType) {
    var next = JSON.parse(JSON.stringify(state));
    var rec = next.byEntry[obsId]; if (!rec) return next;
    assertContourNotLocked(rec, contourType);
    var c = rec.contours[contourType]; if (!c || !c.redoStack || !c.redoStack.length) return next;
    if (!Array.isArray(c.history)) c.history = [];
    c.history.push(JSON.parse(JSON.stringify(c.points)));
    c.points = c.redoStack.pop();
    return next;
  }
  /** Resets ONLY this one contour instance (points + status) -- every other contour type and
   *  every other image is untouched (Part 20 test 9). This is the "clear / restart" action. */
  function clearContour(state, obsId, contourType) {
    var next = JSON.parse(JSON.stringify(state));
    var rec = next.byEntry[obsId]; if (!rec) return next;
    assertContourNotLocked(rec, contourType);
    rec.contours[contourType] = defaultContourInstance();
    return next;
  }
  /** BI-2F0 Part 20: locks a contour (blind GT). After this, addContourPoint/insertContourPoint/
   *  undoLastContourPoint/redoLastContourPoint/clearContour all refuse via assertContourNotLocked. */
  function lockContour(state, obsId, contourType, precisionCore, meta) {
    var next = JSON.parse(JSON.stringify(state));
    var rec = next.byEntry[obsId]; if (!rec) throw new Error('lockContour: no record for this entry');
    var c = rec.contours[contourType]; if (!c) throw new Error('lockContour: no contour instance for this type');
    if (c.locked) throw new Error('lockContour: already locked -- create a new revision instead of re-locking');
    var lockMeta = Object.assign({ entryKey: obsId, target: contourType, revision: isFiniteNum(c.revisionNumber) ? c.revisionNumber : 1 }, meta || {});
    var record = precisionCore.lockBlindAnnotation(c.points, 'OPEN_POLYLINE', lockMeta);
    // BI-2F0A.4: if this instance is itself a revision (created via createContourRevision), carry
    // its lineage (basedOnFingerprint/basedOnRevision) forward onto the newly-locked record too.
    if (c.basedOnFingerprint != null) {
      record = Object.freeze(Object.assign({}, record, { basedOnFingerprint: c.basedOnFingerprint, basedOnRevision: c.basedOnRevision }));
    }
    c.lockedRecord = record;
    c.locked = true;
    return next;
  }
  /** BI-2F0A.4 (Part "Create New Revision"): the sanctioned UI action for revising a locked BLIND
   *  GT contour. The original locked record is NEVER mutated -- it is archived (append-only) into
   *  priorRevisions, and a brand-new, independently-editable instance is created starting from a
   *  COPY of the locked geometry, with an incremented revisionNumber and explicit
   *  basedOnFingerprint/basedOnRevision lineage back to the record it was revised from. Editing
   *  the new instance is allowed immediately (locked:false); editing the archived original remains
   *  permanently refused via assertContourNotLocked, since c.locked here is a NEW object entirely
   *  -- the old locked instance is never referenced as "the current instance" again. */
  function createContourRevision(state, obsId, contourType, precisionCore, meta) {
    var next = JSON.parse(JSON.stringify(state));
    var rec = next.byEntry[obsId]; if (!rec) throw new Error('createContourRevision: no record for this entry');
    var c = rec.contours[contourType]; if (!c) throw new Error('createContourRevision: no contour instance for this type');
    if (!c.locked || !c.lockedRecord) throw new Error('createContourRevision: source contour is not locked -- nothing to revise');
    var lockedSrc = c.lockedRecord;
    var priorRevisions = (c.priorRevisions || []).concat([lockedSrc]);
    rec.contours[contourType] = {
      traceabilityStatus: c.traceabilityStatus || CONTOUR_PENDING_STATUS,
      points: lockedSrc.points.map(function (p) { return { x: p.x, y: p.y }; }),
      notes: c.notes ? String(c.notes) : '',
      history: [], redoStack: [],
      locked: false, lockedRecord: null,
      revisionNumber: lockedSrc.revision + 1,
      basedOnFingerprint: lockedSrc.fingerprint,
      basedOnRevision: lockedSrc.revision,
      priorRevisions: priorRevisions
    };
    return next;
  }
  function setContourNotes(state, obsId, contourType, notes) {
    var next = JSON.parse(JSON.stringify(state));
    var rec = next.byEntry[obsId] || (next.byEntry[obsId] = { imageWidth: null, imageHeight: null, contours: {} });
    var c = rec.contours[contourType] || (rec.contours[contourType] = defaultContourInstance());
    c.notes = notes == null ? '' : String(notes);
    return next;
  }
  /** Explicit user decision (Part 9/15) -- never auto-derived from point count alone. TRACED
   *  requires the minimum meaningful polyline; NOT_TRACEABLE/UNKNOWN always clear any points,
   *  since neither legitimately carries coordinates. */
  function setContourTraceabilityStatus(state, obsId, contourType, status) {
    if (TRACEABILITY_STATUSES.indexOf(status) === -1) throw new Error('setContourTraceabilityStatus: invalid status "' + status + '"');
    var next = JSON.parse(JSON.stringify(state));
    var rec = next.byEntry[obsId] || (next.byEntry[obsId] = { imageWidth: null, imageHeight: null, contours: {} });
    var c = rec.contours[contourType] || (rec.contours[contourType] = defaultContourInstance());
    if (status === 'TRACED') {
      if (c.points.length < MIN_CONTOUR_POINTS) {
        throw new Error('setContourTraceabilityStatus: "' + contourType + '" needs at least ' + MIN_CONTOUR_POINTS + ' points to be marked TRACED');
      }
    } else {
      c.points = [];
    }
    c.traceabilityStatus = status;
    return next;
  }
  function contourNavigate(state, delta, total) {
    var next = JSON.parse(JSON.stringify(state));
    var p = next.position + delta;
    next.position = p < 0 ? 0 : (p > total - 1 ? total - 1 : p);
    return next;
  }
  /** BI-1Y CORRECTION (Issue 2/Part 3): four buckets, not three -- contoursUnset is everything
   *  the annotator has not yet made an explicit decision on. contoursDecided (traced+notTraceable
   *  +unknown) is what export completeness (Part 4) gates on; contoursUnset must be 0 before a
   *  final export is allowed. */
  function contourProgressCounts(bundle, state) {
    var entries = bundle.entries || [];
    var requested = 0, traced = 0, notTraceable = 0, unknown = 0, unset = 0;
    entries.forEach(function (e) {
      var rec = contourEntryRecord(state, entryKey(e));
      (e.contourTypesToAnnotate || []).forEach(function (ct) {
        requested++;
        var c = rec.contours[ct] || defaultContourInstance();
        if (c.traceabilityStatus === 'TRACED') traced++;
        else if (c.traceabilityStatus === 'NOT_TRACEABLE') notTraceable++;
        else if (c.traceabilityStatus === 'UNKNOWN') unknown++;
        else unset++; // CONTOUR_PENDING_STATUS ('UNSET') or any other unrecognized value -- fail-safe bucket
      });
    });
    return {
      contoursRequested: requested, contoursTraced: traced, contoursNotTraceable: notTraceable,
      contoursUnknown: unknown, contoursUnset: unset, contoursDecided: traced + notTraceable + unknown
    };
  }

  /** Pure display->image coordinate mapping (Part 4). `offsetX/offsetY` are the click position
   *  in the target <img> element's OWN local box (CSS pixels) -- the browser's MouseEvent
   *  offsetX/offsetY already inverts any CSS transform on the element or its ancestors (rotate /
   *  mirror / zoom), so this function only has to correct for the remaining CSS-rendered-size ->
   *  real-pixel-size ratio. Fails closed (null) on non-finite or non-positive input, never on a
   *  best-effort guess. */
  function displayClickToImagePoint(offsetX, offsetY, renderedWidth, renderedHeight, naturalWidth, naturalHeight) {
    if (!isFiniteNum(offsetX) || !isFiniteNum(offsetY)) return null;
    if (!isFiniteNum(renderedWidth) || !isFiniteNum(renderedHeight) || renderedWidth <= 0 || renderedHeight <= 0) return null;
    if (!isFiniteNum(naturalWidth) || !isFiniteNum(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) return null;
    return { x: offsetX * (naturalWidth / renderedWidth), y: offsetY * (naturalHeight / renderedHeight) };
  }
  /** Inverse of the above, for drawing an already-recorded image-space point back at the
   *  currently rendered size (used only for cross-checks / tests; the live overlay instead uses
   *  an SVG viewBox in raw image-pixel space, which the browser scales for free). */
  function imagePointToDisplayPoint(x, y, renderedWidth, renderedHeight, naturalWidth, naturalHeight) {
    if (!isFiniteNum(x) || !isFiniteNum(y)) return null;
    if (!isFiniteNum(renderedWidth) || !isFiniteNum(renderedHeight) || renderedWidth <= 0 || renderedHeight <= 0) return null;
    if (!isFiniteNum(naturalWidth) || !isFiniteNum(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) return null;
    return { x: x * (renderedWidth / naturalWidth), y: y * (renderedHeight / naturalHeight) };
  }

  // ---- contour autosave (SEPARATE namespace -- never touches BI-1W autosave) ---------------
  function buildContourAutosavePayload(bundle, state) {
    return {
      contourWorkbenchVersion: CONTOUR_WORKBENCH_VERSION,
      savedAt: null,
      bundleFingerprint: bundleFingerprint(bundle),
      bundleIdentity: {
        schemaVersion: bundle.schemaVersion,
        bundleId: bundle.bundleId || null,
        datasetId: bundle.datasetId || null,
        datasetRevision: bundle.datasetRevision == null ? null : bundle.datasetRevision,
        entryIds: (bundle.entries || []).map(function (e) { return entryKey(e); })
      },
      contours: JSON.parse(JSON.stringify(state.byEntry)),
      position: state.position
      // rawImagePayload is intentionally absent, exactly like buildAutosavePayload above
    };
  }
  function restoreContourFromAutosave(autosave, bundle) {
    if (!autosave || typeof autosave !== 'object') return { ok: false, reason: 'NO_AUTOSAVE', state: null, dropped: [] };
    var fp = bundleFingerprint(bundle);
    if (autosave.bundleFingerprint !== fp) return { ok: false, reason: 'FINGERPRINT_MISMATCH', state: null, dropped: [] };
    var fresh = initContourState(bundle);
    var dropped = [];
    var saved = autosave.contours || {};
    Object.keys(saved).forEach(function (obsId) {
      if (!fresh.byEntry[obsId]) { dropped.push(obsId); return; }
      var se = saved[obsId] || {};
      if (isFiniteNum(se.imageWidth)) fresh.byEntry[obsId].imageWidth = se.imageWidth;
      if (isFiniteNum(se.imageHeight)) fresh.byEntry[obsId].imageHeight = se.imageHeight;
      var sc = se.contours || {};
      Object.keys(sc).forEach(function (ct) {
        if (!fresh.byEntry[obsId].contours[ct]) { dropped.push(obsId + '/' + ct); return; }
        var c = sc[ct] || {};
        // BI-2F0A.4: a BLIND-GT lock must survive reload (that is the entire point of "locked" --
        // an annotator who reloads mid-session must not find their locked answer silently
        // reverted to editable). Fails closed to unlocked if the saved lockedRecord is not
        // structurally plausible -- never trusts a garbled/tampered lock as valid.
        var validLockedRecord = (c.locked === true && c.lockedRecord && typeof c.lockedRecord === 'object'
          && typeof c.lockedRecord.fingerprint === 'string' && Array.isArray(c.lockedRecord.points)) ? c.lockedRecord : null;
        var pts = validLockedRecord
          ? validLockedRecord.points.map(function (p) { return { x: p.x, y: p.y }; })
          : (Array.isArray(c.points) ? c.points.filter(function (p) { return p && isFiniteNum(p.x) && isFiniteNum(p.y); }).map(function (p) { return { x: p.x, y: p.y }; }) : []);
        // BI-1Y CORRECTION (Part 5): a saved CONTOUR_PENDING_STATUS ('UNSET') is a legitimate,
        // distinct value and must round-trip as itself -- it must NEVER be coerced into the real
        // answer 'UNKNOWN' just because it isn't a member of TRACEABILITY_STATUSES. Only a truly
        // unrecognized/garbled status falls back, and it fails closed to UNSET (still-pending),
        // never to a real answer nobody actually chose.
        var status = (TRACEABILITY_STATUSES.indexOf(c.traceabilityStatus) !== -1 || c.traceabilityStatus === CONTOUR_PENDING_STATUS)
          ? c.traceabilityStatus : CONTOUR_PENDING_STATUS;
        if (status === 'TRACED' && pts.length < MIN_CONTOUR_POINTS && !validLockedRecord) status = CONTOUR_PENDING_STATUS; // fail closed, never trust a broken TRACED
        if (status !== 'TRACED' && !validLockedRecord) pts = [];
        fresh.byEntry[obsId].contours[ct] = {
          traceabilityStatus: status, points: pts, notes: c.notes == null ? '' : String(c.notes),
          history: [], redoStack: [], // undo/redo history is intentionally NOT persisted across reloads
          locked: !!validLockedRecord,
          lockedRecord: validLockedRecord ? Object.freeze(JSON.parse(JSON.stringify(validLockedRecord))) : null,
          revisionNumber: isFiniteNum(c.revisionNumber) ? c.revisionNumber : 1,
          basedOnFingerprint: c.basedOnFingerprint != null ? c.basedOnFingerprint : null,
          basedOnRevision: isFiniteNum(c.basedOnRevision) ? c.basedOnRevision : null,
          priorRevisions: Array.isArray(c.priorRevisions)
            ? c.priorRevisions.filter(function (r) { return r && typeof r.fingerprint === 'string' && Array.isArray(r.points); })
              .map(function (r) { return Object.freeze(JSON.parse(JSON.stringify(r))); })
            : []
        };
      });
    });
    fresh.position = isFiniteNum(autosave.position) ? Math.max(0, Math.min(autosave.position, (bundle.entries || []).length - 1)) : 0;
    return { ok: true, reason: null, state: fresh, dropped: dropped };
  }

  // ---- contour export (additive schema; NEVER overloads a categorical GroundTruthLabel) ---
  function buildContourExport(bundle, state, options) {
    options = options || {};
    var contours = [];
    var summary = { traced: 0, notTraceable: 0, unknown: 0, unset: 0 };
    (bundle.entries || []).forEach(function (e) {
      var key = entryKey(e);
      var mode = identityModeOf(e);
      var rec = contourEntryRecord(state, key);
      (e.contourTypesToAnnotate || []).forEach(function (ct) {
        var c = rec.contours[ct] || defaultContourInstance();
        if (c.traceabilityStatus === 'TRACED') summary.traced++;
        else if (c.traceabilityStatus === 'NOT_TRACEABLE') summary.notTraceable++;
        else if (c.traceabilityStatus === 'UNKNOWN') summary.unknown++;
        else summary.unset++; // CONTOUR_PENDING_STATUS -- validateContourExport blocks these from ever being a real export
        contours.push({
          contourId: key + ':' + ct,
          identityMode: mode,
          scanSessionId: e.scanSessionId || null,
          sourceScanObservationId: e.sourceScanObservationId != null ? e.sourceScanObservationId : null,
          rawObservationId: e.rawObservationId != null ? e.rawObservationId : null,
          adapterRetained: e.adapterRetained === true,
          observedPoseRegion: e.observedPoseRegion || null,
          imageRef: e.imageRef,
          nativeFrameTimestampNs: isIdentityValuePresent(e.nativeFrameTimestampNs) ? e.nativeFrameTimestampNs : null,
          contourType: ct,
          annotationStatus: c.traceabilityStatus || CONTOUR_PENDING_STATUS,
          points: (c.points || []).map(function (p) { return { x: p.x, y: p.y }; }), // raw human order, never resampled
          coordinateSpace: CONTOUR_COORDINATE_SPACE,
          imageWidth: isFiniteNum(rec.imageWidth) ? rec.imageWidth : null,
          imageHeight: isFiniteNum(rec.imageHeight) ? rec.imageHeight : null,
          sourceMethod: MANUAL_GROUND_TRUTH,
          notes: c.notes ? String(c.notes) : null,
          // BI-2F0A.4: BLIND-GT revision lineage. revisionNumber is 1 for an original,
          // never-revised annotation. locked/lockedFingerprint describe THIS instance's own lock
          // state (null fingerprint if this revision is still editable/unlocked).
          // basedOnFingerprint/basedOnRevision identify the exact locked record this instance was
          // revised FROM (null for an original). priorRevisionFingerprints lists every earlier
          // locked record's fingerprint for this contour, oldest first -- none of them are ever
          // overwritten or removed by creating a new revision.
          revisionNumber: isFiniteNum(c.revisionNumber) ? c.revisionNumber : 1,
          locked: c.locked === true,
          lockedFingerprint: (c.locked && c.lockedRecord) ? c.lockedRecord.fingerprint : null,
          basedOnFingerprint: c.basedOnFingerprint != null ? c.basedOnFingerprint : null,
          basedOnRevision: isFiniteNum(c.basedOnRevision) ? c.basedOnRevision : null,
          priorRevisionFingerprints: (c.priorRevisions || []).map(function (r) { return r.fingerprint; })
          // NO rawImagePayload / base64 / dataUrl
        });
      });
    });
    return {
      contourWorkbenchVersion: CONTOUR_WORKBENCH_VERSION,
      exportedAt: options.exportedAt || null,
      bundleFingerprint: bundleFingerprint(bundle),
      bundleId: bundle.bundleId || null,
      datasetId: bundle.datasetId || null,
      datasetRevision: bundle.datasetRevision == null ? null : bundle.datasetRevision,
      sourceMethod: MANUAL_GROUND_TRUTH,
      summary: summary,
      contours: contours
    };
  }
  function validateContourExport(exportObj, bundle) {
    var errors = [];
    if (!exportObj || !Array.isArray(exportObj.contours)) return { ok: false, errors: ['export has no contours array'] };
    if (exportObj.bundleFingerprint !== bundleFingerprint(bundle)) errors.push('bundleFingerprint mismatch');
    var byKey = {};
    (bundle.entries || []).forEach(function (e) { byKey[entryKey(e)] = e; });
    var seenIds = {};
    exportObj.contours.forEach(function (c, i) {
      if (isSealedHoldoutEntry(c)) errors.push('contour ' + i + ' references the SEALED HOLDOUT — must never appear in a development export');
      if (c.contourId != null) {
        if (seenIds[c.contourId]) errors.push('contour ' + i + ' duplicate contourId "' + c.contourId + '" — composite identity must be unique');
        seenIds[c.contourId] = true;
      }
      if (CONTOUR_TYPES.indexOf(c.contourType) === -1) errors.push('contour ' + i + ' unrecognized contourType "' + c.contourType + '"');
      if (TRACEABILITY_STATUSES.indexOf(c.annotationStatus) === -1) {
        // BI-1Y CORRECTION (Part 4): a still-pending contour must block export with a clear,
        // specific message -- not the generic "invalid" wording used for a truly malformed value.
        errors.push(c.annotationStatus === CONTOUR_PENDING_STATUS
          ? 'contour ' + i + ' (' + (c.contourType || '?') + ') is UNSET — no explicit human decision (TRACED / NOT_TRACEABLE / UNKNOWN) has been made yet; all requested contours must be decided before export'
          : 'contour ' + i + ' invalid annotationStatus "' + c.annotationStatus + '"');
      }
      if (c.coordinateSpace !== CONTOUR_COORDINATE_SPACE) errors.push('contour ' + i + ' unknown coordinateSpace "' + c.coordinateSpace + '"');
      if (!isIdentityValuePresent(c.nativeFrameTimestampNs)) errors.push('contour ' + i + ' missing nativeFrameTimestampNs');
      var mode = IDENTITY_MODES.indexOf(c.identityMode) !== -1 ? c.identityMode : 'ADAPTER_RETAINED_OBSERVATION';
      var lookupKey = mode === 'RAW_SCAN_OBSERVATION'
        ? ('raw:' + c.scanSessionId + ':' + c.nativeFrameTimestampNs + ':' + c.rawObservationId)
        : (c.sourceScanObservationId != null ? String(c.sourceScanObservationId) : null);
      var e = lookupKey != null ? byKey[lookupKey] : null;
      if (!e) { errors.push('contour ' + i + ' references unknown observation'); return; }
      if (c.imageRef !== e.imageRef) errors.push('contour ' + i + ' imageRef mismatch');
      if (mode === 'RAW_SCAN_OBSERVATION' && c.sourceScanObservationId != null) errors.push('contour ' + i + ' RAW_SCAN_OBSERVATION must not carry a synthesized sourceScanObservationId');
      if (c.annotationStatus === 'TRACED') {
        if (!Array.isArray(c.points) || c.points.length < MIN_CONTOUR_POINTS) errors.push('contour ' + i + ' TRACED but has fewer than ' + MIN_CONTOUR_POINTS + ' points');
        if (!isFiniteNum(c.imageWidth) || !isFiniteNum(c.imageHeight)) errors.push('contour ' + i + ' TRACED but missing image dimensions needed to reproduce exact pixel coordinates');
        (c.points || []).forEach(function (p, j) {
          if (!p || !isFiniteNum(p.x) || !isFiniteNum(p.y)) { errors.push('contour ' + i + ' point ' + j + ' is not a finite coordinate'); return; }
          if (isFiniteNum(c.imageWidth) && (p.x < 0 || p.x > c.imageWidth)) errors.push('contour ' + i + ' point ' + j + ' x out of bounds');
          if (isFiniteNum(c.imageHeight) && (p.y < 0 || p.y > c.imageHeight)) errors.push('contour ' + i + ' point ' + j + ' y out of bounds');
        });
      } else if (Array.isArray(c.points) && c.points.length > 0) {
        errors.push('contour ' + i + ' ' + c.annotationStatus + ' must not carry coordinates');
      }
      if (/base64|data:image|rawImage/i.test(JSON.stringify(c))) errors.push('contour ' + i + ' contains image payload');
    });
    return { ok: errors.length === 0, errors: errors };
  }

  // ---- BI-1Y2 — assisted (machine-proposed, human-verified) beard-boundary review ----------
  // MACHINE PROPOSES -> USER REVIEWS -> USER DRAGS/CORRECTS -> USER APPROVES. A proposal is
  // NEVER GroundTruth by itself (see ASSISTED_REVIEW_STATUSES below); only an explicit human
  // APPROVED_AS_IS or EDITED_AND_APPROVED decision becomes HUMAN_VERIFIED_ASSISTED_GROUND_TRUTH.
  // Wholly additive: does not touch WORKBENCH_VERSION, CONTOUR_WORKBENCH_VERSION, or any
  // categorical/BI-1Y function above -- a BI-1W or BI-1Y bundle/export/autosave is byte-for-byte
  // unaffected by everything below.
  var ASSISTED_REVIEW_WORKBENCH_VERSION = 'annotation-workbench-assisted-review/1';
  // The BI-1Y2 bake-off (visual, on the 5 real development images) found the naive per-type
  // open-edge derivation unreliable, while a single closed visible-beard silhouette tracked the
  // real image evidence well across the same 5 images -- so the review PRIMITIVE is one
  // silhouette per image, not three independent open lines. This is a NEW, distinct vocabulary
  // (never reinterpreted as the OUTER_BEARD_* open-edge keys, per the prior audit's instruction).
  // BI-1Z1A adds a second, narrower target: lower-face beard mass only (chin / under-chin /
  // under-jaw / outer lower-beard envelope) -- NOT a full-face silhouette. The original
  // VISIBLE_BEARD_SILHOUETTE target is untouched and still valid for any bundle that requests it.
  var ASSISTED_REVIEW_TARGETS = Object.freeze(['VISIBLE_BEARD_SILHOUETTE', 'VISIBLE_LOWER_BEARD_SILHOUETTE']);
  // BI-1Y2 CORRECTION-BY-DESIGN (applying the BI-1Y UNSET lesson from day one): an unreviewed
  // proposal is a fourth, non-final state, deliberately excluded from the four real human
  // decisions below -- never confused with any of them, never a default "answer".
  var REVIEW_PENDING_STATUS = 'UNREVIEWED';
  var HUMAN_REVIEW_STATUSES = Object.freeze(['APPROVED_AS_IS', 'EDITED_AND_APPROVED', 'REJECTED', 'NOT_TRACEABLE']);
  var ASSISTED_GROUND_TRUTH_SOURCE_METHOD = 'HUMAN_VERIFIED_ASSISTED_GROUND_TRUTH';
  // Only these two decisions ever become GroundTruth (Part "GROUND TRUTH RULE"). REJECTED /
  // NOT_TRACEABLE are still recorded (audit trail, never silently discarded) but are marked
  // isGroundTruth:false in every export row.
  var GROUND_TRUTH_REVIEW_STATUSES = Object.freeze(['APPROVED_AS_IS', 'EDITED_AND_APPROVED']);
  var MIN_SILHOUETTE_POINTS = 3; // a closed region needs at least a triangle

  function defaultReviewInstance() {
    return {
      proposalAlgorithm: null, proposalAlgorithmVersion: null, proposalParameters: null,
      proposalGeneratedAt: null,
      originalProposalPoints: null, // dense traced ring -- immutable, kept for provenance/never edited
      originalHandlePoints: null,   // the editable starting handle set -- immutable, used by Reset
      humanFinalPoints: [],         // what the human currently sees/edits; [] until a proposal attaches
      humanReviewStatus: REVIEW_PENDING_STATUS,
      // BI-1Y3 (Part 10) CAUTION -- preserved verbatim for backward provenance only: editCount and
      // pointsMoved increment once per pointermove event fired during a drag (hundreds per
      // gesture), NOT once per human correction or per point touched. Never interpret them as
      // "number of corrections". See dragGestureCount/etc. below for the corrected metrics.
      editCount: 0, pointsMoved: 0, pointsAdded: 0, pointsDeleted: 0,
      // BI-1Y3 (Part 10) — cleaner, gesture-level telemetry for FUTURE sessions. Populated only by
      // recordDragGesture, called ONCE per completed drag (on release), never per pointermove.
      // Deliberately left at these zero/empty defaults (never fabricated) for any instance whose
      // edits predate this fix -- see the BI-1Y3 report before trusting a zero here as meaningful.
      dragGestureCount: 0, distinctHandlesMoved: [], netVertexDisplacementPx: 0, totalVertexDisplacementPx: 0,
      // BI-1Z1A (Part 13) -- provenance of what fed the search-region PRIOR for this proposal, and
      // whether any OLD BI-1Y human trace coordinate ever informed it. null until a proposal is
      // attached; never inferred/backfilled for older instances that predate this field.
      proposalPriorSource: null, machineProposalMode: null, oldHumanSpatialHintUsed: null,
      notes: '',
      history: [], // internal-only undo stack of prior humanFinalPoints snapshots
      // BI-2F0 additions (backward compatible -- an older restored instance simply lacks these;
      // every reader below treats a missing redoStack/locked/lockedRecord as [] / false / null,
      // never as an error).
      redoStack: [], locked: false, lockedRecord: null,
      // BI-2F0A.4 additions (backward compatible, same semantics as the contour instance's
      // identically-named fields -- see defaultContourInstance).
      revisionNumber: 1, basedOnFingerprint: null, basedOnRevision: null, priorRevisions: []
    };
  }
  function initAssistedReviewState(bundle) {
    var byEntry = {};
    (bundle.entries || []).forEach(function (e) {
      var targets = {};
      (e.assistedReviewTargets || []).forEach(function (t) { targets[t] = defaultReviewInstance(); });
      byEntry[entryKey(e)] = { imageWidth: null, imageHeight: null, targets: targets };
    });
    return { assistedReviewWorkbenchVersion: ASSISTED_REVIEW_WORKBENCH_VERSION, fingerprint: bundleFingerprint(bundle), byEntry: byEntry, position: 0 };
  }
  function reviewEntryRecord(state, obsId) { return (state.byEntry && state.byEntry[obsId]) || { imageWidth: null, imageHeight: null, targets: {} }; }
  function reviewInstance(state, obsId, target) {
    var rec = reviewEntryRecord(state, obsId);
    return rec.targets[target] || defaultReviewInstance();
  }
  function cloneState(state) { return JSON.parse(JSON.stringify(state)); }
  function ensureInstance(next, obsId, target) {
    var rec = next.byEntry[obsId] || (next.byEntry[obsId] = { imageWidth: null, imageHeight: null, targets: {} });
    return rec.targets[target] || (rec.targets[target] = defaultReviewInstance());
  }
  // BI-1Y3 CORRECTION (Issue 1 root cause): the assisted-review record previously had NO field
  // to hold the real decoded image dimensions at all -- buildAssistedReviewExport was reading
  // e.imageWidth/e.imageHeight (the BUNDLE ENTRY's declared metadata, which BI-1W/BI-1Y/BI-1Y2
  // bundles never populate) instead of the dimensions the browser actually decoded during
  // proposal generation. This mirrors setContourImageDimensions's existing, already-correct
  // pattern for the BI-1Y contour tool exactly. Captured once per entry (shared by every review
  // target on that image), from the real <img>.naturalWidth/naturalHeight, never CSS size.
  function setReviewImageDimensions(state, obsId, imageWidth, imageHeight) {
    var next = cloneState(state);
    var rec = next.byEntry[obsId] || (next.byEntry[obsId] = { imageWidth: null, imageHeight: null, targets: {} });
    if (isFiniteNum(imageWidth)) rec.imageWidth = imageWidth;
    if (isFiniteNum(imageHeight)) rec.imageHeight = imageHeight;
    return next;
  }
  function pushHistory(inst) {
    if (!Array.isArray(inst.history)) inst.history = []; // backward compat: older restored instance
    inst.history.push(JSON.parse(JSON.stringify(inst.humanFinalPoints)));
    if (inst.history.length > 50) inst.history.shift();
    inst.redoStack = []; // BI-2F0: any fresh forward edit invalidates the old redo future
  }

  /** MACHINE PROPOSES. Attaches a freshly-generated proposal to one review instance. Never a
   *  review decision by itself -- humanReviewStatus stays UNREVIEWED. Overwrites any PRIOR
   *  proposal/edits for this instance (used only when (re)generating before any human review has
   *  started; the caller is responsible for not calling this after review has begun). */
  function attachProposal(state, obsId, target, spec) {
    if (ASSISTED_REVIEW_TARGETS.indexOf(target) === -1) throw new Error('attachProposal: invalid target "' + target + '"');
    if (!spec || !Array.isArray(spec.originalProposalPoints) || !Array.isArray(spec.handlePoints)) {
      throw new Error('attachProposal: spec.originalProposalPoints and spec.handlePoints are required');
    }
    var next = cloneState(state);
    var inst = ensureInstance(next, obsId, target);
    inst.proposalAlgorithm = spec.algorithm || null;
    inst.proposalAlgorithmVersion = spec.algorithmVersion || null;
    inst.proposalParameters = spec.parameters || null;
    inst.proposalGeneratedAt = spec.generatedAt || null;
    inst.originalProposalPoints = spec.originalProposalPoints.map(function (p) { return { x: p.x, y: p.y }; });
    inst.originalHandlePoints = spec.handlePoints.map(function (p) { return { x: p.x, y: p.y }; });
    inst.humanFinalPoints = spec.handlePoints.map(function (p) { return { x: p.x, y: p.y }; });
    inst.humanReviewStatus = REVIEW_PENDING_STATUS;
    inst.editCount = 0; inst.pointsMoved = 0; inst.pointsAdded = 0; inst.pointsDeleted = 0;
    // BI-1Z1A (Part 13) -- recorded verbatim from the caller, never inferred. A caller that omits
    // these (e.g. the original BI-1Y2 human-trace-hint path) leaves them null, never defaulted to
    // a value that would misrepresent an old-style proposal as landmark-guided.
    inst.proposalPriorSource = spec.proposalPriorSource || null;
    inst.machineProposalMode = spec.machineProposalMode || null;
    inst.oldHumanSpatialHintUsed = (typeof spec.oldHumanSpatialHintUsed === 'boolean') ? spec.oldHumanSpatialHintUsed : null;
    inst.history = [];
    return next;
  }

  // ---- USER DRAGS / CORRECTS -- every mutation pushes undo history and marks the instance dirty
  function moveHandlePoint(state, obsId, target, index, x, y) {
    assertReviewTargetNotLocked(state, obsId, target);
    if (!isFiniteNum(x) || !isFiniteNum(y)) throw new Error('moveHandlePoint: x/y must be finite');
    var next = cloneState(state);
    var inst = ensureInstance(next, obsId, target);
    if (index < 0 || index >= inst.humanFinalPoints.length) throw new Error('moveHandlePoint: index out of range');
    pushHistory(inst);
    inst.humanFinalPoints[index] = { x: x, y: y };
    inst.editCount++; inst.pointsMoved++;
    return next;
  }
  /** Nudges one handle by a fixed pixel delta (Part "PRECISION CORRECTION": Arrow=1 IMAGE px,
   *  Shift+Arrow=5 IMAGE px). Pure delta application -- the caller supplies dx/dy already scaled. */
  function nudgeHandlePoint(state, obsId, target, index, dx, dy) {
    var inst = reviewInstance(state, obsId, target);
    if (index < 0 || index >= inst.humanFinalPoints.length) throw new Error('nudgeHandlePoint: index out of range');
    var p = inst.humanFinalPoints[index];
    return moveHandlePoint(state, obsId, target, index, p.x + dx, p.y + dy);
  }
  /** BI-1Y3 (Part 10) — the corrected, gesture-level telemetry. Call this ONCE per completed drag
   *  (on pointerup), never per pointermove -- the caller (UI) is responsible for accumulating
   *  totalPathPx across the gesture's own pointermove events and computing netDisplacementPx as
   *  the straight-line distance between the gesture's start and end position. Does NOT touch
   *  humanFinalPoints/editCount/pointsMoved -- purely additive bookkeeping alongside them. */
  function recordDragGesture(state, obsId, target, handleIndex, totalPathPx, netDisplacementPx) {
    if (!isFiniteNum(totalPathPx) || !isFiniteNum(netDisplacementPx)) throw new Error('recordDragGesture: totalPathPx/netDisplacementPx must be finite');
    var next = cloneState(state);
    var inst = ensureInstance(next, obsId, target);
    inst.dragGestureCount = (inst.dragGestureCount || 0) + 1;
    if (!Array.isArray(inst.distinctHandlesMoved)) inst.distinctHandlesMoved = [];
    if (inst.distinctHandlesMoved.indexOf(handleIndex) === -1) inst.distinctHandlesMoved.push(handleIndex);
    inst.totalVertexDisplacementPx = (inst.totalVertexDisplacementPx || 0) + totalPathPx;
    inst.netVertexDisplacementPx = (inst.netVertexDisplacementPx || 0) + netDisplacementPx;
    return next;
  }
  function addHandlePoint(state, obsId, target, afterIndex, x, y) {
    assertReviewTargetNotLocked(state, obsId, target);
    if (!isFiniteNum(x) || !isFiniteNum(y)) throw new Error('addHandlePoint: x/y must be finite');
    var next = cloneState(state);
    var inst = ensureInstance(next, obsId, target);
    if (afterIndex < -1 || afterIndex >= inst.humanFinalPoints.length) throw new Error('addHandlePoint: afterIndex out of range');
    pushHistory(inst);
    inst.humanFinalPoints.splice(afterIndex + 1, 0, { x: x, y: y });
    inst.editCount++; inst.pointsAdded++;
    return next;
  }
  function deleteHandlePoint(state, obsId, target, index) {
    assertReviewTargetNotLocked(state, obsId, target);
    var next = cloneState(state);
    var inst = ensureInstance(next, obsId, target);
    if (index < 0 || index >= inst.humanFinalPoints.length) throw new Error('deleteHandlePoint: index out of range');
    if (inst.humanFinalPoints.length <= MIN_SILHOUETTE_POINTS) {
      throw new Error('deleteHandlePoint: a silhouette needs at least ' + MIN_SILHOUETTE_POINTS + ' points');
    }
    pushHistory(inst);
    inst.humanFinalPoints.splice(index, 1);
    inst.editCount++; inst.pointsDeleted++;
    return next;
  }
  function undoLastEdit(state, obsId, target) {
    assertReviewTargetNotLocked(state, obsId, target);
    var next = cloneState(state);
    var inst = ensureInstance(next, obsId, target);
    if (!inst.history.length) return next; // nothing to undo -- safe no-op
    if (!Array.isArray(inst.redoStack)) inst.redoStack = [];
    inst.redoStack.push(JSON.parse(JSON.stringify(inst.humanFinalPoints))); // BI-2F0: enables redoLastEdit
    inst.humanFinalPoints = inst.history.pop();
    return next;
  }
  /** RESET TO MACHINE PROPOSAL -- restores the exact original handle set and clears all edit
   *  counters/history. The immutable originalProposalPoints/originalHandlePoints themselves are
   *  never touched by this or any other function -- provenance is always recoverable. */
  function resetToProposal(state, obsId, target) {
    assertReviewTargetNotLocked(state, obsId, target);
    var next = cloneState(state);
    var inst = ensureInstance(next, obsId, target);
    if (!inst.originalHandlePoints) throw new Error('resetToProposal: no proposal attached for this instance');
    inst.humanFinalPoints = inst.originalHandlePoints.map(function (p) { return { x: p.x, y: p.y }; });
    inst.editCount = 0; inst.pointsMoved = 0; inst.pointsAdded = 0; inst.pointsDeleted = 0;
    inst.history = [];
    inst.humanReviewStatus = REVIEW_PENDING_STATUS;
    return next;
  }
  // ---- BI-2F0 Part 7: REDO (undo's mirror image). Symmetric with undoLastEdit -- pops the most
  // recent redo entry (pushed by undoLastEdit below) and restores it, moving the just-undone
  // state onto a redo stack so a fresh edit anywhere can invalidate it naturally (see
  // pushHistory's caller sites, which are untouched: any NEW edit still clears history the same
  // way it always has via ensureInstance/cloneState -- redoStack is cleared explicitly there too).
  function redoLastEdit(state, obsId, target) {
    assertReviewTargetNotLocked(state, obsId, target);
    var next = cloneState(state);
    var inst = ensureInstance(next, obsId, target);
    if (!inst.redoStack || !inst.redoStack.length) return next; // nothing to redo -- safe no-op
    inst.history.push(JSON.parse(JSON.stringify(inst.humanFinalPoints)));
    inst.humanFinalPoints = inst.redoStack.pop();
    return next;
  }
  // ---- BI-2F0 Part 16 fix: dragging previously called moveHandlePoint (which pushes history) on
  // EVERY pointermove -- hundreds of undo entries per gesture. This variant updates the point
  // WITHOUT touching history/redo at all; the UI calls beginDragTransaction ONCE at drag-start
  // (captures the pre-drag position) and this on every subsequent pointermove, so one completed
  // drag = exactly one undo entry (Part 7).
  function beginDragTransaction(state, obsId, target) {
    assertReviewTargetNotLocked(state, obsId, target);
    var next = cloneState(state);
    var inst = ensureInstance(next, obsId, target);
    pushHistory(inst);
    inst.redoStack = []; // a fresh edit invalidates any old redo future
    return next;
  }
  function moveHandlePointNoHistory(state, obsId, target, index, x, y) {
    assertReviewTargetNotLocked(state, obsId, target);
    if (!isFiniteNum(x) || !isFiniteNum(y)) throw new Error('moveHandlePointNoHistory: x/y must be finite');
    var next = cloneState(state);
    var inst = ensureInstance(next, obsId, target);
    if (index < 0 || index >= inst.humanFinalPoints.length) throw new Error('moveHandlePointNoHistory: index out of range');
    inst.humanFinalPoints[index] = { x: x, y: y };
    return next;
  }
  // ---- BI-2F0 Part 13: a genuinely BLANK reset for the active target only (distinct from
  // resetToProposal, which restores the machine's own suggestion). Never touches any other
  // target, image, or namespace.
  function resetCurrentReviewTarget(state, obsId, target) {
    assertReviewTargetNotLocked(state, obsId, target);
    var next = cloneState(state);
    var inst = ensureInstance(next, obsId, target);
    inst.humanFinalPoints = [];
    inst.editCount = 0; inst.pointsMoved = 0; inst.pointsAdded = 0; inst.pointsDeleted = 0;
    inst.history = []; inst.redoStack = [];
    inst.humanReviewStatus = REVIEW_PENDING_STATUS;
    inst.locked = false; inst.lockedRecord = null;
    return next;
  }
  // ---- BI-2F0 Part 20/21: BLIND-GT LOCK. Locking freezes the CURRENT humanFinalPoints into an
  // immutable lockedRecord (via precision-annotation-core's lockBlindAnnotation) and flips
  // inst.locked -- every mutating function above must be called only after the UI has checked
  // `!inst.locked` (index.html's own guard); this data layer additionally refuses here so a
  // future comparison/review tool that calls these functions directly cannot silently mutate a
  // locked answer either.
  function lockReviewTarget(state, obsId, target, precisionCore, meta) {
    var next = cloneState(state);
    var inst = ensureInstance(next, obsId, target);
    if (inst.locked) throw new Error('lockReviewTarget: already locked -- create a new revision instead of re-locking');
    var lockMeta = Object.assign({ entryKey: obsId, target: target, revision: isFiniteNum(inst.revisionNumber) ? inst.revisionNumber : 1 }, meta || {});
    var record = precisionCore.lockBlindAnnotation(inst.humanFinalPoints, 'CLOSED_POLYGON', lockMeta);
    if (inst.basedOnFingerprint != null) {
      record = Object.freeze(Object.assign({}, record, { basedOnFingerprint: inst.basedOnFingerprint, basedOnRevision: inst.basedOnRevision }));
    }
    inst.lockedRecord = record;
    inst.locked = true;
    return next;
  }
  function assertReviewTargetNotLocked(state, obsId, target) {
    var inst = reviewInstance(state, obsId, target);
    if (inst.locked) throw new Error('this target is LOCKED (blind GT) -- create a new revision rather than editing the locked original');
  }
  /** BI-2F0A.4: review-target counterpart to createContourRevision -- see that function's comment
   *  for the full invariant explanation. The original locked record is archived, never mutated. */
  function createReviewRevision(state, obsId, target, precisionCore, meta) {
    var next = cloneState(state);
    var rec = next.byEntry[obsId]; if (!rec) throw new Error('createReviewRevision: no record for this entry');
    var inst = rec.targets && rec.targets[target]; if (!inst) throw new Error('createReviewRevision: no review instance for this target');
    if (!inst.locked || !inst.lockedRecord) throw new Error('createReviewRevision: source review target is not locked -- nothing to revise');
    var lockedSrc = inst.lockedRecord;
    var priorRevisions = (inst.priorRevisions || []).concat([lockedSrc]);
    rec.targets[target] = Object.assign({}, defaultReviewInstance(), {
      proposalAlgorithm: inst.proposalAlgorithm, proposalAlgorithmVersion: inst.proposalAlgorithmVersion,
      proposalParameters: inst.proposalParameters, proposalGeneratedAt: inst.proposalGeneratedAt,
      originalProposalPoints: inst.originalProposalPoints, originalHandlePoints: inst.originalHandlePoints,
      humanFinalPoints: lockedSrc.points.map(function (p) { return { x: p.x, y: p.y }; }),
      humanReviewStatus: REVIEW_PENDING_STATUS,
      proposalPriorSource: inst.proposalPriorSource || null, machineProposalMode: inst.machineProposalMode || null,
      oldHumanSpatialHintUsed: (typeof inst.oldHumanSpatialHintUsed === 'boolean') ? inst.oldHumanSpatialHintUsed : null,
      notes: inst.notes ? String(inst.notes) : '',
      revisionNumber: lockedSrc.revision + 1,
      basedOnFingerprint: lockedSrc.fingerprint,
      basedOnRevision: lockedSrc.revision,
      priorRevisions: priorRevisions
    });
    return next;
  }
  function setReviewNotes(state, obsId, target, notes) {
    var next = cloneState(state);
    var inst = ensureInstance(next, obsId, target);
    inst.notes = notes == null ? '' : String(notes);
    return next;
  }

  /** USER APPROVES (or rejects). The one function that actually records a human decision.
   *  APPROVED_AS_IS requires the human to have made ZERO edits (editCount===0) -- if they touched
   *  a point, the honest status is EDITED_AND_APPROVED, never silently reclassified for them.
   *  REJECTED / NOT_TRACEABLE clear humanFinalPoints (Part "GROUND TRUTH RULE": neither is ever
   *  GroundTruth, and neither legitimately carries a final boundary). */
  function setReviewStatus(state, obsId, target, status) {
    if (HUMAN_REVIEW_STATUSES.indexOf(status) === -1) throw new Error('setReviewStatus: invalid status "' + status + '"');
    var next = cloneState(state);
    var inst = ensureInstance(next, obsId, target);
    if (status === 'APPROVED_AS_IS' && inst.editCount > 0) {
      throw new Error('setReviewStatus: this instance has been edited (editCount=' + inst.editCount + ') -- use EDITED_AND_APPROVED, never silently reclassify a human edit as untouched');
    }
    if (status === 'EDITED_AND_APPROVED' && (!inst.humanFinalPoints || inst.humanFinalPoints.length < MIN_SILHOUETTE_POINTS)) {
      throw new Error('setReviewStatus: EDITED_AND_APPROVED needs at least ' + MIN_SILHOUETTE_POINTS + ' points');
    }
    if (status === 'REJECTED' || status === 'NOT_TRACEABLE') inst.humanFinalPoints = [];
    inst.humanReviewStatus = status;
    return next;
  }

  function reviewNavigate(state, delta, total) {
    var next = cloneState(state);
    var p = next.position + delta;
    next.position = p < 0 ? 0 : (p > total - 1 ? total - 1 : p);
    return next;
  }
  function reviewProgressCounts(bundle, state) {
    var entries = bundle.entries || [];
    var requested = 0, unreviewed = 0, approvedAsIs = 0, editedApproved = 0, rejected = 0, notTraceable = 0;
    entries.forEach(function (e) {
      var rec = reviewEntryRecord(state, entryKey(e));
      (e.assistedReviewTargets || []).forEach(function (t) {
        requested++;
        var inst = rec.targets[t] || defaultReviewInstance();
        if (inst.humanReviewStatus === 'APPROVED_AS_IS') approvedAsIs++;
        else if (inst.humanReviewStatus === 'EDITED_AND_APPROVED') editedApproved++;
        else if (inst.humanReviewStatus === 'REJECTED') rejected++;
        else if (inst.humanReviewStatus === 'NOT_TRACEABLE') notTraceable++;
        else unreviewed++;
      });
    });
    return {
      targetsRequested: requested, unreviewed: unreviewed, approvedAsIs: approvedAsIs,
      editedApproved: editedApproved, rejected: rejected, notTraceable: notTraceable,
      decided: approvedAsIs + editedApproved + rejected + notTraceable
    };
  }

  // ---- assisted-review autosave (SEPARATE namespace -- never touches BI-1W or BI-1Y autosave) --
  function buildAssistedReviewAutosavePayload(bundle, state) {
    return {
      assistedReviewWorkbenchVersion: ASSISTED_REVIEW_WORKBENCH_VERSION,
      savedAt: null,
      bundleFingerprint: bundleFingerprint(bundle),
      bundleIdentity: {
        schemaVersion: bundle.schemaVersion, bundleId: bundle.bundleId || null,
        datasetId: bundle.datasetId || null, datasetRevision: bundle.datasetRevision == null ? null : bundle.datasetRevision,
        entryIds: (bundle.entries || []).map(function (e) { return entryKey(e); })
      },
      review: JSON.parse(JSON.stringify(state.byEntry)),
      position: state.position
      // rawImagePayload is intentionally absent, exactly like the other two autosave payloads
    };
  }
  function restoreAssistedReviewFromAutosave(autosave, bundle) {
    if (!autosave || typeof autosave !== 'object') return { ok: false, reason: 'NO_AUTOSAVE', state: null, dropped: [] };
    var fp = bundleFingerprint(bundle);
    if (autosave.bundleFingerprint !== fp) return { ok: false, reason: 'FINGERPRINT_MISMATCH', state: null, dropped: [] };
    var fresh = initAssistedReviewState(bundle);
    var dropped = [];
    var saved = autosave.review || {};
    Object.keys(saved).forEach(function (obsId) {
      if (!fresh.byEntry[obsId]) { dropped.push(obsId); return; }
      var st = saved[obsId] || {}; var targets = st.targets || {};
      if (isFiniteNum(st.imageWidth)) fresh.byEntry[obsId].imageWidth = st.imageWidth;
      if (isFiniteNum(st.imageHeight)) fresh.byEntry[obsId].imageHeight = st.imageHeight;
      Object.keys(targets).forEach(function (t) {
        if (!fresh.byEntry[obsId].targets[t]) { dropped.push(obsId + '/' + t); return; }
        var inst = targets[t] || {};
        // BI-2F0A.4: see restoreContourFromAutosave's identical comment -- a BLIND-GT lock must
        // survive reload; fails closed to unlocked on any structurally implausible saved record.
        var validLockedRecord = (inst.locked === true && inst.lockedRecord && typeof inst.lockedRecord === 'object'
          && typeof inst.lockedRecord.fingerprint === 'string' && Array.isArray(inst.lockedRecord.points)) ? inst.lockedRecord : null;
        var status = (HUMAN_REVIEW_STATUSES.indexOf(inst.humanReviewStatus) !== -1 || inst.humanReviewStatus === REVIEW_PENDING_STATUS)
          ? inst.humanReviewStatus : REVIEW_PENDING_STATUS; // fail closed to pending, never to a real decision
        var pts = validLockedRecord
          ? validLockedRecord.points.map(function (p) { return { x: p.x, y: p.y }; })
          : (Array.isArray(inst.humanFinalPoints) ? inst.humanFinalPoints.filter(function (p) { return p && isFiniteNum(p.x) && isFiniteNum(p.y); }).map(function (p) { return { x: p.x, y: p.y }; }) : []);
        if (status === 'EDITED_AND_APPROVED' && pts.length < MIN_SILHOUETTE_POINTS && !validLockedRecord) status = REVIEW_PENDING_STATUS;
        if ((status === 'REJECTED' || status === 'NOT_TRACEABLE') && !validLockedRecord) pts = [];
        fresh.byEntry[obsId].targets[t] = {
          proposalAlgorithm: inst.proposalAlgorithm || null,
          proposalAlgorithmVersion: inst.proposalAlgorithmVersion || null,
          proposalParameters: inst.proposalParameters || null,
          proposalGeneratedAt: inst.proposalGeneratedAt || null,
          originalProposalPoints: Array.isArray(inst.originalProposalPoints) ? inst.originalProposalPoints.map(function (p) { return { x: p.x, y: p.y }; }) : null,
          originalHandlePoints: Array.isArray(inst.originalHandlePoints) ? inst.originalHandlePoints.map(function (p) { return { x: p.x, y: p.y }; }) : null,
          humanFinalPoints: pts,
          humanReviewStatus: status,
          editCount: isFiniteNum(inst.editCount) ? inst.editCount : 0,
          pointsMoved: isFiniteNum(inst.pointsMoved) ? inst.pointsMoved : 0,
          pointsAdded: isFiniteNum(inst.pointsAdded) ? inst.pointsAdded : 0,
          pointsDeleted: isFiniteNum(inst.pointsDeleted) ? inst.pointsDeleted : 0,
          dragGestureCount: isFiniteNum(inst.dragGestureCount) ? inst.dragGestureCount : 0,
          distinctHandlesMoved: Array.isArray(inst.distinctHandlesMoved) ? inst.distinctHandlesMoved.slice() : [],
          netVertexDisplacementPx: isFiniteNum(inst.netVertexDisplacementPx) ? inst.netVertexDisplacementPx : 0,
          totalVertexDisplacementPx: isFiniteNum(inst.totalVertexDisplacementPx) ? inst.totalVertexDisplacementPx : 0,
          notes: inst.notes == null ? '' : String(inst.notes),
          history: [], redoStack: [], // undo/redo history is intentionally NOT persisted across reloads
          locked: !!validLockedRecord,
          lockedRecord: validLockedRecord ? Object.freeze(JSON.parse(JSON.stringify(validLockedRecord))) : null,
          revisionNumber: isFiniteNum(inst.revisionNumber) ? inst.revisionNumber : 1,
          basedOnFingerprint: inst.basedOnFingerprint != null ? inst.basedOnFingerprint : null,
          basedOnRevision: isFiniteNum(inst.basedOnRevision) ? inst.basedOnRevision : null,
          priorRevisions: Array.isArray(inst.priorRevisions)
            ? inst.priorRevisions.filter(function (r) { return r && typeof r.fingerprint === 'string' && Array.isArray(r.points); })
              .map(function (r) { return Object.freeze(JSON.parse(JSON.stringify(r))); })
            : []
        };
      });
    });
    fresh.position = isFiniteNum(autosave.position) ? Math.max(0, Math.min(autosave.position, (bundle.entries || []).length - 1)) : 0;
    return { ok: true, reason: null, state: fresh, dropped: dropped };
  }

  // ---- assisted-review export (additive; NEVER overloads BI-1Y contour or BI-1W categorical) --
  function buildAssistedReviewExport(bundle, state, options) {
    options = options || {};
    var items = [];
    var summary = { approvedAsIs: 0, editedApproved: 0, rejected: 0, notTraceable: 0, unreviewed: 0 };
    (bundle.entries || []).forEach(function (e) {
      var key = entryKey(e);
      var mode = identityModeOf(e);
      var rec = reviewEntryRecord(state, key);
      (e.assistedReviewTargets || []).forEach(function (target) {
        var inst = rec.targets[target] || defaultReviewInstance();
        var status = inst.humanReviewStatus || REVIEW_PENDING_STATUS;
        if (status === 'APPROVED_AS_IS') summary.approvedAsIs++;
        else if (status === 'EDITED_AND_APPROVED') summary.editedApproved++;
        else if (status === 'REJECTED') summary.rejected++;
        else if (status === 'NOT_TRACEABLE') summary.notTraceable++;
        else summary.unreviewed++;
        items.push({
          reviewItemId: key + ':' + target,
          identityMode: mode,
          scanSessionId: e.scanSessionId || null,
          sourceScanObservationId: e.sourceScanObservationId != null ? e.sourceScanObservationId : null,
          rawObservationId: e.rawObservationId != null ? e.rawObservationId : null,
          adapterRetained: e.adapterRetained === true,
          observedPoseRegion: e.observedPoseRegion || null,
          imageRef: e.imageRef,
          nativeFrameTimestampNs: isIdentityValuePresent(e.nativeFrameTimestampNs) ? e.nativeFrameTimestampNs : null,
          reviewTarget: target,
          coordinateSpace: CONTOUR_COORDINATE_SPACE,
          // BI-1Y3 fix: prefer the REAL decoded dimensions captured during proposal generation
          // (rec.imageWidth/imageHeight); e.imageWidth/imageHeight (bundle-declared metadata) is
          // only a fallback for a hypothetical future bundle that does populate it truthfully.
          imageWidth: isFiniteNum(rec.imageWidth) ? rec.imageWidth : (isFiniteNum(e.imageWidth) ? e.imageWidth : null),
          imageHeight: isFiniteNum(rec.imageHeight) ? rec.imageHeight : (isFiniteNum(e.imageHeight) ? e.imageHeight : null),
          proposalAlgorithm: inst.proposalAlgorithm,
          proposalAlgorithmVersion: inst.proposalAlgorithmVersion,
          proposalParameters: inst.proposalParameters,
          proposalGeneratedAt: inst.proposalGeneratedAt,
          originalProposalPoints: inst.originalProposalPoints, // full dense machine proposal, untouched
          humanFinalPoints: (inst.humanFinalPoints || []).map(function (p) { return { x: p.x, y: p.y }; }),
          humanReviewStatus: status,
          // CAUTION (BI-1Y3 Part 10): editCount/pointsMoved count raw pointermove events per
          // drag, NOT human corrections -- see dragGestureCount/etc. below for the honest metric.
          editCount: inst.editCount || 0, pointsMoved: inst.pointsMoved || 0,
          pointsAdded: inst.pointsAdded || 0, pointsDeleted: inst.pointsDeleted || 0,
          dragGestureCount: inst.dragGestureCount || 0,
          distinctHandlesMovedCount: Array.isArray(inst.distinctHandlesMoved) ? inst.distinctHandlesMoved.length : 0,
          netVertexDisplacementPx: inst.netVertexDisplacementPx || 0,
          totalVertexDisplacementPx: inst.totalVertexDisplacementPx || 0,
          isGroundTruth: GROUND_TRUTH_REVIEW_STATUSES.indexOf(status) !== -1,
          sourceMethod: ASSISTED_GROUND_TRUTH_SOURCE_METHOD,
          // BI-1Z1A (Part 13) -- provenance of the search-region prior that fed this proposal.
          // null for anything generated before this field existed; never backfilled/guessed.
          proposalPriorSource: inst.proposalPriorSource || null,
          machineProposalMode: inst.machineProposalMode || null,
          oldHumanSpatialHintUsed: (typeof inst.oldHumanSpatialHintUsed === 'boolean') ? inst.oldHumanSpatialHintUsed : null,
          notes: inst.notes ? String(inst.notes) : null,
          // BI-2F0A.4: BLIND-GT revision lineage -- see buildContourExport's identical fields for
          // the full explanation.
          revisionNumber: isFiniteNum(inst.revisionNumber) ? inst.revisionNumber : 1,
          locked: inst.locked === true,
          lockedFingerprint: (inst.locked && inst.lockedRecord) ? inst.lockedRecord.fingerprint : null,
          basedOnFingerprint: inst.basedOnFingerprint != null ? inst.basedOnFingerprint : null,
          basedOnRevision: isFiniteNum(inst.basedOnRevision) ? inst.basedOnRevision : null,
          priorRevisionFingerprints: (inst.priorRevisions || []).map(function (r) { return r.fingerprint; })
          // NO rawImagePayload / base64 / dataUrl
        });
      });
    });
    return {
      assistedReviewWorkbenchVersion: ASSISTED_REVIEW_WORKBENCH_VERSION,
      exportedAt: options.exportedAt || null,
      bundleFingerprint: bundleFingerprint(bundle),
      bundleId: bundle.bundleId || null, datasetId: bundle.datasetId || null,
      datasetRevision: bundle.datasetRevision == null ? null : bundle.datasetRevision,
      sourceMethod: ASSISTED_GROUND_TRUTH_SOURCE_METHOD,
      summary: summary,
      items: items
    };
  }
  function validateAssistedReviewExport(exportObj, bundle) {
    var errors = [];
    if (!exportObj || !Array.isArray(exportObj.items)) return { ok: false, errors: ['export has no items array'] };
    if (exportObj.bundleFingerprint !== bundleFingerprint(bundle)) errors.push('bundleFingerprint mismatch');
    var byKey = {};
    (bundle.entries || []).forEach(function (e) { byKey[entryKey(e)] = e; });
    var seenIds = {};
    exportObj.items.forEach(function (it, i) {
      if (isSealedHoldoutEntry(it)) errors.push('item ' + i + ' references the SEALED HOLDOUT — must never appear in a development export');
      if (it.reviewItemId != null) {
        if (seenIds[it.reviewItemId]) errors.push('item ' + i + ' duplicate reviewItemId "' + it.reviewItemId + '"');
        seenIds[it.reviewItemId] = true;
      }
      if (ASSISTED_REVIEW_TARGETS.indexOf(it.reviewTarget) === -1) errors.push('item ' + i + ' unrecognized reviewTarget "' + it.reviewTarget + '"');
      if (it.coordinateSpace !== CONTOUR_COORDINATE_SPACE) errors.push('item ' + i + ' unknown coordinateSpace "' + it.coordinateSpace + '"');
      if (!isIdentityValuePresent(it.nativeFrameTimestampNs)) errors.push('item ' + i + ' missing nativeFrameTimestampNs');
      var mode = IDENTITY_MODES.indexOf(it.identityMode) !== -1 ? it.identityMode : 'ADAPTER_RETAINED_OBSERVATION';
      var lookupKey = mode === 'RAW_SCAN_OBSERVATION'
        ? ('raw:' + it.scanSessionId + ':' + it.nativeFrameTimestampNs + ':' + it.rawObservationId)
        : (it.sourceScanObservationId != null ? String(it.sourceScanObservationId) : null);
      var e = lookupKey != null ? byKey[lookupKey] : null;
      if (!e) { errors.push('item ' + i + ' references unknown observation'); return; }
      if (it.imageRef !== e.imageRef) errors.push('item ' + i + ' imageRef mismatch');
      if (mode === 'RAW_SCAN_OBSERVATION' && it.sourceScanObservationId != null) errors.push('item ' + i + ' RAW_SCAN_OBSERVATION must not carry a synthesized sourceScanObservationId');
      if (HUMAN_REVIEW_STATUSES.indexOf(it.humanReviewStatus) === -1) {
        errors.push(it.humanReviewStatus === REVIEW_PENDING_STATUS
          ? 'item ' + i + ' (' + (it.reviewTarget || '?') + ') is UNREVIEWED — no human decision has been made yet; every requested item must be reviewed before export'
          : 'item ' + i + ' invalid humanReviewStatus "' + it.humanReviewStatus + '"');
        return;
      }
      var shouldBeGT = GROUND_TRUTH_REVIEW_STATUSES.indexOf(it.humanReviewStatus) !== -1;
      if (it.isGroundTruth !== shouldBeGT) errors.push('item ' + i + ' isGroundTruth flag does not match its humanReviewStatus');
      if (shouldBeGT) {
        if (!Array.isArray(it.humanFinalPoints) || it.humanFinalPoints.length < MIN_SILHOUETTE_POINTS) {
          errors.push('item ' + i + ' ' + it.humanReviewStatus + ' but has fewer than ' + MIN_SILHOUETTE_POINTS + ' points');
        }
        // BI-1Y3 (Issue 1): IMAGE-coordinate GroundTruth is not self-describing without its own
        // real pixel dimensions -- fail closed rather than silently exporting geometry nobody can
        // correctly reproduce later.
        if (!isFiniteNum(it.imageWidth) || !isFiniteNum(it.imageHeight) || it.imageWidth <= 0 || it.imageHeight <= 0) {
          errors.push('item ' + i + ' ' + it.humanReviewStatus + ' but missing valid positive imageWidth/imageHeight -- IMAGE-coordinate GroundTruth must be self-describing');
        }
        (it.humanFinalPoints || []).forEach(function (p, j) {
          if (!p || !isFiniteNum(p.x) || !isFiniteNum(p.y)) { errors.push('item ' + i + ' point ' + j + ' is not a finite coordinate'); return; }
          if (isFiniteNum(it.imageWidth) && (p.x < 0 || p.x > it.imageWidth)) errors.push('item ' + i + ' point ' + j + ' x out of bounds');
          if (isFiniteNum(it.imageHeight) && (p.y < 0 || p.y > it.imageHeight)) errors.push('item ' + i + ' point ' + j + ' y out of bounds');
        });
      } else if (Array.isArray(it.humanFinalPoints) && it.humanFinalPoints.length > 0) {
        errors.push('item ' + i + ' ' + it.humanReviewStatus + ' must not carry final boundary coordinates');
      }
      if (it.proposalAlgorithm == null) errors.push('item ' + i + ' missing proposalAlgorithm provenance');
      if (/base64|data:image|rawImage/i.test(JSON.stringify(it))) errors.push('item ' + i + ' contains image payload');
    });
    return { ok: errors.length === 0, errors: errors };
  }

  return {
    WORKBENCH_VERSION: WORKBENCH_VERSION,
    ANNOTATION_BUNDLE_VERSION: ANNOTATION_BUNDLE_VERSION,
    HAIR_STATES: HAIR_STATES,
    SURFACE_OBSERVABILITY_STATES: SURFACE_OBSERVABILITY_STATES,
    IDENTITY_MODES: IDENTITY_MODES,
    ANNOTATION_STATUSES: ANNOTATION_STATUSES,
    SCAN_POSES: SCAN_POSES,
    SYNC_STATES: SYNC_STATES,
    HAIR_STATE_DISPLAY: HAIR_STATE_DISPLAY,
    SURFACE_OBSERVABILITY_DISPLAY: SURFACE_OBSERVABILITY_DISPLAY,
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
    REGION_TIERS: REGION_TIERS,
    regionVisualReference: regionVisualReference,
    LABELABILITY_TIERS: LABELABILITY_TIERS,
    LABELABLE_HAIR_STATES: LABELABLE_HAIR_STATES,
    regionLabelability: regionLabelability,
    regionAllowedHairStates: regionAllowedHairStates,
    DUAL_CHANNEL_REGIONS: DUAL_CHANNEL_REGIONS,
    regionRequiresSurfaceObservability: regionRequiresSurfaceObservability,
    regionAllowedSurfaceStates: regionAllowedSurfaceStates,
    regionLabelAdvisory: regionLabelAdvisory,
    identityModeOf: identityModeOf,
    entryKey: entryKey,
    buildAutosavePayload: buildAutosavePayload,
    restoreFromAutosave: restoreFromAutosave,
    buildExport: buildExport,
    validateExport: validateExport,
    groundTruthLabelsForBS1F: groundTruthLabelsForBS1F,

    // ---- BI-1Y outer-beard contour ground truth (additive) ----
    CONTOUR_WORKBENCH_VERSION: CONTOUR_WORKBENCH_VERSION,
    CONTOUR_COORDINATE_SPACE: CONTOUR_COORDINATE_SPACE,
    CONTOUR_TYPES: CONTOUR_TYPES,
    CONTOUR_TYPE_DISPLAY: CONTOUR_TYPE_DISPLAY,
    CONTOUR_TYPE_DEFINITIONS: CONTOUR_TYPE_DEFINITIONS,
    TRACEABILITY_STATUSES: TRACEABILITY_STATUSES,
    CONTOUR_PENDING_STATUS: CONTOUR_PENDING_STATUS,
    MIN_CONTOUR_POINTS: MIN_CONTOUR_POINTS,
    SEALED_HOLDOUT_IDENTITIES: SEALED_HOLDOUT_IDENTITIES,
    isSealedHoldoutEntry: isSealedHoldoutEntry,
    validateContourBundle: validateContourBundle,
    defaultContourInstance: defaultContourInstance,
    initContourState: initContourState,
    contourEntryRecord: contourEntryRecord,
    setContourImageDimensions: setContourImageDimensions,
    addContourPoint: addContourPoint,
    undoLastContourPoint: undoLastContourPoint,
    redoLastContourPoint: redoLastContourPoint,
    insertContourPoint: insertContourPoint,
    moveContourPoint: moveContourPoint,
    moveContourPointNoHistory: moveContourPointNoHistory,
    beginContourDragTransaction: beginContourDragTransaction,
    nudgeContourPoint: nudgeContourPoint,
    deleteContourPointAt: deleteContourPointAt,
    lockContour: lockContour,
    createContourRevision: createContourRevision,
    assertContourNotLocked: assertContourNotLocked,
    clearContour: clearContour,
    setContourNotes: setContourNotes,
    setContourTraceabilityStatus: setContourTraceabilityStatus,
    contourNavigate: contourNavigate,
    contourProgressCounts: contourProgressCounts,
    displayClickToImagePoint: displayClickToImagePoint,
    imagePointToDisplayPoint: imagePointToDisplayPoint,
    buildContourAutosavePayload: buildContourAutosavePayload,
    restoreContourFromAutosave: restoreContourFromAutosave,
    buildContourExport: buildContourExport,
    validateContourExport: validateContourExport,

    // ---- BI-1Y2 assisted review (additive) ----
    ASSISTED_REVIEW_WORKBENCH_VERSION: ASSISTED_REVIEW_WORKBENCH_VERSION,
    ASSISTED_REVIEW_TARGETS: ASSISTED_REVIEW_TARGETS,
    REVIEW_PENDING_STATUS: REVIEW_PENDING_STATUS,
    HUMAN_REVIEW_STATUSES: HUMAN_REVIEW_STATUSES,
    GROUND_TRUTH_REVIEW_STATUSES: GROUND_TRUTH_REVIEW_STATUSES,
    ASSISTED_GROUND_TRUTH_SOURCE_METHOD: ASSISTED_GROUND_TRUTH_SOURCE_METHOD,
    MIN_SILHOUETTE_POINTS: MIN_SILHOUETTE_POINTS,
    defaultReviewInstance: defaultReviewInstance,
    initAssistedReviewState: initAssistedReviewState,
    reviewEntryRecord: reviewEntryRecord,
    reviewInstance: reviewInstance,
    setReviewImageDimensions: setReviewImageDimensions,
    attachProposal: attachProposal,
    moveHandlePoint: moveHandlePoint,
    nudgeHandlePoint: nudgeHandlePoint,
    recordDragGesture: recordDragGesture,
    addHandlePoint: addHandlePoint,
    deleteHandlePoint: deleteHandlePoint,
    undoLastEdit: undoLastEdit,
    redoLastEdit: redoLastEdit,
    beginDragTransaction: beginDragTransaction,
    moveHandlePointNoHistory: moveHandlePointNoHistory,
    resetCurrentReviewTarget: resetCurrentReviewTarget,
    lockReviewTarget: lockReviewTarget,
    createReviewRevision: createReviewRevision,
    assertReviewTargetNotLocked: assertReviewTargetNotLocked,
    resetToProposal: resetToProposal,
    setReviewNotes: setReviewNotes,
    setReviewStatus: setReviewStatus,
    reviewNavigate: reviewNavigate,
    reviewProgressCounts: reviewProgressCounts,
    buildAssistedReviewAutosavePayload: buildAssistedReviewAutosavePayload,
    restoreAssistedReviewFromAutosave: restoreAssistedReviewFromAutosave,
    buildAssistedReviewExport: buildAssistedReviewExport,
    validateAssistedReviewExport: validateAssistedReviewExport
  };
});
