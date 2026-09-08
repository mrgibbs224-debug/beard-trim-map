// Transient image-access contract for semantic derivation — PURE, ISOLATED
// Stage BS1-D. Zero I/O: no files, no DOM, no localStorage, no network, no Android APIs.
//
// PURPOSE
//   BS1-C deliberately keeps only an opaque `imageRef` (handle + shape metadata) in long-lived
//   package structures — never the base64 pixels. A future segmentation/model producer still
//   needs the actual synchronized image pixels *briefly*. This module defines the boundary
//   for that: the accuracy layer does NOT own where pixels live. A caller supplies a resolver
//   function; the wrapper normalises its outcome, hands any payload straight to a transient
//   caller sink for derivation, and returns a small descriptor that contains NO pixels.
//
// PRIVACY / LIFETIME
//   Reuses BS1-B RawImageLifecycle. This module implements no deletion and no persistence —
//   only the state progression TRANSIENT → RETAINED_FOR_SCAN_PROCESSING →
//   DERIVED_DATA_EXTRACTED → ELIGIBLE_FOR_DISCARD as a contract. Derived semantic evidence
//   must be usable after raw image bytes are gone: `rawImagesRequiredAfterDerivation()` === false.

import { RawImageLifecycle } from './multi-observation-scan-package.mjs';

export { RawImageLifecycle };
export const SEMANTIC_IMAGE_EVIDENCE_VERSION = 'semantic-image-evidence/1';

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Caller-resolver outcome vocabulary. */
export const ImageResolveStatus = Object.freeze({
  RESOLVED: 'RESOLVED',
  NOT_FOUND: 'NOT_FOUND',
  EXPIRED: 'EXPIRED',
  INVALID: 'INVALID',
  UNSUPPORTED: 'UNSUPPORTED'
});

/**
 * The minimum key a caller needs to resolve the original image externally (from a transient
 * in-memory A6 `dataUrl`, a native keyframe payload, a test fixture, or a future explicit
 * storage feature). Built from a BS1-C image-backed ScanObservation. Contains NO pixels.
 */
export function imageResolverKey(scanObs) {
  return Object.freeze({
    observationId: (scanObs && scanObs.observationId) || null,
    imageRef: (scanObs && scanObs.imageRef && scanObs.imageRef.ref) || null,
    nativeFrameTimestampNs: (scanObs && scanObs.timestamp && numOrNull(scanObs.timestamp.nativeFrameTimestampNs)) || null,
    poseId: (scanObs && scanObs.poseId) || null,
    coherenceStatus: (scanObs && scanObs.coherenceStatus) || null,
    scannerSessionId: (scanObs && scanObs.metadata && scanObs.metadata.scannerSessionId) || null
  });
}

/** Frozen resolution descriptor — never carries pixels. */
export function makeImageResolution(spec = {}) {
  return Object.freeze({
    imageResolveVersion: SEMANTIC_IMAGE_EVIDENCE_VERSION,
    key: spec.key ? Object.freeze({ ...spec.key }) : null,
    status: spec.status,
    payloadPresent: spec.payloadPresent === true,
    width: numOrNull(spec.width),
    height: numOrNull(spec.height),
    rotationDegrees: numOrNull(spec.rotationDegrees),
    mirrored: typeof spec.mirrored === 'boolean' ? spec.mirrored : null,
    reason: spec.reason != null ? String(spec.reason) : null
  });
}

/**
 * Resolve one image via a CALLER-SUPPLIED resolver, without persisting the payload.
 *
 *   resolver(key, context) -> {
 *     status: ImageResolveStatus,
 *     payload?: <opaque pixels — handed only to onPayload, never returned/stored>,
 *     width?, height?, rotationDegrees?, mirrored?, reason?
 *   }
 *
 * `onPayload(payload, key)` is the caller's transient derivation sink (e.g. run a future
 * segmentation model). It is invoked synchronously and the payload is then dropped here.
 * Any resolver throw or malformed return degrades to INVALID (never throws to the caller).
 */
export function resolveImageEvidence(key, context, resolver, { onPayload = null } = {}) {
  if (typeof resolver !== 'function') {
    return makeImageResolution({ key, status: ImageResolveStatus.UNSUPPORTED, reason: 'no resolver supplied' });
  }
  let out;
  try {
    out = resolver(key, context == null ? null : context);
  } catch (e) {
    return makeImageResolution({ key, status: ImageResolveStatus.INVALID, reason: `resolver threw: ${e && e.message}` });
  }
  if (!out || typeof out !== 'object') {
    return makeImageResolution({ key, status: ImageResolveStatus.INVALID, reason: 'resolver returned a non-object' });
  }
  const status = Object.values(ImageResolveStatus).includes(out.status) ? out.status : ImageResolveStatus.INVALID;
  if (status !== ImageResolveStatus.RESOLVED) {
    return makeImageResolution({ key, status, reason: out.reason });
  }
  const payloadPresent = out.payload != null;
  if (payloadPresent && typeof onPayload === 'function') {
    try { onPayload(out.payload, key); } catch (_e) { /* derivation-sink errors belong to the caller */ }
  }
  // out.payload is intentionally NOT included in the returned descriptor.
  return makeImageResolution({
    key, status,
    payloadPresent,
    width: out.width, height: out.height,
    rotationDegrees: out.rotationDegrees, mirrored: out.mirrored,
    reason: out.reason
  });
}

// ---------------------------------------------------------------------------
// Raw-image lifecycle progression (contract only — no deletion, no persistence).
// ---------------------------------------------------------------------------
const LIFECYCLE_ORDER = Object.freeze([
  RawImageLifecycle.TRANSIENT,
  RawImageLifecycle.RETAINED_FOR_SCAN_PROCESSING,
  RawImageLifecycle.DERIVED_DATA_EXTRACTED,
  RawImageLifecycle.ELIGIBLE_FOR_DISCARD
]);

/** Advance a raw-image lifecycle state forward along the transient progression. */
export function advanceLifecycle(state, to) {
  const from = LIFECYCLE_ORDER.indexOf(state);
  const target = LIFECYCLE_ORDER.indexOf(to);
  if (from < 0 || target < 0) {
    return Object.freeze({ state, ok: false, reason: 'state is not part of the transient TRANSIENT..ELIGIBLE_FOR_DISCARD progression' });
  }
  if (target < from) {
    return Object.freeze({ state, ok: false, reason: 'raw-image lifecycle does not move backwards' });
  }
  return Object.freeze({ state: to, ok: true, reason: null });
}

/** The derived semantic evidence contract needs no pixels once it exists. */
export function rawImagesRequiredAfterDerivation() {
  return false;
}
