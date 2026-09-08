// Optional annotation-overlay-data contract — PURE, ISOLATED
// Stage BS1-H2. Zero dependencies beyond one sibling accuracy/ import. No I/O, no network, no model.
//
// WHY THIS EXISTS (Stage BS1-H2 audit — OUTCOME B)
//   A BS1-G AnnotationBundle v1 entry carries NO landmark coordinates: `buildAnnotationManifest`
//   (BS1-F) emits only `imageRef` (a string handle), `imageWidth/Height`, pose angles and
//   `supportedGeometryRegions` (region NAME strings); `buildAnnotationBundle` (BS1-G) adds only
//   `landmarkCount` (an integer) and an optional resolver-supplied `intrinsics`. There is no
//   `landmarks2D`, no landmark index list, no `faceLocal3D`, no transform matrix. A truthful
//   image-space overlay therefore cannot be drawn from a v1 bundle.
//
//   Rather than fabricate points, BS1-H2 defines this SMALL, OPTIONAL, VERSIONED side contract
//   that a FUTURE BS1-I resolver/export stage can populate from the exact keyframe. It carries
//   ONLY a sparse set of VERIFIED image-space landmark points (indices traceable to existing
//   index.html constants). AnnotationBundle v1 stays byte-for-byte backwards compatible: an
//   entry either carries an `overlayData` object of this schema, or it does not.
//
// HARD RULES
//   - Every rendered index is a member of an existing verified source constant (see GROUP_SOURCES).
//     No landmark number is invented here.
//   - No under-jaw / neck / chin-to-neck / sideburn / upper-cheek / moustache-proper geometry.
//     The index.html derived throat point (derivedThroatPointFromDisplay / drawDerivedNeck) is a
//     2D display heuristic and is EXPLICITLY excluded — it is never a tracked overlay point.
//   - Coordinates are raw-image-space pixels ('IMAGE'), the SAME system as the keyframe JPEG,
//     BEFORE any rotation/mirror display transform. CAPTURE_NORMALIZED input is refused, never
//     reinterpreted as pixels.
//   - This contract is anatomical reference only. It carries NO hair state / beard / boundary /
//     neckline field, and validation refuses any such key.

import { UNSUPPORTED_REGIONS } from './beard-anatomy-map.mjs';

export const ANNOTATION_OVERLAY_DATA_VERSION = 'annotation-overlay-data/1';

/** The only coordinate space this contract accepts. Raw keyframe pixels, pre-display-transform. */
export const OVERLAY_COORDINATE_SPACE = 'IMAGE';

// ---------------------------------------------------------------------------
// VERIFIED SOURCE INDEX SETS (reproduced verbatim from current index.html; do not edit numbers)
// ---------------------------------------------------------------------------

/** index.html LOWER_FACE_DIAGNOSTIC_SETS.jawChinRail (:2788). */
export const JAW_CHIN_RAIL = Object.freeze([172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397]);

/** index.html LOWER_FACE_DIAGNOSTIC_SETS.cheekRailA (:2789) — person's RIGHT mid/low cheek rail. */
export const CHEEK_RAIL_RIGHT = Object.freeze([234, 116, 123, 205, 186]);

/** index.html LOWER_FACE_DIAGNOSTIC_SETS.cheekRailB (:2790) — person's LEFT mid/low cheek rail. */
export const CHEEK_RAIL_LEFT = Object.freeze([454, 345, 352, 425, 410]);

/** index.html LOWER_FACE_DIAGNOSTIC_SETS.mouthReference (:2792) === ANATOMY_LANDMARKS.mouthRail (:2316). */
export const MOUTH_REFERENCE = Object.freeze([61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]);

/**
 * Named single anatomy points — index.html ANATOMY_LANDMARKS (:2309) + PERSON_ANATOMY_SIDES (:2762).
 * (PERSON_ANATOMY_SIDES.personLeft.jawAngle=397 / personRight.jawAngle=172, etc.)
 */
export const ANATOMY_KEY_POINTS = Object.freeze({
  midline: 8,
  jawAngleLeft: 397, jawAngleRight: 172,
  chinAdjacentLeft: 377, chinAdjacentRight: 148,
  chinTip: 152,
  cheekLeft: 454, cheekRight: 234,
  mouthBottom: 17
});

/**
 * The overlay groups a workbench may offer. Order is stable. Every `indices` member is a
 * verified source index; `source` is the exact origin; `reason` is the ANATOMICAL purpose only.
 */
export const OVERLAY_GROUPS = Object.freeze([
  Object.freeze({
    id: 'jaw-chin',
    label: 'Jaw / Chin',
    indices: JAW_CHIN_RAIL,
    source: 'index.html LOWER_FACE_DIAGNOSTIC_SETS.jawChinRail (:2788); LOWER_JAW (:1964); ANATOMY_LANDMARKS jaw/chin (:2309)',
    reason: 'shows the verified lower jawline + chin rail the tracker already fuses in face-local 3D'
  }),
  Object.freeze({
    id: 'cheek',
    label: 'Cheek',
    indices: Object.freeze([...CHEEK_RAIL_RIGHT, ...CHEEK_RAIL_LEFT]),
    source: 'index.html LOWER_FACE_DIAGNOSTIC_SETS.cheekRailA (:2789) + cheekRailB (:2790); PERSON_ANATOMY_SIDES.cheek (:2762)',
    reason: 'shows the mid/low cheek rails; source does not separate upper vs lower cheek, so only the rails are shown'
  }),
  Object.freeze({
    id: 'mouth-ref',
    label: 'Mouth reference',
    indices: MOUTH_REFERENCE,
    source: 'index.html LOWER_FACE_DIAGNOSTIC_SETS.mouthReference (:2792) / ANATOMY_LANDMARKS.mouthRail (:2316)',
    reason: 'lower-lip reference contour — a mouth reference line only, NOT the upper-lip moustache surface'
  })
]);

export const OVERLAY_GROUP_IDS = Object.freeze(OVERLAY_GROUPS.map(g => g.id));

/** Every distinct verified index the overlay may ever render (groups ∪ named anatomy points). */
export const VERIFIED_OVERLAY_INDICES = Object.freeze(
  [...new Set([
    ...OVERLAY_GROUPS.flatMap(g => g.indices),
    ...Object.values(ANATOMY_KEY_POINTS)
  ])].sort((a, b) => a - b)
);
const VERIFIED_SET = new Set(VERIFIED_OVERLAY_INDICES);

export function isVerifiedOverlayIndex(i) {
  return Number.isInteger(i) && VERIFIED_SET.has(i);
}

/** group id -> Set(indices), for fast membership + drawing order. */
export const OVERLAY_GROUP_INDEX_SETS = Object.freeze(
  Object.fromEntries(OVERLAY_GROUPS.map(g => [g.id, Object.freeze([...g.indices])]))
);

// ---------------------------------------------------------------------------
// EXPLICIT PROHIBITIONS (Stage BS1-H2 Part 4)
// ---------------------------------------------------------------------------

/** BS1-C unsupported regions — the overlay must never render geometry for any of these. */
export const PROHIBITED_OVERLAY_REGIONS = UNSUPPORTED_REGIONS;

/** The index.html derived throat/neck point is a display heuristic — never a tracked overlay point. */
export const DERIVED_THROAT_POINT_EXCLUDED = true;
export const DERIVED_THROAT_POINT_SOURCE =
  'index.html derivedThroatPointFromDisplay() (:1972) / drawDerivedNeck() (:1981) — 2D display drawing from a throatDrop heuristic, not a tracked landmark, not 3D';

/** Keys that must NOT appear on overlay data or a point — this contract is anatomy-reference only. */
const FORBIDDEN_SEMANTIC_KEYS = Object.freeze([
  'hairState', 'beard', 'nonBeard', 'boundary', 'neckline', 'beardLine', 'recommendation', 'mask', 'segmentation'
]);
function assertNoSemanticKeys(obj, where) {
  for (const k of FORBIDDEN_SEMANTIC_KEYS) {
    if (obj != null && Object.prototype.hasOwnProperty.call(obj, k)) {
      throw new Error(`annotation-overlay-data: ${where} must not carry a semantic key "${k}" — this contract is anatomy reference only`);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory + validation (fail-closed; never repairs, never fabricates)
// ---------------------------------------------------------------------------
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * @param spec {
 *   sourceScanObservationId, imageRef, nativeFrameTimestampNs,
 *   space:'IMAGE', imageWidth, imageHeight, rotationDegrees, mirrored,
 *   points: [ { index:int(verified), x:number, y:number, group?:overlayGroupId|null } ]
 * }
 * Coordinates are RAW image pixels (pre display transform). Points whose index is not a
 * verified overlay index are REJECTED (the whole call throws) — nothing is silently dropped.
 */
export function makeOverlayData(spec = {}) {
  if (spec == null || typeof spec !== 'object') throw new Error('makeOverlayData: spec must be an object');
  assertNoSemanticKeys(spec, 'overlay data');

  const space = spec.space == null ? OVERLAY_COORDINATE_SPACE : String(spec.space);
  if (space !== OVERLAY_COORDINATE_SPACE) {
    throw new Error(`makeOverlayData: space must be "${OVERLAY_COORDINATE_SPACE}" (raw keyframe pixels); got "${space}". CAPTURE_NORMALIZED is never reinterpreted as pixels.`);
  }
  if (spec.sourceScanObservationId == null) throw new Error('makeOverlayData: sourceScanObservationId is required');
  // BS1-H2.1 — an annotation-overlay-data/1 object is derived from exactly ONE keyframe, so
  // every exact-keyframe identity field is REQUIRED (no tolerance, no nearest, no fuzzy match).
  if (spec.imageRef == null || String(spec.imageRef).length === 0) {
    throw new Error('makeOverlayData: imageRef is required (exact-keyframe identity)');
  }
  if (!(typeof spec.nativeFrameTimestampNs === 'number' && Number.isFinite(spec.nativeFrameTimestampNs))) {
    throw new Error('makeOverlayData: nativeFrameTimestampNs is required and must be a finite number (exact-keyframe identity)');
  }
  if (!Array.isArray(spec.points)) throw new Error('makeOverlayData: points must be an array');

  const imageWidth = numOrNull(spec.imageWidth);
  const imageHeight = numOrNull(spec.imageHeight);
  const rotationDegrees = numOrNull(spec.rotationDegrees);
  const mirrored = typeof spec.mirrored === 'boolean' ? spec.mirrored : null;

  const points = spec.points.map((p, i) => {
    if (p == null || typeof p !== 'object') throw new Error(`makeOverlayData: point ${i} is not an object`);
    assertNoSemanticKeys(p, `point ${i}`);
    if (!isVerifiedOverlayIndex(p.index)) {
      throw new Error(`makeOverlayData: point ${i} index ${JSON.stringify(p.index)} is not a verified overlay landmark index`);
    }
    if (!(typeof p.x === 'number' && Number.isFinite(p.x)) || !(typeof p.y === 'number' && Number.isFinite(p.y))) {
      throw new Error(`makeOverlayData: point ${i} (index ${p.index}) has a non-finite coordinate`);
    }
    const group = p.group == null ? null : String(p.group);
    if (group != null) {
      if (!OVERLAY_GROUP_IDS.includes(group)) {
        throw new Error(`makeOverlayData: point ${i} group "${group}" is not a known overlay group`);
      }
      // BS1-H2.1 — a verified index may only be labelled with the group it actually belongs to.
      if (!OVERLAY_GROUP_INDEX_SETS[group].includes(p.index)) {
        throw new Error(`makeOverlayData: point ${i} index ${p.index} is not a member of group "${group}"`);
      }
    }
    return Object.freeze({ index: p.index, x: p.x, y: p.y, group });
  });
  if (points.length === 0) throw new Error('makeOverlayData: at least one verified point is required');

  return Object.freeze({
    schemaVersion: ANNOTATION_OVERLAY_DATA_VERSION,
    sourceScanObservationId: spec.sourceScanObservationId,
    imageRef: spec.imageRef != null ? String(spec.imageRef) : null,
    nativeFrameTimestampNs: numOrNull(spec.nativeFrameTimestampNs),
    space: OVERLAY_COORDINATE_SPACE,
    imageWidth, imageHeight, rotationDegrees, mirrored,
    points: Object.freeze(points),
    groupsPresent: Object.freeze([...new Set(points.map(p => p.group).filter(Boolean))]),
    note: 'verified anatomy reference points only — NOT beard detection; under-jaw/neck intentionally absent'
  });
}

/**
 * Populate overlay data from an EXACT keyframe's own landmark array (a future BS1-I resolver
 * would call this). Extracts ONLY the verified indices that are present + finite. Never
 * fabricates a missing index. Returns null if the keyframe geometry is not in IMAGE space.
 *
 * @param keyframe {
 *   sourceScanObservationId, imageRef, nativeFrameTimestampNs,
 *   landmarks2D: [{x,y}|{x,y,z}] (index-aligned, image pixels), space:'IMAGE',
 *   imageWidth, imageHeight, rotationDegrees, mirrored
 * }
 */
export function overlayDataFromKeyframeLandmarks(keyframe = {}, options = {}) {
  if (keyframe == null || typeof keyframe !== 'object') return null;
  const space = keyframe.space == null ? null : String(keyframe.space);
  if (space !== OVERLAY_COORDINATE_SPACE) return null; // never reinterpret CAPTURE_NORMALIZED as pixels
  const lm = keyframe.landmarks2D;
  if (!Array.isArray(lm) || lm.length < 400) return null;

  const wantGroups = Array.isArray(options.groupIds) ? options.groupIds.filter(g => OVERLAY_GROUP_IDS.includes(g)) : OVERLAY_GROUP_IDS;
  const groupOf = new Map();
  for (const g of OVERLAY_GROUPS) if (wantGroups.includes(g.id)) for (const idx of g.indices) if (!groupOf.has(idx)) groupOf.set(idx, g.id);

  const points = [];
  for (const idx of VERIFIED_OVERLAY_INDICES) {
    const g = groupOf.get(idx) || null;
    if (wantGroups.length && g == null && !options.includeUngroupedAnatomyPoints) continue;
    const p = lm[idx];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue; // missing -> omit, never invent
    points.push({ index: idx, x: p.x, y: p.y, group: g });
  }
  if (points.length === 0) return null;

  return makeOverlayData({
    sourceScanObservationId: keyframe.sourceScanObservationId,
    imageRef: keyframe.imageRef,
    nativeFrameTimestampNs: keyframe.nativeFrameTimestampNs,
    space: OVERLAY_COORDINATE_SPACE,
    imageWidth: keyframe.imageWidth,
    imageHeight: keyframe.imageHeight,
    rotationDegrees: keyframe.rotationDegrees,
    mirrored: keyframe.mirrored,
    points
  });
}

// ---------------------------------------------------------------------------
// BS1-H2.1 — strict exact-keyframe identity + display-metadata consistency + group membership
// ---------------------------------------------------------------------------

/** Normalized rotation in [0,360); null if not a finite number. */
function normRot(v) { return (typeof v === 'number' && Number.isFinite(v)) ? (((v % 360) + 360) % 360) : null; }

/**
 * The overlay is derived from exactly ONE keyframe. For rendering, ALL THREE identity fields
 * must be present on BOTH the bundle entry and the overlay data and be EXACTLY equal:
 * sourceScanObservationId, imageRef, nativeFrameTimestampNs. No timestamp tolerance, no
 * nearest timestamp, no fuzzy match, no array-position match. A required field absent on
 * either side fails closed.
 * @returns {{ ok: boolean, reason: (string|null) }}
 */
export function overlayDataMatchesEntryIdentity(entry, overlayData) {
  if (!entry || typeof entry !== 'object') return { ok: false, reason: 'no entry' };
  if (!overlayData || typeof overlayData !== 'object') return { ok: false, reason: 'no overlayData' };
  for (const f of ['sourceScanObservationId', 'imageRef', 'nativeFrameTimestampNs']) {
    const a = entry[f], b = overlayData[f];
    if (a == null || b == null) return { ok: false, reason: `${f} missing on ${a == null ? 'entry' : 'overlayData'}` };
    if (a !== b) return { ok: false, reason: `${f} mismatch` };
  }
  return { ok: true, reason: null };
}

/**
 * Where BOTH the entry and the overlay data supply a display-metadata field, it must agree —
 * a guard against attaching coordinates authored for one image representation to another.
 * These fields are NOT used as identity. imageWidth / imageHeight: exact. rotationDegrees:
 * equal mod 360. mirrored: exact boolean. A field absent / non-numeric on either side is
 * skipped (legitimately optional). A concrete contradiction fails closed.
 * @returns {{ ok: boolean, reason: (string|null) }}
 */
export function overlayImageMetaConsistent(entry, overlayData) {
  if (!entry || !overlayData) return { ok: true, reason: null };
  for (const f of ['imageWidth', 'imageHeight']) {
    const a = entry[f], b = overlayData[f];
    if (typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b) && a !== b) {
      return { ok: false, reason: `${f} contradiction` };
    }
  }
  const ra = normRot(entry.rotationDegrees), rb = normRot(overlayData.rotationDegrees);
  if (ra != null && rb != null && ra !== rb) return { ok: false, reason: 'rotationDegrees contradiction' };
  if (typeof entry.mirrored === 'boolean' && typeof overlayData.mirrored === 'boolean' && entry.mirrored !== overlayData.mirrored) {
    return { ok: false, reason: 'mirrored contradiction' };
  }
  return { ok: true, reason: null };
}

/**
 * Is `index` allowed under `group`? A null group is an ungrouped named anatomy anchor
 * (allowed when the index is verified). A non-null group must actually contain the index —
 * a verified index is NEVER silently reassigned to, or accepted under, the wrong rail.
 */
export function overlayPointGroupValid(index, group) {
  if (!isVerifiedOverlayIndex(index)) return false;
  if (group == null) return true;
  const set = OVERLAY_GROUP_INDEX_SETS[String(group)];
  return Array.isArray(set) && set.includes(index);
}

/**
 * Pure: attach overlay data to a bundle entry, returning a frozen shallow copy. Refuses
 * (throws) unless the overlay data is EXACT-identity-matched to the entry (all three fields
 * present + equal) and display-metadata-consistent. Does NOT mutate the entry, and does NOT
 * change AnnotationBundle v1 (the bundle schemaVersion is untouched).
 */
export function attachOverlayData(bundleEntry, overlayData) {
  if (!bundleEntry || typeof bundleEntry !== 'object') throw new Error('attachOverlayData: entry must be an object');
  if (!overlayData || overlayData.schemaVersion !== ANNOTATION_OVERLAY_DATA_VERSION) {
    throw new Error('attachOverlayData: overlayData must be an annotation-overlay-data/1 object');
  }
  const id = overlayDataMatchesEntryIdentity(bundleEntry, overlayData);
  if (!id.ok) throw new Error('attachOverlayData: ' + id.reason);
  const meta = overlayImageMetaConsistent(bundleEntry, overlayData);
  if (!meta.ok) throw new Error('attachOverlayData: ' + meta.reason);
  return Object.freeze({ ...bundleEntry, overlayData });
}

/**
 * Strict RENDER gate (BS1-H2.1). True only when the attached overlay data is present,
 * well-formed, in IMAGE space, EXACT-identity-matched to the entry, display-metadata
 * consistent, and every point is a verified index that belongs to its declared group.
 */
export function overlayDataValid(entry) {
  return overlayDataUnavailableReason(entry) == null;
}

/** Null when the overlay is renderable for this entry; otherwise a short reason string. */
export function overlayDataUnavailableReason(entry) {
  const od = entry && entry.overlayData;
  if (!od || typeof od !== 'object') return 'no overlayData';
  if (od.schemaVersion !== ANNOTATION_OVERLAY_DATA_VERSION) return 'schemaVersion';
  if (od.space !== OVERLAY_COORDINATE_SPACE) return 'space not IMAGE';
  if (!Array.isArray(od.points) || od.points.length === 0) return 'no points';
  const id = overlayDataMatchesEntryIdentity(entry, od);
  if (!id.ok) return 'identity: ' + id.reason;
  const meta = overlayImageMetaConsistent(entry, od);
  if (!meta.ok) return 'metadata: ' + meta.reason;
  for (const p of od.points) {
    // BS1-H2.1.1 — a point must be a plain non-null object BEFORE any field is read; a
    // malformed element (null, primitive, array) fails the whole overlay closed, never throws.
    if (p == null || typeof p !== 'object' || Array.isArray(p)) return 'point object';
    if (!(typeof p.x === 'number' && Number.isFinite(p.x)) || !(typeof p.y === 'number' && Number.isFinite(p.y))) {
      return 'point coordinate';
    }
    if (!overlayPointGroupValid(p.index, p.group)) {
      return `point index ${p.index} not valid for group ${p.group == null ? '(none)' : p.group}`;
    }
  }
  return null;
}

/** True when the point lies inside the raw image frame (diagnostic only — out-of-frame is allowed). */
export function pointInImageBounds(od, p) {
  const w = numOrNull(od && od.imageWidth), h = numOrNull(od && od.imageHeight);
  if (w == null || h == null) return null;
  return p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
}

/** Concise deterministic text. NEVER contains coordinates or any semantic term. */
export function overlayDiagnosticString(od) {
  if (!od || typeof od !== 'object') return 'annotation-overlay-data: (none)';
  const byGroup = {};
  for (const g of OVERLAY_GROUP_IDS) byGroup[g] = 0;
  let ungrouped = 0;
  for (const p of (od.points || [])) { if (p.group && byGroup[p.group] != null) byGroup[p.group]++; else ungrouped++; }
  const lines = [
    'annotation-overlay-data/1',
    `space=${od.space}`,
    `image=${od.imageWidth == null ? '?' : od.imageWidth}x${od.imageHeight == null ? '?' : od.imageHeight}`,
    `rotationDegrees=${od.rotationDegrees == null ? '?' : od.rotationDegrees}`,
    `mirrored=${od.mirrored == null ? '?' : od.mirrored}`,
    `points=${(od.points || []).length}`,
    'perGroup:'
  ];
  for (const g of OVERLAY_GROUP_IDS) lines.push(`  ${g}=${byGroup[g]}`);
  lines.push(`  (ungrouped)=${ungrouped}`);
  return lines.join('\n');
}
