package com.beardtrimmap.app

/**
 * CAM1-A — device-agnostic camera capability foundation.
 *
 * A pure data model describing what a single Android camera *reports* about itself, plus the
 * Mettle product-role vocabulary layered on top. Nothing in this file opens a camera,
 * switches a camera, or influences the locked production selection paths
 * (ARCore `Session.Feature.FRONT_CAMERA`, CameraX `DEFAULT_FRONT_CAMERA` /
 * `DEFAULT_BACK_CAMERA`). It exists so a later stage can run a read-only census on a real
 * device and decide, from evidence, what each lens is good for.
 *
 * Design rules honoured here:
 *  - No hard-coded camera IDs, lens counts, focal lengths, zoom ranges, or vendor names.
 *  - Every value Android cannot guarantee is nullable and stays `null` / `UNKNOWN`, never a
 *    fabricated or hardware-maximum value.
 *  - Types are plain JVM types (String / Int / Float / List / enum) so role inference stays
 *    unit-testable without a device or Robolectric.
 */

/** Physical direction a camera points, mirrored from `CameraCharacteristics.LENS_FACING`. */
enum class LensFacing { FRONT, BACK, EXTERNAL, UNKNOWN }

/**
 * A Mettle product role a camera *might* play. In CAM1-A these are proposals for diagnostics
 * only — no production code switches cameras based on them yet (see Part 11 of the stage).
 */
enum class MettleCameraRole {
    FRONT_SELF,
    REAR_GENERAL,
    REAR_WIDE,
    REAR_DETAIL,
    REAR_CLOSE_FOCUS,
    AUXILIARY,
    UNKNOWN
}

/**
 * Whether a lens the hardware advertises has actually been proven to work through Mettle's
 * current, locked camera path. Newly discovered advanced lenses stay [UNKNOWN] until a real
 * session validates them; the census never promotes them on its own.
 */
enum class SessionUsability { UNKNOWN, VALIDATED, UNAVAILABLE }

/** Compact, loggable summary of one output-format group (avoids an `android.util.Size` dep). */
data class OutputSizeSummary(
    val format: String,
    val count: Int,
    val maxWidth: Int?,
    val maxHeight: Int?
)

/** Compact summary of one AE target FPS range. */
data class FpsRangeSummary(val min: Int, val max: Int)

/**
 * Reserved envelope for a *future* Mettle safe-zoom system. Every ceiling is nullable and
 * `null` means "not yet validated". The validated / runtime ceilings must NEVER be
 * auto-populated from [hardwareZoomRatioMax] or [hardwareMaxDigitalZoom] — Mettle's eventual
 * effective maximum is the minimum of hardware capability, a validated camera-path ceiling,
 * and runtime tracking/geometry confidence, and none of those is decided in CAM1-A.
 */
data class SafeZoomEnvelope(
    val hardwareZoomRatioMin: Float? = null,
    val hardwareZoomRatioMax: Float? = null,
    val hardwareMaxDigitalZoom: Float? = null,
    val validatedSafeZoomMax: Float? = null,
    val runtimeSafeZoomMax: Float? = null
)

/**
 * Everything one camera advertises through `CameraManager` / `CameraCharacteristics`,
 * normalised into optional values. A field left at its default (`null` / empty / `UNKNOWN`)
 * means the platform did not expose it on this device — it is not a claim of absence.
 */
data class CameraCapability(
    val cameraId: String?,
    val lensFacing: LensFacing = LensFacing.UNKNOWN,

    // Logical / physical multi-camera (API 28+; null when the API level or data is absent).
    val isLogicalCamera: Boolean? = null,
    val physicalCameraIds: List<String> = emptyList(),

    // Optics.
    val focalLengthsMm: List<Float> = emptyList(),
    /** Diopters (1/m). 0.0 == fixed-focus lens; null == not reported. Higher == focuses closer. */
    val minimumFocusDistanceDiopters: Float? = null,
    val hyperfocalDistanceDiopters: Float? = null,

    // Zoom — see [SafeZoomEnvelope] for the reserved Mettle ceiling fields.
    val zoom: SafeZoomEnvelope = SafeZoomEnvelope(),

    // Flash / torch.
    val hasFlashUnit: Boolean? = null,
    val supportsTorch: Boolean? = null,

    // Streams (summarised, not dumped).
    val outputSizes: List<OutputSizeSummary> = emptyList(),
    val fpsRanges: List<FpsRangeSummary> = emptyList(),

    // Sensor.
    val hardwareLevel: String? = null,
    val sensorOrientationDegrees: Int? = null,
    val activeArraySize: String? = null,
    val pixelArraySize: String? = null,

    // Capability flags (names normalised; unknown numeric values kept as "CAP_<n>").
    val availableCapabilities: List<String> = emptyList(),
    val autofocusModes: List<Int> = emptyList(),
    val opticalStabilizationModes: List<Int> = emptyList(),
    val videoStabilizationModes: List<Int> = emptyList(),
    val rawSupported: Boolean? = null,
    val depthSupported: Boolean? = null,
    val logicalMultiCameraSupported: Boolean? = null,

    // Part 6: hardware exposure is NOT proof of usability through Mettle's current path.
    val hardwareExposed: Boolean = true,
    val sessionUsability: SessionUsability = SessionUsability.UNKNOWN,

    // Diagnostic proposal only (Part 3 / Part 11) — never a switching decision in CAM1-A.
    val proposedRole: MettleCameraRole = MettleCameraRole.UNKNOWN,

    /** Set when a characteristic read threw or returned nothing useful. */
    val notes: List<String> = emptyList()
)

/** Result of one census pass. */
data class CameraCensus(
    val cameras: List<CameraCapability>,
    val apiLevel: Int,
    val errors: List<String> = emptyList()
)
