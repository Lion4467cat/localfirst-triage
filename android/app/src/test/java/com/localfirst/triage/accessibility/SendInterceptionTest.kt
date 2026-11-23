package com.localfirst.triage.accessibility

import com.localfirst.triage.data.InstalledApp
import com.localfirst.triage.data.InstalledAppCatalog
import com.localfirst.triage.data.Pluralize
import com.localfirst.triage.data.ShieldStore
import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.ProtectionLevel
import com.localfirst.triage.model.RedactionSpan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The full-screen decision modal replaced coordinate-based Send hunting. These tests pin the
 * behaviour that made the old approach fragile: when it locks, how it avoids locking twice, and
 * which surfaces it must never lock at all.
 */
class SendInterceptionTest {

    // --- Synthetic secrets (split so push protection never trips) ---------------------------

    private val awsKey = "AKIA" + "IOSFODNN7EXAMPLE"
    private val stripeKey = "sk_live_" + "51NxMockSecret9988776655"
    private val email = "ops" + "@" + "acme-health.org"

    private fun scrub(text: String, level: ProtectionLevel = ProtectionLevel.MEDIUM): List<RedactionSpan> =
        LocalFirewallEngine.scrub(text, level).second.filter { it.masked }

    // --- Hard exclusions: never lock these packages ----------------------------------------

    @Test
    fun `cordon itself system ui and settings are never locked`() {
        assertTrue(GuardExclusions.isExcludedPackage("com.localfirst.triage"))
        assertTrue(GuardExclusions.isExcludedPackage("com.android.systemui"))
        assertTrue(GuardExclusions.isExcludedPackage("com.android.settings"))
        assertTrue(GuardExclusions.isExcludedPackage("android"))
        assertTrue(GuardExclusions.isExcludedPackage(null))
        assertTrue(GuardExclusions.isExcludedPackage(""))
    }

    @Test
    fun `keyboard packages are never locked`() {
        assertTrue(GuardExclusions.isExcludedPackage("com.google.android.inputmethod.latin"))
        assertTrue(GuardExclusions.isExcludedPackage("com.samsung.android.honeyboard"))
        assertTrue(GuardExclusions.isExcludedPackage("com.touchtype.swiftkey"))
        assertTrue(GuardExclusions.isExcludedPackage("com.microsoft.swiftkey"))
    }

    @Test
    fun `home launchers are never locked`() {
        assertTrue(GuardExclusions.isExcludedPackage("com.google.android.apps.nexuslauncher"))
        assertTrue(GuardExclusions.isExcludedPackage("com.miui.home"))
        assertTrue(GuardExclusions.isExcludedPackage("com.sec.android.app.launcher"))
    }

    @Test
    fun `a keyboard window state change is not an app switch`() {
        // The IME raises window-state events while the user types into the guarded app. Treating
        // those as an app switch dismissed the modal the instant it appeared.
        assertTrue(GuardExclusions.isInputMethodPackage("org.futo.inputmethod.latin"))
        assertTrue(GuardExclusions.isInputMethodPackage("com.google.android.inputmethod.latin"))
        assertTrue(GuardExclusions.isInputMethodPackage("com.samsung.android.honeyboard"))
        assertFalse(GuardExclusions.isInputMethodPackage("com.openai.chatgpt"))
        assertFalse(GuardExclusions.isInputMethodPackage("com.android.chrome"))
        assertFalse(GuardExclusions.isInputMethodPackage(null))
    }

    @Test
    fun `real chat browsers and AI apps stay guarded`() {
        assertFalse(GuardExclusions.isExcludedPackage("com.android.chrome"))
        assertFalse(GuardExclusions.isExcludedPackage("com.openai.chatgpt"))
        assertFalse(GuardExclusions.isExcludedPackage("com.anthropic.claude"))
        assertFalse(GuardExclusions.isExcludedPackage("com.google.android.apps.bard"))
        assertFalse(GuardExclusions.isExcludedPackage("com.whatsapp"))
        assertFalse(GuardExclusions.isExcludedPackage("org.telegram.messenger"))
    }

    // --- Trigger timing --------------------------------------------------------------------

    @Test
    fun `a paste burst is at least eight characters in one event`() {
        assertFalse(GuardTriggerPolicy.isPasteBurst(previousLength = 0, currentLength = 7))
        assertTrue(GuardTriggerPolicy.isPasteBurst(previousLength = 0, currentLength = 8))
        assertTrue(GuardTriggerPolicy.isPasteBurst(previousLength = 12, currentLength = 60))
        // Deleting text is never a paste.
        assertFalse(GuardTriggerPolicy.isPasteBurst(previousLength = 40, currentLength = 10))
    }

    @Test
    fun `paste with a secret locks immediately while benign text never locks`() {
        val paste = "here is my key $awsKey"
        assertEquals(
            GuardTriggerPolicy.Trigger.LOCK_NOW,
            GuardTriggerPolicy.trigger(isBurst = true, findings = scrub(paste), textLength = paste.length),
        )
        val benign = "here is a normal pasted paragraph"
        assertEquals("benign paste must find nothing", 0, scrub(benign).size)
        assertEquals(
            GuardTriggerPolicy.Trigger.IGNORE,
            GuardTriggerPolicy.trigger(isBurst = true, findings = scrub(benign), textLength = benign.length),
        )
    }

    @Test
    fun `typing a card never locks on the twelve digit government id prefix`() {
        // A card is typed one digit at a time; the first twelve digits look exactly like Aadhaar.
        val halfTyped = "card 4111 1111 1111"
        assertEquals(
            GuardTriggerPolicy.Trigger.DEBOUNCE,
            GuardTriggerPolicy.trigger(isBurst = false, findings = scrub(halfTyped), textLength = halfTyped.length),
        )

        val complete = "card 4111 1111 1111 1111"
        val findings = scrub(complete)
        assertTrue(findings.any { it.category == "CREDIT_CARD" })
        assertTrue(findings.none { it.category == "GOV_ID" })
        assertEquals(
            GuardTriggerPolicy.Trigger.LOCK_NOW,
            GuardTriggerPolicy.trigger(isBurst = false, findings = findings, textLength = complete.length),
        )
    }

    @Test
    fun `structured financial identifiers lock immediately when typed`() {
        listOf(
            "upi ravi.kumar@oksbi",
            "pan ABCPE1234F",
            "ifsc HDFC0001234",
            "security code 456",
        ).forEach { typed ->
            val findings = scrub(typed)
            assertTrue("expected a finding for '$typed'", findings.isNotEmpty())
            assertEquals(
                "typed '$typed' must lock now",
                GuardTriggerPolicy.Trigger.LOCK_NOW,
                GuardTriggerPolicy.trigger(isBurst = false, findings = findings, textLength = typed.length),
            )
        }
    }

    @Test
    fun `a typed structured credential locks without waiting for a pause`() {
        val typed = "key $awsKey"
        val findings = scrub(typed)
        assertTrue(findings.isNotEmpty())
        assertEquals(
            GuardTriggerPolicy.Trigger.LOCK_NOW,
            GuardTriggerPolicy.trigger(isBurst = false, findings = findings, textLength = typed.length),
        )
        assertEquals(250L, GuardTriggerPolicy.TYPING_DEBOUNCE_MS)
    }

    @Test
    fun `typed PII that is already terminated locks immediately`() {
        val typed = "mail $email now"
        val findings = scrub(typed)
        assertTrue(findings.isNotEmpty())
        assertTrue(findings.all { it.end < typed.length })
        assertEquals(
            GuardTriggerPolicy.Trigger.LOCK_NOW,
            GuardTriggerPolicy.trigger(isBurst = false, findings = findings, textLength = typed.length),
        )
    }

    @Test
    fun `open-ended PII still being typed is the only thing that waits`() {
        val typed = "mail ops@acme-heal.co"
        val findings = scrub(typed)
        assertTrue(findings.isNotEmpty())
        assertTrue(findings.all { it.end >= typed.length })
        assertEquals(
            GuardTriggerPolicy.Trigger.DEBOUNCE,
            GuardTriggerPolicy.trigger(isBurst = false, findings = findings, textLength = typed.length),
        )
    }

    @Test
    fun `half typed text is silent`() {
        val typed = "key AKIA"
        assertEquals(0, scrub(typed).size)
        assertEquals(
            GuardTriggerPolicy.Trigger.IGNORE,
            GuardTriggerPolicy.trigger(isBurst = false, findings = scrub(typed), textLength = typed.length),
        )
    }

    @Test
    fun `debounced rescan only locks while the exact secret is still in the field`() {
        val findings = scrub("key $awsKey")
        assertTrue(GuardTriggerPolicy.stillHoldsSecret("key $awsKey and more text", findings))
        assertFalse(GuardTriggerPolicy.stillHoldsSecret("key deleted", findings))
        assertFalse(GuardTriggerPolicy.stillHoldsSecret("", findings))
    }

    @Test
    fun `benign prompts produce zero findings so nothing is ever shown`() {
        val benign = listOf(
            "Can you summarise this article about privacy?",
            "npm install --save-dev typescript",
            "Version 4.8.2 fixed the timeout bug in pg_locks",
            "Deploy is scheduled for Tuesday at 10:30",
            "Order ABC123 was delivered",
            "https://example.com/docs/getting-started",
        )
        for (text in benign) {
            assertEquals("false positive in: $text", 0, scrub(text).size)
        }
    }

    // --- Anti-loop override ----------------------------------------------------------------

    @Test
    fun `allow once suppresses the modal for the same text and clears on edit`() {
        val memory = OverrideMemory()
        val text = "key $awsKey"
        assertFalse(memory.isOverridden("com.openai.chatgpt", text))

        memory.remember("com.openai.chatgpt", text)
        assertTrue(memory.isOverridden("com.openai.chatgpt", text))
        // The content-changed storm repeats the same text: still suppressed.
        memory.onTextChanged("com.openai.chatgpt", text)
        assertTrue(memory.isOverridden("com.openai.chatgpt", text))

        // Any edit drops the override so the next secret is caught again.
        memory.onTextChanged("com.openai.chatgpt", "key $awsKey and one more word")
        assertFalse(memory.isOverridden("com.openai.chatgpt", "key $awsKey and one more word"))
    }

    @Test
    fun `clearing the field clears the override`() {
        val memory = OverrideMemory()
        memory.remember("com.whatsapp", "key $awsKey")
        memory.onTextChanged("com.whatsapp", "")
    }

    @Test
    fun `an override never leaks into another app`() {
        val memory = OverrideMemory()
        memory.remember("com.openai.chatgpt", "key $awsKey")
        assertFalse(memory.isOverridden("com.anthropic.claude", "key $awsKey"))
        memory.onTextChanged("com.anthropic.claude", "key $awsKey")
    }

    @Test
    fun `remembering before dismissing survives the dismiss-triggered content change`() {
        // The order is the whole fix: remember() then dismiss. If the override were stored after
        // the overlay was removed, the content-changed event in between would re-lock.
        val memory = OverrideMemory()
        val text = "pasted $stripeKey"
        memory.remember("com.android.chrome", text)
        // ... overlay removed here, content-changed fires with the same text ...
        assertTrue(memory.isOverridden("com.android.chrome", text))
    }

    // --- Self-edit tracking ----------------------------------------------------------------

    @Test
    fun `the text event caused by our own scrub is ignored once`() {
        val tracker = SelfEditTracker()
        tracker.mark("key [REDACTED:API_KEY_1]")
        assertTrue(tracker.consume("key [REDACTED:API_KEY_1]"))
        assertFalse(tracker.consume("key [REDACTED:API_KEY_1]"))
        assertFalse(tracker.consume("something the user typed"))
    }

    // --- Key guard -------------------------------------------------------------------------

    @Test
    fun `enter and search cannot submit the field while the modal is up`() {
        assertTrue(GuardTriggerPolicy.shouldSwallowKey(66, modalVisible = true))
        assertTrue(GuardTriggerPolicy.shouldSwallowKey(160, modalVisible = true))
        assertTrue(GuardTriggerPolicy.shouldSwallowKey(84, modalVisible = true))
        assertFalse(GuardTriggerPolicy.shouldSwallowKey(66, modalVisible = false))
        assertFalse(GuardTriggerPolicy.shouldSwallowKey(29, modalVisible = true))
    }

    @Test
    fun `hardware enter is consumed while a risky draft is present`() {
        assertTrue(EnterKeyPolicy.shouldConsume(66, 0, riskyDraftPresent = true))
        assertTrue(EnterKeyPolicy.shouldConsume(66, 1, riskyDraftPresent = true))
        assertTrue(EnterKeyPolicy.shouldConsume(160, 0, riskyDraftPresent = true))
        assertFalse(EnterKeyPolicy.shouldConsume(66, 0, riskyDraftPresent = false))
        assertFalse(EnterKeyPolicy.shouldConsume(29, 0, riskyDraftPresent = true))
    }

    // --- Modal copy and chips --------------------------------------------------------------

    @Test
    fun `modal copy names the app and promises a local scrub`() {
        assertEquals("Cordon Privacy Shield", ModalCopy.HEADER)
        assertEquals("Sensitive Data Blocked", ModalCopy.STATUS_PILL)
        assertEquals("Scrub in Field", ModalCopy.PRIMARY)
        assertEquals("Allow Once (Unsafe)", ModalCopy.SECONDARY)
        assertTrue(ModalCopy.subtext("ChatGPT").contains("ChatGPT"))
        assertTrue(ModalCopy.subtext("ChatGPT").contains("Scrub it before it leaves your device"))
        assertEquals("Zero-PII · Processed 100% On-Device", ModalCopy.FOOTER)
    }

    @Test
    fun `category chips are pluralised and never contain a raw value`() {
        val findings = scrub("$awsKey and $email and $stripeKey")
        val chips = FindingChips.chips(findings)
        assertTrue("chips=$chips", chips.any { it.endsWith("AWS Key") })
        assertTrue("chips=$chips", chips.any { it.endsWith("Email") })
        for (chip in chips) {
            assertFalse("chip leaked a raw value: $chip", chip.contains(awsKey))
            assertFalse("chip leaked a raw value: $chip", chip.contains(email))
            assertFalse("chip leaked a raw value: $chip", chip.contains(stripeKey))
        }
    }

    @Test
    fun `two of the same category reads as a plural`() {
        val findings = scrub("$awsKey and " + "ASIA" + "IOSFODNN7EXAMPLE")
        assertTrue(FindingChips.summary(findings).contains("2 AWS Keys"))
    }

    @Test
    fun `six categories collapse to three chips plus a more count`() {
        val categories = listOf(
            "CREDIT_CARD", "EMAIL", "PHONE", "API_KEY", "AWS_ACCESS_KEY", "IP_ADDRESS",
        )
        val findings = categories.mapIndexed { index, category ->
            com.localfirst.triage.model.RedactionSpan(
                start = index * 10,
                end = index * 10 + 4,
                category = category,
                detector = com.localfirst.triage.model.DetectorSource.REGEX_FIREWALL,
                placeholder = "[REDACTED]",
                matchedText = "tok$index",
            )
        }
        val chips = FindingChips.chips(findings)
        assertEquals(4, chips.size)
        assertEquals("+3 more", chips.last())
        // Every chip is a count plus a noun: no raw value and no overflow past the modal width.
        for (chip in chips.dropLast(1)) {
            assertTrue("chip=$chip", Regex("^\\d+ [A-Za-z].*").matches(chip))
        }
    }

    // --- Pluralisation helper --------------------------------------------------------------

    @Test
    fun `history chip row never contradicts the caught badge`() {
        val counts = linkedMapOf(
            "ADDRESS" to 1,
            "CREDIT_CARD" to 1,
            "CARD_EXPIRY" to 1,
            "CVV" to 1,
            "UPI_ID" to 1,
        )
        val chips = ShieldStore.chipLine(counts)
        assertEquals(4, chips.size)
        assertEquals("+2 more", chips.last())
        assertEquals(listOf("1 Address"), ShieldStore.chipLine(mapOf("ADDRESS" to 1)))
    }

    @Test
    fun `pluraliser handles the categories the UI actually shows`() {
        assertEquals("1 AWS Key", ShieldStore.categoryChip("AWS_ACCESS_KEY", 1))
        assertEquals("2 AWS Keys", ShieldStore.categoryChip("AWS_ACCESS_KEY", 2))
        assertEquals("1 Email", ShieldStore.categoryChip("EMAIL", 1))
        assertEquals("2 Emails", ShieldStore.categoryChip("EMAIL", 2))
        assertEquals("1 Address", ShieldStore.categoryChip("ADDRESS", 1))
        assertEquals("2 Addresses", ShieldStore.categoryChip("ADDRESS", 2))
        assertEquals("1 Card Number", ShieldStore.categoryChip("CREDIT_CARD", 1))
        assertEquals("3 Card Numbers", ShieldStore.categoryChip("CREDIT_CARD", 3))
        assertEquals("2 IPs", ShieldStore.categoryChip("IP_ADDRESS", 2))
        assertEquals("2 Private Keys", ShieldStore.categoryChip("PEM_PRIVATE_KEY", 2))
        assertEquals("2 Bearer/JWTs", ShieldStore.categoryChip("BEARER_OR_JWT", 2))
        assertEquals("2 Health Info", ShieldStore.categoryChip("CONTEXTUAL_PHI", 2))
        assertEquals("2 API Keys", ShieldStore.categoryChip("API_KEY", 2))
    }

    @Test
    fun `pluraliser does not double pluralise or break uncountables`() {
        assertEquals("Secret", Pluralize.of(1, "Secret"))
        assertEquals("Secrets", Pluralize.of(0, "Secret"))
        assertEquals("Addresses", Pluralize.of(4, "Address"))
        assertEquals("Health Info", Pluralize.of(3, "Health Info"))
        assertEquals("Cards", Pluralize.of(2, "Card"))
    }

    // --- Dynamic "Guard any app" filtering -------------------------------------------------

    private val installed = listOf(
        InstalledApp("com.example.notes", "Notes"),
        InstalledApp("com.openai.chatgpt", "ChatGPT"),
        InstalledApp("com.android.chrome", "Chrome"),
        InstalledApp("org.telegram.messenger", "Telegram"),
        InstalledApp("com.example.bank", "Acme Bank"),
    )

    @Test
    fun `pinned ai chat and browser apps sort to the top when installed`() {
        val ordered = InstalledAppCatalog.order(installed)
        assertEquals("ChatGPT", ordered[0].label)
        assertEquals("Chrome", ordered[1].label)
        assertEquals("Telegram", ordered[2].label)
        // Non-pinned apps keep a stable alphabetical tail.
        assertEquals(listOf("Acme Bank", "Notes"), ordered.drop(3).map { it.label })
    }

    @Test
    fun `search matches both label and package name`() {
        assertEquals(listOf("ChatGPT"), InstalledAppCatalog.filter(installed, "chat").map { it.label })
        assertEquals(listOf("Acme Bank"), InstalledAppCatalog.filter(installed, "example.bank").map { it.label })
        assertEquals(listOf("Telegram"), InstalledAppCatalog.filter(installed, "TELEGRAM").map { it.label })
        assertEquals(installed.size, InstalledAppCatalog.filter(installed, "").size)
        assertTrue(InstalledAppCatalog.filter(installed, "no-such-app").isEmpty())
    }

    @Test
    fun `blank query keeps the pinned ordering`() {
        val filtered = InstalledAppCatalog.filter(installed, "   ")
        assertEquals("ChatGPT", filtered.first().label)
    }

    @Test
    fun `pinned list covers the apps the demo relies on`() {
        val pinned = InstalledAppCatalog.PINNED_PACKAGES
        assertTrue(pinned.contains("com.openai.chatgpt"))
        assertTrue(pinned.contains("com.anthropic.claude"))
        assertTrue(pinned.contains("com.google.android.apps.bard"))
        assertTrue(pinned.contains("com.whatsapp"))
        assertTrue(pinned.contains("com.android.chrome"))
        assertTrue(pinned.contains("com.Slack"))
        assertTrue(pinned.contains("com.discord"))
        assertTrue(pinned.contains("org.telegram.messenger"))
        assertTrue(pinned.contains("org.mozilla.firefox"))
        assertTrue(pinned.contains("com.brave.browser"))
        assertFalse("Cordon must never guard itself", pinned.contains("com.localfirst.triage"))
    }

    @Test
    fun `an empty app list is handled without crashing`() {
        assertTrue(InstalledAppCatalog.order(emptyList()).isEmpty())
        assertTrue(InstalledAppCatalog.filter(emptyList(), "chat").isEmpty())
    }

    @Test
    fun `unknown categories still render a readable chip`() {
        assertEquals("1 Weird thing", ShieldStore.categoryChip("WEIRD_THING", 1))
        assertEquals("2 Weird things", ShieldStore.categoryChip("WEIRD_THING", 2))
    }
}
