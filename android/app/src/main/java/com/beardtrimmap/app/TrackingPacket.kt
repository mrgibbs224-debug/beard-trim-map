package com.beardtrimmap.app

import org.json.JSONArray
import org.json.JSONObject

data class TrackingPoint(val x: Float, val y: Float, val z: Float)

// Phase 2.5A: raw ARCore AugmentedFace face-local mesh vertex, captured BEFORE the existing
// model/view/projection pipeline. Deliberately a distinct type from TrackingPoint (which holds
// projected/normalized screen-space coordinates) so raw face-local geometry and projected
// display/tracking geometry cannot be accidentally mixed by future code. Face-local, meters,
// center-pose-relative, per ARCore's AugmentedFace.getMeshVertices() contract: X+ toward the
// person's left, Y+ up, Z+ forward out of the face.
data class FaceLocalPoint3D(val x: Float, val y: Float, val z: Float)

data class TrackingPacket(
    val provider: String,
    val timestampMs: Long,
    val frameWidth: Int,
    val frameHeight: Int,
    val rotationDegrees: Int,
    val mirrored: Boolean,
    val inferenceMs: Long,
    val landmarks: List<TrackingPoint>,
    val transformationMatrix: List<Float>?,
    val poseYawDeg: Float? = null,
    val posePitchDeg: Float? = null,
    val poseRollDeg: Float? = null,
    val faceCameraX: Float? = null,
    val faceCameraY: Float? = null,
    val faceCameraZ: Float? = null,
    val nativeFrameTimestampNs: Long? = null,
    // Phase 2.5A: raw face-local mesh, additive and independent of `landmarks` above. Null on
    // any path that doesn't provide it (ML Kit, synthetic, or missing raw data) -- existing
    // call sites are unaffected by this default.
    val faceLocalLandmarks3D: List<FaceLocalPoint3D>? = null,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("contractVersion", NativeTrackingBridge.CONTRACT_VERSION)
        put("provider", provider)
        put("timestampMs", timestampMs)
        put("frameWidth", frameWidth)
        put("frameHeight", frameHeight)
        put("rotationDegrees", rotationDegrees)
        put("mirrored", mirrored)
        put("inferenceMs", inferenceMs)
        put("landmarks", JSONArray().apply {
            landmarks.forEach { point ->
                put(JSONObject().put("x", point.x).put("y", point.y).put("z", point.z))
            }
        })
        transformationMatrix?.let { matrix ->
            put("transformationMatrix", JSONArray().apply { matrix.forEach(::put) })
        }
        // Phase 2.5A: additive raw face-local evidence; existing fields above are unchanged.
        faceLocalLandmarks3D?.let { pts ->
            put("faceLocalLandmarks3D", JSONArray().apply {
                pts.forEach { put(JSONObject().put("x", it.x).put("y", it.y).put("z", it.z)) }
            })
        }
        put("poseYawDeg", poseYawDeg ?: JSONObject.NULL)
        put("posePitchDeg", posePitchDeg ?: JSONObject.NULL)
        put("poseRollDeg", poseRollDeg ?: JSONObject.NULL)
        put("faceCameraX", faceCameraX ?: JSONObject.NULL)
        put("faceCameraY", faceCameraY ?: JSONObject.NULL)
        put("faceCameraZ", faceCameraZ ?: JSONObject.NULL)
        put("nativeFrameTimestampNs", nativeFrameTimestampNs?.toString() ?: JSONObject.NULL)
    }
}
