package com.beardtrimmap.app

import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.util.Log
import com.google.ar.core.AugmentedFace
import com.google.ar.core.Frame
import com.google.ar.core.Session
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.atomic.AtomicBoolean
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

class ArCoreFaceRenderer(
    private val sessionProvider: () -> Session?,
    private val onFrameProduced: (Session, Frame?, Int, Int, Boolean) -> Unit,
) : GLSurfaceView.Renderer {
    private var textureId = -1
    private var viewportWidth = 1
    private var viewportHeight = 1
    private val initialized = AtomicBoolean(false)
    private val firstFrameReported = AtomicBoolean(false)
    private val firstFaceReported = AtomicBoolean(false)
    private val backgroundDrawReported = AtomicBoolean(false)
    private val syntheticCheckerboardReported = AtomicBoolean(false)
    private var lastSession: Session? = null

    private var backgroundRenderer: BackgroundRenderer? = null

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        Log.d("BeardTrimNative", "AR_SURFACE_CREATED")
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        val textures = IntArray(1)
        GLES20.glGenTextures(1, textures, 0)
        textureId = textures[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        Log.d("BeardTrimNative", "AR_CAMERA_TEXTURE_BOUND: $textureId")
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        
        backgroundRenderer = BackgroundRenderer()
        initialized.set(true)
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        Log.d("BeardTrimNative", "AR_SURFACE_CHANGED: ${width}x${height}")
        viewportWidth = width
        viewportHeight = height
        GLES20.glViewport(0, 0, width, height)
        sessionProvider()?.setDisplayGeometry(0, width, height)
    }

    override fun onDrawFrame(gl: GL10?) {
        val session = sessionProvider()
        if (!initialized.get()) return

        if (!firstFrameReported.get()) {
            Log.d("BeardTrimNative", "AR_DRAW_FRAME_FIRST")
        }

        if (session != null && session != lastSession) {
            Log.d("BeardTrimNative", "ARCore session update: setting camera texture $textureId")
            session.setCameraTextureName(textureId)
            lastSession = session
        }

        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)

        var backgroundDrawn = false
        try {
            val frame = session?.update()
            
            // Draw camera background (production path)
            if (frame != null && !backgroundDrawReported.get()) {
                Log.d("BeardTrimNative", "AR_CAMERA_BACKGROUND_DRAW_FIRST")
            }
            
            backgroundRenderer?.draw(frame)
            
            if (frame != null) {
                backgroundDrawn = true
                if (!backgroundDrawReported.getAndSet(true)) {
                    Log.d("BeardTrimNative", "AR_CAMERA_BACKGROUND_DRAW_OK")
                }
            } else {
                backgroundDrawn = session == null // Synthetic mode (session is null)
            }

            if (frame != null && !firstFrameReported.getAndSet(true)) {
                Log.d("BeardTrimNative", "AR_SESSION_UPDATE_FIRST")
                Log.d("BeardTrimNative", "AR_CAMERA_FRAME_AVAILABLE")
            }

            val faces = session?.getAllTrackables(AugmentedFace::class.java)
            if (faces != null && faces.isNotEmpty() && !firstFaceReported.getAndSet(true)) {
                Log.d("BeardTrimNative", "AR_FACE_TRACKING_FIRST")
            }

            if (session != null || lastSession != null) {
                onFrameProduced(session ?: lastSession!!, frame, viewportWidth, viewportHeight, backgroundDrawn)
            }
        } catch (e: Exception) {
            Log.e("BeardTrimNative", "ARCORE_DRAW_ERROR type=${e.javaClass.simpleName} msg=${e.message}")
        }
    }

    private inner class BackgroundRenderer {
        private val quadCoords = floatArrayOf(
            -1.0f, -1.0f, 0.0f,
            -1.0f,  1.0f, 0.0f,
             1.0f, -1.0f, 0.0f,
             1.0f,  1.0f, 0.0f
        )
        private val vertexBuffer: FloatBuffer = ByteBuffer.allocateDirect(quadCoords.size * 4)
            .order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(quadCoords); position(0) }
        
        private val standardTexCoords = floatArrayOf(
            0.0f, 1.0f,
            0.0f, 0.0f,
            1.0f, 1.0f,
            1.0f, 0.0f
        )
        private val inputTexCoords: FloatBuffer = ByteBuffer.allocateDirect(standardTexCoords.size * 4)
            .order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(standardTexCoords); position(0) }
        
        private val outputTexCoords: FloatBuffer = ByteBuffer.allocateDirect(standardTexCoords.size * 4)
            .order(ByteOrder.nativeOrder()).asFloatBuffer()

        private var program = -1
        private var positionHandle = -1
        private var texCoordHandle = -1
        private var textureHandle = -1

        private val vertexShaderCode = """
            attribute vec4 vPosition;
            attribute vec2 vTexCoord;
            varying vec2 fTexCoord;
            void main() {
                gl_Position = vPosition;
                fTexCoord = vTexCoord;
            }
        """.trimIndent()

        private val fragmentShaderCode = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            varying vec2 fTexCoord;
            uniform samplerExternalOES sTexture;
            void main() {
                gl_FragColor = texture2D(sTexture, fTexCoord);
            }
        """.trimIndent()

        init {
            val vertexShader = loadShader(GLES20.GL_VERTEX_SHADER, vertexShaderCode)
            val fragmentShader = loadShader(GLES20.GL_FRAGMENT_SHADER, fragmentShaderCode)
            program = GLES20.glCreateProgram().also {
                GLES20.glAttachShader(it, vertexShader)
                GLES20.glAttachShader(it, fragmentShader)
                GLES20.glLinkProgram(it)
                
                val linkStatus = IntArray(1)
                GLES20.glGetProgramiv(it, GLES20.GL_LINK_STATUS, linkStatus, 0)
                if (linkStatus[0] == 0) {
                    Log.e("BeardTrimNative", "Error linking program: " + GLES20.glGetProgramInfoLog(it))
                }
            }
            positionHandle = GLES20.glGetAttribLocation(program, "vPosition")
            texCoordHandle = GLES20.glGetAttribLocation(program, "vTexCoord")
            textureHandle = GLES20.glGetUniformLocation(program, "sTexture")
            Log.d("BeardTrimNative", "BackgroundRenderer initialized: program=$program pos=$positionHandle tex=$texCoordHandle uniform=$textureHandle")
        }

        fun draw(frame: Frame?) {
            if (frame == null) {
                // Synthetic mode: Draw a distinctive grid/test pattern
                GLES20.glClearColor(0f, 0f, 0f, 1f)
                GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
                
                GLES20.glEnable(GLES20.GL_SCISSOR_TEST)
                val cellW = viewportWidth / 4
                val cellH = viewportHeight / 4
                for (i in 0 until 4) {
                    for (j in 0 until 4) {
                        if ((i + j) % 2 == 0) {
                            GLES20.glScissor(i * cellW, j * cellH, cellW, cellH)
                            GLES20.glClearColor(0.8f, 0.2f, 0.2f, 1.0f) // Reddish
                            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
                        } else {
                            GLES20.glScissor(i * cellW, j * cellH, cellW, cellH)
                            GLES20.glClearColor(0.2f, 0.8f, 0.2f, 1.0f) // Greenish
                            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
                        }
                    }
                }
                GLES20.glDisable(GLES20.GL_SCISSOR_TEST)
                
                if (GLES20.glGetError() == GLES20.GL_NO_ERROR) {
                    if (!syntheticCheckerboardReported.getAndSet(true)) {
                        Log.d("BeardTrimNative", "SYNTHETIC_CHECKERBOARD_DRAW_FIRST")
                    }
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

        private fun loadShader(type: Int, shaderCode: String): Int {
            return GLES20.glCreateShader(type).also { shader ->
                GLES20.glShaderSource(shader, shaderCode)
                GLES20.glCompileShader(shader)
                
                val compiled = IntArray(1)
                GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, compiled, 0)
                if (compiled[0] == 0) {
                    Log.e("BeardTrimNative", "Error compiling shader: " + GLES20.glGetShaderInfoLog(shader))
                }
            }
        }
    }
}
