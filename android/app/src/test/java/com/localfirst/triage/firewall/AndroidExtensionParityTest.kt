package com.localfirst.triage.firewall

import com.localfirst.triage.model.ProtectionLevel
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Parity guard: every string the Chrome extension (extension/firewall-core.js) redacts at the
 * default MEDIUM level must also be redacted by the Android engine, otherwise the Accessibility
 * "Scrub Before Sending?" gate never arms for it.
 */
class AndroidExtensionParityTest {
    private val mustRedact = listOf(
        "AKIAIOSFODNN7EXAMPLE",
        "my key is sk-proj-abcdefghijklmnopqrstuvwx1234",
        "My API key is 6474747373773",
        "my api key is abc123",
        "password is hunter2",
        "email me at john.doe@example.com",
        "My name is John Smith",
        "call me on +91 98765 43210",
        "card 4532-0151-1283-0366",
        "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        "my address is 221B Baker Street, London",
    )

    private val mustNotRedact = listOf(
        "hello how are you",
        "what is the weather today",
    )

    @Test
    fun `android engine redacts everything the extension redacts`() {
        val misses = mustRedact.filter { text ->
            val (_, spans) = LocalFirewallEngine.scrub(text, ProtectionLevel.MEDIUM)
            spans.none { it.masked }
        }
        assertTrue("Android engine failed to redact: $misses", misses.isEmpty())
    }

    @Test
    fun `android engine leaves benign text alone`() {
        val falsePositives = mustNotRedact.filter { text ->
            val (_, spans) = LocalFirewallEngine.scrub(text, ProtectionLevel.MEDIUM)
            spans.any { it.masked }
        }
        assertTrue("Android engine over-redacted: $falsePositives", falsePositives.isEmpty())
    }
}
