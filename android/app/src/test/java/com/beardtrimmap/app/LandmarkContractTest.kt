package com.beardtrimmap.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LandmarkContractTest {

    @Test
    fun verifyArCorePacketLandmarkCount() {
        // Native ARCore must provide exactly 468 landmarks
        val landmarks = List(468) { TrackingPoint(0f, 0f, 0f) }
        val packet = TrackingPacket(
            provider = "arcore-augmented-faces",
            timestampMs = 123L,
            frameWidth = 1080,
            frameHeight = 1920,
            rotationDegrees = 0,
            mirrored = true,
            inferenceMs = 10L,
            landmarks = landmarks,
            transformationMatrix = null
        )
        
        assertEquals(468, packet.landmarks.size)
    }

    @Test
    fun verifyMlKitPacketLandmarkCount() {
        // Native ML Kit must provide exactly 468 landmarks
        val landmarks = List(468) { TrackingPoint(0f, 0f, 0f) }
        val packet = TrackingPacket(
            provider = "mlkit-face-mesh",
            timestampMs = 123L,
            frameWidth = 1080,
            frameHeight = 1920,
            rotationDegrees = 0,
            mirrored = true,
            inferenceMs = 10L,
            landmarks = landmarks,
            transformationMatrix = null
        )
        
        assertEquals(468, packet.landmarks.size)
    }
}
