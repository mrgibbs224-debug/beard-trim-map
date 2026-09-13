package com.beardtrimmap.app

import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.Image
import java.io.ByteArrayOutputStream

// Stage A6.0A: minimal YUV_420_888 (the format ARCore's Frame.acquireCameraImage() returns) ->
// JPEG path. Only invoked for explicitly-requested developer keyframes, never per production
// frame -- production camera rendering/tracking is entirely untouched by this file.
object YuvJpegConverter {
    // Copies the Image's three planes into a standalone NV21 byte array using absolute
    // ByteBuffer.get(index) reads (no position/remaining state, safe regardless of prior buffer
    // state). Must be called BEFORE the Image is closed; the returned array has no further
    // dependency on the native Image afterward, so the caller can close it immediately.
    fun toNv21(image: Image): ByteArray {
        val width = image.width
        val height = image.height
        val yPlane = image.planes[0]
        val uPlane = image.planes[1]
        val vPlane = image.planes[2]
        val yBuffer = yPlane.buffer
        val uBuffer = uPlane.buffer
        val vBuffer = vPlane.buffer
        val yRowStride = yPlane.rowStride
        // U and V planes share the same row/pixel stride by the YUV_420_888 contract.
        val uvRowStride = vPlane.rowStride
        val uvPixelStride = vPlane.pixelStride

        val nv21 = ByteArray(width * height * 3 / 2)
        var pos = 0
        for (row in 0 until height) {
            val rowStart = row * yRowStride
            for (col in 0 until width) {
                nv21[pos++] = yBuffer.get(rowStart + col)
            }
        }
        val chromaHeight = height / 2
        val chromaWidth = width / 2
        for (row in 0 until chromaHeight) {
            for (col in 0 until chromaWidth) {
                val idx = row * uvRowStride + col * uvPixelStride
                nv21[pos++] = vBuffer.get(idx)
                nv21[pos++] = uBuffer.get(idx)
            }
        }
        return nv21
    }

    fun nv21ToJpeg(nv21: ByteArray, width: Int, height: Int, quality: Int): ByteArray {
        val out = ByteArrayOutputStream()
        YuvImage(nv21, ImageFormat.NV21, width, height, null)
            .compressToJpeg(Rect(0, 0, width, height), quality, out)
        return out.toByteArray()
    }
}
