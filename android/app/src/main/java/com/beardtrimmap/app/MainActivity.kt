package com.beardtrimmap.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.opengl.GLSurfaceView
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.ViewGroup
import android.view.Window
import android.view.TextureView
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.toColorInt
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.isVisible
import androidx.webkit.WebViewAssetLoader
import java.util.Timer
import java.util.TimerTask

class MainActivity : ComponentActivity() {
    private var container: FrameLayout? = null
    private var webView: WebView? = null
    private var arCoreView: GLSurfaceView? = null
    private var arCoreTextureView: TextureView? = null
    private var textureRenderer: ArCoreTextureRenderer? = null
    private var cameraXView: PreviewView? = null

    private var trackingBridge: NativeTrackingBridge? = null
    private lateinit var assetLoader: WebViewAssetLoader

    var syntheticMode = false
    private var syntheticTimer: Timer? = null
    @Volatile var isTrackingActive = false
    private val debugNavigationReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (!BuildConfig.DEBUG) return

            when (intent?.action) {
                "com.beardtrimmap.app.DEBUG_OPEN_FACE_SCAN" -> {
                    Log.d("BeardTrimNative", "DEBUG_OPEN_FACE_SCAN_RECEIVED")

                    webView?.evaluateJavascript(
                        """
                    (function() {
                        var navNodes = document.querySelectorAll('[data-screen="scan"]');

                        if (navNodes.length !== 1) {
                            console.log(
                                navNodes.length === 0
                                    ? 'DEBUG_OPEN_FACE_SCAN_NAV_MISSING'
                                    : 'DEBUG_OPEN_FACE_SCAN_NAV_DUPLICATE'
                            );
                            return false;
                        }

                        console.log('DEBUG_OPEN_FACE_SCAN_NAV_FOUND');
                        navNodes[0].click();

                        var attempts = 0;
                        var maxAttempts = 10;

                        var checkInterval = setInterval(function() {
                            attempts++;

                            var startNodes = document.querySelectorAll('#startScanBtn');

                            if (startNodes.length > 1) {
                                clearInterval(checkInterval);
                                console.log('DEBUG_OPEN_FACE_SCAN_START_DUPLICATE');
                                return;
                            }

                            if (startNodes.length === 1) {
                                var startBtn = startNodes[0];
                                var rects = startBtn.getClientRects();
                                var style = window.getComputedStyle(startBtn);

                                var visible =
                                    rects.length > 0 &&
                                    style.display !== 'none' &&
                                    style.visibility !== 'hidden';

                                if (visible) {
                                    clearInterval(checkInterval);
                                    console.log('DEBUG_OPEN_FACE_SCAN_START_FOUND');
                                    startBtn.click();
                                    return;
                                }
                            }

                            if (attempts >= maxAttempts) {
                                clearInterval(checkInterval);
                                console.log('DEBUG_OPEN_FACE_SCAN_START_MISSING_OR_NOT_VISIBLE');
                            }
                        }, 500);

                        return true;
                    })()
                    """.trimIndent(),
                        null
                    )
                }

                "com.beardtrimmap.app.DEBUG_CLOSE_FACE_SCAN" -> {
                    Log.d("BeardTrimNative", "DEBUG_CLOSE_FACE_SCAN_RECEIVED")

                    webView?.evaluateJavascript(
                        """
                    (function() {
                        var closeNodes = document.querySelectorAll('#closeScanBtn');

                        if (closeNodes.length === 0) {
                            console.log('DEBUG_CLOSE_FACE_SCAN_MISSING');
                            return false;
                        }

                        if (closeNodes.length > 1) {
                            console.log('DEBUG_CLOSE_FACE_SCAN_DUPLICATE');
                            return false;
                        }

                        console.log('DEBUG_CLOSE_FACE_SCAN_FOUND');
                        closeNodes[0].click();
                        return true;
                    })()
                    """.trimIndent(),
                        null
                    )
                }

                "com.beardtrimmap.app.DEBUG_MIRROR_MODE_A" -> {
                    Log.d("BeardTrimNative", "DEBUG_MIRROR_MODE_A_RECEIVED")
                    webView?.evaluateJavascript(
                        "window.BEARD_TRIM_MIRROR_MODE = 'A';",
                        null
                    )
                }

                "com.beardtrimmap.app.DEBUG_MIRROR_MODE_B" -> {
                    Log.d("BeardTrimNative", "DEBUG_MIRROR_MODE_B_RECEIVED")
                    webView?.evaluateJavascript(
                        "window.BEARD_TRIM_MIRROR_MODE = 'B';",
                        null
                    )
                }
            }
        }
    }

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        Log.d("BeardTrimNative", "Permission result: granted=$granted")
        if (granted) {
            trackingBridge?.onCameraPermissionGranted()
        } else {
            val permanentlyDenied = !ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.CAMERA)
            Log.d("BeardTrimNative", "Permission denied. permanentlyDenied=$permanentlyDenied")
            trackingBridge?.onCameraPermissionDenied(permanentlyDenied)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d("BeardTrimNative", "MainActivity: onCreate")

        // Final Fix (Test C success): Force window and decor transparency for TextureView composition
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
        window.decorView.setBackgroundColor(Color.TRANSPARENT)

        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        container = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.TRANSPARENT) // Permanent transparency for root
        }
        setContentView(container)

        setupNativeViews()
        setupWebView()
        setupImmersiveMode()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView?.let {
                    if (it.canGoBack()) it.goBack() else finish()
                } ?: finish()
            }
        })

        if (BuildConfig.DEBUG) {
            val filter = IntentFilter().apply {
                addAction("com.beardtrimmap.app.DEBUG_OPEN_FACE_SCAN")
                addAction("com.beardtrimmap.app.DEBUG_CLOSE_FACE_SCAN")
                addAction("com.beardtrimmap.app.DEBUG_MIRROR_MODE_A")
                addAction("com.beardtrimmap.app.DEBUG_MIRROR_MODE_B")
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(debugNavigationReceiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                registerReceiver(debugNavigationReceiver, filter)
            }
        }

        // Auto-start synthetic mode if in DEBUG and requested via intent
        if (BuildConfig.DEBUG && intent.getBooleanExtra("composition_test", false)) {
            startSyntheticMode()
        }
    }

    private fun isEmulator(): Boolean = (android.os.Build.BRAND.startsWith("generic") && android.os.Build.DEVICE.startsWith("generic"))
            || android.os.Build.FINGERPRINT.startsWith("generic")
            || android.os.Build.FINGERPRINT.startsWith("unknown")
            || android.os.Build.HARDWARE.contains("goldfish")
            || android.os.Build.HARDWARE.contains("ranchu")
            || android.os.Build.MODEL.contains("google_sdk")
            || android.os.Build.MODEL.contains("Emulator")
            || android.os.Build.MODEL.contains("Android SDK built for x86")
            || android.os.Build.MANUFACTURER.contains("Genymotion")
            || android.os.Build.PRODUCT.contains("sdk_google")
            || android.os.Build.PRODUCT.contains("google_sdk")
            || android.os.Build.PRODUCT.contains("sdk")
            || android.os.Build.PRODUCT.contains("sdk_x86")
            || android.os.Build.PRODUCT.contains("vbox86p")
            || android.os.Build.PRODUCT.contains("emulator")
            || android.os.Build.PRODUCT.contains("simulator")

    private fun setupImmersiveMode() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.navigationBars())
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            setupImmersiveMode()
        }
    }

    private fun setupNativeViews() {
        // Legacy GLSurfaceView (Hidden for now as fallback/reference)
        arCoreView = GLSurfaceView(this).apply {
            setEGLContextClientVersion(2)
            setRenderer(ArCoreFaceRenderer({ if (syntheticMode) null else trackingBridge?.getArCoreSession() }) { _, _, _, _, _ -> })
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
            isVisible = false
        }

        // New primary TextureView renderer (Breakthrough Fix)
        arCoreTextureView = TextureView(this).apply {
            val renderer = ArCoreTextureRenderer(
                activity = this@MainActivity,
                isSyntheticMode = { syntheticMode },
                sessionProvider = { if (syntheticMode) null else trackingBridge?.getArCoreSession() }
            ) { session, frame, _, _, _ ->
                if (!syntheticMode && session != null) {
                    trackingBridge?.onArCoreFrame(session, frame, 0, 0)
                }

                val productionReady = !syntheticMode && frame != null

                if (productionReady || syntheticMode) {
                    runOnUiThread {
                        if (this@apply.isVisible && this@apply.alpha == 0f) {
                            this@apply.alpha = 1f
                            setWebViewTransparency(true)
                            if (productionReady) {
                                Log.d("BeardTrimNative", "AR_PRODUCTION_PREVIEW_READY")
                            }
                        }
                    }
                }
            }
            textureRenderer = renderer
            surfaceTextureListener = renderer
            isVisible = false
        }

        cameraXView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            isVisible = false
        }

        container?.addView(arCoreView) // Legacy fallback
        container?.addView(arCoreTextureView) // New primary
        container?.addView(cameraXView)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val oldView = webView
        if (oldView != null) {
            container?.removeView(oldView)
            oldView.removeJavascriptInterface(NativeTrackingBridge.JS_NAME)
            oldView.destroy()
        }

        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        val newView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mediaPlaybackRequiresUserGesture = false

            // Breakthrough Fix: Set native transparency EXACTLY ONCE here.
            // Never dynamically change it again to avoid hardware layer regression.
            setBackgroundColor(Color.TRANSPARENT)
            setLayerType(View.LAYER_TYPE_HARDWARE, null)

            @SuppressLint("MissingOnRenderProcessGone")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
                    assetLoader.shouldInterceptRequest(request.url)

                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: WebResourceError,
                ) {
                    if (request.isForMainFrame) {
                        Toast.makeText(context, R.string.web_app_load_error, Toast.LENGTH_LONG).show()
                    }
                }

                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    handleRendererCrash()
                    return true
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    val wantsCamera = request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                    if (!wantsCamera) return request.deny()
                    if (checkCameraPermission()) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                    } else {
                        request.deny()
                        requestCameraPermission()
                    }
                }

                override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                    val msg = consoleMessage.message()
                    if (msg.contains("facialTransformationMatrix") || msg.contains("landmarks")) return true
                    Log.d("BeardTrimWebView", "[${consoleMessage.messageLevel()}] $msg -- From line ${consoleMessage.lineNumber()} of ${consoleMessage.sourceId()}")
                    return true
                }
            }
        }

        webView = newView
        val bridge = NativeTrackingBridge(
            activity = this,
            webView = newView,
            cameraXView = cameraXView!!,
            requestCameraPermission = ::requestCameraPermission,
        )
        trackingBridge = bridge
        Log.d("BeardTrimNative", "Registering JS Bridge: ${NativeTrackingBridge.JS_NAME}")
        newView.addJavascriptInterface(bridge, NativeTrackingBridge.JS_NAME)

        container?.addView(newView)

        val url = if (BuildConfig.DEBUG && intent.getBooleanExtra("scanDebug", false)) {
            "$APP_URL?scanDebug=1"
        } else {
            APP_URL
        }

        Log.d("BeardTrimNative", "Loading URL: $url")
        newView.loadUrl(url)
    }

    private fun handleRendererCrash() {
        Log.e("BeardTrimNative", "WebView renderer process crashed")
        trackingBridge?.stopSession()
        trackingBridge?.close()
        trackingBridge = null

        setupWebView()
        Toast.makeText(this, "WebView renderer process crashed. Reloading...", Toast.LENGTH_SHORT).show()
    }

    fun checkCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }

    fun requestCameraPermission() {
        runOnUiThread {
            Log.d("BeardTrimNative", "[Thread:${Thread.currentThread().name}] Launching camera permission request")
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    fun openAppSettings() {
        runOnUiThread {
            Log.d("BeardTrimNative", "[Thread:${Thread.currentThread().name}] Opening App Settings")
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
                startActivity(this)
            }
        }
    }

    fun setWebViewTransparency(transparent: Boolean) {
        runOnUiThread {
            Log.d("BeardTrimNative", "[Thread:${Thread.currentThread().name}] setWebViewTransparency: $transparent")
            // breakthrough Fix: Controls ONLY Web/CSS state for verified root layers.
            if (transparent) {
                webView?.evaluateJavascript("""
                    (function() {
                        var styleId = 'native-transparency-fix';
                        var style = document.getElementById(styleId);
                        if (!style) {
                            style = document.createElement('style');
                            style.id = styleId;
                            document.head.appendChild(style);
                        }
                        // Target ONLY verified root layers for transparency
                        style.innerHTML = 'html, body, #root { background: transparent !important; background-color: transparent !important; background-image: none !important; }';
                    })()
                """.trimIndent(), null)
            } else {
                webView?.evaluateJavascript("""
                    (function() {
                        var style = document.getElementById('native-transparency-fix');
                        if (style) style.remove();
                    })()
                """.trimIndent(), null)
            }
        }
    }

    fun setNativePreviewVisible(arCore: Boolean, cameraX: Boolean) {
        runOnUiThread {
            Log.d("BeardTrimNative", "[Thread:${Thread.currentThread().name}] setNativePreviewVisible: arCore=$arCore, cameraX=$cameraX")
            if (arCore) {
                arCoreTextureView?.isVisible = true
                arCoreTextureView?.alpha = 0f
                textureRenderer?.setRenderingEnabled(true)
            } else {
                textureRenderer?.setRenderingEnabled(false)
                arCoreTextureView?.isVisible = false
            }
            cameraXView?.isVisible = cameraX
        }
    }

    fun startSyntheticMode() {
        Log.d("BeardTrimNative", "Starting synthetic mode for composition test")
        syntheticMode = true
        runOnUiThread {
            setNativePreviewVisible(arCore = true, cameraX = false)
            arCoreTextureView?.alpha = 1f
            webView?.alpha = 1f
            setWebViewTransparency(true)
            Log.d("BeardTrimNative", "Synthetic mode active: Checkerboard + UI + Moving Mapping")
        }

        syntheticTimer = Timer().apply {
            schedule(object : TimerTask() {
                private var frame = 0
                override fun run() {
                    val landmarks = List(468) { i ->
                        // Moving pattern for landmarks
                        val t = frame * 0.05
                        TrackingPoint(
                            0.5f + (Math.sin(t + i * 0.02) * 0.2).toFloat(),
                            0.5f + (Math.cos(t + i * 0.02) * 0.2).toFloat(),
                            0f
                        )
                    }
                    trackingBridge?.emitSyntheticPacket(landmarks)
                    frame++
                }
            }, 0, 33)
        }
    }

    fun requestNativeCapture(requestId: String) {
        val view = arCoreTextureView
        if (view == null || !view.isAvailable || view.width <= 0 || view.height <= 0) {
            trackingBridge?.onNativeCaptureResult(requestId, null, 0, 0, "Native camera surface not ready")
            return
        }

        // Phase 1.7: bracket getBitmap() with the renderer's last-presented-frame identity.
        val renderedTimestampBefore = textureRenderer?.lastRenderedFrameTimestampNs

        val bitmap = try {
            view.getBitmap()
        } catch (e: Exception) {
            trackingBridge?.onNativeCaptureResult(
                requestId, null, 0, 0, "Capture exception: ${e.message}",
                renderedTimestampBefore = renderedTimestampBefore
            )
            null
        }

        val renderedTimestampAfter = textureRenderer?.lastRenderedFrameTimestampNs
        val photoFrameAssociation = when {
            renderedTimestampBefore != null && renderedTimestampAfter != null && renderedTimestampBefore == renderedTimestampAfter -> "matched"
            renderedTimestampBefore != null && renderedTimestampAfter != null -> "ambiguous"
            else -> "unavailable"
        }
        val photoFrameTimestampNs = if (photoFrameAssociation == "matched") renderedTimestampBefore else null

        // Phase 1.9: read the consumer-side SurfaceTexture timestamp on this same UI-thread
        // call stack, immediately after getBitmap(). Only trusted (never fabricated as 0) when
        // eglPresentationTimeANDROID stamping has both succeeded at least once this session and
        // succeeded on the most recent swap; otherwise reported unavailable. Diagnostic-only,
        // side-by-side with the Phase 1.7 bracket above -- does not replace it.
        val renderer = textureRenderer
        val stampingTrusted = renderer != null &&
            renderer.presentationTimestampStampingEverSucceeded &&
            renderer.lastPresentationTimestampCallSucceeded
        val rawSurfaceTextureTimestampNs = if (stampingTrusted) renderer?.currentSurfaceTexture?.timestamp else null
        val surfaceTextureIdentityStatus = if (stampingTrusted && rawSurfaceTextureTimestampNs != null && rawSurfaceTextureTimestampNs != 0L) "matched" else "unavailable"
        val surfaceTextureTimestampNs = if (surfaceTextureIdentityStatus == "matched") rawSurfaceTextureTimestampNs else null

        if (bitmap == null) {
            trackingBridge?.onNativeCaptureResult(
                requestId, null, 0, 0, "TextureView.getBitmap() failed",
                photoFrameTimestampNs, renderedTimestampBefore, renderedTimestampAfter, photoFrameAssociation,
                surfaceTextureTimestampNs, surfaceTextureIdentityStatus
            )
            return
        }

        if (bitmap.width <= 0 || bitmap.height <= 0 || bitmap.isRecycled) {
            trackingBridge?.onNativeCaptureResult(
                requestId, null, 0, 0, "Captured bitmap is invalid",
                photoFrameTimestampNs, renderedTimestampBefore, renderedTimestampAfter, photoFrameAssociation,
                surfaceTextureTimestampNs, surfaceTextureIdentityStatus
            )
            return
        }

        // Process compression in background to avoid blocking UI or bridge threads
        Thread {
            try {
                val out = java.io.ByteArrayOutputStream()
                // Match index.html capturePhoto quality (approx .92)
                bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 92, out)
                val base64 = android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)
                val dataUrl = "data:image/jpeg;base64,$base64"

                runOnUiThread {
                    trackingBridge?.onNativeCaptureResult(
                        requestId, dataUrl, bitmap.width, bitmap.height, null,
                        photoFrameTimestampNs, renderedTimestampBefore, renderedTimestampAfter, photoFrameAssociation,
                        surfaceTextureTimestampNs, surfaceTextureIdentityStatus
                    )
                }
            } catch (e: Exception) {
                runOnUiThread {
                    trackingBridge?.onNativeCaptureResult(
                        requestId, null, 0, 0, "Image processing error: ${e.message}",
                        photoFrameTimestampNs, renderedTimestampBefore, renderedTimestampAfter, photoFrameAssociation,
                        surfaceTextureTimestampNs, surfaceTextureIdentityStatus
                    )
                }
            } finally {
                bitmap.recycle()
            }
        }.apply {
            name = "NativeCaptureThread"
            start()
        }
    }

    override fun onPause() {
        Log.d("BeardTrimNative", "MainActivity: onPause")
        textureRenderer?.setRenderingEnabled(false)
        trackingBridge?.onPauseLifecycle()
        webView?.onPause()
        syntheticTimer?.cancel()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        Log.d("BeardTrimNative", "MainActivity: onResume")
        webView?.onResume()
        trackingBridge?.onResume()
    }

    override fun onDestroy() {
        Log.d("BeardTrimNative", "MainActivity: onDestroy")
        try {
            unregisterReceiver(debugNavigationReceiver)
        } catch (e: Exception) {}
        textureRenderer?.setRenderingEnabled(false)
        trackingBridge?.close()
        webView?.removeJavascriptInterface(NativeTrackingBridge.JS_NAME)
        webView?.destroy()
        super.onDestroy()
    }

    companion object {
        private const val APP_URL = "https://appassets.androidplatform.net/assets/index.html"
    }
}
