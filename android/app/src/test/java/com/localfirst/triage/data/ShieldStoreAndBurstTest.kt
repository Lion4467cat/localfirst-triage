package com.localfirst.triage.data

import com.localfirst.triage.accessibility.AccessibilityBurstDetector
import com.localfirst.triage.accessibility.ActiveTextExtractor
import com.localfirst.triage.accessibility.SendButtonMatcher
import com.localfirst.triage.accessibility.SendPromptStateMachine
import com.localfirst.triage.model.ProtectionLevel
import com.localfirst.triage.ui.screens.CloudMarkdownFormatter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
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

    @Test
    fun `send button matcher detects send submit post controls and ignores editable inputs`() {
        assertTrue(
            SendButtonMatcher.isLikelySendControl(
                text = "Send",
                contentDescription = null,
                viewIdResourceName = null,
                isClickable = true,
                isEditable = false,
            ),
        )
        assertTrue(
            SendButtonMatcher.isLikelySendControl(
                text = null,
                contentDescription = "Submit prompt",
                viewIdResourceName = "com.openai.chatgpt:id/composer_send",
                isClickable = true,
                isEditable = false,
            ),
        )
        assertFalse(
            SendButtonMatcher.isLikelySendControl(
                text = "Please send this API key",
                contentDescription = null,
                viewIdResourceName = null,
                isClickable = true,
                isEditable = true,
            ),
        )
        assertFalse(
            SendButtonMatcher.isLikelySendControl(
                text = "Settings",
                contentDescription = "Open menu",
                viewIdResourceName = "com.openai.chatgpt:id/menu_btn",
                isClickable = true,
                isEditable = false,
            ),
        )
    }

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

    @Test
    fun `send prompt state machine holds silently while typing and prompts once on send`() {
        val sm = SendPromptStateMachine()
        val rawSecretText = "Use key AKIAIOSFODNN7EXAMPLE and call +1-415-555-0199"

        // Typing/pasting tracks state silently without arming visible prompt
        sm.onFieldTextObserved("com.openai.chatgpt", "ChatGPT", rawSecretText, ProtectionLevel.MEDIUM)
        assertFalse(sm.isPromptVisible)
        assertNotNull(sm.trackedState)

        // Clicking Send opens the prompt
        val prompt = sm.onSendClicked("com.openai.chatgpt")
        assertNotNull(prompt)
        assertTrue(sm.isPromptVisible)
        assertTrue(prompt!!.sanitizedText.contains("[REDACTED:"))

        // Self-triggered empty text event while holding prompt must NOT wipe tracked state
        sm.onFieldTextObserved("com.openai.chatgpt", "ChatGPT", "", ProtectionLevel.MEDIUM)
        assertNotNull(sm.trackedState)

        // Reject & Send Anyway restores raw text and suppresses re-prompting for the exact same text
        val rejected = sm.rejectAndSendAnyway()
        assertEquals(rawSecretText, rejected?.rawText)
        assertFalse(sm.isPromptVisible)
        sm.onFieldTextObserved("com.openai.chatgpt", "ChatGPT", rawSecretText, ProtectionLevel.MEDIUM)
        assertNull(sm.onSendClicked("com.openai.chatgpt"))

        // Editing to a new secret arms the prompt again, and Accept Scrub clears state
        val newSecretText = "New key AKIAIOSFODNN7EXAMPLE"
        sm.onFieldTextObserved("com.openai.chatgpt", "ChatGPT", newSecretText, ProtectionLevel.MEDIUM)
        assertNotNull(sm.onSendClicked("com.openai.chatgpt"))
        val accepted = sm.acceptScrub()
        assertNotNull(accepted)
        assertFalse(sm.isPromptVisible)
        assertNull(sm.trackedState)
    }

    @Test
    fun `broader send button matcher and active text extractor handle real app controls`() {
        assertTrue(
            SendButtonMatcher.isLikelySendControl(
                text = null,
                contentDescription = "Ask Gemini",
                viewIdResourceName = null,
                isClickable = true,
                isEditable = false,
            ),
        )
        assertTrue(
            SendButtonMatcher.isLikelySendControl(
                text = "Reply",
                contentDescription = null,
                viewIdResourceName = "com.Slack:id/send_btn",
                isClickable = true,
                isEditable = false,
            ),
        )
        assertTrue(
            SendButtonMatcher.isLikelyNearEditableSendClick(
                isClickable = true,
                isEditable = false,
                hasTrackedSecret = true,
                text = null,
                contentDescription = null,
                viewIdResourceName = null,
                sharesContainerWithEditable = true,
            ),
        )
        assertFalse(
            SendButtonMatcher.isLikelyNearEditableSendClick(
                isClickable = true,
                isEditable = false,
                hasTrackedSecret = true,
                text = null,
                contentDescription = "Attach file",
                viewIdResourceName = "btn_attach",
                sharesContainerWithEditable = true,
            ),
        )

        assertEquals(
            "pasted AKIAIOSFODNN7EXAMPLE",
            ActiveTextExtractor.pickBestText(
                nodeText = "",
                eventText = null,
                treeFallbackText = "pasted AKIAIOSFODNN7EXAMPLE",
            ),
        )
    }
}
