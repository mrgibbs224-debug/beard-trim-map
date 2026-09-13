package com.beardtrimmap.app

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.camera.view.PreviewView
import com.google.ar.core.Session
import org.json.JSONObject

class NativeTrackingBridge(
    private val activity: MainActivity,
    private val webView: WebView,
    private val cameraXView: PreviewView,
    private val requestCameraPermission: () -> Unit,
) : AutoCloseable {
    private val tracker = NativeTrackingCoordinator(activity, activity, activity, cameraXView, ::emitPacket, ::emitState, ::emitKeyframeResult)

    // SCAN-LOCK-V1B -- native Voice Guidance transport. Constructed eagerly here (app-launch
    // time) so asynchronous TextToSpeech initialization has time to complete well before any
    // scan or Settings interaction, per the "never block scanner execution" requirement. Isolated
    // from `tracker` -- knows nothing about scanning/tracking/capture.
    private val voiceGuidance = VoiceGuidanceTts(activity)

    @JavascriptInterface
    fun capabilities(): String = JSONObject().apply {
        put("contractVersion", CONTRACT_VERSION)
        put("nativeTrackingFoundation", true)
        put("nativePreviewSurface", true)
        put("activeProvider", "native")
        put("providerPriority", "arcore-augmented-faces,mlkit-face-mesh,browser-mediapipe-emergency")
        put("coordinateSystem", "normalized-oriented-image")
        put("landmarkCount", 468)
        put("poseIds", JSONObject.NULL)
        put("sessionOnly", true)
    }.toString()

    // CORE-CAM1-B0.1: the ONE normalized camera-capability snapshot the JS Scanner / Live Map
    // layers consult. Chain: CameraCapabilityInspector.census() (read-only, opens nothing) ->
    // CameraRoleResolver.resolve() (pure) -> CameraRoleAvailabilitySnapshot (pure map) -> JSON.
    // Resolved once (static device metadata) and cached; refreshCameraCapabilities() clears the
    // cache for a genuine re-ask. No camera IDs / Camera2 internals / vendor strings cross to JS;
    // this never selects a production camera.
    private var cachedCameraRoleJson: String? = null

    @JavascriptInterface
    fun cameraRoleAvailability(): String {
        cachedCameraRoleJson?.let { return it }
        val json = try {
            val census = CameraCapabilityInspector(activity).census()
            val availability = CameraRoleResolver.resolve(census)
            val censusErr = census.errors.firstOrNull()
            JSONObject(CameraRoleAvailabilitySnapshot.of(availability, census.apiLevel, censusErr)).toString()
        } catch (e: Exception) {
            Log.w("BeardTrimNative", "cameraRoleAvailability() census/resolve failed: ${e.javaClass.simpleName}")
            JSONObject(CameraRoleAvailabilitySnapshot.failed(e.javaClass.simpleName)).toString()
        }
        cachedCameraRoleJson = json
        return json
    }

    @JavascriptInterface
    fun refreshCameraCapabilities() {
        cachedCameraRoleJson = null
    }

    @JavascriptInterface
    fun startTracking(facingMode: String): String {
        Log.d("BeardTrimNative", "[Thread:${Thread.currentThread().name}] Bridge: startTracking($facingMode)")
        return tracker.start(frontCamera = facingMode != "environment")
    }

    // Only meaningful while the rear CameraX/MLKit session is bound; fails safely (returns
    // false) otherwise -- see NativeTrackingCoordinator.setTorchEnabled / MlKitFaceMeshTracker.
    @JavascriptInterface
    fun setTorchEnabled(enabled: Boolean): Boolean {
        Log.d("BeardTrimNative", "[Thread:${Thread.currentThread().name}] Bridge: setTorchEnabled($enabled)")
        return tracker.setTorchEnabled(enabled)
    }

    @JavascriptInterface
    fun requestNativeCapture(requestId: String) {
        activity.runOnUiThread {
            activity.requestNativeCapture(requestId)
        }
    }

    // Stage A6.0A: developer-only. Returns true iff this request was accepted (no other keyframe
    // request currently in flight) -- callers must treat false as an immediate rejection, not a
    // pending one, since no result callback will otherwise arrive for a rejected requestId.
    @JavascriptInterface
    fun requestSpatialKeyframe(requestId: String): Boolean {
        return tracker.requestSpatialKeyframe(requestId)
    }

    @JavascriptInterface 
    fun stopTracking() {
        Log.d("BeardTrimNative", "[Thread:${Thread.currentThread().name}] Bridge: stopTracking()")
        stopSession()
    }
    @JavascriptInterface fun clearSession() = stopSession()

    @JavascriptInterface
    fun setTransparency(transparent: Boolean) {
        activity.setWebViewTransparency(transparent)
    }

    @JavascriptInterface
    fun openSettings() {
        activity.openAppSettings()
    }

    // ============================================================
    // METTLE SETTINGS S2 -- NATIVE PREFERENCE FOUNDATION
    // A deliberately small, allowlisted SharedPreferences-backed surface for the future
    // Mettle Settings screen. Nothing in the app reads or depends on these values yet --
    // this stage only proves the persistence plumbing (see index.html's mgPrefs wrapper
    // and window.__mgPrefsSelfTest). domStorageEnabled stays false; this is the
    // deliberate alternative to WebView DOM storage. Keys are fixed and allowlisted here
    // ONLY -- there is no arbitrary key/value storage from JS. Every accessor fails
    // closed (unknown key -> rejected; malformed/corrupt stored value -> safe default,
    // never a crash).
    private val prefs: SharedPreferences by lazy {
        activity.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
    }

    @JavascriptInterface
    fun getBoolPreference(key: String): Boolean {
        val fallback = BOOL_PREF_DEFAULTS[key]
        if (fallback == null) {
            Log.w("BeardTrimNative", "getBoolPreference rejected unknown key=$key")
            return false
        }
        return try {
            prefs.getBoolean(key, fallback)
        } catch (e: Exception) {
            Log.w("BeardTrimNative", "getBoolPreference($key) malformed value, using default: ${e.javaClass.simpleName}")
            fallback
        }
    }

    @JavascriptInterface
    fun setBoolPreference(key: String, value: Boolean): Boolean {
        if (!BOOL_PREF_DEFAULTS.containsKey(key)) {
            Log.w("BeardTrimNative", "setBoolPreference rejected unknown key=$key")
            return false
        }
        return try {
            prefs.edit().putBoolean(key, value).apply()
            true
        } catch (e: Exception) {
            Log.e("BeardTrimNative", "setBoolPreference($key) failed: ${e.javaClass.simpleName}")
            false
        }
    }

    // String prefs intentionally have NO forced native default -- absent means "let the
    // existing JS-side default/derivation stand" (S2 scope: do not wire these to runtime
    // behavior yet). Returns null, never throws, when unset or unreadable.
    @JavascriptInterface
    fun getStringPreference(key: String): String? {
        if (!STRING_PREF_KEYS.contains(key)) {
            Log.w("BeardTrimNative", "getStringPreference rejected unknown key=$key")
            return null
        }
        return try {
            if (prefs.contains(key)) prefs.getString(key, null) else null
        } catch (e: Exception) {
            Log.w("BeardTrimNative", "getStringPreference($key) malformed value, returning null: ${e.javaClass.simpleName}")
            null
        }
    }

    @JavascriptInterface
    fun setStringPreference(key: String, value: String): Boolean {
        if (!STRING_PREF_KEYS.contains(key)) {
            Log.w("BeardTrimNative", "setStringPreference rejected unknown key=$key")
            return false
        }
        return try {
            prefs.edit().putString(key, value).apply()
            true
        } catch (e: Exception) {
            Log.e("BeardTrimNative", "setStringPreference($key) failed: ${e.javaClass.simpleName}")
            false
        }
    }

    // Symmetric with get/setStringPreference: restores true absence (as opposed to writing
    // back a value that merely equals the JS-side default), which set() alone cannot do.
    // Same allowlist, same fail-closed contract as every other preference accessor.
    @JavascriptInterface
    fun removePreference(key: String): Boolean {
        if (!BOOL_PREF_DEFAULTS.containsKey(key) && !STRING_PREF_KEYS.contains(key)) {
            Log.w("BeardTrimNative", "removePreference rejected unknown key=$key")
            return false
        }
        return try {
            prefs.edit().remove(key).apply()
            true
        } catch (e: Exception) {
            Log.e("BeardTrimNative", "removePreference($key) failed: ${e.javaClass.simpleName}")
            false
        }
    }

    @JavascriptInterface
    fun log(msg: String) {
        Log.d("BeardTrimBridge", msg)
    }

    // ============================================================
    // SCAN-LOCK-V1B -- NATIVE VOICE GUIDANCE TRANSPORT
    // Truthful contract, deliberately separate from the scan_voice_guidance_enabled preference:
    // isVoiceGuidanceAvailable() reports whether the on-device TextToSpeech engine has actually
    // finished initializing successfully with a usable English voice -- NOT whether the user
    // preference is on. index.html's mgVoice combines both before ever calling speak.
    // ============================================================
    @JavascriptInterface
    fun isVoiceGuidanceAvailable(): Boolean = voiceGuidance.isAvailable()

    @JavascriptInterface
    fun speakVoiceGuidance(text: String) {
        activity.runOnUiThread { voiceGuidance.speak(text) }
    }

    @JavascriptInterface
    fun stopVoiceGuidance() {
        activity.runOnUiThread { voiceGuidance.stop() }
    }

    // ============================================================
    // BI-1Z0C -- EXACT_FRAME_RESEARCH_CAPTURE. Research-only. Lets index.html's Settings ->
    // Research & Development section decide whether to reveal itself at all: true only in a
    // debug/research build (BuildConfig.DEBUG), false in a release build, with no separate
    // Gradle flavor or manifest change needed. Never wired to any consumer-facing behavior.
    // ============================================================
    @JavascriptInterface
    fun isResearchBuild(): Boolean = BuildConfig.DEBUG

    // Research observability (BI-1Z0C Part 5) -- APP/DEVICE identifiers only, captured ONCE per
    // export (not repeated per keyframe: identical for every sample in a session). Every value
    // here is either an existing BuildConfig field or a plain android.os.Build constant already
    // available with zero new dependency/permission/machinery -- nothing here is fabricated, and
    // nothing here is wired into any consumer-facing behavior.
    @JavascriptInterface
    fun deviceResearchMetadata(): String = JSONObject().apply {
        put("appVersionName", BuildConfig.VERSION_NAME)
        put("appVersionCode", BuildConfig.VERSION_CODE)
        put("trackingBridgeVersion", BuildConfig.TRACKING_BRIDGE_VERSION)
        put("deviceManufacturer", android.os.Build.MANUFACTURER)
        put("deviceModel", android.os.Build.MODEL)
        put("androidVersionRelease", android.os.Build.VERSION.RELEASE)
        put("androidSdkInt", android.os.Build.VERSION.SDK_INT)
    }.toString()

    // Durable local save for the Exact-Frame Research Capture export. Plain Blob+<a download> is
    // NOT reliably supported inside this app's WebView (no DownloadListener is registered, and
    // none existed to reuse), so this writes via the public MediaStore Downloads collection --
    // no WRITE_EXTERNAL_STORAGE permission required on this project's minSdk (29+ scoped-storage
    // API), and the result is immediately visible in Files/Downloads and adb-pullable. Local-only:
    // no network, no cloud. Returns a JSON string {"ok":true,"path":...} or {"ok":false,"error":...}
    // -- the caller (index.html) always shows the user an explicit success or failure message,
    // never silently assumes success.
    @JavascriptInterface
    fun saveResearchCapture(json: String, filename: String): String {
        // MediaStore.Downloads (scoped storage) requires API 29+; this project's minSdk is 24.
        // The target physical test device is well above 29, but fail closed with an explicit,
        // visible error rather than crash on a hypothetical older device.
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q) {
            return JSONObject().put("ok", false)
                .put("error", "Research capture save requires Android 10 (API 29) or newer; this device is API ${android.os.Build.VERSION.SDK_INT}")
                .toString()
        }
        return try {
            val resolver = activity.contentResolver
            val values = android.content.ContentValues().apply {
                put(android.provider.MediaStore.Downloads.DISPLAY_NAME, filename)
                put(android.provider.MediaStore.Downloads.MIME_TYPE, "application/json")
                put(android.provider.MediaStore.Downloads.RELATIVE_PATH, "Download/Mettle")
            }
            val uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: return JSONObject().put("ok", false).put("error", "MediaStore insert returned null").toString()
            val stream = resolver.openOutputStream(uri)
                ?: return JSONObject().put("ok", false).put("error", "openOutputStream returned null").toString()
            stream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
            Log.d("BeardTrimNative", "EXACT_FRAME_RESEARCH_CAPTURE saved: Download/Mettle/$filename (${json.length} chars)")
            JSONObject().put("ok", true).put("path", "Download/Mettle/$filename").toString()
        } catch (e: Exception) {
            Log.e("BeardTrimNative", "saveResearchCapture failed: ${e.javaClass.simpleName}: ${e.message}")
            JSONObject().put("ok", false).put("error", "${e.javaClass.simpleName}: ${e.message}").toString()
        }
    }

    fun onCameraPermissionGranted() {
        tracker.resumePendingStart()
    }

    fun onCameraPermissionDenied(permanently: Boolean) {
        emitState(if (permanently) "permission-permanently-denied" else "permission-denied")
    }

    fun onResume() {
        tracker.resumeForLifecycle()
    }

    // Distinct from stopSession(): only for Android lifecycle pause (Activity backgrounded),
    // not for explicit/user-requested stops (leaving Live Map, closing Scanner, switching camera).
    // SCAN-LOCK-V1B: also stops any in-flight guidance speech -- it must never keep talking into
    // the background. The TTS engine binding itself is left intact (it survives pause/resume; no
    // scanner state is touched by this).
    fun onPauseLifecycle() {
        tracker.pauseForLifecycle()
        voiceGuidance.stop()
    }

    fun stopSession() = tracker.stop()

    fun getArCoreSession(): Session? = tracker.getArCoreSession()

    fun onArCoreFrame(session: Session, frame: com.google.ar.core.Frame?, w: Int, h: Int) {
        tracker.onArCoreFrame(session, frame, w, h)
    }

    override fun close() {
        tracker.close()
        voiceGuidance.shutdown()
    }

    fun emitSyntheticPacket(landmarks: List<TrackingPoint>) {
        emitPacket(
            TrackingPacket(
                provider = "synthetic-test",
                timestampMs = System.currentTimeMillis(),
                frameWidth = 1080,
                frameHeight = 1920,
                rotationDegrees = 0,
                mirrored = true,
                inferenceMs = 5L,
                landmarks = landmarks,
                transformationMatrix = null,
                poseYawDeg = null,
                posePitchDeg = null,
                poseRollDeg = null
            )
        )
    }

    fun onNativeCaptureResult(
        requestId: String,
        dataUrl: String?,
        width: Int,
        height: Int,
        error: String?,
        photoFrameTimestampNs: Long? = null,
        renderedTimestampBefore: Long? = null,
        renderedTimestampAfter: Long? = null,
        photoFrameAssociation: String = "unavailable",
        // Phase 1.9: SurfaceTexture-based exact photo identity, additive alongside the
        // Phase 1.7 before/after bracket fields above. Not authoritative yet.
        surfaceTextureTimestampNs: Long? = null,
        surfaceTextureIdentityStatus: String = "unavailable"
    ) {
        emit("window.onNativeCaptureResult", JSONObject().apply {
            put("requestId", requestId)
            put("success", error == null)
            put("dataUrl", dataUrl ?: JSONObject.NULL)
            put("width", width)
            put("height", height)
            put("error", error ?: JSONObject.NULL)
            put("photoFrameTimestampNs", photoFrameTimestampNs?.toString() ?: JSONObject.NULL)
            put("renderedTimestampBefore", renderedTimestampBefore?.toString() ?: JSONObject.NULL)
            put("renderedTimestampAfter", renderedTimestampAfter?.toString() ?: JSONObject.NULL)
            put("photoFrameAssociation", photoFrameAssociation)
            put("surfaceTextureTimestampNs", surfaceTextureTimestampNs?.toString() ?: JSONObject.NULL)
            put("surfaceTextureIdentityStatus", surfaceTextureIdentityStatus)
        })
    }

    // Stage A6.0A: emits a Tier-B keyframe result. Uses the same evaluateJavascript/emit path as
    // every other bridge callback -- no new dispatch mechanism.
    private fun emitKeyframeResult(result: SpatialKeyframeResult) {
        emit("window.__onNativeKeyframeResult", result.toJson())
    }

    private var firstPacketEmitted = false

    private fun emitPacket(packet: TrackingPacket) {
        if (!firstPacketEmitted) {
            firstPacketEmitted = true
            Log.d("BeardTrimNative", "NATIVE_LANDMARK_DISPATCH_FIRST count=${packet.landmarks.size}")
        }
        emit("window.BeardTrimNative?.onTrackingPacket", packet.toJson())
    }

    private fun emitState(state: String) {
        Log.d("BeardTrimNative", "NATIVE_STATE_DISPATCH active provider=$state")
        
        // Tightened tracking state logic
        activity.isTrackingActive = when (state) {
            "starting", "started", "arcore-active", "arcore-tracking", "mlkit-active", "mlkit-verifier-tracking" -> true
            else -> false
        }

        emit(
            "window.BeardTrimNative?.onTrackingState",
            JSONObject().put("contractVersion", CONTRACT_VERSION).put("state", state),
        ) {
            Log.d("BeardTrimNative", "NATIVE_STATE_JS_ACK active provider=$state")
        }
    }

    private fun emit(callback: String, value: JSONObject, onComplete: (() -> Unit)? = null) {
        webView.post {
            webView.evaluateJavascript("$callback(${JSONObject.quote(value.toString())});") {
                onComplete?.invoke()
            }
        }
    }

    companion object {
        const val JS_NAME = "BeardTrimAndroid"
        const val CONTRACT_VERSION = 1

        // METTLE SETTINGS S2: the ONLY preference keys this bridge will read or write.
        // Do not add a key here without a matching update to index.html's mgPrefs
        // allowlist (MG_PREF_BOOL_DEFAULTS / MG_PREF_STRING_KEYS) -- the two lists must
        // stay in lockstep, since either side rejecting a key is what "fail closed" means.
        private const val PREFS_FILE = "mettle_prefs"
        private val BOOL_PREF_DEFAULTS = mapOf(
            "scan_voice_guidance_enabled" to true,
            "scan_sounds_enabled" to true,
            "scan_haptics_enabled" to true,
        )
        private val STRING_PREF_KEYS = setOf(
            "default_camera_role",
            "edge_light_level",
        )
    }
}
