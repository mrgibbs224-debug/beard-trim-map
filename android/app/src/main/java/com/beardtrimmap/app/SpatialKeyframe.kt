package com.beardtrimmap.app

import org.json.JSONArray
import org.json.JSONObject

// Stage A6.0A: a Tier-B spatial observation keyframe whose image and geometry are acquired
// synchronously from the SAME ARCore Frame/Camera objects inside
// ArCoreFaceMeshTracker.processFrame(), eliminating the async request/response frame-gap race
// that Stage A6.0 measured at ~4% coherence (frame.acquireCameraImage() can only be called on
// the current frame -- it throws DeadlineExceededException otherwise, which is exactly the
// guarantee this depends on). Deliberately a separate type and bridge path from TrackingPacket --
// the LOCKED production packet schema/routing (Stage A4 Hybrid activation, 43-point canonical
// fusion, freshness/coverage gating, etc.) is completely untouched by this file.
data class SpatialKeyframeResult(
    val requestId: String,
    // "VERIFIED_EXACT" (image acquired from the identical Frame that produced this geometry) or
    // "REJECTED_UNMATCHED" (acquireCameraImage/conversion failed -- never fabricate a pairing).
    val coherenceStatus: String,
    val rejectReason: String? = null,
    val nativeFrameTimestampNs: Long? = null,
    val imageBase64Jpeg: String? = null,
    val imageWidth: Int? = null,
    val imageHeight: Int? = null,
    // The image is the raw sensor-orientation YUV_420_888 buffer re-encoded to JPEG with no
    // rotation or mirroring applied, so it stays pixel-for-pixel consistent with intrinsicsSpace
    // below. It may appear sideways relative to the app's on-screen portrait display -- that is
    // expected, not a bug, since intrinsics/image/camera-space math are all in this same raw frame.
    val imageRotationDegrees: Int = 0,
    val imageMirrored: Boolean = false,
    val intrinsicsFx: Float? = null,
    val intrinsicsFy: Float? = null,
    val intrinsicsCx: Float? = null,
    val intrinsicsCy: Float? = null,
    val intrinsicsImageWidth: Int? = null,
    val intrinsicsImageHeight: Int? = null,
    // Always "IMAGE" (Camera.getImageIntrinsics(), unrotated CPU-image space, matching
    // imageBase64Jpeg's own pixel buffer exactly) -- never "TEXTURE"
    // (Camera.getTextureIntrinsics(), the GPU preview-texture space), since mixing the two
    // without a proven transform was explicitly ruled out for this stage.
    val intrinsicsSpace: String = "IMAGE",
    val landmarks2D: List<TrackingPoint>? = null,
    val faceLocal3D: List<FaceLocalPoint3D>? = null,
    // Existing production MVP matrix (model*view*projection, includes the front-camera mirror
    // flip baked into the projection step) -- same value already sent in TrackingPacket, repeated
    // here only so a keyframe is self-contained without cross-referencing a separate packet.
    val transformationMatrix: List<Float>? = null,
    // Stage A6.0A addition: camera-space transform in the SAME frame as the raw image and
    // intrinsics above -- built from Camera.getPose() (the physical, image-oriented pose used by
    // acquireCameraImage()/getImageIntrinsics()), NOT Camera.getViewMatrix() (which ARCore's own
    // javadoc says is display-oriented, i.e. rotated relative to the raw image by a multiple of
    // 90 degrees). Enables a real intrinsics-based 3D->2D projection onto the raw image above --
    // something the projection-inclusive, display-oriented transformationMatrix cannot do.
    val imageSpaceViewModelMatrix: List<Float>? = null,
    val poseYawDeg: Float? = null,
    val posePitchDeg: Float? = null,
    val poseRollDeg: Float? = null,
    val faceCameraX: Float? = null,
    val faceCameraY: Float? = null,
    val faceCameraZ: Float? = null,
    val captureLatencyMs: Long? = null
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("requestId", requestId)
        put("coherenceStatus", coherenceStatus)
        put("rejectReason", rejectReason ?: JSONObject.NULL)
        put("nativeFrameTimestampNs", nativeFrameTimestampNs?.toString() ?: JSONObject.NULL)
        put("imageBase64Jpeg", imageBase64Jpeg ?: JSONObject.NULL)
        put("imageWidth", imageWidth ?: JSONObject.NULL)
        put("imageHeight", imageHeight ?: JSONObject.NULL)
        put("imageRotationDegrees", imageRotationDegrees)
        put("imageMirrored", imageMirrored)
        put("intrinsicsFx", intrinsicsFx ?: JSONObject.NULL)
        put("intrinsicsFy", intrinsicsFy ?: JSONObject.NULL)
        put("intrinsicsCx", intrinsicsCx ?: JSONObject.NULL)
        put("intrinsicsCy", intrinsicsCy ?: JSONObject.NULL)
        put("intrinsicsImageWidth", intrinsicsImageWidth ?: JSONObject.NULL)
        put("intrinsicsImageHeight", intrinsicsImageHeight ?: JSONObject.NULL)
        put("intrinsicsSpace", intrinsicsSpace)
        landmarks2D?.let { pts ->
            put("landmarks2D", JSONArray().apply { pts.forEach { put(JSONObject().put("x", it.x).put("y", it.y).put("z", it.z)) } })
        }
        faceLocal3D?.let { pts ->
            put("faceLocal3D", JSONArray().apply { pts.forEach { put(JSONObject().put("x", it.x).put("y", it.y).put("z", it.z)) } })
        }
        transformationMatrix?.let { m -> put("transformationMatrix", JSONArray().apply { m.forEach(::put) }) }
        imageSpaceViewModelMatrix?.let { m -> put("imageSpaceViewModelMatrix", JSONArray().apply { m.forEach(::put) }) }
        put("poseYawDeg", poseYawDeg ?: JSONObject.NULL)
        put("posePitchDeg", posePitchDeg ?: JSONObject.NULL)
        put("poseRollDeg", poseRollDeg ?: JSONObject.NULL)
        put("faceCameraX", faceCameraX ?: JSONObject.NULL)
        put("faceCameraY", faceCameraY ?: JSONObject.NULL)
        put("faceCameraZ", faceCameraZ ?: JSONObject.NULL)
        put("captureLatencyMs", captureLatencyMs ?: JSONObject.NULL)
    }
}
