package com.localfirst.triage.ai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudErrorCopyTest {

    @Test
    fun `a network failure is described as unreachable, not as an unknown fault`() {
        val copy = humanizeCloudError("Something unexpected happened.")
        assertTrue(copy.contains("no network route"))
        assertFalse(copy.endsWith("."))
    }

    @Test
    fun `an App Check rejection points at the debug token`() {
        val copy = humanizeCloudError("403 App Check token rejected (sideload debug)")
        assertTrue(copy.contains("App Check rejected"))
        assertTrue(copy.contains("debug token"))
    }

    @Test
    fun `a missing session is named`() {
        val copy = humanizeCloudError("FirebaseNoSignedInUserException: Please sign in before trying to get a token.")
        assertTrue(copy.contains("signed-in session"))
    }

    @Test
    fun `an unconfigured build is named`() {
        val copy = humanizeCloudError("FirebaseApp not configured")
        assertTrue(copy.contains("not configured"))
    }

    @Test
    fun `an unknown message survives with its trailing punctuation trimmed`() {
        assertEquals("disk quota exceeded", humanizeCloudError("disk quota exceeded."))
    }

    @Test
    fun `a blank error still produces a sentence`() {
        assertEquals("the cloud call did not complete", humanizeCloudError(""))
        assertEquals("the cloud call did not complete", humanizeCloudError(null))
    }
}
