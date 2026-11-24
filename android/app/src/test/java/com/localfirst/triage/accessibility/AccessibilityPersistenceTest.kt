package com.localfirst.triage.accessibility

import com.localfirst.triage.data.ShieldStore
import com.localfirst.triage.firewall.LocalFirewallEngine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression suite for Samsung One UI Accessibility persistence, colon-delimited
 * `ENABLED_ACCESSIBILITY_SERVICES` parsing (short & full ComponentName formats),
 * service-rebind cache re-hydration, and Lock Modal double-tap concurrency guards.
 */
class AccessibilityPersistenceTest {

    private val pkg = "com.localfirst.triage"
    private val cls = "com.localfirst.triage.accessibility.CordonAccessibilityService"
    private val fullFlatten = "$pkg/$cls"
    private val shortFlatten = "$pkg/.accessibility.CordonAccessibilityService"

    @Test
    fun `matches colon delimited ENABLED_ACCESSIBILITY_SERVICES in both full and short ComponentName formats`() {
        assertTrue(
            ShieldStore.matchesEnabledAccessibilitySetting(
                rawSetting = fullFlatten,
                packageName = pkg,
                serviceClassName = cls,
            ),
        )
        assertTrue(
            ShieldStore.matchesEnabledAccessibilitySetting(
                rawSetting = shortFlatten,
                packageName = pkg,
                serviceClassName = cls,
            ),
        )

        val oneUiColonList = listOf(
            "com.samsung.android.bixby.wakeup/.WakeupService",
            shortFlatten,
            "com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService",
        ).joinToString(":")
        assertTrue(
            ShieldStore.matchesEnabledAccessibilitySetting(
                rawSetting = oneUiColonList,
                packageName = pkg,
                serviceClassName = cls,
            ),
        )

        val paddedAndMixedCase = " : ${fullFlatten.uppercase()} : "
        assertTrue(
            ShieldStore.matchesEnabledAccessibilitySetting(
                rawSetting = paddedAndMixedCase,
                packageName = pkg,
                serviceClassName = cls,
            ),
        )
    }

    @Test
    fun `rejects disabled master switch blank settings and lookalike third party services`() {
        assertFalse(
            ShieldStore.matchesEnabledAccessibilitySetting(
                rawSetting = fullFlatten,
                packageName = pkg,
                serviceClassName = cls,
                accessibilityMasterEnabled = false,
            ),
        )
        assertFalse(
            ShieldStore.matchesEnabledAccessibilitySetting(
                rawSetting = null,
                packageName = pkg,
                serviceClassName = cls,
            ),
        )
        assertFalse(
            ShieldStore.matchesEnabledAccessibilitySetting(
                rawSetting = ":::  :",
                packageName = pkg,
                serviceClassName = cls,
            ),
        )
        assertFalse(
            ShieldStore.matchesEnabledAccessibilitySetting(
                rawSetting = "com.other.vendor/.accessibility.CordonAccessibilityService:com.samsung.accessibility/.CoreService",
                packageName = pkg,
                serviceClassName = cls,
            ),
        )
    }

    @Test
    fun `matches AccessibilityManager enabled service info ids across short and full formats`() {
        assertTrue(
            ShieldStore.matchesEnabledServiceInfoList(
                enabledServiceIds = listOf("com.samsung.accessibility/.AssistantMenu", shortFlatten),
                packageName = pkg,
                serviceClassName = cls,
            ),
        )
        assertTrue(
            ShieldStore.matchesEnabledServiceInfoList(
                enabledServiceIds = listOf(fullFlatten),
                packageName = pkg,
                serviceClassName = cls,
            ),
        )
        assertFalse(
            ShieldStore.matchesEnabledServiceInfoList(
                enabledServiceIds = listOf("com.samsung.accessibility/.AssistantMenu"),
                packageName = pkg,
                serviceClassName = cls,
            ),
        )
    }

    @Test
    fun `preserves enabled state across One UI process recreation when volatile memory resets`() {
        // Simulate OS Settings + AccessibilityManager state surviving while the UI process is killed.
        var osSettingRaw: String? = "com.samsung.accessibility/.Core:$shortFlatten"
        var osManagerServices: List<String> = listOf(fullFlatten)
        var volatileInProcessConnected = true

        fun checkUiStatus(): Boolean {
            val settingOk = ShieldStore.matchesEnabledAccessibilitySetting(osSettingRaw, pkg, cls)
            val managerOk = ShieldStore.matchesEnabledServiceInfoList(osManagerServices, pkg, cls)
            return ShieldStore.resolveAccessibilityEnabled(
                settingMatched = settingOk,
                managerMatched = managerOk,
                serviceConnected = volatileInProcessConnected,
            )
        }

        assertTrue("Initially enabled", checkUiStatus())

        // Simulate Samsung One UI hibernating / killing the UI process (volatile boolean resets to false)
        volatileInProcessConnected = false
        assertTrue("Still enabled via Settings.Secure + AccessibilityManager after UI restart", checkUiStatus())

        // Simulate transient Settings.Secure read restriction while AccessibilityManager still lists Cordon
        osSettingRaw = null
        assertTrue("Still enabled via AccessibilityManager fallback", checkUiStatus())

        // Simulate user actually revoking Cordon in Android Accessibility Settings
        osManagerServices = emptyList()
        assertFalse("Reports disabled immediately once OS revokes permission", checkUiStatus())
    }

    @Test
    fun `rehydrated guarded package state honours defaults aliases and user overrides`() {
        val state = mapOf(
            "com.openai.chatgpt" to true,
            "com.android.chrome" to true,
            "com.google.android.apps.bard" to false,
            "org.telegram.messenger" to true,
        )
        assertTrue(ShieldStore.isPackageGuardedFromState("com.openai.chatgpt", state))
        assertTrue("Chrome Beta inherits Chrome toggle", ShieldStore.isPackageGuardedFromState("com.chrome.beta", state))
        assertFalse("Google Search inherits disabled Gemini toggle", ShieldStore.isPackageGuardedFromState("com.google.android.googlequicksearchbox", state))
        assertTrue("Custom user-added app stays guarded after rebind", ShieldStore.isPackageGuardedFromState("org.telegram.messenger", state))
        assertFalse(ShieldStore.isPackageGuardedFromState("com.unlisted.game", state))
        assertTrue("Engine warmUp pre-touches rule tables cleanly", LocalFirewallEngine.warmUp() > 30)
    }

    @Test
    fun `ModalActionGate allows at most one action across rapid double taps`() {
        val gate = ModalActionGate()
        assertFalse(gate.isConsumed)
        var executed = 0
        repeat(10) {
            if (gate.tryAcquire()) executed++
        }
        assertEquals("Rapid double-taps must execute Scrub/Allow exactly once", 1, executed)
        assertTrue(gate.isConsumed)
    }

    @Test
    fun `default guarded browser set covers all major Android browsers`() {
        val defaults = ShieldStore.DEFAULT_GUARDED_APPS.map { it.packageName }.toSet()
        val expectedBrowsers = listOf(
            "com.android.chrome",
            "com.chrome.beta",
            "com.chrome.dev",
            "com.sec.android.app.sbrowser",
            "com.brave.browser",
            "com.microsoft.emmx",
            "org.mozilla.firefox",
            "com.opera.browser",
            "com.duckduckgo.mobile.android",
        )
        for (browserPkg in expectedBrowsers) {
            assertTrue("Default guarded set missing $browserPkg", defaults.contains(browserPkg))
            assertTrue("BrowserGuardPolicy must recognise $browserPkg", BrowserGuardPolicy.isBrowserPackage(browserPkg))
        }
        assertTrue("Chrome Canary matches browser prefix", BrowserGuardPolicy.isBrowserPackage("com.chrome.canary"))
        assertTrue("Firefox Fenix matches browser prefix", BrowserGuardPolicy.isBrowserPackage("org.mozilla.fenix"))
        assertFalse("ChatGPT is not classified as a browser", BrowserGuardPolicy.isBrowserPackage("com.openai.chatgpt"))
    }

    @Test
    fun `browser typing locks synchronously with zero debounce even on open-ended PII`() {
        val raw = "contact john.doe@acme.io"
        val (_, spans) = LocalFirewallEngine.scrub(raw, com.localfirst.triage.model.ProtectionLevel.MEDIUM)
        val masked = spans.filter { it.masked }
        assertTrue(masked.isNotEmpty())

        // Chat apps debounce open-ended PII still growing at the end of the field...
        assertEquals(
            GuardTriggerPolicy.Trigger.DEBOUNCE,
            GuardTriggerPolicy.trigger(isBurst = false, findings = masked, textLength = raw.length, isBrowserSurface = false),
        )
        // ...whereas browser surfaces lock immediately (0 ms debounce) before Search/Go can race!
        assertEquals(
            GuardTriggerPolicy.Trigger.LOCK_NOW,
            GuardTriggerPolicy.trigger(isBurst = false, findings = masked, textLength = raw.length, isBrowserSurface = true),
        )
    }

    @Test
    fun `extractLiveNodeText strictly ignores hintText and omnibox idle placeholders`() {
        assertEquals(
            null,
            BrowserGuardPolicy.extractLiveNodeText(
                rawText = "Search or type URL",
                hintText = "Search or type URL",
                isShowingHintText = true,
            ),
        )
        assertEquals(
            null,
            BrowserGuardPolicy.extractLiveNodeText(
                rawText = "Search Google or type a URL",
                hintText = "Search Google or type a URL",
                isShowingHintText = false,
            ),
        )
        assertEquals(
            null,
            BrowserGuardPolicy.extractLiveNodeText(
                rawText = "Search or type web address",
                hintText = null,
                isShowingHintText = false,
            ),
        )
        val liveSecret = "sk_" + "live_99887766554433221100aabb"
        assertEquals(
            liveSecret,
            BrowserGuardPolicy.extractLiveNodeText(
                rawText = liveSecret,
                hintText = "Search or type URL",
                isShowingHintText = false,
            ),
        )
    }

    @Test
    fun `BrowserSearchAbortGuard aborts leaked search URLs within 1500ms with zero benign false positives`() {
        val guard = BrowserSearchAbortGuard()
        val stripeKey = "sk_" + "live_99887766554433221100aabb"
        val scrubFn = { q: String ->
            LocalFirewallEngine.scrub(q, com.localfirst.triage.model.ProtectionLevel.MEDIUM)
        }

        // 1. Benign browsing URLs and benign Google searches never trigger an abort
        for (benign in listOf(
            "https://para-1-2e22b.web.app/",
            "http://localhost:8080/api/v4.6.2",
            "https://github.com/Lion4467cat/localfirst-triage",
            "https://www.google.com/search?q=how+to+fix+python+IndexError&ie=UTF-8",
            "https://www.google.com/search?q=v4.6.2+release+notes",
            "https://www.google.com/search?q=127.0.0.1+localhost+port+8080",
        )) {
            val dec = guard.evaluateInFlightUrl(
                pkg = "com.android.chrome",
                urlBarText = benign,
                nowMs = 1_000L,
                isOverridden = { _, _ -> false },
                scrubFn = scrubFn,
            )
            assertFalse("Benign URL must not abort: $benign", dec.shouldAbort)
        }

        // 2. Direct search URL carrying raw secret aborts immediately & prepares scrubbed query
        val leakedSearchUrl = "https://www.google.com/search?q=debug+$stripeKey+502&oq=debug"
        val abort1 = guard.evaluateInFlightUrl(
            pkg = "com.android.chrome",
            urlBarText = leakedSearchUrl,
            nowMs = 2_000L,
            isOverridden = { _, _ -> false },
            scrubFn = scrubFn,
        )
        assertTrue("Leaked Google search query must trigger GLOBAL_ACTION_BACK abort", abort1.shouldAbort)
        assertFalse("Scrubbed query must not contain raw key", abort1.sanitizedQuery.contains(stripeKey))
        assertTrue(abort1.sanitizedQuery.contains("[REDACTED:API_KEY"))

        // Cooldown prevents infinite GLOBAL_ACTION_BACK loop on the identical URL frame
        val duplicateFrame = guard.evaluateInFlightUrl(
            pkg = "com.android.chrome",
            urlBarText = leakedSearchUrl,
            nowMs = 2_200L,
            isOverridden = { _, _ -> false },
            scrubFn = scrubFn,
        )
        assertFalse("Identical URL within cooldown must not re-fire BACK", duplicateFrame.shouldAbort)

        // 3. Sub-1500ms pre-navigation PII carried into custom search navigation also aborts
        val (sanitized, spans) = scrubFn("PAN ABCDE1234F check")
        guard.recordDetectedBrowserPii(
            pkg = "com.sec.android.app.sbrowser",
            rawText = "PAN ABCDE1234F check",
            sanitizedText = sanitized,
            spans = spans,
            nowMs = 5_000L,
        )
        val customNav = guard.evaluateInFlightUrl(
            pkg = "com.sec.android.app.sbrowser",
            urlBarText = "https://intranet.internal/lookup/ABCDE1234F",
            nowMs = 6_100L,
            isOverridden = { _, _ -> false },
            scrubFn = scrubFn,
        )
        assertTrue("Sub-1500ms browser PII leak into URL path must abort", customNav.shouldAbort)
    }
}
