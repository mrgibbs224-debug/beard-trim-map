package com.beardtrimmap.app

import android.content.Context
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Session

/** Owns the ARCore Augmented Faces primary session without persisting camera or mesh data. */
class ArCoreFaceSession(private val context: Context) : AutoCloseable {
    private var session: Session? = null

    fun isSupported(): Boolean = when (ArCoreApk.getInstance().checkAvailability(context)) {
        ArCoreApk.Availability.SUPPORTED_INSTALLED,
        ArCoreApk.Availability.SUPPORTED_APK_TOO_OLD,
        ArCoreApk.Availability.SUPPORTED_NOT_INSTALLED -> true
        else -> false
    }

    fun create(): Session {
        session?.let { return it }
        return Session(context, setOf(Session.Feature.FRONT_CAMERA)).also { created ->
            created.configure(
                created.config.apply {
                    augmentedFaceMode = Config.AugmentedFaceMode.MESH3D
                    updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
                },
            )
            session = created
        }
    }

    fun getSession(): Session? = session

    fun resume() {
        session?.resume()
    }

    fun pause() {
        session?.pause()
    }

    override fun close() {
        session?.close()
        session = null
    }
}
