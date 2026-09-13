package com.beardtrimmap.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.opencv.android.OpenCVLoader

class OpenCvLandmarkStabilizerTest {
    private lateinit var stabilizer: OpenCvLandmarkStabilizer

    @Before
    fun setUp() {
        stabilizer = OpenCvLandmarkStabilizer()
    }

    private fun isOpencvAvailable(): Boolean {
        return try {
            OpenCVLoader.initLocal()
        } catch (e: Throwable) {
            false
        }
    }

    @Test
    fun handleEmptyInput() {
        val input = emptyList<TrackingPoint>()
        val output = stabilizer.stabilize(input)
        assertEquals(input, output)
    }

    @Test
    fun handleOneLandmark() {
        assumeTrue("OpenCV not available in test environment", isOpencvAvailable())
        
        val input = listOf(TrackingPoint(0.5f, 0.5f, 0.1f))
        val output = stabilizer.stabilize(input)
        
        assertEquals(1, output.size)
        assertEquals(0.5f, output[0].x, 0.001f)
        assertEquals(0.5f, output[0].y, 0.001f)
    }

    @Test
    fun regressionArrayIndexOutOfBounds() {
        assumeTrue("OpenCV not available in test environment", isOpencvAvailable())
        
        // This test ensures that we correctly read all channels from the matrix
        // The previous crash was: java.lang.ArrayIndexOutOfBoundsException: length=1; index=1
        // which meant we were reading from a single-channel matrix but expecting multi-channel data.
        
        val input = listOf(
            TrackingPoint(0.1f, 0.2f, 0.3f),
            TrackingPoint(0.4f, 0.5f, 0.6f)
        )
        
        // First frame (initializes previous)
        val firstOutput = stabilizer.stabilize(input)
        assertEquals(2, firstOutput.size)
        assertEquals(0.1f, firstOutput[0].x, 0.001f)
        assertEquals(0.2f, firstOutput[0].y, 0.001f)
        assertEquals(0.3f, firstOutput[0].z, 0.001f)

        // Second frame (should trigger weighted averaging)
        val nextInput = listOf(
            TrackingPoint(0.2f, 0.3f, 0.4f),
            TrackingPoint(0.5f, 0.6f, 0.7f)
        )
        val secondOutput = stabilizer.stabilize(nextInput)
        
        assertEquals(2, secondOutput.size)
        // Values should be between previous and current
        assertNotSame(nextInput[0].x, secondOutput[0].x)
        assert(secondOutput[0].x > 0.1f && secondOutput[0].x < 0.2f)
    }
    
    @Test
    fun resetBetweenSessions() {
        assumeTrue("OpenCV not available in test environment", isOpencvAvailable())
        
        val input = listOf(TrackingPoint(0.1f, 0.1f, 0.1f))
        stabilizer.stabilize(input)
        
        stabilizer.clear()
        
        // After clear, the next stabilize call should treat input as fresh (no averaging)
        val newInput = listOf(TrackingPoint(0.9f, 0.9f, 0.9f))
        val output = stabilizer.stabilize(newInput)
        
        assertEquals(0.9f, output[0].x, 0.001f)
    }

    @Test
    fun handleMlKitLandmarkCount() {
        assumeTrue("OpenCV not available in test environment", isOpencvAvailable())
        
        val count = 468 // Standard ML Kit / ARCore face mesh count
        val input = List(count) { i ->
            TrackingPoint(i.toFloat() / count, 0.5f, 0.0f)
        }
        
        val output = stabilizer.stabilize(input)
        assertEquals(count, output.size)
    }
}
