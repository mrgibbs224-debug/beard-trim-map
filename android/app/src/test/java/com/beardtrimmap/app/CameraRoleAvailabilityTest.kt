package com.beardtrimmap.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * CORE-CAM1-B0 — offline camera-role-availability harness.
 *
 * Exercises [CameraRoleResolver] only: plain [CameraCensus] data in, a [CameraRoleAvailability]
 * out. NO Android runtime, NO device, NO real camera enumeration. Every camera below is a
 * SYNTHETIC FIXTURE and is labelled as such — none of this proves anything about a physical
 * S25 Ultra (that is the later CORE-CAM1-B physical census).
 *
 * Fixture cameras follow the CAM1-A [CameraCapability] contract: any value Android could not
 * guarantee is left null / empty / UNKNOWN.
 */
class CameraRoleAvailabilityTest {

    // ---- synthetic fixture builders (clearly not real hardware) ----

    private fun synthFront(id: String = "SYNTH-FRONT", flash: Boolean? = false) = CameraCapability(
        cameraId = id,
        lensFacing = LensFacing.FRONT,
        focalLengthsMm = listOf(2.7f),
        hasFlashUnit = flash,
        supportsTorch = flash
    )

    private fun synthRear(
        id: String = "SYNTH-REAR",
        flash: Boolean? = true,
        focal: List<Float> = listOf(4.3f),
        logical: Boolean? = null,
        physical: List<String> = emptyList(),
        zoom: SafeZoomEnvelope = SafeZoomEnvelope(),
        proposedRole: MettleCameraRole = MettleCameraRole.UNKNOWN,
        hardwareExposed: Boolean = true,
        sessionUsability: SessionUsability = SessionUsability.UNKNOWN
    ) = CameraCapability(
        cameraId = id,
        lensFacing = LensFacing.BACK,
        focalLengthsMm = focal,
        isLogicalCamera = logical,
        physicalCameraIds = physical,
        hasFlashUnit = flash,
        supportsTorch = flash,
        zoom = zoom,
        proposedRole = proposedRole,
        hardwareExposed = hardwareExposed,
        sessionUsability = sessionUsability
    )

    private fun census(vararg cams: CameraCapability, api: Int = 34, errors: List<String> = emptyList()) =
        CameraCensus(CameraRoleInference.withProposedRoles(cams.toList()), api, errors)

    // ---- CASE A — typical phone: front + rear, rear torch, zoom ----
    @Test
    fun caseA_typicalPhone_bothRolesTorchAndZoom() {
        val r = CameraRoleResolver.resolve(
            census(
                synthFront(),
                synthRear(
                    id = "REAR-LOGICAL", flash = true, logical = true, physical = listOf("P1", "P2"),
                    zoom = SafeZoomEnvelope(hardwareZoomRatioMin = 0.6f, hardwareZoomRatioMax = 10.0f)
                )
            )
        )
        assertTrue(r.selfAvailable)
        assertTrue(r.assistedAvailable)
        assertEquals(RoleLighting.EDGE_LIGHT, r.selfLighting)
        assertEquals(RoleLighting.TORCH, r.assistedLighting)
        assertEquals("REAR-LOGICAL", r.assistedCameraId)
        assertTrue(r.assistedZoom.hardwareSupported)
        assertEquals(10.0f, r.assistedZoom.hardwareMax)
        assertFalse("CAM1-B0 never runtime-allows zoom", r.assistedZoom.runtimeAllowed)
        assertNull(r.assistedZoom.runtimeAllowedMax)
        assertTrue(r.exclusions.isEmpty())
    }

    // ---- CASE B — front-only device: SELF yes, ASSISTED no ----
    @Test
    fun caseB_frontOnly_selfYesAssistedNo() {
        val r = CameraRoleResolver.resolve(census(synthFront()))
        assertTrue(r.selfAvailable)
        assertFalse(r.assistedAvailable)
        assertEquals(RoleLighting.EDGE_LIGHT, r.selfLighting)
        assertEquals(RoleLighting.NONE, r.assistedLighting)
        assertNull(r.assistedCameraId)
        assertTrue(r.exclusions.any { it.contains("ASSISTED unavailable") })
    }

    // ---- CASE C — rear-only device: SELF no, ASSISTED yes ----
    @Test
    fun caseC_rearOnly_selfNoAssistedYes() {
        val r = CameraRoleResolver.resolve(census(synthRear(flash = true)))
        assertFalse(r.selfAvailable)
        assertTrue(r.assistedAvailable)
        assertEquals(RoleLighting.NONE, r.selfLighting)
        assertEquals(RoleLighting.TORCH, r.assistedLighting)
        assertNull(r.selfCameraId)
        assertTrue(r.exclusions.any { it.contains("SELF unavailable") })
    }

    // ---- CASE D — rear without torch: ASSISTED yes, torch unavailable ----
    @Test
    fun caseD_rearNoFlash_assistedYesTorchNone() {
        val r = CameraRoleResolver.resolve(census(synthFront(), synthRear(flash = false)))
        assertTrue(r.selfAvailable)
        assertTrue(r.assistedAvailable)
        assertEquals(RoleLighting.NONE, r.assistedLighting)
        assertTrue(r.exclusions.any { it.contains("torch unavailable") })
    }

    // ---- CASE E — multiple rear lenses: role inference does NOT rely on a hard-coded id ----
    @Test
    fun caseE_multiRear_referenceChosenByEvidenceNotId() {
        // The "general" lens is id "7" (not "0"/"1"/"2"); a wide is "0" and a tele is "3".
        val wide = synthRear(id = "0", focal = listOf(1.8f))
        val general = synthRear(id = "7", focal = listOf(4.3f))
        val tele = synthRear(id = "3", focal = listOf(7.0f))
        val r = CameraRoleResolver.resolve(census(synthFront(), wide, general, tele))
        assertTrue(r.assistedAvailable)
        // Resolver must land on the evidence-proposed REAR_GENERAL ("7"), never the lowest string id.
        assertEquals("7", r.assistedCameraId)
    }

    // ---- CASE F — malformed / unknown metadata: fail gracefully, no throw ----
    @Test
    fun caseF_malformedMetadata_failsGracefully() {
        val junk = CameraCapability(
            cameraId = "BROKEN",
            lensFacing = LensFacing.UNKNOWN,
            notes = listOf("characteristics unavailable")
        )
        val r = CameraRoleResolver.resolve(
            CameraCensus(listOf(junk), apiLevel = 21, errors = listOf("getCameraCharacteristics failed"))
        )
        assertFalse(r.selfAvailable)
        assertFalse(r.assistedAvailable)
        assertEquals(RoleLighting.NONE, r.selfLighting)
        assertEquals(RoleLighting.NONE, r.assistedLighting)
        assertTrue(r.exclusions.isNotEmpty())
    }

    @Test
    fun caseF2_nullOrEmptyCensus_failsGracefully() {
        val fromNull = CameraRoleResolver.resolve(null)
        val fromEmpty = CameraRoleResolver.resolve(CameraCensus(emptyList(), apiLevel = 34))
        listOf(fromNull, fromEmpty).forEach {
            assertFalse(it.selfAvailable)
            assertFalse(it.assistedAvailable)
            assertTrue(it.exclusions.isNotEmpty())
        }
    }

    // ---- CASE G — zoom unsupported: no zoom feature ----
    @Test
    fun caseG_zoomUnsupported_noZoomFeature() {
        val r = CameraRoleResolver.resolve(
            census(synthFront(), synthRear(flash = true, zoom = SafeZoomEnvelope()))
        )
        assertTrue(r.assistedAvailable)
        assertFalse(r.assistedZoom.hardwareSupported)
        assertFalse(r.assistedZoom.runtimeAllowed)
        assertNull(r.assistedZoom.hardwareMax)
        assertTrue(r.exclusions.any { it.contains("no usable zoom range") })
    }

    // ---- CASE H — unusual zoom range: hardware value is surfaced, runtime stays disallowed ----
    @Test
    fun caseH_unusualZoomRange_runtimeStaysDisallowed() {
        val r = CameraRoleResolver.resolve(
            census(
                synthFront(),
                synthRear(
                    flash = true,
                    zoom = SafeZoomEnvelope(
                        hardwareZoomRatioMin = 0.5f,
                        hardwareZoomRatioMax = 100.0f,
                        hardwareMaxDigitalZoom = 32.0f
                    )
                )
            )
        )
        assertTrue(r.assistedZoom.hardwareSupported)
        assertEquals(100.0f, r.assistedZoom.hardwareMax)
        // No validated/runtime ceiling has been decided -> nothing is runtime-allowed regardless
        // of how large the hardware range is.
        assertFalse(r.assistedZoom.runtimeAllowed)
        assertNull(r.assistedZoom.runtimeAllowedMax)
        assertNull(r.assistedZoom.validatedSafeMax)
    }

    // ---- CASE I — logical multi-camera: pick the logical rear, don't expose physical members ----
    @Test
    fun caseI_logicalMultiCamera_picksLogicalNotPhysicalMembers() {
        val logical = synthRear(id = "0", flash = true, focal = listOf(6.0f), logical = true, physical = listOf("1", "2", "3"))
        val physWide = synthRear(id = "1", focal = listOf(1.8f))
        val physTele = synthRear(id = "2", focal = listOf(7.0f))
        val physDepth = synthRear(id = "3", focal = emptyList())
        val r = CameraRoleResolver.resolve(census(synthFront(), logical, physWide, physTele, physDepth))
        assertTrue(r.assistedAvailable)
        // Exactly one ASSISTED rear reference, and it is the logical camera.
        assertEquals("0", r.assistedCameraId)
    }

    // ---- extra: hardwareExposed=false / sessionUsability=UNAVAILABLE excludes a lens ----
    @Test
    fun unusableFlaggedLens_isExcluded() {
        val r = CameraRoleResolver.resolve(
            census(
                synthFront(),
                synthRear(id = "REAR-A", flash = true, hardwareExposed = false),
                synthRear(id = "REAR-B", flash = false, sessionUsability = SessionUsability.UNAVAILABLE)
            )
        )
        // Both rears are flagged unusable -> ASSISTED not offered.
        assertFalse(r.assistedAvailable)
        assertNull(r.assistedCameraId)
    }

    // ---- extra: clean both-roles case has no exclusions ----
    @Test
    fun cleanBothRoles_noExclusions() {
        val r = CameraRoleResolver.resolve(
            census(
                synthFront(),
                synthRear(flash = true, proposedRole = MettleCameraRole.REAR_GENERAL,
                    zoom = SafeZoomEnvelope(hardwareZoomRatioMin = 1.0f, hardwareZoomRatioMax = 8.0f))
            )
        )
        assertTrue(r.selfAvailable && r.assistedAvailable)
        assertEquals(RoleLighting.EDGE_LIGHT, r.selfLighting)
        assertEquals(RoleLighting.TORCH, r.assistedLighting)
        assertTrue(r.exclusions.isEmpty())
    }
}
