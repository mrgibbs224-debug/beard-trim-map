package com.beardtrimmap.app

import android.util.Log
import org.opencv.android.OpenCVLoader
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat

class OpenCvLandmarkStabilizer {
    private var previous: Mat? = null
    private val available: Boolean by lazy {
        try {
            val ok = OpenCVLoader.initLocal()
            Log.d("BeardTrimNative", "OpenCV initLocal: $ok")
            ok
        } catch (e: Throwable) {
            Log.e("BeardTrimNative", "OpenCV init failed: ${e.message}")
            false
        }
    }

    fun stabilize(points: List<TrackingPoint>): List<TrackingPoint> {
        if (!available) return points
        if (points.isEmpty()) return points

        Log.d("BeardTrimNative", "STABILIZER_INPUT count=${points.size}")

        try {
            // Use Nx1 3-channel matrix (CV_32FC3)
            // Batch operations with FloatArray are safer and faster than per-point put/get
            val current = Mat(points.size, 1, CvType.CV_32FC3)
            val pointData = FloatArray(points.size * 3)
            points.forEachIndexed { i, p ->
                pointData[i * 3] = p.x
                pointData[i * 3 + 1] = p.y
                pointData[i * 3 + 2] = p.z
            }
            current.put(0, 0, pointData)

            val old = previous
            val output = if (old == null || old.rows() != current.rows() || old.type() != current.type()) {
                current.clone()
            } else {
                val weighted = Mat()
                Core.addWeighted(current, CURRENT_WEIGHT, old, HISTORY_WEIGHT, 0.0, weighted)
                weighted
            }

            previous?.release()
            previous = output.clone()
            current.release()

            val resultData = FloatArray(points.size * 3)
            output.get(0, 0, resultData)
            output.release()

            val result = List(points.size) { i ->
                TrackingPoint(resultData[i * 3], resultData[i * 3 + 1], resultData[i * 3 + 2])
            }
            
            Log.d("BeardTrimNative", "STABILIZER_OUTPUT count=${result.size}")
            return result
        } catch (e: Exception) {
            Log.e("BeardTrimNative", "STABILIZER_FRAME_REJECTED: ${e.message}")
            return points
        }
    }

    fun clear() {
        previous?.release()
        previous = null
    }

    companion object {
        private const val CURRENT_WEIGHT = 0.72
        private const val HISTORY_WEIGHT = 0.28
    }
}
