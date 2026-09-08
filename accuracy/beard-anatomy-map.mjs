// Beard anatomy map — MediaPipe landmark indices → BS1-A AnatomicalRegion
// Stage BS1-C. Pure data module. Zero dependencies beyond the BS1-A vocabulary.
//
// PURPOSE
//   A conservative, evidence-backed mapping from the landmark index groups that ALREADY
//   exist in index.html to BS1-A anatomical regions. It is used only by the BS1-C
//   projection adapter; it is not wired into the app.
//
// RULES (Stage BS1-C Part 8 / Part 9)
//   - Every mapping cites a verified existing source (index.html constant + line).
//   - No MediaPipe index set is invented to fill a region. Regions with no verified
//     evidence are listed as UNSUPPORTED with a reason and receive NO observation.
//   - Under-jaw / neck / sideburn / upper-cheek / moustache-proper regions are UNSUPPORTED:
//     the only "neck" geometry in source (drawDerivedNeck / derivedThroatPointFromDisplay)
//     is a synthesised 2D display point from a `throatDrop` heuristic — not a tracked
//     landmark, not 3D — so it must not become a fabricated canonical-3D location.
//
// VERIFIED SOURCE GROUPS (index.html)
//   ANATOMY_LANDMARKS (~:2309): midline 8, jawAngleLeft 172, jawAngleRight 397,
//     chinAdjacentLeft 148, chinAdjacentRight 377, chinTip 152, cheekLeft 234,
//     cheekRight 454, mouthBottom 17, mouthRail [61,146,91,181,84,17,314,405,321,375,291].
//   PERSON_ANATOMY_SIDES (~:2296): personLeft {jawAngle 397, chinAdjacent 377, cheek 454};
//     personRight {jawAngle 172, chinAdjacent 148, cheek 234}.  (MP index 397 is the
//     person's LEFT jaw angle; 172 is the person's RIGHT — the map uses the anatomical side.)
//   LOWER_FACE_DIAGNOSTIC_SETS (:2787): jawChinRail [172,136,150,149,176,148,152,377,400,
//     378,379,365,397]; cheekRailA [234,116,123,205,186]; cheekRailB [454,345,352,425,410];
//     center [8]; mouthReference [61,146,91,181,84,17,314,405,321,375,291];
//     templateAxis [1,10,58,93,132,288,361,323].
//   LOWER_JAW (:1964): [234,93,132,58,172,136,150,149,176,148,152,377,400,378,379,365,397,
//     288,361,323,454].
//   CROSS_POSE_LOWER_FACE_LANDMARK_SET (:2904): union of the diagnostic sets above — the set
//     computeCrossPoseLowerFace3D() actually fuses in face-local 3D.

import { AnatomicalRegion, REGION_META } from './beard-surface-core.mjs';

export const ANATOMY_MAP_VERSION = 'beard-anatomy-map/1';

/** Mapping confidence tiers (Stage BS1-C Part 8). */
export const MappingConfidence = Object.freeze({
  VERIFIED_DIRECT: 'VERIFIED_DIRECT',
  VERIFIED_PARTIAL: 'VERIFIED_PARTIAL',
  UNSUPPORTED: 'UNSUPPORTED'
});

const D = MappingConfidence.VERIFIED_DIRECT;
const P = MappingConfidence.VERIFIED_PARTIAL;
const U = MappingConfidence.UNSUPPORTED;

/**
 * Full evidence table for EVERY BS1-A core region. `landmarkIndices` / `primaryIndex` are
 * present only for DIRECT / PARTIAL entries. `evidenceSource` names the verified origin;
 * `reason` explains an UNSUPPORTED verdict.
 */
export const MAPPING_EVIDENCE = Object.freeze({
  CHIN_CENTER: {
    confidence: D,
    primaryIndex: 152,
    landmarkIndices: [176, 148, 152, 377, 400],
    evidenceSource: 'ANATOMY_LANDMARKS.chinTip=152; LOWER_FACE_DIAGNOSTIC_SETS.jawChinRail centre members'
  },
  CHIN_LEFT: {
    confidence: D,
    primaryIndex: 377,
    landmarkIndices: [377, 400, 378],
    evidenceSource: "PERSON_ANATOMY_SIDES.personLeft.chinAdjacent=377; jawChinRail left arm"
  },
  CHIN_RIGHT: {
    confidence: D,
    primaryIndex: 148,
    landmarkIndices: [148, 176, 149],
    evidenceSource: "PERSON_ANATOMY_SIDES.personRight.chinAdjacent=148; jawChinRail right arm"
  },
  LEFT_JAW: {
    confidence: D,
    primaryIndex: 397,
    landmarkIndices: [377, 365, 379, 378, 400, 397],
    evidenceSource: "PERSON_ANATOMY_SIDES.personLeft.jawAngle=397; jawChinRail left arm; LOWER_JAW"
  },
  RIGHT_JAW: {
    confidence: D,
    primaryIndex: 172,
    landmarkIndices: [172, 136, 150, 149, 176],
    evidenceSource: "PERSON_ANATOMY_SIDES.personRight.jawAngle=172; jawChinRail right arm; LOWER_JAW"
  },
  LEFT_LOWER_CHEEK: {
    confidence: P,
    primaryIndex: 454,
    landmarkIndices: [454, 345, 352, 425, 410],
    evidenceSource: 'PERSON_ANATOMY_SIDES.personLeft.cheek=454; LOWER_FACE_DIAGNOSTIC_SETS.cheekRailB',
    note: 'cheekRailB is a mid/low cheek rail; source does not separate upper vs lower cheek'
  },
  RIGHT_LOWER_CHEEK: {
    confidence: P,
    primaryIndex: 234,
    landmarkIndices: [234, 116, 123, 205, 186],
    evidenceSource: 'PERSON_ANATOMY_SIDES.personRight.cheek=234; LOWER_FACE_DIAGNOSTIC_SETS.cheekRailA',
    note: 'cheekRailA is a mid/low cheek rail; source does not separate upper vs lower cheek'
  },
  MOUSTACHE_CENTER: {
    confidence: P,
    primaryIndex: 17,
    landmarkIndices: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
    evidenceSource: 'LOWER_FACE_DIAGNOSTIC_SETS.mouthReference / ANATOMY_LANDMARKS.mouthRail',
    note: 'this is the LOWER-lip reference contour — a mouth reference line only, not the upper-lip moustache surface'
  },

  // ---- UNSUPPORTED (no verified landmark evidence in current source) ----
  LEFT_SIDEBURN: { confidence: U, reason: 'no source set labels a sideburn region; profile/templateAxis indices near the ear are not sideburn-specific' },
  RIGHT_SIDEBURN: { confidence: U, reason: 'no source set labels a sideburn region' },
  LEFT_UPPER_CHEEK: { confidence: U, reason: 'cheek rails in source are mid/low cheek only; no upper-cheek set exists' },
  RIGHT_UPPER_CHEEK: { confidence: U, reason: 'cheek rails in source are mid/low cheek only; no upper-cheek set exists' },
  MOUSTACHE_LEFT: { confidence: U, reason: 'no upper-lip / philtrum landmark set exists in source' },
  MOUSTACHE_RIGHT: { confidence: U, reason: 'no upper-lip / philtrum landmark set exists in source' },
  SOUL_PATCH: { confidence: U, reason: 'no between-lip-and-chin landmark set exists in source' },
  UNDER_CHIN: { confidence: U, reason: 'only derivedThroatPointFromDisplay() exists — a synthesised 2D display point from a throatDrop heuristic, not a tracked 3D landmark' },
  UNDER_JAW_LEFT: { confidence: U, reason: 'no tracked under-jaw landmark; would fabricate 3D from a front-face point' },
  UNDER_JAW_CENTER: { confidence: U, reason: 'no tracked under-jaw landmark; throat point is a projection heuristic' },
  UNDER_JAW_RIGHT: { confidence: U, reason: 'no tracked under-jaw landmark; would fabricate 3D from a front-face point' },
  NECK_FRONT: { confidence: U, reason: 'drawDerivedNeck() is 2D display drawing from a heuristic; no tracked neck landmarks, no 3D' },
  NECK_LEFT: { confidence: U, reason: 'no tracked neck landmarks in source' },
  NECK_RIGHT: { confidence: U, reason: 'no tracked neck landmarks in source' },
  CHIN_NECK_TRANSITION: { confidence: U, reason: 'derived throat/neck geometry is a 2D projection heuristic, not tracked 3D' }
});

/** Regions with a usable (DIRECT or PARTIAL) landmark mapping. */
export const SUPPORTED_REGIONS = Object.freeze(
  Object.keys(MAPPING_EVIDENCE).filter(r => MAPPING_EVIDENCE[r].confidence !== U)
);

/** Core BS1-A regions with no verified evidence — they receive no observation in BS1-C. */
export const UNSUPPORTED_REGIONS = Object.freeze(
  Object.keys(MAPPING_EVIDENCE).filter(r => MAPPING_EVIDENCE[r].confidence === U)
);

/**
 * The active map: region -> { primaryIndex, landmarkIndices, confidence, side }.
 * Only supported regions appear. Frozen.
 */
export const BEARD_ANATOMY_MAP = Object.freeze(
  Object.fromEntries(SUPPORTED_REGIONS.map(r => {
    const e = MAPPING_EVIDENCE[r];
    return [r, Object.freeze({
      region: AnatomicalRegion[r],
      primaryIndex: e.primaryIndex,
      landmarkIndices: Object.freeze([...e.landmarkIndices]),
      confidence: e.confidence,
      side: REGION_META[r].side,
      evidenceSource: e.evidenceSource
    })];
  }))
);

export function isRegionSupported(region) {
  return Object.prototype.hasOwnProperty.call(BEARD_ANATOMY_MAP, region);
}
export function anatomyMapEntry(region) {
  return BEARD_ANATOMY_MAP[region] || null;
}
/** Every distinct MediaPipe index referenced by the active map. */
export const MAPPED_LANDMARK_INDICES = Object.freeze(
  [...new Set(SUPPORTED_REGIONS.flatMap(r => MAPPING_EVIDENCE[r].landmarkIndices))].sort((a, b) => a - b)
);

/** Deterministic evidence rows for diagnostics / the projection bundle. */
export function mappingEvidenceRows() {
  return Object.keys(MAPPING_EVIDENCE).sort().map(r => {
    const e = MAPPING_EVIDENCE[r];
    return Object.freeze({
      region: r,
      confidence: e.confidence,
      primaryIndex: e.primaryIndex ?? null,
      landmarkIndices: e.landmarkIndices ? Object.freeze([...e.landmarkIndices]) : Object.freeze([]),
      evidenceSource: e.evidenceSource ?? null,
      reason: e.reason ?? null,
      note: e.note ?? null
    });
  });
}
