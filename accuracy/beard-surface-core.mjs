// Personalized Beard Surface — CORE MODEL / FUSION CONTRACT
// Stage BS1-A. Pure ES module. Node-testable. Zero dependencies.
//
// WHAT THIS IS
//   A compact, pure data model + deterministic fusion primitives for Mettle's future
//   "Personalized Beard Surface": a per-user representation of lower-face anatomy, where
//   facial hair actually is, where the beard boundaries are, which observations came from
//   scan landmarks vs. semantic segmentation, how confident each region is, which regions
//   are supported from multiple scan angles, and — explicitly — what is still unknown.
//
// WHAT THIS IS NOT (Stage BS1-A scope guards)
//   - It does NOT solve beard segmentation. There is no model, no mask, no inference here.
//   - It does NOT perform 3D reconstruction, spline fitting, or invent hidden-surface geometry.
//   - It is NOT wired into anything. index.html never imports this file; the Cloudflare
//     worker only bundles *.html. Scanner capture, Live Map, registeredPointMapper,
//     guardSequence, the A6.0/A6.0A/A6.0B spatial-observation capture, T1, CAM1-A, ARCore,
//     ML Kit, camera selection and the UI are all untouched and unaware of it.
//   - Future stages integrate it only after auditing the real data flow.
//
// LAYER CHOICE
//   Mettle's existing accuracy architecture — computeCrossPoseLowerFace3D(), the
//   anatomyMeasurements / anatomyAgreement / anatomyConfidence chain, POSE_VISIBLE_SIDE_
//   SEMANTICS, and the A6.0* spatial-observation capture — all live in the index.html
//   module script (JavaScript). This foundation follows that system boundary and stays in
//   JS. It reuses that vocabulary (scan pose ids, the "face-local, NOT millimetres" 3D
//   space, deterministic median/MAD summarisation) rather than inventing a parallel one.

export const SCHEMA_VERSION = 'beard-surface-core/1';

// ---------------------------------------------------------------------------
// Scan poses — reused verbatim from index.html A60_POSES.
// ---------------------------------------------------------------------------
export const SCAN_POSES = Object.freeze([
  'front', 'right-45', 'right-profile', 'left-45', 'left-profile', 'chin-up'
]);

// ---------------------------------------------------------------------------
// Coordinate spaces. Every observation and every fused region names its space
// explicitly. The beard surface itself lives in exactly ONE space; adapters
// convert into/out of it in later stages.
// ---------------------------------------------------------------------------
export const CoordinateSpace = Object.freeze({
  // Per-frame normalised landmark coordinates (~0..1), mirror-dependent.
  CAPTURE_NORMALIZED: 'CAPTURE_NORMALIZED',
  // ARCore model-fitted face-local 3D as used by computeCrossPoseLowerFace3D():
  // unitless and internally consistent, explicitly NOT a metric depth scan / NOT millimetres.
  CANONICAL_FACE_LOCAL: 'CANONICAL_FACE_LOCAL',
  // This model's own personalised frame. Identical to CANONICAL_FACE_LOCAL for now;
  // named separately so a future personalised warp does not force a rename.
  PERSONALIZED_SURFACE: 'PERSONALIZED_SURFACE',
  CAMERA_FRAME: 'CAMERA_FRAME',
  LIVE_REGISTERED: 'LIVE_REGISTERED'
});

/** The single canonical space the beard surface is defined in. */
export const BEARD_SURFACE_SPACE = CoordinateSpace.CANONICAL_FACE_LOCAL;

export function isKnownSpace(space) {
  return Object.prototype.hasOwnProperty.call(CoordinateSpace, space) ||
    Object.values(CoordinateSpace).includes(space);
}

/** Throws if observations do not all share one coordinate space. Returns that space. */
export function assertSameSpace(observations, label = 'observations') {
  const spaces = new Set((observations || []).map(o => o && o.space).filter(Boolean));
  if (spaces.size > 1) {
    throw new Error(`${label}: mixed coordinate spaces [${[...spaces].join(', ')}] — refuse to fuse`);
  }
  return spaces.size ? [...spaces][0] : null;
}

// ---------------------------------------------------------------------------
// Anatomical region vocabulary. One system, sufficient for future trim-zone
// mapping. OPTIONAL/FUTURE regions are present so later neck / ear / clavicle /
// shoulder work needs no breaking redesign (Part 12), but they carry future:true
// and are excluded from CORE_REGIONS and from the quality summary denominator.
// ---------------------------------------------------------------------------
export const AnatomicalRegion = Object.freeze({
  LEFT_SIDEBURN: 'LEFT_SIDEBURN',
  RIGHT_SIDEBURN: 'RIGHT_SIDEBURN',
  LEFT_UPPER_CHEEK: 'LEFT_UPPER_CHEEK',
  RIGHT_UPPER_CHEEK: 'RIGHT_UPPER_CHEEK',
  LEFT_LOWER_CHEEK: 'LEFT_LOWER_CHEEK',
  RIGHT_LOWER_CHEEK: 'RIGHT_LOWER_CHEEK',
  MOUSTACHE_LEFT: 'MOUSTACHE_LEFT',
  MOUSTACHE_CENTER: 'MOUSTACHE_CENTER',
  MOUSTACHE_RIGHT: 'MOUSTACHE_RIGHT',
  SOUL_PATCH: 'SOUL_PATCH',
  CHIN_CENTER: 'CHIN_CENTER',
  CHIN_LEFT: 'CHIN_LEFT',
  CHIN_RIGHT: 'CHIN_RIGHT',
  LEFT_JAW: 'LEFT_JAW',
  RIGHT_JAW: 'RIGHT_JAW',
  UNDER_CHIN: 'UNDER_CHIN',
  UNDER_JAW_LEFT: 'UNDER_JAW_LEFT',
  UNDER_JAW_CENTER: 'UNDER_JAW_CENTER',
  UNDER_JAW_RIGHT: 'UNDER_JAW_RIGHT',
  NECK_FRONT: 'NECK_FRONT',
  NECK_LEFT: 'NECK_LEFT',
  NECK_RIGHT: 'NECK_RIGHT',
  CHIN_NECK_TRANSITION: 'CHIN_NECK_TRANSITION',
  // OPTIONAL / FUTURE — reserved anchors only.
  LEFT_EAR_CONTEXT: 'LEFT_EAR_CONTEXT',
  RIGHT_EAR_CONTEXT: 'RIGHT_EAR_CONTEXT',
  LEFT_CLAVICLE_CONTEXT: 'LEFT_CLAVICLE_CONTEXT',
  RIGHT_CLAVICLE_CONTEXT: 'RIGHT_CLAVICLE_CONTEXT',
  UPPER_SHOULDER_CONTEXT: 'UPPER_SHOULDER_CONTEXT'
});

const F = (side, group, future = false) => Object.freeze({ side, group, future });
export const REGION_META = Object.freeze({
  LEFT_SIDEBURN: F('left', 'sideburn'),
  RIGHT_SIDEBURN: F('right', 'sideburn'),
  LEFT_UPPER_CHEEK: F('left', 'cheek'),
  RIGHT_UPPER_CHEEK: F('right', 'cheek'),
  LEFT_LOWER_CHEEK: F('left', 'cheek'),
  RIGHT_LOWER_CHEEK: F('right', 'cheek'),
  MOUSTACHE_LEFT: F('left', 'moustache'),
  MOUSTACHE_CENTER: F('center', 'moustache'),
  MOUSTACHE_RIGHT: F('right', 'moustache'),
  SOUL_PATCH: F('center', 'moustache'),
  CHIN_CENTER: F('center', 'chin'),
  CHIN_LEFT: F('left', 'chin'),
  CHIN_RIGHT: F('right', 'chin'),
  LEFT_JAW: F('left', 'jaw'),
  RIGHT_JAW: F('right', 'jaw'),
  UNDER_CHIN: F('center', 'under-jaw'),
  UNDER_JAW_LEFT: F('left', 'under-jaw'),
  UNDER_JAW_CENTER: F('center', 'under-jaw'),
  UNDER_JAW_RIGHT: F('right', 'under-jaw'),
  NECK_FRONT: F('center', 'neck'),
  NECK_LEFT: F('left', 'neck'),
  NECK_RIGHT: F('right', 'neck'),
  CHIN_NECK_TRANSITION: F('center', 'transition'),
  LEFT_EAR_CONTEXT: F('left', 'context', true),
  RIGHT_EAR_CONTEXT: F('right', 'context', true),
  LEFT_CLAVICLE_CONTEXT: F('left', 'context', true),
  RIGHT_CLAVICLE_CONTEXT: F('right', 'context', true),
  UPPER_SHOULDER_CONTEXT: F('center', 'context', true)
});

export const CORE_REGIONS = Object.freeze(
  Object.keys(AnatomicalRegion).filter(r => !REGION_META[r].future)
);
export const FUTURE_REGIONS = Object.freeze(
  Object.keys(AnatomicalRegion).filter(r => REGION_META[r].future)
);

export function isKnownRegion(region) {
  return Object.prototype.hasOwnProperty.call(AnatomicalRegion, region);
}

// ---------------------------------------------------------------------------
// Semantic hair state. UNKNOWN is a first-class value: absence of segmentation
// must NEVER be turned into "no beard".
// ---------------------------------------------------------------------------
export const HairState = Object.freeze({
  BEARD_CONFIRMED: 'BEARD_CONFIRMED',
  NON_BEARD_CONFIRMED: 'NON_BEARD_CONFIRMED',
  BOUNDARY: 'BOUNDARY',
  UNCERTAIN: 'UNCERTAIN',
  UNKNOWN: 'UNKNOWN'
});

// ---------------------------------------------------------------------------
// Observation provenance: which pose, and which method.
// ---------------------------------------------------------------------------
export const ObservationMethod = Object.freeze({
  LANDMARK_GEOMETRY: 'LANDMARK_GEOMETRY',
  SEMANTIC_SEGMENTATION: 'SEMANTIC_SEGMENTATION',
  MANUAL_GROUND_TRUTH: 'MANUAL_GROUND_TRUTH',
  FUSED: 'FUSED'
});

// How a single observation relates to real measured geometry.
export const ObservationKind = Object.freeze({
  DIRECT_GEOMETRY: 'DIRECT_GEOMETRY',
  SEMANTIC_OBSERVATION: 'SEMANTIC_OBSERVATION',
  MULTI_VIEW_FUSED: 'MULTI_VIEW_FUSED',
  INFERRED: 'INFERRED',
  UNKNOWN: 'UNKNOWN'
});

// ---------------------------------------------------------------------------
// Disagreement classification for conflicting observations.
// ---------------------------------------------------------------------------
export const Disagreement = Object.freeze({
  CONSISTENT: 'CONSISTENT',
  LOW_DISAGREEMENT: 'LOW_DISAGREEMENT',
  HIGH_DISAGREEMENT: 'HIGH_DISAGREEMENT',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA'
});

// ---------------------------------------------------------------------------
// Live Map readiness. Never auto-true in this stage.
// ---------------------------------------------------------------------------
export const LiveMapReadiness = Object.freeze({
  NOT_EVALUATED: 'NOT_EVALUATED',
  UNKNOWN: 'UNKNOWN'
});

// ---------------------------------------------------------------------------
// Small deterministic numeric helpers (same pattern as index.html median()/mad()).
// ---------------------------------------------------------------------------
export function median(values) {
  const v = (values || []).filter(x => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
export function mad(values) {
  const v = (values || []).filter(x => Number.isFinite(x));
  if (!v.length) return null;
  const m = median(v);
  return median(v.map(x => Math.abs(x - m)));
}
export function clamp01OrNull(x) {
  if (x == null || !Number.isFinite(x)) return null;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function round4(x) {
  return x == null || !Number.isFinite(x) ? x : Math.round(x * 1e4) / 1e4;
}

// ---------------------------------------------------------------------------
// Confidence model. Explicit components, each bounded to [0,1] or null (unknown).
//
//   critical  : geometryConfidence, registrationConfidence, coverageConfidence
//   booster   : semanticConfidence, multiViewConfidence
//
// combineConfidence() is pure and conservative:
//   combined = min( every PRESENT component, critical or booster )
//   - if requireAllCritical (default) and any critical component is null  -> combined = null
//     (an unknown critical component can never be hidden by a high unrelated score)
//   - if any critical component is 0                                      -> combined = 0
//   - a booster can only pull the result DOWN, never above the weakest critical
// ---------------------------------------------------------------------------
export const CRITICAL_CONFIDENCE_KEYS = Object.freeze([
  'geometryConfidence', 'registrationConfidence', 'coverageConfidence'
]);
export const BOOSTER_CONFIDENCE_KEYS = Object.freeze([
  'semanticConfidence', 'multiViewConfidence'
]);

export function makeConfidence(parts = {}) {
  return Object.freeze({
    geometryConfidence: clamp01OrNull(parts.geometryConfidence),
    semanticConfidence: clamp01OrNull(parts.semanticConfidence),
    multiViewConfidence: clamp01OrNull(parts.multiViewConfidence),
    registrationConfidence: clamp01OrNull(parts.registrationConfidence),
    coverageConfidence: clamp01OrNull(parts.coverageConfidence),
    combinedConfidence: clamp01OrNull(parts.combinedConfidence)
  });
}

export function combineConfidence(components = {}, { requireAllCritical = true } = {}) {
  const criticals = CRITICAL_CONFIDENCE_KEYS.map(k => clamp01OrNull(components[k]));
  if (requireAllCritical && criticals.some(v => v == null)) return null;
  const present = [];
  for (const k of [...CRITICAL_CONFIDENCE_KEYS, ...BOOSTER_CONFIDENCE_KEYS]) {
    const v = clamp01OrNull(components[k]);
    if (v != null) present.push(v);
  }
  if (!present.length) return null;
  return round4(Math.min(...present));
}

// ---------------------------------------------------------------------------
// A single localised observation: one method, usually one pose.
// ---------------------------------------------------------------------------
export function makeSurfaceObservation(spec = {}) {
  const {
    region,
    position = null,
    space = BEARD_SURFACE_SPACE,
    pose = null,
    method = ObservationMethod.LANDMARK_GEOMETRY,
    kind = ObservationKind.DIRECT_GEOMETRY,
    sourceLandmarks = [],
    hairState = HairState.UNKNOWN,
    confidence = null,
    observedAt = null
  } = spec;

  if (!isKnownRegion(region)) throw new Error(`makeSurfaceObservation: unknown region "${region}"`);
  if (!isKnownSpace(space)) throw new Error(`makeSurfaceObservation: unknown coordinate space "${space}"`);
  if (pose != null && !SCAN_POSES.includes(pose)) throw new Error(`makeSurfaceObservation: unknown pose "${pose}"`);
  if (!Object.values(ObservationMethod).includes(method)) throw new Error(`makeSurfaceObservation: unknown method "${method}"`);
  if (!Object.values(ObservationKind).includes(kind)) throw new Error(`makeSurfaceObservation: unknown kind "${kind}"`);
  if (!Object.values(HairState).includes(hairState)) throw new Error(`makeSurfaceObservation: unknown hairState "${hairState}"`);

  let pos = null;
  if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
    pos = Object.freeze({ x: position.x, y: position.y, z: Number.isFinite(position.z) ? position.z : null });
  }

  return Object.freeze({
    region,
    position: pos,
    space,
    pose,
    method,
    kind,
    sourceLandmarks: Object.freeze([...sourceLandmarks]),
    hairState,
    confidence: confidence ? makeConfidence(confidence) : null,
    observedAt
  });
}

// ---------------------------------------------------------------------------
// Pure fusion primitives (Part 9). Deterministic; justifiable without a device.
// No reconstruction, no spline, no invented geometry.
// ---------------------------------------------------------------------------

/** Distinct, recognised scan poses represented in a set of observations. */
export function countIndependentPoses(observations) {
  const s = new Set();
  for (const o of observations || []) {
    if (o && o.pose && SCAN_POSES.includes(o.pose)) s.add(o.pose);
  }
  return s.size;
}

const DIRECT_METHODS = new Set([ObservationMethod.LANDMARK_GEOMETRY, ObservationMethod.MANUAL_GROUND_TRUTH]);
function isDirectObservation(o) {
  return o && o.position != null && o.kind !== ObservationKind.INFERRED && DIRECT_METHODS.has(o.method);
}
function isInferredObservation(o) {
  return o && o.kind === ObservationKind.INFERRED;
}

/**
 * Observation methods that carry a semantic (hair-state) label rather than raw geometry.
 * Both SEMANTIC_SEGMENTATION and MANUAL_GROUND_TRUTH enter the same semantic evidence pool
 * with no weighting or priority — a manual label and a model label are treated alike. Stage
 * BS1-D1 added MANUAL_GROUND_TRUTH here after BS1-D proved it was otherwise inert in
 * fuseRegion / fuseHairState. LANDMARK_GEOMETRY is not semantic; FUSED is deliberately
 * excluded (no existing architecture treats it as a raw semantic producer). A
 * MANUAL_GROUND_TRUTH observation that also carries a position still contributes to the
 * direct/geometry pool via isDirectObservation — such an observation legitimately supplies
 * both a location and a hair state.
 */
export const SEMANTIC_OBSERVATION_METHODS = Object.freeze([
  ObservationMethod.SEMANTIC_SEGMENTATION,
  ObservationMethod.MANUAL_GROUND_TRUTH
]);
export function isSemanticObservationMethod(method) {
  return SEMANTIC_OBSERVATION_METHODS.includes(method);
}
function isSemanticObservation(o) {
  return o && isSemanticObservationMethod(o.method);
}

/**
 * Classify positional agreement. `toleranceNormalized` is supplied by the caller — this
 * stage invents no production threshold, so without a tolerance the result is
 * INSUFFICIENT_DATA even when a spread can be computed.
 */
export function classifyDisagreement(positions, toleranceNormalized) {
  const pts = (positions || []).filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 2) return { level: Disagreement.INSUFFICIENT_DATA, spread: null, count: pts.length, median: null };

  const med = {
    x: median(pts.map(p => p.x)),
    y: median(pts.map(p => p.y)),
    z: median(pts.map(p => (Number.isFinite(p.z) ? p.z : 0)))
  };
  const dev = pts.map(p => Math.hypot(p.x - med.x, p.y - med.y, (Number.isFinite(p.z) ? p.z : 0) - med.z));
  const spread = round4(Math.max(...dev));

  if (toleranceNormalized == null || !Number.isFinite(toleranceNormalized)) {
    return { level: Disagreement.INSUFFICIENT_DATA, spread, count: pts.length, median: med, note: 'no tolerance supplied' };
  }
  let level;
  if (spread <= toleranceNormalized) level = Disagreement.CONSISTENT;
  else if (spread <= 2 * toleranceNormalized) level = Disagreement.LOW_DISAGREEMENT;
  else level = Disagreement.HIGH_DISAGREEMENT;
  return { level, spread, count: pts.length, median: med };
}

/** Fuse semantic hair observations. No semantic data -> UNKNOWN (never NON_BEARD_CONFIRMED). */
export function fuseHairState(observations) {
  const states = (observations || [])
    .filter(isSemanticObservation)
    .map(o => o.hairState)
    .filter(s => s && s !== HairState.UNKNOWN);
  if (!states.length) return HairState.UNKNOWN;
  const uniq = new Set(states);
  if (uniq.size === 1) return states[0];
  if (uniq.has(HairState.BEARD_CONFIRMED) && uniq.has(HairState.NON_BEARD_CONFIRMED)) return HairState.BOUNDARY;
  if (uniq.has(HairState.BOUNDARY)) return HairState.BOUNDARY;
  return HairState.UNCERTAIN;
}

// Reporting heuristics for the quality summary — NOT behavioural gates.
export const GEOMETRY_COVERAGE_FULL_POSES = 2;
export const SEMANTIC_COVERAGE_FULL_OBS = 2;

/**
 * Fuse every observation for ONE region into a single FusedRegion.
 *
 *  - Position comes from the median of DIRECT observations only. INFERRED observations are
 *    used only when NO direct observation exists (direct outranks inferred), and then the
 *    result is flagged usedInferredOnly.
 *  - multiViewSupported is true only when >= 2 DISTINCT scan poses contributed geometry;
 *    a front-only region never becomes multi-view.
 *  - Conflicting observations are preserved: perPose positions are kept and disagreement is
 *    classified, never averaged away.
 *  - hairState is UNKNOWN unless semantic observations say otherwise.
 *  - Provenance (poses, methods, counts) survives on the result.
 */
export function fuseRegion(region, observations, opts = {}) {
  if (!isKnownRegion(region)) throw new Error(`fuseRegion: unknown region "${region}"`);
  const { toleranceNormalized = null } = opts;
  const obs = (observations || []).filter(Boolean);
  assertSameSpace(obs, `fuseRegion(${region})`);

  const direct = obs.filter(isDirectObservation);
  const inferred = obs.filter(isInferredObservation);
  const semantic = obs.filter(isSemanticObservation);

  const directPoses = new Set(direct.map(o => o.pose).filter(p => SCAN_POSES.includes(p)));
  const distinctGeometryPoses = directPoses.size;
  const multiViewSupported = distinctGeometryPoses >= 2;
  const semanticSupported = semantic.length >= 1;

  const usedInferredOnly = direct.length === 0 && inferred.length > 0;
  const positionalSource = direct.length ? direct : (usedInferredOnly ? inferred : []);
  const positions = positionalSource.map(o => o.position).filter(Boolean);

  let fusedPosition = null;
  if (positions.length) {
    fusedPosition = {
      x: round4(median(positions.map(p => p.x))),
      y: round4(median(positions.map(p => p.y))),
      z: round4(median(positions.map(p => (Number.isFinite(p.z) ? p.z : 0))))
    };
  }

  const disagreement = classifyDisagreement(direct.map(o => o.position).filter(Boolean), toleranceNormalized);

  let observationKind;
  if (!obs.length) observationKind = ObservationKind.UNKNOWN;
  else if (multiViewSupported) observationKind = ObservationKind.MULTI_VIEW_FUSED;
  else if (direct.length) observationKind = ObservationKind.DIRECT_GEOMETRY;
  else if (semantic.length) observationKind = ObservationKind.SEMANTIC_OBSERVATION;
  else if (inferred.length) observationKind = ObservationKind.INFERRED;
  else observationKind = ObservationKind.UNKNOWN;

  const geometryCoverage = direct.length
    ? clamp01OrNull(distinctGeometryPoses / GEOMETRY_COVERAGE_FULL_POSES)
    : 0;
  const semanticCoverage = semantic.length
    ? clamp01OrNull(semantic.length / SEMANTIC_COVERAGE_FULL_OBS)
    : null; // null == unknown, NOT zero

  // Component confidences: only where evidence exists, else null (unknown).
  const geometryConfidence = direct.length
    ? clamp01OrNull(
        (disagreement.level === Disagreement.CONSISTENT ? 1
          : disagreement.level === Disagreement.LOW_DISAGREEMENT ? 0.6
          : disagreement.level === Disagreement.HIGH_DISAGREEMENT ? 0.2
          : 0.5) * clamp01OrNull(Math.min(1, direct.length / 2))
      )
    : null;
  const multiViewConfidence = distinctGeometryPoses
    ? clamp01OrNull(Math.min(1, distinctGeometryPoses / SCAN_POSES.length))
    : null;
  const semanticConfidence = semantic.length
    ? clamp01OrNull(fuseHairState(obs) === HairState.UNCERTAIN ? 0.3
        : fuseHairState(obs) === HairState.BOUNDARY ? 0.6
        : fuseHairState(obs) === HairState.UNKNOWN ? null
        : Math.min(1, semantic.length / 2))
    : null;

  const perPose = [...directPoses].sort().map(pose => {
    const forPose = direct.filter(o => o.pose === pose).map(o => o.position).filter(Boolean);
    return {
      pose,
      count: forPose.length,
      position: forPose.length ? {
        x: round4(median(forPose.map(p => p.x))),
        y: round4(median(forPose.map(p => p.y))),
        z: round4(median(forPose.map(p => (Number.isFinite(p.z) ? p.z : 0))))
      } : null
    };
  });

  return Object.freeze({
    region,
    space: obs.length ? (obs[0].space || BEARD_SURFACE_SPACE) : BEARD_SURFACE_SPACE,
    observationKind,
    fusedPosition,
    usedInferredOnly,
    multiViewSupported,
    semanticSupported,
    distinctGeometryPoses,
    hairState: fuseHairState(obs),
    disagreement,
    geometryCoverage: round4(geometryCoverage),
    semanticCoverage: round4(semanticCoverage),
    perPose: Object.freeze(perPose),
    provenance: Object.freeze({
      poses: Object.freeze([...new Set(obs.map(o => o.pose).filter(p => SCAN_POSES.includes(p)))].sort()),
      methods: Object.freeze([...new Set(obs.map(o => o.method))].sort()),
      directCount: direct.length,
      inferredCount: inferred.length,
      semanticCount: semantic.length,
      observationCount: obs.length
    }),
    confidence: makeConfidence({
      geometryConfidence,
      semanticConfidence,
      multiViewConfidence,
      registrationConfidence: null, // supplied by a future registration-aware stage
      coverageConfidence: direct.length ? round4(geometryCoverage) : null,
      combinedConfidence: combineConfidence({
        geometryConfidence,
        semanticConfidence,
        multiViewConfidence,
        registrationConfidence: null,
        coverageConfidence: direct.length ? geometryCoverage : null
      })
    })
  });
}

/** Group loose observations by region (default) and fuse each group. */
export function mergeObservations(observations, opts = {}) {
  const { toleranceNormalized = null, keyOf = (o) => o.region } = opts;
  const groups = new Map();
  for (const o of observations || []) {
    if (!o) continue;
    const k = keyOf(o);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  }
  const out = {};
  for (const [region, group] of groups) out[region] = fuseRegion(region, group, { toleranceNormalized });
  return out;
}

// ---------------------------------------------------------------------------
// PersonalizedBeardSurface container + summary + diagnostics + (de)serialisation.
// ---------------------------------------------------------------------------
export function makeBeardSurface(spec = {}) {
  const {
    identityId = null,
    schemaVersion = SCHEMA_VERSION,
    space = BEARD_SURFACE_SPACE,
    captureMeta = null,
    regions = {},
    liveMapReadiness = LiveMapReadiness.NOT_EVALUATED
  } = spec;

  if (!isKnownSpace(space)) throw new Error(`makeBeardSurface: unknown coordinate space "${space}"`);
  for (const rid of Object.keys(regions)) {
    if (!isKnownRegion(rid)) throw new Error(`makeBeardSurface: unknown region "${rid}"`);
  }

  return Object.freeze({
    identityId,
    schemaVersion,
    space,
    captureMeta: captureMeta ? Object.freeze({ ...captureMeta }) : null,
    regions: Object.freeze({ ...regions }),
    liveMapReadiness
  });
}

/** A valid, empty surface. Reports everything unknown / not-evaluated. */
export function emptyBeardSurface(spec = {}) {
  return makeBeardSurface(spec);
}

/** Build a surface by fusing observations grouped per region. */
export function buildBeardSurface(observations, spec = {}) {
  const { toleranceNormalized = null } = spec;
  return makeBeardSurface({ ...spec, regions: mergeObservations(observations, { toleranceNormalized }) });
}

export function summarizeSurface(surface) {
  let regionsObserved = 0;
  let regionsUnknown = 0;
  let multiViewSupportedRegions = 0;
  let semanticSupportedRegions = 0;
  let highDisagreementRegions = 0;
  let geometryCoverageSum = 0;
  let semanticCoverageSum = 0;
  let semanticCoverageCount = 0;

  for (const rid of CORE_REGIONS) {
    const r = surface.regions[rid];
    if (!r || r.observationKind === ObservationKind.UNKNOWN) {
      regionsUnknown++;
      continue;
    }
    regionsObserved++;
    if (r.multiViewSupported) multiViewSupportedRegions++;
    if (r.semanticSupported) semanticSupportedRegions++;
    if (r.disagreement && r.disagreement.level === Disagreement.HIGH_DISAGREEMENT) highDisagreementRegions++;
    if (Number.isFinite(r.geometryCoverage)) geometryCoverageSum += r.geometryCoverage;
    if (Number.isFinite(r.semanticCoverage)) { semanticCoverageSum += r.semanticCoverage; semanticCoverageCount++; }
  }

  return Object.freeze({
    schemaVersion: surface.schemaVersion,
    space: surface.space,
    coreRegionCount: CORE_REGIONS.length,
    regionsObserved,
    regionsUnknown,
    multiViewSupportedRegions,
    semanticSupportedRegions,
    highDisagreementRegions,
    overallGeometryCoverage: round4(geometryCoverageSum / CORE_REGIONS.length),
    // null == unknown; explicitly NOT 0 when no semantic data exists.
    overallSemanticCoverage: semanticCoverageCount ? round4(semanticCoverageSum / semanticCoverageCount) : null,
    readyForLiveMap: surface.liveMapReadiness || LiveMapReadiness.NOT_EVALUATED
  });
}

/** Concise, deterministic development diagnostic. No per-sample dump, no per-frame logging. */
export function diagnosticString(surface) {
  const s = summarizeSurface(surface);
  return [
    `BeardSurface ${s.schemaVersion}`,
    `space: ${s.space}`,
    `regions: ${s.regionsObserved} observed / ${s.regionsUnknown} unknown (of ${s.coreRegionCount})`,
    `multiView: ${s.multiViewSupportedRegions}`,
    `semantic: ${s.semanticSupportedRegions}`,
    `highDisagreement: ${s.highDisagreementRegions}`,
    `geometryCoverage: ${s.overallGeometryCoverage}`,
    `semanticCoverage: ${s.overallSemanticCoverage == null ? 'unknown' : s.overallSemanticCoverage}`,
    `liveMapReadiness: ${s.readyForLiveMap}`
  ].join('\n');
}

export function serialize(surface) {
  return JSON.parse(JSON.stringify({
    ...surface,
    schemaVersion: surface.schemaVersion || SCHEMA_VERSION
  }));
}

export function deserialize(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('deserialize: not an object');
  if (obj.schemaVersion !== SCHEMA_VERSION) {
    // No migration in this stage — refuse unknown versions loudly rather than guessing.
    throw new Error(`deserialize: unsupported schemaVersion "${obj.schemaVersion}" (expected "${SCHEMA_VERSION}")`);
  }
  return makeBeardSurface(obj);
}
