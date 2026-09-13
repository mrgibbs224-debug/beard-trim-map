package com.beardtrimmap.app

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.TextureView
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.google.ar.core.AugmentedFace
import com.google.ar.core.Config
import com.google.ar.core.Session
import java.util.*

class NativeCameraTestActivity : ComponentActivity() {
    private var container: FrameLayout? = null
    private var arCoreTextureView: TextureView? = null
    private var textureRenderer: ArCoreTextureRenderer? = null
    private var arSession: Session? = null
    
    private val closeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == "com.beardtrimmap.app.CLOSE_NATIVE_PROOF") {
                Log.d("BeardTrimNative", "NATIVE_PROOF_CLOSE_BROADCAST_RECEIVED")
                closeNativeProof()
            }
        }
    }

    private val cameraPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startArCore()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d("BeardTrimNative", "NATIVE_PROOF_OPEN")
        
        window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        window.decorView.setBackgroundColor(Color.TRANSPARENT)

        container = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }
        setContentView(container)

        arCoreTextureView = TextureView(this).apply {
            textureRenderer = ArCoreTextureRenderer(
                activity = this@NativeCameraTestActivity,
                isSyntheticMode = { false },
                sessionProvider = { arSession }
            ) { session, frame, _, _, _ ->
                if (frame != null) {
                    val faces = session?.getAllTrackables(AugmentedFace::class.java)
                    if (faces != null && faces.isNotEmpty()) {
                        Log.d("BeardTrimNative", "NATIVE_PROOF_OVERLAY_FIRST")
                    }
                }
            }
            surfaceTextureListener = textureRenderer
        }
        container?.addView(arCoreTextureView)

        val closeButton = Button(this).apply {
            text = "CLOSE TEST" // Resource-id logic ignored for isolated debug tool
            setOnClickListener { 
                closeNativeProof() 
            }
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = android.view.Gravity.BOTTOM or android.view.Gravity.CENTER_HORIZONTAL
                setMargins(0, 0, 0, 100)
            }
        }
        container?.addView(closeButton)

        val filter = IntentFilter("com.beardtrimmap.app.CLOSE_NATIVE_PROOF")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(closeReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(closeReceiver, filter)
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startArCore()
        } else {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    private fun startArCore() {
        try {
            arSession = Session(this, EnumSet.of(Session.Feature.FRONT_CAMERA))
            val config = Config(arSession)
            config.augmentedFaceMode = Config.AugmentedFaceMode.MESH3D
            arSession?.configure(config)
            arSession?.resume()
            textureRenderer?.setRenderingEnabled(true)
        } catch (e: Exception) {
            Log.e("BeardTrimNative", "NATIVE_PROOF_AR_START_ERROR: ${e.message}")
        }
    }

    private fun closeNativeProof() {
        Log.d("BeardTrimNative", "NATIVE_PROOF_CLOSED")
        textureRenderer?.setRenderingEnabled(false)
        arSession?.pause()
        arSession?.close()
        arSession = null
        finish()
    }

    override fun onPause() {
        super.onPause()
        textureRenderer?.setRenderingEnabled(false)
        arSession?.pause()
    }

    override fun onResume() {
        super.onResume()
        arSession?.resume()
        textureRenderer?.setRenderingEnabled(true)
    }

    override fun onDestroy() {
        super.onDestroy()
        try {
            unregisterReceiver(closeReceiver)
        } catch (e: Exception) {
            // Ignore if already unregistered
        }
        textureRenderer?.setRenderingEnabled(false)
        arSession?.close()
        arSession = null
    }
}
