package com.localfirst.triage.accessibility

import com.localfirst.triage.data.ShieldStore
import com.localfirst.triage.model.RedactionSpan

/**
 * Packages and fields the shield must never touch.
 *
 * A full-screen lock is only acceptable when it can never appear on the system surfaces a user
 * needs to escape it (home screen, Settings, System UI), inside the keyboard itself, or on a
 * password field where the platform already hides the text.
 */
object GuardExclusions {
    const val SELF_PACKAGE = "com.localfirst.triage"

    val EXACT_PACKAGES = setOf(
        SELF_PACKAGE,
        "android",
        "com.android.systemui",
        "com.android.settings",
        "com.android.phone",
        "com.android.permissioncontroller",
        "com.google.android.permissioncontroller",
    )

    /** IME packages: locking inside a keyboard would trap the user with no way to type. */
    private val IME_HINTS = listOf(
        "inputmethod",
        "honeyboard",
        "swiftkey",
        "touchtype",
        "keyboard",
        "gboard",
        ".ime",
    )

    /**
     * True for keyboards. A keyboard raises its own window-state events while the user is typing,
     * so those must not be mistaken for the user leaving the app the modal was raised for.
     */
    fun isInputMethodPackage(packageName: String?): Boolean {
        if (packageName.isNullOrBlank()) return false
        val pkg = packageName.lowercase()
        return IME_HINTS.any { pkg.contains(it) }
    }

    fun isExcludedPackage(packageName: String?): Boolean {
        if (packageName.isNullOrBlank()) return true
        val pkg = packageName.lowercase()
        if (pkg in EXACT_PACKAGES) return true
        if (isInputMethodPackage(pkg)) return true
        // Home launchers: every OEM ships a different package name, all of them contain
        // "launcher" or end in ".home".
        if (pkg.contains("launcher") || pkg.endsWith(".home")) return true
        return false
    }
}

/**
 * When to show the full-screen decision modal.
 *
 * A paste (or any jump of [PASTE_BURST_CHARS] characters in one event) is unambiguous, so the
 * modal appears immediately. A typed finding is also complete the moment it matches, unless it is
 * open-ended PII still growing at the end of the field — that is the only case that waits, and it
 * waits [TYPING_DEBOUNCE_MS] so the user can finish the address instead of being interrupted
 * mid-word.
 */
object GuardTriggerPolicy {
    const val PASTE_BURST_CHARS = 8
    const val TYPING_DEBOUNCE_MS = 250L

    enum class Trigger { IGNORE, LOCK_NOW, DEBOUNCE }

    /**
     * Categories whose match can still grow with the next keystroke. Everything else — API keys,
     * JWTs, private keys, cards, security codes, UPI VPAs, PANs and IFSC codes — is complete the
     * instant it matches.
     *
     * Government ids stay here on purpose: a 12-digit Aadhaar is indistinguishable from the first
     * twelve digits of a card until the card finishes. Waiting 250 ms lets a card being typed
     * reach its Luhn check instead of locking the user out with a half-scrubbed "Gov ID".
     */
    private val OPEN_ENDED_CATEGORIES = setOf(
        "EMAIL", "PHONE", "MOBILE", "ADDRESS", "PERSON", "NAME", "FIRSTNAME", "LASTNAME",
        "ORG_TERM", "ORGANIZATION", "COMPANY", "POSTAL_CODE", "ACCOUNT_NUMBER", "LOCATION",
        "PHI", "MEDICAL", "HEALTH", "MEDICAL_PHI", "CONTEXTUAL_PHI", "GOV_ID", "AADHAAR",
        "PASSPORT",
    )

    fun isPasteBurst(previousLength: Int, currentLength: Int): Boolean =
        currentLength - previousLength >= PASTE_BURST_CHARS

    fun isOpenEnded(category: String): Boolean =
        category.uppercase() in OPEN_ENDED_CATEGORIES

    /**
     * [findings] must be the masked spans for [textLength] characters of live field text.
     *
     * Only a field whose every finding is open-ended *and* runs to the last character waits: a
     * terminated address or an email followed by a space is already complete, so locking early
     * costs nothing.
     */
    fun trigger(isBurst: Boolean, findings: List<RedactionSpan>, textLength: Int): Trigger {
        if (findings.isEmpty()) return Trigger.IGNORE
        if (isBurst) return Trigger.LOCK_NOW
        val stillGrowing = findings.all { span ->
            isOpenEnded(span.category) && span.end >= textLength
        }
        return if (stillGrowing) Trigger.DEBOUNCE else Trigger.LOCK_NOW
    }

    /**
     * The debounced rescan only fires while the field still holds the exact secret that was
     * detected: if the user deleted it in the meantime, nothing is locked.
     */
    fun stillHoldsSecret(currentText: String, detected: List<RedactionSpan>): Boolean {
        if (currentText.isBlank()) return false
        return detected.any { span ->
            span.masked && span.matchedText.length >= 4 && currentText.contains(span.matchedText)
        }
    }

    private const val KEY_ENTER = 66
    private const val KEY_NUMPAD_ENTER = 160
    private const val KEY_SEARCH = 84
    private const val KEY_DPAD_CENTER = 23

    /** Keys that could submit the field underneath the modal must never reach the app. */
    fun shouldSwallowKey(keyCode: Int, modalVisible: Boolean): Boolean {
        if (!modalVisible) return false
        return keyCode == KEY_ENTER || keyCode == KEY_NUMPAD_ENTER ||
            keyCode == KEY_SEARCH || keyCode == KEY_DPAD_CENTER
    }
}

/**
 * "Allow Once (Unsafe)" memory.
 *
 * Stored in memory only (Zero-PII): the hash of the exact `(package, text)` pair the user chose
 * to send. While that text is unchanged the modal cannot re-open, which is what stops a
 * `TYPE_WINDOW_CONTENT_CHANGED` storm from re-locking the same message in a loop. Any edit or a
 * cleared field drops the override.
 */
class OverrideMemory {
    private var packageName: String? = null
    private var textHash: Int? = null

    fun remember(pkg: String, rawText: String) {
        packageName = pkg
        textHash = rawText.hashCode()
    }

    fun isOverridden(pkg: String, rawText: String): Boolean =
        packageName == pkg && textHash == rawText.hashCode()

    /** Drops the override as soon as the text changes or empties. */
    fun onTextChanged(pkg: String, rawText: String) {
        val active = textHash ?: return
        if (rawText.isBlank() || packageName != pkg || active != rawText.hashCode()) clear()
    }

    fun clear() {
        packageName = null
        textHash = null
    }
}

/**
 * Recognises the text event caused by our own `ACTION_SET_TEXT` scrub, so the scrub never
 * re-triggers the shield it just satisfied.
 */
class SelfEditTracker {
    private var expectedHash: Int? = null

    fun mark(scrubbedText: String) {
        expectedHash = scrubbedText.hashCode()
    }

    fun consume(text: String): Boolean {
        val expected = expectedHash ?: return false
        if (expected != text.hashCode()) return false
        expectedHash = null
        return true
    }

    fun clear() {
        expectedHash = null
    }
}

/** Copy for the full-screen decision modal. Kept out of the view code so it is testable. */
object ModalCopy {
    const val HEADER = "Cordon Privacy Shield"
    const val STATUS_PILL = "Sensitive Data Blocked"
    const val FOOTER = "Zero-PII · Processed 100% On-Device"
    const val PRIMARY = "Scrub in Field"
    const val SECONDARY = "Allow Once (Unsafe)"
    const val CLIPBOARD_TOAST = "Scrubbed text copied — paste to replace"
    const val ENGINE_LABEL = ShieldStore.ENGINE_ON_DEVICE

    fun subtext(appName: String): String =
        "Sensitive data detected in $appName. Scrub it before it leaves your device."
}

/** Zero-PII category chips: counts only, never the matched value. */
object FindingChips {
    fun chips(spans: List<RedactionSpan>, limit: Int = 3): List<String> {
        val ordered = ShieldStore.orderedCategories(ShieldStore.categoryCounts(spans))
        val visible = ordered.take(limit).map { (category, count) -> ShieldStore.categoryChip(category, count) }
        val hidden = ordered.size - visible.size
        return if (hidden > 0) visible + "+$hidden more" else visible
    }

    fun summary(spans: List<RedactionSpan>): String = chips(spans, limit = 3).joinToString(" · ")
}
