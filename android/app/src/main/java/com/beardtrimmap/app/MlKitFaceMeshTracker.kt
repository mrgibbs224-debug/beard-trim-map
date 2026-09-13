package com.beardtrimmap.app

import android.content.Context
import android.os.SystemClock
import android.util.Log
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.core.Preview
import androidx.camera.view.PreviewView
import androidx.core.view.isVisible
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.facemesh.FaceMeshDetection
import com.google.mlkit.vision.facemesh.FaceMeshDetector
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class MlKitFaceMeshTracker(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    private val previewView: PreviewView,
    private val stabilizer: OpenCvLandmarkStabilizer,
    private val onPacket: (TrackingPacket) -> Unit,
    private val onState: (String) -> Unit,
    // Stage P2.3H.1: fired on every genuine ImageAnalysis frame delivered by CameraX, regardless
    // of whether a face is found -- the camera-pipeline health signal, distinct from onPacket
    // (which only fires when ML Kit also successfully finds exactly one face). Defaults to a
    // no-op so other call sites are unaffected.
    private val onAnalyzerFrame: () -> Unit = {},
) : AutoCloseable {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val detector: FaceMeshDetector = FaceMeshDetection.getClient()
    private val processing = AtomicBoolean(false)
    private var provider: ProcessCameraProvider? = null
    private var camera: Camera? = null
    private var mirrored = true
    private var streamingReported = false
    // Stamped at the top of analyze() on every genuine ImageAnalysis frame CameraX delivers --
    // regardless of whether ML Kit subsequently finds a face -- since P2.3F proved Preview
    // STREAMING can occur with no real frame ever reaching the analyzer, and P2.3H.1 corrected
    // an earlier version of this signal that was tied to face-mesh success (MLKIT_MESH_RECEIVED),
    // which would have falsely flagged a healthy camera with no face in view as stalled. Read
    // from the coordinator's watchdog Timer thread, written from the analyzer callback thread.
    @Volatile private var lastAnalyzerFrameAt: Long? = null

    // CORE-PERF1-B: a single reusable PreviewView stream-state observer for this tracker instance.
    // Previously start() registered a fresh anonymous observer on every camera start, and stop()
    // never removed it, so repeated start/stop/switch cycles accumulated observers until the
    // Activity (lifecycleOwner) was destroyed. This one instance is registered on the main thread
    // in start() (removeObserver first, so a re-register can never accumulate) and removed in
    // stop(). Body and streamingReported semantics are identical to the previous inline lambda.
    private val streamStateObserver = Observer<PreviewView.StreamState> { state ->
        if (state == PreviewView.StreamState.STREAMING && !streamingReported) {
            streamingReported = true
            Log.d("BeardTrimNative", "CAMERAX_PREVIEW_STREAMING")
            Log.d("BeardTrimNative", "CAMERAX_PREVIEW_VIEW_STATE visible=${previewView.isVisible} width=${previewView.width} height=${previewView.height} alpha=${previewView.alpha} attached=${previewView.isAttachedToWindow}")
            onState("mlkit-verifier-tracking")
        }
    }

    fun start(frontCamera: Boolean) {
        Log.d("BeardTrimNative", "CAMERAX_PREVIEW_BOUND")
        mirrored = frontCamera
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            try {
                provider = future.get().also { cameraProvider ->
                    val analysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                    analysis.setAnalyzer(executor, ::analyze)

                    val preview = Preview.Builder().build()
                    preview.setSurfaceProvider(previewView.surfaceProvider)

                    cameraProvider.unbindAll()
                    camera = cameraProvider.bindToLifecycle(
                        lifecycleOwner,
                        if (frontCamera) CameraSelector.DEFAULT_FRONT_CAMERA
                        else CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis,
                    )
                }

                // CORE-PERF1-B: exactly one active stream-state observer per instance. Remove any
                // prior registration before re-observing so repeated start/stop/switch cycles
                // cannot accumulate observers (this addListener block runs on the main thread).
                previewView.previewStreamState.removeObserver(streamStateObserver)
                previewView.previewStreamState.observe(lifecycleOwner, streamStateObserver)
            } catch (error: Exception) {
                onState("mlkit-error:${error.javaClass.simpleName}")
                stop()
            }
        }, ContextCompat.getMainExecutor(context))
    }

    @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
    private fun analyze(proxy: ImageProxy) {
        // Camera-pipeline health: this line proves CameraX actually delivered a frame to the
        // analyzer, independent of anything downstream (face found or not, ML Kit success or
        // not). Must stay the first statement -- do not move below the face-detection path.
        lastAnalyzerFrameAt = SystemClock.uptimeMillis()
        onAnalyzerFrame()
        val mediaImage = proxy.image
        if (mediaImage == null || !processing.compareAndSet(false, true)) {
            proxy.close()
            return
        }
        val started = SystemClock.elapsedRealtime()
        val rotation = proxy.imageInfo.rotationDegrees
        detector.process(InputImage.fromMediaImage(mediaImage, rotation))
            .addOnSuccessListener { faces ->
                try {
                    val face = faces.singleOrNull()
                    if (face == null) {
                        onState(if (faces.isEmpty()) "no-face" else "multiple-faces")
                        return@addOnSuccessListener
                    }
                    
                    val width = if (rotation == 90 || rotation == 270) proxy.height else proxy.width
                    val height = if (rotation == 90 || rotation == 270) proxy.width else proxy.height
                    val normalized = face.allPoints.map { point ->
                        val p = point.position
                        TrackingPoint(p.x / width, p.y / height, p.z / width)
                    }

                    Log.d("BeardTrimNative", "MLKIT_MESH_RECEIVED count=${normalized.size}")

                    val stabilized = stabilizer.stabilize(normalized)
                    onPacket(
                        TrackingPacket(
                            provider = "mlkit-face-mesh",
                            timestampMs = SystemClock.uptimeMillis(),
                            frameWidth = width,
                            frameHeight = height,
                            rotationDegrees = rotation,
                            mirrored = mirrored,
                            inferenceMs = SystemClock.elapsedRealtime() - started,
                            landmarks = stabilized,
                            transformationMatrix = null,
                        ),
                    )
                } catch (e: Exception) {
                    Log.e("BeardTrimNative", "ML Kit success callback processing failed: ${e.message}")
                }
            }
            .addOnFailureListener { error -> onState("mlkit-error:${error.javaClass.simpleName}") }
            .addOnCompleteListener {
                processing.set(false)
                proxy.close()
            }
    }

    // True once this start() episode has received at least one genuine ImageAnalysis frame from
    // CameraX -- the camera-pipeline startup watchdog's success signal (see class-level comment
    // on lastAnalyzerFrameAt for why this is NOT tied to face-mesh success). Reset to false only
    // in stop(), matching this class's existing streamingReported reset pattern (a fresh start()
    // always follows a stop()).
    fun hasAnalyzerFrameSinceStart(): Boolean = lastAnalyzerFrameAt != null

    // Fails safely (returns false, no throw) when no camera is bound, the bound camera has no
    // flash unit, or the request itself throws -- never assumes a specific device's hardware.
    fun setTorchEnabled(enabled: Boolean): Boolean {
        val activeCamera = camera
        if (activeCamera == null) {
            Log.d("BeardTrimNative", "setTorchEnabled($enabled) ignored: no CameraX camera bound")
            return false
        }
        if (!activeCamera.cameraInfo.hasFlashUnit()) {
            Log.d("BeardTrimNative", "setTorchEnabled($enabled) ignored: bound camera has no flash unit")
            return false
        }
        return try {
            activeCamera.cameraControl.enableTorch(enabled)
            Log.d("BeardTrimNative", "setTorchEnabled($enabled) requested")
            true
        } catch (e: Exception) {
            Log.e("BeardTrimNative", "setTorchEnabled($enabled) failed", e)
            false
        }
    }

    fun stop() {
        // CORE-PERF1-B: drop the single stream-state observer so start/stop/switch cycles never
        // accumulate observers (safe no-op if it was never registered or already removed).
        previewView.previewStreamState.removeObserver(streamStateObserver)
        try {
            camera?.let { if (it.cameraInfo.hasFlashUnit()) it.cameraControl.enableTorch(false) }
        } catch (_: Exception) {
        }
        camera = null
        provider?.unbindAll()
        provider = null
        processing.set(false)
        streamingReported = false
        lastAnalyzerFrameAt = null
        stabilizer.clear()
        onState("stopped")
    }

    override fun close() {
        stop()
        detector.close()
        executor.shutdownNow()
    }
}
