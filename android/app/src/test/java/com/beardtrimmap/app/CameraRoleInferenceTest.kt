package com.beardtrimmap.app

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * CAM1-A — deterministic unit tests for the PURE Mettle role-inference logic.
 *
 * These exercise [CameraRoleInference] only: plain data classes in, an enum out. No Android
 * runtime, no device, no camera IDs baked into expectations.
 */
class CameraRoleInferenceTest {

    private fun cam(
        id: String,
        facing: LensFacing,
        focal: List<Float> = emptyList(),
        minFocus: Float? = null,
        logical: Boolean? = null
    ) = CameraCapability(
        cameraId = id,
        lensFacing = facing,
        focalLengthsMm = focal,
        minimumFocusDistanceDiopters = minFocus,
        isLogicalCamera = logical
    )

    @Test
    fun frontCameraIsFrontSelf() {
        val front = cam("1", LensFacing.FRONT, listOf(2.7f))
        assertEquals(
            MettleCameraRole.FRONT_SELF,
            CameraRoleInference.inferRole(front, listOf(front))
        )
    }

    @Test
    fun loneRearIsGeneral() {
        val rear = cam("0", LensFacing.BACK, listOf(4.3f))
        assertEquals(
            MettleCameraRole.REAR_GENERAL,
            CameraRoleInference.inferRole(rear, listOf(rear))
        )
    }

    @Test
    fun shortestRearFocalIsWideCandidate() {
        val general = cam("0", LensFacing.BACK, listOf(4.3f))
        val wide = cam("2", LensFacing.BACK, listOf(1.8f))
        val tele = cam("3", LensFacing.BACK, listOf(7.0f))
        val all = listOf(general, wide, tele)
        assertEquals(MettleCameraRole.REAR_WIDE, CameraRoleInference.inferRole(wide, all))
    }

    @Test
    fun longestRearFocalIsDetailCandidate() {
        val general = cam("0", LensFacing.BACK, listOf(4.3f))
        val wide = cam("2", LensFacing.BACK, listOf(1.8f))
        val tele = cam("3", LensFacing.BACK, listOf(7.0f))
        val all = listOf(general, wide, tele)
        assertEquals(MettleCameraRole.REAR_DETAIL, CameraRoleInference.inferRole(tele, all))
    }

    @Test
    fun medianRearIsGeneral() {
        val general = cam("0", LensFacing.BACK, listOf(4.3f))
        val wide = cam("2", LensFacing.BACK, listOf(1.8f))
        val tele = cam("3", LensFacing.BACK, listOf(7.0f))
        val all = listOf(general, wide, tele)
        assertEquals(MettleCameraRole.REAR_GENERAL, CameraRoleInference.inferRole(general, all))
    }

    @Test
    fun nearEqualExtraRearIsAuxiliaryNotGuessed() {
        val a = cam("0", LensFacing.BACK, listOf(4.0f))
        val ref = cam("1", LensFacing.BACK, listOf(4.3f))
        val b = cam("2", LensFacing.BACK, listOf(4.6f))
        val all = listOf(a, ref, b)
        assertEquals(MettleCameraRole.AUXILIARY, CameraRoleInference.inferRole(b, all))
    }

    @Test
    fun extraRearWithoutFocalIsAuxiliary() {
        val general = cam("0", LensFacing.BACK, listOf(4.3f))
        val unknown = cam("6", LensFacing.BACK, emptyList())
        val filler = cam("7", LensFacing.BACK, listOf(4.3f))
        val all = listOf(general, unknown, filler)
        assertEquals(MettleCameraRole.AUXILIARY, CameraRoleInference.inferRole(unknown, all))
    }

    @Test
    fun closeFocusEvidenceGivesCloseFocusRole() {
        val general = cam("0", LensFacing.BACK, listOf(4.3f))
        val macro = cam("8", LensFacing.BACK, listOf(4.0f), minFocus = 14.0f)
        val filler = cam("9", LensFacing.BACK, listOf(4.3f))
        val all = listOf(general, macro, filler)
        assertEquals(
            MettleCameraRole.REAR_CLOSE_FOCUS,
            CameraRoleInference.inferRole(macro, all)
        )
    }

    @Test
    fun teleWithoutCloseFocusIsNotCloseFocus() {
        val general = cam("0", LensFacing.BACK, listOf(4.3f))
        val tele = cam("3", LensFacing.BACK, listOf(7.0f), minFocus = 2.0f)
        val filler = cam("9", LensFacing.BACK, listOf(4.3f))
        val all = listOf(general, tele, filler)
        assertEquals(MettleCameraRole.REAR_DETAIL, CameraRoleInference.inferRole(tele, all))
    }

    @Test
    fun unknownFacingIsUnknown() {
        val c = cam("x", LensFacing.UNKNOWN)
        assertEquals(MettleCameraRole.UNKNOWN, CameraRoleInference.inferRole(c, listOf(c)))
    }

    @Test
    fun externalFacingIsAuxiliary() {
        val c = cam("y", LensFacing.EXTERNAL)
        assertEquals(MettleCameraRole.AUXILIARY, CameraRoleInference.inferRole(c, listOf(c)))
    }

    @Test
    fun logicalRearIsPreferredAsReference() {
        val logical = cam("0", LensFacing.BACK, listOf(6.0f), logical = true)
        val physicalWide = cam("2", LensFacing.BACK, listOf(1.8f))
        val all = listOf(logical, physicalWide)
        assertEquals(MettleCameraRole.REAR_GENERAL, CameraRoleInference.inferRole(logical, all))
        assertEquals(MettleCameraRole.REAR_WIDE, CameraRoleInference.inferRole(physicalWide, all))
    }

    @Test
    fun withProposedRolesFillsEveryCamera() {
        val front = cam("1", LensFacing.FRONT, listOf(2.7f))
        val rear = cam("0", LensFacing.BACK, listOf(4.3f))
        val roles = CameraRoleInference.withProposedRoles(listOf(front, rear)).map { it.proposedRole }
        assertEquals(
            listOf(MettleCameraRole.FRONT_SELF, MettleCameraRole.REAR_GENERAL),
            roles
        )
    }
}
