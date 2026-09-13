package com.beardtrimmap.app

import android.opengl.Matrix
import android.os.SystemClock
import android.util.Log
import com.google.ar.core.AugmentedFace
import com.google.ar.core.Frame
import com.google.ar.core.Session

class ArCoreFaceMeshTracker(
    private val stabilizer: OpenCvLandmarkStabilizer,
    private val onPacket: (TrackingPacket) -> Unit,
    private val onState: (String) -> Unit,
    // Stage A6.0A: developer-only Tier-B keyframe result callback. Defaults to a no-op so every
    // existing call site (and the synthetic/ML-Kit paths that never call requestKeyframe) is
    // unaffected.
    private val onKeyframeResult: (SpatialKeyframeResult) -> Unit = {}
) {
    private var firstFaceReported = false
    private val projectionMatrix = FloatArray(16)
    private val viewMatrix = FloatArray(16)
    private val modelMatrix = FloatArray(16)
    private val modelViewProjectionMatrix = FloatArray(16)
    // Stage A6.0A: Camera.getViewMatrix() is display-oriented (ARCore's own javadoc: "the view
    // matrix incorporates the display orientation... equivalent to
    // getDisplayOrientedPose().inverse()"), which is NOT the coordinate frame
    // acquireCameraImage()/getImageIntrinsics() use (those are the raw, unrotated sensor/image
    // frame -- Camera.getPose()'s frame, which differs from the display-oriented one by a
    // 90-degree-multiple Z rotation). This second, physical view matrix exists so a keyframe's
    // camera-space geometry can be projected with its own intrinsics onto its own raw image
    // without that rotation mismatch corrupting the result.
    private val physicalViewMatrix = FloatArray(16)
    private val imageSpaceViewModelMatrix = FloatArray(16)

    // Stage A6.0A: at most one outstanding keyframe request -- requestKeyframe() rejects a new
    // request while one is already pending/claimed, so processFrame() never needs to queue more
    // than a single native Image acquisition at a time.
    @Volatile private var pendingKeyframeRequestId: String? = null
    private val keyframeExecutor: java.util.concurrent.ExecutorService =
        java.util.concurrent.Executors.newSingleThreadExecutor()

    fun requestKeyframe(requestId: String): Boolean {
        return if (pendingKeyframeRequestId == null) {
            pendingKeyframeRequestId = requestId
            true
        } else {
            false
        }
    }

    fun close() {
        keyframeExecutor.shutdownNow()
    }

    fun processFrame(session: Session, frame: Frame, width: Int, height: Int) {
        val camera = frame.camera
        
        // Get projection and view matrices
        camera.getProjectionMatrix(projectionMatrix, 0, 0.1f, 100.0f)
        camera.getViewMatrix(viewMatrix, 0)

        val faces = session.getAllTrackables(AugmentedFace::class.java)
        val face = faces.singleOrNull { it.trackingState == com.google.ar.core.TrackingState.TRACKING }
        
        if (face == null) {
            if (faces.isEmpty()) onState("no-face") else onState("face-lost")
            return
        }

        if (!firstFaceReported) {
            firstFaceReported = true
            Log.d("BeardTrimNative", "AR_FACE_TRACKING_FIRST")
            onState("arcore-tracking")
        }

        val started = SystemClock.elapsedRealtime()
        
        // Get face model matrix (pose)
        face.centerPose.toMatrix(modelMatrix, 0)

        // 4D-1: Extract orientation from pure centerPose rotation
        val quat = FloatArray(4)
        face.centerPose.getRotationQuaternion(quat, 0) // [x, y, z, w]
        val qx = quat[0]; val qy = quat[1]; val qz = quat[2]; val qw = quat[3]

        // Yaw (Rotation around Y): Positive = Turning head LEFT
        val poseYawDeg = Math.toDegrees(Math.atan2(
            2.0 * (qw * qy + qz * qx),
            1.0 - 2.0 * (qy * qy + qz * qz)
        )).toFloat()

        // Pitch (Rotation around X): Positive = Tilting head DOWN
        val sinPitch = 2.0 * (qw * qx - qy * qz)
        val posePitchDeg = Math.toDegrees(Math.asin(
            sinPitch.toDouble().coerceIn(-1.0, 1.0)
        )).toFloat()

        // Roll (Rotation around Z): Positive = Tilting head towards RIGHT shoulder
        val poseRollDeg = Math.toDegrees(Math.atan2(
            2.0 * (qw * qz + qx * qy),
            1.0 - 2.0 * (qx * qx + qz * qz)
        )).toFloat()
        
        // MVP matrix
        val tmpMatrix = FloatArray(16)
        Matrix.multiplyMM(tmpMatrix, 0, viewMatrix, 0, modelMatrix, 0)
        
        // D7A: Extract camera-relative face translation [meters]
        // TX index 12, TY index 13, TZ index 14
        val faceCameraX = tmpMatrix[12]
        val faceCameraY = tmpMatrix[13]
        val faceCameraZ = tmpMatrix[14]

        Matrix.multiplyMM(modelViewProjectionMatrix, 0, projectionMatrix, 0, tmpMatrix, 0)

        val vertices = face.meshVertices
        val landmarkCount = vertices.limit() / 3
        Log.d("BeardTrimNative", "ARCORE_MESH_RECEIVED count=${landmarkCount}")
        val landmarks = mutableListOf<TrackingPoint>()
        // Phase 2.5A: raw face-local vertices, captured before the model/view/projection
        // multiply below ever runs. `vertices.get(index)` is the absolute-position FloatBuffer
        // accessor, so reading it here does not consume/mutate the buffer for the projection
        // read on the next line -- the existing projected `landmarks` output is unaffected.
        val faceLocalLandmarks = mutableListOf<FaceLocalPoint3D>()

        val vertex = FloatArray(4)
        val projectedVertex = FloatArray(4)

        for (i in 0 until landmarkCount) {
            vertex[0] = vertices.get(i * 3)
            vertex[1] = vertices.get(i * 3 + 1)
            vertex[2] = vertices.get(i * 3 + 2)
            vertex[3] = 1.0f

            faceLocalLandmarks.add(FaceLocalPoint3D(vertex[0], vertex[1], vertex[2]))

            Matrix.multiplyMV(projectedVertex, 0, modelViewProjectionMatrix, 0, vertex, 0)
            
            // Normalized Device Coordinates (NDC) to [0, 1]
            val w = projectedVertex[3]
            val x = (projectedVertex[0] / w + 1.0f) / 2.0f
            val y = (1.0f - (projectedVertex[1] / w + 1.0f) / 2.0f)
            val z = projectedVertex[2] / w
            
            landmarks.add(TrackingPoint(x, y, z))
        }

        // Hoisted to a local so a pending Stage A6.0A keyframe capture (below) can reuse the
        // EXACT same stabilized output rather than calling stabilize() a second time -- the
        // stabilizer holds temporal state, so a second call would both diverge from the packet's
        // geometry and corrupt that state.
        val stabilizedLandmarks = stabilizer.stabilize(landmarks)

        onPacket(
            TrackingPacket(
                provider = "arcore-augmented-faces",
                timestampMs = SystemClock.uptimeMillis(),
                frameWidth = width,
                frameHeight = height,
                rotationDegrees = 0,
                mirrored = true,
                inferenceMs = SystemClock.elapsedRealtime() - started,
                landmarks = stabilizedLandmarks,
                transformationMatrix = modelViewProjectionMatrix.toList(),
                poseYawDeg = poseYawDeg,
                posePitchDeg = posePitchDeg,
                poseRollDeg = poseRollDeg,
                faceCameraX = faceCameraX,
                faceCameraY = faceCameraY,
                faceCameraZ = faceCameraZ,
                nativeFrameTimestampNs = frame.timestamp,
                faceLocalLandmarks3D = faceLocalLandmarks
            )
        )

        val keyframeRequestId = pendingKeyframeRequestId
        if (keyframeRequestId != null) {
            pendingKeyframeRequestId = null
            // Computed only on this rare, explicitly-requested path -- camera.pose (the physical,
            // image-oriented pose) is not otherwise read anywhere in this file, so this adds no
            // per-frame cost when no keyframe is pending.
            camera.pose.inverse().toMatrix(physicalViewMatrix, 0)
            Matrix.multiplyMM(imageSpaceViewModelMatrix, 0, physicalViewMatrix, 0, modelMatrix, 0)
            captureKeyframe(
                requestId = keyframeRequestId,
                frame = frame,
                camera = camera,
                nativeFrameTimestampNs = frame.timestamp,
                landmarks2D = stabilizedLandmarks,
                faceLocal3D = faceLocalLandmarks,
                transformationMatrix = modelViewProjectionMatrix.toList(),
                imageSpaceViewModelMatrix = imageSpaceViewModelMatrix.toList(),
                poseYawDeg = poseYawDeg,
                posePitchDeg = posePitchDeg,
                poseRollDeg = poseRollDeg,
                faceCameraX = faceCameraX,
                faceCameraY = faceCameraY,
                faceCameraZ = faceCameraZ
            )
        }
    }

    // Stage A6.0A: acquires the CPU camera image from the SAME Frame object that just produced
    // the packet above (frame.acquireCameraImage() is only valid on the current frame -- ARCore
    // throws DeadlineExceededException otherwise), so coherence is a structural guarantee, not a
    // measured probability. The Image is copied to a plain byte array and closed synchronously,
    // before any background work -- this bounds native Image resource usage to a single, brief
    // hold per request, never crossing onto the executor thread.
    private fun captureKeyframe(
        requestId: String,
        frame: Frame,
        camera: com.google.ar.core.Camera,
        nativeFrameTimestampNs: Long,
        landmarks2D: List<TrackingPoint>,
        faceLocal3D: List<FaceLocalPoint3D>,
        transformationMatrix: List<Float>,
        imageSpaceViewModelMatrix: List<Float>,
        poseYawDeg: Float,
        posePitchDeg: Float,
        poseRollDeg: Float,
        faceCameraX: Float,
        faceCameraY: Float,
        faceCameraZ: Float
    ) {
        val captureStarted = SystemClock.elapsedRealtime()
        val image = try {
            frame.acquireCameraImage()
        } catch (e: Exception) {
            Log.w("BeardTrimNative", "A60A_KEYFRAME_ACQUIRE_FAILED requestId=$requestId ${e.javaClass.simpleName}: ${e.message}")
            onKeyframeResult(
                SpatialKeyframeResult(
                    requestId = requestId,
                    coherenceStatus = "REJECTED_UNMATCHED",
                    rejectReason = "acquireCameraImage failed: ${e.javaClass.simpleName}: ${e.message}",
                    nativeFrameTimestampNs = nativeFrameTimestampNs
                )
            )
            return
        }

        val intrinsics = try { camera.imageIntrinsics } catch (e: Exception) { null }
        var fx: Float? = null; var fy: Float? = null
        var cx: Float? = null; var cy: Float? = null
        var intrinsicsW: Int? = null; var intrinsicsH: Int? = null
        if (intrinsics != null) {
            val focal = FloatArray(2); intrinsics.getFocalLength(focal, 0)
            val principal = FloatArray(2); intrinsics.getPrincipalPoint(principal, 0)
            val dims = IntArray(2); intrinsics.getImageDimensions(dims, 0)
            fx = focal[0]; fy = focal[1]; cx = principal[0]; cy = principal[1]
            intrinsicsW = dims[0]; intrinsicsH = dims[1]
        }

        val nv21 = try {
            YuvJpegConverter.toNv21(image)
        } catch (e: Exception) {
            image.close()
            Log.w("BeardTrimNative", "A60A_KEYFRAME_YUV_COPY_FAILED requestId=$requestId ${e.message}")
            onKeyframeResult(
                SpatialKeyframeResult(
                    requestId = requestId,
                    coherenceStatus = "REJECTED_UNMATCHED",
                    rejectReason = "YUV copy failed: ${e.message}",
                    nativeFrameTimestampNs = nativeFrameTimestampNs
                )
            )
            return
        }
        val imgWidth = image.width
        val imgHeight = image.height
        image.close()

        keyframeExecutor.execute {
            try {
                val jpeg = YuvJpegConverter.nv21ToJpeg(nv21, imgWidth, imgHeight, 90)
                val base64 = android.util.Base64.encodeToString(jpeg, android.util.Base64.NO_WRAP)
                val dataUrl = "data:image/jpeg;base64,$base64"
                val latencyMs = SystemClock.elapsedRealtime() - captureStarted
                onKeyframeResult(
                    SpatialKeyframeResult(
                        requestId = requestId,
                        coherenceStatus = "VERIFIED_EXACT",
                        nativeFrameTimestampNs = nativeFrameTimestampNs,
                        imageBase64Jpeg = dataUrl,
                        imageWidth = imgWidth,
                        imageHeight = imgHeight,
                        intrinsicsFx = fx, intrinsicsFy = fy, intrinsicsCx = cx, intrinsicsCy = cy,
                        intrinsicsImageWidth = intrinsicsW, intrinsicsImageHeight = intrinsicsH,
                        intrinsicsSpace = "IMAGE",
                        landmarks2D = landmarks2D,
                        faceLocal3D = faceLocal3D,
                        transformationMatrix = transformationMatrix,
                        imageSpaceViewModelMatrix = imageSpaceViewModelMatrix,
                        poseYawDeg = poseYawDeg, posePitchDeg = posePitchDeg, poseRollDeg = poseRollDeg,
                        faceCameraX = faceCameraX, faceCameraY = faceCameraY, faceCameraZ = faceCameraZ,
                        captureLatencyMs = latencyMs
                    )
                )
            } catch (e: Exception) {
                Log.w("BeardTrimNative", "A60A_KEYFRAME_JPEG_ENCODE_FAILED requestId=$requestId ${e.message}")
                onKeyframeResult(
                    SpatialKeyframeResult(
                        requestId = requestId,
                        coherenceStatus = "REJECTED_UNMATCHED",
                        rejectReason = "JPEG encode failed: ${e.message}",
                        nativeFrameTimestampNs = nativeFrameTimestampNs
                    )
                )
            }
        }
    }
}
