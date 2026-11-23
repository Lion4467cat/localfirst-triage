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

    private val EXACT_PACKAGES = setOf(
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

    fun isExcludedPackage(packageName: String?): Boolean {
        if (packageName.isNullOrBlank()) return true
        val pkg = packageName.lowercase()
        if (pkg in EXACT_PACKAGES) return true
        if (IME_HINTS.any { pkg.contains(it) }) return true
        // Home launchers: every OEM ships a different package name, all of them contain
        // "launcher" or end in ".home".
        if (pkg.contains("launcher") || pkg.endsWith(".home")) return true
        return false
    }
}

/**
 * When to show the full-screen decision modal.
 *
 * Two timings, both deliberate:
 * - a paste (or any jump of [PASTE_BURST_CHARS] characters in one event) is unambiguous, so the
 *   modal appears immediately;
 * - manual typing is debounced by [TYPING_DEBOUNCE_MS] so a user typing a sentence is never
 *   interrupted mid-word, and the field is re-read before locking.
 */
object GuardTriggerPolicy {
    const val PASTE_BURST_CHARS = 8
    const val TYPING_DEBOUNCE_MS = 500L

    fun isPasteBurst(previousLength: Int, currentLength: Int): Boolean =
        currentLength - previousLength >= PASTE_BURST_CHARS

    fun shouldShowImmediately(isBurst: Boolean, findingCount: Int): Boolean =
        isBurst && findingCount > 0

    fun shouldDebounce(isBurst: Boolean, findingCount: Int): Boolean =
        !isBurst && findingCount > 0

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

    val isActive: Boolean get() = textHash != null

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
    const val ENGINE_LABEL = "Deterministic Rules"

    fun subtext(appName: String): String =
        "Sensitive data detected in $appName. Scrub it before it leaves your device."
}

/** Zero-PII category chips: counts only, never the matched value. */
object FindingChips {
    fun chips(spans: List<RedactionSpan>, limit: Int = 3): List<String> {
        val counts = LinkedHashMap<String, Int>()
        for (span in spans.filter { it.masked }) {
            counts[span.category] = (counts[span.category] ?: 0) + 1
        }
        val ordered = counts.entries.sortedWith(
            compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key },
        )
        val visible = ordered.take(limit).map { (category, count) -> ShieldStore.categoryChip(category, count) }
        val hidden = ordered.size - visible.size
        return if (hidden > 0) visible + "+$hidden more" else visible
    }

    fun summary(spans: List<RedactionSpan>): String = chips(spans, limit = 3).joinToString(" · ")
}
