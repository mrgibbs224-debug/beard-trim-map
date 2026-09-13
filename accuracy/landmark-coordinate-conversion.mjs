// Normalized -> IMAGE landmark coordinate conversion boundary — PURE, ISOLATED
// Stage BI-1E Part 1. Zero I/O, zero native/production imports.
//
// PURPOSE
//   BI-1D proved, both numerically (real value ranges across all six poses) and by source-code
//   provenance (ArCoreFaceMeshTracker.kt's explicit "Normalized Device Coordinates (NDC) to
//   [0, 1]" comment; MlKitFaceMeshTracker.kt's `p.x / width, p.y / height`), that the real A6
//   export's `landmarks2D` is CAPTURE_NORMALIZED (0..1), never raw pixels. The overlay
//   contract in annotation-overlay-data.mjs (`overlayDataFromKeyframeLandmarks`,
//   `OVERLAY_COORDINATE_SPACE`) requires IMAGE pixel coordinates and explicitly refuses to
//   reinterpret CAPTURE_NORMALIZED values as pixels.
//
//   This module is the smallest explicit boundary between the two: it converts a
//   CAPTURE_NORMALIZED points array into an IMAGE-space one, on request, and marks the result
//   with the real OVERLAY_COORDINATE_SPACE constant. It never touches the native Scanner
//   export, never claims IMAGE space without actually converting, and never mutates its input.
//
// WHAT THIS IS NOT
//   - Not a resolver: the caller still supplies the real keyframe's landmarks2D/width/height.
//   - Not a display transform: rotation/mirroring are NOT applied here (BI-1D found the real
//     export's own rotation/mirror metadata is absent on the session inspected; this module does
//     not guess it, and downstream display code owns that transform if/when it exists).
//   - Not wired into index.html, the Android app, or worker.js.

import { CoordinateSpace } from './beard-surface-core.mjs';
import { OVERLAY_COORDINATE_SPACE } from './annotation-overlay-data.mjs';

export const LANDMARK_COORDINATE_CONVERSION_VERSION = 'landmark-coordinate-conversion/1';

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Convert one CAPTURE_NORMALIZED (0..1) landmarks2D array into IMAGE pixel coordinates.
 * Pure and fail-closed:
 *   - never mutates `points` or any point object in it (the source stays untouched);
 *   - returns null (not a partial/garbage result) if dimensions are missing/non-finite/<=0;
 *   - a missing or non-finite source point becomes `null` at that index rather than an
 *     invented coordinate — index alignment with the source array is preserved.
 *
 * @param points       array of {x,y,z?} in CAPTURE_NORMALIZED space, index-aligned to a real
 *                     keyframe's landmark topology (e.g. the 468-point MediaPipe indices)
 * @param imageWidth   the SAME keyframe's real pixel width (e.g. ScanObservation.imageRef.width)
 * @param imageHeight  the SAME keyframe's real pixel height
 * @returns { space: 'IMAGE', sourceSpace: 'CAPTURE_NORMALIZED', imageWidth, imageHeight,
 *            points: [{x,y,z}|null, ...] } | null
 */
export function normalizedLandmarksToImageSpace(points, imageWidth, imageHeight) {
  if (!Array.isArray(points)) return null;
  if (!isFiniteNum(imageWidth) || !isFiniteNum(imageHeight) || imageWidth <= 0 || imageHeight <= 0) return null;

  const converted = points.map((p) => {
    if (!p || !isFiniteNum(p.x) || !isFiniteNum(p.y)) return null; // missing/invalid -> omit, never invent
    return Object.freeze({
      x: p.x * imageWidth,
      y: p.y * imageHeight,
      z: isFiniteNum(p.z) ? p.z : null
    });
  });

  return Object.freeze({
    space: OVERLAY_COORDINATE_SPACE, // 'IMAGE' — reused from the real overlay contract, not re-literaled
    sourceSpace: CoordinateSpace.CAPTURE_NORMALIZED,
    imageWidth,
    imageHeight,
    points: Object.freeze(converted)
  });
}

/**
 * Convenience: convert a single index-aligned point (not a whole array). Same fail-closed rules.
 */
export function normalizedPointToImageSpace(point, imageWidth, imageHeight) {
  const r = normalizedLandmarksToImageSpace([point], imageWidth, imageHeight);
  return r ? r.points[0] : null;
}
