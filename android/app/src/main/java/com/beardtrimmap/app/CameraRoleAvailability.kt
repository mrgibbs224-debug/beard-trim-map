package com.beardtrimmap.app

/**
 * CORE-CAM1-B0 — the ONE device-agnostic boundary higher layers ask about camera roles.
 *
 * Pure functions over a [CameraCensus] (produced read-only by [CameraCapabilityInspector] on a
 * real device, or from synthetic fixtures in tests). No Android imports, no camera IDs baked
 * in, no vendor-name matching, no Camera2 internals surfaced. This file opens nothing,
 * switches nothing, and is NOT wired into `switchCamera()` / `switchLiveCamera()` / ARCore /
 * CameraX in CAM1-B0 — that integration is a later capability-phase stage.
 *
 * Contract questions a higher layer may ask, and nothing more:
 *   - is SELF available?          -> [CameraRoleAvailability.selfAvailable]
 *   - is ASSISTED available?      -> [CameraRoleAvailability.assistedAvailable]
 *   - can the active rear use a physical torch? -> [CameraRoleAvailability.assistedLighting] == TORCH
 *   - what zoom envelope is allowed? -> [CameraRoleAvailability.assistedZoom]
 *
 * Truth rules honoured here:
 *   - No usable front camera  -> SELF is NOT offered.
 *   - No usable rear camera   -> ASSISTED is NOT offered.
 *   - Rear exists but reports no flash unit -> ASSISTED still exists; torch control is NONE.
 *   - A validated / runtime-allowed zoom ceiling is NEVER auto-derived from hardware maxima.
 *     Until a later stage validates one, [ZoomAvailability.runtimeAllowed] stays `false` even
 *     when the hardware advertises a zoom range.
 *   - Malformed / unknown metadata never throws; the affected role simply falls to unavailable
 *     with a human-readable exclusion reason.
 */

/** Lighting affordance a Mettle camera role exposes. */
enum class RoleLighting {
    /** SELF: screen-only perimeter Edge Light. Never a physical flash. */
    EDGE_LIGHT,
    /** ASSISTED: the bound rear camera's physical torch. */
    TORCH,
    /** No lighting control for this role. */
    NONE
}

/**
 * Zoom availability for the ASSISTED (rear) role. `hardware*` mirrors what the camera
 * advertised; `validatedSafe*` / `runtimeAllowed*` stay null / false until a dedicated
 * validation stage decides them. The eventual effective ceiling is
 * `min(hardware, validatedSafe, runtimeAllowed)` and none of those three is chosen here.
 */
data class ZoomAvailability(
    /** Hardware advertises a usable zoom range wider than 1.0x. */
    val hardwareSupported: Boolean = false,
    val hardwareMin: Float? = null,
    val hardwareMax: Float? = null,
    val validatedSafeMin: Float? = null,
    val validatedSafeMax: Float? = null,
    /** True ONLY when a validated/runtime ceiling has been set by a later stage. Always false in CAM1-B0. */
    val runtimeAllowed: Boolean = false,
    val runtimeAllowedMin: Float? = null,
    val runtimeAllowedMax: Float? = null
)

/**
 * The resolved SELF / ASSISTED picture for one census. `*CameraId` values are informational
 * only — the locked production selection still goes through ARCore `Session.Feature.FRONT_CAMERA`
 * and CameraX `DEFAULT_FRONT_CAMERA` / `DEFAULT_BACK_CAMERA`; nothing selects by this id.
 */
data class CameraRoleAvailability(
    val selfAvailable: Boolean,
    val assistedAvailable: Boolean,
    val selfCameraId: String?,
    val assistedCameraId: String?,
    val selfLighting: RoleLighting,
    val assistedLighting: RoleLighting,
    val assistedZoom: ZoomAvailability,
    /** Human-readable reasons a role or feature is unavailable. Empty when everything resolved cleanly. */
    val exclusions: List<String> = emptyList()
)

object CameraRoleResolver {

    /** Resolve SELF / ASSISTED availability from a census. Never throws. */
    fun resolve(census: CameraCensus?): CameraRoleAvailability {
        val exclusions = mutableListOf<String>()
        val cameras = census?.cameras.orEmpty()

        if (census == null || cameras.isEmpty()) {
            exclusions.add("no cameras enumerated" + (census?.errors?.takeIf { it.isNotEmpty() }
                ?.let { ": " + it.joinToString("; ") } ?: ""))
            return CameraRoleAvailability(
                selfAvailable = false,
                assistedAvailable = false,
                selfCameraId = null,
                assistedCameraId = null,
                selfLighting = RoleLighting.NONE,
                assistedLighting = RoleLighting.NONE,
                assistedZoom = ZoomAvailability(),
                exclusions = exclusions.toList()
            )
        }

        // Hardware exposure is not proof of usability; a fixture / future census may mark a lens
        // hardwareExposed=false or sessionUsability=UNAVAILABLE to exclude it.
        fun usable(c: CameraCapability) =
            c.hardwareExposed && c.sessionUsability != SessionUsability.UNAVAILABLE

        val fronts = cameras.filter { it.lensFacing == LensFacing.FRONT && usable(it) }
        val rears = cameras.filter { it.lensFacing == LensFacing.BACK && usable(it) }

        val self: CameraCapability? = fronts.firstOrNull()
        val selfAvailable = self != null
        if (!selfAvailable) {
            exclusions.add("SELF unavailable: no usable front-facing camera reported")
        }

        // ASSISTED rear reference: a logical rear if one is advertised, else the camera the
        // CAM1-A per-camera inference proposed as REAR_GENERAL, else the first usable rear.
        // NEVER a hard-coded camera id / lens index.
        val rearRef: CameraCapability? = when {
            rears.isEmpty() -> null
            else -> rears.firstOrNull { it.isLogicalCamera == true }
                ?: rears.firstOrNull { it.proposedRole == MettleCameraRole.REAR_GENERAL }
                ?: rears.first()
        }
        val assistedAvailable = rearRef != null
        if (!assistedAvailable) {
            exclusions.add("ASSISTED unavailable: no usable rear-facing camera reported")
        }

        val assistedLighting = when {
            rearRef == null -> RoleLighting.NONE
            rearRef.supportsTorch == true || rearRef.hasFlashUnit == true -> RoleLighting.TORCH
            else -> {
                exclusions.add("ASSISTED torch unavailable: rear camera reports no flash unit")
                RoleLighting.NONE
            }
        }

        val assistedZoom = resolveZoom(rearRef, exclusions)

        return CameraRoleAvailability(
            selfAvailable = selfAvailable,
            assistedAvailable = assistedAvailable,
            selfCameraId = self?.cameraId,
            assistedCameraId = rearRef?.cameraId,
            selfLighting = if (selfAvailable) RoleLighting.EDGE_LIGHT else RoleLighting.NONE,
            assistedLighting = assistedLighting,
            assistedZoom = assistedZoom,
            exclusions = exclusions.toList()
        )
    }

    private fun resolveZoom(
        rearRef: CameraCapability?,
        exclusions: MutableList<String>
    ): ZoomAvailability {
        val z = rearRef?.zoom ?: return ZoomAvailability()

        val hwMin = z.hardwareZoomRatioMin
        val hwMax = z.hardwareZoomRatioMax ?: z.hardwareMaxDigitalZoom
        val hardwareSupported =
            hwMax != null && hwMax.isFinite() && hwMax > 1f &&
                (hwMin == null || (hwMin.isFinite() && hwMax > hwMin))

        if (!hardwareSupported && rearRef != null) {
            exclusions.add("ASSISTED zoom: hardware advertises no usable zoom range")
        }

        // validatedSafe* / runtimeAllowed* are NEVER auto-filled from hardware maxima. They stay
        // null / false until a dedicated validation stage sets them (see SafeZoomEnvelope doc).
        return ZoomAvailability(
            hardwareSupported = hardwareSupported,
            hardwareMin = hwMin,
            hardwareMax = hwMax,
            validatedSafeMin = null,
            validatedSafeMax = z.validatedSafeZoomMax,
            runtimeAllowed = z.runtimeSafeZoomMax != null,
            runtimeAllowedMin = null,
            runtimeAllowedMax = z.runtimeSafeZoomMax
        )
    }
}
