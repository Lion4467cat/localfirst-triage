package com.localfirst.triage.data

import com.localfirst.triage.accessibility.AccessibilityBurstDetector
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShieldStoreAndBurstTest {
    @Test
    fun `zero-pii history serialization preserves only metadata and never raw text`() {
        val entry = BlockHistoryEntry(
            id = "evt-1",
            timestampMs = 1_763_820_000_000L,
            appName = "ChatGPT",
            categoryCounts = mapOf("API_KEY" to 1, "PHONE" to 1),
            totalBlocked = 2,
            engineUsed = "Deterministic Rules",
        )

        val encoded = ShieldStore.serializeHistory(listOf(entry))
        val decoded = ShieldStore.deserializeHistory(encoded)

        assertEquals(1, decoded.size)
        assertEquals("ChatGPT", decoded[0].appName)
        assertEquals(2, decoded[0].totalBlocked)
        assertEquals("1 API Key · 1 Phone · 0 Leaked", decoded[0].formatSummary())
    }

    @Test
    fun `burst detector suppresses popups during normal incremental typing`() {
        assertFalse(AccessibilityBurstDetector.shouldScanImmediately(previousLength = 0, currentText = "h"))
        assertFalse(AccessibilityBurstDetector.shouldScanImmediately(previousLength = 5, currentText = "hello "))
        assertFalse(AccessibilityBurstDetector.shouldScanImmediately(previousLength = 10, currentText = "hello world"))
    }

    @Test
    fun `burst detector triggers immediately on paste burst or high-confidence credential`() {
        assertTrue(
            AccessibilityBurstDetector.shouldScanImmediately(
                previousLength = 0,
                currentText = "Here is my pasted paragraph with sensitive info",
            ),
        )
        assertTrue(
            AccessibilityBurstDetector.shouldScanImmediately(
                previousLength = 19,
                currentText = "AKIAIOSFODNN7EXAMPLE",
            ),
        )
    }
}
