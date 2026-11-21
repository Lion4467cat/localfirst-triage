package com.localfirst.triage.firewall

import com.localfirst.triage.model.ProtectionLevel
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtectionLevelTest {
    @Test
    fun `LOW masks only API key while MEDIUM and HIGH mask phone, name, org, and API key`() {
        val sample =
            "my phone number is 9876543210 and my name is ravi and i work in Zenith company , and my api key is 23224324234kjjjkjl"

        val (lowText, lowSpans) = LocalFirewallEngine.scrub(sample, ProtectionLevel.LOW)
        assertFalse(lowText.contains("23224324234kjjjkjl"))
        assertTrue(lowText.contains("9876543210"))
        assertTrue(lowText.contains("ravi"))
        assertTrue(lowText.contains("Zenith company"))
        assertTrue(lowSpans.size == 1)

        for (level in listOf(ProtectionLevel.MEDIUM, ProtectionLevel.HIGH)) {
            val (sanitized, spans) = LocalFirewallEngine.scrub(sample, level)
            assertTrue(spans.size == 4)
            assertFalse(sanitized.contains("9876543210"))
            assertFalse(sanitized.contains("ravi"))
            assertFalse(sanitized.contains("Zenith company"))
            assertFalse(sanitized.contains("23224324234kjjjkjl"))
        }
    }
}
