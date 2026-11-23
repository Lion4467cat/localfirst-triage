package com.localfirst.triage.data

import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.ProtectionLevel
import com.localfirst.triage.ui.screens.CloudMarkdownFormatter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShieldStoreAndBurstTest {

    // =====================================================================
    // Zero-PII history: metadata only, never raw text
    // =====================================================================

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
        assertEquals(BlockHistoryEntry.ACTION_SCRUBBED, decoded[0].actionType)
        assertEquals("1 API Key · 1 Phone · 0 Leaked", decoded[0].formatSummary())
    }

    @Test
    fun `zero-pii history preserves override action type without raw secrets`() {
        val overrideEntry = BlockHistoryEntry(
            id = "evt-2",
            timestampMs = 1_763_820_005_000L,
            appName = "Claude",
            categoryCounts = mapOf("API_KEY" to 1),
            totalBlocked = 1,
            engineUsed = "Deterministic Rules",
            actionType = BlockHistoryEntry.ACTION_OVERRIDE,
        )

        val decoded = ShieldStore.deserializeHistory(ShieldStore.serializeHistory(listOf(overrideEntry)))

        assertEquals(1, decoded.size)
        assertEquals(BlockHistoryEntry.ACTION_OVERRIDE, decoded[0].actionType)
        assertEquals("1 API Key · Unsafe Override", decoded[0].formatSummary())
    }

    @Test
    fun `serialized history never contains a scrubbed secret`() {
        val key = "AKIA" + "IOSFODNN7EXAMPLE"
        val card = "4532" + "015112830366"
        val raw = "key $key card $card"
        val (sanitized, spans) = LocalFirewallEngine.scrub(raw, ProtectionLevel.MEDIUM)
        assertTrue("fixture must be detected", spans.isNotEmpty())
        assertFalse("fixture must be scrubbed", sanitized.contains(key))

        val counts = LinkedHashMap<String, Int>()
        for (span in spans.filter { it.masked }) {
            counts[span.category] = (counts[span.category] ?: 0) + 1
        }
        val entry = BlockHistoryEntry(
            id = "evt-3",
            timestampMs = 1L,
            appName = "Chrome",
            categoryCounts = counts,
            totalBlocked = spans.count { it.masked },
            engineUsed = "Deterministic Rules",
        )
        val encoded = ShieldStore.serializeHistory(listOf(entry))

        for (span in spans) {
            assertFalse("raw match leaked into history", encoded.contains(span.matchedText))
        }
        assertFalse(encoded.contains(key))
        assertFalse(encoded.contains(card))
        assertFalse(encoded.contains(raw))
    }

    @Test
    fun `history summary pluralises multi-count categories`() {
        val entry = BlockHistoryEntry(
            id = "evt-4",
            timestampMs = 2L,
            appName = "Telegram",
            categoryCounts = mapOf("AWS_ACCESS_KEY" to 2, "EMAIL" to 1),
            totalBlocked = 3,
            engineUsed = "Deterministic Rules",
        )
        assertEquals("2 AWS Keys · 1 Email · 0 Leaked", entry.formatSummary())
    }

    @Test
    fun `history summary falls back to a pluralised secret count`() {
        val entry = BlockHistoryEntry(
            id = "evt-5",
            timestampMs = 3L,
            appName = "Slack",
            categoryCounts = emptyMap(),
            totalBlocked = 3,
            engineUsed = "Deterministic Rules",
        )
        assertEquals("3 Secrets · 0 Leaked", entry.formatSummary())
    }

    // =====================================================================
    // Cloud markdown: no raw markdown characters reach the UI
    // =====================================================================

    @Test
    fun `cloud markdown formatter strips headings bold markers and stray backticks`() {
        val raw = """
            ### Root Cause
            - **Token Leak** in `env`
            ```
            Rotate `[REDACTED:API_KEY_1]` immediately.
            ```
        """.trimIndent()

        val blocks = CloudMarkdownFormatter.parse(raw)
        assertEquals(3, blocks.size)
        assertTrue(blocks[0].isHeading)
        assertEquals("Root Cause", blocks[0].text)
        assertTrue(blocks[1].isBullet)
        assertEquals("Token Leak in env", blocks[1].text)
        assertFalse(blocks[2].isHeading)
        assertFalse(blocks[2].isBullet)
        assertEquals("Rotate [REDACTED:API_KEY_1] immediately.", blocks[2].text)
    }

    // =====================================================================
    // Guarded-app coverage: every major browser must be shielded
    // =====================================================================

    @Test
    fun `guarded apps cover all major mobile browsers and chat surfaces`() {
        val packages = ShieldStore.DEFAULT_GUARDED_APPS.map { it.packageName }.toSet()
        val requiredBrowsers = setOf(
            "com.android.chrome",
            "org.mozilla.firefox",
            "com.brave.browser",
            "com.microsoft.emmx",
            "com.sec.android.app.sbrowser",
            "com.opera.browser",
        )
        val requiredChat = setOf(
            "com.openai.chatgpt",
            "com.anthropic.claude",
            "com.google.android.apps.bard",
            "com.whatsapp",
            "com.Slack",
            "com.discord",
        )
        for (pkg in requiredBrowsers + requiredChat) {
            assertTrue("missing guarded package: $pkg", packages.contains(pkg))
        }
        assertTrue(
            "every guarded app must be enabled by default",
            ShieldStore.DEFAULT_GUARDED_APPS.all { it.defaultEnabled },
        )
    }

    @Test
    fun `display names hide raw package ids for known apps`() {
        assertEquals("ChatGPT", ShieldStore.appDisplayNameForPackage(null, "com.openai.chatgpt"))
        assertEquals("Gemini", ShieldStore.appDisplayNameForPackage(null, "com.google.android.apps.bard"))
        // Without a Context there is no PackageManager label, so the fallback is the last segment.
        assertEquals("Messenger", ShieldStore.appDisplayNameForPackage(null, "org.telegram.messenger"))
    }
}
