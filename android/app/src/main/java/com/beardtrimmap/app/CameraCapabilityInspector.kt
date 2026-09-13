package com.beardtrimmap.app

import android.content.Context
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.os.Build
import android.util.Log

/**
 * CAM1-A — read-only camera capability census.
 *
 * Enumerates cameras through `CameraManager` / `CameraCharacteristics` only. It never opens
 * a camera, never binds a CameraX use case, never switches the production camera, runs no
 * loop or timer, and touches no network. One [census] call reads static metadata and
 * returns. Safe to call on demand (e.g. from a future diagnostics screen); it must NOT be
 * called per frame.
 *
 * Nothing here is wired into `NativeTrackingCoordinator` / `MlKitFaceMeshTracker` / ARCore /
 * `switchCamera` / Torch / the startup watchdog / Scanner / Live Map. That integration is a
 * later stage, to be decided only after a real-device census.
 */
class CameraCapabilityInspector(private val context: Context) {

    /**
     * Produce a capability list from Android runtime metadata. Read-only: no camera is
     * opened and no session is created.
     */
    fun census(): CameraCensus {
        val api = Build.VERSION.SDK_INT
        val manager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
            ?: return CameraCensus(emptyList(), api, listOf("CameraManager unavailable"))

        val ids = try {
            manager.cameraIdList.toList()
        } catch (e: Exception) {
            return CameraCensus(
                emptyList(), api,
                listOf("cameraIdList failed: ${e.javaClass.simpleName}")
            )
        }

        val caps = ids.map { id -> readCamera(manager, id) }
        return CameraCensus(CameraRoleInference.withProposedRoles(caps), api)
    }

    /**
     * A deterministic, concise diagnostic string for the eventual on-device census. One
     * block per camera; no raw characteristic dumps; no per-frame logging.
     */
    fun diagnosticReport(): String {
        val snapshot = census()
        val sb = StringBuilder()
        sb.append("Mettle camera census - API ").append(snapshot.apiLevel).append('\n')
        if (snapshot.errors.isNotEmpty()) {
            sb.append("errors: ").append(snapshot.errors.joinToString("; ")).append('\n')
        }
        snapshot.cameras.forEach { c ->
            sb.append("- id=").append(c.cameraId ?: "?")
                .append(" facing=").append(c.lensFacing.name.lowercase())
                .append(" logical=").append(c.isLogicalCamera?.toString() ?: "unknown")
            if (c.physicalCameraIds.isNotEmpty()) {
                sb.append(" physical=").append(c.physicalCameraIds.joinToString(",", "[", "]"))
            }
            sb.append('\n')
            sb.append("  focalMm=")
                .append(if (c.focalLengthsMm.isEmpty()) "unknown" else c.focalLengthsMm.joinToString(","))
                .append(" minFocusDiopter=")
                .append(c.minimumFocusDistanceDiopters?.toString() ?: "unknown").append('\n')
            sb.append("  zoomRatio=")
                .append(c.zoom.hardwareZoomRatioMin?.toString() ?: "?").append("..")
                .append(c.zoom.hardwareZoomRatioMax?.toString() ?: "?")
                .append(" maxDigitalZoom=")
                .append(c.zoom.hardwareMaxDigitalZoom?.toString() ?: "unknown")
                .append(" validatedSafeZoomMax=")
                .append(c.zoom.validatedSafeZoomMax?.toString() ?: "null(not validated)").append('\n')
            sb.append("  flash=").append(c.hasFlashUnit?.toString() ?: "unknown")
                .append(" hwLevel=").append(c.hardwareLevel ?: "unknown")
                .append(" sensorOrientation=")
                .append(c.sensorOrientationDegrees?.toString() ?: "unknown").append('\n')
            sb.append("  capabilities=")
                .append(if (c.availableCapabilities.isEmpty()) "unknown" else c.availableCapabilities.joinToString(","))
                .append('\n')
            sb.append("  proposedMettleRole=").append(c.proposedRole.name)
                .append(" hardwareExposed=").append(c.hardwareExposed)
                .append(" sessionUsability=").append(c.sessionUsability.name).append('\n')
            if (c.notes.isNotEmpty()) {
                sb.append("  notes=").append(c.notes.joinToString("; ")).append('\n')
            }
        }
        return sb.toString()
    }

    @Suppress("InlinedApi") // capability constants are compile-time ints; runtime is guarded where it matters
    private fun readCamera(manager: CameraManager, id: String): CameraCapability {
        val chars = try {
            manager.getCameraCharacteristics(id)
        } catch (e: Exception) {
            Log.w(TAG, "getCameraCharacteristics($id) failed: ${e.javaClass.simpleName}")
            return CameraCapability(cameraId = id, notes = listOf("characteristics unavailable"))
        }
        val notes = mutableListOf<String>()

        val facing = when (chars.get(CameraCharacteristics.LENS_FACING)) {
            CameraMetadata.LENS_FACING_FRONT -> LensFacing.FRONT
            CameraMetadata.LENS_FACING_BACK -> LensFacing.BACK
            CameraMetadata.LENS_FACING_EXTERNAL -> LensFacing.EXTERNAL
            else -> LensFacing.UNKNOWN
        }

        val focal = chars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.toList()
            ?: emptyList()
        val minFocus = chars.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE)
        val hyperfocal = chars.get(CameraCharacteristics.LENS_INFO_HYPERFOCAL_DISTANCE)
        val hasFlash = chars.get(CameraCharacteristics.FLASH_INFO_AVAILABLE)

        val capInts = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)?.toList()
            ?: emptyList()
        val capNames = capInts.map { capabilityName(it) }
        val rawSupported = capInts.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_RAW)
        val depthSupported =
            capInts.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_DEPTH_OUTPUT)

        val hwLevel = hardwareLevelName(chars.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL))
        val sensorOrientation = chars.get(CameraCharacteristics.SENSOR_ORIENTATION)
        val activeArray = chars.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
            ?.let { "${it.width()}x${it.height()}" }
        val pixelArray = chars.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
            ?.let { "${it.width}x${it.height}" }

        val afModes = chars.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)?.toList()
            ?: emptyList()
        val oisModes =
            chars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION)?.toList()
                ?: emptyList()
        val visModes =
            chars.get(CameraCharacteristics.CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES)?.toList()
                ?: emptyList()
        val fpsRanges =
            chars.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
                ?.map { FpsRangeSummary(it.lower, it.upper) } ?: emptyList()

        val maxDigitalZoom = chars.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM)
        var zoomMin: Float? = null
        var zoomMax: Float? = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            chars.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)?.let { range ->
                zoomMin = range.lower
                zoomMax = range.upper
            }
        }

        var isLogical: Boolean? = null
        var physicalIds: List<String> = emptyList()
        var logicalMultiSupported: Boolean? = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            logicalMultiSupported = capInts.contains(
                CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA
            )
            physicalIds = try {
                chars.physicalCameraIds.toList()
            } catch (e: Exception) {
                notes.add("physicalCameraIds read failed: ${e.javaClass.simpleName}")
                emptyList()
            }
            isLogical = logicalMultiSupported == true || physicalIds.isNotEmpty()
        }

        return CameraCapability(
            cameraId = id,
            lensFacing = facing,
            isLogicalCamera = isLogical,
            physicalCameraIds = physicalIds,
            focalLengthsMm = focal,
            minimumFocusDistanceDiopters = minFocus,
            hyperfocalDistanceDiopters = hyperfocal,
            zoom = SafeZoomEnvelope(
                hardwareZoomRatioMin = zoomMin,
                hardwareZoomRatioMax = zoomMax,
                hardwareMaxDigitalZoom = maxDigitalZoom,
                validatedSafeZoomMax = null, // CAM1-A never validates a Mettle zoom ceiling
                runtimeSafeZoomMax = null
            ),
            hasFlashUnit = hasFlash,
            // Torch needs a flash unit; anything finer is UNKNOWN-safe until a session proves it.
            supportsTorch = hasFlash,
            outputSizes = summariseOutputSizes(chars, notes),
            fpsRanges = fpsRanges,
            hardwareLevel = hwLevel,
            sensorOrientationDegrees = sensorOrientation,
            activeArraySize = activeArray,
            pixelArraySize = pixelArray,
            availableCapabilities = capNames,
            autofocusModes = afModes,
            opticalStabilizationModes = oisModes,
            videoStabilizationModes = visModes,
            rawSupported = rawSupported,
            depthSupported = depthSupported,
            logicalMultiCameraSupported = logicalMultiSupported,
            hardwareExposed = true,
            sessionUsability = SessionUsability.UNKNOWN,
            proposedRole = MettleCameraRole.UNKNOWN, // filled in by CameraRoleInference
            notes = notes.toList()
        )
    }

    private fun summariseOutputSizes(
        chars: CameraCharacteristics,
        notes: MutableList<String>
    ): List<OutputSizeSummary> {
        val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
        if (map == null) {
            notes.add("no stream configuration map")
            return emptyList()
        }
        val formats = listOf(
            "JPEG" to ImageFormat.JPEG,
            "YUV_420_888" to ImageFormat.YUV_420_888,
            "PRIVATE" to ImageFormat.PRIVATE
        )
        return formats.mapNotNull { (name, fmt) ->
            val sizes = try {
                map.getOutputSizes(fmt)
            } catch (e: Exception) {
                null
            }
            if (sizes == null || sizes.isEmpty()) {
                null
            } else {
                val largest = sizes.maxByOrNull { it.width.toLong() * it.height.toLong() }
                OutputSizeSummary(name, sizes.size, largest?.width, largest?.height)
            }
        }
    }

    @Suppress("InlinedApi")
    private fun capabilityName(value: Int): String = when (value) {
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_BACKWARD_COMPATIBLE -> "BACKWARD_COMPATIBLE"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR -> "MANUAL_SENSOR"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_POST_PROCESSING -> "MANUAL_POST_PROCESSING"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_RAW -> "RAW"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_PRIVATE_REPROCESSING -> "PRIVATE_REPROCESSING"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_READ_SENSOR_SETTINGS -> "READ_SENSOR_SETTINGS"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_BURST_CAPTURE -> "BURST_CAPTURE"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_YUV_REPROCESSING -> "YUV_REPROCESSING"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_DEPTH_OUTPUT -> "DEPTH_OUTPUT"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_CONSTRAINED_HIGH_SPEED_VIDEO -> "CONSTRAINED_HIGH_SPEED_VIDEO"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MOTION_TRACKING -> "MOTION_TRACKING"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA -> "LOGICAL_MULTI_CAMERA"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MONOCHROME -> "MONOCHROME"
        else -> "CAP_$value"
    }

    private fun hardwareLevelName(value: Int?): String? = when (value) {
        null -> null
        CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY -> "LEGACY"
        CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED -> "LIMITED"
        CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_FULL -> "FULL"
        CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_3 -> "LEVEL_3"
        CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_EXTERNAL -> "EXTERNAL"
        else -> "LEVEL_$value"
    }

    private companion object {
        const val TAG = "CameraCapCensus"
    }
}
