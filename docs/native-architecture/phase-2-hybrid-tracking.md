# Phase 2: additive hybrid tracking foundation

## Product boundary

The existing v31 `index.html` remains the user interface and owns navigation, style
selection, preview presentation, trim-map geometry, guard sequencing, registration
thresholds, drift checks, and fail-closed states. Android hosts that same file from a
secure APK asset origin; it does not recreate the product in Kotlin.

## Provider order

1. ARCore Augmented Faces is the primary native tracking target. Its 468-point 3D mesh,
   center pose, and region poses will share the native camera preview surface.
2. ML Kit Face Mesh supplies an independent 468-point verifier and fallback.
3. OpenCV smooths native landmark packets in memory.
4. The existing browser MediaPipe tracker remains an emergency fallback only.

The Phase 2 bridge reports `nativePreviewSurface=false` until ARCore camera pixels and
mesh packets can be presented together in the exact same crop. This capability gate
prevents native landmarks from being drawn over unrelated WebView camera frames.

## Coordinate contract

Bridge contract version 1 sends normalized, oriented-image coordinates plus frame width,
frame height, source rotation, mirror state, monotonic timestamp, inference duration,
provider identity, and optional transformation matrix. Mirroring is metadata; coordinates
are not silently mirrored. The web renderer continues applying its existing front-camera
display mirror exactly once.

Native code does not assume a fixed scan-step array. Pose identifiers and reference
selection remain application data owned by the web workflow.

## Six-pose Precision Scan

The scan keeps separate capture records for:

1. Front
2. 45° Right
3. Full Right Profile
4. 45° Left
5. Full Left Profile
6. Chin Up

The 45° records are selected for live registration during front-to-profile transitions.
Full-profile records remain authoritative at larger yaw. No pose overwrites another.

## Privacy and safety

- Camera frames, native meshes, verifier results, OpenCV history, and bridge packets are
  session-only.
- No native tracking data is sent to the Cloudflare preview endpoint.
- Activity pause, destruction, and Start Over stop native tracking and clear stabilizer
  history and the most recent bridge packet.
- Losing the face, detecting multiple faces, stale packets, excessive registration error,
  or provider disagreement must pause precision guidance. Existing `DO NOT TRIM` behavior
  remains authoritative.
- Raw scan photos remain in the existing in-memory browser session unless the user later
  invokes an explicitly approved export/save action.

## Deliberate Phase 2 capability gate

ARCore owns its camera stream and requires a GL preview surface. Activating it before the
native surface is aligned to the existing scanner and Live Map camera stages would create
camera contention or coordinate mismatch. Therefore the bridge exposes the ARCore primary
session foundation and ML Kit verifier but keeps the browser provider active until the
native preview surface capability is complete and physically validated on the Samsung.
