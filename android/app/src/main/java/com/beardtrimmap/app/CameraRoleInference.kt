package com.beardtrimmap.app

/**
 * CAM1-A — conservative, evidence-only Mettle role inference.
 *
 * Pure functions over [CameraCapability]. No Android imports, no device access, no camera
 * IDs, no vendor names, no marketing-term matching ("ultra-wide" / "tele" / "macro" are
 * never read from a display name). When the evidence is thin the answer is
 * [MettleCameraRole.UNKNOWN] or [MettleCameraRole.AUXILIARY], never a guess.
 *
 * The results are proposals for the diagnostic census only. CAM1-A wires nothing into
 * `switchCamera()` / `switchLiveCamera()` / ARCore selection / ML Kit binding.
 */
object CameraRoleInference {

    /**
     * A rear lens must diverge from the rear-general reference by at least this ratio on
     * focal length before it is called [MettleCameraRole.REAR_WIDE] or
     * [MettleCameraRole.REAR_DETAIL]. Kept deliberately loose so near-identical lenses fall
     * through to [MettleCameraRole.AUXILIARY].
     */
    private const val FOCAL_DIVERGENCE_RATIO = 1.15f

    /**
     * Minimum-focus distance (in diopters; higher == focuses closer) above which a lens
     * focuses meaningfully closer than a typical general camera. Evidence of a close-focus
     * lens, not proof — and only ever applied alongside a non-tele focal length.
     */
    private const val CLOSE_FOCUS_DIOPTER_HINT = 10.0f

    /** Shortest reported focal length, treated as the lens's representative value. */
    fun representativeFocalLength(cap: CameraCapability): Float? = cap.focalLengthsMm.minOrNull()

    /**
     * Propose a role for [cap] given the full census [all] (needed to compare rear lenses to
     * one another).
     *
     *  - Front-facing camera -> [MettleCameraRole.FRONT_SELF]
     *  - External camera     -> [MettleCameraRole.AUXILIARY]
     *  - Unknown facing       -> [MettleCameraRole.UNKNOWN]
     *  - Only rear camera     -> [MettleCameraRole.REAR_GENERAL]
     *  - Extra rear cameras   -> classified only when focal / focus evidence is clear,
     *                            otherwise [MettleCameraRole.AUXILIARY]
     */
    fun inferRole(cap: CameraCapability, all: List<CameraCapability>): MettleCameraRole {
        when (cap.lensFacing) {
            LensFacing.FRONT -> return MettleCameraRole.FRONT_SELF
            LensFacing.EXTERNAL -> return MettleCameraRole.AUXILIARY
            LensFacing.UNKNOWN -> return MettleCameraRole.UNKNOWN
            LensFacing.BACK -> Unit
        }

        val rears = all.filter { it.lensFacing == LensFacing.BACK }
        if (rears.size <= 1) return MettleCameraRole.REAR_GENERAL

        // The rear "workhorse" reference: a logical camera if one is advertised, otherwise
        // the rear whose focal length is the median of the group. Lenses without a reported
        // focal length sort last so they never become the reference.
        val reference = rears.firstOrNull { it.isLogicalCamera == true }
            ?: rears.sortedBy { representativeFocalLength(it) ?: Float.MAX_VALUE }
                .let { sorted -> sorted[sorted.size / 2] }

        if (cap.cameraId != null && cap.cameraId == reference.cameraId) {
            return MettleCameraRole.REAR_GENERAL
        }

        val refFocal = representativeFocalLength(reference)
        val myFocal = representativeFocalLength(cap)

        // Close-focus evidence first, and only from real focus characteristics.
        val minFocus = cap.minimumFocusDistanceDiopters
        if (minFocus != null && minFocus >= CLOSE_FOCUS_DIOPTER_HINT &&
            (refFocal == null || myFocal == null || myFocal <= refFocal)
        ) {
            return MettleCameraRole.REAR_CLOSE_FOCUS
        }

        if (refFocal == null || myFocal == null || refFocal <= 0f || myFocal <= 0f) {
            return MettleCameraRole.AUXILIARY
        }

        return when {
            myFocal <= refFocal / FOCAL_DIVERGENCE_RATIO -> MettleCameraRole.REAR_WIDE
            myFocal >= refFocal * FOCAL_DIVERGENCE_RATIO -> MettleCameraRole.REAR_DETAIL
            else -> MettleCameraRole.AUXILIARY
        }
    }

    /** Return [all] with [CameraCapability.proposedRole] filled in for every entry. */
    fun withProposedRoles(all: List<CameraCapability>): List<CameraCapability> =
        all.map { it.copy(proposedRole = inferRole(it, all)) }
}
