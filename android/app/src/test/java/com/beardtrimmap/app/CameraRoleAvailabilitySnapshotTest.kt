package com.beardtrimmap.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * CORE-CAM1-B0.1 — the normalized native->JS capability snapshot.
 *
 * Drives `CameraRoleResolver.resolve()` with SYNTHETIC FIXTURE censuses (never real camera
 * hardware) and asserts the pure `Map` that `CameraRoleAvailabilitySnapshot` hands to the
 * bridge. Pure JVM (`org.junit`), no Android runtime. None of this proves anything about a
 * physical S25 Ultra — that is the later CORE-CAM1-B physical census.
 */
class CameraRoleAvailabilitySnapshotTest {

    private fun front(id: String = "SYNTH-FRONT") =
        CameraCapability(cameraId = id, lensFacing = LensFacing.FRONT, focalLengthsMm = listOf(2.7f))

    private fun rear(
        id: String = "SYNTH-REAR",
        flash: Boolean? = true,
        zoom: SafeZoomEnvelope = SafeZoomEnvelope()
    ) = CameraCapability(
        cameraId = id, lensFacing = LensFacing.BACK, focalLengthsMm = listOf(4.3f),
        hasFlashUnit = flash, supportsTorch = flash, zoom = zoom
    )

    private fun snapshot(vararg cams: CameraCapability, api: Int = 34, errors: List<String> = emptyList()): Map<String, Any?> {
        val census = CameraCensus(CameraRoleInference.withProposedRoles(cams.toList()), api, errors)
        return CameraRoleAvailabilitySnapshot.of(CameraRoleResolver.resolve(census), census.apiLevel, census.errors.firstOrNull())
    }

    @Suppress("UNCHECKED_CAST")
    private fun zoomOf(m: Map<String, Any?>) = m["assistedZoom"] as Map<String, Any?>

    // ---- A: front + rear -> SELF and ASSISTED available ----
    @Test
    fun caseA_frontPlusRear_bothAvailable() {
        val m = snapshot(front(), rear(flash = true, zoom = SafeZoomEnvelope(hardwareZoomRatioMin = 0.6f, hardwareZoomRatioMax = 8f)))
        assertEquals(1, m["contractVersion"])
        assertEquals(true, m["nativeAuthority"])
        assertEquals(true, m["selfAvailable"])
        assertEquals(true, m["assistedAvailable"])
        assertEquals("EDGE_LIGHT", m["selfLighting"])
        assertEquals("TORCH", m["assistedLighting"])
        assertEquals(true, zoomOf(m)["hardwareSupported"])
        assertEquals(false, zoomOf(m)["runtimeAllowed"])
        assertNull("runtime min omitted (null)", zoomOf(m)["runtimeAllowedMin"])
        assertNull("runtime max omitted (null)", zoomOf(m)["runtimeAllowedMax"])
        assertTrue((m["exclusions"] as List<*>).isEmpty())
    }

    // ---- B: front-only -> SELF available, ASSISTED false ----
    @Test
    fun caseB_frontOnly_assistedFalse() {
        val m = snapshot(front())
        assertEquals(true, m["selfAvailable"])
        assertEquals(false, m["assistedAvailable"])
        assertEquals("EDGE_LIGHT", m["selfLighting"])
        assertEquals("NONE", m["assistedLighting"])
        assertTrue((m["exclusions"] as List<*>).any { (it as String).contains("ASSISTED unavailable") })
    }

    // ---- C: rear-only -> SELF false, ASSISTED available ----
    @Test
    fun caseC_rearOnly_selfFalse() {
        val m = snapshot(rear(flash = true))
        assertEquals(false, m["selfAvailable"])
        assertEquals(true, m["assistedAvailable"])
        assertEquals("NONE", m["selfLighting"])
        assertEquals("TORCH", m["assistedLighting"])
        assertTrue((m["exclusions"] as List<*>).any { (it as String).contains("SELF unavailable") })
    }

    // ---- D: rear without torch -> ASSISTED available, lighting NONE ----
    @Test
    fun caseD_rearNoFlash_assistedYesTorchNone() {
        val m = snapshot(front(), rear(flash = false))
        assertEquals(true, m["assistedAvailable"])
        assertEquals("NONE", m["assistedLighting"])
        assertTrue((m["exclusions"] as List<*>).any { (it as String).contains("torch unavailable") })
    }

    // ---- E: no cameras -> both unavailable, no throw ----
    @Test
    fun caseE_noCameras_bothUnavailable() {
        val m = snapshot()
        assertEquals(false, m["selfAvailable"])
        assertEquals(false, m["assistedAvailable"])
        assertEquals("NONE", m["selfLighting"])
        assertEquals("NONE", m["assistedLighting"])
        assertTrue((m["exclusions"] as List<*>).isNotEmpty())
    }

    // ---- F: census failure -> fail closed, no implicit both-camera assumption ----
    @Test
    fun caseF_censusFailure_failsClosed() {
        val m = CameraRoleAvailabilitySnapshot.failed("SecurityException")
        assertEquals(1, m["contractVersion"])
        assertEquals(true, m["nativeAuthority"])
        assertEquals(false, m["selfAvailable"])
        assertEquals(false, m["assistedAvailable"])
        assertEquals("NONE", m["selfLighting"])
        assertEquals("NONE", m["assistedLighting"])
        assertEquals(false, zoomOf(m)["hardwareSupported"])
        assertEquals(false, zoomOf(m)["runtimeAllowed"])
        assertEquals("SecurityException", m["censusError"])
        assertTrue((m["exclusions"] as List<*>).any { (it as String).contains("authority failed") })
    }

    @Test
    fun caseF2_resolverOverErrorCensus_failsClosed() {
        val broken = CameraCapability(cameraId = "BROKEN", lensFacing = LensFacing.UNKNOWN, notes = listOf("characteristics unavailable"))
        val m = snapshot(broken, api = 21, errors = listOf("getCameraCharacteristics failed"))
        assertEquals(false, m["selfAvailable"])
        assertEquals(false, m["assistedAvailable"])
        assertEquals("getCameraCharacteristics failed", m["censusError"])
    }

    // ---- G: hardware zoom present but runtimeAllowed=false -> zoom UI must NOT be exposed ----
    @Test
    fun caseG_hardwareZoomButRuntimeDisallowed() {
        val m = snapshot(front(), rear(flash = true, zoom = SafeZoomEnvelope(hardwareZoomRatioMin = 0.5f, hardwareZoomRatioMax = 100f)))
        assertEquals(true, zoomOf(m)["hardwareSupported"])
        assertEquals(false, zoomOf(m)["runtimeAllowed"])
        assertNull(zoomOf(m)["runtimeAllowedMax"])
        // No validated/runtime ceiling ever auto-derived from the hardware maximum (100x here).
    }

    // ---- extra: snapshot omits camera ids entirely ----
    @Test
    fun snapshotCarriesNoCameraIds() {
        val m = snapshot(front("FRONT-XYZ"), rear("REAR-XYZ", flash = true))
        val flat = m.toString()
        assertFalse(flat.contains("FRONT-XYZ"))
        assertFalse(flat.contains("REAR-XYZ"))
        assertFalse(m.containsKey("selfCameraId"))
        assertFalse(m.containsKey("assistedCameraId"))
    }
}
