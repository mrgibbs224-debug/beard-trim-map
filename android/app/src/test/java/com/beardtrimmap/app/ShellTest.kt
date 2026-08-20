package com.beardtrimmap.app

import org.junit.Assert.assertEquals
import org.junit.Test

class ShellTest {
    @Test
    fun packageNameRemainsStable() {
        assertEquals("com.beardtrimmap.app", MainActivity::class.java.packageName)
    }
}
