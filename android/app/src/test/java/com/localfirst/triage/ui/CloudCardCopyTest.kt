package com.localfirst.triage.ui

import com.localfirst.triage.ui.screens.cloudCardCopy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudCardCopyTest {

    @Test
    fun `in-cloud answer is labelled as a cloud response`() {
        val copy = cloudCardCopy("IN_CLOUD", null)
        assertEquals("Cloud AI Response · 0 raw PII left device", copy.header)
        assertEquals("IN_CLOUD", copy.badge)
        assertFalse(copy.failed)
    }

    @Test
    fun `on-device fallback keeps the cloud card but reports its real source`() {
        val copy = cloudCardCopy("ON_DEVICE", null)
        assertEquals("ON_DEVICE", copy.badge)
        assertFalse(copy.failed)
    }

    @Test
    fun `cloud error is never presented as a cloud answer`() {
        val copy = cloudCardCopy("CLOUD_ERROR", "FirebaseNoSignedInUserException: sign in first")
        assertTrue(copy.failed)
        assertEquals("LOCAL FALLBACK", copy.badge)
        assertEquals("Local Emergency RCA · cloud unreachable, nothing was sent", copy.header)
    }

    @Test
    fun `an error with no inference source still reads as a failure`() {
        val copy = cloudCardCopy(null, "Firebase not configured")
        assertTrue(copy.failed)
        assertEquals("LOCAL FALLBACK", copy.badge)
    }

    @Test
    fun `no result at all renders no badge and no failure claim`() {
        val copy = cloudCardCopy(null, null)
        assertFalse(copy.failed)
        assertEquals(null, copy.badge)
    }
}
