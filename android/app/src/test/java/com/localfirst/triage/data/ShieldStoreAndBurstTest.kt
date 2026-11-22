package com.localfirst.triage.data

import com.localfirst.triage.accessibility.AccessibilityBurstDetector
import com.localfirst.triage.accessibility.ActiveTextExtractor
import com.localfirst.triage.accessibility.ClickableBoundsCandidate
import com.localfirst.triage.accessibility.SendBoundsSelector
import com.localfirst.triage.accessibility.SendButtonMatcher
import com.localfirst.triage.accessibility.SendPromptStateMachine
import com.localfirst.triage.accessibility.ShieldGeometry
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

        // Typing/pasting tracks state silently and arms touch shield without visible prompt
        sm.onFieldTextObserved("com.openai.chatgpt", "ChatGPT", rawSecretText, ProtectionLevel.MEDIUM)
        assertFalse(sm.isPromptVisible)
        assertNotNull(sm.trackedState)
        assertTrue(sm.shouldArmTouchShield("com.openai.chatgpt"))

        // Tapping the touch shield opens the prompt
        val prompt = sm.onSendClicked("com.openai.chatgpt")
        assertNotNull(prompt)
        assertTrue(sm.isPromptVisible)
        assertFalse(sm.shouldArmTouchShield("com.openai.chatgpt"))
        assertTrue(prompt!!.sanitizedText.contains("[REDACTED:"))

        // Reject & Send Anyway restores/keeps raw text and suppresses re-prompting for the exact same text
        val rejected = sm.rejectAndSendAnyway()
        assertEquals(rawSecretText, rejected?.rawText)
        assertFalse(sm.isPromptVisible)
        sm.onFieldTextObserved("com.openai.chatgpt", "ChatGPT", rawSecretText, ProtectionLevel.MEDIUM)
        assertFalse(sm.shouldArmTouchShield("com.openai.chatgpt"))
        assertNull(sm.onSendClicked("com.openai.chatgpt"))

        // Clearing the field disarms the touch shield
        sm.onFieldTextObserved("com.openai.chatgpt", "ChatGPT", "", ProtectionLevel.MEDIUM)
        assertNull(sm.trackedState)
        assertFalse(sm.shouldArmTouchShield("com.openai.chatgpt"))

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
        assertEquals(
            "event AKIAIOSFODNN7EXAMPLE",
            ActiveTextExtractor.pickBestText(
                nodeText = "old",
                eventText = "event AKIAIOSFODNN7EXAMPLE",
                treeFallbackText = null,
                preferEventText = true,
            ),
        )
    }

    @Test
    fun `send bounds selector prefers regex match and falls back to clickable nearest right of editable`() {
        val attachLeft = ClickableBoundsCandidate(
            index = 0,
            left = 20,
            top = 1800,
            right = 120,
            bottom = 1900,
            isRegexMatch = false,
            isNonSend = true,
        )
        val sendRight = ClickableBoundsCandidate(
            index = 1,
            left = 920,
            top = 1800,
            right = 1040,
            bottom = 1900,
            isRegexMatch = false,
            isNonSend = false,
        )
        val chosenFallback = SendBoundsSelector.pickBestCandidate(
            candidates = listOf(attachLeft, sendRight),
            editableLeft = 140,
            editableTop = 1790,
            editableRight = 900,
            editableBottom = 1910,
        )
        assertEquals(1, chosenFallback?.index)

        val explicitMatch = sendRight.copy(index = 2, isRegexMatch = true)
        val chosenRegex = SendBoundsSelector.pickBestCandidate(
            candidates = listOf(attachLeft, sendRight, explicitMatch),
            editableLeft = 140,
            editableTop = 1790,
            editableRight = 900,
            editableBottom = 1910,
        )
        assertEquals(2, chosenRegex?.index)

        // Real-world Gemini / ChatGPT layout: ignore enclosing container and left '+' button, pick bottom-right send
        val enclosingContainer = ClickableBoundsCandidate(0, 0, 814, 1080, 2400, isRegexMatch = false, isNonSend = false)
        val leftPlus = ClickableBoundsCandidate(1, 30, 1245, 150, 1365, isRegexMatch = false, isNonSend = false)
        val rightSend = ClickableBoundsCandidate(2, 925, 1245, 1045, 1365, isRegexMatch = false, isNonSend = false)
        val chosenReal = SendBoundsSelector.pickBestCandidate(
            candidates = listOf(enclosingContainer, leftPlus, rightSend),
            editableLeft = 150,
            editableTop = 1245,
            editableRight = 1050,
            editableBottom = 1365,
        )
        assertEquals(2, chosenReal?.index)
    }

    // =====================================================================
    // New tests for flakiness fixes (debounced teardown, bounds filtering,
    // send-intercept state machine)
    // =====================================================================

    @Test
    fun `send bounds selector rejects oversized containers using screen dimensions`() {
        val screenWidth = 1080
        val screenHeight = 2400
        val maxContainerWidth = (screenWidth * 0.4).toInt() // 432
        val maxContainerHeight = (screenHeight * 0.25).toInt() // 600

        // Oversized container that would enclose the whole composer
        val oversizedContainer = ClickableBoundsCandidate(
            index = 0,
            left = 0,
            top = 0,
            right = 1080, // full width > 40%
            bottom = 1200, // > 25% height
            isRegexMatch = false,
            isNonSend = false,
            strengthOverride = 1,
        )
        val realSend = ClickableBoundsCandidate(
            index = 1,
            left = 920,
            top = 1800,
            right = 1040,
            bottom = 1900,
            isRegexMatch = false,
            isNonSend = false,
            strengthOverride = 2,
        )

        val chosen = SendBoundsSelector.pickBestCandidate(
            candidates = listOf(oversizedContainer, realSend),
            editableLeft = 140,
            editableTop = 1790,
            editableRight = 900,
            editableBottom = 1910,
            minLabelStrength = 0,
            screenWidth = screenWidth,
            screenHeight = screenHeight,
        )
        assertEquals("Oversized container should be rejected", 1, chosen?.index)
    }

    @Test
    fun `send bounds selector clips shield against input field bounds`() {
        // The selector already filters candidates that enclose the editable
        val enclosingContainer = ClickableBoundsCandidate(
            index = 0,
            left = 0,
            top = 1700,
            right = 1080,
            bottom = 2000, // encloses editable
            isRegexMatch = false,
            isNonSend = false,
            strengthOverride = 1,
        )
        val realSend = ClickableBoundsCandidate(
            index = 1,
            left = 920,
            top = 1800,
            right = 1040,
            bottom = 1900,
            isRegexMatch = false,
            isNonSend = false,
            strengthOverride = 2,
        )

        val chosen = SendBoundsSelector.pickBestCandidate(
            candidates = listOf(enclosingContainer, realSend),
            editableLeft = 140,
            editableTop = 1790,
            editableRight = 900,
            editableBottom = 1910,
            minLabelStrength = 0,
            screenWidth = 1080,
            screenHeight = 2400,
        )
        assertEquals("Container enclosing editable should be rejected", 1, chosen?.index)
    }

    @Test
    fun `send bounds selector prefers small labelled send over huge unlabelled container`() {
        // Huge container with no label
        val hugeUnlabelled = ClickableBoundsCandidate(
            index = 0,
            left = 100,
            top = 100,
            right = 900, // wide
            bottom = 2000, // tall
            isRegexMatch = false,
            isNonSend = false,
            strengthOverride = 0,
        )
        // Small labelled send button
        val smallLabelled = ClickableBoundsCandidate(
            index = 1,
            left = 920,
            top = 1800,
            right = 1040,
            bottom = 1900,
            isRegexMatch = false,
            isNonSend = false,
            strengthOverride = 2,
        )

        val chosen = SendBoundsSelector.pickBestCandidate(
            candidates = listOf(hugeUnlabelled, smallLabelled),
            editableLeft = 140,
            editableTop = 1790,
            editableRight = 900,
            editableBottom = 1910,
            minLabelStrength = 0,
            screenWidth = 1080,
            screenHeight = 2400,
        )
        assertEquals("Small labelled send should win over huge unlabelled container", 1, chosen?.index)
    }

    @Test
    fun `state machine debounced teardown vs immediate teardown on clean text`() {
        val sm = SendPromptStateMachine()
        val secret = "API key AKIAIOSFODNN7EXAMPLE"

        // Arm the shield
        sm.onFieldTextObserved("com.openai.chatgpt", "ChatGPT", secret, ProtectionLevel.MEDIUM, nowMs = 1000)
        assertTrue("Shield should be armed", sm.shouldArmTouchShield("com.openai.chatgpt"))
        assertNotNull(sm.trackedState)

        // User clears the text -> immediate teardown
        sm.onFieldTextObserved("com.openai.chatgpt", "ChatGPT", "", ProtectionLevel.MEDIUM, nowMs = 1050)
        assertNull("Tracked state should be null after clean text", sm.trackedState)
        assertFalse("Shield should be disarmed immediately", sm.shouldArmTouchShield("com.openai.chatgpt"))
    }

    @Test
    fun `state machine debounced teardown vs immediate teardown on package switch`() {
        val sm = SendPromptStateMachine()
        val secret = "API key AKIAIOSFODNN7EXAMPLE"

        // Arm in ChatGPT
        sm.onFieldTextObserved("com.openai.chatgpt", "ChatGPT", secret, ProtectionLevel.MEDIUM, nowMs = 1000)
        assertTrue("Shield armed for ChatGPT", sm.shouldArmTouchShield("com.openai.chatgpt"))

        // Switch to non-guarded app (simulated by checking different package)
        // The state machine's shouldHoldShield returns false for different package
        assertFalse("Shield should not hold for different package", sm.shouldHoldShield("com.other.app"))
    }

    @Test
    fun `full send-intercept state machine armed tapped scrub`() {
        val sm = SendPromptStateMachine()
        val secret = "Use key AKIAIOSFODNN7EXAMPLE"

        // 1. Text observed with secret -> shield armed
        sm.onFieldTextObserved("com.openai.chatgpt", "ChatGPT", secret, ProtectionLevel.MEDIUM, nowMs = 1000)
        assertTrue("Shield armed", sm.shouldArmTouchShield("com.openai.chatgpt"))
        assertFalse("No prompt yet", sm.isPromptVisible)
        assertNotNull("Tracked state set", sm.trackedState)

        // 2. User taps Send (shield intercepts)
        val prompt = sm.onSendClicked("com.openai.chatgpt")
        assertNotNull("Prompt state returned", prompt)
        assertTrue("Prompt visible", sm.isPromptVisible)
        assertFalse("Shield not armed but held", sm.shouldArmTouchShield("com.openai.chatgpt"))
        assertTrue("Shield held while prompt visible", sm.shouldHoldShield("com.openai.chatgpt"))

        // 3. User chooses "Use Scrub & Send"
        val accepted = sm.acceptScrub()
        assertNotNull("Accepted state returned", accepted)
        accepted?.let {
            assertNotNull("Sanitized text returned", it.sanitizedText)
            assertTrue("Sanitized contains redaction", it.sanitizedText.contains("[REDACTED:"))
        }
        assertFalse("Prompt dismissed", sm.isPromptVisible)
        assertNull("Tracked state cleared", sm.trackedState)
        assertNull("Overridden hash cleared", sm.overriddenTextHash)

        // 4. Same text re-observed should NOT re-arm (because it was scrubbed)
        // Actually, the original raw text is different from scrubbed text
        // The override hash is only set on "Reject & Send Anyway"
        sm.onFieldTextObserved("com.openai.chatgpt", "ChatGPT", secret, ProtectionLevel.MEDIUM, nowMs = 2000)
        assertTrue("New observation with same secret should re-arm (different text object)", sm.shouldArmTouchShield("com.openai.chatgpt"))
    }

    // =====================================================================
    // Plain-language setup guidance shown on the Shield tab
    // =====================================================================

    @Test
    fun `setup helper gives one clear next action per shield state`() {
        val off = ShieldSetupCopy.helperLine(accessibilityEnabled = false, paused = false, guardedAppCount = 12)
        assertTrue("disabled state must say how to enable", off.contains("Enable", ignoreCase = true))
        assertTrue("disabled state must mention the settings list", off.contains("Cordon", ignoreCase = true))

        val paused = ShieldSetupCopy.helperLine(accessibilityEnabled = true, paused = true, guardedAppCount = 12)
        assertTrue("paused state must say resume", paused.contains("Resume", ignoreCase = true))

        val on = ShieldSetupCopy.helperLine(accessibilityEnabled = true, paused = false, guardedAppCount = 12)
        assertTrue("enabled state must say it is on", on.contains("on", ignoreCase = true))
        assertTrue("enabled state must say where to try it", on.contains("ChatGPT"))
        assertTrue("enabled state must state coverage", on.contains("12"))
        assertFalse("enabled state must not ask to enable", on.contains("Enable", ignoreCase = true))
    }

    @Test
    fun `status label distinguishes off from paused and active`() {
        assertEquals("OFF", ShieldStatusCopy.label(accessibilityEnabled = false, paused = false))
        assertEquals("OFF", ShieldStatusCopy.label(accessibilityEnabled = false, paused = true))
        assertEquals("PAUSED", ShieldStatusCopy.label(accessibilityEnabled = true, paused = true))
        assertEquals("ACTIVE", ShieldStatusCopy.label(accessibilityEnabled = true, paused = false))

        assertTrue(
            ShieldStatusCopy.headline(accessibilityEnabled = false, paused = false, guardedAppCount = 12)
                .contains("12"),
        )
        assertTrue(
            ShieldStatusCopy.headline(accessibilityEnabled = true, paused = true, guardedAppCount = 12)
                .contains("paused", ignoreCase = true),
        )
        assertTrue(
            ShieldStatusCopy.headline(accessibilityEnabled = true, paused = false, guardedAppCount = 12)
                .contains("Watching 12"),
        )
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

    // =====================================================================
    // ShieldGeometry: padding, screen clamp, editable clip, min touch target
    // =====================================================================

    private val screen = ShieldGeometry.ShieldRect(0, 0, 1080, 2400)

    @Test
    fun `shield geometry expands send rect by padding and clamps to screen`() {
        val send = ShieldGeometry.ShieldRect(920, 1800, 1040, 1900)
        val out = ShieldGeometry.expandAndClip(send, editable = null, screen, paddingPx = 12, minWidthPx = 36, minHeightPx = 36)
        assertEquals(908, out.left)
        assertEquals(1788, out.top)
        assertEquals(1052, out.right)
        assertEquals(1912, out.bottom)

        val edgeSend = ShieldGeometry.ShieldRect(1070, 0, 1080, 40)
        val clamped = ShieldGeometry.expandAndClip(edgeSend, editable = null, screen, paddingPx = 12, minWidthPx = 10, minHeightPx = 10)
        assertTrue("clamped inside screen right", clamped.right <= 1080)
        assertTrue("clamped inside screen top", clamped.top >= 0)
        assertTrue("still contains send rect", clamped.right >= edgeSend.right && clamped.top <= edgeSend.top)
    }

    @Test
    fun `shield geometry clips padding that intrudes into the editable input box`() {
        // Composer directly above the send button: only the top padding overlaps it.
        val editable = ShieldGeometry.ShieldRect(140, 1700, 1000, 1796)
        val send = ShieldGeometry.ShieldRect(920, 1800, 1040, 1900)
        val out = ShieldGeometry.expandAndClip(send, editable, screen, paddingPx = 12, minWidthPx = 36, minHeightPx = 36)
        assertFalse("shield must never overlap the editable", out.intersects(editable))
        assertEquals("top edge pulled back to editable bottom", 1796, out.top)
        assertEquals("send rect itself untouched", send.right, out.right - 12)
        assertEquals(send.bottom, out.bottom - 12)
    }

    @Test
    fun `shield geometry enforces minimum touch target without leaving the screen`() {
        val tiny = ShieldGeometry.ShieldRect(1000, 1800, 1010, 1810)
        val out = ShieldGeometry.expandAndClip(tiny, editable = null, screen, paddingPx = 0, minWidthPx = 72, minHeightPx = 72)
        assertTrue(out.width >= 72)
        assertTrue(out.height >= 72)
        assertTrue(out.right <= 1080 && out.left >= 0)
        assertTrue("grown around the send centre", out.left <= tiny.left && out.right >= tiny.right)
    }

    @Test
    fun `shield geometry leaves non overlapping editable untouched`() {
        val editable = ShieldGeometry.ShieldRect(140, 1500, 900, 1700) // far above the send button
        val send = ShieldGeometry.ShieldRect(920, 1800, 1040, 1900)
        val out = ShieldGeometry.expandAndClip(send, editable, screen, paddingPx = 12, minWidthPx = 36, minHeightPx = 36)
        assertEquals(908, out.left)
        assertEquals(1788, out.top)
        assertEquals(1052, out.right)
        assertEquals(1912, out.bottom)
    }

    @Test
    fun `full send-intercept state machine armed tapped reject no rearm`() {
        val sm = SendPromptStateMachine()
        val secret = "Use key AKIAIOSFODNN7EXAMPLE"

        // 1. Text observed with secret -> shield armed
        sm.onFieldTextObserved("com.openai.chatgpt", "ChatGPT", secret, ProtectionLevel.MEDIUM, nowMs = 1000)
        assertTrue("Shield armed", sm.shouldArmTouchShield("com.openai.chatgpt"))

        // 2. User taps Send (shield intercepts)
        val prompt = sm.onSendClicked("com.openai.chatgpt")
        assertNotNull("Prompt state returned", prompt)

        // 3. User chooses "Reject & Send Anyway"
        val rejected = sm.rejectAndSendAnyway()
        assertNotNull("Rejected state returned", rejected)
        rejected?.let {
            assertEquals("Original raw text preserved", secret, it.rawText)
        }
        assertFalse("Prompt dismissed", sm.isPromptVisible)
        assertNull("Tracked state cleared", sm.trackedState)
        assertNotNull("Overridden hash SET", sm.overriddenTextHash)
        assertEquals("Override hash matches original text hash", secret.hashCode(), sm.overriddenTextHash)

        // 4. Same text re-observed should NOT re-arm (override in effect)
        sm.onFieldTextObserved("com.openai.chatgpt", "ChatGPT", secret, ProtectionLevel.MEDIUM, nowMs = 2000)
        assertFalse("Shield should NOT re-arm for overridden text", sm.shouldArmTouchShield("com.openai.chatgpt"))
        assertNull("No prompt should be created", sm.onSendClicked("com.openai.chatgpt"))

        // 5. Different text SHOULD re-arm
        sm.onFieldTextObserved("com.openai.chatgpt", "ChatGPT", "Different secret " + secret, ProtectionLevel.MEDIUM, nowMs = 3000)
        assertTrue("Shield should re-arm for different text", sm.shouldArmTouchShield("com.openai.chatgpt"))
    }
}
