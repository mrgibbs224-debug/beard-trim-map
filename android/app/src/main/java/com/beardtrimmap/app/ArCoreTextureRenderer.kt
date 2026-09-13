package com.beardtrimmap.app

import android.graphics.SurfaceTexture
import android.opengl.*
import android.util.Log
import android.view.TextureView
import com.google.ar.core.AugmentedFace
import com.google.ar.core.Frame
import com.google.ar.core.Session
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.atomic.AtomicBoolean

class ArCoreTextureRenderer(
    private val activity: androidx.activity.ComponentActivity,
    private val isSyntheticMode: () -> Boolean,
    private val sessionProvider: () -> Session?,
    private val onFrameProduced: (Session?, Frame?, Int, Int, Boolean) -> Unit,
) : TextureView.SurfaceTextureListener {

    private var renderThread: Thread? = null
    private val running = AtomicBoolean(false)
    private val isRenderingEnabled = AtomicBoolean(false)
    
    private var eglDisplay = EGL14.EGL_NO_DISPLAY
    private var eglContext = EGL14.EGL_NO_CONTEXT
    private var eglSurface = EGL14.EGL_NO_SURFACE
    
    private var textureId = -1
    private var viewportWidth = 1
    private var viewportHeight = 1
    private var surfaceTexture: SurfaceTexture? = null
    
    private val backgroundDrawReported = AtomicBoolean(false)
    private val syntheticCheckerboardReported = AtomicBoolean(false)
    private val firstDrawReported = AtomicBoolean(false)
    private val firstFrameReported = AtomicBoolean(false)
    private val firstFaceReported = AtomicBoolean(false)
    private val renderIdleReported = AtomicBoolean(false)
    private var lastSession: Session? = null

    // Phase 1.7: identity of the ARCore frame whose swap has actually completed and is
    // presented/capturable in the TextureView. Written only after a successful eglSwapBuffers().
    @Volatile var lastRenderedFrameTimestampNs: Long? = null

    // Phase 1.9: read-only access to the SurfaceTexture so the UI thread can read
    // SurfaceTexture.getTimestamp() right after TextureView.getBitmap(). No lifecycle change:
    // this is the same field already set in onSurfaceTextureAvailable().
    val currentSurfaceTexture: SurfaceTexture? get() = surfaceTexture

    // Phase 1.9: diagnostic state for EGLExt.eglPresentationTimeANDROID stamping reliability.
    // Written only on the render thread; read (volatile) from the UI thread. Fail-closed: a
    // false value on either flag means the SurfaceTexture-based exact photo identity must not
    // be treated as authoritative for the buffer a capture just copied.
    @Volatile var presentationTimestampStampingEverSucceeded: Boolean = false
        private set
    @Volatile var lastPresentationTimestampCallSucceeded: Boolean = false
        private set

    fun setRenderingEnabled(enabled: Boolean) {
        if (isRenderingEnabled.getAndSet(enabled) != enabled) {
            Log.d("BeardTrimNative", "AR_TEXTURE_RENDER_ACTIVE=$enabled")
            if (!enabled) {
                // Reset reports for next entry to allow alpha promotion and fresh logs
                firstDrawReported.set(false)
                backgroundDrawReported.set(false)
                firstFrameReported.set(false)
                firstFaceReported.set(false)
                renderIdleReported.set(false)
            }
        }
    }

    override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
        Log.d("BeardTrimNative", "AR_TEXTURE_VIEW_AVAILABLE: ${width}x${height}")
        surfaceTexture = st
        viewportWidth = width
        viewportHeight = height
        startRenderThread()
    }

    override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) {
        viewportWidth = width
        viewportHeight = height
    }

    override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
        stopRenderThread()
        return true
    }

    override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}

    private fun startRenderThread() {
        running.set(true)
        renderThread = Thread {
            try {
                initEGL()
                renderLoop()
            } catch (e: Exception) {
                Log.e("BeardTrimNative", "RENDER_THREAD_ERROR: ${e.message}")
            } finally {
                releaseEGL()
            }
        }.apply { 
            name = "ArCoreRenderThread"
            start() 
        }
    }

    private fun stopRenderThread() {
        running.set(false)
        renderThread?.join(1000)
        renderThread = null
    }

    private fun initEGL() {
        eglDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        val version = IntArray(2)
        EGL14.eglInitialize(eglDisplay, version, 0, version, 1)
        
        val configAttribs = intArrayOf(
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            EGL14.EGL_RED_SIZE, 8,
            EGL14.EGL_GREEN_SIZE, 8,
            EGL14.EGL_BLUE_SIZE, 8,
            EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_DEPTH_SIZE, 16,
            EGL14.EGL_STENCIL_SIZE, 0,
            EGL14.EGL_NONE
        )
        val configs = arrayOfNulls<EGLConfig>(1)
        val numConfigs = IntArray(1)
        EGL14.eglChooseConfig(eglDisplay, configAttribs, 0, configs, 0, 1, numConfigs, 0)
        val config = configs[0] ?: return
        
        val contextAttribs = intArrayOf(
            EGL14.EGL_CONTEXT_CLIENT_VERSION, 2,
            EGL14.EGL_NONE
        )
        eglContext = EGL14.eglCreateContext(eglDisplay, config, EGL14.EGL_NO_CONTEXT, contextAttribs, 0)
        
        eglSurface = EGL14.eglCreateWindowSurface(eglDisplay, config, surfaceTexture, intArrayOf(EGL14.EGL_NONE), 0)
        
        EGL14.eglMakeCurrent(eglDisplay, eglSurface, eglSurface, eglContext)
        Log.d("BeardTrimNative", "AR_EGL_CONTEXT_CREATED")
        
        setupGL()
    }

    private var backgroundRenderer: BackgroundRenderer? = null

    private fun setupGL() {
        val textures = IntArray(1)
        GLES20.glGenTextures(1, textures, 0)
        textureId = textures[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        Log.d("BeardTrimNative", "AR_CAMERA_TEXTURE_BOUND: $textureId")
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        
        backgroundRenderer = BackgroundRenderer()
    }

    private fun renderLoop() {
        while (running.get()) {
            if (!isRenderingEnabled.get()) {
                Thread.sleep(100)
                continue
            }

            val session = sessionProvider()
            if (session == null && !isSyntheticMode()) {
                if (!renderIdleReported.getAndSet(true)) {
                    Log.d("BeardTrimNative", "AR_TEXTURE_RENDER_IDLE_NO_SESSION")
                }
                Thread.sleep(16)
                continue
            } else if (renderIdleReported.getAndSet(false)) {
                Log.d("BeardTrimNative", "AR_TEXTURE_RENDER_RESUMED")
            }

            if (!firstDrawReported.getAndSet(true)) {
                Log.d("BeardTrimNative", "AR_DRAW_FRAME_FIRST")
            }

            if (session != null) {
                if (session != lastSession) {
                    Log.d("BeardTrimNative", "AR_TEXTURE_SESSION_CHANGED")
                    session.setCameraTextureName(textureId)
                    lastSession = session
                }
                session.setDisplayGeometry(0, viewportWidth, viewportHeight)
            }

            GLES20.glViewport(0, 0, viewportWidth, viewportHeight)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)

            var backgroundDrawn = false
            var frameForSwap: Frame? = null
            try {
                val frame = session?.update()
                frameForSwap = frame

                if (frame != null && !backgroundDrawReported.get()) {
                    Log.d("BeardTrimNative", "AR_CAMERA_BACKGROUND_DRAW_FIRST")
                }
                
                backgroundRenderer?.draw(frame)
                
                if (frame != null) {
                    backgroundDrawn = true
                    if (!backgroundDrawReported.getAndSet(true)) {
                        Log.d("BeardTrimNative", "AR_CAMERA_BACKGROUND_DRAW_OK")
                    }
                    if (!firstFrameReported.getAndSet(true)) {
                        Log.d("BeardTrimNative", "AR_SESSION_UPDATE_FIRST")
                        Log.d("BeardTrimNative", "AR_CAMERA_FRAME_AVAILABLE")
                    }
                } else {
                    backgroundDrawn = session == null && isSyntheticMode()
                }

                val faces = session?.getAllTrackables(AugmentedFace::class.java)
                if (faces != null && faces.isNotEmpty() && !firstFaceReported.getAndSet(true)) {
                    Log.d("BeardTrimNative", "AR_FACE_TRACKING_FIRST")
                }

                onFrameProduced(session ?: lastSession, frame, viewportWidth, viewportHeight, backgroundDrawn)
            } catch (e: Exception) {
                if (session != null) {
                    val msg = e.message ?: "null"
                    if (msg != "null") {
                        Log.e("BeardTrimNative", "ARCORE_DRAW_ERROR thread=${Thread.currentThread().name} msg=$msg")
                    }
                }
            }

            // Phase 1.9: stamp this buffer's EGL presentation time with the same ARCore
            // Frame.timestamp already used for background rendering/tracking/nativeFrameTimestampNs,
            // immediately before the swap that presents it. eglSwapBuffers/session.update/draw
            // order and cadence are unchanged.
            var presentationTimestampCallSucceeded = false
            frameForSwap?.let { f ->
                presentationTimestampCallSucceeded = EGLExt.eglPresentationTimeANDROID(eglDisplay, eglSurface, f.timestamp)
                if (presentationTimestampCallSucceeded) {
                    presentationTimestampStampingEverSucceeded = true
                }
            }
            lastPresentationTimestampCallSucceeded = presentationTimestampCallSucceeded

            if (EGL14.eglSwapBuffers(eglDisplay, eglSurface)) {
                frameForSwap?.let { lastRenderedFrameTimestampNs = it.timestamp }
            } else {
                Log.w("BeardTrimNative", "eglSwapBuffers failed")
            }

            Thread.sleep(16)
        }
    }

    private fun releaseEGL() {
        if (eglDisplay != EGL14.EGL_NO_DISPLAY) {
            EGL14.eglMakeCurrent(eglDisplay, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
            if (eglSurface != EGL14.EGL_NO_SURFACE) {
                EGL14.eglDestroySurface(eglDisplay, eglSurface)
            }
            if (eglContext != EGL14.EGL_NO_CONTEXT) {
                EGL14.eglDestroyContext(eglDisplay, eglContext)
            }
            EGL14.eglTerminate(eglDisplay)
        }
        eglDisplay = EGL14.EGL_NO_DISPLAY
        eglContext = EGL14.EGL_NO_CONTEXT
        eglSurface = EGL14.EGL_NO_SURFACE
    }

    private inner class BackgroundRenderer {
        private val quadCoords = floatArrayOf(-1.0f, -1.0f, 0.0f, -1.0f, 1.0f, 0.0f, 1.0f, -1.0f, 0.0f, 1.0f, 1.0f, 0.0f)
        private val vertexBuffer: FloatBuffer = ByteBuffer.allocateDirect(quadCoords.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(quadCoords); position(0) }
        private val standardTexCoords = floatArrayOf(0.0f, 1.0f, 0.0f, 0.0f, 1.0f, 1.0f, 1.0f, 0.0f)
        private val inputTexCoords: FloatBuffer = ByteBuffer.allocateDirect(standardTexCoords.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(standardTexCoords); position(0) }
        private val outputTexCoords: FloatBuffer = ByteBuffer.allocateDirect(standardTexCoords.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()

        private var program = -1
        private var positionHandle = -1
        private var texCoordHandle = -1
        private var textureHandle = -1

        init {
            val vertexShader = loadShader(GLES20.GL_VERTEX_SHADER, """
                attribute vec4 vPosition;
                attribute vec2 vTexCoord;
                varying vec2 fTexCoord;
                void main() { gl_Position = vPosition; fTexCoord = vTexCoord; }
            """.trimIndent())
            val fragmentShader = loadShader(GLES20.GL_FRAGMENT_SHADER, """
                #extension GL_OES_EGL_image_external : require
                precision mediump float;
                varying vec2 fTexCoord;
                uniform samplerExternalOES sTexture;
                void main() { gl_FragColor = texture2D(sTexture, fTexCoord); }
            """.trimIndent())
            program = GLES20.glCreateProgram().also {
                GLES20.glAttachShader(it, vertexShader)
                GLES20.glAttachShader(it, fragmentShader)
                GLES20.glLinkProgram(it)
            }
            positionHandle = GLES20.glGetAttribLocation(program, "vPosition")
            texCoordHandle = GLES20.glGetAttribLocation(program, "vTexCoord")
            textureHandle = GLES20.glGetUniformLocation(program, "sTexture")
            Log.d("BeardTrimNative", "BackgroundRenderer initialized: program=$program")
        }

        fun draw(frame: Frame?) {
            if (frame == null) {
                if (isSyntheticMode() && BuildConfig.DEBUG) {
                    GLES20.glClearColor(0f, 0f, 0f, 1f)
                    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
                    GLES20.glEnable(GLES20.GL_SCISSOR_TEST)
                    val cellW = viewportWidth / 4; val cellH = viewportHeight / 4
                    for (i in 0 until 4) {
                        for (j in 0 until 4) {
                            if ((i + j) % 2 == 0) {
                                GLES20.glScissor(i * cellW, j * cellH, cellW, cellH)
                                GLES20.glClearColor(0.8f, 0.2f, 0.2f, 1.0f)
                                GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
                            } else {
                                GLES20.glScissor(i * cellW, j * cellH, cellW, cellH)
                                GLES20.glClearColor(0.2f, 0.8f, 0.2f, 1.0f)
                                GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
                            }
                        }
                    }
                    GLES20.glDisable(GLES20.GL_SCISSOR_TEST)
                    if (GLES20.glGetError() == GLES20.GL_NO_ERROR && !syntheticCheckerboardReported.getAndSet(true)) {
                        Log.d("BeardTrimNative", "SYNTHETIC_CHECKERBOARD_DRAW_FIRST")
                    }
                } else {
                    GLES20.glClearColor(0f, 0f, 0f, 0f)
                    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
                }
                return
            }
            frame.transformDisplayUvCoords(inputTexCoords, outputTexCoords)
            GLES20.glUseProgram(program)
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
            GLES20.glUniform1i(textureHandle, 0)
            GLES20.glEnableVertexAttribArray(positionHandle)
            GLES20.glVertexAttribPointer(positionHandle, 3, GLES20.GL_FLOAT, false, 12, vertexBuffer)
            GLES20.glEnableVertexAttribArray(texCoordHandle)
            GLES20.glVertexAttribPointer(texCoordHandle, 2, GLES20.GL_FLOAT, false, 8, outputTexCoords.apply { position(0) })
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GLES20.glDisableVertexAttribArray(positionHandle)
            GLES20.glDisableVertexAttribArray(texCoordHandle)
        }

        private fun loadShader(type: Int, code: String): Int = GLES20.glCreateShader(type).also { GLES20.glShaderSource(it, code); GLES20.glCompileShader(it) }
    }
}
