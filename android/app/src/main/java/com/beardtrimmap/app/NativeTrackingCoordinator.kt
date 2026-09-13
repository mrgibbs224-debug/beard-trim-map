package com.beardtrimmap.app

import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.ar.core.Frame
import com.google.ar.core.Session
import java.util.Timer
import java.util.TimerTask

enum class TrackingState {
    IDLE, STARTING, ACTIVE, STOPPING
}

private const val MLKIT_STARTUP_GRACE_MS = 15_000L

class NativeTrackingCoordinator(
    private val context: Context,
    private val activity: MainActivity,
    private val lifecycleOwner: LifecycleOwner,
    private val cameraXView: PreviewView,
    private val onPacket: (TrackingPacket) -> Unit,
    private val emitState: (String) -> Unit,
    // Stage A6.0A: developer-only Tier-B keyframe result callback, forwarded through to the
    // ARCore tracker unchanged. Defaults to a no-op.
    private val onKeyframeResult: (SpatialKeyframeResult) -> Unit = {},
) : AutoCloseable {
    private var lastEmittedState: String? = null
    private val onState: (String) -> Unit = { state ->
        if (state != lastEmittedState) {
            lastEmittedState = state
            emitState(state)
        }
    }

    private val arCore = ArCoreFaceSession(context)
    private val arCoreTracker = ArCoreFaceMeshTracker(
        OpenCvLandmarkStabilizer(),
        onPacket,
        onState,
        onKeyframeResult
    )
    private val mlKit = MlKitFaceMeshTracker(
        context,
        lifecycleOwner,
        cameraXView,
        OpenCvLandmarkStabilizer(),
        onPacket,
        { state ->
            if (state == "mlkit-verifier-tracking") {
                Log.d("BeardTrimNative", "ML Kit producing output, showing PreviewView and enabling transparency")
                activity.setNativePreviewVisible(arCore = false, cameraX = true)
                activity.setWebViewTransparency(true)
            }
            onState(state)
        },
        ::onMlKitAnalyzerFrame,
    )
    
    private var trackingState = TrackingState.IDLE
    private var pendingFrontCamera: Boolean? = null
    private var arCoreWatchdog: Timer? = null
    // Fires once, MLKIT_STARTUP_GRACE_MS after a tryStartMlKit() episode begins, if no genuine
    // ImageAnalysis frame has reached the analyzer by then (see mlKit.hasAnalyzerFrameSinceStart()
    // -- deliberately NOT tied to face-mesh success, so a healthy camera with no face in view is
    // never mistaken for a stall). Cancelled eagerly by onMlKitAnalyzerFrame() on the first real
    // analyzer frame, and by stop() otherwise.
    private var mlKitWatchdog: Timer? = null
    // Caps the watchdog to exactly one automatic same-facing recovery per user/lifecycle episode.
    // Reset only at the top of start() (every genuine caller), never by the watchdog's own
    // recovery path below (which calls stop() directly, bypassing start() entirely) -- so a
    // retried session that also fails to produce a real frame does not recover a second time.
    private var recoveryAttempted: Boolean = false
    // Facing mode of the provider that is currently STARTING/ACTIVE. Lets start() tell a
    // same-facing re-request (safe no-op) apart from an actual camera-switch request while a
    // session is already running -- the ACTIVE guard below previously ignored both cases alike.
    private var activeFrontCamera: Boolean? = null

    // Remembers the facing mode of the most recently requested start, so a lifecycle-driven
    // resume (see pauseForLifecycle/resumeForLifecycle) can restart the same session mode
    // rather than guessing or hardcoding front camera.
    private var lastFrontCamera: Boolean = true
    // Set by pauseForLifecycle() only when tracking was genuinely ACTIVE/STARTING at the moment
    // Android paused the Activity, distinguishing "lifecycle suspended a running session" from
    // "tracking was already intentionally idle" -- resumeForLifecycle() only restarts in the former case.
    private var resumeTrackingAfterLifecyclePause = false

    fun start(frontCamera: Boolean): String {
        Log.d("BeardTrimNative", "[Thread:${Thread.currentThread().name}] start(frontCamera=$frontCamera), current state=$trackingState")
        lastFrontCamera = frontCamera
        // Every genuine call to start() (user-initiated or lifecycle resume) is a fresh episode --
        // the watchdog's own same-facing retry never reaches this function, so this cannot reset
        // mid-recovery.
        recoveryAttempted = false

        val permission = ContextCompat.checkSelfPermission(context, android.Manifest.permission.CAMERA)
        if (permission == PackageManager.PERMISSION_GRANTED) {
            Log.d("BeardTrimNative", "CAMERA_PERMISSION_GRANTED")
        } else {
            Log.d("BeardTrimNative", "CAMERA_PERMISSION_DENIED")
            pendingFrontCamera = frontCamera
            activity.requestCameraPermission()
            return "permission-pending"
        }
        
        if (trackingState == TrackingState.ACTIVE) {
            if (activeFrontCamera == frontCamera) {
                Log.d("BeardTrimNative", "Start ignored: tracking is already ACTIVE for the same facing")
                return "started"
            }
            Log.d("BeardTrimNative", "[Thread:${Thread.currentThread().name}] Switching camera facing while ACTIVE: $activeFrontCamera -> $frontCamera")
            pendingFrontCamera = frontCamera
            stop()
            return "starting"
        }
        
        if (trackingState == TrackingState.STARTING) {
            Log.d("BeardTrimNative", "Start ignored: tracking is already STARTING")
            return "starting"
        }

        // If we are currently STOPPING, we queue the start to happen after stop completes
        if (trackingState == TrackingState.STOPPING) {
            Log.d("BeardTrimNative", "Start queued: currently STOPPING")
            pendingFrontCamera = frontCamera
            return "starting"
        }

        executeStartAsync(frontCamera)
        return "starting"
    }

    fun resumePendingStart() {
        val front = pendingFrontCamera ?: return
        pendingFrontCamera = null
        Log.d("BeardTrimNative", "Resuming pending start")
        executeStartAsync(front)
    }

    private fun executeStartAsync(frontCamera: Boolean) {
        trackingState = TrackingState.STARTING
        activeFrontCamera = frontCamera
        activity.runOnUiThread {
            Log.d("BeardTrimNative", "[Thread:${Thread.currentThread().name}] executeStartAsync UI task: frontCamera=$frontCamera")
            if (frontCamera && arCore.isSupported()) {
                tryStartArCore()
            } else {
                tryStartMlKit(frontCamera)
            }
        }
    }

    private fun tryStartArCore() {
        Log.d("BeardTrimNative", "[Thread:${Thread.currentThread().name}] Attempting ARCore startup")
        try {
            arCore.create()
            activity.setNativePreviewVisible(arCore = true, cameraX = false)
            arCore.resume()
            
            // Start watchdog: if no frame in 2.5 seconds, fallback to ML Kit
            arCoreWatchdog?.cancel()
            arCoreWatchdog = Timer().apply {
                schedule(object : TimerTask() {
                    override fun run() {
                        if (trackingState == TrackingState.STARTING) {
                            activity.runOnUiThread {
                                Log.w("BeardTrimNative", "ARCore watchdog triggered: No frames produced, falling back to ML Kit")
                                arCore.pause()
                                arCore.close()
                                tryStartMlKit(frontCamera = true)
                            }
                        }
                    }
                }, 2500)
            }
            
            Log.d("BeardTrimNative", "ARCore session resumed, waiting for renderer signal")
            onState("arcore-active")
        } catch (e: Exception) {
            Log.e("BeardTrimNative", "ARCore startup failed, fallback to ML Kit", e)
            arCore.close()
            tryStartMlKit(frontCamera = true)
        }
    }

    fun onArCoreFrame(session: Session, frame: Frame?, w: Int, h: Int) {
        if (trackingState == TrackingState.STARTING) {
            Log.d("BeardTrimNative", "ARCore producing frames, marking ACTIVE")
            arCoreWatchdog?.cancel()
            arCoreWatchdog = null
            trackingState = TrackingState.ACTIVE
            onState("started")
            onState("arcore-tracking")
        }
        if (trackingState == TrackingState.ACTIVE && frame != null) {
            arCoreTracker.processFrame(session, frame, w, h)
        }
    }

    private fun tryStartMlKit(frontCamera: Boolean) {
        Log.d("BeardTrimNative", "[Thread:${Thread.currentThread().name}] Starting ML Kit fallback (front=$frontCamera)")
        arCoreWatchdog?.cancel()
        arCoreWatchdog = null
        mlKitWatchdog?.cancel()
        mlKitWatchdog = null
        trackingState = TrackingState.ACTIVE
        // Make the CameraX render target available *before* bindToLifecycle() requests its
        // Preview surface, mirroring tryStartArCore()'s eager visibility above -- previously this
        // view stayed isVisible=false until a "mlkit-verifier-tracking" state that itself depended
        // on the surface CameraX could never obtain from a still-invisible (unmeasured) view.
        activity.setNativePreviewVisible(arCore = false, cameraX = true)
        mlKit.start(frontCamera)
        onState("mlkit-active")
        onState("started")

        // Startup camera-pipeline watchdog (Stage P2.3H, corrected P2.3H.1): Preview STREAMING
        // alone was proven insufficient evidence of a healthy session (P2.3F) -- a stalled bind
        // can reach STREAMING and never deliver a real frame to the analyzer. Success is a
        // genuine ImageAnalysis frame reaching the analyzer, NOT a found face -- a healthy camera
        // with no face in view (Assisted Mode, user stepping away) must never be recovered as if
        // stalled. Fires once; cancelled early by onMlKitAnalyzerFrame() on the first real frame.
        mlKitWatchdog = Timer().apply {
            schedule(object : TimerTask() {
                override fun run() {
                    activity.runOnUiThread {
                        if (trackingState == TrackingState.ACTIVE &&
                            activeFrontCamera == frontCamera &&
                            !recoveryAttempted &&
                            !mlKit.hasAnalyzerFrameSinceStart()
                        ) {
                            Log.w(
                                "BeardTrimNative",
                                "MLKit startup watchdog triggered: no real frame within ${MLKIT_STARTUP_GRACE_MS}ms, attempting one recovery",
                            )
                            recoveryAttempted = true
                            pendingFrontCamera = activeFrontCamera
                            stop()
                        }
                    }
                }
            }, MLKIT_STARTUP_GRACE_MS)
        }
    }

    // Cancels the startup watchdog eagerly on the first genuine ImageAnalysis frame of this
    // episode -- fires regardless of whether ML Kit goes on to find a face, so a healthy camera
    // with no face in view (Assisted Mode repositioning, user stepping away, etc.) is never
    // mistaken for a stalled session. Idempotent: mlKitWatchdog is already null on every call
    // after the first.
    private fun onMlKitAnalyzerFrame() {
        mlKitWatchdog?.cancel()
        mlKitWatchdog = null
    }

    fun stop() {
        Log.d("BeardTrimNative", "[Thread:${Thread.currentThread().name}] stop() requested, current state=$trackingState")
        arCoreWatchdog?.cancel()
        arCoreWatchdog = null
        mlKitWatchdog?.cancel()
        mlKitWatchdog = null

        if (trackingState == TrackingState.IDLE || trackingState == TrackingState.STOPPING) return
        
        trackingState = TrackingState.STOPPING
        activity.runOnUiThread {
            Log.d("BeardTrimNative", "[Thread:${Thread.currentThread().name}] Executing stop sequence")
            arCore.pause()
            mlKit.stop()
            activity.setNativePreviewVisible(arCore = false, cameraX = false)
            activity.setWebViewTransparency(false)
            
            val restartRequested = pendingFrontCamera
            trackingState = TrackingState.IDLE
            
            if (restartRequested != null) {
                Log.d("BeardTrimNative", "Executing queued start after stop")
                resumePendingStart()
            } else {
                activeFrontCamera = null
                onState("stopped")
            }
        }
    }

    fun resume() {
        if (trackingState == TrackingState.ACTIVE) {
            Log.d("BeardTrimNative", "[Thread:${Thread.currentThread().name}] resume() requested for ACTIVE session")
            activity.runOnUiThread {
                if (arCore.getSession() != null) {
                    try { 
                        arCore.resume() 
                        Log.d("BeardTrimNative", "ARCore resumed successfully")
                    } catch (e: Exception) { 
                        Log.e("BeardTrimNative", "ARCore resume failed, restarting fallback", e)
                        arCore.close()
                        tryStartMlKit(frontCamera = true)
                    }
                }
            }
        }
    }

    // Called from Android lifecycle pause (Activity backgrounded), not from explicit/user-requested
    // stop paths. Records whether tracking was genuinely running so resumeForLifecycle() knows
    // whether to restart it, then defers to the existing, unmodified stop() for the actual teardown.
    fun pauseForLifecycle() {
        resumeTrackingAfterLifecyclePause = trackingState == TrackingState.ACTIVE || trackingState == TrackingState.STARTING
        Log.d("BeardTrimNative", "pauseForLifecycle: trackingState=$trackingState, willResume=$resumeTrackingAfterLifecyclePause")
        stop()
    }

    // Called from Android lifecycle resume (Activity foregrounded again). Only restarts tracking
    // if pauseForLifecycle() recorded that a real session was suspended; otherwise leaves the
    // coordinator IDLE, so an intentionally-stopped session does not spontaneously start.
    fun resumeForLifecycle() {
        if (resumeTrackingAfterLifecyclePause) {
            resumeTrackingAfterLifecyclePause = false
            Log.d("BeardTrimNative", "resumeForLifecycle: restarting tracking suspended by lifecycle pause (frontCamera=$lastFrontCamera)")
            start(lastFrontCamera)
        } else {
            resume()
        }
    }

    fun getArCoreSession(): Session? = arCore.getSession()

    // Only meaningful while the rear CameraX/MLKit session is bound; fails safely (returns
    // false) when the front/ARCore provider is active, since it has no CameraX Camera object.
    fun setTorchEnabled(enabled: Boolean): Boolean = mlKit.setTorchEnabled(enabled)

    // Stage A6.0A: bounded pass-through to the ARCore tracker's single-in-flight keyframe gate.
    fun requestSpatialKeyframe(requestId: String): Boolean = arCoreTracker.requestKeyframe(requestId)

    override fun close() {
        stop()
        mlKit.close()
        arCore.close()
        arCoreTracker.close()
    }
}
