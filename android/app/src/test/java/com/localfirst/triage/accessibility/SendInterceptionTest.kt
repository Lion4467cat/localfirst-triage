package com.localfirst.triage.accessibility

import com.localfirst.triage.model.ProtectionLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SendInterceptionTest {

    // --- Matcher: whole-token matching (Gemini "Task" chip regression) -------------------------

    @Test
    fun `substring lookalikes are never send controls`() {
        val lookalikes = listOf("Task", "Mask", "Basket", "Prune", "Deposit", "Compost", "Trust", "Sending soon list")
        for (label in lookalikes) {
            assertEquals("label=$label", 0, SendButtonMatcher.labelStrength(label, null, null))
            assertFalse(
                "label=$label",
                SendButtonMatcher.isLikelySendControl(label, null, null, isClickable = true, isEditable = false),
            )
        }
    }

    @Test
    fun `label strength ranks exact send above tokens above secondary verbs`() {
        assertEquals(3, SendButtonMatcher.labelStrength("Send", null, null))
        assertEquals(3, SendButtonMatcher.labelStrength(null, "Send message", null))
        assertEquals(2, SendButtonMatcher.labelStrength(null, null, "com.google.android.apps.bard:id/send_button"))
        assertEquals(2, SendButtonMatcher.labelStrength(null, null, "com.foo:id/composerSendBtn"))
        assertEquals(2, SendButtonMatcher.labelStrength(null, "Submit prompt", null))
        assertEquals(1, SendButtonMatcher.labelStrength(null, "Ask Gemini", null))
        assertEquals(1, SendButtonMatcher.labelStrength("Reply", null, null))
        assertEquals(0, SendButtonMatcher.labelStrength("Voice message", null, null))
    }

    @Test
    fun `long prose labels such as chat bubbles are not send controls`() {
        assertEquals(0, SendButtonMatcher.labelStrength("Please send me the report by tomorrow morning", null, null))
    }

    @Test
    fun `non send controls are tokenised too`() {
        assertTrue(SendButtonMatcher.isNonSendControl("Attach file", null, null))
        assertTrue(SendButtonMatcher.isNonSendControl(null, "Voice input", null))
        assertTrue(SendButtonMatcher.isNonSendControl(null, null, "com.x:id/btn_mic"))
        assertTrue(SendButtonMatcher.isNonSendControl(null, "Add files", null))
        assertFalse(SendButtonMatcher.isNonSendControl(null, "Send message", null))
        // "feedback" must not be treated as the "back" control
        assertFalse(SendButtonMatcher.isNonSendControl(null, "Feedback", null))
    }

    // --- Selector: real-world composer layouts -------------------------------------------------

    private fun candidate(
        index: Int,
        l: Int,
        t: Int,
        r: Int,
        b: Int,
        strength: Int = 0,
        nonSend: Boolean = false,
    ) = ClickableBoundsCandidate(
        index = index, left = l, top = t, right = r, bottom = b,
        isRegexMatch = strength >= 1, isNonSend = nonSend, strengthOverride = strength,
    )

    @Test
    fun `gemini layout - task chip above composer never beats the real send button`() {
        val chat = candidate(0, 394, 825, 533, 905)
        val task = candidate(1, 544, 804, 697, 924)
        val plus = candidate(2, 100, 1215, 175, 1290, nonSend = true)
        val mic = candidate(3, 790, 1215, 865, 1290, nonSend = true)
        val send = candidate(4, 880, 1215, 980, 1315, strength = 2)
        val picked = SendBoundsSelector.pickBestCandidate(
            listOf(chat, task, plus, mic, send), 50, 1060, 1030, 1360,
        )
        assertEquals(4, picked?.index)
    }

    @Test
    fun `labelled send nearest the composer wins over a labelled control elsewhere on screen`() {
        val feedPost = candidate(0, 900, 300, 1040, 380, strength = 1)
        val composerSend = candidate(1, 925, 1245, 1045, 1365, strength = 2)
        val picked = SendBoundsSelector.pickBestCandidate(
            listOf(feedPost, composerSend), 150, 1245, 1050, 1365,
        )
        assertEquals(1, picked?.index)
    }

    @Test
    fun `weakly labelled control far from the composer is rejected`() {
        val feedPost = candidate(0, 900, 300, 1040, 380, strength = 1)
        assertNull(SendBoundsSelector.pickBestCandidate(listOf(feedPost), 150, 1245, 1050, 1365))
    }

    @Test
    fun `min label strength skips unlabelled geometric guesses`() {
        val unlabelledRight = candidate(0, 925, 1245, 1045, 1365)
        assertNull(SendBoundsSelector.pickBestCandidate(listOf(unlabelledRight), 150, 1245, 1050, 1365, minLabelStrength = 1))
        assertEquals(
            0,
            SendBoundsSelector.pickBestCandidate(listOf(unlabelledRight), 150, 1245, 1050, 1365)?.index,
        )
    }

    @Test
    fun `without editable bounds the labelled control still wins`() {
        val send = candidate(0, 900, 1200, 1000, 1300, strength = 3)
        val other = candidate(1, 100, 100, 200, 200, strength = 0)
        assertEquals(0, SendBoundsSelector.pickBestCandidate(listOf(other, send), 0, 0, 0, 0)?.index)
    }

    // --- State machine: no gaps, no second-tap leak --------------------------------------------

    private val secret = "my key is sk-proj-abcdefghijklmnopqrstuvwx1234"

    private fun observe(sm: SendPromptStateMachine, text: String, now: Long = 1_000L) =
        sm.onFieldTextObserved("com.openai.chatgpt", "ChatGPT", text, ProtectionLevel.MEDIUM, now)

    @Test
    fun `shield is held while the prompt is visible so a second tap cannot leak`() {
        val sm = SendPromptStateMachine()
        observe(sm, secret)
        assertTrue(sm.shouldArmTouchShield("com.openai.chatgpt"))
        assertNotNull(sm.onSendClicked("com.openai.chatgpt"))
        assertTrue(sm.isPromptVisible)
        assertFalse(sm.shouldArmTouchShield("com.openai.chatgpt"))
        assertTrue(sm.shouldHoldShield("com.openai.chatgpt"))
        // tapping the shield again re-opens the prompt instead of passing through
        assertNotNull(sm.onSendClicked("com.openai.chatgpt"))
    }

    @Test
    fun `transient blank observation falls back to recent risky state only when unreadable`() {
        val sm = SendPromptStateMachine()
        observe(sm, secret, now = 1_000L)
        observe(sm, "", now = 1_050L) // flap: framework reported an empty field
        assertNull(sm.trackedState)
        assertNull(sm.onSendClicked("com.openai.chatgpt"))
        assertNotNull(sm.onSendClickedRecent("com.openai.chatgpt", nowMs = 1_100L))
        assertTrue(sm.isPromptVisible)
    }

    @Test
    fun `recent risky state expires and is cleared by accept reject and reset`() {
        val sm = SendPromptStateMachine()
        observe(sm, secret, now = 1_000L)
        observe(sm, "", now = 1_010L)
        assertNull(sm.onSendClickedRecent("com.openai.chatgpt", nowMs = 1_000L + SendPromptStateMachine.RECENT_STATE_TTL_MS + 1))

        val accepted = SendPromptStateMachine()
        observe(accepted, secret, now = 1_000L)
        accepted.acceptScrub()
        assertNull(accepted.onSendClickedRecent("com.openai.chatgpt", nowMs = 1_100L))

        val rejected = SendPromptStateMachine()
        observe(rejected, secret, now = 1_000L)
        rejected.rejectAndSendAnyway()
        assertNull(rejected.onSendClickedRecent("com.openai.chatgpt", nowMs = 1_100L))

        val reset = SendPromptStateMachine()
        observe(reset, secret, now = 1_000L)
        reset.reset()
        assertNull(reset.onSendClickedRecent("com.openai.chatgpt", nowMs = 1_100L))
    }

    @Test
    fun `recent state never crosses packages`() {
        val sm = SendPromptStateMachine()
        observe(sm, secret, now = 1_000L)
        observe(sm, "", now = 1_010L)
        assertNull(sm.onSendClickedRecent("com.anthropic.claude", nowMs = 1_100L))
    }

    @Test
    fun `prompt can be dismissed so a failed overlay never disables the shield`() {
        val sm = SendPromptStateMachine()
        observe(sm, secret)
        sm.onSendClicked("com.openai.chatgpt")
        sm.dismissPrompt()
        assertFalse(sm.isPromptVisible)
        assertTrue(sm.shouldArmTouchShield("com.openai.chatgpt"))
    }

    @Test
    fun `editing the secret away while the prompt is open clears tracked risk`() {
        val sm = SendPromptStateMachine()
        observe(sm, secret)
        sm.onSendClicked("com.openai.chatgpt")
        observe(sm, "my key is [removed]")
        assertNull(sm.trackedState)
        assertFalse(sm.shouldHoldShield("com.openai.chatgpt"))
    }

    @Test
    fun `a readable clean observation also clears the recent fallback`() {
        val sm = SendPromptStateMachine()
        observe(sm, secret, now = 1_000L)
        observe(sm, "my key is [removed]", now = 1_050L)
        // The secret is gone from the field, so the fallback must not resurrect it and
        // overwrite whatever the user has typed since.
        assertNull(sm.onSendClickedRecent("com.openai.chatgpt", nowMs = 1_100L))
    }

    // --- Tap path: one blank read at tap time must never send the raw secret ------------------

    @Test
    fun `a blank tap-time read still prompts from the recent risky state`() {
        val sm = SendPromptStateMachine()
        observe(sm, secret, now = 1_000L)
        observe(sm, "", now = 1_020L) // event-path flap: tracked state gone, recent memory kept
        assertNull(sm.trackedState)
        // The tap handler re-reads the composer and the framework reports "" again.
        val result = sm.onShieldTapped(
            pkg = "com.openai.chatgpt",
            appName = "ChatGPT",
            fresh = "",
            protectionLevel = ProtectionLevel.MEDIUM,
            nowMs = 1_050L,
        )
        assertEquals(ShieldTapOutcome.SHOW_PROMPT, result.outcome)
        assertNotNull("a blank read must not erase a secret seen moments earlier", result.prompt)
        assertTrue(sm.isPromptVisible)
    }

    @Test
    fun `an unreadable tap-time read holds the shield instead of sending`() {
        val sm = SendPromptStateMachine()
        observe(sm, secret, now = 1_000L)
        val live = sm.onShieldTapped(
            pkg = "com.openai.chatgpt",
            appName = "ChatGPT",
            fresh = null,
            protectionLevel = ProtectionLevel.MEDIUM,
            nowMs = 1_050L,
        )
        assertEquals(ShieldTapOutcome.SHOW_PROMPT, live.outcome)
        assertTrue("the shield must stay armed", sm.shouldHoldShield("com.openai.chatgpt"))

        // Same unreadable tap once the recent memory has expired: the composer still cannot be
        // proven clean, so the tap must be held rather than sent.
        val stale = SendPromptStateMachine()
        observe(stale, secret, now = 1_000L)
        observe(stale, "", now = 1_010L) // the flap the old tap path used to trust
        val expired = stale.onShieldTapped(
            pkg = "com.openai.chatgpt",
            appName = "ChatGPT",
            fresh = null,
            protectionLevel = ProtectionLevel.MEDIUM,
            nowMs = 1_000L + SendPromptStateMachine.RECENT_STATE_TTL_MS + 1,
        )
        assertEquals(ShieldTapOutcome.HOLD, expired.outcome)
        assertNull(expired.prompt)
    }

    @Test
    fun `a blank tap-time read with no recent state is never treated as clean`() {
        val sm = SendPromptStateMachine()
        val result = sm.onShieldTapped(
            pkg = "com.openai.chatgpt",
            appName = "ChatGPT",
            fresh = "",
            protectionLevel = ProtectionLevel.MEDIUM,
            nowMs = 1_050L,
        )
        assertEquals(ShieldTapOutcome.HOLD, result.outcome)
        assertNull(result.prompt)
    }

    @Test
    fun `a readable clean tap-time read lets the tap through`() {
        val sm = SendPromptStateMachine()
        val result = sm.onShieldTapped(
            pkg = "com.openai.chatgpt",
            appName = "ChatGPT",
            fresh = "just a normal question",
            protectionLevel = ProtectionLevel.MEDIUM,
            nowMs = 1_050L,
        )
        assertEquals(ShieldTapOutcome.SEND, result.outcome)
    }

    // --- Arming retry: a slow first scan must not let Send slip through ------------------------

    @Test
    fun `arming retries while the tree is unreadable so a fast Send tap is still caught`() {
        // Window tree not ready yet (keyboard still animating): keep retrying, do not give up.
        assertTrue(ShieldArmRetryPolicy.shouldRetry(attempt = 0, rootAvailable = false, targetAvailable = false))
        assertTrue(ShieldArmRetryPolicy.shouldRetry(attempt = 3, rootAvailable = true, targetAvailable = false))
        // Once the Send control is located the retry loop must stop.
        assertFalse(ShieldArmRetryPolicy.shouldRetry(attempt = 3, rootAvailable = true, targetAvailable = true))
    }

    @Test
    fun `arming retry is bounded so a dead window never spins forever`() {
        var attempt = 0
        while (ShieldArmRetryPolicy.shouldRetry(attempt, rootAvailable = false, targetAvailable = false)) {
            attempt++
            assertTrue("retry loop must terminate", attempt < 100)
        }
        assertEquals(ShieldArmRetryPolicy.MAX_ATTEMPTS, attempt)
    }

    @Test
    fun `arming retry backs off and stays inside the send-tap window`() {
        val delays = (0 until ShieldArmRetryPolicy.MAX_ATTEMPTS).map { ShieldArmRetryPolicy.delayMs(it) }
        assertTrue("first retry must be fast, was ${delays.first()}", delays.first() <= 80L)
        // Monotonic, non-decreasing backoff.
        delays.zipWithNext().forEach { (a, b) -> assertTrue("backoff must not shrink: $a -> $b", b >= a) }
        // Total time to exhaust retries must stay well under the time a user needs to tap Send.
        assertTrue("total retry budget too long: ${delays.sum()}ms", delays.sum() <= 1_500L)
    }

    // --- Prompt placement: the dialog must sit next to the Send button ------------------------

    @Test
    fun `prompt is placed directly above the send control`() {
        assertEquals(
            1_000,
            PromptPlacement.topFor(anchorTop = 1_230, promptHeight = 200, gapPx = 30, minTopPx = 150),
        )
    }

    @Test
    fun `prompt never climbs above the status bar on a short screen`() {
        assertEquals(
            150,
            PromptPlacement.topFor(anchorTop = 300, promptHeight = 400, gapPx = 30, minTopPx = 150),
        )
    }

    @Test
    fun `prompt falls back to the minimum when no anchor is known`() {
        assertEquals(
            150,
            PromptPlacement.topFor(anchorTop = 0, promptHeight = 0, gapPx = 30, minTopPx = 150),
        )
    }

    // --- Geometric fallback: keep the shield over Send when the node tree hides it ------------

    @Test
    fun `fallback anchor covers the send corner of the composer row`() {
        val composer = ShieldGeometry.ShieldRect(70, 1145, 1010, 1265)
        val screen = ShieldGeometry.ShieldRect(0, 0, 1080, 2400)
        val anchor = ShieldFallbackAnchor.forComposer(
            editable = composer,
            screen = screen,
            widthPx = 150,
            extraBottomPx = 60,
        )!!
        assertEquals(930, anchor.left)
        assertEquals(1080, anchor.right)
        assertEquals(1145, anchor.top)
        // Reaches past the text field: the Send control sits on the row's bottom edge.
        assertEquals(1325, anchor.bottom)
    }

    @Test
    fun `fallback anchor is clamped inside the screen`() {
        val composer = ShieldGeometry.ShieldRect(0, 20, 1080, 90)
        val screen = ShieldGeometry.ShieldRect(0, 0, 1080, 2400)
        val anchor = ShieldFallbackAnchor.forComposer(
            editable = composer,
            screen = screen,
            widthPx = 150,
            extraBottomPx = 60,
        )!!
        assertEquals(20, anchor.top)
        assertTrue(anchor.bottom <= screen.bottom)
        assertTrue(anchor.right <= screen.right)
    }

    @Test
    fun `fallback anchor refuses an unreadable composer`() {
        val empty = ShieldGeometry.ShieldRect(0, 0, 0, 0)
        val screen = ShieldGeometry.ShieldRect(0, 0, 1080, 2400)
        assertNull(
            ShieldFallbackAnchor.forComposer(empty, screen, widthPx = 150, extraBottomPx = 60),
        )
    }
}
